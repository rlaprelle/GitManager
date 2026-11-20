import { errorMessage } from '../../src/lib/errorMessage'
import type { GitDataSource } from '../../src/services/GitDataSource'
import type { GitStatus, IpcResult } from '../../src/types/bridge'
import type { CheckoutOptions, CheckoutTarget, CloneRequest, CompareSide, MergeRequest, MergeResolution } from '../../src/types/git'
import { IpcChannel, IpcEvent } from '../shared/channels'
import type { UpdateChecks } from './updates'

/** The part of ipcMain the handlers need, so they can be tested without Electron. */
export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
}

export interface IpcServices {
  source: GitDataSource
  appVersion: string
  checkGit(): Promise<GitStatus>
  /** Null when this run doesn't update itself (unpackaged: dev and tests). */
  updates?: UpdateChecks | null
}

const MAX_COUNT = 10_000

/**
 * Registers a handler per channel. Arguments come from the renderer, so each is checked for
 * type before the data source sees it. Answers are IpcResults: Electron would otherwise wrap a
 * thrown error's message in "Error invoking remote method '...': Error: ...".
 */
export function registerIpcHandlers(ipc: IpcRegistrar, { source, appVersion, checkGit, updates = null }: IpcServices): void {
  const handle = <T>(channel: string, answer: (...args: unknown[]) => Promise<T> | T) =>
    ipc.handle(channel, (_event, ...args) => answered(() => answer(...args)))

  handle(IpcChannel.GetAppVersion, () => appVersion)
  handle(IpcChannel.GetGitStatus, () => checkGit())
  handle(IpcChannel.ListRepositories, () => source.listRepositories())
  handle(IpcChannel.GetBranches, (repoId) => source.getBranches(text(repoId)))
  handle(IpcChannel.GetHistory, (repoId, limit) => source.getHistory(text(repoId), count(limit)))
  handle(IpcChannel.GetCommitFiles, (repoId, hash) => source.getCommitFiles(text(repoId), text(hash)))
  handle(IpcChannel.GetFileDiff, (repoId, hash, path) => source.getFileDiff(text(repoId), text(hash), text(path)))
  handle(IpcChannel.CompareFiles, (left, right) => source.compareFiles(compareSide(left), compareSide(right)))
  handle(IpcChannel.ChooseCompareFile, () => source.chooseCompareFile())
  handle(IpcChannel.ListBranchFiles, (repoId, branch) => source.listBranchFiles(text(repoId), text(branch)))
  handle(IpcChannel.AddRepository, () => source.addRepository())
  handle(IpcChannel.RemoveRepository, (repoId) => source.removeRepository(text(repoId)))
  handle(IpcChannel.ChooseCloneFolder, () => source.chooseCloneFolder())
  // The one handler that talks back while it runs: progress goes to the window that asked.
  ipc.handle(IpcChannel.CloneRepository, (event, request) =>
    answered(() =>
      source.cloneRepository(cloneRequest(request), (progress) => senderOf(event)?.send(IpcEvent.CloneProgress, progress)),
    ),
  )
  handle(IpcChannel.CancelClone, () => source.cancelClone())
  handle(IpcChannel.GetReadyUpdate, () => updates?.readyVersion() ?? null)
  handle(IpcChannel.InstallUpdate, () => {
    if (!updates) throw new Error('Only the installed app updates itself')
    updates.install()
  })
  handle(IpcChannel.Checkout, (repoId, target, options) =>
    source.checkout(text(repoId), checkoutTarget(target), checkoutOptions(options)),
  )
  handle(IpcChannel.Fetch, (repoId) => source.fetch(text(repoId)))
  handle(IpcChannel.Pull, (repoId, branch) => source.pull(text(repoId), text(branch)))
  handle(IpcChannel.Push, (repoId, branch) => source.push(text(repoId), text(branch)))
  handle(IpcChannel.GetUnfinishedOperation, (repoId) => source.getUnfinishedOperation(text(repoId)))
  handle(IpcChannel.PreviewMerge, (repoId, branch) => source.previewMerge(text(repoId), text(branch)))
  handle(IpcChannel.GetMergeConflicts, (repoId, request) => source.getMergeConflicts(text(repoId), mergeRequest(request)))
  handle(IpcChannel.Merge, (repoId, request, resolutions) =>
    source.merge(text(repoId), mergeRequest(request), mergeResolutions(resolutions)),
  )
}

