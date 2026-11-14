import type { Branches, FileChange, FileStatus } from '../../../src/types/git'

// Parsers for the machine-readable git output GitCliDataSource asks for. Each documents the
// exact format string it expects; the commands that produce it live in GitCliDataSource.

const NUL = '\0'
const UNIT = '\x1f'

/** `for-each-ref --format=%(refname)%00%(objectname)%00%(upstream:track,nobracket)%00%(symref)`. */
export const BRANCH_FORMAT = '%(refname)%00%(objectname)%00%(upstream:track,nobracket)%00%(symref)'

export function parseBranches(output: string): Branches {
  const branches: Branches = { local: [], remote: [] }
  for (const line of output.split('\n')) {
    if (!line) continue
    const [refname = '', tipHash = '', track = '', symref = ''] = line.split(NUL)
    // origin/HEAD and other symbolic refs point at a branch that is already listed.
    if (symref) continue
    if (refname.startsWith('refs/heads/')) {
      branches.local.push({ name: refname.slice('refs/heads/'.length), ...parseTrack(track), tipHash })
    } else if (refname.startsWith('refs/remotes/')) {
      branches.remote.push({ name: refname.slice('refs/remotes/'.length), tipHash })
    }
  }
  return branches
}

/** 'ahead 2, behind 1', 'ahead 2', 'behind 1', 'gone' (upstream deleted) or '' (in sync / none). */
function parseTrack(track: string): { ahead: number; behind: number } {
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0)
  return { ahead: count('ahead'), behind: count('behind') }
}

/** `log -z --format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D`: one NUL-terminated record per commit. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D'

export interface LoggedCommit {
  hash: string
  parents: string[]
  author: string
  date: string
  message: string
  refs: string[]
}

export function parseCommitLog(output: string): LoggedCommit[] {
  return output
    .split(NUL)
    .filter((record) => record.trim())
    .map((record) => {
      const [hash = '', parents = '', author = '', date = '', message = '', decoration = ''] = record
        .replace(/^\n/, '')
        .split(UNIT)
      return { hash, parents: parents ? parents.split(' ') : [], author, date, message, refs: branchLabels(decoration) }
    })
}

/**
 * Branch names from `%D` ('HEAD -> main, origin/main, tag: v1, origin/HEAD'): tags, HEAD
 * itself and remote HEADs are dropped, so every label names a branch getBranches lists.
 */
function branchLabels(decoration: string): string[] {
  return decoration
    .split(', ')
    .map((label) => label.replace(/^HEAD -> /, ''))
    .filter((label) => label && label !== 'HEAD' && !label.startsWith('tag: ') && !label.endsWith('/HEAD'))
}

/**
 * `diff-tree -r -z --name-status -M`: a status, then its path, each NUL-terminated; a rename
 * ('R' plus a similarity, e.g. 'R087') is followed by two paths, where it was and where it is.
 */
export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split(NUL)
  const changes: FileChange[] = []
  let i = 0
  while (i < fields.length) {
    const code = fields[i++]!
    if (!code) continue
    if (code.startsWith('R')) {
      const oldPath = fields[i++]!
      const path = fields[i++]!
      changes.push({ path, status: 'R', oldPath })
      continue
    }
    const path = fields[i++]
    if (path) changes.push({ path, status: fileStatus(code) })
  }
  return changes
}

/** A, M and D as they are; anything else git reports for one path (a type change, T) counts as modified. */
function fileStatus(code: string): Exclude<FileStatus, 'R'> {
  return code === 'A' || code === 'D' ? code : 'M'
}

/** `status --porcelain=v1 -z --no-renames`: one NUL-terminated entry per changed path. */
export function countStatusEntries(output: string): number {
  return output.split(NUL).filter(Boolean).length
}

/** How many file names a refusal lists before "and N more": it has to fit the status bar. */
const NAMED_FILES = 3

/**
 * Git's refusal to switch branches because files would be overwritten, as one line for the
 * status bar (the composable puts "Failed: " in front). Null for any other error, whose first
 * line already says enough. Git lists the files one per tab-indented line after its heading.
 */
