import { computed, ref } from 'vue'
import type { GitDataSource } from '@/services/GitDataSource'
import type { Branches, Commit, FileChange, HistoryPage, Hunk, OperationResult, Repository } from '@/types/git'
import { headLabel as describeHead, shortHash, syncLabel } from '@/lib/format'
import { latestLoad } from './latestLoad'

export type DiffMode = 'git' | 'simple'

/** How many of a repository's newest commits the history shows. */
export const HISTORY_LIMIT = 200

export interface GitManagerOptions {
  comparePaths: { left: string; right: string }
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

  const compareOpen = ref(false)
  const leftPath = ref(options.comparePaths.left)
  const rightPath = ref(options.comparePaths.right)

  // ---- derived state ----

  const repository = computed<Repository | undefined>(
    () => repositories.value.find((r) => r.id === selectedRepoId.value) ?? repositories.value[0],
  )

  const branches = computed(() => branchesLoad.value.value)
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
    resetCommitView()
    filesLoad.clear()
    diffLoad.clear()
    const [, historyLoaded] = await Promise.all([
      branchesLoad.run(() => source.getBranches(repo.id), reportFailure('branches')),
      historyLoad.run(() => source.getHistory(repo.id, HISTORY_LIMIT), reportFailure('history')),
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
    if (!repo) return false
    try {
      status.value = (await operation(repo)).message
      return true
    } catch (error) {
      status.value = `Failed: ${messageOf(error)}`
      return false
    }
  }

  async function checkoutBranch(name: string): Promise<void> {
    const repo = repository.value
    const succeeded = await runOperation((r) => source.checkout(r.id, name))
    if (succeeded && repo) repo.currentBranch = name
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
    filesLoading: filesLoad.loading,
    diffLoading: diffLoad.loading,
    // derived
    repository,
    branches,
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
    fetchRemote,
    pull,
    push,
    addRepository,
    removeRepository,
  }
}

function checkedOutBranch(repo: Repository): string {
  if (repo.currentBranch === null) throw new Error('no branch is checked out')
  return repo.currentBranch
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
