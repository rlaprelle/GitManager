import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CLONE_CANCELLED,
  cloneFailureMessage,
  cloneUrlProblem,
  folderNameProblem,
  latestCloneProgress,
} from '../../../src/lib/clone'
import type { CloneProgress, CloneRequest } from '../../../src/types/git'
import { networkAccessFor } from './network'
import { GitError, runGit } from './runGit'

/** How much of clone's stderr to keep for reading progress: its newest line is all that matters. */
const PROGRESS_TAIL = 512

/**
 * Where a clone may go: the checked request, and whether the destination folder is new (a cancelled
 * clone then deletes it) or an empty one that was already there (a cancelled clone empties it again).
 */
export interface ClonePlan {
  url: string
  name: string
  destination: string
  createsFolder: boolean
}

/**
 * Checks a clone request before git runs, so git never sees a URL it could read as an option or a
 * command, or a name that would land outside `parent`, and never clones over files already there.
 */
export async function planClone(parent: string, request: CloneRequest): Promise<ClonePlan> {
  const url = request.url.trim()
  const problem = cloneUrlProblem(url) ?? folderNameProblem(request.name)
  if (problem) throw new GitError(problem)
  if (!(await isFolder(parent))) throw new GitError(`${parent} doesn’t exist any more; choose another folder`)
  const destination = join(parent, request.name)
  const entries = await readdir(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    if (error.code === 'ENOTDIR') return ['(a file)']
    throw error
  })
  if (entries && entries.length > 0) throw new GitError(`${destination} already exists and isn’t empty`)
  return { url, name: request.name, destination, createsFolder: entries === null }
}

/**
 * Runs `git clone` for a plan. It may sign in, like fetch; ext:: stays off whatever the user's config
 * says. Aborting `signal` stops git and its helpers, removes what the clone made, and rejects with
 * CLONE_CANCELLED.
 */
export async function cloneInto(
  parent: string,
  plan: ClonePlan,
  signal: AbortSignal,
  onProgress: (progress: CloneProgress) => void = () => {},
): Promise<void> {
  // Cancelled while the request was being checked: git never starts.
  if (signal.aborted) throw new GitError(CLONE_CANCELLED)
  let tail = ''
  let reported = ''
  const hearStderr = (chunk: string) => {
    tail = (tail + chunk).slice(-PROGRESS_TAIL)
    const progress = latestCloneProgress(tail)
    const key = progress ? `${progress.phase}:${progress.percent}` : ''
    if (!progress || key === reported) return
    reported = key
    onProgress(progress)
  }
  try {
    await runGit(parent, ['-c', 'protocol.ext.allow=never', 'clone', '--progress', '--', plan.url, plan.name], {
      network: await networkAccessFor(parent),
      onStderr: hearStderr,
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      await removeLeftovers(plan)
      throw new GitError(CLONE_CANCELLED)
    }
    if (error instanceof GitError) throw new GitError(cloneFailureMessage(error.stderr) || error.message, error.stderr)
    throw error
  }
}

/**
 * What a stopped clone leaves behind. git cleans up after its own failures, but not after being
 * killed. Retries, because on Windows a helper that was just stopped can hold a file for a moment.
 */
async function removeLeftovers(plan: ClonePlan): Promise<void> {
  const removal = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }
  if (plan.createsFolder) {
    await rm(plan.destination, removal)
    return
  }
  const entries = await readdir(plan.destination).catch(() => [])
  await Promise.all(entries.map((entry) => rm(join(plan.destination, entry), removal)))
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false
}
