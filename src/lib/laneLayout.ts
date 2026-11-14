import type { Branches, GraphRow } from '@/types/git'
import { LaneTable, PRIMARY_LANE } from './laneTable'

export interface LayoutCommit {
  hash: string
  /** First parent first, as git lists them. Parents may be older than the page. */
  parents: string[]
}

/** Lanes beyond this share the last one, so the graph column has a fixed maximum width. */
export const MAX_LANES = 8

/**
 * Assigns each commit of a newest-first history page a lane, and works out the lines and
 * curves of its graph row.
 *
 * Lane 0 belongs to the primary branch's first-parent line, extended upward through any
 * commits built directly on top of it (so `develop` ahead of `main` shares its lane, while
 * a branch that forked earlier gets a lane of its own). Every other branch takes the
 * leftmost free lane. A branch keeps its lane down to its parent's row and curves into the
 * parent's dot there; a merge's extra parents get a curve out of the merge's dot.
 */
export function layoutLanes(commits: LayoutCommit[], primaryTip?: string, maxLanes = MAX_LANES): GraphRow[] {
  const primaryLine = primaryLineOf(commits, primaryTip)
  const table = new LaneTable(maxLanes, primaryLine.size > 0)
  return commits.map((commit) => rowOf(commit, table, primaryLine))
}

/** Places one commit in the table and reads its row's lines; rows must come newest first. */
function rowOf(commit: LayoutCommit, table: LaneTable, primaryLine: Set<string>): GraphRow {
  const waiting = table.lanesHeadingTo(commit.hash)
  const lane = primaryLine.has(commit.hash) ? PRIMARY_LANE : (waiting[0] ?? table.firstFreeLane())
  const top = table.linesIntoRow(commit.hash, lane)
  table.arrive(commit.hash)

  const [firstParent, ...otherParents] = commit.parents
  if (firstParent) table.headTo(lane, firstParent)
  const { curvesOut, opened } = table.connectExtraParents(lane, otherParents)
  const bottom = table.occupied().filter((other) => !opened.includes(other))

  return { lane, top, bottom, curvesIn: waiting.filter((other) => other !== lane), curvesOut }
}

/**
 * The commits of lane 0: the first-parent line from the newest commit whose first-parent
 * ancestry (within the page) includes the primary tip. Empty when the tip isn't in the page.
 */
function primaryLineOf(commits: LayoutCommit[], primaryTip: string | undefined): Set<string> {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]))
  if (!primaryTip || !byHash.has(primaryTip)) return new Set()

  const reachesTip = new Map<string, boolean>()
  for (const commit of [...commits].reverse()) {
    const firstParent = commit.parents[0]
    reachesTip.set(commit.hash, commit.hash === primaryTip || (firstParent !== undefined && reachesTip.get(firstParent) === true))
  }
  const start = commits.find((commit) => reachesTip.get(commit.hash))
  const line = new Set<string>()
  for (let current = start; current; current = byHash.get(current.parents[0] ?? '')) line.add(current.hash)
  return line
}

/** Branch names whose line keeps lane 0, most preferred first. */
const PRIMARY_BRANCH_NAMES = ['main', 'master', 'origin/main', 'origin/master']

/** The tip of the branch the graph keeps in lane 0, or undefined when there's none of them. */
export function primaryBranchTip(branches: Branches): string | undefined {
  const all = [...branches.local, ...branches.remote]
  for (const name of PRIMARY_BRANCH_NAMES) {
    const branch = all.find((candidate) => candidate.name === name)
    if (branch) return branch.tipHash
  }
  return undefined
}
