import type { GitReadBridge } from '@/types/bridge'
import type { Branches, FileChange, HistoryPage, Hunk, OperationResult, Repository } from '@/types/git'
import type { GitDataSource } from './GitDataSource'

/**
 * The desktop app's data source: each read goes over the preload bridge to the main process,
 * which runs the installed git. Read-only for now; the UI hides the write operations.
 */
export class IpcGitDataSource implements GitDataSource {
  constructor(private readonly git: GitReadBridge) {}

  listRepositories(): Promise<Repository[]> {
    return this.git.listRepositories()
  }

  getBranches(repoId: string): Promise<Branches> {
    return this.git.getBranches(repoId)
  }

  getHistory(repoId: string, limit: number): Promise<HistoryPage> {
    return this.git.getHistory(repoId, limit)
  }

  getCommitFiles(repoId: string, hash: string): Promise<FileChange[]> {
    return this.git.getCommitFiles(repoId, hash)
  }

  getFileDiff(repoId: string, hash: string, path: string): Promise<Hunk[]> {
    return this.git.getFileDiff(repoId, hash, path)
  }

  compareFiles(repoId: string, leftPath: string, rightPath: string): Promise<Hunk[]> {
    return this.git.compareFiles(repoId, leftPath, rightPath)
  }

  checkout(_repoId: string, _branch: string): Promise<OperationResult> {
    return notYetAvailable('Checkout')
  }

  fetch(_repoId: string): Promise<OperationResult> {
    return notYetAvailable('Fetch')
  }

  pull(_repoId: string, _branch: string): Promise<OperationResult> {
    return notYetAvailable('Pull')
  }

  push(_repoId: string, _branch: string): Promise<OperationResult> {
    return notYetAvailable('Push')
  }
}

function notYetAvailable(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} isn't available in this version yet`))
}
