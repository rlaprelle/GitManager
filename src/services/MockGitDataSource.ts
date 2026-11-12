import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import type { SampleCommit, SampleRepository } from '@/data/sampleTypes'
import { invertHunks } from '@/lib/diff'
import { layoutLanes, primaryBranchTip } from '@/lib/laneLayout'
import type { Branches, FileChange, HistoryPage, Hunk, OperationResult, Repository } from '@/types/git'
import type { GitDataSource } from './GitDataSource'

/**
 * In-memory stand-in for a git backend, serving the design's sample repos.
 * Remote operations always succeed and report the design's messages.
 * Every result is a copy, so callers can't change the sample data.
 */
export class MockGitDataSource implements GitDataSource {
  constructor(private readonly repositories: SampleRepository[] = sampleRepositories) {}

  async listRepositories(): Promise<Repository[]> {
    return this.repositories.map(({ id, name, path, currentBranch, changedFileCount, lastFetch }) => ({
      id,
      name,
      path,
      currentBranch,
      changedFileCount,
      lastFetch,
    }))
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

  async checkout(_repoId: string, branch: string): Promise<OperationResult> {
    return { message: `Switched to branch ${branch}` }
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

  private repository(repoId: string): SampleRepository {
    const repo = this.repositories.find((candidate) => candidate.id === repoId)
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
