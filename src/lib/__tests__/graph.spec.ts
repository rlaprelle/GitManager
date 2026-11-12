import { describe, expect, it } from 'vitest'
import type { GraphRow } from '@/types/git'
import { LANE_COLORS, graphGeometry, graphWidth, laneColor, laneCount, laneX } from '../graph'

const plain: GraphRow = { lane: 0, top: [0], bottom: [0], curvesIn: [], curvesOut: [] }

describe('laneX', () => {
  it('spaces lanes 18px apart starting at 14px', () => {
    expect([0, 1, 2].map(laneX)).toEqual([14, 32, 50])
  })
})

describe('laneColor', () => {
  it('gives each of the eight lanes its own colour, keeping the design’s first three', () => {
    expect(LANE_COLORS.slice(0, 3)).toEqual(['#5b9dff', '#f0a35e', '#c792ea'])
    expect(new Set(LANE_COLORS).size).toBe(8)
    expect(laneColor(7)).toBe(LANE_COLORS[7])
  })
})

describe('laneCount and graphWidth', () => {
  it('counts every lane a row draws in, not just the dots', () => {
    const rows: GraphRow[] = [plain, { ...plain, top: [0, 4] }, { ...plain, curvesOut: [5] }]
    expect(laneCount(rows)).toBe(6)
    expect(laneCount([])).toBe(1)
  })

  it('keeps the design’s 64px column up to three lanes and widens 18px per extra lane', () => {
    expect([1, 3, 4, 8].map(graphWidth)).toEqual([64, 64, 82, 154])
  })
})

describe('graphGeometry', () => {
  it('places the dot in its lane at the row centre, in the lane colour', () => {
    const { dot } = graphGeometry({ ...plain, lane: 2 })
    expect(dot).toEqual({ cx: 50, cy: 16, color: LANE_COLORS[2] })
  })

  it('draws a top-half and bottom-half segment for each listed lane only', () => {
    const { segments } = graphGeometry({ ...plain, top: [0, 2], bottom: [1] })
    expect(segments).toEqual([
      { x: 14, y1: 0, y2: 16, color: LANE_COLORS[0] },
      { x: 50, y1: 0, y2: 16, color: LANE_COLORS[2] },
      { x: 32, y1: 16, y2: 32, color: LANE_COLORS[1] },
    ])
  })

  it('has no curves when the row neither joins nor merges', () => {
    expect(graphGeometry(plain).curves).toEqual([])
  })

  it('curves in from each joining lane at the top edge, coloured by that lane', () => {
    const { curves } = graphGeometry({ ...plain, curvesIn: [1, 3] })
    expect(curves).toEqual([
      { d: 'M 32 0 C 32 10 14 6 14 16', color: LANE_COLORS[1] },
      { d: 'M 68 0 C 68 10 14 6 14 16', color: LANE_COLORS[3] },
    ])
  })

  it('curves out to each merged lane at the bottom edge, coloured by that lane', () => {
    const { curves } = graphGeometry({ ...plain, curvesOut: [2] })
    expect(curves).toEqual([{ d: 'M 14 16 C 14 26 50 22 50 32', color: LANE_COLORS[2] }])
  })
})
