import type { GitBridge } from '@/types/bridge'
import type {
  AddRepositoryResult,
  Branches,
  CheckoutOptions,
  CheckoutResult,
  CheckoutTarget,
  CloneProgress,
  CloneRequest,
  CompareSide,
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
import type { GitDataSource } from './GitDataSource'

/**
 * The desktop app's data source: each call goes over the preload bridge to the main process,
 * which runs the installed git.
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

  /** Plain copies: the composable keeps the sides in refs, whose proxies IPC can't clone. */
  compareFiles(left: CompareSide, right: CompareSide): Promise<Hunk[]> {
    return this.git.compareFiles(plainSide(left), plainSide(right))
  }

  /** Main shows the file picker, and keeps the path; the renderer gets an id for it. */
  chooseCompareFile(): Promise<PickedFile | null> {
    return this.git.chooseCompareFile()
  }

  listBranchFiles(repoId: string, branch: string): Promise<string[]> {
    return this.git.listBranchFiles(repoId, branch)
  }

  /** Main shows the folder picker. */
  addRepository(): Promise<AddRepositoryResult> {
    return this.git.addRepository()
  }

  removeRepository(repoId: string): Promise<OperationResult> {
    return this.git.removeRepository(repoId)
  }

  /** Main shows the folder picker, and remembers the folder. */
  chooseCloneFolder(): Promise<string | null> {
    return this.git.chooseCloneFolder()
  }

  /** Listens for progress events while the clone runs; sends a plain copy of the request. */
  async cloneRepository(request: CloneRequest, onProgress?: (progress: CloneProgress) => void): Promise<AddRepositoryResult> {
    const stopListening = onProgress ? this.git.onCloneProgress(onProgress) : () => {}
    try {
      return await this.git.cloneRepository({ url: request.url, name: request.name })
    } finally {
      stopListening()
    }
  }

  cancelClone(): Promise<void> {
    return this.git.cancelClone()
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

  fetch(repoId: string): Promise<OperationResult> {
    return this.git.fetch(repoId)
  }

  pull(repoId: string, branch: string): Promise<OperationResult> {
    return this.git.pull(repoId, branch)
  }

  push(repoId: string, branch: string): Promise<OperationResult> {
    return this.git.push(repoId, branch)
  }

  getUnfinishedOperation(repoId: string): Promise<UnfinishedOperation | null> {
    return this.git.getUnfinishedOperation(repoId)
  }

  previewMerge(repoId: string, branch: string): Promise<MergePreview> {
    return this.git.previewMerge(repoId, branch)
  }

  getMergeConflicts(repoId: string, request: MergeRequest): Promise<ConflictFile[]> {
    return this.git.getMergeConflicts(repoId, plainMergeRequest(request))
  }

  /** Plain copies again: the composable keeps the merge in refs. */
  merge(repoId: string, request: MergeRequest, resolutions: MergeResolution[]): Promise<OperationResult> {
    const plainResolutions = resolutions.map(({ path, text }) => ({ path, text }))
    return this.git.merge(repoId, plainMergeRequest(request), plainResolutions)
  }
}

function plainMergeRequest({ branch, into, ours, theirs }: MergeRequest): MergeRequest {
  return { branch, into, ours, theirs }
}

function plainSide(side: CompareSide): CompareSide {
  return side.kind === 'file'
    ? { kind: 'file', fileId: side.fileId }
    : { kind: 'repository', repoId: side.repoId, branch: side.branch, path: side.path }
}
