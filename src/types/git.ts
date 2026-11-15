/** Added, modified, deleted, or renamed (moved, perhaps edited too). */
export type FileStatus = 'A' | 'M' | 'D' | 'R'

/**
 * One hunk of a diff. Each line starts with '+', '-' or ' ' (context),
 * exactly as in `git diff` output.
 */
export interface Hunk {
  oldStart: number
  newStart: number
  /** Enclosing declaration git prints after the @@ header, or '' if none. */
  context: string
  lines: string[]
}

/** A file a commit touched. Its hunks are loaded separately (`GitDataSource.getFileDiff`). */
export interface FileChange {
  path: string
  status: FileStatus
  /** Where a renamed file ('R') was before; absent for every other status. */
  oldPath?: string
}

/**
 * How one commit's row of the history graph is drawn. Lanes are numbered from 0 at the left.
 * Every list holds lane numbers.
 */
export interface GraphRow {
  /** Lane the commit dot sits in. */
  lane: number
  /** Lanes with a straight line in the top half of the row (above the dot's centre). */
  top: number[]
  /** Lanes with a straight line in the bottom half of the row. */
  bottom: number[]
  /** Lanes whose line curves into the dot from the row's top edge (a branch joining its parent). */
  curvesIn: number[]
  /** Lanes the dot curves out to at the row's bottom edge (a merge's second and later parents). */
  curvesOut: number[]
}

export interface Commit {
  hash: string
  message: string
  author: string
  /** Author date, ISO 8601. The UI formats it ('Today 11:42'). */
  date: string
  /** Branch names pointing at this commit; remote ones start with 'origin/'. */
  refs: string[]
  graph: GraphRow
}

export interface LocalBranch {
  name: string
  ahead: number
  behind: number
  tipHash: string
}

export interface RemoteBranch {
  name: string
  tipHash: string
}

/** What the repository list shows. Branches and history are loaded when the repository is opened. */
export interface Repository {
  id: string
  name: string
  path: string
  /** The checked-out branch, or null when HEAD is detached (a commit is checked out directly). */
  currentBranch: string | null
  changedFileCount: number
  /** When the repository was last fetched, ISO 8601, or null if never. */
  lastFetch: string | null
  /** Why the repository can't be read ('Folder not found'), or null when it can. */
  problem: string | null
}

export interface Branches {
  local: LocalBranch[]
  remote: RemoteBranch[]
}

/** The newest commits of a repository, newest first. */
export interface HistoryPage {
  commits: Commit[]
  /** True when the repository has older commits than the page holds. */
  hasMore: boolean
}

export interface OperationResult {
  message: string
}

/**
 * The branch to check out: a local one, or a remote one to create a local branch from that
 * tracks it. Separate fields, because a local branch may itself be named 'origin/x'.
 */
export type CheckoutTarget = { local: string } | { remote: string }

export interface CheckoutOptions {
  /** Switch even though commits on a detached HEAD would be left on no branch. */
  leaveCommits?: boolean
}

/**
 * What a checkout did. `confirm` means nothing happened yet: switching would leave commits that
 * no branch contains, and only a checkout with `leaveCommits` goes ahead.
 */
export type CheckoutResult =
  | { kind: 'switched'; branch: string; message: string }
  | { kind: 'confirm'; commitsLeft: number }

/** What adding a repository did: the repository (null when nothing was added) and what to tell the user. */
export interface AddRepositoryResult {
  repository: Repository | null
  /** For the status bar; '' when there's nothing to say (the user cancelled). */
  message: string
}
