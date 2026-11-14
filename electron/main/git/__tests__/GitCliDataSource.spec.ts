// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { describeGitDataSourceContract } from '../../../../src/services/__tests__/gitDataSourceContract'
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { GitCliDataSource, type RepositoryCatalog, type StoredRepository } from '../GitCliDataSource'
import {
  type Fixtures,
  commitInFixture,
  createFixtures,
  cloneOriginInFixture,
  createRepositoryWithRemote,
  createScratchRepository,
  fixtureGit,
  gitInFixture,
  originOf,
  removeFixtures,
  renameInFixture,
} from './fixtures'

// Every call starts a git process; on Windows that adds up across the contract's loops.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let fixtures: Fixtures
/** A repository whose last two commits are a pure rename and a rename with an edit. */
let renamed: string

const NOTES = Array.from({ length: 10 }, (_, i) => `note ${i + 1}`)

beforeAll(async () => {
  fixtures = await createFixtures()
  // The app runs git with the user's own config; tests use an empty one so the developer's
  // settings (hooks, aliases, checkout defaults) can't change what they see.
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(fixtures.root, 'empty.gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  renamed = await createScratchRepository(fixtures, 'renamed')
  await commitInFixture(fixtures, renamed, 'GUIDE.md', '# Guide\n\nHow to use it.\n', 'Write the guide')
  await commitInFixture(fixtures, renamed, 'notes.txt', NOTES.join('\n') + '\n', 'Take notes')
  await renameInFixture(fixtures, renamed, 'GUIDE.md', 'docs/guide.md', 'Move the guide into docs')
  const edited = NOTES.map((line, i) => (i === 4 ? 'note five, edited' : line))
  await renameInFixture(fixtures, renamed, 'notes.txt', 'docs/notes.md', 'Rename and edit the notes', edited.join('\n') + '\n')
})

afterAll(async () => {
  vi.unstubAllEnvs()
  if (fixtures) await removeFixtures(fixtures)
})

let checkoutRepositories = 0

/** A fresh repository with a remote (see createRepositoryWithRemote), for a test that changes it. */
async function checkoutRepository(): Promise<{ source: GitCliDataSource; folder: string; name: string }> {
  const name = `checkout-${++checkoutRepositories}`
  const folder = await createRepositoryWithRemote(fixtures, name)
  return { source: sourceFor({ id: 'repo', path: folder }), folder, name }
}

/** The repository list in memory, behaving like RepositoryStore (which has its own tests). */
function memoryCatalog(initial: StoredRepository[]): RepositoryCatalog {
  let repositories = [...initial]
  return {
    list: async () => repositories,
    add: async (path) => {
      const existing = repositories.find((repo) => repo.path.toLowerCase() === path.toLowerCase())
      if (existing) return existing
      const added = { id: `added-${repositories.length}`, path }
      repositories = [...repositories, added]
      return added
    },
    remove: async (id) => {
      repositories = repositories.filter((repo) => repo.id !== id)
    },
  }
}

/** A source over these repositories; `chosenFolder` is what the folder picker answers (null = cancelled). */
function sourceFor(...repositories: StoredRepository[]): GitCliDataSource {
  return choosing(null, ...repositories)
}

function choosing(chosenFolder: string | null, ...repositories: StoredRepository[]): GitCliDataSource {
  return new GitCliDataSource(memoryCatalog(repositories), async () => chosenFolder)
}

const allFixtures = (): StoredRepository[] => [
  { id: 'sample', path: fixtures.sample },
  { id: 'empty', path: fixtures.empty },
  { id: 'detached', path: fixtures.detached },
  { id: 'renamed', path: renamed },
]

describeGitDataSourceContract(
  'GitCliDataSource',
  async () => ({
    source: sourceFor(...allFixtures()),
    comparePaths: { left: 'config/left.yml', right: 'config/right.yml' },
  }),
  async () => {
    const { source } = await checkoutRepository()
    return { source, repoId: 'repo', otherLocal: 'feature/local', remoteOnly: 'origin/feature/remote' }
  },
)

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

  it('still lists a repository whose folder is gone, with the problem, instead of failing the whole list', async () => {
    const source = sourceFor({ id: 'sample', path: fixtures.sample }, { id: 'gone', path: join(fixtures.root, 'gone') })
    const [readable, gone] = await source.listRepositories()
    expect(readable!.problem).toBeNull()
    expect(gone).toEqual({
      id: 'gone',
      name: 'gone',
      path: join(fixtures.root, 'gone'),
      currentBranch: null,
      changedFileCount: 0,
      lastFetch: null,
      problem: 'Folder not found',
    })
  })
})

