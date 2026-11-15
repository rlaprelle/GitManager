import type { Hunk } from '@/types/git'

export type LineKind = 'context' | 'add' | 'del'

export interface UnifiedLine {
  /** 'note' is git's "\ No newline at end of file": about the line before it, not a line of the file. */
  kind: LineKind | 'hunk' | 'note'
  oldNo: number | null
  newNo: number | null
  text: string
}

export type CellKind = 'context' | 'add' | 'del' | 'empty'

export interface SideCell {
  no: number | null
  text: string
  kind: CellKind
}

export type SideBySideRow =
  | { kind: 'separator'; label: string }
  | { kind: 'line'; left: SideCell; right: SideCell }

const EMPTY_CELL: SideCell = { no: null, text: '', kind: 'empty' }

/** The first character of each line in a hunk. */
const MARKER = { context: ' ', removed: '-', added: '+', note: '\\' } as const

/** The next line number on each side of a hunk, advanced as its lines are read. */
interface LineCursor {
  oldNo: number
  newNo: number
}

interface ContextRun {
  kind: 'context'
  text: string
}

/** A block of changed lines: git lists its removals, then its additions. */
interface ChangeRun {
  kind: 'change'
  removed: string[]
  added: string[]
}

/** Changed lines held back while inverting, until the block they belong to ends. */
interface PendingChange {
  removed: string[]
  added: string[]
  /** The side the previous changed line went to, which a "\" note follows. */
  previous?: string[]
}

function marker(line: string): string {
  return line[0] ?? MARKER.context
}

function body(line: string): string {
  return line.slice(1)
}

function isContext(line: string): boolean {
  return marker(line) === MARKER.context
}

function isRemoved(line: string): boolean {
  return marker(line) === MARKER.removed
}

function isAdded(line: string): boolean {
  return marker(line) === MARKER.added
}

/** git's "\ No newline at end of file", which belongs to the line before it. */
function isNote(line: string): boolean {
  return marker(line) === MARKER.note
}

function cursorAt(hunk: Hunk): LineCursor {
  return { oldNo: hunk.oldStart, newNo: hunk.newStart }
}

export function hunkHeader(hunk: Hunk): string {
  const fileLines = hunk.lines.filter((line) => !isNote(line))
  const oldCount = fileLines.filter((line) => !isAdded(line)).length
  const newCount = fileLines.filter((line) => !isRemoved(line)).length
  const suffix = hunk.context ? ` ${hunk.context}` : ''
  return `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${suffix}`
}

/** Git-style view: one column of lines with old and new line numbers. */
export function toUnifiedLines(hunks: Hunk[]): UnifiedLine[] {
  return hunks.flatMap(unifiedLinesOfHunk)
}

function unifiedLinesOfHunk(hunk: Hunk): UnifiedLine[] {
  const header: UnifiedLine = { kind: 'hunk', oldNo: null, newNo: null, text: hunkHeader(hunk) }
  const cursor = cursorAt(hunk)
  return [header, ...hunk.lines.map((line) => unifiedLine(line, cursor))]
}

function unifiedLine(line: string, cursor: LineCursor): UnifiedLine {
  const text = body(line)
  if (isNote(line)) return { kind: 'note', oldNo: null, newNo: null, text: text.trim() }
  if (isRemoved(line)) return { kind: 'del', oldNo: cursor.oldNo++, newNo: null, text }
  if (isAdded(line)) return { kind: 'add', oldNo: null, newNo: cursor.newNo++, text }
  return { kind: 'context', oldNo: cursor.oldNo++, newNo: cursor.newNo++, text }
}

/**
 * Two-column view. Each run of changed lines pairs its deletions (left) with
 * its additions (right) row by row; the shorter side is padded with empty cells.
 */
export function toSideBySideRows(hunks: Hunk[]): SideBySideRow[] {
  const showSeparators = hunks.length > 1 || hunks.some((h) => h.oldStart > 1 || h.newStart > 1)
  return hunks.flatMap((hunk) => {
    const rows = sideBySideRowsOfHunk(hunk)
    return showSeparators ? [separatorFor(hunk), ...rows] : rows
  })
}

