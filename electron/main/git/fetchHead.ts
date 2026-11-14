import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runGit } from './runGit'

interface FileSnapshot {
  content: Buffer
  accessed: Date
  modified: Date
}

/** When FETCH_HEAD was last written, which git does on every fetch; null if never. */
export async function lastFetchTime(folder: string): Promise<string | null> {
  const found = await stat(await fetchHeadPath(folder)).catch(() => null)
  return found ? found.mtime.toISOString() : null
}

/**
 * Runs `fetch`, leaving FETCH_HEAD as it was when the fetch fails. Git empties FETCH_HEAD
 * before it connects, so a fetch that fails would otherwise look like one that succeeded just
 * now (the last fetch time is FETCH_HEAD's), and lose what the last good fetch recorded. When
 * some remotes answered (`--all`), git keeps what they sent, and so does this.
 */
export async function preservingFetchHead(folder: string, fetch: () => Promise<unknown>): Promise<void> {
  const fetchHead = await fetchHeadPath(folder)
  const before = await snapshotOf(fetchHead)
  await fetch().catch(async (error: unknown) => {
    await restoreIfEmptied(fetchHead, before)
    throw error
  })
}

async function fetchHeadPath(folder: string): Promise<string> {
  return resolve(folder, (await runGit(folder, ['rev-parse', '--git-path', 'FETCH_HEAD'])).trim())
}

async function snapshotOf(path: string): Promise<FileSnapshot | null> {
  const found = await stat(path).catch(() => null)
  if (!found) return null
  return { content: await readFile(path), accessed: found.atime, modified: found.mtime }
}

async function restoreIfEmptied(path: string, snapshot: FileSnapshot | null): Promise<void> {
  const after = await stat(path).catch(() => null)
  if (after?.size === 0) await restore(path, snapshot)
}

/** Puts a file back as `snapshot` recorded it, or removes it if there was none. */
async function restore(path: string, snapshot: FileSnapshot | null): Promise<void> {
  if (!snapshot) {
    await rm(path, { force: true })
    return
  }
  await writeFile(path, snapshot.content)
  await utimes(path, snapshot.accessed, snapshot.modified)
}
