import type {
  AddRepositoryResult,
  Branches,
  CloneProgress,
  CloneRequest,
  CompareSide,
  CheckoutOptions,
  CheckoutResult,
  CheckoutTarget,
  ConflictFile,
  FileChange,
  HistoryPage,
  Hunk,
  MergePreview,
  MergeRequest,
  MergeResolution,
  OperationResult,
  PickedFile,
  Repository,
  UnfinishedOperation,
} from '@/types/git'

/** The operations that change a repository; a host shows the buttons only for those it offers. */
export type RepositoryOperation = 'checkout' | 'fetch' | 'pull' | 'push' | 'clone' | 'merge'

export const ALL_OPERATIONS: readonly RepositoryOperation[] = ['checkout', 'fetch', 'pull', 'push', 'clone', 'merge']

/**
 * Everything the UI needs from git, one call per thing the screen shows, so a real
 * repository never has to be read in full. Every call that names a repository, commit
 * or file it doesn't know rejects.
 */
export interface GitDataSource {
  listRepositories(): Promise<Repository[]>
  getBranches(repoId: string): Promise<Branches>
  /** The newest `limit` commits, newest first. */
  getHistory(repoId: string, limit: number): Promise<HistoryPage>
  getCommitFiles(repoId: string, hash: string): Promise<FileChange[]>
  getFileDiff(repoId: string, hash: string, path: string): Promise<Hunk[]>
  /**
   * Diff of two files, each in a listed repository (working tree or a branch; paths relative to the
   * repository) or picked on disk. Rejects an unknown repository, branch or picked file, and a
   * working-tree path outside its repository.
   */
  compareFiles(left: CompareSide, right: CompareSide): Promise<Hunk[]>
  /** Asks for any file on disk to compare (the desktop app's file picker); null when cancelled. */
  chooseCompareFile(): Promise<PickedFile | null>
  /** Every file on a branch, for picking one to compare. Rejects a branch the repository doesn't have. */
  listBranchFiles(repoId: string, branch: string): Promise<string[]>
  /**
   * Adds a repository the user chooses (the desktop app shows a folder picker). Adding one that's
   * already listed returns it again; `repository` is null when nothing was added.
   */
  addRepository(): Promise<AddRepositoryResult>
  /**
   * Asks for the folder to clone into (the desktop app shows a folder picker) and remembers it for
   * cloneRepository, so the renderer never names a folder. Null when the user cancelled.
   */
  chooseCloneFolder(): Promise<string | null>
  /**
   * Clones `url` into a new folder `name` inside the chosen folder, adds it to the list and returns
   * it. Rejects, before git runs, a URL `cloneUrlProblem` refuses, a name `folderNameProblem` refuses,
   * a folder of that name that isn't empty, no chosen folder yet, and a second clone while one runs.
   * `onProgress` hears git's progress as it goes.
   */
  cloneRepository(request: CloneRequest, onProgress?: (progress: CloneProgress) => void): Promise<AddRepositoryResult>
  /**
   * Stops the running clone, if any, and removes what it made (the folder, when the clone created
   * it). The clone then rejects with CLONE_CANCELLED.
   */
  cancelClone(): Promise<void>
  /** Takes a repository off the list. Never touches its folder. */
  removeRepository(repoId: string): Promise<OperationResult>
  /**
   * Switches to a branch the repository has, carrying uncommitted changes along as git does
   * (git refuses, and so does this, when they would be overwritten). A remote target creates
   * the local branch that tracks it, and is refused when a local branch of that name exists.
   */
  checkout(repoId: string, target: CheckoutTarget, options?: CheckoutOptions): Promise<CheckoutResult>
  fetch(repoId: string): Promise<OperationResult>
  /**
   * Fast-forwards the checked-out `branch` to its upstream. When both have new commits it changes
   * nothing but the fetched remote branches, and answers with `mergeable` naming the upstream.
   */
  pull(repoId: string, branch: string): Promise<OperationResult>
  push(repoId: string, branch: string): Promise<OperationResult>
  /** A merge, rebase or the like someone left unfinished in this repository; null when there's none. */
  getUnfinishedOperation(repoId: string): Promise<UnfinishedOperation | null>
  /**
   * What merging `branch` (a local or remote branch the repository lists, not the checked-out one)
   * into the checked-out branch would do. Changes nothing. Rejects a detached HEAD and a merge already
   * in progress.
   */
  previewMerge(repoId: string, branch: string): Promise<MergePreview>
  /** The three versions of each file in `previewMerge`'s `conflicts`. Rejects if either branch has moved since. */
  getMergeConflicts(repoId: string, request: MergeRequest): Promise<ConflictFile[]>
  /**
   * Does the merge the preview described, with one resolution per conflicted file (none for a clean
   * merge): moves the checked-out branch forward, or makes the merge commit and moves it there. The
   * working tree changes only in this last step. Rejects, changing nothing, if either branch has
   * moved, a resolution is missing or extra, or the merge would overwrite uncommitted changes.
   */
  merge(repoId: string, request: MergeRequest, resolutions: MergeResolution[]): Promise<OperationResult>
}
