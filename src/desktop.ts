// Desktop entry (desktop.html, built by electron-vite): the app on the user's installed git.
// It must never import the sample data, so an installed app can't fall back to it
// (e2e-electron checks the built bundle).
import { mountApp, mountGitRequired } from './mountApp'
import { ALL_OPERATIONS } from './services/GitDataSource'
import { IpcGitDataSource } from './services/IpcGitDataSource'
import type { GitManagerBridge } from './types/bridge'

const bridge = (window as unknown as { gitManager: GitManagerBridge }).gitManager

void bridge.getGitStatus().then((status) => {
  if (status.state !== 'ready') {
    mountGitRequired(status)
    return
  }
  mountApp({ source: new IpcGitDataSource(bridge.git), comparePaths: { left: '', right: '' }, operations: ALL_OPERATIONS })
})
