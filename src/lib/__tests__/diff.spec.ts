import { describe, expect, it } from 'vitest'
import type { Hunk } from '@/types/git'
import { hunkHeader, invertHunks, toSideBySideRows, toUnifiedLines } from '../diff'

const modifyHunk: Hunk = {
  oldStart: 27,
  newStart: 27,
  context: 'public class SkuLookup {',
  lines: [' keep', '-old line', '+new line one', '+new line two', ' tail'],
}

const newFileHunk: Hunk = {
  oldStart: 0,
  newStart: 1,
  context: '',
  lines: ['+first', '+second'],
}

describe('hunkHeader', () => {
  it('counts old and new lines and appends the context', () => {
    expect(hunkHeader(modifyHunk)).toBe('@@ -27,3 +27,4 @@ public class SkuLookup {')
  })

  it('omits the trailing context when there is none', () => {
    expect(hunkHeader(newFileHunk)).toBe('@@ -0,0 +1,2 @@')
  })
})

describe('toUnifiedLines', () => {
  it('starts each hunk with a header line that has no line numbers', () => {
    const [header] = toUnifiedLines([modifyHunk])
    expect(header).toEqual({ kind: 'hunk', oldNo: null, newNo: null, text: '@@ -27,3 +27,4 @@ public class SkuLookup {' })
  })

  it('numbers context on both sides, deletions on the old side and additions on the new side', () => {
    const lines = toUnifiedLines([modifyHunk]).slice(1)
    expect(lines).toEqual([
      { kind: 'context', oldNo: 27, newNo: 27, text: 'keep' },
      { kind: 'del', oldNo: 28, newNo: null, text: 'old line' },
      { kind: 'add', oldNo: null, newNo: 28, text: 'new line one' },
      { kind: 'add', oldNo: null, newNo: 29, text: 'new line two' },
      { kind: 'context', oldNo: 29, newNo: 30, text: 'tail' },
    ])
  })

  it('emits one header per hunk', () => {
    const headers = toUnifiedLines([modifyHunk, newFileHunk]).filter((l) => l.kind === 'hunk')
    expect(headers).toHaveLength(2)
  })
})

describe('toSideBySideRows', () => {
  it('shows a separator before a hunk that starts past line 1', () => {
    const [first] = toSideBySideRows([modifyHunk])
    expect(first).toEqual({ kind: 'separator', label: '⋯  from line 27  ·  public class SkuLookup {' })
  })

  it('shows no separator for a single hunk at the top of a new file', () => {
    const rows = toSideBySideRows([newFileHunk])
    expect(rows.every((r) => r.kind === 'line')).toBe(true)
  })

  it('pairs deletions with additions and pads the shorter side with empty cells', () => {
    const lines = toSideBySideRows([modifyHunk]).filter((r) => r.kind === 'line')
    expect(lines).toEqual([
      {
        kind: 'line',
        left: { no: 27, text: 'keep', kind: 'context' },
        right: { no: 27, text: 'keep', kind: 'context' },
      },
      {
        kind: 'line',
        left: { no: 28, text: 'old line', kind: 'del' },
        right: { no: 28, text: 'new line one', kind: 'add' },
      },
      {
        kind: 'line',
        left: { no: null, text: '', kind: 'empty' },
        right: { no: 29, text: 'new line two', kind: 'add' },
      },
      {
        kind: 'line',
        left: { no: 29, text: 'tail', kind: 'context' },
        right: { no: 30, text: 'tail', kind: 'context' },
      },
    ])
  })
})

describe('git’s "No newline at end of file" note', () => {
  // As git prints a one-line file whose last line lost its newline on both sides.
  const noNewline: Hunk = {
    oldStart: 1,
    newStart: 1,
    context: '',
    lines: ['-229', '\\ No newline at end of file', '+230', '\\ No newline at end of file'],
  }

  it('is not counted in the hunk header', () => {
    expect(hunkHeader(noNewline)).toBe('@@ -1,1 +1,1 @@')
  })

  it('is its own unnumbered note row in the unified view, and doesn’t shift the line numbers', () => {
    expect(toUnifiedLines([noNewline]).slice(1)).toEqual([
      { kind: 'del', oldNo: 1, newNo: null, text: '229' },
      { kind: 'note', oldNo: null, newNo: null, text: 'No newline at end of file' },
      { kind: 'add', oldNo: null, newNo: 1, text: '230' },
      { kind: 'note', oldNo: null, newNo: null, text: 'No newline at end of file' },
    ])
  })

  it('is left out of the side-by-side view instead of showing as an added line', () => {
    expect(toSideBySideRows([noNewline])).toEqual([
      { kind: 'line', left: { no: 1, text: '229', kind: 'del' }, right: { no: 1, text: '230', kind: 'add' } },
    ])
  })

  it('after a context line is still a note, and the next line keeps its number', () => {
    const hunk: Hunk = { oldStart: 4, newStart: 4, context: '', lines: [' same', '\\ No newline at end of file', '+more'] }
    expect(toUnifiedLines([hunk]).slice(1).map((line) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ['context', 4, 4],
      ['note', null, null],
      ['add', null, 5],
    ])
  })
})

describe('invertHunks', () => {
  it('swaps additions with deletions and the two start lines, listing removals first as git does', () => {
    const hunk: Hunk = { oldStart: 3, newStart: 5, context: 'x', lines: [' a', '-b', '+c', ' d'] }
    expect(invertHunks([hunk])).toEqual([{ oldStart: 5, newStart: 3, context: 'x', lines: [' a', '-c', '+b', ' d'] }])
  })

  it('keeps a "No newline at end of file" note with the line it belongs to', () => {
    const hunk: Hunk = { oldStart: 1, newStart: 1, context: '', lines: ['-a', '\\ No newline at end of file', '+b'] }
    expect(invertHunks([hunk])[0]!.lines).toEqual(['-b', '+a', '\\ No newline at end of file'])
  })

  it('does not modify the hunks it was given', () => {
    const hunk: Hunk = { oldStart: 1, newStart: 1, context: '', lines: ['-b'] }
    invertHunks([hunk])
    expect(hunk.lines).toEqual(['-b'])
  })
})
