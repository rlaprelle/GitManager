import { describe, expect, it } from 'vitest'
import {
  type ConflictChunk,
  type MergeFile,
  alignedChunks,
  carryChoices,
  conflictsLeftIn,
  describeChange,
  diffLines,
  editConflict,
  editStartText,
  lineText,
  mergeChunks,
  reopenConflict,
  resultText,
  splitLines,
  toMergeFile,
  toggleSide,
  useNeitherSide,
} from '../mergeChunks'

const lines = (text: string) => (text === '' ? [] : text.split(' '))

/** Applies diffLines' changes to `from`; it must give `to`. */
function applied(from: string[], to: string[]): string[] {
  const out: string[] = []
  let at = 0
  for (const change of diffLines(from, to)) {
    out.push(...from.slice(at, change.baseStart), ...to.slice(change.sideStart, change.sideEnd))
    at = change.baseEnd
  }
  return [...out, ...from.slice(at)]
}

describe('diffLines', () => {
  it('finds nothing between equal lists', () => {
    expect(diffLines(lines('a b'), lines('a b'))).toEqual([])
  })

  it('finds a changed line, an insertion and a deletion separately', () => {
    expect(diffLines(lines('a b c d e'), lines('a X c e f'))).toEqual([
      { baseStart: 1, baseEnd: 2, sideStart: 1, sideEnd: 2 },
      { baseStart: 3, baseEnd: 4, sideStart: 3, sideEnd: 3 },
      { baseStart: 5, baseEnd: 5, sideStart: 4, sideEnd: 5 },
    ])
  })

  it.each([
    ['', 'a b'],
    ['a b', ''],
    ['a b c', 'c b a'],
    ['a a a b', 'b a a a'],
    ['x y z', 'p q r'],
    ['a b c d e f g', 'a c e g h'],
  ])('its changes turn %j into %j', (from, to) => {
    expect(applied(lines(from), lines(to))).toEqual(lines(to))
  })

  it('stays correct on long, repetitive files', () => {
    const from = Array.from({ length: 800 }, (_, i) => `line ${i % 37}`)
    const to = from.filter((_, i) => i % 11 !== 0).map((line, i) => (i % 13 === 0 ? `${line} edited` : line))
    expect(applied(from, to)).toEqual(to)
  })

  it('treats versions too different to diff as one change, and is still correct', () => {
    const from = Array.from({ length: 3000 }, (_, i) => `a${i}`)
    const to = Array.from({ length: 3000 }, (_, i) => `b${i}`)
    expect(diffLines(from, to)).toHaveLength(1)
    expect(applied(from, to)).toEqual(to)
  })
})

describe('splitLines', () => {
  it('keeps each line’s own ending, and doesn’t count the final newline as a line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n'])
    expect(splitLines('a\r\nb')).toEqual(['a\r\n', 'b'])
    expect(splitLines('')).toEqual([])
    expect(splitLines('\n')).toEqual(['\n'])
  })

  it('shows a line without its ending', () => {
    expect(['a\n', 'a\r\n', 'a'].map(lineText)).toEqual(['a', 'a', 'a'])
  })
})

