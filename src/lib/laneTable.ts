/** Lane 0 belongs to the primary branch's line whenever that line is in the page. */
export const PRIMARY_LANE = 0

/** The lanes a merge's extra parents curve out to, and which of them it had to open. */
export interface ExtraParentLanes {
  curvesOut: number[]
  opened: number[]
}

/**
 * The graph's lanes while a page is laid out, newest commit first. Each lane holds the commits
 * its line is heading down to. Only the last lane, once lanes run out, ever holds more than one.
 */
export class LaneTable {
  private readonly lanes: Set<string>[] = []
  private readonly maxLanes: number
  private readonly firstOpenLane: number

  /** `reservePrimaryLane`: keep lane 0 for the primary line, so no other branch takes it. */
  constructor(maxLanes: number, reservePrimaryLane: boolean) {
    this.maxLanes = maxLanes
    this.firstOpenLane = reservePrimaryLane ? PRIMARY_LANE + 1 : PRIMARY_LANE
  }

  /** Lanes with a line in them, left to right. */
  occupied(): number[] {
    return this.lanes.flatMap((targets, lane) => (targets?.size ? [lane] : []))
  }

  lanesHeadingTo(hash: string): number[] {
    return this.occupied().filter((lane) => this.lanes[lane]!.has(hash))
  }

  /** The leftmost empty lane; the last lane when all are taken. */
  firstFreeLane(): number {
    for (let lane = this.firstOpenLane; lane < this.maxLanes; lane++) {
      if (!this.lanes[lane]?.size) return lane
    }
    return this.maxLanes - 1
  }

  /**
   * The lines entering the top of `hash`'s row: its own lane if a line was heading to it there,
   * and every other lane still heading somewhere besides this commit.
   */
  linesIntoRow(hash: string, lane: number): number[] {
    return this.occupied().filter((other) => (other === lane ? this.lanes[lane]!.has(hash) : this.hasOtherTargets(other, hash)))
  }

  /** The commit's row is reached: no line heads to it any more. */
  arrive(hash: string): void {
    for (const targets of this.lanes) targets?.delete(hash)
  }

  headTo(lane: number, hash: string): void {
    ;(this.lanes[lane] ??= new Set()).add(hash)
  }

  /** Each extra parent joins a line already heading to it, or opens the first free lane. */
  connectExtraParents(lane: number, parents: string[]): ExtraParentLanes {
    const connections = parents.map((parent) => this.connectExtraParent(lane, parent))
    return {
      curvesOut: connections.map((connection) => connection.lane),
      opened: connections.filter((connection) => connection.opened).map((connection) => connection.lane),
    }
  }

  private connectExtraParent(lane: number, parent: string): { lane: number; opened: boolean } {
    const existing = this.lanesHeadingTo(parent).find((other) => other !== lane)
    if (existing !== undefined) return { lane: existing, opened: false }
    const target = this.firstFreeLane()
    this.headTo(target, parent)
    return { lane: target, opened: true }
  }

  private hasOtherTargets(lane: number, hash: string): boolean {
    const targets = this.lanes[lane]!
    return targets.size > (targets.has(hash) ? 1 : 0)
  }
}
