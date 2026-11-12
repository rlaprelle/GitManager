import type { GitDataSource } from '../../src/services/GitDataSource'
import type { GitStatus, IpcResult } from '../../src/types/bridge'
import { IpcChannel } from '../shared/channels'

/** The part of ipcMain the handlers need, so they can be tested without Electron. */
export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
}

export interface IpcServices {
  source: GitDataSource
  appVersion: string
  checkGit(): Promise<GitStatus>
}

const MAX_COUNT = 10_000

/**
 * Registers a handler per channel. Arguments come from the renderer, so each is checked for
 * type before the data source sees it. Answers are IpcResults: Electron would otherwise wrap a
 * thrown error's message in "Error invoking remote method '...': Error: ...".
 */
export function registerIpcHandlers(ipc: IpcRegistrar, { source, appVersion, checkGit }: IpcServices): void {
  const handle = <T>(channel: string, answer: (...args: unknown[]) => Promise<T> | T) =>
    ipc.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
      try {
        return { ok: true, value: await answer(...args) }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })

  handle(IpcChannel.GetAppVersion, () => appVersion)
  handle(IpcChannel.GetGitStatus, () => checkGit())
  handle(IpcChannel.ListRepositories, () => source.listRepositories())
  handle(IpcChannel.GetBranches, (repoId) => source.getBranches(text(repoId)))
  handle(IpcChannel.GetHistory, (repoId, limit) => source.getHistory(text(repoId), count(limit)))
  handle(IpcChannel.GetCommitFiles, (repoId, hash) => source.getCommitFiles(text(repoId), text(hash)))
  handle(IpcChannel.GetFileDiff, (repoId, hash, path) => source.getFileDiff(text(repoId), text(hash), text(path)))
  handle(IpcChannel.CompareFiles, (repoId, left, right) => source.compareFiles(text(repoId), text(left), text(right)))
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error(`Expected text, got ${typeof value}`)
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_COUNT) {
    throw new Error(`Expected a count from 1 to ${MAX_COUNT}`)
  }
  return value
}
