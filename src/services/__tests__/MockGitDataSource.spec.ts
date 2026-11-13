import { describe, expect, it } from 'vitest'
import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { MockGitDataSource } from '../MockGitDataSource'
import { describeGitDataSourceContract } from './gitDataSourceContract'

describeGitDataSourceContract(
  'MockGitDataSource',
  async () => ({ source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS }),
  // inventory-service has feature/stock-reservations checked out, and no local release/2.4.
  async () => ({ source: new MockGitDataSource(), repoId: 'inventory', otherLocal: 'main', remoteOnly: 'origin/release/2.4' }),
)

describe('MockGitDataSource checkout', () => {
  it('reports the sample’s uncommitted changes as coming along', async () => {
    const result = await new MockGitDataSource().checkout('inventory', { local: 'main' })
    expect(result).toEqual({ kind: 'switched', branch: 'main', message: 'Switched to main; 3 uncommitted changes came along' })
  })

  it('never changes the sample data, or another source', async () => {
    await new MockGitDataSource().checkout('inventory', { remote: 'origin/release/2.4' })
    expect(sampleRepositories[0]!.currentBranch).toBe('feature/stock-reservations')
    expect(sampleRepositories[0]!.localBranches.map((branch) => branch.name)).not.toContain('release/2.4')
    const other = await new MockGitDataSource().listRepositories()
    expect(other[0]!.currentBranch).toBe('feature/stock-reservations')
  })
})
