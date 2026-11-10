// Runs sandboxed: only `electron` can be required, and it must be bundled as
// CommonJS (Electron has no ESM loader for sandboxed preloads).
import { contextBridge, ipcRenderer } from 'electron'
import type { GitManagerBridge } from '../../src/types/bridge'
import { IpcChannel } from '../shared/channels'

const bridge: GitManagerBridge = {
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.GetAppVersion),
}

contextBridge.exposeInMainWorld('gitManager', bridge)
