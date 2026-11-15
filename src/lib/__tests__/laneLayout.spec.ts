import { describe, expect, it } from 'vitest'
import type { GraphRow } from '@/types/git'
import { type LayoutCommit, layoutLanes } from '../laneLayout'

function row(lane: number, top: number[], bottom: number[], curves: Partial<Pick<GraphRow, 'curvesIn' | 'curvesOut'>> = {}): GraphRow {
  return { lane, top, bottom, curvesIn: curves.curvesIn ?? [], curvesOut: curves.curvesOut ?? [] }
}

/** 'b:a' means commit b has parent a; 'm:a,b' is a merge. Listed newest first. */
function commits(...specs: string[]): LayoutCommit[] {
  return specs.map((spec) => {
    const [hash, parents = ''] = spec.split(':')
    return { hash: hash!, parents: parents ? parents.split(',') : [] }
  })
}

describe('layoutLanes', () => {
  it('draws a linear history in one lane, ending at the root', () => {
    expect(layoutLanes(commits('c:b', 'b:a', 'a'))).toEqual([
      row(0, [], [0]),
      row(0, [0], [0]),
      row(0, [0], []),
    ])
  })

  it('keeps the line running past the bottom when a parent is older than the page', () => {
    expect(layoutLanes(commits('b:a', 'a:older')).at(-1)).toEqual(row(0, [0], [0]))
  })

  // The inventory-service graph from the design, which keeps main in lane 0.
  it('reproduces the design: main keeps lane 0, a feature branch and a merged fix take lanes 1 and 2', () => {
    const history = commits(
      'feat2:feat1', //          feature/stock-reservations tip
      'feat1:feat0',
      'merge:bump,fix', //       main: merge of bugfix/sku-null-check
      'fix:release', //          bugfix/sku-null-check
      'feat0:bump', //           feature forked from "Bump Spring Boot"
      'bump:release',
      'release:paginate', //     origin/release/2.4
      'paginate:cache',
      'cache:health',
      'health:older',
    )
    expect(layoutLanes(history, 'merge')).toEqual([
      row(1, [], [1]),
      row(1, [1], [1]),
      row(0, [1], [0, 1], { curvesOut: [2] }),
      row(2, [0, 1, 2], [0, 1, 2]),
      row(1, [0, 1, 2], [0, 1, 2]),
      row(0, [0, 2], [0, 2], { curvesIn: [1] }),
      row(0, [0], [0], { curvesIn: [2] }),
      row(0, [0], [0]),
      row(0, [0], [0]),
      row(0, [0], [0]),
    ])
  })

  it('lets commits built directly on main share its lane', () => {
    const history = commits('dev2:dev1', 'dev1:main', 'main:root', 'root')
    expect(layoutLanes(history, 'main').map((r) => r.lane)).toEqual([0, 0, 0, 0])
  })

  it('without a primary branch in view, gives the newest commit lane 0', () => {
    const history = commits('b2:b1', 'a1:root', 'b1:root', 'root')
    expect(layoutLanes(history, 'not-in-page').map((r) => r.lane)).toEqual([0, 1, 0, 0])
  })

  it('joins two branches that fork from one commit with a curve from the right-hand lane', () => {
    const history = commits('left:base', 'right:base', 'base')
    expect(layoutLanes(history)).toEqual([
      row(0, [], [0]),
      row(1, [0], [0, 1]),
      row(0, [0], [], { curvesIn: [1] }),
    ])
  })

  it('draws an octopus merge with a curve out to a new lane for each extra parent', () => {
    const history = commits('octo:a,b,c', 'a:base', 'b:base', 'c:base', 'base')
    expect(layoutLanes(history)[0]).toEqual(row(0, [], [0], { curvesOut: [1, 2] }))
  })

  it('merges into a line that already runs to the second parent instead of opening a lane', () => {
    const history = commits('tip:shared', 'merge:main1,shared', 'main1:root', 'shared:root', 'root')
    const rows = layoutLanes(history)
    expect(rows[0]).toEqual(row(0, [], [0]))
    expect(rows[1]).toEqual(row(1, [0], [0, 1], { curvesOut: [0] }))
  })

  it('reuses the leftmost lane once its branch has joined another', () => {
    // t2's lane ends when it curves into m, so t3 starts there.
    const history = commits('t1:m', 't2:m', 'm:r', 't3:r', 'r')
    expect(layoutLanes(history).map((r) => r.lane)).toEqual([0, 1, 0, 1, 0])
  })

  it('puts branches beyond the lane limit in the last lane', () => {
    const tips = ['t0', 't1', 't2', 't3'].map((tip) => `${tip}:base`)
    const lanes = layoutLanes(commits(...tips, 'base'), undefined, 3).map((r) => r.lane)
    expect(lanes).toEqual([0, 1, 2, 2, 0])
  })

  it('keeps track of every branch sharing the last lane, so none loses its line', () => {
    // With two lanes, b and c share lane 1; pc ends its line there but pb's must continue.
    const rows = layoutLanes(commits('a:pa', 'b:pb', 'c:pc', 'pa', 'pc', 'pb'), undefined, 2)
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 1, 0, 1, 1])
    expect(rows[4]).toEqual(row(1, [1], [1]))
    expect(rows[5]).toEqual(row(1, [1], []))
  })
})