describe('line endings and final newlines', () => {
  const only = (file: MergeFile) => file.chunks.findIndex((chunk) => chunk.kind === 'conflict')

  it('gives back each side’s text exactly, CRLF and all', () => {
    const file = toMergeFile({ path: 'f', base: 'a\r\nb\r\n', ours: 'a\r\nO\r\n', theirs: 'a\r\nT\r\n' })
    expect(resultText(toggleSide(file, only(file), 'theirs'))).toBe('a\r\nT\r\n')
  })

  it('gives typed lines the file’s own line ending', () => {
    const file = toMergeFile({ path: 'f', base: 'a\r\nb\r\nc\r\n', ours: 'a\r\nO\r\nc\r\n', theirs: 'a\r\nT\r\nc\r\n' })
    expect(resultText(editConflict(file, only(file), 'one\ntwo'))).toBe('a\r\none\r\ntwo\r\nc\r\n')
  })

  it('shows and edits CRLF lines without their endings', () => {
    const file = toMergeFile({ path: 'f', base: 'b\r\n', ours: 'O\r\n', theirs: 'T\r\n' })
    expect(editStartText(file.chunks[0] as ConflictChunk)).toBe('O\nT')
    expect(alignedChunks(file)[0]!.ours[0]!.text).toBe('O')
  })

  it('keeps the final-newline state of the side chosen', () => {
    const file = toMergeFile({ path: 'f', base: 'b\n', ours: 'o', theirs: 't\n' })
    expect(resultText(toggleSide(file, 0, 'ours'))).toBe('o')
    expect(resultText(toggleSide(file, 0, 'theirs'))).toBe('t\n')
  })

  it('separates the two sides when the first has no final newline', () => {
    const file = toMergeFile({ path: 'f', base: 'b\n', ours: 'o', theirs: 't\n' })
    expect(resultText(toggleSide(toggleSide(file, 0, 'ours'), 0, 'theirs'))).toBe('o\nt\n')
  })

  it('counts removing the final newline as a change that can clash with an added line', () => {
    const file = toMergeFile({ path: 'f', base: 'a\n', ours: 'a', theirs: 'a\nb\n' })
    expect(conflictsLeftIn(file)).toBe(1)
  })

  it('ends typed lines as both sides end, when neither has a final newline', () => {
    const file = toMergeFile({ path: 'f', base: 'b', ours: 'o', theirs: 't' })
    expect(resultText(editConflict(file, 0, 'one\ntwo'))).toBe('one\ntwo')
  })

  it('gives typed lines the file’s ending when the conflict’s own lines have none', () => {
    const file = toMergeFile({ path: 'f', base: 'a\r\nb\r\nlast', ours: 'a\r\nb\r\nours', theirs: 'a\r\nb\r\ntheirs' })
    expect(resultText(editConflict(file, only(file), 'one\ntwo'))).toBe('a\r\nb\r\none\r\ntwo')
  })

  it('gives typed lines the conflict’s own ending in a file that mixes endings', () => {
    const file = toMergeFile({ path: 'f', base: 'a\r\nb\n', ours: 'a\r\nO\n', theirs: 'a\r\nT\n' })
    expect(resultText(editConflict(file, only(file), 'one\ntwo'))).toBe('a\r\none\ntwo\n')
  })

  it('needs another look when only a final newline changed', () => {
    const earlier = toMergeFile({ path: 'f', base: 'a\n', ours: 'o\n', theirs: 't\n' })
    expect(carryChoices([earlier], [toMergeFile({ path: 'f', base: 'a\n', ours: 'o\n', theirs: 't' })]).changed).toBe(1)
  })
})

describe('mergeChunks', () => {
  it('keeps one side’s change, marked as merged already', () => {
    expect(mergeChunks(lines('a b c'), lines('a X c'), lines('a b c'))).toEqual([
      { kind: 'same', lines: ['a'] },
      { kind: 'one-side', side: 'ours', base: ['b'], lines: ['X'], applied: true },
      { kind: 'same', lines: ['c'] },
    ])
  })

  it('makes a conflict of lines both sides changed differently', () => {
    expect(mergeChunks(lines('a b c'), lines('a X c'), lines('a Y Z c'))).toEqual([
      { kind: 'same', lines: ['a'] },
      { kind: 'conflict', base: ['b'], ours: ['X'], theirs: ['Y', 'Z'], picks: [], neither: false, edited: null },
      { kind: 'same', lines: ['c'] },
    ])
  })

  it('needs no decision when both sides made the same change', () => {
    expect(mergeChunks(lines('a b c'), lines('a X c'), lines('a X c'))).toEqual([{ kind: 'same', lines: ['a', 'X', 'c'] }])
  })

  it('keeps separate changes separate, with the right lines after earlier size changes', () => {
    const chunks = mergeChunks(lines('a b c d e f g'), lines('NEW1 NEW2 a b c d e X g'), lines('a T c d e f g'))
    expect(chunks.map((chunk) => chunk.kind)).toEqual(['one-side', 'same', 'one-side', 'same', 'one-side', 'same'])
    expect(chunks[2]).toMatchObject({ side: 'theirs', base: ['b'], lines: ['T'] })
    expect(chunks[4]).toMatchObject({ side: 'ours', base: ['f'], lines: ['X'] })
  })

  it('groups changes that touch into one conflict, with each side’s lines for the whole range', () => {
    expect(mergeChunks(lines('a b c d'), lines('a X c d'), lines('a b Y d'))).toEqual([
      { kind: 'same', lines: ['a'] },
      { kind: 'conflict', base: ['b', 'c'], ours: ['X', 'c'], theirs: ['b', 'Y'], picks: [], neither: false, edited: null },
      { kind: 'same', lines: ['d'] },
    ])
  })

  it('handles a file both sides added', () => {
    expect(mergeChunks([], lines('o'), lines('t'))).toEqual([
      { kind: 'conflict', base: [], ours: ['o'], theirs: ['t'], picks: [], neither: false, edited: null },
    ])
  })

  it.each([
    ['a b c d e f g h i j', 'a B c d x y e f g j', 'z a b c D e f G h i j'],
    ['a b c', '', 'a b c d'],
    ['a a a a', 'a b a a', 'a a c a'],
    ['', 'x y', 'y z'],
  ])('rebuilds each side exactly from the chunks of %j', (baseText, oursText, theirsText) => {
    const [ours, theirs] = [lines(oursText), lines(theirsText)]
    const chunks = mergeChunks(lines(baseText), ours, theirs)
    const view = (side: 'ours' | 'theirs') =>
      chunks.flatMap((chunk) => {
        if (chunk.kind === 'same') return chunk.lines
        if (chunk.kind === 'conflict') return chunk[side]
        return chunk.side === side ? chunk.lines : chunk.base
      })
    expect(view('ours')).toEqual(ours)
    expect(view('theirs')).toEqual(theirs)
  })
})

