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
  /**
   * Set when Pull couldn't fast-forward because both sides have new commits: the upstream
   * ('origin/main') the user can merge instead. The pull still fetched.
   */
  mergeable?: string
}

/**
 * What merging a branch into the checked-out one would do. Worked out without touching the working
 * tree, the index or any branch (`git merge-tree`).
 */
export type MergeOutcome =
  /** The checked-out branch already has every commit of the other. */
  | 'up-to-date'
  /** The checked-out branch can just move forward to the other; no merge commit. */
  | 'fast-forward'
  /** A merge commit with both branches as parents (after resolving any conflicts). */
  | 'merge-commit'
  /** A merge commit is needed, but the user's git (`merge.ff=only`) allows only fast-forwards. */
  | 'fast-forward-only'

export interface MergePreview {
  /** The branch to merge, as the branch list names it ('feature/login', 'origin/main'). */
  branch: string
  /** The checked-out branch it merges into. */
  into: string
  /** Full hashes the preview was worked out from; a later call is refused if either branch has moved. */
  ours: string
  theirs: string
  /** Commits `branch` has that `into` doesn't. */
  commits: number
  outcome: MergeOutcome
  /** Files both branches changed in clashing ways, which the user resolves in the app. */
  conflicts: string[]
  /** Clashing files the app can't resolve (deleted on one side, binary, a link): only a terminal merge can. */
  unresolvable: string[]
  /** Files with uncommitted changes that the merge would change too: the merge waits until they're committed or stashed. */
  blockedBy: string[]
}

/**
 * Something started outside the app that git is still in the middle of. `conflicts`: unmerged files
 * with none of the others under way (a `git stash pop` that stopped, say).
 */
export type UnfinishedOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'conflicts'

/** Which merge a call is about: the branch, what it merges into, and the two commits its preview was worked out from. */
export interface MergeRequest {
  branch: string
  into: string
  ours: string
  theirs: string
}

/** A conflicted file's three versions as text. `base` is null when both branches added the file. */
export interface ConflictFile {
  path: string
  base: string | null
  ours: string
  theirs: string
}

/** The text the user settled on for one conflicted file. */
export interface MergeResolution {
  path: string
  text: string
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

/** What to clone, and the name of the folder to clone it into (inside the folder the user picked). */
export interface CloneRequest {
  url: string
  name: string
}

/** How far a clone has got, as git reports it ('Receiving objects', 42). */
export interface CloneProgress {
  phase: string
  percent: number
}

/**
 * One side of a comparison: a file in one of the listed repositories, as it is in the working tree
 * (`branch` null) or on a branch, or a file the user picked anywhere on disk. A picked file is known by
 * the id the source gave it, never by a path the renderer sends.
 */
export type CompareSide =
  | { kind: 'repository'; repoId: string; branch: string | null; path: string }
  | { kind: 'file'; fileId: string }

/** A file picked on disk for comparing: its id for compareFiles, and its path to show. */
export interface PickedFile {
  fileId: string
  path: string
}
