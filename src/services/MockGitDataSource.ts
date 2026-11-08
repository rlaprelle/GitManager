import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import { invertHunks } from '@/lib/diff'
import type { Hunk, OperationResult, Repository } from '@/types/git'
import type { GitDataSource } from './GitDataSource'

/**
 * In-memory stand-in for a git backend, serving the design's sample repos.
 * Remote operations always succeed and report the design's messages.
 */
export class MockGitDataSource implements GitDataSource {
  constructor(private readonly repositories: Repository[] = sampleRepositories) {}

  async listRepositories(): Promise<Repository[]> {
    return structuredClone(this.repositories)
  }

  /** Every pair of paths gets the sample diff; the sample pair reversed gets it inverted. */
  async compareFiles(leftPath: string, rightPath: string): Promise<Hunk[]> {
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
}
