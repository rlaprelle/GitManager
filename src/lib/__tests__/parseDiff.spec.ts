import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../parseDiff'

// Real `git diff-tree -p` output, headers included.
const MODIFIED = [
  'diff --git a/app.yml b/app.yml',
  'index 3b18e51..a1c2d3e 100644',
  '--- a/app.yml',
  '+++ b/app.yml',
  '@@ -1,3 +1,4 @@ server:',
  '   port: 8080',
  '-  host: localhost',
  '+  host: 0.0.0.0',
  '+  timeout: 30s',
  '   debug: false',
  '@@ -20 +21 @@',
  '-old',
  '+new',
  '',
].join('\n')

describe('parseUnifiedDiff', () => {
  it('reads each hunk’s start lines, function context and prefixed lines, skipping the headers', () => {
    expect(parseUnifiedDiff(MODIFIED)).toEqual([
      {
        oldStart: 1,
        newStart: 1,
        context: 'server:',
        lines: ['   port: 8080', '-  host: localhost', '+  host: 0.0.0.0', '+  timeout: 30s', '   debug: false'],
      },
      { oldStart: 20, newStart: 21, context: '', lines: ['-old', '+new'] },
    ])
  })

  it('reads an added file as starting at line 0 of the old side', () => {
    const added = ['diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n')
    expect(parseUnifiedDiff(added)).toEqual([{ oldStart: 0, newStart: 1, context: '', lines: ['+one', '+two'] }])
  })

  it('keeps git’s "No newline at end of file" note with the hunk', () => {
    const text = ['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file', ''].join('\n')
    expect(parseUnifiedDiff(text)[0]!.lines).toEqual(['-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file'])
  })

  it('drops the carriage return of Windows line endings', () => {
    expect(parseUnifiedDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n')[0]!.lines).toEqual(['-a', '+b'])
  })

  it('has no hunks for a binary file', () => {
    const binary = ['diff --git a/logo.png b/logo.png', 'index e69de29..0f1e2d3 100644', 'Binary files a/logo.png and b/logo.png differ', ''].join('\n')
    expect(parseUnifiedDiff(binary)).toEqual([])
  })

  it('does not mistake the next file’s --- header for a removed line', () => {
    const twoFiles = MODIFIED + ['diff --git a/b.txt b/b.txt', '--- a/b.txt', '+++ b/b.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n')
    const hunks = parseUnifiedDiff(twoFiles)
    expect(hunks).toHaveLength(3)
    expect(hunks[1]!.lines).toEqual(['-old', '+new'])
  })
})
