import type { MergeSide } from './mergeChunks'

// The shape of a merge screen ribbon: the band across a gutter that joins a side's changed lines
// to where they land in the result. Pure: MergeResolver measures the lines, this draws the outline.

/** Where a run of lines starts and ends, in pixels down from the top of its row. */
export type Extent = readonly [top: number, bottom: number]

/** A side with no lines of its own in a chunk (it deleted them) still gets a sliver to start its ribbon from. */
export const NO_SIDE_LINES: Extent = [0, 2]

/** Lines not in the result yet: the ribbon closes to a point at the top of the result's row. */
export const NOT_IN_RESULT: Extent = [0, 0]

/**
 * The ribbon's outline as an SVG path, in a gutter `width` pixels wide: along the top from the
 * side's edge to the result's, down the result's edge, and back along the bottom. Both long edges
 * are S-curves that leave and arrive level. Ours sits to the gutter's left with the result to its
 * right; theirs is the other way round. `from` or `to` is null when there are no lines to measure.
 */
export function ribbonPath(side: MergeSide, from: Extent | null, to: Extent | null, width: number): string {
  const [fromTop, fromBottom] = from ?? NO_SIDE_LINES
  const [toTop, toBottom] = to ?? NOT_IN_RESULT
  const middle = width / 2
  const [sideX, resultX] = side === 'ours' ? [0, width] : [width, 0]
  const topEdge = `M${sideX},${fromTop} C${middle},${fromTop} ${middle},${toTop} ${resultX},${toTop}`
  const bottomEdge = `L${resultX},${toBottom} C${middle},${toBottom} ${middle},${fromBottom} ${sideX},${fromBottom} Z`
  return `${topEdge} ${bottomEdge}`
}
