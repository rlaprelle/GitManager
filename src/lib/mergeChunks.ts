import type { ConflictFile } from '@/types/git'

// Turns a conflicted file's three versions into the chunks the merge screen lines up, and keeps
// what the user chose for each. Pure: the composable holds the state, components only draw it.
//
// A line here includes its own ending ('a\n', 'a\r\n', or 'a' for a last line without one), so
// CRLF and a missing final newline are part of what's compared and survive into the result.
// `lineText` gives a line as it is shown.

export type MergeSide = 'ours' | 'theirs'

/** Lines both branches have the same. */
export interface SameChunk {
  kind: 'same'
  lines: string[]
}

/** A change only one branch made: in the result unless the user takes it back. */
export interface OneSideChunk {
  kind: 'one-side'
  side: MergeSide
  /** The lines as they were, which the other branch still has. */
  base: string[]
  lines: string[]
  applied: boolean
}

/** Lines both branches changed differently: the user decides. */
export interface ConflictChunk {
  kind: 'conflict'
  base: string[]
  ours: string[]
  theirs: string[]
  /** The sides brought into the result, in the order chosen. */
  picks: MergeSide[]
  /** "Use neither side": the lines are dropped. */
  neither: boolean
  /** Lines typed by hand, which replace everything else; null when not edited. */
  edited: string[] | null
}

export type MergeChunk = SameChunk | OneSideChunk | ConflictChunk

/** One conflicted file on the merge screen. */
export interface MergeFile {
  path: string
  chunks: MergeChunk[]
  /** The user's own "I've checked this file" mark. Any later change to the file clears it. */
  marked: boolean
}

/** A run of changed lines: `base[baseStart, baseEnd)` became `side[sideStart, sideEnd)`. */
interface Change {
  baseStart: number
  baseEnd: number
  sideStart: number
  sideEnd: number
}

/** Two versions further apart than this many line edits count as one big change: finding the smallest diff would cost too much. */
const MAX_DIFF_COST = 2000

