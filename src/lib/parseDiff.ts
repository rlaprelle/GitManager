import type { Hunk } from '@/types/git'

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/
/** Lines inside a hunk: context, removed, added, or git's "\ No newline at end of file" note. */
const HUNK_LINE = /^[ +\-\\]/

/**
 * Reads `git diff` output into hunks. File headers (`diff --git`, `---`, `+++`, `index`,
 * `Binary files ... differ`) are skipped, so a binary file has no hunks.
 */
export function parseUnifiedDiff(text: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const header = HUNK_HEADER.exec(line)
    if (header) {
      current = { oldStart: Number(header[1]), newStart: Number(header[2]), context: header[3] ?? '', lines: [] }
      hunks.push(current)
    } else if (current && HUNK_LINE.test(line)) {
      current.lines.push(line)
    } else {
      // A file header or the trailing newline: whatever follows belongs to no hunk until the next @@.
      current = null
    }
  }
  return hunks
}
