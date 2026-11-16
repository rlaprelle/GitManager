import { describe, expect, it } from 'vitest'
import { NO_PANE_SIZES, arrowKeyStep, clampPaneSize, parsePaneSizes, serializePaneSizes, sizeAfterMove } from '../paneLayout'

describe('clampPaneSize', () => {
  it('keeps a size between the pane’s minimum and what its neighbour leaves', () => {
    expect(clampPaneSize(300, 180, 1000, 720)).toBe(280)
    expect(clampPaneSize(100, 180, 1000, 720)).toBe(180)
    expect(clampPaneSize(240, 180, 1000, 720)).toBe(240)
  })

  it('rounds to whole pixels', () => {
    expect(clampPaneSize(240.6, 180, 1000, 720)).toBe(241)
  })

  it('gives the pane its minimum when the container is too small for both', () => {
    expect(clampPaneSize(300, 180, 800, 720)).toBe(180)
  })
})

describe('sizeAfterMove', () => {
  it('grows the pane before the divider as the divider moves right or down', () => {
    expect(sizeAfterMove(260, 40, 'previous')).toBe(300)
  })

  it('shrinks the pane after the divider as the divider moves right or down', () => {
    expect(sizeAfterMove(400, 40, 'next')).toBe(360)
  })
})

describe('arrowKeyStep', () => {
  it('moves a vertical divider with Left and Right, further with Shift', () => {
    expect(arrowKeyStep('ArrowRight', false, 'vertical')).toBe(16)
    expect(arrowKeyStep('ArrowLeft', false, 'vertical')).toBe(-16)
    expect(arrowKeyStep('ArrowLeft', true, 'vertical')).toBe(-64)
  })

  it('moves a horizontal divider with Up and Down', () => {
    expect(arrowKeyStep('ArrowDown', false, 'horizontal')).toBe(16)
    expect(arrowKeyStep('ArrowUp', true, 'horizontal')).toBe(-64)
  })

  it('ignores the other axis’s arrows and other keys', () => {
    expect(arrowKeyStep('ArrowUp', false, 'vertical')).toBeNull()
    expect(arrowKeyStep('ArrowLeft', false, 'horizontal')).toBeNull()
    expect(arrowKeyStep('Enter', false, 'vertical')).toBeNull()
  })
})

describe('parsePaneSizes', () => {
  it('reads saved sizes, leaving unsaved panes at their default', () => {
    expect(parsePaneSizes('{"sidebar":320,"diff":300}')).toEqual({ ...NO_PANE_SIZES, sidebar: 320, diff: 300 })
  })

  it('falls back to the defaults for anything that isn’t a saved size', () => {
    expect(parsePaneSizes(null)).toEqual(NO_PANE_SIZES)
    expect(parsePaneSizes('not json')).toEqual(NO_PANE_SIZES)
    expect(parsePaneSizes('[1,2]')).toEqual(NO_PANE_SIZES)
    expect(parsePaneSizes('{"sidebar":"wide","diff":-5,"fileList":null,"repositories":1e999,"other":4}')).toEqual(
      NO_PANE_SIZES,
    )
  })

  it('round-trips through serializePaneSizes, which leaves out unsized panes', () => {
    const sizes = { ...NO_PANE_SIZES, repositories: 150, fileList: 260 }
    expect(serializePaneSizes(sizes)).toBe('{"repositories":150,"fileList":260}')
    expect(parsePaneSizes(serializePaneSizes(sizes))).toEqual(sizes)
  })
})