/** The text's lines, each with its ending. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** A line as shown: without its ending. */
export function lineText(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/** The ending these lines use, or null when none of them has one. */
function endingIn(lines: string[]): string | null {
  const terminated = lines.find((line) => line.endsWith('\n'))
  if (terminated === undefined) return null
  return terminated.endsWith('\r\n') ? '\r\n' : '\n'
}

/** The ending these lines use; a file with none yet gets '\n'. */
function lineEndingOf(lines: string[]): string {
  return endingIn(lines) ?? '\n'
}

/** Every line a chunk holds, from all three versions. */
function everyLineOf(chunk: MergeChunk): string[] {
  if (chunk.kind === 'same') return chunk.lines
  if (chunk.kind === 'one-side') return [...chunk.base, ...chunk.lines]
  return [...chunk.ours, ...chunk.theirs, ...chunk.base]
}

export function toMergeFile(file: ConflictFile): MergeFile {
  return {
    path: file.path,
    chunks: mergeChunks(splitLines(file.base ?? ''), splitLines(file.ours), splitLines(file.theirs)),
    marked: false,
  }
}

/** The three-way merge: walks the changes each side made to `base`, grouping those that touch. */
export function mergeChunks(base: string[], ours: string[], theirs: string[]): MergeChunk[] {
  const oursChanges = diffLines(base, ours)
  const theirsChanges = diffLines(base, theirs)
  const chunks: MergeChunk[] = []
  let position = 0
  let o = 0
  let t = 0
  // Where each side's lines stand relative to base, outside changes.
  let oursOffset = 0
  let theirsOffset = 0

  while (o < oursChanges.length || t < theirsChanges.length) {
    const group = nextGroup(oursChanges, theirsChanges, o, t)
    pushSame(chunks, base.slice(position, group.baseStart))
    const oursLines = sliceSide(ours, group.baseStart, group.baseEnd, oursChanges.slice(o, group.o), oursOffset)
    const theirsLines = sliceSide(theirs, group.baseStart, group.baseEnd, theirsChanges.slice(t, group.t), theirsOffset)
    chunks.push(chunkFor(base.slice(group.baseStart, group.baseEnd), oursLines, theirsLines, group.o > o, group.t > t))
    oursOffset = offsetAfter(oursChanges, group.o, oursOffset)
    theirsOffset = offsetAfter(theirsChanges, group.t, theirsOffset)
    position = group.baseEnd
    o = group.o
    t = group.t
  }
  pushSame(chunks, base.slice(position))
  return joinSame(chunks)
}

function pushSame(chunks: MergeChunk[], lines: string[]): void {
  if (lines.length > 0) chunks.push({ kind: 'same', lines })
}

function joinSame(chunks: MergeChunk[]): MergeChunk[] {
  const joined: MergeChunk[] = []
  for (const chunk of chunks) {
    const last = joined[joined.length - 1]
    if (chunk.kind === 'same' && last?.kind === 'same') last.lines = [...last.lines, ...chunk.lines]
    else joined.push(chunk)
  }
  return joined
}

/** The next changes that overlap or touch in base, from either side: they must be decided together. */
function nextGroup(ours: Change[], theirs: Change[], startO: number, startT: number) {
  let o = startO
  let t = startT
  const first = earliest(ours[o], theirs[t])
  let baseStart = first.baseStart
  let baseEnd = first.baseEnd
  for (let grew = true; grew; ) {
    grew = false
    while (o < ours.length && touches(ours[o]!, baseStart, baseEnd)) {
      ;({ baseStart, baseEnd } = widen(ours[o++]!, baseStart, baseEnd))
      grew = true
    }
    while (t < theirs.length && touches(theirs[t]!, baseStart, baseEnd)) {
      ;({ baseStart, baseEnd } = widen(theirs[t++]!, baseStart, baseEnd))
      grew = true
    }
  }
  return { baseStart, baseEnd, o, t }
}

function earliest(a: Change | undefined, b: Change | undefined): Change {
  if (!a) return b!
  if (!b) return a
  return b.baseStart < a.baseStart ? b : a
}

/** Touching counts, as in git: changes on neighbouring lines can't be told apart safely. */
function touches(change: Change, baseStart: number, baseEnd: number): boolean {
  return change.baseStart <= baseEnd && change.baseEnd >= baseStart
}

function widen(change: Change, baseStart: number, baseEnd: number) {
  return { baseStart: Math.min(baseStart, change.baseStart), baseEnd: Math.max(baseEnd, change.baseEnd) }
}

/** A side's lines for the base range `[baseStart, baseEnd)`, given its changes inside that range. */
function sliceSide(side: string[], baseStart: number, baseEnd: number, changes: Change[], offset: number): string[] {
  if (changes.length === 0) return side.slice(baseStart + offset, baseEnd + offset)
  const first = changes[0]!
  const last = changes[changes.length - 1]!
  const start = first.sideStart - (first.baseStart - baseStart)
  const end = last.sideEnd + (baseEnd - last.baseEnd)
  return side.slice(start, end)
}

/** How far a side's line numbers have drifted from base after its first `count` changes. */
function offsetAfter(changes: Change[], count: number, previous: number): number {
  if (count === 0) return previous
  const last = changes[count - 1]!
  return last.sideEnd - last.baseEnd
}

function chunkFor(base: string[], ours: string[], theirs: string[], oursChanged: boolean, theirsChanged: boolean): MergeChunk {
  if (sameLines(ours, theirs)) return { kind: 'same', lines: ours }
  if (!theirsChanged) return { kind: 'one-side', side: 'ours', base, lines: ours, applied: true }
  if (!oursChanged) return { kind: 'one-side', side: 'theirs', base, lines: theirs, applied: true }
  return { kind: 'conflict', base, ours, theirs, picks: [], neither: false, edited: null }
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

/**
 * The changes turning `from` into `to`: Myers' shortest-edit diff, after trimming what they share
 * at each end. A pair too different to diff within MAX_DIFF_COST counts as one change.
 */
export function diffLines(from: string[], to: string[]): Change[] {
  let start = 0
  while (start < from.length && start < to.length && from[start] === to[start]) start++
  let fromEnd = from.length
  let toEnd = to.length
  while (fromEnd > start && toEnd > start && from[fromEnd - 1] === to[toEnd - 1]) {
    fromEnd--
    toEnd--
  }
  if (start === fromEnd && start === toEnd) return []
  const whole: Change = { baseStart: start, baseEnd: fromEnd, sideStart: start, sideEnd: toEnd }
  if (start === fromEnd || start === toEnd) return [whole]
  const a = from.slice(start, fromEnd)
  const b = to.slice(start, toEnd)
  const matches = matchedLines(a, b)
  return matches === null ? [whole] : changesBetween(matches, a.length, b.length, start)
}

/**
 * Myers' shortest-edit algorithm: the pairs of equal lines, in order; null when the two differ by
 * more than MAX_DIFF_COST. `furthest[k + offset]` is how far along `a` diagonal k has got.
 */
function matchedLines(a: string[], b: string[]): [number, number][] | null {
  const limit = Math.min(a.length + b.length, MAX_DIFF_COST)
  const offset = limit + 1
  const furthest = new Int32Array(2 * limit + 3)
  // Each round's starting values, for walking back: only diagonals -cost-1 … cost+1 matter.
  const trace: Int32Array[] = []
  for (let cost = 0; cost <= limit; cost++) {
    trace.push(furthest.slice(offset - cost - 1, offset + cost + 2))
    for (let k = -cost; k <= cost; k += 2) {
      const down = k === -cost || (k !== cost && furthest[offset + k - 1]! < furthest[offset + k + 1]!)
      let x = down ? furthest[offset + k + 1]! : furthest[offset + k - 1]! + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++
        y++
      }
      furthest[offset + k] = x
      if (x === a.length && y === b.length) return walkBack(trace, x, y)
    }
  }
  return null
}

function walkBack(trace: Int32Array[], endX: number, endY: number): [number, number][] {
  const matches: [number, number][] = []
  let x = endX
  let y = endY
  for (let cost = trace.length - 1; cost >= 0; cost--) {
    const round = trace[cost]!
    const at = (k: number) => round[k + cost + 1]!
    const k = x - y
    const down = k === -cost || (k !== cost && at(k - 1) < at(k + 1))
    const previousK = down ? k + 1 : k - 1
    const previousX = at(previousK)
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      x--
      y--
      matches.push([x, y])
    }
    x = previousX
    y = previousY
  }
  return matches.reverse()
}

