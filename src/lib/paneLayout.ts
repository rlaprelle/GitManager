/** The panes a divider resizes. */
export type Pane = 'sidebar' | 'repositories' | 'diff' | 'fileList'

/** A dragged size per pane, in px; null keeps the pane's own default layout. */
export type PaneSizes = Record<Pane, number | null>

export const NO_PANE_SIZES: Readonly<PaneSizes> = { sidebar: null, repositories: null, diff: null, fileList: null }

const PANES = Object.keys(NO_PANE_SIZES) as Pane[]

/**
 * Each pane's smallest size, and the space its neighbour keeps however far the divider moves (px).
 * The reserves are what the neighbour needs not to break: the main area's file list and diff side by
 * side (720), the diff column beside the file list (480), History's own minimum (220), a few branches (140).
 */
export const PANE_LIMITS: Readonly<Record<Pane, { min: number; reserve: number }>> = {
  sidebar: { min: 180, reserve: 720 },
  repositories: { min: 72, reserve: 140 },
  diff: { min: 240, reserve: 220 },
  fileList: { min: 160, reserve: 480 },
}

/** A pane's size kept within its minimum and what the neighbour keeps; the minimum wins if both can't fit. */
export function clampPaneSize(size: number, min: number, containerSize: number, reserve: number): number {
  return Math.round(Math.max(min, Math.min(size, containerSize - reserve)))
}

/**
 * Which pane a divider resizes: the one before it (sidebar, repositories, file list) grows as the
 * divider moves right or down; the one after it (the diff panel) shrinks.
 */
export type DividerControls = 'previous' | 'next'

export function sizeAfterMove(startSize: number, movedBy: number, controls: DividerControls): number {
  return controls === 'previous' ? startSize + movedBy : startSize - movedBy
}

/** ARIA's naming: a vertical separator sits between left and right panes, a horizontal one between top and bottom. */
export type DividerOrientation = 'vertical' | 'horizontal'

const KEY_STEP = 16
const LARGE_KEY_STEP = 64

/** How far an arrow key moves a divider along its axis (px, positive is right or down), or null for any other key. */
export function arrowKeyStep(key: string, shiftKey: boolean, orientation: DividerOrientation): number | null {
  const [back, forward] = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  const step = shiftKey ? LARGE_KEY_STEP : KEY_STEP
  if (key === forward) return step
  if (key === back) return -step
  return null
}

/** Saved sizes from storage. Anything unreadable leaves that pane, or every pane, at its default. */
export function parsePaneSizes(text: string | null): PaneSizes {
  const saved = parseObject(text)
  const sizes: PaneSizes = { ...NO_PANE_SIZES }
  for (const pane of PANES) {
    const value = saved[pane]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) sizes[pane] = Math.round(value)
  }
  return sizes
}

function parseObject(text: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text ?? '')
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The sized panes only, so a pane put back to its default leaves nothing behind. */
export function serializePaneSizes(sizes: PaneSizes): string {
  return JSON.stringify(Object.fromEntries(PANES.filter((pane) => sizes[pane] !== null).map((pane) => [pane, sizes[pane]])))
}
