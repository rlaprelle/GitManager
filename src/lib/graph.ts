import type { GraphRow, LaneFlags } from '@/types/git'

/** Lane colours are fixed by position, independent of the UI accent. */
export const LANE_COLORS = ['#5b9dff', '#f0a35e', '#c792ea'] as const
export const GRAPH_WIDTH = 64
export const ROW_HEIGHT = 32

const MID = ROW_HEIGHT / 2

export interface GraphSegment {
  x: number
  y1: number
  y2: number
  color: string
}

export interface GraphCurve {
  d: string
  color: string
}

export interface GraphGeometry {
  segments: GraphSegment[]
  curves: GraphCurve[]
  dot: { cx: number; cy: number; color: string }
}

export function laneX(lane: number): number {
  return 14 + 18 * lane
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane] ?? LANE_COLORS[0]
}

export function graphGeometry(row: GraphRow): GraphGeometry {
  return {
    segments: [...segmentsFor(row.top, 0, MID), ...segmentsFor(row.bottom, MID, ROW_HEIGHT)],
    curves: curvesFor(row),
    dot: { cx: laneX(row.lane), cy: MID, color: laneColor(row.lane) },
  }
}

function segmentsFor(flags: LaneFlags, y1: number, y2: number): GraphSegment[] {
  return flags.flatMap((drawn, lane) => (drawn ? [{ x: laneX(lane), y1, y2, color: laneColor(lane) }] : []))
}

function curvesFor(row: GraphRow): GraphCurve[] {
  const curves: GraphCurve[] = []
  const dotX = laneX(row.lane)

  if (row.curveInFrom !== null) {
    const fromX = laneX(row.curveInFrom)
    curves.push({ d: `M ${fromX} 0 C ${fromX} 10 ${dotX} 6 ${dotX} ${MID}`, color: laneColor(row.curveInFrom) })
  }
  if (row.curveOutTo !== null) {
    const toX = laneX(row.curveOutTo)
    curves.push({
      d: `M ${dotX} ${MID} C ${dotX} 26 ${toX} 22 ${toX} ${ROW_HEIGHT}`,
      color: laneColor(row.curveOutTo),
    })
  }
  return curves
}