/** The gaps between equal lines are the changes; `offset` puts back the trimmed start. */
function changesBetween(matches: [number, number][], aLength: number, bLength: number, offset: number): Change[] {
  const changes: Change[] = []
  let a = 0
  let b = 0
  for (const [x, y] of [...matches, [aLength, bLength] as [number, number]]) {
    if (x > a || y > b) changes.push({ baseStart: a + offset, baseEnd: x + offset, sideStart: b + offset, sideEnd: y + offset })
    a = x + 1
    b = y + 1
  }
  return changes
}

// ---- what the three panes show ----

/** One numbered line in a pane; `source` says whose colour it takes. */
export interface PaneLine {
  number: number
  text: string
  source: MergeSide | 'edited' | null
}

/** One chunk as the three panes show it, side by side. */
export interface AlignedChunk {
  /** Its place in the file's chunks, which is how the actions address it. */
  index: number
  chunk: MergeChunk
  ours: PaneLine[]
  result: PaneLine[]
  theirs: PaneLine[]
}

type UnnumberedLine = Omit<PaneLine, 'number'>

function plain(lines: string[], source: PaneLine['source'] = null): UnnumberedLine[] {
  return lines.map((line) => ({ text: lineText(line), source }))
}

function sideLines(chunk: MergeChunk, side: MergeSide): UnnumberedLine[] {
  if (chunk.kind === 'same') return plain(chunk.lines)
  if (chunk.kind === 'conflict') return plain(chunk[side], side)
  return chunk.side === side ? plain(chunk.lines, side) : plain(chunk.base)
}

