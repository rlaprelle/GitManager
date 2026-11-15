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

describe('MockGitDataSource fetch, pull and push', () => {
  const labelsOf = async (source: MockGitDataSource, hash: string) =>
    (await source.getHistory('inventory', 50)).commits.find((commit) => commit.hash === hash)!.refs

  it('pushes the checked-out branch’s commits, moving origin’s label to its tip', async () => {
    const source = new MockGitDataSource()
    expect(await source.push('inventory', 'feature/stock-reservations')).toEqual({
      message: 'Pushed 2 commits to origin/feature/stock-reservations',
    })
    expect(await labelsOf(source, '9f3a1c2')).toEqual(['feature/stock-reservations', 'origin/feature/stock-reservations'])
    expect(await labelsOf(source, 'a07c3be')).toEqual([])
    const { remote } = await source.getBranches('inventory')
    expect(remote.find((branch) => branch.name === 'origin/feature/stock-reservations')!.tipHash).toBe('9f3a1c2')
  })

  it('publishes a branch origin doesn’t have', async () => {
    const repositories = structuredClone(sampleRepositories)
    repositories[0]!.remoteBranches = repositories[0]!.remoteBranches.filter((branch) => branch.name !== 'origin/main')
    const withoutOriginMain = new MockGitDataSource(repositories)
    expect(await withoutOriginMain.push('inventory', 'main')).toEqual({ message: 'Published main to origin; it now tracks origin/main' })
    expect((await withoutOriginMain.getBranches('inventory')).remote.map((branch) => branch.name)).toContain('origin/main')
  })

  it('pulls nothing new from the sample remote', async () => {
    expect(await new MockGitDataSource().pull('inventory', 'feature/stock-reservations')).toEqual({
      message: 'Already up to date with origin/feature/stock-reservations',
    })
  })

  it('never changes the sample data', async () => {
    const lastFetch = sampleRepositories[0]!.lastFetch
    await new MockGitDataSource().push('inventory', 'feature/stock-reservations')
    await new MockGitDataSource().fetch('inventory')
    expect(sampleRepositories[0]!.localBranches[0]).toMatchObject({ name: 'feature/stock-reservations', ahead: 2 })
    expect(sampleRepositories[0]!.commits[0]!.refs).toEqual(['feature/stock-reservations'])
    expect(sampleRepositories[0]!.lastFetch).toBe(lastFetch)
  })
})
