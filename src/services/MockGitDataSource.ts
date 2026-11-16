import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import type { SampleCommit, SampleRepository } from '@/data/sampleTypes'
import { localNameOf, switchedMessage } from '@/lib/checkout'
import { CLONE_CANCELLED, cloneUrlProblem, folderNameProblem } from '@/lib/clone'
import { invertHunks } from '@/lib/diff'
import { fetchedMessage, publishedMessage, pulledMessage, pushedMessage } from '@/lib/remoteOperations'
import { layoutLanes, primaryBranchTip } from '@/lib/laneLayout'
import type {
  AddRepositoryResult,
  Branches,
  CheckoutOptions,
  CheckoutResult,
  CheckoutTarget,
  CloneProgress,
  CloneRequest,
  FileChange,
  HistoryPage,
  Hunk,
  LocalBranch,
  OperationResult,
  Repository,
} from '@/types/git'
import type { GitDataSource } from './GitDataSource'

/** The sample repositories have one remote. */
const SAMPLE_REMOTES = ['origin']

/** Where the browser's pretend clones go: the samples' own folder. */
export const SAMPLE_CLONE_FOLDER = 'C:\\dev'

/** A pretend clone is a copy of this sample, which has its default branch checked out. */
const CLONE_TEMPLATE_ID = 'pricing'

/** The progress a pretend clone reports, one step per tick. */
const CLONE_STEPS: CloneProgress[] = [
  { phase: 'Receiving objects', percent: 0 },
  { phase: 'Receiving objects', percent: 40 },
  { phase: 'Receiving objects', percent: 100 },
  { phase: 'Resolving deltas', percent: 50 },
  { phase: 'Resolving deltas', percent: 100 },
]

/**
 * In-memory stand-in for a git backend, serving the design's sample repos. Checkout and push
 * really change them; the sample remote has nothing new, so fetch and pull only report that.
 * Every result is a copy, so callers can't change the data through it.
 */
export class MockGitDataSource implements GitDataSource {
  /** Repositories taken off the list this session. */
  private readonly removed = new Set<string>()

  /**
   * Checkout changes `repositories`. By default they're this source's own copy of the samples;
   * repositories passed in stay the caller's, so a test can change them "outside the app".
   */
  constructor(
    private readonly repositories: SampleRepository[] = structuredClone(sampleRepositories),
    /** How long each step of a pretend clone takes: long enough to see, and to cancel. Tests pass 0. */
    private readonly cloneStepMs = 150,
  ) {}

  /** The folder chooseCloneFolder "picked"; null until it is called. */
  private cloneFolder: string | null = null

  /** Stops the pretend clone that is running, if one is. */
  private stopRunningClone: (() => void) | null = null

  private clones = 0

  async listRepositories(): Promise<Repository[]> {
    return this.listed().map(summaryOf)
  }

  /** A browser can't open a folder picker, so this explains what the desktop app would ask for. */
  async addRepository(): Promise<AddRepositoryResult> {
    return { repository: null, message: 'Add repository: choose a folder that contains a .git directory' }
  }

  /** A browser has no folder picker; the samples' folder stands in for the one the user would pick. */
  async chooseCloneFolder(): Promise<string | null> {
    this.cloneFolder = SAMPLE_CLONE_FOLDER
    return this.cloneFolder
  }