describe('GitCliDataSource checking out branches', () => {
  const headOf = async (folder: string) => (await fixtureGit(folder, 'symbolic-ref', '--short', 'HEAD')).trim()

  it('switches, and says how many uncommitted changes came along', async () => {
    const { source, folder } = await checkoutRepository()
    await writeFile(join(folder, 'README.md'), 'edited, not committed\n')
    await writeFile(join(folder, 'scratch.txt'), 'untracked\n')
    const result = await source.checkout('repo', { local: 'feature/local' })
    expect(result).toEqual({
      kind: 'switched',
      branch: 'feature/local',
      message: 'Switched to feature/local; 2 uncommitted changes came along',
    })
    expect(await headOf(folder)).toBe('feature/local')
  })

  it('makes a remote branch’s local branch track it', async () => {
    const { source, folder } = await checkoutRepository()
    const result = await source.checkout('repo', { remote: 'origin/feature/remote' })
    expect(result).toEqual({
      kind: 'switched',
      branch: 'feature/remote',
      message: 'Switched to a new branch feature/remote, tracking origin/feature/remote',
    })
    expect((await fixtureGit(folder, 'rev-parse', '--abbrev-ref', 'feature/remote@{upstream}')).trim()).toBe('origin/feature/remote')
  })

  it('refuses, naming the files, when changes would be overwritten', async () => {
    const { source, folder } = await checkoutRepository()
    await commitInFixture(fixtures, folder, 'shared.txt', 'on main\n', 'Add shared on main')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', 'feature/local')
    await commitInFixture(fixtures, folder, 'shared.txt', 'on feature\n', 'Add shared on feature')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', 'main')
    await writeFile(join(folder, 'shared.txt'), 'edited\n')

    await expect(source.checkout('repo', { local: 'feature/local' })).rejects.toThrow(
      'your changes to shared.txt would be overwritten by switching to feature/local. Commit or stash them first.',
    )
    expect(await headOf(folder)).toBe('main')
  })

  it('refuses, naming the file, when an untracked file would be overwritten', async () => {
    const { source, folder } = await checkoutRepository()
    await writeFile(join(folder, 'local.txt'), 'mine\n')
    await expect(source.checkout('repo', { local: 'feature/local' })).rejects.toThrow(
      'untracked file local.txt would be overwritten by switching to feature/local. Move or remove it first.',
    )
    expect(await headOf(folder)).toBe('main')
  })

  it('asks before leaving commits that no branch contains, and switches once told to', async () => {
    const { source, folder } = await checkoutRepository()
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '--detach', 'main')
    await commitInFixture(fixtures, folder, 'a.txt', 'a\n', 'Detached one')
    await commitInFixture(fixtures, folder, 'b.txt', 'b\n', 'Detached two')
    const detachedHead = (await fixtureGit(folder, 'rev-parse', 'HEAD')).trim()

    expect(await source.checkout('repo', { local: 'main' })).toEqual({ kind: 'confirm', commitsLeft: 2 })
    expect((await fixtureGit(folder, 'rev-parse', 'HEAD')).trim()).toBe(detachedHead)

    const result = await source.checkout('repo', { local: 'main' }, { leaveCommits: true })
    expect(result).toMatchObject({ kind: 'switched', branch: 'main' })
    expect(await headOf(folder)).toBe('main')
  })

  it('switches from a detached HEAD without asking when a branch has its commits', async () => {
    const { source, folder } = await checkoutRepository()
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '--detach', 'feature/local')
    expect(await source.checkout('repo', { local: 'main' })).toMatchObject({ kind: 'switched', branch: 'main' })
  })

  it('passes on git’s refusal to check out a branch another worktree has', async () => {
    const { source, folder } = await checkoutRepository()
    await gitInFixture(fixtures, folder, 'worktree', 'add', '--quiet', `${folder}-worktree`, 'feature/local')
    await expect(source.checkout('repo', { local: 'feature/local' })).rejects.toThrow(/feature\/local' is already (used|checked out)/)
    expect(await headOf(folder)).toBe('main')
  })
})

