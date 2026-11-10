/**
 * What the preload script exposes to the renderer as `window.gitManager`.
 * Shared by electron/preload (implements it) and the renderer (calls it).
 * Every method crosses IPC, so every method is async.
 */
export interface GitManagerBridge {
  getAppVersion(): Promise<string>
}