function separatorFor(hunk: Hunk): SideBySideRow {
  const suffix = hunk.context ? `  ·  ${hunk.context}` : ''
  return { kind: 'separator', label: `⋯  from line ${hunk.newStart}${suffix}` }
}

function sideBySideRowsOfHunk(hunk: Hunk): SideBySideRow[] {
  const cursor = cursorAt(hunk)
  // Notes describe a line ending, not a line; two columns of text have nowhere to put them.
  const lines = hunk.lines.filter((line) => !isNote(line))
  return runsOf(lines).flatMap((run) => (run.kind === 'context' ? [contextRow(run, cursor)] : changeRows(run, cursor)))
}

function runsOf(lines: string[]): (ContextRun | ChangeRun)[] {
  const runs: (ContextRun | ChangeRun)[] = []
  for (const line of lines) addToRuns(runs, line)
  return runs
}

/** A context line is a run of its own; a changed line joins the change block before it, or starts one. */
function addToRuns(runs: (ContextRun | ChangeRun)[], line: string): void {
  if (isContext(line)) {
    runs.push({ kind: 'context', text: body(line) })
    return
  }
  const last = runs.at(-1)
  const change = last?.kind === 'change' ? last : startChange(runs)
  ;(isRemoved(line) ? change.removed : change.added).push(body(line))
}

function startChange(runs: (ContextRun | ChangeRun)[]): ChangeRun {
  const change: ChangeRun = { kind: 'change', removed: [], added: [] }
  runs.push(change)
  return change
}

function contextRow({ text }: ContextRun, cursor: LineCursor): SideBySideRow {
  return {
    kind: 'line',
    left: { no: cursor.oldNo++, text, kind: 'context' },
    right: { no: cursor.newNo++, text, kind: 'context' },
  }
}

function changeRows({ removed, added }: ChangeRun, cursor: LineCursor): SideBySideRow[] {
  const left = removed.map((text): SideCell => ({ no: cursor.oldNo++, text, kind: 'del' }))
  const right = added.map((text): SideCell => ({ no: cursor.newNo++, text, kind: 'add' }))
  const height = Math.max(left.length, right.length)
  return Array.from({ length: height }, (_, row): SideBySideRow => ({
    kind: 'line',
    left: left[row] ?? EMPTY_CELL,
    right: right[row] ?? EMPTY_CELL,
  }))
}

/** The same change seen from the other direction (right → left). */
export function invertHunks(hunks: Hunk[]): Hunk[] {
  return hunks.map((hunk) => ({
    oldStart: hunk.newStart,
    newStart: hunk.oldStart,
    context: hunk.context,
    lines: removalsFirst(hunk.lines.map(invertLine)),
  }))
}

/**
 * Git lists a change's removed lines before its added ones; after inverting, the additions
 * come first. Reorders each run of changed lines back to git's order, keeping every
 * "\ No newline at end of file" note after the line it describes.
 */
function removalsFirst(lines: string[]): string[] {
  const result: string[] = []
  const pending: PendingChange = { removed: [], added: [] }
  for (const line of lines) {
    const side = pendingSideOf(line, pending)
    if (side) {
      side.push(line)
      pending.previous = side
      continue
    }
    result.push(...takePending(pending), line)
  }
  result.push(...takePending(pending))
  return result
}

/** Where a changed line waits: its own side, or for a note, the side of the line it describes. */
function pendingSideOf(line: string, pending: PendingChange): string[] | undefined {
  if (isRemoved(line)) return pending.removed
  if (isAdded(line)) return pending.added
  return isNote(line) ? pending.previous : undefined
}

/** The held-back block in git's order, leaving nothing pending. */
function takePending(pending: PendingChange): string[] {
  pending.previous = undefined
  return [...pending.removed.splice(0), ...pending.added.splice(0)]
}

function invertLine(line: string): string {
  if (isRemoved(line)) return MARKER.added + body(line)
  if (isAdded(line)) return MARKER.removed + body(line)
  return line
}