describe('resolving a file', () => {
  const file = (): MergeFile =>
    toMergeFile({ path: 'f.ts', base: 'a\nb\nc\nd\ne\n', ours: 'A\nb\nc\nX\ne\n', theirs: 'a\nb\nc\nY\nY2\ne\n' })
  const ONE_SIDED = 0
  const CONFLICT = 2
  const conflict = (f: MergeFile) => f.chunks[CONFLICT] as ConflictChunk

  it('starts with the one-sided change applied and the conflict open', () => {
    expect(file().chunks.map((chunk) => chunk.kind)).toEqual(['one-side', 'same', 'conflict', 'same'])
    expect(conflictsLeftIn(file())).toBe(1)
  })

  it('stacks both sides in the order chosen, and an arrow takes its side back', () => {
    const both = toggleSide(toggleSide(file(), CONFLICT, 'theirs'), CONFLICT, 'ours')
    expect(conflict(both).picks).toEqual(['theirs', 'ours'])
    expect(conflictsLeftIn(both)).toBe(0)
    expect(resultText(both)).toBe('A\nb\nc\nY\nY2\nX\ne\n')
    const back = toggleSide(toggleSide(both, CONFLICT, 'theirs'), CONFLICT, 'ours')
    expect(conflictsLeftIn(back)).toBe(1)
  })

  it('takes back a one-sided change, restoring the original line', () => {
    const taken = toggleSide(toggleSide(file(), CONFLICT, 'ours'), ONE_SIDED, 'ours')
    expect(resultText(taken)).toBe('a\nb\nc\nX\ne\n')
  })

  it('ignores the other side’s arrow on a one-sided change', () => {
    expect(toggleSide(file(), ONE_SIDED, 'theirs').chunks[ONE_SIDED]).toMatchObject({ applied: true })
  })

  it('can use neither side, which drops the lines and resolves the conflict', () => {
    const neither = useNeitherSide(toggleSide(file(), CONFLICT, 'ours'), CONFLICT)
    expect(conflict(neither)).toMatchObject({ picks: [], neither: true })
    expect(conflictsLeftIn(neither)).toBe(0)
    expect(resultText(neither)).toBe('A\nb\nc\ne\n')
    expect(conflict(toggleSide(neither, CONFLICT, 'theirs'))).toMatchObject({ picks: ['theirs'], neither: false })
  })

  it('settles on typed lines, which the arrows then leave alone until reopened', () => {
    const edited = editConflict(file(), CONFLICT, 'mine\nalso\n\n')
    expect(conflict(edited).edited).toEqual(['mine\n', 'also\n'])
    expect(conflictsLeftIn(edited)).toBe(0)
    expect(resultText(edited)).toBe('A\nb\nc\nmine\nalso\ne\n')
    expect(toggleSide(edited, CONFLICT, 'ours').chunks[CONFLICT]).toEqual(edited.chunks[CONFLICT])
    const reopened = reopenConflict(edited, CONFLICT)
    expect(conflict(reopened)).toMatchObject({ picks: [], neither: false, edited: null })
    expect(conflictsLeftIn(reopened)).toBe(1)
  })

  it('counts deleting every typed line as an answer', () => {
    const emptied = editConflict(file(), CONFLICT, '')
    expect(conflict(emptied).edited).toEqual([])
    expect(conflictsLeftIn(emptied)).toBe(0)
    expect(resultText(emptied)).toBe('A\nb\nc\ne\n')
  })

  it('starts editing from the last edit, else what the arrows brought in, else both sides', () => {
    expect(editStartText(conflict(file()))).toBe('X\nY\nY2')
    expect(editStartText(conflict(toggleSide(file(), CONFLICT, 'theirs')))).toBe('Y\nY2')
    expect(editStartText(conflict(editConflict(file(), CONFLICT, 'typed')))).toBe('typed')
  })

  it.each<[string, (f: MergeFile) => MergeFile]>([
    ['an arrow', (f) => toggleSide(f, CONFLICT, 'ours')],
    ['using neither', (f) => useNeitherSide(f, CONFLICT)],
    ['an edit', (f) => editConflict(f, CONFLICT, 'x')],
    ['reopening', (f) => reopenConflict(f, CONFLICT)],
  ])('clears the “checked” mark on %s', (_name, change) => {
    expect(change({ ...file(), marked: true }).marked).toBe(false)
  })

  it('never changes the file it was given', () => {
    const original = file()
    const copy = structuredClone(original)
    toggleSide(original, CONFLICT, 'ours')
    editConflict(original, CONFLICT, 'x')
    expect(original).toEqual(copy)
  })

  it('ends the result without a newline when neither branch’s file has one', () => {
    const noNewline = toMergeFile({ path: 'f', base: 'a', ours: 'b', theirs: 'c' })
    expect(resultText(toggleSide(noNewline, 0, 'ours'))).toBe('b')
  })

  it('gives an empty file when no lines are left', () => {
    const only = toMergeFile({ path: 'f', base: null, ours: 'o\n', theirs: 't\n' })
    expect(resultText(useNeitherSide(only, 0))).toBe('')
  })
})

