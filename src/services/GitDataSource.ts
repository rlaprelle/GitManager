import type { Branches, FileChange, HistoryPage, Hunk, OperationResult, Repository } from '@/types/git'

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
  checkout(repoId: string, branch: string): Promise<OperationResult>
  fetch(repoId: string): Promise<OperationResult>
  pull(repoId: string, branch: string): Promise<OperationResult>
  push(repoId: string, branch: string): Promise<OperationResult>
}