function resultLines(chunk: MergeChunk): UnnumberedLine[] {
  if (chunk.kind === 'same') return plain(chunk.lines)
  if (chunk.kind === 'one-side') return chunk.applied ? plain(chunk.lines, chunk.side) : plain(chunk.base)
  if (chunk.edited) return plain(chunk.edited, 'edited')
  return chunk.picks.flatMap((side) => plain(chunk[side], side))
}

/** The file's chunks with each pane's lines numbered from the top of that pane. */
export function alignedChunks(file: MergeFile): AlignedChunk[] {
  const next = { ours: 1, result: 1, theirs: 1 }
  const numbered = (lines: UnnumberedLine[], pane: keyof typeof next): PaneLine[] =>
    lines.map((line) => ({ ...line, number: next[pane]++ }))
  return file.chunks.map((chunk, index) => ({
    index,
    chunk,
    ours: numbered(sideLines(chunk, 'ours'), 'ours'),
    result: numbered(resultLines(chunk), 'result'),
    theirs: numbered(sideLines(chunk, 'theirs'), 'theirs'),
  }))
}

// ---- what the user chose ----

/** The lines a chunk puts in the result, as things stand. */
export function resultLinesOf(chunk: MergeChunk): string[] {
  if (chunk.kind === 'same') return chunk.lines
  if (chunk.kind === 'one-side') return chunk.applied ? chunk.lines : chunk.base
  if (chunk.edited) return chunk.edited
  return chunk.picks.flatMap((side) => chunk[side])
}

export function isResolved(chunk: ConflictChunk): boolean {
  return chunk.picks.length > 0 || chunk.neither || chunk.edited !== null
}

export function conflictsIn(file: MergeFile): ConflictChunk[] {
  return file.chunks.filter((chunk): chunk is ConflictChunk => chunk.kind === 'conflict')
}

export function conflictsLeftIn(file: MergeFile): number {
  return conflictsIn(file).filter((chunk) => !isResolved(chunk)).length
}

/** The file as the merge will commit it. */
export function resultText(file: MergeFile): string {
  const lines = file.chunks.flatMap(resultLinesOf)
  const ending = lineEndingOf(lines)
  // A side's unterminated last line may no longer be last (both sides brought in): it needs an ending now.
  return lines.map((line, index) => (index < lines.length - 1 && !line.endsWith('\n') ? line + ending : line)).join('')
}

/** A copy of the file with one chunk changed. Any change clears the file's "checked" mark. */
function withChunk(file: MergeFile, index: number, change: (chunk: MergeChunk) => MergeChunk): MergeFile {
  return { ...file, marked: false, chunks: file.chunks.map((chunk, at) => (at === index ? change(chunk) : chunk)) }
}

function onConflict(change: (chunk: ConflictChunk) => ConflictChunk): (chunk: MergeChunk) => MergeChunk {
  return (chunk) => (chunk.kind === 'conflict' ? change(chunk) : chunk)
}

/**
 * An arrow: brings a side into the result, or takes it back. A one-sided change just flips. A
 * conflict stacks sides in the order chosen; one edited by hand ignores the arrows until undone,
 * so a click can't throw typing away.
 */
export function toggleSide(file: MergeFile, index: number, side: MergeSide): MergeFile {
  return withChunk(file, index, (chunk) => {
    if (chunk.kind === 'same') return chunk
    if (chunk.kind === 'one-side') return chunk.side === side ? { ...chunk, applied: !chunk.applied } : chunk
    if (chunk.edited) return chunk
    const picks = chunk.picks.includes(side) ? chunk.picks.filter((pick) => pick !== side) : [...chunk.picks, side]
    return { ...chunk, picks, neither: false }
  })
}

export function useNeitherSide(file: MergeFile, index: number): MergeFile {
  return withChunk(file, index, onConflict((chunk) => ({ ...chunk, picks: [], neither: true, edited: null })))
}

/** Back to undecided, whichever way it was resolved. */
export function reopenConflict(file: MergeFile, index: number): MergeFile {
  return withChunk(file, index, onConflict((chunk) => ({ ...chunk, picks: [], neither: false, edited: null })))
}

