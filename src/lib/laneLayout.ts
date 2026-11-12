import type { Branches, GraphRow } from '@/types/git'

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
  // Each lane holds the commits its line is heading down to. Only the last lane, once lanes
  // run out, ever holds more than one.
  const lanes: Set<string>[] = []
  const firstFreeLane = (): number => {
    const reserved = primaryLine.size > 0 ? 1 : 0
    for (let lane = reserved; lane < maxLanes; lane++) {
      if (!lanes[lane]?.size) return lane
    }
    return maxLanes - 1
  }
  const occupied = (): number[] => lanes.flatMap((targets, lane) => (targets?.size ? [lane] : []))
  const headTo = (lane: number, hash: string): void => {
    ;(lanes[lane] ??= new Set()).add(hash)
  }

  return commits.map((commit) => {
    const waiting = occupied().filter((lane) => lanes[lane]!.has(commit.hash))
    const lane = primaryLine.has(commit.hash) ? 0 : (waiting[0] ?? firstFreeLane())

    const top = occupied().filter((other) => other === lane ? waiting.includes(lane) : hasOtherTargets(lanes[other]!, commit.hash))
    const curvesIn = waiting.filter((other) => other !== lane)
    for (const other of waiting) lanes[other]!.delete(commit.hash)

    const [firstParent, ...otherParents] = commit.parents
    if (firstParent) headTo(lane, firstParent)
    const curvesOut: number[] = []
    const opened: number[] = []
    for (const parent of otherParents) {
      const existing = occupied().find((other) => other !== lane && lanes[other]!.has(parent))
      if (existing !== undefined) {
        curvesOut.push(existing)
        continue
      }
      const target = firstFreeLane()
      headTo(target, parent)
      curvesOut.push(target)
      opened.push(target)
    }
    const bottom = occupied().filter((other) => !opened.includes(other))

    return { lane, top, bottom, curvesIn, curvesOut }
  })
}

function hasOtherTargets(targets: Set<string>, hash: string): boolean {
  return targets.size > (targets.has(hash) ? 1 : 0)
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
