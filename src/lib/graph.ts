import type { GraphRow } from '@/types/git'
import { MAX_LANES } from './laneLayout'

/**
 * Lane colours are fixed by position, independent of the UI accent. The first three are the
 * design's; the rest extend it for busier histories, one per lane up to MAX_LANES.
 */
export const LANE_COLORS = [
  '#5b9dff',
  '#f0a35e',
  '#c792ea',
  '#5fcf9a',
  '#ef7f9a',
  '#e3c55c',
  '#59c7d6',
  '#a7b0c4',
] as const satisfies readonly string[] & { length: typeof MAX_LANES }

export const ROW_HEIGHT = 32

const MID = ROW_HEIGHT / 2
const FIRST_LANE_X = 14
const LANE_SPACING = 18
/** The design's column, wide enough for three lanes. */
const MIN_GRAPH_WIDTH = 64

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
  return FIRST_LANE_X + LANE_SPACING * lane
}

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!
}

/** How many lanes the rows use, counting lines and curves as well as dots. */
export function laneCount(rows: GraphRow[]): number {
  const lanes = rows.flatMap((row) => [row.lane, ...row.top, ...row.bottom, ...row.curvesIn, ...row.curvesOut])
  return Math.max(0, ...lanes) + 1
}

/** Width of the graph column for this many lanes: the same margin either side of the outer lanes. */
export function graphWidth(lanes: number): number {
  return Math.max(MIN_GRAPH_WIDTH, laneX(lanes - 1) + FIRST_LANE_X)
}

export function graphGeometry(row: GraphRow): GraphGeometry {
  return {
    segments: [...segmentsFor(row.top, 0, MID), ...segmentsFor(row.bottom, MID, ROW_HEIGHT)],
    curves: [...row.curvesIn.map((from) => curveIn(from, row.lane)), ...row.curvesOut.map((to) => curveOut(row.lane, to))],
    dot: { cx: laneX(row.lane), cy: MID, color: laneColor(row.lane) },
  }
}

function segmentsFor(lanes: number[], y1: number, y2: number): GraphSegment[] {
  return lanes.map((lane) => ({ x: laneX(lane), y1, y2, color: laneColor(lane) }))
}

function curveIn(fromLane: number, dotLane: number): GraphCurve {
  const fromX = laneX(fromLane)
  const dotX = laneX(dotLane)
  return { d: `M ${fromX} 0 C ${fromX} 10 ${dotX} 6 ${dotX} ${MID}`, color: laneColor(fromLane) }
}

function curveOut(dotLane: number, toLane: number): GraphCurve {
  const dotX = laneX(dotLane)
  const toX = laneX(toLane)
  return { d: `M ${dotX} ${MID} C ${dotX} 26 ${toX} 22 ${toX} ${ROW_HEIGHT}`, color: laneColor(toLane) }
}
