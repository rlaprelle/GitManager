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

export interface FileChange {
  path: string
  status: FileStatus
  hunks: Hunk[]
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
  files: FileChange[]
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

export interface Repository {
  id: string
  name: string
  path: string
  currentBranch: string
  changedFileCount: number
  lastFetch: string
  localBranches: LocalBranch[]
  remoteBranches: RemoteBranch[]
  /** Newest first. */
  commits: Commit[]
}

export interface OperationResult {
  message: string
}
