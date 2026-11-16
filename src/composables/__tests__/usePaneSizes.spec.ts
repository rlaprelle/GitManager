import { describe, expect, it } from 'vitest'
import { NO_PANE_SIZES } from '@/lib/paneLayout'
import { PANE_SIZES_KEY, type PaneStorage, usePaneSizes } from '../usePaneSizes'

function memoryStorage(initial: Record<string, string> = {}): PaneStorage & { items: Record<string, string> } {
  const items = { ...initial }
  return {
    items,
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

describe('usePaneSizes', () => {
  it('starts from the saved sizes', () => {
    const { sizes } = usePaneSizes(memoryStorage({ [PANE_SIZES_KEY]: '{"sidebar":320}' }))
    expect(sizes.value).toEqual({ ...NO_PANE_SIZES, sidebar: 320 })
  })

  it('starts with every pane at its default when nothing is saved', () => {
    expect(usePaneSizes(memoryStorage()).sizes.value).toEqual(NO_PANE_SIZES)
  })

  it('saves a new size straight away, for the next start', () => {
    const storage = memoryStorage()
    const { sizes, setPaneSize } = usePaneSizes(storage)
    setPaneSize('diff', 310)
    expect(sizes.value.diff).toBe(310)
    expect(usePaneSizes(storage).sizes.value.diff).toBe(310)
  })

  it('reset puts a pane back to its default and forgets its size', () => {
    const storage = memoryStorage({ [PANE_SIZES_KEY]: '{"sidebar":320,"diff":300}' })
    const { sizes, resetPaneSize } = usePaneSizes(storage)
    resetPaneSize('sidebar')
    expect(sizes.value).toEqual({ ...NO_PANE_SIZES, diff: 300 })
    expect(storage.items[PANE_SIZES_KEY]).toBe('{"diff":300}')
  })

  it('exposes sized panes as CSS custom properties, and nothing for the rest', () => {
    const { paneVars, setPaneSize } = usePaneSizes(memoryStorage())
    expect(paneVars.value).toEqual({})
    setPaneSize('sidebar', 320)
    setPaneSize('fileList', 250)
    expect(paneVars.value).toEqual({ '--gm-sidebar-size': '320px', '--gm-file-list-size': '250px' })
  })

  it('still resizes when storage is unavailable or refuses to save', () => {
    const refusing: PaneStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    for (const storage of [null, refusing]) {
      const { sizes, setPaneSize } = usePaneSizes(storage)
      expect(sizes.value).toEqual(NO_PANE_SIZES)
      setPaneSize('repositories', 120)
      expect(sizes.value.repositories).toBe(120)
    }
  })
})
