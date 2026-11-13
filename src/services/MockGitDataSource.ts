import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import type { SampleCommit, SampleRepository } from '@/data/sampleTypes'
import { localNameOf, switchedMessage } from '@/lib/checkout'
import { invertHunks } from '@/lib/diff'
import { layoutLanes, primaryBranchTip } from '@/lib/laneLayout'
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

/** The sample repositories have one remote. */
const SAMPLE_REMOTES = ['origin']

/**
 * In-memory stand-in for a git backend, serving the design's sample repos. Checkout really
 * switches; remote operations always succeed and report the design's messages. Every result is
 * a copy, so callers can't change the data through it.
 */
export class MockGitDataSource implements GitDataSource {
  /** Repositories taken off the list this session. */
  private readonly removed = new Set<string>()

  /**
   * Checkout changes `repositories`. By default they're this source's own copy of the samples;
   * repositories passed in stay the caller's, so a test can change them "outside the app".
   */
  constructor(private readonly repositories: SampleRepository[] = structuredClone(sampleRepositories)) {}

  async listRepositories(): Promise<Repository[]> {
    return this.listed().map(({ id, name, path, currentBranch, changedFileCount, lastFetch }) => ({
      id,
      name,
      path,
      currentBranch,
      changedFileCount,
      lastFetch,
      problem: null,
    }))
  }

  /** A browser can't open a folder picker, so this explains what the desktop app would ask for. */
  async addRepository(): Promise<AddRepositoryResult> {
    return { repository: null, message: 'Add repository: choose a folder that contains a .git directory' }
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

  async fetch(_repoId: string): Promise<OperationResult> {
    return { message: 'Fetched origin: no new commits' }
  }

  async pull(_repoId: string, branch: string): Promise<OperationResult> {
    return { message: `Pulled origin/${branch}: already up to date` }
  }

  async push(_repoId: string, branch: string): Promise<OperationResult> {
    return { message: `Pushed ${branch} to origin/${branch}` }
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
