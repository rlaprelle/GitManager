import { type DeepReadonly, type Ref, computed, readonly, ref } from 'vue'
import { NO_PANE_SIZES, type Pane, type PaneSizes, parsePaneSizes, serializePaneSizes } from '@/lib/paneLayout'

export const PANE_SIZES_KEY = 'gm.paneSizes'

/** The part of Web Storage this needs; tests pass an in-memory one. */
export type PaneStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The custom property each pane's size is published as; the layout's CSS reads these. */
const CSS_VARIABLE: Record<Pane, string> = {
  sidebar: '--gm-sidebar-size',
  repositories: '--gm-repositories-size',
  diff: '--gm-diff-size',
  fileList: '--gm-file-list-size',
}

/**
 * The sizes the user dragged the panes to: one set for the whole app, kept across restarts in
 * localStorage (the desktop app's lives in its data folder). Layout state, not git state, so it
 * lives apart from useGitManager. Storage that is missing or refuses only costs the remembering.
 */
export function usePaneSizes(storage: PaneStorage | null = browserStorage()): {
  sizes: DeepReadonly<Ref<PaneSizes>>
  paneVars: Readonly<Ref<Record<string, string>>>
  setPaneSize: (pane: Pane, size: number) => void
  resetPaneSize: (pane: Pane) => void
} {
  const sizes = ref<PaneSizes>(load(storage))

  function update(pane: Pane, size: number | null) {
    sizes.value = { ...sizes.value, [pane]: size }
    save(storage, sizes.value)
  }

  const paneVars = computed(() => {
    const entries = Object.entries(sizes.value).filter(([, size]) => size !== null)
    return Object.fromEntries(entries.map(([pane, size]) => [CSS_VARIABLE[pane as Pane], `${size}px`]))
  })

  return {
    sizes: readonly(sizes),
    paneVars,
    setPaneSize: (pane, size) => update(pane, size),
    resetPaneSize: (pane) => update(pane, null),
  }
}

function browserStorage(): PaneStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function load(storage: PaneStorage | null): PaneSizes {
  try {
    return parsePaneSizes(storage?.getItem(PANE_SIZES_KEY) ?? null)
  } catch {
    return { ...NO_PANE_SIZES }
  }
}

function save(storage: PaneStorage | null, sizes: PaneSizes) {
  try {
    storage?.setItem(PANE_SIZES_KEY, serializePaneSizes(sizes))
  } catch {
    // Full or blocked storage: the size still applies until the app closes.
  }
}