/** Settles a conflict on what the user typed (no lines at all is a valid answer). */
export function editConflict(file: MergeFile, index: number, text: string): MergeFile {
  return withChunk(file, index, onConflict((chunk) => ({ ...chunk, picks: [], neither: false, edited: typedLines(file, chunk, text) })))
}

/**
 * Typed text as lines of this file: a text box only has '\n', so the conflict's own ending goes
 * back on. A conflict with no ending of its own (the file's last line, unterminated on every
 * side) takes the rest of the file's, so a CRLF file isn't given a lone LF.
 */
function typedLines(file: MergeFile, chunk: ConflictChunk, text: string): string[] {
  const typed = text.replace(/\r/g, '').replace(/\n+$/, '')
  if (typed === '') return []
  const ending = endingIn(everyLineOf(chunk)) ?? lineEndingOf(file.chunks.flatMap(everyLineOf))
  const lines = typed.split('\n').map((line) => line + ending)
  const noFinalNewline = [chunk.ours, chunk.theirs].every((side) => side.length > 0 && !side[side.length - 1]!.endsWith('\n'))
  if (noFinalNewline) lines[lines.length - 1] = lineText(lines[lines.length - 1]!)
  return lines
}

/** What the edit box starts with: the last edit, else what the arrows brought in, else both sides to trim. */
export function editStartText(chunk: ConflictChunk): string {
  const lines = chunk.edited ?? (chunk.picks.length > 0 ? resultLinesOf(chunk) : [...chunk.ours, ...chunk.theirs])
  return lines.map(lineText).join('\n')
}

// ---- when a branch moves on ----

/** A chunk's content, without what the user chose. */
function contentOf(chunk: MergeChunk): unknown {
  if (chunk.kind === 'same') return [chunk.kind, chunk.lines]
  if (chunk.kind === 'one-side') return [chunk.kind, chunk.side, chunk.base, chunk.lines]
  return [chunk.kind, chunk.base, chunk.ours, chunk.theirs]
}

function sameContent(a: MergeFile, b: MergeFile): boolean {
  return JSON.stringify(a.chunks.map(contentOf)) === JSON.stringify(b.chunks.map(contentOf))
}

/**
 * The files of a merge worked out again, keeping the earlier choices for every file whose three
 * versions came out the same. `changed` counts the files that need another look.
 */
export function carryChoices(earlier: MergeFile[], fresh: MergeFile[]): { files: MergeFile[]; changed: number } {
  let changed = 0
  const files = fresh.map((file) => {
    const previous = earlier.find((candidate) => candidate.path === file.path)
    if (previous && sameContent(previous, file)) return previous
    changed++
    return file
  })
  return { files, changed }
}

// ---- describing a side ----

/** What one branch did to a conflict's lines, worked out from the diff: 'changed 1 of these 2 lines and added 1 line'. */
export function describeChange(base: string[], lines: string[]): string {
  if (base.length === 0) return `added ${countOf(lines.length)}`
  if (lines.length === 0) return base.length === 1 ? 'removed this line' : `removed these ${base.length} lines`
  let changed = 0
  let added = 0
  let removed = 0
  for (const change of diffLines(base, lines)) {
    const before = change.baseEnd - change.baseStart
    const after = change.sideEnd - change.sideStart
    changed += Math.min(before, after)
    added += Math.max(after - before, 0)
    removed += Math.max(before - after, 0)
  }
  return [changedPhrase(changed, base.length), added > 0 && `added ${countOf(added)}`, removed > 0 && `removed ${countOf(removed)}`]
    .filter(Boolean)
    .join(' and ')
}

function changedPhrase(changed: number, total: number): string | false {
  if (changed === 0) return false
  if (total === 1) return 'changed this line'
  if (changed < total) return `changed ${changed} of these ${total} lines`
  return total === 2 ? 'changed both lines' : `changed all ${total} lines`
}

function countOf(lines: number): string {
  return lines === 1 ? '1 line' : `${lines} lines`
}

