// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GitCliDataSource } from '../GitCliDataSource'
import { parseMergeTree } from '../merge'
import {
  type Fixtures,
  MERGE_TEXT,
  commitInFixture,
  createFixtures,
  createMergeRepository,
  createRepositoryWithRemote,
  createScratchRepository,
  fixtureGit,
  gitInFixture,
  removeFixtures,
} from './fixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let fixtures: Fixtures

beforeAll(async () => {
  fixtures = await createFixtures()
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(fixtures.root, 'empty.gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})

afterAll(async () => {
  vi.unstubAllEnvs()
  if (fixtures) await removeFixtures(fixtures)
})

let repositories = 0

/** A source whose only repository, 'repo', is `folder`. */
function sourceOver(folder: string): GitCliDataSource {
  const stored = { id: 'repo', path: folder }
  return new GitCliDataSource(
    { list: async () => [stored], add: async () => ({ repository: stored, added: false }), remove: async () => {} },
    async () => null,
  )
}

/** A fresh merge repository (see createMergeRepository) and a source over it. */
async function mergeRepository() {
  const folder = await createMergeRepository(fixtures, `merge-${++repositories}`)
  return { folder, source: sourceOver(folder) }
}

const git = (folder: string, ...args: string[]) => fixtureGit(folder, ...args).then((out) => out.trim())

/** What a test checks hasn't moved: the branch, the index and the working tree. */
async function snapshot(folder: string) {
  return {
    head: await git(folder, 'rev-parse', 'HEAD'),
    status: await git(folder, 'status', '--porcelain=v1'),
    session: await readFile(join(folder, 'session.ts'), 'utf8'),
  }
}

describe('GitCliDataSource working out a merge', () => {
  it('finds a content conflict without writing anything: no file, index or branch changes', async () => {
    const { folder, source } = await mergeRepository()
    const before = await snapshot(folder)
    const preview = await source.previewMerge('repo', 'feature/login')
    expect(preview).toMatchObject({
      branch: 'feature/login',
      into: 'main',
      commits: 1,
      outcome: 'merge-commit',
      conflicts: ['session.ts'],
      unresolvable: [],
      blockedBy: [],
    })
    expect(preview.ours).toBe(before.head)
    expect(preview.theirs).toBe(await git(folder, 'rev-parse', 'feature/login'))
    expect(await snapshot(folder)).toEqual(before)
  })

  it('gives each conflicted file’s base, ours and theirs as text', async () => {
    const { source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/login')
    expect(await source.getMergeConflicts('repo', preview)).toEqual([
      { path: 'session.ts', base: MERGE_TEXT.base, ours: MERGE_TEXT.main, theirs: MERGE_TEXT.feature },
    ])
  })

  it('sees a fast-forward when the checked-out branch has nothing of its own', async () => {
    const { source } = await mergeRepository()
    expect(await source.previewMerge('repo', 'feature/ahead')).toMatchObject({ outcome: 'fast-forward', commits: 1, conflicts: [] })
  })

  it('sees a clean merge commit when both sides moved on without clashing', async () => {
    const { source } = await mergeRepository()
    expect(await source.previewMerge('repo', 'feature/apart')).toMatchObject({ outcome: 'merge-commit', conflicts: [], unresolvable: [] })
  })

  it('follows merge.ff: false always makes a merge commit, only refuses one', async () => {
    const { folder, source } = await mergeRepository()
    await gitInFixture(fixtures, folder, 'config', 'merge.ff', 'false')
    expect((await source.previewMerge('repo', 'feature/ahead')).outcome).toBe('merge-commit')
    await gitInFixture(fixtures, folder, 'config', 'merge.ff', 'only')
    expect((await source.previewMerge('repo', 'feature/ahead')).outcome).toBe('fast-forward')
    expect((await source.previewMerge('repo', 'feature/apart')).outcome).toBe('fast-forward-only')
  })

  it('is up to date with a branch whose commits it already has', async () => {
    const { source } = await mergeRepository()
    expect(await source.previewMerge('repo', 'feature/old')).toMatchObject({ outcome: 'up-to-date', commits: 0 })
  })

  it('leaves a file deleted on one side and changed on the other to a terminal', async () => {
    const { source } = await mergeRepository()
    expect(await source.previewMerge('repo', 'feature/kept')).toMatchObject({ conflicts: [], unresolvable: ['gone.txt'] })
  })

  it('names uncommitted changes the merge would overwrite, and only those', async () => {
    const { folder, source } = await mergeRepository()
    await writeFile(join(folder, 'session.ts'), 'edited, not committed\n')
    await writeFile(join(folder, 'README.md'), 'edited too, but the merge doesn’t touch it\n')
    await writeFile(join(folder, 'login.ts'), 'untracked, and the merge adds this file\n')
    const preview = await source.previewMerge('repo', 'feature/login')
    expect(preview.blockedBy.sort()).toEqual(['login.ts', 'session.ts'])
  })

  it('refuses the checked-out branch, a branch it doesn’t have, and a detached HEAD', async () => {
    const { folder, source } = await mergeRepository()
    await expect(source.previewMerge('repo', 'main')).rejects.toThrow(/the branch you’re on/)
    await expect(source.previewMerge('repo', '--help')).rejects.toThrow('Unknown branch: --help')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '--detach', 'HEAD')
    await expect(source.previewMerge('repo', 'feature/login')).rejects.toThrow(/no branch is checked out/)
  })

  it('refuses while a merge started in a terminal is unfinished', async () => {
    const { folder, source } = await mergeRepository()
    await gitInFixture(fixtures, folder, 'merge', '--quiet', 'feature/login').catch(() => {})
    await expect(source.previewMerge('repo', 'feature/apart')).rejects.toThrow(/already in progress/)
  })
})

describe('GitCliDataSource noticing what was left unfinished', () => {
  const failing = (work: Promise<unknown>) => work.catch(() => {})

  it('finds nothing in an ordinary repository, uncommitted changes included', async () => {
    const { folder, source } = await mergeRepository()
    await writeFile(join(folder, 'session.ts'), 'edited\n')
    expect(await source.getUnfinishedOperation('repo')).toBeNull()
  })

  it('finds a merge stopped on conflicts, until it is aborted', async () => {
    const { folder, source } = await mergeRepository()
    await failing(gitInFixture(fixtures, folder, 'merge', '--quiet', 'feature/login'))
    expect(await source.getUnfinishedOperation('repo')).toBe('merge')
    await gitInFixture(fixtures, folder, 'merge', '--abort')
    expect(await source.getUnfinishedOperation('repo')).toBeNull()
  })

  it('finds a rebase', async () => {
    const { folder, source } = await mergeRepository()
    await failing(gitInFixture(fixtures, folder, 'rebase', '--quiet', 'feature/login'))
    expect(await source.getUnfinishedOperation('repo')).toBe('rebase')
  })

  it('finds a cherry-pick and a revert', async () => {
    const picking = await mergeRepository()
    await failing(gitInFixture(fixtures, picking.folder, 'cherry-pick', 'feature/login'))
    expect(await picking.source.getUnfinishedOperation('repo')).toBe('cherry-pick')

    const reverting = await mergeRepository()
    await commitInFixture(fixtures, reverting.folder, 'session.ts', 'changed again\n', 'Change it again')
    await failing(gitInFixture(fixtures, reverting.folder, 'revert', '--no-edit', 'HEAD~1'))
    expect(await reverting.source.getUnfinishedOperation('repo')).toBe('revert')
  })

  it('finds conflicts a stash left behind', async () => {
    const { folder, source } = await mergeRepository()
    await writeFile(join(folder, 'session.ts'), 'stashed work\n')
    await gitInFixture(fixtures, folder, 'stash', '--quiet')
    await commitInFixture(fixtures, folder, 'session.ts', 'committed meanwhile\n', 'Commit meanwhile')
    await failing(gitInFixture(fixtures, folder, 'stash', 'pop', '--quiet'))
    expect(await source.getUnfinishedOperation('repo')).toBe('conflicts')
  })
})

describe('GitCliDataSource merging', () => {
  it('commits the resolved merge with both parents and git’s message, then moves main there', async () => {
    const { folder, source } = await mergeRepository()
    await writeFile(join(folder, 'notes.txt'), 'untracked and unrelated: must survive\n')
    const preview = await source.previewMerge('repo', 'feature/login')
    const resolved = 'resolved by hand\n'
    const { message } = await source.merge('repo', preview, [{ path: 'session.ts', text: resolved }])

    expect(message).toBe('Merged feature/login into main (1 commit)')
    expect(await git(folder, 'log', '-1', '--format=%P')).toBe(`${preview.ours} ${preview.theirs}`)
    expect(await git(folder, 'log', '-1', '--format=%s')).toBe("Merge branch 'feature/login'")
    expect(await readFile(join(folder, 'session.ts'), 'utf8')).toBe(resolved)
    expect(await readFile(join(folder, 'login.ts'), 'utf8')).toBe('export const login = () => true\n')
    expect(await readFile(join(folder, 'notes.txt'), 'utf8')).toBe('untracked and unrelated: must survive\n')
    expect(await git(folder, 'status', '--porcelain=v1')).toBe('?? notes.txt')
  })

  it('fast-forwards without a merge commit', async () => {
    const { folder, source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/ahead')
    expect((await source.merge('repo', preview, [])).message).toBe('Moved main forward to feature/ahead (1 commit)')
    expect(await git(folder, 'rev-parse', 'HEAD')).toBe(preview.theirs)
  })

  it('makes a clean merge commit with no resolutions', async () => {
    const { folder, source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/apart')
    await source.merge('repo', preview, [])
    expect(await git(folder, 'log', '-1', '--format=%P')).toBe(`${preview.ours} ${preview.theirs}`)
    expect(await readFile(join(folder, 'apart.txt'), 'utf8')).toBe('apart\n')
  })

  it('names a remote branch the way git does', async () => {
    const folder = await createRepositoryWithRemote(fixtures, `merge-remote-${++repositories}`)
    await gitInFixture(fixtures, folder, 'config', 'user.name', 'Grace Hopper')
    await gitInFixture(fixtures, folder, 'config', 'user.email', 'grace@example.com')
    await commitInFixture(fixtures, folder, 'mine.txt', 'mine\n', 'Mine')
    const source = sourceOver(folder)
    const preview = await source.previewMerge('repo', 'origin/feature/remote')
    await source.merge('repo', preview, [])
    expect(await git(folder, 'log', '-1', '--format=%s')).toBe("Merge remote-tracking branch 'origin/feature/remote'")
  })

  it('refuses, changing nothing, when a conflict has no resolution or a resolution names another file', async () => {
    const { folder, source } = await mergeRepository()
    const before = await snapshot(folder)
    const preview = await source.previewMerge('repo', 'feature/login')
    await expect(source.merge('repo', preview, [])).rejects.toThrow('session.ts still has conflicts to resolve')
    await expect(
      source.merge('repo', preview, [
        { path: 'session.ts', text: 'x\n' },
        { path: 'README.md', text: 'x\n' },
      ]),
    ).rejects.toThrow('Not a conflicted file of this merge: README.md')
    expect(await snapshot(folder)).toEqual(before)
  })

  it('refuses, changing nothing, when a branch moved after the preview', async () => {
    const { folder, source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/login')
    await commitInFixture(fixtures, folder, 'later.txt', 'later\n', 'A commit made meanwhile in a terminal')
    const before = await snapshot(folder)
    await expect(source.getMergeConflicts('repo', preview)).rejects.toThrow(/has moved since/)
    await expect(source.merge('repo', preview, [{ path: 'session.ts', text: 'x\n' }])).rejects.toThrow(/has moved since/)
    expect(await snapshot(folder)).toEqual(before)
  })

  it('refuses, changing nothing, when uncommitted changes are in the way', async () => {
    const { folder, source } = await mergeRepository()
    await writeFile(join(folder, 'session.ts'), 'edited, not committed\n')
    const before = await snapshot(folder)
    const preview = await source.previewMerge('repo', 'feature/login')
    await expect(source.merge('repo', preview, [{ path: 'session.ts', text: 'x\n' }])).rejects.toThrow(/uncommitted changes.*session\.ts/)
    expect(await snapshot(folder)).toEqual(before)
  })

  it('refuses, changing nothing, when another branch has been checked out at the same commit', async () => {
    const { folder, source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/login')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '-c', 'other')
    await expect(source.getMergeConflicts('repo', preview)).rejects.toThrow(/moved since/)
    await expect(source.merge('repo', preview, [{ path: 'session.ts', text: 'x\n' }])).rejects.toThrow(/moved since/)
    expect(await git(folder, 'rev-parse', 'other')).toBe(preview.ours)
    expect(await git(folder, 'rev-parse', 'main')).toBe(preview.ours)
  })

  it('really makes the merge whatever branch.<name>.mergeoptions says', async () => {
    const { folder, source } = await mergeRepository()
    await gitInFixture(fixtures, folder, 'config', 'branch.main.mergeoptions', '--squash')
    const preview = await source.previewMerge('repo', 'feature/apart')
    await source.merge('repo', preview, [])
    expect(await git(folder, 'log', '-1', '--format=%P')).toBe(`${preview.ours} ${preview.theirs}`)
    expect(await git(folder, 'status', '--porcelain=v1')).toBe('')
  })

  it('keeps settings the app was started with for the last step too, and its own still win', async () => {
    const { folder, source } = await mergeRepository()
    const started = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Set In The Environment',
      GIT_CONFIG_KEY_1: 'branch.main.mergeoptions',
      GIT_CONFIG_VALUE_1: '--squash',
    }
    for (const [name, value] of Object.entries(started)) vi.stubEnv(name, value)
    try {
      const preview = await source.previewMerge('repo', 'feature/apart')
      await source.merge('repo', preview, [])
      expect(await git(folder, 'log', '-1', '--format=%P')).toBe(`${preview.ours} ${preview.theirs}`)
      // The reflog records who moved the branch, which shows the settings that step ran with.
      expect(await git(folder, 'log', '-g', '-1', '--format=%gn')).toBe('Set In The Environment')
    } finally {
      for (const name of Object.keys(started)) vi.stubEnv(name, undefined)
    }
  })

  it('signs the merge commit when commit.gpgsign asks for it', async () => {
    const { folder, source } = await mergeRepository()
    await gitInFixture(fixtures, folder, 'config', 'commit.gpgsign', 'true')
    await gitInFixture(fixtures, folder, 'config', 'gpg.program', 'no-such-signing-program')
    const before = await snapshot(folder)
    const preview = await source.previewMerge('repo', 'feature/apart')
    await expect(source.merge('repo', preview, [])).rejects.toThrow(/sign|gpg/i)
    expect(await snapshot(folder)).toEqual(before)
  })

  it('refuses a merge that isn’t the preview’s: hashes that aren’t full hashes', async () => {
    const { source } = await mergeRepository()
    const preview = await source.previewMerge('repo', 'feature/login')
    await expect(source.merge('repo', { ...preview, ours: '--all' }, [])).rejects.toThrow('Not a merge this app worked out')
  })

  it('says what to do when git doesn’t know who the user is, and changes nothing', async () => {
    const { folder, source } = await mergeRepository()
    await gitInFixture(fixtures, folder, 'config', '--unset', 'user.name')
    await gitInFixture(fixtures, folder, 'config', '--unset', 'user.email')
    // Otherwise git may guess a name and email from the machine and commit anyway.
    await gitInFixture(fixtures, folder, 'config', 'user.useConfigOnly', 'true')
    const before = await snapshot(folder)
    const preview = await source.previewMerge('repo', 'feature/apart')
    await expect(source.merge('repo', preview, [])).rejects.toThrow(/set user\.name and user\.email/)
    expect(await snapshot(folder)).toEqual(before)
  })
})

describe('GitCliDataSource merging files that aren’t simple edits', () => {
  type Content = string | Buffer
  type Side = (folder: string) => Promise<void>

  const put = (folder: string, path: string, content: Content) => writeFile(join(folder, path), content)
  const commitAll = async (folder: string, message: string) => {
    await gitInFixture(fixtures, folder, 'add', '--all')
    await gitInFixture(fixtures, folder, 'commit', '--quiet', '-m', message)
  }

  /** A repository where main and `theirs` each changed a common start; main is checked out. */
  async function diverged(start: Side, ours: Side, theirs: Side) {
    const folder = await createScratchRepository(fixtures, `merge-kinds-${++repositories}`)
    await gitInFixture(fixtures, folder, 'config', 'user.name', 'Grace Hopper')
    await gitInFixture(fixtures, folder, 'config', 'user.email', 'grace@example.com')
    await start(folder)
    await commitAll(folder, 'Start')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', '-c', 'theirs')
    await theirs(folder)
    await commitAll(folder, 'Theirs')
    await gitInFixture(fixtures, folder, 'switch', '--quiet', 'main')
    await ours(folder)
    await commitAll(folder, 'Ours')
    return { folder, source: sourceOver(folder) }
  }

  /**
   * Commits `path` as executable. The bit is set in the index, the only place Windows has for it,
   * and core.filemode is switched off (as it already is there) so that git elsewhere doesn't put
   * back the mode it sees on disk when the file is added again.
   */
  const putExecutable = async (repo: string, path: string, content: Content) => {
    await put(repo, path, content)
    await gitInFixture(fixtures, repo, 'config', 'core.filemode', 'false')
    await gitInFixture(fixtures, repo, 'add', path)
    await gitInFixture(fixtures, repo, 'update-index', '--chmod=+x', path)
  }

  const clash = (path: string, base: Content, ours: Content, theirs: Content) =>
    diverged(
      (folder) => put(folder, path, base),
      (folder) => put(folder, path, ours),
      (folder) => put(folder, path, theirs),
    )

  it('resolves a file both branches added, which has no base', async () => {
    const { folder, source } = await diverged(
      (repo) => put(repo, 'start.txt', 'start\n'),
      (repo) => put(repo, 'new.txt', 'ours\n'),
      (repo) => put(repo, 'new.txt', 'theirs\n'),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    expect(await source.getMergeConflicts('repo', preview)).toEqual([{ path: 'new.txt', base: null, ours: 'ours\n', theirs: 'theirs\n' }])
    await source.merge('repo', preview, [{ path: 'new.txt', text: 'both\n' }])
    expect(await readFile(join(folder, 'new.txt'), 'utf8')).toBe('both\n')
  })

  it.each([
    ['binary files', Buffer.from([1, 0, 2]), Buffer.from([1, 0, 3]), Buffer.from([1, 0, 4])],
    ['Git LFS pointers', 'version https://git-lfs.github.com/spec/v1\noid sha256:a\n', 'version https://git-lfs.github.com/spec/v1\noid sha256:b\n', 'version https://git-lfs.github.com/spec/v1\noid sha256:c\n'],
    ['text that isn’t UTF-8', Buffer.from('caf\xe9 1\n', 'latin1'), Buffer.from('caf\xe9 2\n', 'latin1'), Buffer.from('caf\xe9 3\n', 'latin1')],
  ])('leaves %s to a terminal', async (_kind, base, ours, theirs) => {
    const { source } = await clash('file.dat', base, ours, theirs)
    expect(await source.previewMerge('repo', 'theirs')).toMatchObject({ conflicts: [], unresolvable: ['file.dat'] })
  })

  it('follows a rename: an edit on the other branch lands in the moved file, with no conflict', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`)
    const { folder, source } = await diverged(
      (repo) => put(repo, 'old.txt', lines.join('\n') + '\n'),
      (repo) => gitInFixture(fixtures, repo, 'mv', 'old.txt', 'new.txt').then(() => {}),
      (repo) => put(repo, 'old.txt', ['edited', ...lines.slice(1)].join('\n') + '\n'),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    expect(preview).toMatchObject({ outcome: 'merge-commit', conflicts: [], unresolvable: [] })
    await source.merge('repo', preview, [])
    expect((await readFile(join(folder, 'new.txt'), 'utf8')).startsWith('edited\n')).toBe(true)
  })

  it('resolves a conflict in a renamed file under its new name', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`)
    const edited = (first: string) => [first, ...lines.slice(1)].join('\n') + '\n'
    const { folder, source } = await diverged(
      (repo) => put(repo, 'old.txt', lines.join('\n') + '\n'),
      async (repo) => {
        await gitInFixture(fixtures, repo, 'mv', 'old.txt', 'new.txt')
        await put(repo, 'new.txt', edited('ours'))
      },
      (repo) => put(repo, 'old.txt', edited('theirs')),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    expect(preview.conflicts).toEqual(['new.txt'])
    const [file] = await source.getMergeConflicts('repo', preview)
    expect(file).toMatchObject({ path: 'new.txt', base: lines.join('\n') + '\n', ours: edited('ours'), theirs: edited('theirs') })
    await source.merge('repo', preview, [{ path: 'new.txt', text: edited('settled') }])
    expect(await readFile(join(folder, 'new.txt'), 'utf8')).toBe(edited('settled'))
    expect(await git(folder, 'ls-files')).not.toContain('old.txt')
  })

  it('leaves a file each branch renamed differently to a terminal', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n') + '\n'
    const { source } = await diverged(
      (repo) => put(repo, 'old.txt', lines),
      (repo) => gitInFixture(fixtures, repo, 'mv', 'old.txt', 'ours.txt').then(() => {}),
      (repo) => gitInFixture(fixtures, repo, 'mv', 'old.txt', 'theirs.txt').then(() => {}),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    expect(preview.conflicts).toEqual([])
    expect(preview.unresolvable.length).toBeGreaterThan(0)
  })

  it('with core.autocrlf, stores LF and leaves CRLF on disk, so the file isn’t left looking changed', async () => {
    const { folder, source } = await clash('text.txt', 'base\n', 'ours\n', 'theirs\n')
    await gitInFixture(fixtures, folder, 'config', 'core.autocrlf', 'true')
    const preview = await source.previewMerge('repo', 'theirs')
    await source.merge('repo', preview, [{ path: 'text.txt', text: 'settled\nsecond\n' }])
    expect(await git(folder, 'cat-file', '-p', 'HEAD:text.txt')).toBe('settled\nsecond')
    expect(await readFile(join(folder, 'text.txt'), 'utf8')).toBe('settled\r\nsecond\r\n')
    expect(await git(folder, 'status', '--porcelain=v1')).toBe('')
  })

  it('commits exactly the text it was given, CRLF included, even with core.autocrlf on', async () => {
    const { folder, source } = await clash('text.txt', 'a\r\nb\r\n', 'a\r\nours\r\n', 'a\r\ntheirs\r\n')
    await gitInFixture(fixtures, folder, 'config', 'core.autocrlf', 'true')
    const preview = await source.previewMerge('repo', 'theirs')
    await source.merge('repo', preview, [{ path: 'text.txt', text: 'a\r\nsettled\r\n' }])
    expect(await fixtureGit(folder, 'cat-file', 'blob', 'HEAD:text.txt')).toBe('a\r\nsettled\r\n')
  })

  it('commits exactly the text it was given for a file with a working-tree encoding', async () => {
    const { folder, source } = await clash('text.txt', 'base\n', 'ours\n', 'theirs\n')
    await writeFile(join(folder, '.git', 'info', 'attributes'), '*.txt working-tree-encoding=UTF-16LE\n')
    const preview = await source.previewMerge('repo', 'theirs')
    await source.merge('repo', preview, [{ path: 'text.txt', text: 'settled\n' }])
    expect(await fixtureGit(folder, 'cat-file', 'blob', 'HEAD:text.txt')).toBe('settled\n')
  })

  it('keeps an executable bit that only the other branch added', async () => {
    const { folder, source } = await diverged(
      (repo) => put(repo, 'run.sh', 'base\n'),
      (repo) => put(repo, 'run.sh', 'ours\n'),
      (repo) => putExecutable(repo, 'run.sh', 'theirs\n'),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    await source.merge('repo', preview, [{ path: 'run.sh', text: 'settled\n' }])
    expect(await git(folder, 'ls-tree', 'HEAD', 'run.sh')).toMatch(/^100755 /)
  })

  it('won’t overwrite an ignored file the merge would add, in a merge commit or a fast-forward', async () => {
    const { folder, source } = await diverged(
      (repo) => put(repo, '.gitignore', '.env\n'),
      (repo) => put(repo, 'ours.txt', 'ours\n'),
      async (repo) => {
        await put(repo, '.env', 'from the branch\n')
        await gitInFixture(fixtures, repo, 'add', '--force', '.env')
      },
    )
    await gitInFixture(fixtures, folder, 'branch', 'ahead', 'theirs')
    await put(folder, '.env', 'my local secrets\n')
    const preview = await source.previewMerge('repo', 'theirs')
    expect(preview.blockedBy).toEqual(['.env'])
    await expect(source.merge('repo', preview, [])).rejects.toThrow(/\.env/)
    expect(await readFile(join(folder, '.env'), 'utf8')).toBe('my local secrets\n')

    await gitInFixture(fixtures, folder, 'reset', '--quiet', '--hard', 'HEAD~1')
    const forward = await source.previewMerge('repo', 'ahead')
    expect(forward).toMatchObject({ outcome: 'fast-forward', blockedBy: ['.env'] })
    await expect(source.merge('repo', forward, [])).rejects.toThrow(/\.env/)
    expect(await readFile(join(folder, '.env'), 'utf8')).toBe('my local secrets\n')
  })

  it('keeps a file’s executable bit', async () => {
    const { folder, source } = await diverged(
      (repo) => putExecutable(repo, 'run.sh', 'base\n'),
      (repo) => put(repo, 'run.sh', 'ours\n'),
      (repo) => put(repo, 'run.sh', 'theirs\n'),
    )
    const preview = await source.previewMerge('repo', 'theirs')
    await source.merge('repo', preview, [{ path: 'run.sh', text: 'settled\n' }])
    expect(await git(folder, 'ls-tree', 'HEAD', 'run.sh')).toMatch(/^100755 /)
  })
})

describe('parseMergeTree', () => {
  const tree = 'a'.repeat(40)
  it('reads the tree and each conflicted file’s stages', () => {
    const NUL = '\u0000'
    const output = [tree, `100644 ${'b'.repeat(40)} 2\tdocs/read me.md`, `100755 ${'c'.repeat(40)} 3\tdocs/read me.md`, '', ''].join(NUL)
    expect(parseMergeTree(output)).toEqual({
      tree,
      stages: [
        { mode: '100644', oid: 'b'.repeat(40), stage: 2, path: 'docs/read me.md' },
        { mode: '100755', oid: 'c'.repeat(40), stage: 3, path: 'docs/read me.md' },
      ],
    })
  })

  it('refuses output that doesn’t start with a tree', () => {
    expect(() => parseMergeTree('fatal\0')).toThrow(/no merged tree/)
  })
})
