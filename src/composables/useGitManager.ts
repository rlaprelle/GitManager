import { computed, ref } from 'vue'
import type { GitDataSource, RepositoryOperation } from '@/services/GitDataSource'
import type {
  Branches,
  CheckoutOptions,
  CheckoutTarget,
  CloneRequest,
  Commit,
  CompareSide,
  FileChange,
  HistoryPage,
  Hunk,
  OperationResult,
  Repository,
  UnfinishedOperation,
} from '@/types/git'
import { destinationOf, remotesToCheckOut } from '@/lib/checkout'
import { CLONE_CANCELLED, cloneProgressLabel } from '@/lib/clone'
import { errorMessage } from '@/lib/errorMessage'
import { divergedElsewhereMessage } from '@/lib/merge'
import { headLabel as describeHead, pluralize, shortHash, splitPath, syncLabel } from '@/lib/format'
import { latestLoad } from './latestLoad'
import { type MergeDrafts, mergeDrafts } from './mergeDrafts'
import { useMergeFlow } from './mergeFlow'
import { useToasts } from './toasts'

export type DiffMode = 'git' | 'simple'

/** How many of a repository's newest commits the history shows at first, and how many more each "show more" adds. */
export const HISTORY_LIMIT = 200

/** A changed file whose diff has no lines: git shows none for a binary file, an empty one, or a move without edits. */
export const NO_TEXT_CHANGES = 'No text changes to show: a binary file, an empty one, or moved without edits'

export interface GitManagerOptions {
  comparePaths: { left: string; right: string }
  /** Where merges being resolved are kept across restarts; localStorage unless a test says otherwise. */
  mergeDrafts?: MergeDrafts
  /** False when the host doesn't offer merging (`merge` isn't among its operations): a diverged Pull then offers nothing. */
  canMerge?: boolean
}

/** A Pull that couldn't fast-forward: where it ran, the upstream that could be merged, and what the source said. */
interface DivergedPull {
  repo: Repository
  upstream: string
  message: string
}

/** A checkout waiting for the user to agree to leave a detached HEAD's commits behind. */
export interface PendingCheckout {
  target: CheckoutTarget
  /** The branch as the user clicked it: 'main', or 'origin/feature'. */
  branch: string
  /** The branch HEAD would end on: 'main', or 'feature' for origin/feature. */
  destination: string
  commitsLeft: number
}

/** A checkout the user asked for: what to switch to, the branch as they clicked it, and how. */
interface CheckoutRequest {
  target: CheckoutTarget
  branch: string
  options: CheckoutOptions
}

const NO_BRANCHES: Branches = { local: [], remote: [] }
const NO_HISTORY: HistoryPage = { commits: [], hasMore: false }