  /** Checks the request as real git's source does, then adds a copy of a sample under the new name. */
  async cloneRepository(request: CloneRequest, onProgress?: (progress: CloneProgress) => void): Promise<AddRepositoryResult> {
    const problem = cloneUrlProblem(request.url) ?? folderNameProblem(request.name)
    if (problem) throw new Error(problem)
    if (this.cloneFolder === null) throw new Error('Choose a folder to clone into first')
    if (this.stopRunningClone) throw new Error('A clone is already running')
    const path = `${this.cloneFolder}\\${request.name}`
    // Removed repositories count: taking one off the list leaves its folder where it was.
    if (this.repositories.some((repo) => repo.path.toLowerCase() === path.toLowerCase())) {
      throw new Error(`${path} already exists and isn’t empty`)
    }
    await this.pretendToClone(onProgress ?? (() => {}))
    // From the bundled samples, not this source's list, which may be empty (the first-run screen).
    const template = sampleRepositories.find((repo) => repo.id === CLONE_TEMPLATE_ID)!
    const clone: SampleRepository = {
      ...structuredClone(template),
      id: `clone-${++this.clones}`,
      name: request.name,
      path,
      changedFileCount: 0,
      lastFetch: new Date().toISOString(),
    }
    this.repositories.push(clone)
    return { repository: summaryOf(clone), message: `Cloned ${request.name}` }
  }

  async cancelClone(): Promise<void> {
    this.stopRunningClone?.()
  }

