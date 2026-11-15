import { describe, expect, it } from 'vitest'
import { LaneTable } from '../laneTable'

describe('LaneTable', () => {
  it('never hands out lane 0 when it is kept for the primary line', () => {
    expect(new LaneTable(8, true).firstFreeLane()).toBe(1)
    expect(new LaneTable(8, false).firstFreeLane()).toBe(0)
  })

  it('puts lines beyond the limit in the last lane, which then heads to all of them', () => {
    const table = new LaneTable(2, false)
    table.headTo(table.firstFreeLane(), 'a')
    table.headTo(table.firstFreeLane(), 'b')
    table.headTo(table.firstFreeLane(), 'c')

    expect(table.occupied()).toEqual([0, 1])
    expect(table.lanesHeadingTo('b')).toEqual([1])
    expect(table.lanesHeadingTo('c')).toEqual([1])
  })

  it('runs every line into a row except one that only curves into its commit from another lane', () => {
    const table = new LaneTable(4, false)
    table.headTo(0, 'b') // b's own lane
    table.headTo(1, 'b') // a branch that ends at b, curving in
    table.headTo(2, 'c') // passing by
    table.headTo(3, 'b') // the shared last lane: it ends at b but carries on to c
    table.headTo(3, 'c')

    expect(table.linesIntoRow('b', 0)).toEqual([0, 2, 3])
    table.arrive('b')
    expect(table.lanesHeadingTo('b')).toEqual([])
    expect(table.lanesHeadingTo('c')).toEqual([2, 3])
  })

  it('joins an extra parent to a line already heading there, and opens a lane otherwise', () => {
    const table = new LaneTable(8, false)
    table.headTo(0, 'first parent')
    table.headTo(2, 'shared')

    expect(table.connectExtraParents(0, ['shared', 'fresh'])).toEqual({ curvesOut: [2, 1], opened: [1] })
  })
})
