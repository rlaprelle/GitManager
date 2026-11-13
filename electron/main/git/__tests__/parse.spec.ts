// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkoutRefusal, countStatusEntries, parseBranches, parseCommitLog, parseNameStatus } from '../parse'

const NUL = '\0'
const UNIT = '\x1f'

describe('parseBranches', () => {
  // Format: %(refname)%00%(objectname)%00%(upstream:track,nobracket)%00%(symref), one ref per line.
  const output = [
    ['refs/heads/main', 'a'.repeat(40), 'ahead 2, behind 1', ''],
    ['refs/heads/feature/x', 'b'.repeat(40), '', ''],
    ['refs/heads/old', 'c'.repeat(40), 'gone', ''],
    ['refs/remotes/origin/HEAD', 'a'.repeat(40), '', 'refs/remotes/origin/main'],
    ['refs/remotes/origin/main', 'd'.repeat(40), '', ''],
  ]
    .map((fields) => fields.join(NUL))
    .join('\n')

  it('splits local and remote branches, with ahead/behind counts from the upstream', () => {
    expect(parseBranches(output + '\n')).toEqual({
      local: [
        { name: 'main', ahead: 2, behind: 1, tipHash: 'a'.repeat(40) },
        { name: 'feature/x', ahead: 0, behind: 0, tipHash: 'b'.repeat(40) },
        { name: 'old', ahead: 0, behind: 0, tipHash: 'c'.repeat(40) },
      ],
      remote: [{ name: 'origin/main', tipHash: 'd'.repeat(40) }],
    })
  })

  it('reads an empty listing as no branches', () => {
    expect(parseBranches('')).toEqual({ local: [], remote: [] })
  })
})

describe('parseCommitLog', () => {
  // Format: %H %P %an %aI %s %D separated by 0x1f, one commit per NUL-terminated record (-z).
  const record = (...fields: string[]) => fields.join(UNIT) + NUL

  it('reads hash, parents, author, ISO date, subject and branch labels', () => {
    const output =
      record('m'.repeat(40), `${'p'.repeat(40)} ${'q'.repeat(40)}`, 'Ada Lovelace', '2026-11-10T11:42:00+01:00', "Merge branch 'fix'", 'HEAD -> main, origin/main, tag: v1.0, origin/HEAD') +
      record('r'.repeat(40), '', 'Ada Lovelace', '2026-11-09T09:00:00+01:00', 'Initial commit', '')
    expect(parseCommitLog(output)).toEqual([
      {
        hash: 'm'.repeat(40),
        parents: ['p'.repeat(40), 'q'.repeat(40)],
        author: 'Ada Lovelace',
        date: '2026-11-10T11:42:00+01:00',
        message: "Merge branch 'fix'",
        refs: ['main', 'origin/main'],
      },
      { hash: 'r'.repeat(40), parents: [], author: 'Ada Lovelace', date: '2026-11-09T09:00:00+01:00', message: 'Initial commit', refs: [] },
    ])
  })

  it('drops a detached HEAD label, keeping the branches beside it', () => {
    const output = record('h'.repeat(40), '', 'A', '2026-11-10T11:42:00Z', 's', 'HEAD, feature/x')
    expect(parseCommitLog(output)[0]!.refs).toEqual(['feature/x'])
  })

  it('keeps a subject that contains commas and arrows untouched', () => {
    const output = record('h'.repeat(40), '', 'A', '2026-11-10T11:42:00Z', 'Fix a, b -> c', '')
    expect(parseCommitLog(output)[0]!.message).toBe('Fix a, b -> c')
  })
})

describe('parseNameStatus', () => {
  it('pairs each status with its path, reading a type change as a modification', () => {
    const output = ['M', 'src/app.ts', 'A', 'docs/new file.md', 'D', 'old.txt', 'T', 'link', ''].join(NUL)
    expect(parseNameStatus(output)).toEqual([
      { path: 'src/app.ts', status: 'M' },
      { path: 'docs/new file.md', status: 'A' },
      { path: 'old.txt', status: 'D' },
      { path: 'link', status: 'M' },
    ])
  })

  it('reads a rename (R with its similarity) as two paths: from, then to', () => {
    const output = ['R100', 'GUIDE.md', 'docs/guide.md', 'M', 'app.ts', 'R087', 'a b.txt', 'c/a b.txt', ''].join(NUL)
    expect(parseNameStatus(output)).toEqual([
      { path: 'docs/guide.md', status: 'R', oldPath: 'GUIDE.md' },
      { path: 'app.ts', status: 'M' },
      { path: 'c/a b.txt', status: 'R', oldPath: 'a b.txt' },
    ])
  })
})

describe('countStatusEntries', () => {
  it('counts one entry per NUL-terminated path', () => {
    expect(countStatusEntries([' M a.txt', '?? b.txt', 'A  c/d.txt', ''].join(NUL))).toBe(3)
    expect(countStatusEntries('')).toBe(0)
  })
})

describe('checkoutRefusal', () => {
  // Git 2.46's own words, captured from `git switch`.
  const changed = (...files: string[]) =>
    [
      'error: Your local changes to the following files would be overwritten by checkout:',
      ...files.map((file) => `\t${file}`),
      'Please commit your changes or stash them before you switch branches.',
      'Aborting',
      '',
    ].join('\n')
  const untracked = (...files: string[]) =>
    [
      'error: The following untracked working tree files would be overwritten by checkout:',
      ...files.map((file) => `\t${file}`),
      'Please move or remove them before you switch branches.',
      'Aborting',
      '',
    ].join('\n')

  it('names the changed files that would be overwritten', () => {
    expect(checkoutRefusal(changed('README.md'), 'feature')).toBe(
      'your changes to README.md would be overwritten by switching to feature. Commit or stash them first.',
    )
    expect(checkoutRefusal(changed('a.txt', 'docs/read me é.md'), 'feature')).toBe(
      'your changes to a.txt and docs/read me é.md would be overwritten by switching to feature. Commit or stash them first.',
    )
  })

  it('names three files at most', () => {
    expect(checkoutRefusal(changed('a', 'b', 'c'), 'x')).toMatch(/^your changes to a, b and c would/)
    expect(checkoutRefusal(changed('a', 'b', 'c', 'd', 'e'), 'x')).toMatch(/^your changes to a, b, c and 2 more would/)
  })

  it('names untracked files that would be overwritten', () => {
    expect(checkoutRefusal(untracked('new.txt'), 'other')).toBe(
      'untracked file new.txt would be overwritten by switching to other. Move or remove it first.',
    )
    expect(checkoutRefusal(untracked('a', 'b'), 'other')).toBe(
      'untracked files a and b would be overwritten by switching to other. Move or remove them first.',
    )
  })

  it('reads Windows line endings', () => {
    expect(checkoutRefusal(changed('a.txt').replaceAll('\n', '\r\n'), 'x')).toMatch(/^your changes to a.txt would/)
  })

  it('leaves any other error alone', () => {
    expect(checkoutRefusal("fatal: 'main' is already used by worktree at 'C:/work/other'\n", 'main')).toBeNull()
    expect(checkoutRefusal('', 'main')).toBeNull()
  })
})