describe('alignedChunks', () => {
  const file = () => toMergeFile({ path: 'f', base: 'a\nb\nc\nd\n', ours: 'A\nb\nc\nX\n', theirs: 'a\nb\nc\nY\nZ\n' })
  const texts = (lines: { number: number; text: string }[]) => lines.map(({ number, text }) => `${number}:${text}`)

  it('numbers each pane on its own, tinting lines by where they came from', () => {
    const [change, same, conflict] = alignedChunks(file())
    expect(change!.ours).toEqual([{ number: 1, text: 'A', source: 'ours' }])
    expect(change!.theirs).toEqual([{ number: 1, text: 'a', source: null }])
    expect(change!.result).toEqual([{ number: 1, text: 'A', source: 'ours' }])
    expect(texts(same!.result)).toEqual(['2:b', '3:c'])
    expect(texts(conflict!.theirs)).toEqual(['4:Y', '5:Z'])
    expect(conflict!.theirs[0]!.source).toBe('theirs')
  })

  it('shows nothing in the result for an open conflict, then what was chosen', () => {
    const CONFLICT = 2
    expect(alignedChunks(file())[CONFLICT]!.result).toEqual([])
    const both = alignedChunks(toggleSide(toggleSide(file(), CONFLICT, 'theirs'), CONFLICT, 'ours'))[CONFLICT]!
    expect(both.result.map((line) => [line.text, line.source])).toEqual([['Y', 'theirs'], ['Z', 'theirs'], ['X', 'ours']])
    expect(both.result.map((line) => line.number)).toEqual([4, 5, 6])
    const edited = alignedChunks(editConflict(file(), CONFLICT, 'typed'))[CONFLICT]!
    expect(edited.result).toEqual([{ number: 4, text: 'typed', source: 'edited' }])
  })

  it('shows the original line once a one-sided change is taken back', () => {
    expect(alignedChunks(toggleSide(file(), 0, 'ours'))[0]!.result).toEqual([{ number: 1, text: 'a', source: null }])
  })
})

describe('carryChoices', () => {
  const version = (theirs: string) => toMergeFile({ path: 'f', base: 'a\n', ours: 'o\n', theirs })

  it('keeps the choices, and the mark, for a file that came out the same', () => {
    const decided = { ...toggleSide(version('t\n'), 0, 'ours'), marked: true }
    const { files, changed } = carryChoices([decided], [version('t\n')])
    expect(files).toEqual([decided])
    expect(changed).toBe(0)
  })

  it('starts over on a file whose versions changed, and counts it', () => {
    const decided = toggleSide(version('t\n'), 0, 'ours')
    const { files, changed } = carryChoices([decided], [version('different\n')])
    expect(files).toEqual([version('different\n')])
    expect(changed).toBe(1)
  })

  it('counts a file that is new to the merge', () => {
    expect(carryChoices([], [version('t\n')]).changed).toBe(1)
  })
})

describe('describeChange', () => {
  it.each([
    ['b', 'X', 'changed this line'],
    ['b', 'X Y', 'changed this line and added 1 line'],
    ['a b', 'a X', 'changed 1 of these 2 lines'],
    ['a b', 'X Y Z', 'changed both lines and added 1 line'],
    ['a b c', 'X Y Z', 'changed all 3 lines'],
    ['a b', 'a', 'removed 1 line'],
    ['a', '', 'removed this line'],
    ['a b', '', 'removed these 2 lines'],
    ['', 'x y', 'added 2 lines'],
    ['', 'x', 'added 1 line'],
  ])('%j → %j says %j', (base, side, said) => {
    expect(describeChange(lines(base), lines(side))).toBe(said)
  })
})
