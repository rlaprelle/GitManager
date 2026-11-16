// Runs sandboxed: only `electron` can be required, and it must be bundled as
// CommonJS (Electron has no ESM loader for sandboxed preloads).
import { contextBridge, ipcRenderer } from 'electron'
import type { GitManagerBridge, IpcResult } from '../../src/types/bridge'
import type { CloneProgress } from '../../src/types/git'
import { IpcChannel, IpcEvent } from '../shared/channels'

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
    chooseCloneFolder: () => call(IpcChannel.ChooseCloneFolder),
    cloneRepository: (request) => call(IpcChannel.CloneRepository, request),
    cancelClone: () => call(IpcChannel.CancelClone),
    onCloneProgress: (listener) => {
      const relay = (_event: unknown, progress: CloneProgress) => listener(progress)
      ipcRenderer.on(IpcEvent.CloneProgress, relay)
      return () => {
        ipcRenderer.removeListener(IpcEvent.CloneProgress, relay)
      }
    },
    checkout: (repoId, target, options) => call(IpcChannel.Checkout, repoId, target, options),
    fetch: (repoId) => call(IpcChannel.Fetch, repoId),
    pull: (repoId, branch) => call(IpcChannel.Pull, repoId, branch),
    push: (repoId, branch) => call(IpcChannel.Push, repoId, branch),
  },
}

contextBridge.exposeInMainWorld('gitManager', bridge)
