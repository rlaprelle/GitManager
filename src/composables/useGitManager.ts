import { computed, ref } from 'vue'
import type { GitDataSource } from '@/services/GitDataSource'
import type { Commit, FileChange, Hunk, OperationResult, Repository } from '@/types/git'
import { syncLabel } from '@/lib/format'

export type DiffMode = 'git' | 'simple'

export interface GitManagerOptions {
  comparePaths: { left: string; right: string }
}

export function useGitManager(source: GitDataSource, options: GitManagerOptions) {
  const repositories = ref<Repository[]>([])
  const loading = ref(true)
  const status = ref('Ready')

  const selectedRepoId = ref<string | null>(null)
  const selectedBranch = ref<string | null>(null)
  const selectedCommitIndex = ref(0)
  const selectedFileIndex = ref(0)
  const chosenDiffMode = ref<DiffMode>('git')

  const compareOpen = ref(false)
  const leftPath = ref(options.comparePaths.left)
  const rightPath = ref(options.comparePaths.right)
  const compareHunks = ref<Hunk[]>([])
  let compareRequest = 0

  // ---- derived state ----

  const repository = computed<Repository | undefined>(
    () => repositories.value.find((r) => r.id === selectedRepoId.value) ?? repositories.value[0],
  )

  const commits = computed<Commit[]>(() => repository.value?.commits ?? [])

  const commit = computed<Commit | undefined>(() => {
    const list = commits.value
    return list[Math.min(selectedCommitIndex.value, list.length - 1)]
  })

  const file = computed<FileChange | undefined>(() => {
    const files = commit.value?.files ?? []
    return files[Math.min(selectedFileIndex.value, files.length - 1)]
  })

  const currentBranch = computed(() => repository.value?.currentBranch ?? '')

  /** '↑2 vs origin' for the checked-out branch, or null when it's in sync. */
  const headerSyncLabel = computed<string | null>(() => {
    const local = repository.value?.localBranches.find((b) => b.name === currentBranch.value)
    const label = local ? syncLabel(local) : ''
    return label ? `${label} vs origin` : null
  })

  /** Two arbitrary files have no shared history, so only the simple diff applies. */
  const diffMode = computed<DiffMode>(() => (compareOpen.value ? 'simple' : chosenDiffMode.value))

  const activeHunks = computed<Hunk[]>(() => (compareOpen.value ? compareHunks.value : (file.value?.hunks ?? [])))

  // ---- loading ----

  async function load(): Promise<void> {
    loading.value = true
    try {
      repositories.value = await source.listRepositories()
      const first = repositories.value[0]
      selectedRepoId.value = first?.id ?? null
      selectedBranch.value = first?.currentBranch ?? null
    } catch (error) {
      status.value = `Couldn't load repositories: ${messageOf(error)}`
    } finally {
      loading.value = false
    }
  }

  // ---- selection ----

  function resetCommitView(commitIndex = 0): void {
    selectedCommitIndex.value = commitIndex
    selectedFileIndex.value = 0
    compareOpen.value = false
  }

  function selectRepository(id: string): void {
    const repo = repositories.value.find((r) => r.id === id)
    if (!repo) return
    selectedRepoId.value = id
    selectedBranch.value = repo.currentBranch
    resetCommitView()
    status.value = `Opened ${repo.name}`
  }

  function selectBranch(name: string): void {
    const repo = repository.value
    if (!repo) return
    const tipHash = [...repo.localBranches, ...repo.remoteBranches].find((b) => b.name === name)?.tipHash
    const tipIndex = repo.commits.findIndex((c) => c.hash === tipHash)
    selectedBranch.value = name
    resetCommitView(Math.max(tipIndex, 0))
    status.value = `Selected ${name} (tip ${tipHash ?? 'unknown'})`
  }

  function selectCommit(index: number): void {
    const target = commits.value[index]
    if (!target) return
    resetCommitView(index)
    status.value = `Viewing commit ${target.hash}`
  }

  function selectFile(index: number): void {
    selectedFileIndex.value = index
  }

  function setDiffMode(mode: DiffMode): void {
    if (compareOpen.value) return
    chosenDiffMode.value = mode
  }

  // ---- compare two files ----

  async function refreshCompare(): Promise<void> {
    const request = ++compareRequest
    try {
      const hunks = await source.compareFiles(leftPath.value, rightPath.value)
      if (request === compareRequest) compareHunks.value = hunks
    } catch (error) {
      if (request === compareRequest) {
        compareHunks.value = []
        status.value = `Couldn't compare files: ${messageOf(error)}`
      }
    }
  }

  async function openCompare(): Promise<void> {
    compareOpen.value = true
    status.value = 'Comparing two files'
    await refreshCompare()
  }

  function closeCompare(): void {
    compareOpen.value = false
    if (commit.value) status.value = `Viewing commit ${commit.value.hash}`
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
    if (succeeded && repo) repo.lastFetch = 'just now'
  }

  async function pull(): Promise<void> {
    await runOperation((r) => source.pull(r.id, r.currentBranch))
  }

  async function push(): Promise<void> {
    await runOperation((r) => source.push(r.id, r.currentBranch))
  }

  function addRepository(): void {
    status.value = 'Add repository: choose a folder that contains a .git directory'
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
    // derived
    repository,
    commits,
    commit,
    file,
    currentBranch,
    headerSyncLabel,
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
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