describe('GitCliDataSource and renamed files', () => {
  const source = () => sourceFor({ id: 'renamed', path: renamed })
  const hashOf = async (revision: string) => (await fixtureGit(renamed, 'rev-parse', revision)).trim()

  it('lists a moved file once, as R with the path it came from, and no change inside it', async () => {
    const moved = await hashOf('HEAD~1')
    expect(await source().getCommitFiles('renamed', moved)).toEqual([{ path: 'docs/guide.md', status: 'R', oldPath: 'GUIDE.md' }])
    expect(await source().getFileDiff('renamed', moved, 'docs/guide.md')).toEqual([])
  })

  it('diffs a renamed and edited file against its old self, not as a whole new file', async () => {
    const edited = await hashOf('HEAD')
    expect(await source().getCommitFiles('renamed', edited)).toEqual([{ path: 'docs/notes.md', status: 'R', oldPath: 'notes.txt' }])
    const hunks = await source().getFileDiff('renamed', edited, 'docs/notes.md')
    expect(hunks.flatMap((hunk) => hunk.lines).filter((line) => line[0] !== ' ')).toEqual(['-note 5', '+note five, edited'])
  })
})

describe('GitCliDataSource adding repositories', () => {
  it('adds the repository a chosen folder is in, by its top folder', async () => {
    const result = await choosing(join(fixtures.sample, 'config')).addRepository()
    expect(result.message).toBe('Added sample')
    expect(result.repository).toMatchObject({ name: 'sample', path: fixtures.sample, currentBranch: 'main', problem: null })
  })

  it('returns the listed repository when its folder is added again', async () => {
    const source = choosing(fixtures.sample, { id: 'sample', path: fixtures.sample })
    const result = await source.addRepository()
    expect(result.message).toBe('sample is already in the list')
    expect(result.repository?.id).toBe('sample')
    expect(await source.listRepositories()).toHaveLength(1)
  })

  it('adds nothing, and says nothing, when the user cancels the folder picker', async () => {
    expect(await choosing(null).addRepository()).toEqual({ repository: null, message: '' })
  })

  it('refuses a folder that isn’t inside a git repository', async () => {
    const plainFolder = join(fixtures.root, 'not-a-repository')
    await mkdir(plainFolder, { recursive: true })
    await expect(choosing(plainFolder).addRepository()).rejects.toThrow(`${plainFolder} isn’t inside a git repository`)
  })
})

