// Runs sandboxed: only `electron` can be required, and it must be bundled as
// CommonJS (Electron has no ESM loader for sandboxed preloads).
import { contextBridge, ipcRenderer } from 'electron'
import type { GitManagerBridge, IpcResult } from '../../src/types/bridge'
import { IpcChannel } from '../shared/channels'

/** Invokes a main-process handler, resolving with its value or rejecting with its plain message. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (result.ok) return result.value
  throw new Error(result.message)
}

const bridge: GitManagerBridge = {
  getAppVersion: () => call(IpcChannel.GetAppVersion),
  getGitStatus: () => call(IpcChannel.GetGitStatus),
  git: {
    listRepositories: () => call(IpcChannel.ListRepositories),
    getBranches: (repoId) => call(IpcChannel.GetBranches, repoId),
    getHistory: (repoId, limit) => call(IpcChannel.GetHistory, repoId, limit),
    getCommitFiles: (repoId, hash) => call(IpcChannel.GetCommitFiles, repoId, hash),
    getFileDiff: (repoId, hash, path) => call(IpcChannel.GetFileDiff, repoId, hash, path),
    compareFiles: (repoId, leftPath, rightPath) => call(IpcChannel.CompareFiles, repoId, leftPath, rightPath),
    addRepository: () => call(IpcChannel.AddRepository),
    removeRepository: (repoId) => call(IpcChannel.RemoveRepository, repoId),
    checkout: (repoId, target, options) => call(IpcChannel.Checkout, repoId, target, options),
  },
}

contextBridge.exposeInMainWorld('gitManager', bridge)
