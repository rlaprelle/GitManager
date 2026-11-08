import { describe, expect, it } from 'vitest'
import type { GraphRow } from '@/types/git'
import { LANE_COLORS, graphGeometry, laneX } from './graph'

const plain: GraphRow = {
  lane: 0,
  top: [true, false, false],
  bottom: [true, false, false],
  curveInFrom: null,
  curveOutTo: null,
}

describe('laneX', () => {
  it('spaces lanes 18px apart starting at 14px', () => {
    expect([0, 1, 2].map(laneX)).toEqual([14, 32, 50])
  })
})

describe('graphGeometry', () => {
  it('places the dot in its lane at the row centre, in the lane colour', () => {
    const { dot } = graphGeometry({ ...plain, lane: 2 })
    expect(dot).toEqual({ cx: 50, cy: 16, color: LANE_COLORS[2] })
  })

  it('draws a top-half and bottom-half segment for each flagged lane only', () => {
    const { segments } = graphGeometry({ ...plain, top: [true, false, true], bottom: [false, true, false] })
    expect(segments).toEqual([
      { x: 14, y1: 0, y2: 16, color: LANE_COLORS[0] },
      { x: 50, y1: 0, y2: 16, color: LANE_COLORS[2] },
      { x: 32, y1: 16, y2: 32, color: LANE_COLORS[1] },
    ])
  })

  it('has no curves when the row neither merges in nor branches out', () => {
    expect(graphGeometry(plain).curves).toEqual([])
  })

  it('curves in from another lane at the top edge, coloured by the source lane', () => {
    const { curves } = graphGeometry({ ...plain, curveInFrom: 1 })
    expect(curves).toEqual([{ d: 'M 32 0 C 32 10 14 6 14 16', color: LANE_COLORS[1] }])
  })

  it('curves out to another lane at the bottom edge, coloured by the target lane', () => {
    const { curves } = graphGeometry({ ...plain, curveOutTo: 2 })
    expect(curves).toEqual([{ d: 'M 14 16 C 14 26 50 22 50 32', color: LANE_COLORS[2] }])
  })
})