export function useGitManager(source: GitDataSource, options: GitManagerOptions) {
  const repositories = ref<Repository[]>([])
  const loading = ref(true)
  const status = ref('Ready')
  /** What the user must not miss; the status bar alone is too easy to overlook. */
  const toasting = useToasts()

  const selectedRepoId = ref<string | null>(null)
  const selectedBranch = ref<string | null>(null)
  const selectedCommitIndex = ref(0)
  const selectedFileIndex = ref(0)
  const chosenDiffMode = ref<DiffMode>('git')

  // Each area loads separately when its selection changes; see latestLoad.
  const branchesLoad = latestLoad<Branches>(NO_BRANCHES)
  const historyLoad = latestLoad<HistoryPage>(NO_HISTORY)
  const filesLoad = latestLoad<FileChange[]>([])
  const diffLoad = latestLoad<Hunk[]>([])
  const compareLoad = latestLoad<Hunk[]>([])
  const unfinishedLoad = latestLoad<UnfinishedOperation | null>(null)

  /** How many commits the open repository's history asks for; grows with showMoreHistory. */
  const historyLimit = ref(HISTORY_LIMIT)
  const loadingMoreHistory = ref(false)

  /** The operation running now (one at a time), or null. */
  const runningOperation = ref<RepositoryOperation | null>(null)
  const operationRunning = computed(() => runningOperation.value !== null)
  const pendingCheckout = ref<PendingCheckout | null>(null)

  const cloneDialogOpen = ref(false)
  /** The folder clones go into, once the user has picked one. */
  const cloneFolder = ref<string | null>(null)
  /** While a clone runs: 'Cloning tools… Receiving objects 42%'. */
  const cloneProgress = ref<string | null>(null)
  /** Why the last clone failed, shown in the dialog so the user can correct it and try again. */
  const cloneError = ref<string | null>(null)
  /** Cancel was pressed before the source had started the clone (it waits for a refresh first). */
  let cloneCancelRequested = false

  const compareOpen = ref(false)
  const leftSide = ref<CompareChoice>(workingTreeChoice(options.comparePaths.left))
  const rightSide = ref<CompareChoice>(workingTreeChoice(options.comparePaths.right))
  const leftPath = computed(() => leftSide.value.path)
  const rightPath = computed(() => rightSide.value.path)
  /** Other repositories' branches, for a side that compares a file from one; the open one's are `branches`. */
  const otherBranches = ref<Record<string, Branches>>({})
  /** The in-app list of a branch's files, open for one side. */
  const branchFilePicker = ref<BranchFilePicker | null>(null)

  // ---- derived state ----

  const repository = computed<Repository | undefined>(
    () => repositories.value.find((r) => r.id === selectedRepoId.value) ?? repositories.value[0],
  )

  const branches = computed(() => branchesLoad.value.value)
  /** Remote branches the sidebar offers to check out (those with no local branch of their name). */
  const checkoutableRemotes = computed(() => remotesToCheckOut(branches.value))
  const remoteBranchNames = computed(() => branches.value.remote.map((branch) => branch.name))
  const commits = computed<Commit[]>(() => historyLoad.value.value.commits)
  const historyHasMore = computed(() => historyLoad.value.value.hasMore)

  const commit = computed<Commit | undefined>(() => {
    const list = commits.value
    return list[Math.min(selectedCommitIndex.value, list.length - 1)]
  })

  const files = computed(() => filesLoad.value.value)

  const file = computed<FileChange | undefined>(() => {
    const list = files.value
    return list[Math.min(selectedFileIndex.value, list.length - 1)]
  })

  /** The checked-out branch's name, or '' when HEAD is detached. */
  const currentBranch = computed(() => repository.value?.currentBranch ?? '')
  /** What the header and status bar call HEAD: the branch, or 'detached HEAD'. */
  const headLabel = computed(() => describeHead(repository.value?.currentBranch ?? null))

  /** '↑2 vs origin' for the checked-out branch, or null when it's in sync. */
  const headerSyncLabel = computed<string | null>(() => {
    const local = branches.value.local.find((b) => b.name === currentBranch.value)
    const label = local ? syncLabel(local) : ''
    return label ? `${label} vs origin` : null
  })

  /** What the history pane says instead of rows: loading, couldn't load, or no commits; null when it has rows. */
  const historyMessage = computed<string | null>(() => {
    if (historyLoad.loading.value) return 'Loading history…'
    if (historyLoad.failed.value) return 'Couldn’t load history'
    if (repository.value && commits.value.length === 0) return 'No commits yet'
    return null
  })

  /** Two arbitrary files have no shared history, so only the simple diff applies. */
  const diffMode = computed<DiffMode>(() => (compareOpen.value ? 'simple' : chosenDiffMode.value))

  const activeHunks = computed<Hunk[]>(() => (compareOpen.value ? compareLoad.value.value : diffLoad.value.value))

  /**
   * What the diff area says instead of lines; null when it has lines, or while they load. Empty
   * lines mean "nothing to show" only when the load worked: a failed one leaves them empty too.
   */
  const diffMessage = computed<string | null>(() => (compareOpen.value ? compareMessage() : commitDiffMessage()))

  function commitDiffMessage(): string | null {
    if (filesLoad.loading.value || diffLoad.loading.value || !file.value) return null
    if (diffLoad.failed.value) return 'Couldn’t load this diff'
    return diffLoad.value.value.length === 0 ? NO_TEXT_CHANGES : null
  }

  function compareMessage(): string | null {
    if (compareLoad.loading.value || !bothSidesChosen()) return null
    if (compareLoad.failed.value) return 'Couldn’t compare these files'
    return compareLoad.value.value.length === 0 ? 'The two files are the same' : null
  }

  // ---- loading ----

  async function load(): Promise<void> {
    const listed = await readRepositoryList()
    if (listed) await openFirstRepositoryOrClose()
  }

  /** The first read of the list, which `loading` covers. Resolves whether it succeeded. */
  async function readRepositoryList(): Promise<boolean> {
    loading.value = true
    try {
      repositories.value = await source.listRepositories()
      return true
    } catch (error) {
      status.value = `Couldn’t load repositories: ${errorMessage(error)}`
      return false
    } finally {
      loading.value = false
    }
  }

  function reportFailure(what: string): (error: unknown) => void {
    return (error) => {
      status.value = `Couldn’t load ${what}: ${errorMessage(error)}`
    }
  }

  /** Loads branches and history, then opens the newest commit. */
  async function openRepository(repo: Repository): Promise<void> {
    selectedRepoId.value = repo.id
    selectedBranch.value = repo.currentBranch
    pendingCheckout.value = null
    merging.resetMerge()
    historyLimit.value = HISTORY_LIMIT
    resetCommitView()
    filesLoad.clear()
    diffLoad.clear()
    const [, historyLoaded] = await Promise.all([
      branchesLoad.run(() => source.getBranches(repo.id), reportFailure('branches')),
      historyLoad.run(() => source.getHistory(repo.id, historyLimit.value), reportFailure('history')),
      unfinishedLoad.run(() => source.getUnfinishedOperation(repo.id), reportFailure('the repository’s state')),
    ])
    if (!historyLoaded) return
    // A branch picked while the history was loading had no commits to jump to yet: jump now.
    if (selectedBranch.value !== repo.currentBranch) selectedCommitIndex.value = tipIndexOf(selectedBranch.value)
    await Promise.all([openCommit(), merging.resumeSavedMerge(repo)])
  }

  function tipHashOf(name: string | null): string | undefined {
    return [...branches.value.local, ...branches.value.remote].find((b) => b.name === name)?.tipHash
  }

  /** Where a branch's tip is in the history; the newest commit when it isn't there. */
  function tipIndexOf(name: string | null): number {
    const tipHash = tipHashOf(name)
    return Math.max(
      commits.value.findIndex((c) => c.hash === tipHash),
      0,
    )
  }

  /** Loads the selected commit's files, then the selected file's diff. */
  async function openCommit(): Promise<void> {
    const repo = repository.value
    const target = commit.value
    if (!repo || !target) return
    diffLoad.clear()
    const filesLoaded = await filesLoad.run(
      () => source.getCommitFiles(repo.id, target.hash),
      reportFailure('changed files'),
    )
    if (filesLoaded) await openFile()
  }

  async function openFile(): Promise<void> {
    const repo = repository.value
    const target = commit.value
    const changed = file.value
    if (!repo || !target || !changed) return
    await diffLoad.run(() => source.getFileDiff(repo.id, target.hash, changed.path), reportFailure('diff'))
  }

  // ---- selection ----

  function resetCommitView(commitIndex = 0): void {
    selectedCommitIndex.value = commitIndex
    selectedFileIndex.value = 0
    compareOpen.value = false
  }

  async function selectRepository(id: string): Promise<void> {
    const repo = repositories.value.find((r) => r.id === id)
    if (!repo) return
    status.value = `Opened ${repo.name}`
    await openRepository(repo)
  }

  async function selectBranch(name: string): Promise<void> {
    const tipHash = tipHashOf(name)
    selectedBranch.value = name
    resetCommitView(tipIndexOf(name))
    status.value = `Selected ${name} (tip ${tipHash ? shortHash(tipHash) : 'unknown'})`
    await openCommit()
  }

  async function selectCommit(index: number): Promise<void> {
    const target = commits.value[index]
    if (!target) return
    resetCommitView(index)
    status.value = `Viewing commit ${shortHash(target.hash)}`
    await openCommit()
  }

  async function selectFile(index: number): Promise<void> {
    selectedFileIndex.value = index
    await openFile()
  }

  function setDiffMode(mode: DiffMode): void {
    if (compareOpen.value) return
    chosenDiffMode.value = mode
  }

  // ---- compare two files ----

  async function refreshCompare(): Promise<void> {
    const sides = comparedSides()
    // Desktop starts with both inputs empty; there's nothing to compare until both are filled in.
    if (!sides) {
      compareLoad.clear()
      return
    }
    const compared = await compareLoad.run(() => source.compareFiles(...sides), reportCompareFailure)
    // A side changed mid-way (a branch picked before its file) may have failed; once it works, say so.
    if (compared && status.value.startsWith(COMPARE_FAILED)) status.value = 'Comparing two files'
  }

  function bothSidesChosen(): boolean {
    return leftSide.value.path.trim() !== '' && rightSide.value.path.trim() !== ''
  }

  /** What to send the source for each side, once both are chosen; a side with no repository is the open one. */
  function comparedSides(): [CompareSide, CompareSide] | null {
    const open = repository.value
    if (!open || !bothSidesChosen()) return null
    return [toCompareSide(leftSide.value, open.id), toCompareSide(rightSide.value, open.id)]
  }

  function sideRef(which: CompareWhich) {
    return which === 'left' ? leftSide : rightSide
  }

  async function updateSide(which: CompareWhich, change: Partial<CompareChoice>): Promise<void> {
    const side = sideRef(which)
    side.value = { ...side.value, ...change }
    await refreshCompare()
  }

  /** A typed path is the repository's (working tree or branch), never a picked file. */
  async function setComparePath(which: CompareWhich, path: string): Promise<void> {
    await updateSide(which, { path, fileId: null })
  }

  /** Another repository's files: its working tree to start with, and its branches for the Version list. */
  async function setCompareRepository(which: CompareWhich, repoId: string | null): Promise<void> {
    const keep = sideRef(which).value
    const path = keep.fileId === null ? keep.path : ''
    const other = repoId !== null && repoId !== repository.value?.id ? repoId : null
    if (other !== null) await loadOtherBranches(other)
    await updateSide(which, { repoId: other, branch: null, fileId: null, path })
  }

  async function setCompareBranch(which: CompareWhich, branch: string | null): Promise<void> {
    const keep = sideRef(which).value
    await updateSide(which, { branch, fileId: null, path: keep.fileId === null ? keep.path : '' })
  }

  async function loadOtherBranches(repoId: string): Promise<void> {
    if (otherBranches.value[repoId]) return
    try {
      const loaded = await source.getBranches(repoId)
      otherBranches.value = { ...otherBranches.value, [repoId]: loaded }
    } catch (error) {
      status.value = `Couldn’t load branches: ${errorMessage(error)}`
    }
  }

  /** The branches a side may compare from: the open repository's, or the other repository's it names. */
  function compareBranchesOf(which: CompareWhich): string[] {
    const repoId = sideRef(which).value.repoId
    const listed = repoId === null ? branches.value : otherBranches.value[repoId]
    return listed ? [...listed.local, ...listed.remote].map((branch) => branch.name) : []
  }
  const leftBranches = computed(() => compareBranchesOf('left'))
  const rightBranches = computed(() => compareBranchesOf('right'))

  /** A file anywhere on disk, through the host's file picker (desktop only). */
  async function chooseCompareFile(which: CompareWhich): Promise<void> {
    await attempt(async () => {
      const picked = await source.chooseCompareFile()
      if (picked) await updateSide(which, { repoId: null, branch: null, path: picked.path, fileId: picked.fileId })
    })
  }

  /** Opens the in-app list of the side's branch's files (the file picker can't see inside git). */
  async function openBranchFilePicker(which: CompareWhich): Promise<void> {
    const side = sideRef(which).value
    const repoId = side.repoId ?? repository.value?.id
    if (!repoId || side.branch === null) return
    branchFilePicker.value = { which, branch: side.branch, files: [], loading: true }
    try {
      const files = await source.listBranchFiles(repoId, side.branch)
      const picker = branchFilePicker.value
      if (picker?.which === which) branchFilePicker.value = { ...picker, files, loading: false }
    } catch (error) {
      branchFilePicker.value = null
      status.value = `Couldn’t list the files on ${side.branch}: ${errorMessage(error)}`
    }
  }

  async function pickBranchFile(path: string): Promise<void> {
    const picker = branchFilePicker.value
    if (!picker) return
    branchFilePicker.value = null
    await setComparePath(picker.which, path)
  }

  function closeBranchFilePicker(): void {
    branchFilePicker.value = null
  }

  /**
   * Where each side comes from, for the diff's column headings, as short as says it: the file name, after
   * its branch if it has one, after its repository if that isn't the open one ('pricing-api · main · pom.xml').
   */
  const compareLabels = computed(() => ({ left: labelOf(leftSide.value), right: labelOf(rightSide.value) }))

  function labelOf(side: CompareChoice): string {
    const name = splitPath(side.path).name
    if (side.fileId !== null) return name
    const otherRepo = side.repoId === null ? null : repositories.value.find((repo) => repo.id === side.repoId)?.name
    return [otherRepo, side.branch, name].filter(Boolean).join(' · ')
  }

  function reportCompareFailure(error: unknown): void {
    status.value = `${COMPARE_FAILED}: ${errorMessage(error)}`
  }

  async function openCompare(): Promise<void> {
    compareOpen.value = true
    status.value = 'Comparing two files'
    await refreshCompare()
  }

  function closeCompare(): void {
    compareOpen.value = false
    if (commit.value) status.value = `Viewing commit ${shortHash(commit.value.hash)}`
  }

  async function setLeftPath(path: string): Promise<void> {
    await setComparePath('left', path)
  }

  async function setRightPath(path: string): Promise<void> {
    await setComparePath('right', path)
  }

  /** Swaps everything about the two sides: repository, version and file. */
  async function swapComparePaths(): Promise<void> {
    ;[leftSide.value, rightSide.value] = [rightSide.value, leftSide.value]
    await refreshCompare()
  }

  // ---- repository operations ----

  /** Switches to a local branch. */
  async function checkoutBranch(name: string): Promise<void> {
    await runCheckout({ target: { local: name }, branch: name, options: {} })
  }

  /** Creates the local branch that tracks a remote one, and switches to it. */
  async function checkoutRemoteBranch(name: string): Promise<void> {
    await runCheckout({ target: { remote: name }, branch: name, options: {} })
  }

  /** Goes ahead with the checkout that was waiting, leaving the detached HEAD's commits behind. */
  async function confirmCheckout(): Promise<void> {
    const pending = pendingCheckout.value
    if (!pending) return
    await runCheckout({ target: pending.target, branch: pending.branch, options: { leaveCommits: true } })
  }

  function cancelCheckout(): void {
    if (!pendingCheckout.value) return
    pendingCheckout.value = null
    status.value = 'Checkout cancelled; nothing changed'
  }

  async function runCheckout(request: CheckoutRequest): Promise<void> {
    await runOperation('checkout', `Switching to ${request.branch}…`, async (repo) => {
      await attempt(() => switchBranch(repo, request))
    })
  }

  /**
   * Asks the source to switch, then reloads what the switch changed. The source decides
   * whether it needs the user's agreement first (pendingCheckout). A refresh already running
   * finishes first, so what it read before the switch can't land after it.
   */
  async function switchBranch(repo: Repository, request: CheckoutRequest): Promise<void> {
    pendingCheckout.value = null
    await refreshInFlight
    const result = await source.checkout(repo.id, request.target, request.options)
    if (result.kind === 'confirm') {
      askToLeaveCommits(request, result.commitsLeft)
      return
    }
    repo.currentBranch = result.branch
    selectedBranch.value = result.branch
    status.value = result.message
    await reload()
  }

  function askToLeaveCommits({ target, branch }: CheckoutRequest, commitsLeft: number): void {
    pendingCheckout.value = { target, branch, destination: destinationOf(target), commitsLeft }
    status.value = `Switching to ${branch} would leave ${pluralize(commitsLeft, 'commit', 'commits')} on no branch`
  }

  async function fetchRemote(): Promise<void> {
    await runRemoteOperation('fetch', 'Fetching…', (repo) => source.fetch(repo.id))
  }

  /**
   * Brings the checked-out branch level with its upstream (fast-forward only). When both have new
   * commits the source says which upstream could be merged instead, and the Merge dialog offers it.
   */
  async function pull(): Promise<void> {
    const found: { diverged?: DivergedPull } = {}
    await runRemoteOperation('pull', 'Pulling…', async (repo) => {
      const result = await source.pull(repo.id, checkedOutBranch(repo))
      if (result.mergeable) found.diverged = { repo, upstream: result.mergeable, message: result.message }
      return result
    })
    if (found.diverged && options.canMerge !== false) await offerMergeAfterPull(found.diverged)
  }

  /**
   * The pull may have taken a while, and the user may be looking at another repository by now. The
   * dialog would then be about the wrong one, so a toast says what happened where.
   */
  async function offerMergeAfterPull({ repo, upstream, message }: DivergedPull): Promise<void> {
    if (repository.value?.id === repo.id) await merging.offerMerge(upstream)
    else toasting.showToast(divergedElsewhereMessage(repo.name, message))
  }

  async function push(): Promise<void> {
    await runRemoteOperation('push', 'Pushing…', (repo) => source.push(repo.id, checkedOutBranch(repo)))
  }

  /**
   * Fetch, Pull and Push: one operation at a time, after a refresh already running. The source
   * may take a while (git can be waiting for the user to sign in), so `progress` shows meanwhile.
   * Everything is re-read afterwards even when it failed: a pull refused after fetching, or a
   * fetch that failed for one remote of several, still moved remote branches. The last fetch
   * time comes back from the source with the rest.
   */
  async function runRemoteOperation(
    name: RepositoryOperation,
    progress: string,
    operation: (repo: Repository) => Promise<OperationResult>,
  ): Promise<void> {
    await runOperation(name, progress, async (repo) => {
      await attempt(() => reportRemoteOperation(repo, operation))
      await reload()
    })
  }

  async function reportRemoteOperation(
    repo: Repository,
    operation: (repo: Repository) => Promise<OperationResult>,
  ): Promise<void> {
    await refreshInFlight
    status.value = (await operation(repo)).message
  }

  /** Runs one repository operation, unless one is running already; `runningOperation` names it until `work` ends. */
  async function runOperation(
    name: RepositoryOperation,
    progress: string,
    work: (repo: Repository) => Promise<void>,
  ): Promise<void> {
    const repo = repository.value
    if (!repo || operationRunning.value) return
    runningOperation.value = name
    status.value = progress
    try {
      await work(repo)
    } finally {
      runningOperation.value = null
    }
  }

  /** Runs `work`; when it fails, the status bar says "Failed: …". Resolves whether it succeeded. */
  async function attempt(work: () => Promise<void>): Promise<boolean> {
    try {
      await work()
      return true
    } catch (error) {
      status.value = `Failed: ${errorMessage(error)}`
      return false
    }
  }

  // ---- the repository list ----

  /** Adds the repository the user picks (or explains, in the browser) and opens it. */
  async function addRepository(): Promise<void> {
    await attempt(addChosenRepository)
  }

  async function addChosenRepository(): Promise<void> {
    const { repository: added, message } = await source.addRepository()
    if (message) status.value = message
    if (added) await listAndOpen(added)
  }

  // ---- cloning ----

  function openCloneDialog(): void {
    cloneError.value = null
    cloneDialogOpen.value = true
  }

  /** Closes the dialog, unless its clone is running: Cancel stops the clone first. */
  function closeCloneDialog(): void {
    if (runningOperation.value === 'clone') return
    cloneDialogOpen.value = false
  }

  async function chooseCloneFolder(): Promise<void> {
    await attempt(async () => {
      const chosen = await source.chooseCloneFolder()
      if (chosen !== null) cloneFolder.value = chosen
    })
  }

  /**
   * Clones, showing git's progress in the dialog and the status bar, then lists and opens the clone
   * and closes the dialog. Works with no repository open (the first-run screen). A failure stays in
   * the dialog; a cancelled clone just says so.
   */
  async function cloneRepository(request: CloneRequest): Promise<void> {
    if (operationRunning.value) return
    runningOperation.value = 'clone'
    cloneError.value = null
    cloneCancelRequested = false
    const showProgress = (label: string) => {
      cloneProgress.value = label
      status.value = label
    }
    try {
      await refreshInFlight
      if (cloneCancelRequested) throw new Error(CLONE_CANCELLED)
      showProgress(cloneProgressLabel(request.name, null))
      const { repository: cloned, message } = await source.cloneRepository(
        { url: request.url, name: request.name },
        (progress) => showProgress(cloneProgressLabel(request.name, progress)),
      )
      cloneDialogOpen.value = false
      if (cloned) await listAndOpen(cloned)
      status.value = message
    } catch (error) {
      const reason = errorMessage(error)
      const cancelled = reason === CLONE_CANCELLED
      status.value = cancelled ? CLONE_CANCELLED : `Failed: ${reason}`
      cloneError.value = cancelled ? null : reason
    } finally {
      cloneProgress.value = null
      runningOperation.value = null
    }
  }

  async function cancelClone(): Promise<void> {
    if (runningOperation.value !== 'clone') return
    cloneCancelRequested = true
    await source.cancelClone()
  }

  /** Puts a repository the source just added on the list (once) and opens it. */
  async function listAndOpen(added: Repository): Promise<void> {
    if (!repositories.value.some((repo) => repo.id === added.id)) repositories.value.push(added)
    await openRepository(repositories.value.find((repo) => repo.id === added.id)!)
  }

  /** Takes a repository off the list; if it was open, opens the first one left. */
  async function removeRepository(id: string): Promise<void> {
    const wasOpen = repository.value?.id === id
    const removed = await attempt(async () => {
      status.value = (await source.removeRepository(id)).message
    })
    if (!removed) return
    repositories.value = repositories.value.filter((repo) => repo.id !== id)
    if (wasOpen) await openFirstRepositoryOrClose()
  }

  /** Opens the first repository on the list, or shows none when the list is empty. */
  async function openFirstRepositoryOrClose(): Promise<void> {
    const first = repositories.value[0]
    if (first) await openRepository(first)
    else closeRepository()
  }

  // ---- refreshing ----

  /** The refresh running now, if any. */
  let refreshInFlight: Promise<void> | null = null

  /**
   * Re-reads what may have changed outside the app (commits, branches, the checked-out branch,
   * uncommitted files) without disturbing the view: the history stays on screen while it
   * reloads, and the selected commit stays selected if it still exists. `announce` reports it
   * in the status bar (an explicit refresh); otherwise it's silent (the window regaining focus).
   * Skipped while an operation runs, since it reloads what it changed itself, and while a
   * repository opens, since its reload would replace the opening one and lose a branch picked meanwhile.
   */
  async function refresh(options: { announce?: boolean } = {}): Promise<void> {
    if (refreshInFlight || loading.value || operationRunning.value || openingRepository()) return
    refreshInFlight = reload(options.announce)
    try {
      await refreshInFlight
    } finally {
      refreshInFlight = null
    }
  }

  /** openRepository's first reads are still running (a refresh keeps `loading` false). */
  function openingRepository(): boolean {
    return branchesLoad.loading.value || historyLoad.loading.value
  }

  async function reload(announce = false): Promise<void> {
    try {
      await rereadEverything(announce)
    } catch (error) {
      status.value = `Couldn’t refresh: ${errorMessage(error)}`
    }
  }

  async function rereadEverything(announce: boolean): Promise<void> {
    repositories.value = await source.listRepositories()
    await refreshOpenRepository()
    if (announce && repository.value) status.value = `Refreshed ${repository.value.name}`
  }

  async function refreshOpenRepository(): Promise<void> {
    const open = repositories.value.find((repo) => repo.id === selectedRepoId.value)
    if (!open) {
      await openFirstRepositoryOrClose()
      return
    }
    await Promise.all([
      branchesLoad.refresh(() => source.getBranches(open.id), reportFailure('branches')),
      unfinishedLoad.refresh(() => source.getUnfinishedOperation(open.id), reportFailure('the repository’s state')),
      reloadHistoryKeepingSelection(open.id),
      rereadComparedFiles(),
    ])
    // A merge that was waiting may be able to continue now (its branch checked out again, say).
    await merging.resumeSavedMerge(open, { quietly: true })
  }

  /** Compared files may be working-tree files or branches, which may have changed while the window was away. */
  async function rereadComparedFiles(): Promise<void> {
    const sides = comparedSides()
    if (!compareOpen.value || !sides) return
    await compareLoad.refresh(() => source.compareFiles(...sides), reportCompareFailure)
  }

  /**
   * Reloads the history (as many commits as `historyLimit` says) while the current one stays
   * on screen, then reselects the selected commit by hash; if it's gone, opens the newest.
   */
  async function reloadHistoryKeepingSelection(repoId: string): Promise<void> {
    const shown = commits.value
    const loaded = await historyLoad.refresh(
      () => source.getHistory(repoId, historyLimit.value),
      reportFailure('history'),
    )
    if (!loaded) return
    // Read only now: the user may have picked another commit or branch in the list on screen
    // while git was reading, and that choice is the one to keep.
    const selectedHash = shown[selectedCommitIndex.value]?.hash
    const stillThere = commits.value.findIndex((candidate) => candidate.hash === selectedHash)
    if (stillThere < 0) return showNewestCommit()
    selectedCommitIndex.value = stillThere
    await retryFailedCommitLoads()
  }

  /**
   * The selected commit has gone (amended or rebased away). Unlike picking a commit, this leaves
   * compare open: a refresh happens just by coming back to the window, and mustn't close what the user is looking at.
   */
  async function showNewestCommit(): Promise<void> {
    selectedCommitIndex.value = 0
    selectedFileIndex.value = 0
    await openCommit()
  }

  /** A commit never changes, so its files and diff on screen are still right; only a failed load needs reading again. */
  async function retryFailedCommitLoads(): Promise<void> {
    if (filesLoad.failed.value) return openCommit()
    if (diffLoad.failed.value) return openFile()
  }

  // ---- showing more history ----

  /** Adds the next HISTORY_LIMIT commits to the history, keeping the selection. */
  async function showMoreHistory(): Promise<void> {
    const repo = repository.value
    if (!repo || loadingMoreHistory.value || !historyHasMore.value) return
    historyLimit.value += HISTORY_LIMIT
    loadingMoreHistory.value = true
    try {
      await reloadHistoryKeepingSelection(repo.id)
    } finally {
      loadingMoreHistory.value = false
    }
  }

  function closeRepository(): void {
    selectedRepoId.value = null
    selectedBranch.value = null
    resetCommitView()
    for (const area of [branchesLoad, historyLoad, filesLoad, diffLoad, compareLoad, unfinishedLoad]) area.clear()
    merging.resetMerge()
  }

  // ---- merging (see mergeFlow.ts) ----

  const merging = useMergeFlow({
    source,
    status,
    repository,
    branches,
    currentBranch,
    operationRunning,
    runOperation,
    refreshFinished: () => refreshInFlight,
    reload,
    notify: toasting.showToast,
    retract: toasting.retractToast,
    drafts: options.mergeDrafts ?? mergeDrafts(),
  })

  return {
    ...merging,
    ...toasting,
    unfinishedOperation: unfinishedLoad.value,
    // state
    repositories,
    loading,
    status,
    selectedBranch,
    selectedCommitIndex,
    selectedFileIndex,
    compareOpen,
    leftPath,
    rightPath,
    leftSide,
    rightSide,
    leftBranches,
    rightBranches,
    compareLabels,
    branchFilePicker,
    setComparePath,
    setCompareRepository,
    setCompareBranch,
    chooseCompareFile,
    openBranchFilePicker,
    pickBranchFile,
    closeBranchFilePicker,
    historyLoading: historyLoad.loading,
    loadingMoreHistory,
    runningOperation,
    operationRunning,
    pendingCheckout,
    filesLoading: filesLoad.loading,
    diffLoading: diffLoad.loading,
    // derived
    repository,
    branches,
    checkoutableRemotes,
    remoteBranchNames,
    commits,
    historyHasMore,
    commit,
    files,
    file,
    currentBranch,
    headLabel,
    headerSyncLabel,
    historyMessage,
    diffMode,
    activeHunks,
    diffMessage,
    // actions
    load,
    selectRepository,
    selectBranch,
    selectCommit,
    selectFile,
    setDiffMode,
    openCompare,
    closeCompare,
    setLeftPath,
    setRightPath,
    swapComparePaths,
    checkoutBranch,
    checkoutRemoteBranch,
    confirmCheckout,
    cancelCheckout,
    fetchRemote,
    pull,
    push,
    addRepository,
    removeRepository,
    cloneDialogOpen,
    cloneFolder,
    cloneProgress,
    cloneError,
    openCloneDialog,
    closeCloneDialog,
    chooseCloneFolder,
    cloneRepository,
    cancelClone,
    refresh,
    showMoreHistory,
  }
}

function checkedOutBranch(repo: Repository): string {
  if (repo.currentBranch === null) throw new Error('no branch is checked out')
  return repo.currentBranch
}

const COMPARE_FAILED = 'Couldn’t compare files'

export type CompareWhich = 'left' | 'right'

/** What the user chose for one side of a comparison. */
export interface CompareChoice {
  /** null: the open repository (and it follows when another is opened). */
  repoId: string | null
  /** null: the working tree. */
  branch: string | null
  /** In the repository; or the picked file's path, to show. */
  path: string
  /** Set when the file was picked on disk; the source knows it by this id. */
  fileId: string | null
}

export interface BranchFilePicker {
  which: CompareWhich
  branch: string
  files: string[]
  loading: boolean
}

function workingTreeChoice(path: string): CompareChoice {
  return { repoId: null, branch: null, path, fileId: null }
}

function toCompareSide(choice: CompareChoice, openRepoId: string): CompareSide {
  if (choice.fileId !== null) return { kind: 'file', fileId: choice.fileId }
  return { kind: 'repository', repoId: choice.repoId ?? openRepoId, branch: choice.branch, path: choice.path }
}
