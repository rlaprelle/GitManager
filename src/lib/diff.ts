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

function marker(line: string): string {
  return line[0] ?? ' '
}

function body(line: string): string {
  return line.slice(1)
}

/** git's "\ No newline at end of file", which belongs to the line before it. */
function isNote(line: string): boolean {
  return marker(line) === '\\'
}

export function hunkHeader(hunk: Hunk): string {
  const fileLines = hunk.lines.filter((l) => !isNote(l))
  const oldCount = fileLines.filter((l) => marker(l) !== '+').length
  const newCount = fileLines.filter((l) => marker(l) !== '-').length
  const suffix = hunk.context ? ` ${hunk.context}` : ''
  return `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${suffix}`
}

/** Git-style view: one column of lines with old and new line numbers. */
export function toUnifiedLines(hunks: Hunk[]): UnifiedLine[] {
  return hunks.flatMap(unifiedLinesOfHunk)
}

function unifiedLinesOfHunk(hunk: Hunk): UnifiedLine[] {
  const out: UnifiedLine[] = [{ kind: 'hunk', oldNo: null, newNo: null, text: hunkHeader(hunk) }]
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart

  for (const line of hunk.lines) {
    const text = body(line)
    if (isNote(line)) {
      out.push({ kind: 'note', oldNo: null, newNo: null, text: text.trim() })
    } else if (marker(line) === '-') {
      out.push({ kind: 'del', oldNo: oldNo++, newNo: null, text })
    } else if (marker(line) === '+') {
      out.push({ kind: 'add', oldNo: null, newNo: newNo++, text })
    } else {
      out.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text })
    }
  }
  return out
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
  const rows: SideBySideRow[] = []
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  let i = 0
  // Notes describe a line ending, not a line; two columns of text have nowhere to put them.
  const lines = hunk.lines.filter((line) => !isNote(line))

  while (i < lines.length) {
    const line = lines[i]!
    if (marker(line) === ' ') {
      const text = body(line)
      rows.push({
        kind: 'line',
        left: { no: oldNo++, text, kind: 'context' },
        right: { no: newNo++, text, kind: 'context' },
      })
      i++
      continue
    }

    const deletions: string[] = []
    const additions: string[] = []
    while (i < lines.length && marker(lines[i]!) !== ' ') {
      const changed = lines[i]!
      ;(marker(changed) === '-' ? deletions : additions).push(body(changed))
      i++
    }

    const height = Math.max(deletions.length, additions.length)
    for (let k = 0; k < height; k++) {
      const left: SideCell = k < deletions.length ? { no: oldNo++, text: deletions[k]!, kind: 'del' } : EMPTY_CELL
      const right: SideCell = k < additions.length ? { no: newNo++, text: additions[k]!, kind: 'add' } : EMPTY_CELL
      rows.push({ kind: 'line', left, right })
    }
  }
  return rows
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
  const removed: string[] = []
  const added: string[] = []
  /** The side the previous changed line went to, which a "\" note follows. */
  let previous: string[] | undefined
  const flush = () => {
    result.push(...removed.splice(0), ...added.splice(0))
    previous = undefined
  }
  for (const line of lines) {
    const kind = marker(line)
    const side = kind === '-' ? removed : kind === '+' ? added : kind === '\\' ? previous : undefined
    if (side) {
      side.push(line)
      previous = side
      continue
    }
    flush()
    result.push(line)
  }
  flush()
  return result
}

function invertLine(line: string): string {
  if (marker(line) === '-') return '+' + body(line)
  if (marker(line) === '+') return '-' + body(line)
  return line
}