  private pretendToClone(onProgress: (progress: CloneProgress) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let step = 0
      const timer = setInterval(() => {
        if (step < CLONE_STEPS.length) onProgress({ ...CLONE_STEPS[step++]! })
        else finish(resolve)
      }, this.cloneStepMs)
      const finish = (settle: () => void) => {
        clearInterval(timer)
        this.stopRunningClone = null
        settle()
      }
      this.stopRunningClone = () => finish(() => reject(new Error(CLONE_CANCELLED)))
    })
  }

  async removeRepository(repoId: string): Promise<OperationResult> {
    const repo = this.repository(repoId)
    this.removed.add(repoId)
    return { message: `Removed ${repo.name} from the list` }
  }

  async getBranches(repoId: string): Promise<Branches> {
    const repo = this.repository(repoId)
    return structuredClone({ local: repo.localBranches, remote: repo.remoteBranches })
  }

  async getHistory(repoId: string, limit: number): Promise<HistoryPage> {
    return sampleHistoryPage(this.repository(repoId), limit)
  }

  async getCommitFiles(repoId: string, hash: string): Promise<FileChange[]> {
    return this.commit(repoId, hash).files.map(({ path, status }) => ({ path, status }))
  }

  async getFileDiff(repoId: string, hash: string, path: string): Promise<Hunk[]> {
    const file = this.commit(repoId, hash).files.find((candidate) => candidate.path === path)
    if (!file) throw new Error(`${path} is not changed in ${hash}`)
    return structuredClone(file.hunks)
  }

  /** Every pair of paths gets the sample diff; the sample pair reversed gets it inverted. */
  async compareFiles(repoId: string, leftPath: string, rightPath: string): Promise<Hunk[]> {
    this.repository(repoId)
    const isReversedSample = leftPath === SAMPLE_COMPARE_PATHS.right && rightPath === SAMPLE_COMPARE_PATHS.left
    return isReversedSample ? invertHunks(sampleCompareDiff) : structuredClone(sampleCompareDiff)
  }

  /** The samples have no detached HEAD, so there are never commits to leave and `options` changes nothing. */
  async checkout(repoId: string, target: CheckoutTarget, _options?: CheckoutOptions): Promise<CheckoutResult> {
    const repo = this.repository(repoId)
    if ('local' in target) {
      if (!repo.localBranches.some((branch) => branch.name === target.local)) throw new Error(`Unknown branch: ${target.local}`)
      repo.currentBranch = target.local
      return { kind: 'switched', branch: target.local, message: switchedMessage(target.local, repo.changedFileCount) }
    }
    const remote = repo.remoteBranches.find((branch) => branch.name === target.remote)
    if (!remote) throw new Error(`Unknown branch: ${target.remote}`)
    const name = localNameOf(remote.name, SAMPLE_REMOTES)
    if (name === null) throw new Error(`${remote.name} belongs to no remote`)
    if (repo.localBranches.some((branch) => branch.name === name)) throw new Error(`A local branch ${name} already exists`)
    repo.localBranches.push({ name, ahead: 0, behind: 0, tipHash: remote.tipHash })
    repo.currentBranch = name
    return { kind: 'switched', branch: name, message: switchedMessage(name, repo.changedFileCount, remote.name) }
  }

  /** The sample remote never has anything new. */
  async fetch(repoId: string): Promise<OperationResult> {
    this.repository(repoId).lastFetch = new Date().toISOString()
    return { message: fetchedMessage({ updated: 0, added: 0, removed: 0 }) }
  }

  /** The sample remote has no commits of its own, so a pull only clears the behind count. */
  async pull(repoId: string, branch: string): Promise<OperationResult> {
    const repo = this.repository(repoId)
    if (repo.currentBranch === null) throw new Error('no branch is checked out')
    if (repo.currentBranch !== branch) throw new Error(`${branch} isn’t checked out; ${repo.currentBranch} is`)
    const local = this.localBranch(repo, branch)
    if (!repo.remoteBranches.some((remote) => remote.name === `origin/${branch}`)) {
      throw new Error(`${branch} has no upstream branch to pull from`)
    }
    const pulled = local.behind
    local.behind = 0
    return { message: pulledMessage(pulled, `origin/${branch}`) }
  }

  /** Moves origin's copy of the branch (and its label in the history) to the branch; publishes one origin lacks. */
  async push(repoId: string, branch: string): Promise<OperationResult> {
    const repo = this.repository(repoId)
    const local = this.localBranch(repo, branch)
    const upstreamName = `origin/${branch}`
    const upstream = repo.remoteBranches.find((remote) => remote.name === upstreamName)
    const pushed = local.ahead
    local.ahead = 0
    moveLabel(repo, upstreamName, local.tipHash)
    if (upstream) {
      upstream.tipHash = local.tipHash
      return { message: pushedMessage(pushed, upstreamName) }
    }
    repo.remoteBranches.push({ name: upstreamName, tipHash: local.tipHash })
    return { message: publishedMessage(branch, 'origin') }
  }

  private localBranch(repo: SampleRepository, branch: string): LocalBranch {
    const local = repo.localBranches.find((candidate) => candidate.name === branch)
    if (!local) throw new Error(`Unknown branch: ${branch}`)
    return local
  }

  private listed(): SampleRepository[] {
    return this.repositories.filter((repo) => !this.removed.has(repo.id))
  }

  private repository(repoId: string): SampleRepository {
    const repo = this.listed().find((candidate) => candidate.id === repoId)
    if (!repo) throw new Error(`Unknown repository: ${repoId}`)
    return repo
  }

  private commit(repoId: string, hash: string): SampleCommit {
    const commit = this.repository(repoId).commits.find((candidate) => candidate.hash === hash)
    if (!commit) throw new Error(`Unknown commit: ${hash}`)
    return commit
  }
}

function summaryOf({ id, name, path, currentBranch, changedFileCount, lastFetch }: SampleRepository): Repository {
  return { id, name, path, currentBranch, changedFileCount, lastFetch, problem: null }
}

/** A sample repository's newest `limit` commits, laid out with the same function the real git source uses. */
export function sampleHistoryPage(repo: SampleRepository, limit: number): HistoryPage {
  const page = repo.commits.slice(0, limit)
  const rows = layoutLanes(page, primaryBranchTip({ local: repo.localBranches, remote: repo.remoteBranches }))
  return {
    commits: page.map(({ files: _files, parents: _parents, ...commit }, index) => ({
      ...structuredClone(commit),
      graph: rows[index]!,
    })),
    hasMore: repo.commits.length > limit,
  }
}

/** Puts a branch label on the commit `hash` and takes it off every other. */
function moveLabel(repo: SampleRepository, label: string, hash: string): void {
  for (const commit of repo.commits) {
    commit.refs = commit.refs.filter((ref) => ref !== label)
    if (commit.hash === hash) commit.refs.push(label)
  }
}
