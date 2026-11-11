export type FileStatus = 'A' | 'M' | 'D'

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
}

/** The graph has three lanes (0–2); each flag says whether that lane's line is drawn. */
export type LaneFlags = [boolean, boolean, boolean]

/** How one commit's row of the history graph is drawn. */
export interface GraphRow {
  /** Lane the commit dot sits in. */
  lane: number
  /** Straight lines in the top half of the row (above the dot's centre). */
  top: LaneFlags
  /** Straight lines in the bottom half of the row. */
  bottom: LaneFlags
  /** A curve entering the dot from this lane at the top edge, or null. */
  curveInFrom: number | null
  /** A curve leaving the dot towards this lane at the bottom edge, or null. */
  curveOutTo: number | null
}

export interface Commit {
  hash: string
  message: string
  author: string
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
  currentBranch: string
  changedFileCount: number
  lastFetch: string
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
