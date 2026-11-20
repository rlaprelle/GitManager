import { describe, expect, it } from 'vitest'
import { NOT_IN_RESULT, NO_SIDE_LINES, ribbonPath } from '../mergeRibbon'

describe('ribbonPath', () => {
  it('runs from ours, on the gutter’s left, to the result on its right, and closes', () => {
    expect(ribbonPath('ours', [20, 60], [0, 40], 40)).toBe('M0,20 C20,20 20,0 40,0 L40,40 C20,40 20,60 0,60 Z')
  })

  it('runs from theirs, on the gutter’s right, to the result on its left', () => {
    expect(ribbonPath('theirs', [20, 60], [0, 40], 40)).toBe('M40,20 C20,20 20,0 0,0 L0,40 C20,40 20,60 40,60 Z')
  })

  it('bends at the middle of the gutter, however wide it is', () => {
    expect(ribbonPath('ours', [0, 20], [0, 20], 30)).toBe('M0,0 C15,0 15,0 30,0 L30,20 C15,20 15,20 0,20 Z')
  })

  it('starts from a sliver when the side has no lines of its own', () => {
    expect(NO_SIDE_LINES).toEqual([0, 2])
    expect(ribbonPath('ours', null, [0, 40], 40)).toBe('M0,0 C20,0 20,0 40,0 L40,40 C20,40 20,2 0,2 Z')
  })

  it('closes to a point at the top of the result while the lines aren’t in it', () => {
    expect(NOT_IN_RESULT).toEqual([0, 0])
    expect(ribbonPath('theirs', [20, 60], null, 40)).toBe('M40,20 C20,20 20,0 0,0 L0,0 C20,0 20,60 40,60 Z')
  })
})