export function checkoutRefusal(stderr: string, branch: string): string | null {
  return overwriteRefusal(stderr, 'checkout', `switching to ${branch}`)
}

/** Git's refusal to fast-forward because files would be overwritten, worded like checkoutRefusal. */
export function pullRefusal(stderr: string, upstream: string): string | null {
  return overwriteRefusal(stderr, 'merge', `pulling ${upstream}`)
}

/** `command` is the word git ends its heading with ("would be overwritten by merge:"); `doing` is ours. */
function overwriteRefusal(stderr: string, command: string, doing: string): string | null {
  const lines = stderr.split(/\r?\n/)
  const heading = lines.findIndex((line) => line.endsWith(`would be overwritten by ${command}:`))
  if (heading === -1) return null
  const files: string[] = []
  for (const line of lines.slice(heading + 1)) {
    if (!line.startsWith('\t')) break
    files.push(line.slice(1))
  }
  const untracked = /untracked working tree files/.test(lines[heading]!)
  const named = fileList(files)
  return untracked
    ? `untracked ${files.length === 1 ? 'file' : 'files'} ${named} would be overwritten by ${doing}. Move or remove ${files.length === 1 ? 'it' : 'them'} first.`
    : `your changes to ${named} would be overwritten by ${doing}. Commit or stash them first.`
}

/**
 * `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)`
 * for one branch.
 */
export const UPSTREAM_FORMAT =
  '%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)'

/** The branch a local branch tracks. */
export interface Upstream {
  /** Its remote-tracking ref here: refs/remotes/origin/main. */
  ref: string
  /** As the UI names it: origin/main. */
  name: string
  remote: string
  /** The branch on the remote: refs/heads/main. */
  remoteRef: string
  /** Deleted on the remote (and pruned here). */
  gone: boolean
}

/** The upstream of `branch` from UPSTREAM_FORMAT output, or null when it has none. */
export function parseUpstream(output: string, branch: string): Upstream | null {
  for (const line of output.split('\n')) {
    const [refname, ref = '', name = '', remote = '', remoteRef = '', track = ''] = line.split(NUL)
    // A pattern also matches longer names (refs/heads/a matches refs/heads/a/b), so compare exactly.
    if (refname !== `refs/heads/${branch}`) continue
    return ref && remote && remoteRef ? { ref, name, remote, remoteRef, gone: track === 'gone' } : null
  }
  return null
}

/** One ref's line in `push --porcelain`: a flag, what was pushed where, and git's summary. */
export interface PushedRef {
  /** ' ' fast-forward, '+' forced, '-' deleted, '*' new, '!' rejected, '=' up to date. */
  flag: string
  summary: string
}

/** `push --porcelain` stdout: 'To <url>', then '<flag>\t<from>:<to>\t<summary>' per ref, then 'Done'. */
export function parsePushPorcelain(stdout: string): PushedRef[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => /^([ +\-*!=])\t[^\t]+\t(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, flag = '', summary = '']) => ({ flag, summary }))
}

/**
 * Why a push was refused, from its porcelain summary, as one line for the status bar (after
 * "Failed: "). Null when the summary isn't a refusal this knows.
 */
export function pushRefusal(summary: string, branch: string, upstream: string): string | null {
  if (summary.startsWith('[rejected]')) return `${upstream} has commits that ${branch} doesn’t have. Pull them first, then push again.`
  const remote = /^\[remote rejected\] \((.*)\)$/.exec(summary)
  if (remote) return `the remote refused the push: ${remote[1]}`
  return null
}

/** 'a, b and c', or 'a, b, c and 4 more'. */
function fileList(files: string[]): string {
  if (files.length <= NAMED_FILES) {
    return files.length === 1 ? files[0]! : `${files.slice(0, -1).join(', ')} and ${files.at(-1)}`
  }
  return `${files.slice(0, NAMED_FILES).join(', ')} and ${files.length - NAMED_FILES} more`
}