async function answered<T>(work: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

/** The window an IPC call came from, to send it events. */
function senderOf(event: unknown): { send(channel: string, ...args: unknown[]): void } | null {
  const sender = (event as { sender?: { send?: unknown } } | null)?.sender
  return typeof sender?.send === 'function' ? (sender as { send(channel: string, ...args: unknown[]): void }) : null
}

const NOT_A_COMPARE_SIDE = 'Expected a file to compare: { kind: "repository", repoId, branch, path } or { kind: "file", fileId }'

/** One side of a comparison, rebuilt from its checked fields so nothing else reaches the source. */
function compareSide(value: unknown): CompareSide {
  const side = value as Record<string, unknown> | null
  if (typeof side !== 'object' || side === null) throw new Error(NOT_A_COMPARE_SIDE)
  if (side['kind'] === 'file') return { kind: 'file', fileId: text(side['fileId']) }
  if (side['kind'] !== 'repository') throw new Error(NOT_A_COMPARE_SIDE)
  const branch = side['branch'] === null ? null : text(side['branch'])
  return { kind: 'repository', repoId: text(side['repoId']), branch, path: text(side['path']) }
}

/** Exactly a URL and a folder name, as text; the source checks what they say. */
function cloneRequest(value: unknown): CloneRequest {
  const request = value as Partial<Record<keyof CloneRequest, unknown>> | null
  if (typeof request !== 'object' || request === null) throw new Error('Expected a clone request: { url, name }')
  return { url: text(request.url), name: text(request.name) }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error(`Expected text, got ${typeof value}`)
  return value
}

const NOT_A_CHECKOUT_TARGET = 'Expected a branch to check out: { local } or { remote }'

/** Exactly one of `local` or `remote`, as text: never both, so the source can't guess which was meant. */
function checkoutTarget(value: unknown): CheckoutTarget {
  const fields = Object.entries(plainObject(value) ?? {})
  const [key, name] = fields[0] ?? []
  if (fields.length !== 1 || typeof name !== 'string') throw new Error(NOT_A_CHECKOUT_TARGET)
  if (key === 'local') return { local: name }
  if (key === 'remote') return { remote: name }
  throw new Error(NOT_A_CHECKOUT_TARGET)
}

/** Only the options the source knows, so nothing else rides along to it. */
function checkoutOptions(value: unknown): CheckoutOptions {
  if (value === undefined) return {}
  const { leaveCommits, ...rest } = plainObject(value) ?? { unexpected: value }
  const valid = Object.keys(rest).length === 0 && (leaveCommits === undefined || typeof leaveCommits === 'boolean')
  if (!valid) throw new Error('Expected checkout options: { leaveCommits?: boolean }')
  return leaveCommits === undefined ? {} : { leaveCommits }
}

/** Exactly a branch and two commits, as text; the source checks what they say. */
function mergeRequest(value: unknown): MergeRequest {
  const request = plainObject(value)
  if (request === null) throw new Error('Expected a merge: { branch, into, ours, theirs }')
  return { branch: text(request['branch']), into: text(request['into']), ours: text(request['ours']), theirs: text(request['theirs']) }
}

function mergeResolutions(value: unknown): MergeResolution[] {
  if (!Array.isArray(value)) throw new Error('Expected a list of resolved files: [{ path, text }]')
  return value.map((item) => {
    const resolution = plainObject(item)
    if (resolution === null) throw new Error('Expected a resolved file: { path, text }')
    return { path: text(resolution['path']), text: text(resolution['text']) }
  })
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_COUNT) {
    throw new Error(`Expected a count from 1 to ${MAX_COUNT}`)
  }
  return value
}
