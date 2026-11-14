import { pluralWord } from '../../../src/lib/format'
import type { Branches, FileChange, FileStatus } from '../../../src/types/git'

// Parsers for the machine-readable git output GitCliDataSource asks for. Each documents the
// exact format string it expects; the commands that produce it live in GitCliDataSource.

const NUL = '\0'
const UNIT = '\x1f'
const TAB = '\t'

const LOCAL_BRANCH_PREFIX = 'refs/heads/'
const REMOTE_BRANCH_PREFIX = 'refs/remotes/'

/** The full ref of a local branch, for refspecs and ranges: a bare name could also match a tag. */
export function localBranchRef(branch: string): string {
  return `${LOCAL_BRANCH_PREFIX}${branch}`
}

/** The `for-each-ref` patterns for every branch parseBranches reads: local and remote-tracking. */
export const BRANCH_REFS = [LOCAL_BRANCH_PREFIX, REMOTE_BRANCH_PREFIX]

/** `for-each-ref --format=%(refname)%00%(objectname)%00%(upstream:track,nobracket)%00%(symref)`. */
export const BRANCH_FORMAT = '%(refname)%00%(objectname)%00%(upstream:track,nobracket)%00%(symref)'

export function parseBranches(output: string): Branches {
  const branches: Branches = { local: [], remote: [] }
  for (const line of output.split('\n')) addBranch(branches, line)
  return branches
}

/** Adds one BRANCH_FORMAT line's branch. Symbolic refs (origin/HEAD) point at a branch already listed. */
function addBranch(branches: Branches, line: string): void {
  const [refname = '', tipHash = '', track = '', symref = ''] = line.split(NUL)
  if (!refname || symref) return
  if (refname.startsWith(LOCAL_BRANCH_PREFIX)) {
    branches.local.push({ name: refname.slice(LOCAL_BRANCH_PREFIX.length), ...parseTrack(track), tipHash })
  }
  if (refname.startsWith(REMOTE_BRANCH_PREFIX)) {
    branches.remote.push({ name: refname.slice(REMOTE_BRANCH_PREFIX.length), tipHash })
  }
}

/** What `%(upstream:track)` says when the upstream was deleted on the remote. */
const TRACK_GONE = 'gone'

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
  const fields: Fields = output.split(NUL).values()
  const changes: FileChange[] = []
  for (const code of fields) {
    const change = changeFrom(code, fields)
    if (change) changes.push(change)
  }
  return changes
}

/** The fields still to read. Each change reads its own paths, so the loop goes on at the next status. */
type Fields = Iterator<string, undefined> & Iterable<string>

const RENAMED = 'R'

/** The change `code` starts, reading its paths from `fields`; null for the empty field after the last NUL. */
function changeFrom(code: string, fields: Fields): FileChange | null {
  if (!code) return null
  if (code.startsWith(RENAMED)) return renameFrom(fields)
  const path = fields.next().value
  return path ? { path, status: fileStatus(code) } : null
}

function renameFrom(fields: Fields): FileChange {
  const oldPath = fields.next().value ?? ''
  const path = fields.next().value ?? ''
  return { path, status: RENAMED, oldPath }
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
  const overwritten = overwrittenFiles(stderr, command)
  if (!overwritten) return null
  return overwritten.untracked ? untrackedFilesRefusal(overwritten.files, doing) : changesRefusal(overwritten.files, doing)
}

/** The files git's refusal lists, and whether they're untracked files rather than uncommitted changes. */
interface OverwrittenFiles {
  files: string[]
  untracked: boolean
}

function overwrittenFiles(stderr: string, command: string): OverwrittenFiles | null {
  const lines = stderr.split(/\r?\n/)
  const heading = lines.findIndex((line) => line.endsWith(`would be overwritten by ${command}:`))
  if (heading === -1) return null
  return { files: indentedLinesAfter(lines, heading), untracked: lines[heading]!.includes('untracked working tree files') }
}

/** The tab-indented lines straight after `heading`, without the tab. */
function indentedLinesAfter(lines: string[], heading: number): string[] {
  const after = lines.slice(heading + 1)
  const end = after.findIndex((line) => !line.startsWith(TAB))
  return after.slice(0, end === -1 ? after.length : end).map((line) => line.slice(TAB.length))
}

function untrackedFilesRefusal(files: string[], doing: string): string {
  const count = files.length
  return `untracked ${pluralWord(count, 'file', 'files')} ${fileList(files)} would be overwritten by ${doing}. Move or remove ${pluralWord(count, 'it', 'them')} first.`
}

function changesRefusal(files: string[], doing: string): string {
  return `your changes to ${fileList(files)} would be overwritten by ${doing}. Commit or stash them first.`
}

/**
 * `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track,nobracket)`
 * for one branch.
 */
export const UPSTREAM_FORMAT =
  '%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track,nobracket)'

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
  // A pattern also matches longer names (refs/heads/a matches refs/heads/a/b), so compare exactly.
  const fields = output
    .split('\n')
    .map((line) => line.split(NUL))
    .find(([refname]) => refname === localBranchRef(branch))
  return fields ? upstreamFrom(fields) : null
}

/** One UPSTREAM_FORMAT line's upstream; null when the branch tracks nothing. */
function upstreamFrom([, ref = '', name = '', remote = '', remoteRef = '', track = '']: string[]): Upstream | null {
  return ref && remote && remoteRef ? { ref, name, remote, remoteRef, gone: track === TRACK_GONE } : null
}

/** One ref's line in `push --porcelain`: a flag, what was pushed where, and git's summary. */
export interface PushedRef {
  /** ' ' fast-forward, '+' forced, '-' deleted, '*' new, '!' rejected, '=' up to date. */
  flag: string
  summary: string
}

/** The `PushedRef` flags the data source acts on. */
export const PUSH_FLAG = { rejected: '!', upToDate: '=' } as const

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