describe('GitCliDataSource talking to a remote', () => {
  const tipOf = async (folder: string, ref: string) => (await fixtureGit(folder, 'rev-parse', ref)).trim()
  const branchesOf = (source: GitCliDataSource) => source.getBranches('repo')

  /** A repository with a remote, and a colleague's clone of the same origin. */
  async function withColleague() {
    const repository = await checkoutRepository()
    return { ...repository, colleague: await cloneOriginInFixture(fixtures, repository.name) }
  }

  it('fetches every remote: new commits and branches come in, deleted branches go', async () => {
    const { source, colleague } = await withColleague()
    await commitInFixture(fixtures, colleague, 'colleague.txt', 'hi\n', 'Colleague’s work')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main:refs/heads/feature/new')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', '--delete', 'feature/remote')

    expect(await source.fetch('repo')).toEqual({ message: 'Fetched: 1 branch updated, 1 new, 1 removed' })
    const { local, remote } = await branchesOf(source)
    expect(remote.map((branch) => branch.name).sort()).toEqual(['origin/feature/local', 'origin/feature/new', 'origin/main'])
    expect(local.find((branch) => branch.name === 'main')).toMatchObject({ ahead: 0, behind: 1 })
    expect(await source.fetch('repo')).toEqual({ message: 'Fetched: everything was up to date' })
  })

  it('records the fetch as the repository’s last fetch', async () => {
    const { source, folder } = await checkoutRepository()
    await rm(join(folder, '.git', 'FETCH_HEAD'))
    expect((await source.listRepositories())[0]!.lastFetch).toBeNull()
    await source.fetch('repo')
    expect((await source.listRepositories())[0]!.lastFetch).not.toBeNull()
  })

  it('keeps the last fetch time, and what that fetch brought, when a fetch fails', async () => {
    const { source, folder } = await checkoutRepository()
    const fetchHead = join(folder, '.git', 'FETCH_HEAD')
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
    await utimes(fetchHead, yesterday, yesterday)
    const fetched = await readFile(fetchHead, 'utf8')
    await gitInFixture(fixtures, folder, 'remote', 'set-url', 'origin', join(fixtures.root, 'no-such-origin.git'))

    await expect(source.fetch('repo')).rejects.toThrow()
    await expect(source.pull('repo', 'main')).rejects.toThrow()
    expect((await source.listRepositories())[0]!.lastFetch).toBe(yesterday.toISOString())
    expect(await readFile(fetchHead, 'utf8')).toBe(fetched)
  })

  it('counts a fetch that reached some remotes, and says which failed', async () => {
    const { source, folder } = await checkoutRepository()
    const fetchHead = join(folder, '.git', 'FETCH_HEAD')
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
    await utimes(fetchHead, yesterday, yesterday)
    await gitInFixture(fixtures, folder, 'remote', 'add', 'broken', join(fixtures.root, 'no-such-origin.git'))

    await expect(source.fetch('repo')).rejects.toThrow()
    const { lastFetch } = (await source.listRepositories())[0]!
    expect(Date.parse(lastFetch!)).toBeGreaterThan(yesterday.getTime() + 3600 * 1000)
  })

  it('still has never fetched after a first fetch fails', async () => {
    const { source, folder } = await checkoutRepository()
    await rm(join(folder, '.git', 'FETCH_HEAD'))
    await gitInFixture(fixtures, folder, 'remote', 'set-url', 'origin', join(fixtures.root, 'no-such-origin.git'))
    await expect(source.fetch('repo')).rejects.toThrow()
    expect((await source.listRepositories())[0]!.lastFetch).toBeNull()
  })

  it('says when there is no remote to fetch from', async () => {
    const folder = await createScratchRepository(fixtures, 'no-remote')
    await expect(sourceFor({ id: 'repo', path: folder }).fetch('repo')).rejects.toThrow(
      'this repository has no remote to fetch from',
    )
  })

  it('pulls by fast-forwarding the checked-out branch to what the remote has now', async () => {
    const { source, folder, colleague } = await withColleague()
    await commitInFixture(fixtures, colleague, 'one.txt', '1\n', 'One')
    await commitInFixture(fixtures, colleague, 'two.txt', '2\n', 'Two')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main')

    expect(await source.pull('repo', 'main')).toEqual({ message: 'Pulled 2 commits from origin/main' })
    expect(await tipOf(folder, 'main')).toBe(await tipOf(colleague, 'main'))
    expect(await source.pull('repo', 'main')).toEqual({ message: 'Already up to date with origin/main' })
  })

  it('refuses to pull when both sides have new commits, and leaves the branch where it was', async () => {
    const { source, folder, colleague } = await withColleague()
    await commitInFixture(fixtures, colleague, 'theirs.txt', 'theirs\n', 'Theirs')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main')
    await commitInFixture(fixtures, folder, 'mine.txt', 'mine\n', 'Mine')
    const before = await tipOf(folder, 'main')

    await expect(source.pull('repo', 'main')).rejects.toThrow(
      'can’t fast-forward: main and origin/main both have new commits. Merge or rebase them in a terminal.',
    )
    expect(await tipOf(folder, 'main')).toBe(before)
    // What was fetched stays fetched, so the branch list can show it.
    expect(await tipOf(folder, 'origin/main')).toBe(await tipOf(colleague, 'main'))
  })

  it('refuses to pull, naming the file, when it would overwrite uncommitted changes', async () => {
    const { source, folder, colleague } = await withColleague()
    await commitInFixture(fixtures, colleague, 'README.md', '# Changed upstream\n', 'Edit the readme')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main')
    await writeFile(join(folder, 'README.md'), 'edited here, not committed\n')

    await expect(source.pull('repo', 'main')).rejects.toThrow(
      'your changes to README.md would be overwritten by pulling origin/main. Commit or stash them first.',
    )
  })

  it('pulls only into a branch with an upstream', async () => {
    const { source } = await checkoutRepository()
    await source.checkout('repo', { local: 'feature/local' })
    await expect(source.pull('repo', 'feature/local')).rejects.toThrow('feature/local has no upstream branch to pull from')
  })

  it('pushes the branch’s new commits to its upstream', async () => {
    const { source, folder, name } = await checkoutRepository()
    await commitInFixture(fixtures, folder, 'a.txt', 'a\n', 'A')
    await commitInFixture(fixtures, folder, 'b.txt', 'b\n', 'B')

    expect(await source.push('repo', 'main')).toEqual({ message: 'Pushed 2 commits to origin/main' })
    expect(await tipOf(originOf(fixtures, name), 'main')).toBe(await tipOf(folder, 'main'))
    expect((await branchesOf(source)).local.find((branch) => branch.name === 'main')).toMatchObject({ ahead: 0 })
    expect(await source.push('repo', 'main')).toEqual({ message: 'Nothing to push; origin/main is up to date' })
  })

  it('trusts the remote, not an out-of-date remote branch here, about whether there was anything to push', async () => {
    const { source, folder, name } = await checkoutRepository()
    await commitInFixture(fixtures, folder, 'a.txt', 'a\n', 'A')
    // Pushed by path, not by remote name, so origin/main here doesn't move.
    await gitInFixture(fixtures, folder, 'push', '--quiet', originOf(fixtures, name), 'main:main')
    expect((await branchesOf(source)).local.find((branch) => branch.name === 'main')).toMatchObject({ ahead: 1 })

    expect(await source.push('repo', 'main')).toEqual({ message: 'Nothing to push; origin/main is up to date' })
  })

  it('pushes to the upstream it tracks, even under another name', async () => {
    const { source, folder, name } = await checkoutRepository()
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '-c', 'mine', '--track', 'origin/feature/remote')
    await commitInFixture(fixtures, folder, 'mine.txt', 'mine\n', 'Mine')

    expect(await source.push('repo', 'mine')).toEqual({ message: 'Pushed 1 commit to origin/feature/remote' })
    expect(await tipOf(originOf(fixtures, name), 'feature/remote')).toBe(await tipOf(folder, 'mine'))
    await expect(fixtureGit(originOf(fixtures, name), 'rev-parse', '--verify', '--quiet', 'refs/heads/mine')).rejects.toThrow()
  })

  it('refuses a push the remote is ahead of, and changes nothing there', async () => {
    const { source, folder, name, colleague } = await withColleague()
    await commitInFixture(fixtures, colleague, 'theirs.txt', 'theirs\n', 'Theirs')
    await gitInFixture(fixtures, colleague, 'push', '--quiet', 'origin', 'main')
    await commitInFixture(fixtures, folder, 'mine.txt', 'mine\n', 'Mine')

    await expect(source.push('repo', 'main')).rejects.toThrow(
      'origin/main has commits that main doesn’t have. Pull them first, then push again.',
    )
    expect(await tipOf(originOf(fixtures, name), 'main')).toBe(await tipOf(colleague, 'main'))
  })

  it('passes on the remote’s reason when a hook there refuses the push', async () => {
    const { source, folder, name } = await checkoutRepository()
    await writeFile(join(originOf(fixtures, name), 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n')
    await commitInFixture(fixtures, folder, 'mine.txt', 'mine\n', 'Mine')
    await expect(source.push('repo', 'main')).rejects.toThrow('the remote refused the push: pre-receive hook declined')
  })

  it('publishes a branch that tracks nothing yet, and it tracks origin from then on', async () => {
    const { source, folder, name } = await checkoutRepository()
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '-c', 'feature/fresh')
    await commitInFixture(fixtures, folder, 'fresh.txt', 'fresh\n', 'Fresh work')
    expect(await source.push('repo', 'feature/fresh')).toEqual({
      message: 'Published feature/fresh to origin; it now tracks origin/feature/fresh',
    })
    expect(await tipOf(originOf(fixtures, name), 'feature/fresh')).toBe(await tipOf(folder, 'feature/fresh'))
    expect((await fixtureGit(folder, 'rev-parse', '--abbrev-ref', 'feature/fresh@{upstream}')).trim()).toBe('origin/feature/fresh')
  })

  it('lets ssh ask for sign-in during fetch, pull and push, and nothing else', async () => {
    const { source, folder } = await checkoutRepository()
    // A stand-in ssh that records what it was started with, then fails as an unreachable server would.
    const record = join(folder, '..', `${basename(folder)}-ssh.log`).replaceAll('\\', '/')
    const fakeSsh = join(folder, '..', `${basename(folder)}-ssh.sh`).replaceAll('\\', '/')
    await writeFile(fakeSsh, `#!/bin/sh\necho "require=$SSH_ASKPASS_REQUIRE gcm=$GCM_INTERACTIVE" >> '${record}'\nexit 255\n`)
    await gitInFixture(fixtures, folder, 'config', 'core.sshCommand', `sh '${fakeSsh}'`)
    await gitInFixture(fixtures, folder, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git')
    await commitInFixture(fixtures, folder, 'a.txt', 'a\n', 'A')

    const sshStarts = async () => (await readFile(record, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
    // Git may start ssh more than once per command; each operation must start it at least once.
    let started = 0
    for (const operation of [() => source.fetch('repo'), () => source.pull('repo', 'main'), () => source.push('repo', 'main')]) {
      await expect(operation()).rejects.toThrow()
      expect((await sshStarts()).length).toBeGreaterThan(started)
      started = (await sshStarts()).length
    }
    await source.getBranches('repo')
    expect(await sshStarts()).toEqual(Array(started).fill('require=force gcm='))
  })

  it('says when there is no remote to publish to', async () => {
    const folder = await createScratchRepository(fixtures, 'nowhere-to-push')
    await expect(sourceFor({ id: 'repo', path: folder }).push('repo', 'main')).rejects.toThrow(
      'this repository has no remote to push to',
    )
  })
})
