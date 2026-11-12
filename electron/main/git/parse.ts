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
