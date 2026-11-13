import type {
  AddRepositoryResult,
  Branches,
  CheckoutOptions,
  CheckoutResult,
  CheckoutTarget,
  FileChange,
  HistoryPage,
  Hunk,
  OperationResult,
  Repository,
} from '@/types/git'

/** The operations that change a repository; a host shows the buttons only for those it offers. */
export type RepositoryOperation = 'checkout' | 'fetch' | 'pull' | 'push'

export const ALL_OPERATIONS: readonly RepositoryOperation[] = ['checkout', 'fetch', 'pull', 'push']

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
  /** Diff of two files in the repository's working tree; paths are relative to it. */
  compareFiles(repoId: string, leftPath: string, rightPath: string): Promise<Hunk[]>
  /**
   * Adds a repository the user chooses (the desktop app shows a folder picker). Adding one that's
   * already listed returns it again; `repository` is null when nothing was added.
   */
  addRepository(): Promise<AddRepositoryResult>
  /** Takes a repository off the list. Never touches its folder. */
  removeRepository(repoId: string): Promise<OperationResult>
  /**
   * Switches to a branch the repository has, carrying uncommitted changes along as git does
   * (git refuses, and so does this, when they would be overwritten). A remote target creates
   * the local branch that tracks it, and is refused when a local branch of that name exists.
   */
  checkout(repoId: string, target: CheckoutTarget, options?: CheckoutOptions): Promise<CheckoutResult>
  fetch(repoId: string): Promise<OperationResult>
  pull(repoId: string, branch: string): Promise<OperationResult>
  push(repoId: string, branch: string): Promise<OperationResult>
}
