// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  checkoutRefusal,
  countStatusEntries,
  parseBranches,
  parseCommitLog,
  parseNameStatus,
  parsePushPorcelain,
  parseUpstream,
  pullRefusal,
  pushRefusal,
} from '../parse'

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

  it('ignores a merge’s refusal, which pullRefusal words', () => {
    expect(checkoutRefusal(changed('a').replace('by checkout:', 'by merge:'), 'x')).toBeNull()
  })
})

describe('pullRefusal', () => {
  // Git 2.46's own words, captured from `git merge --ff-only`.
  const refusal = (heading: string, ...files: string[]) =>
    [`error: ${heading} would be overwritten by merge:`, ...files.map((file) => `\t${file}`), 'Aborting', ''].join('\n')

  it('names changed and untracked files, and the branch being pulled', () => {
    expect(pullRefusal(refusal('Your local changes to the following files', 'README.md'), 'origin/main')).toBe(
      'your changes to README.md would be overwritten by pulling origin/main. Commit or stash them first.',
    )
    expect(pullRefusal(refusal('The following untracked working tree files', 'new.txt'), 'origin/main')).toBe(
      'untracked file new.txt would be overwritten by pulling origin/main. Move or remove it first.',
    )
  })

  it('leaves any other error alone', () => {
    expect(pullRefusal('fatal: Not possible to fast-forward, aborting.\n', 'origin/main')).toBeNull()
  })
})

describe('parseUpstream', () => {
  // UPSTREAM_FORMAT: refname, upstream, upstream:short, remotename, remoteref, track; NUL-separated.
  const line = (...fields: string[]) => fields.join(NUL)

  it('reads the upstream’s ref, name, remote and branch there', () => {
    const output = line('refs/heads/main', 'refs/remotes/origin/main', 'origin/main', 'origin', 'refs/heads/main', 'ahead 1') + '\n'
    expect(parseUpstream(output, 'main')).toEqual({
      ref: 'refs/remotes/origin/main',
      name: 'origin/main',
      remote: 'origin',
      remoteRef: 'refs/heads/main',
      gone: false,
    })
  })

  it('says when the upstream was deleted on the remote', () => {
    const output = line('refs/heads/old', 'refs/remotes/origin/old', 'origin/old', 'origin', 'refs/heads/old', 'gone')
    expect(parseUpstream(output, 'old')?.gone).toBe(true)
  })

  it('is null for a branch without one', () => {
    expect(parseUpstream(line('refs/heads/topic', '', '', '', '', ''), 'topic')).toBeNull()
  })

  it('only answers for the branch asked about, not one whose name starts the same', () => {
    const output = line('refs/heads/a/b', 'refs/remotes/origin/a/b', 'origin/a/b', 'origin', 'refs/heads/a/b', '')
    expect(parseUpstream(output, 'a')).toBeNull()
  })
})

describe('parsePushPorcelain', () => {
  // Git 2.46's own output, captured from `git push --porcelain`.
  it('reads each ref’s flag and summary, and skips the To and Done lines', () => {
    const stdout = [
      'To ../o.git',
      ' \trefs/heads/main:refs/heads/main\td2a7b75..5131141',
      '=\trefs/heads/a:refs/heads/a\t[up to date]',
      '!\trefs/heads/b:refs/heads/b\t[rejected] (fetch first)',
      '*\trefs/heads/topic:refs/heads/topic\t[new branch]',
      "branch 'topic' set up to track 'origin/topic'.",
      'Done',
      '',
    ].join('\n')
    expect(parsePushPorcelain(stdout)).toEqual([
      { flag: ' ', summary: 'd2a7b75..5131141' },
      { flag: '=', summary: '[up to date]' },
      { flag: '!', summary: '[rejected] (fetch first)' },
      { flag: '*', summary: '[new branch]' },
    ])
  })
})

describe('pushRefusal', () => {
  it('says to pull first when the remote has commits the branch lacks', () => {
    const expected = 'origin/main has commits that main doesn’t have. Pull them first, then push again.'
    expect(pushRefusal('[rejected] (fetch first)', 'main', 'origin/main')).toBe(expected)
    expect(pushRefusal('[rejected] (non-fast-forward)', 'main', 'origin/main')).toBe(expected)
  })

  it('passes on the remote’s own reason', () => {
    expect(pushRefusal('[remote rejected] (pre-receive hook declined)', 'main', 'origin/main')).toBe(
      'the remote refused the push: pre-receive hook declined',
    )
  })

  it('leaves anything else alone', () => {
    expect(pushRefusal('[remote failure] (remote failed to report status)', 'main', 'origin/main')).toBeNull()
  })
})
