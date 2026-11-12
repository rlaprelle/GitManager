// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { describeGitDataSourceContract } from '../../../../src/services/__tests__/gitDataSourceContract'
import { GitCliDataSource, type StoredRepository } from '../GitCliDataSource'
import { type Fixtures, createFixtures, fixtureGit, removeFixtures } from './fixtures'

// Every call starts a git process; on Windows that adds up across the contract's loops.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let fixtures: Fixtures

beforeAll(async () => {
  fixtures = await createFixtures()
})

afterAll(async () => {
  if (fixtures) await removeFixtures(fixtures)
})

function sourceFor(...repositories: StoredRepository[]): GitCliDataSource {
  return new GitCliDataSource({ list: async () => repositories })
}

const allFixtures = (): StoredRepository[] => [
  { id: 'sample', path: fixtures.sample },
  { id: 'empty', path: fixtures.empty },
  { id: 'detached', path: fixtures.detached },
]

describeGitDataSourceContract('GitCliDataSource', async () => ({
  source: sourceFor(...allFixtures()),
  comparePaths: { left: 'config/left.yml', right: 'config/right.yml' },
}))

describe('GitCliDataSource reading the fixture repositories', () => {
  const sample = () => sourceFor(...allFixtures())
  const hashOf = async (revision: string) => (await fixtureGit(fixtures.sample, 'rev-parse', revision)).trim()

  it('summarizes each repository: folder name, branch, uncommitted changes and last fetch', async () => {
    const [main, empty, detached] = await sample().listRepositories()
    expect(main).toMatchObject({ id: 'sample', name: 'sample', path: fixtures.sample, currentBranch: 'main', changedFileCount: 1 })
    expect(Date.parse(main!.lastFetch!)).not.toBeNaN()
    expect(empty).toMatchObject({ name: 'empty', currentBranch: 'main', changedFileCount: 0, lastFetch: null })
    expect(detached!.currentBranch).toBeNull()
  })

  it('lists branches with ahead/behind against the upstream, and remote branches without origin/HEAD', async () => {
    const { local, remote } = await sample().getBranches('sample')
    expect(local).toEqual([
      { name: 'feature/search', ahead: 0, behind: 0, tipHash: await hashOf('feature/search') },
      { name: 'main', ahead: 1, behind: 0, tipHash: await hashOf('main') },
    ])
    expect(remote.map((branch) => branch.name)).toEqual(['origin/feature/search', 'origin/main'])
  })

  it('returns full hashes, ISO dates and branch labels, newest first', async () => {
    const { commits, hasMore } = await sample().getHistory('sample', 200)
    expect(commits.map((commit) => commit.message)).toEqual([
      'Describe the sample',
      "Merge branch 'feature/search'",
      'Remove notes, add logo',
      'Add search',
      'Configure port and timeout',
      'Initial commit',
    ])
    expect(hasMore).toBe(false)
    expect(commits[0]).toMatchObject({ hash: await hashOf('main'), author: 'Ada Lovelace', refs: ['main'] })
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(commits[1]!.refs).toEqual(['origin/main'])
    expect(commits[3]!.refs).toEqual(['feature/search', 'origin/feature/search'])
  })

  it('lays the merged branch out in its own lane and joins it at the merge', async () => {
    const { commits } = await sample().getHistory('sample', 200)
    expect(commits.map((commit) => commit.graph.lane)).toEqual([0, 0, 0, 1, 0, 0])
    expect(commits[1]!.graph.curvesOut).toEqual([1])
  })

  it('caps the page and says there is more', async () => {
    const page = await sample().getHistory('sample', 2)
    expect(page.commits).toHaveLength(2)
    expect(page.hasMore).toBe(true)
  })

  it('has no history yet in a new repository', async () => {
    expect(await sample().getHistory('empty', 200)).toEqual({ commits: [], hasMore: false })
  })

  it('shows the commits around a detached HEAD', async () => {
    const { commits } = await sample().getHistory('detached', 200)
    expect(commits.map((commit) => commit.message)).toEqual(['Second', 'First'])
  })

  it('shows what a merge brought into its first parent', async () => {
    const files = await sample().getCommitFiles('sample', await hashOf('main~1'))
    expect(files).toEqual([{ path: 'src/search.ts', status: 'A' }])
  })

  it('lists added, deleted, binary and accented paths with their status', async () => {
    const source = sample()
    expect(await source.getCommitFiles('sample', await hashOf('main~2'))).toEqual([
      { path: 'logo.png', status: 'A' },
      { path: 'no-newline.txt', status: 'A' },
      { path: 'notes.txt', status: 'D' },
    ])
    expect(await source.getCommitFiles('sample', await hashOf('main~2^'))).toContainEqual({
      path: 'docs/read me é.md',
      status: 'A',
    })
  })

  it('lists every file of the root commit as added', async () => {
    const files = await sample().getCommitFiles('sample', await hashOf('main~4'))
    expect(files.every((file) => file.status === 'A')).toBe(true)
    expect(files.map((file) => file.path)).toContain('README.md')
  })

  it('diffs a modified file with git’s hunk header numbers', async () => {
    const hunks = await sample().getFileDiff('sample', await hashOf('main^{/Configure}'), 'app.yml')
    expect(hunks).toEqual([
      {
        oldStart: 1,
        newStart: 1,
        context: '',
        lines: ['-port: 8080', '+port: 9090', ' host: localhost', ' debug: false', '+timeout: 30s'],
      },
    ])
  })

  it('has no hunks for a binary file, and keeps the no-newline note', async () => {
    const source = sample()
    const commit = await hashOf('main~2')
    expect(await source.getFileDiff('sample', commit, 'logo.png')).toEqual([])
    expect((await source.getFileDiff('sample', commit, 'no-newline.txt'))[0]!.lines).toEqual([
      '+last line',
      '\\ No newline at end of file',
    ])
  })

  it('diffs a path with a space and an accent', async () => {
    const hunks = await sample().getFileDiff('sample', await hashOf('main~2^'), 'docs/read me é.md')
    expect(hunks[0]!.lines).toEqual(['+Accented and spaced'])
  })

  it('compares two files in the working tree', async () => {
    const hunks = await sample().compareFiles('sample', 'config/left.yml', 'config/right.yml')
    expect(hunks.flatMap((hunk) => hunk.lines)).toEqual([
      '-  name: left',
      '+  name: right',
      '   size: 1',
      '-  mode: fast',
      '+  mode: slow',
    ])
  })

  it('refuses arguments that could reach git as options or leave the repository', async () => {
    const source = sample()
    await expect(source.getCommitFiles('sample', '--output=C:/evil.txt')).rejects.toThrow('Not a commit hash')
    await expect(source.compareFiles('sample', '../outside.txt', 'config/left.yml')).rejects.toThrow('outside the repository')
    await expect(source.compareFiles('sample', 'C:/Windows/win.ini', 'config/left.yml')).rejects.toThrow('outside the repository')
  })

  it('says which folder is missing when a repository was moved or deleted', async () => {
    const source = sourceFor({ id: 'gone', path: `${fixtures.root}/no-such-folder` })
    await expect(source.getBranches('gone')).rejects.toThrow('Folder not found')
  })

  it('reports that write operations are not available yet', async () => {
    await expect(sample().fetch()).rejects.toThrow("Fetch isn't available in this version yet")
  })
})
