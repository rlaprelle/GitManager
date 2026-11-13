import type { GitBridge } from '@/types/bridge'
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
import type { GitDataSource } from './GitDataSource'

/**
 * The desktop app's data source: each call goes over the preload bridge to the main process,
 * which runs the installed git. Fetch, Pull and Push aren't built yet; the UI hides them.
 */
export class IpcGitDataSource implements GitDataSource {
  constructor(private readonly git: GitBridge) {}

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

  /** Main shows the folder picker. */
  addRepository(): Promise<AddRepositoryResult> {
    return this.git.addRepository()
  }

  removeRepository(repoId: string): Promise<OperationResult> {
    return this.git.removeRepository(repoId)
  }

  /**
   * Sends plain copies: IPC clones its arguments, and a Vue reactive object (the composable
   * keeps a waiting checkout in a ref) is a proxy, which can't be cloned.
   */
  checkout(repoId: string, target: CheckoutTarget, options: CheckoutOptions = {}): Promise<CheckoutResult> {
    const plainTarget: CheckoutTarget = 'local' in target ? { local: target.local } : { remote: target.remote }
    const plainOptions: CheckoutOptions = options.leaveCommits === undefined ? {} : { leaveCommits: options.leaveCommits }
    return this.git.checkout(repoId, plainTarget, plainOptions)
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
