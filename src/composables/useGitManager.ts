import { computed, ref } from 'vue'
import type { GitDataSource } from '@/services/GitDataSource'
import type {
  Branches,
  CheckoutOptions,
  CheckoutTarget,
  Commit,
  FileChange,
  HistoryPage,
  Hunk,
  OperationResult,
  Repository,
} from '@/types/git'
import { destinationOf, remotesToCheckOut } from '@/lib/checkout'
import { headLabel as describeHead, shortHash, syncLabel } from '@/lib/format'
import { latestLoad } from './latestLoad'

export type DiffMode = 'git' | 'simple'

/** How many of a repository's newest commits the history shows at first, and how many more each "show more" adds. */
export const HISTORY_LIMIT = 200

export interface GitManagerOptions {
  comparePaths: { left: string; right: string }
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

const NO_BRANCHES: Branches = { local: [], remote: [] }
const NO_HISTORY: HistoryPage = { commits: [], hasMore: false }

export function useGitManager(source: GitDataSource, options: GitManagerOptions) {
  const repositories = ref<Repository[]>([])
  const loading = ref(true)
  const status = ref('Ready')

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

  /** How many commits the open repository's history asks for; grows with showMoreHistory. */
  const historyLimit = ref(HISTORY_LIMIT)
  const loadingMoreHistory = ref(false)

  /** True while a repository operation runs; only one runs at a time. */
  const operationRunning = ref(false)
  const pendingCheckout = ref<PendingCheckout | null>(null)

  const compareOpen = ref(false)
  const leftPath = ref(options.comparePaths.left)
  const rightPath = ref(options.comparePaths.right)

  // ---- derived state ----

  const repository = computed<Repository | undefined>(
    () => repositories.value.find((r) => r.id === selectedRepoId.value) ?? repositories.value[0],
  )

  const branches = computed(() => branchesLoad.value.value)
  /** Remote branches the sidebar offers to check out (those with no local branch of their name). */
  const checkoutableRemotes = computed(() => remotesToCheckOut(branches.value))
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

  // ---- loading ----

  async function load(): Promise<void> {
    loading.value = true
    try {
      repositories.value = await source.listRepositories()
    } catch (error) {
      status.value = `Couldn't load repositories: ${messageOf(error)}`
      return
    } finally {
      loading.value = false
    }
    const first = repositories.value[0]
    if (first) await openRepository(first)
  }

  function reportFailure(what: string): (error: unknown) => void {
    return (error) => {
      status.value = `Couldn't load ${what}: ${messageOf(error)}`
    }
  }

  /** Loads branches and history, then opens the newest commit. */
  async function openRepository(repo: Repository): Promise<void> {
    selectedRepoId.value = repo.id
    selectedBranch.value = repo.currentBranch
    pendingCheckout.value = null
    historyLimit.value = HISTORY_LIMIT
    resetCommitView()
    filesLoad.clear()
    diffLoad.clear()
    const [, historyLoaded] = await Promise.all([
      branchesLoad.run(() => source.getBranches(repo.id), reportFailure('branches')),
      historyLoad.run(() => source.getHistory(repo.id, historyLimit.value), reportFailure('history')),
    ])
    if (historyLoaded) await openCommit()
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
    const tipHash = [...branches.value.local, ...branches.value.remote].find((b) => b.name === name)?.tipHash
    const tipIndex = commits.value.findIndex((c) => c.hash === tipHash)
    selectedBranch.value = name
    resetCommitView(Math.max(tipIndex, 0))
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
    const repo = repository.value
    if (!repo) return
    // Desktop starts with both inputs empty; there's nothing to compare until both are filled in.
    if (!leftPath.value.trim() || !rightPath.value.trim()) {
      compareLoad.clear()
      return
    }
    await compareLoad.run(
      () => source.compareFiles(repo.id, leftPath.value, rightPath.value),
      (error) => {
        status.value = `Couldn't compare files: ${messageOf(error)}`
      },
    )
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
    leftPath.value = path
    await refreshCompare()
  }

  async function setRightPath(path: string): Promise<void> {
    rightPath.value = path
    await refreshCompare()
  }

  async function swapComparePaths(): Promise<void> {
    ;[leftPath.value, rightPath.value] = [rightPath.value, leftPath.value]
    await refreshCompare()
  }

  // ---- repository operations ----

  async function runOperation(operation: (repo: Repository) => Promise<OperationResult>): Promise<boolean> {
    const repo = repository.value
    if (!repo || operationRunning.value) return false
    operationRunning.value = true
    try {
      status.value = (await operation(repo)).message
      return true
    } catch (error) {
      status.value = `Failed: ${messageOf(error)}`
      return false
    } finally {
      operationRunning.value = false
    }
  }

  /** Switches to a local branch. */
  async function checkoutBranch(name: string): Promise<void> {
    await runCheckout({ local: name }, name)
  }

  /** Creates the local branch that tracks a remote one, and switches to it. */
  async function checkoutRemoteBranch(name: string): Promise<void> {
    await runCheckout({ remote: name }, name)
  }

  /** Goes ahead with the checkout that was waiting, leaving the detached HEAD's commits behind. */
  async function confirmCheckout(): Promise<void> {
    const pending = pendingCheckout.value
    if (!pending) return
    await runCheckout(pending.target, pending.branch, { leaveCommits: true })
  }

  function cancelCheckout(): void {
    if (!pendingCheckout.value) return
    pendingCheckout.value = null
    status.value = 'Checkout cancelled; nothing changed'
  }

  /**
   * Asks the source to switch, then reloads what the switch changed. The source decides
   * whether it needs the user's agreement first (pendingCheckout). A refresh already running
   * finishes first, so what it read before the switch can't land after it.
   */
  async function runCheckout(target: CheckoutTarget, branch: string, options: CheckoutOptions = {}): Promise<void> {
    const repo = repository.value
    if (!repo || operationRunning.value) return
    pendingCheckout.value = null
    operationRunning.value = true
    status.value = `Switching to ${branch}…`
    try {
      await refreshInFlight
      const result = await source.checkout(repo.id, target, options)
      if (result.kind === 'confirm') {
        pendingCheckout.value = { target, branch, destination: destinationOf(target), commitsLeft: result.commitsLeft }
        status.value = `Switching to ${branch} would leave ${commitCount(result.commitsLeft)} on no branch`
        return
      }
      repo.currentBranch = result.branch
      selectedBranch.value = result.branch
      status.value = result.message
      await reload()
    } catch (error) {
      status.value = `Failed: ${messageOf(error)}`
    } finally {
      operationRunning.value = false
    }
  }

  async function fetchRemote(): Promise<void> {
    const repo = repository.value
    const succeeded = await runOperation((r) => source.fetch(r.id))
    if (succeeded && repo) repo.lastFetch = new Date().toISOString()
  }

  async function pull(): Promise<void> {
    await runOperation((r) => source.pull(r.id, checkedOutBranch(r)))
  }

  async function push(): Promise<void> {
    await runOperation((r) => source.push(r.id, checkedOutBranch(r)))
  }

  // ---- the repository list ----

  /** Adds the repository the user picks (or explains, in the browser) and opens it. */
  async function addRepository(): Promise<void> {
    try {
      const { repository: added, message } = await source.addRepository()
      if (message) status.value = message
      if (!added) return
      if (!repositories.value.some((repo) => repo.id === added.id)) repositories.value.push(added)
      await openRepository(repositories.value.find((repo) => repo.id === added.id)!)
    } catch (error) {
      status.value = `Failed: ${messageOf(error)}`
    }
  }

  /** Takes a repository off the list; if it was open, opens the first one left. */
  async function removeRepository(id: string): Promise<void> {
    const wasOpen = repository.value?.id === id
    try {
      status.value = (await source.removeRepository(id)).message
    } catch (error) {
      status.value = `Failed: ${messageOf(error)}`
      return
    }
    repositories.value = repositories.value.filter((repo) => repo.id !== id)
    if (!wasOpen) return
    const next = repositories.value[0]
    if (next) await openRepository(next)
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
   * Skipped while an operation runs, since it reloads what it changed itself.
   */
  async function refresh(options: { announce?: boolean } = {}): Promise<void> {
    if (refreshInFlight || loading.value || operationRunning.value) return
    refreshInFlight = reload(options.announce)
    try {
      await refreshInFlight
    } finally {
      refreshInFlight = null
    }
  }

  async function reload(announce = false): Promise<void> {
    try {
      repositories.value = await source.listRepositories()
      await refreshOpenRepository()
      if (announce && repository.value) status.value = `Refreshed ${repository.value.name}`
    } catch (error) {
      status.value = `Couldn’t refresh: ${messageOf(error)}`
    }
  }

  async function refreshOpenRepository(): Promise<void> {
    const open = repositories.value.find((repo) => repo.id === selectedRepoId.value)
    if (!open) {
      const first = repositories.value[0]
      if (first) await openRepository(first)
      else closeRepository()
      return
    }
    await Promise.all([
      branchesLoad.refresh(() => source.getBranches(open.id), reportFailure('branches')),
      reloadHistoryKeepingSelection(open.id),
    ])
  }

  /**
   * Reloads the history (as many commits as `historyLimit` says) while the current one stays
   * on screen, then reselects the selected commit by hash; if it's gone, opens the newest.
   */
  async function reloadHistoryKeepingSelection(repoId: string): Promise<void> {
    const selectedHash = commit.value?.hash
    const loaded = await historyLoad.refresh(
      () => source.getHistory(repoId, historyLimit.value),
      reportFailure('history'),
    )
    if (!loaded) return
    const stillThere = commits.value.findIndex((candidate) => candidate.hash === selectedHash)
    if (stillThere >= 0) {
      // A commit never changes, so its files and diff on screen are still right.
      selectedCommitIndex.value = stillThere
      return
    }
    resetCommitView()
    await openCommit()
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
    for (const area of [branchesLoad, historyLoad, filesLoad, diffLoad, compareLoad]) area.clear()
  }

  return {
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
    historyLoading: historyLoad.loading,
    loadingMoreHistory,
    operationRunning,
    pendingCheckout,
    filesLoading: filesLoad.loading,
    diffLoading: diffLoad.loading,
    // derived
    repository,
    branches,
    checkoutableRemotes,
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
    refresh,
    showMoreHistory,
  }
}

function checkedOutBranch(repo: Repository): string {
  if (repo.currentBranch === null) throw new Error('no branch is checked out')
  return repo.currentBranch
}

function commitCount(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
