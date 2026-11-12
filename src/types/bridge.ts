import type { GitDataSource } from '@/services/GitDataSource'

/** Whether the installed git can be used, from `git --version` at startup. */
export type GitStatus =
  | { state: 'ready'; version: string }
  | { state: 'too-old'; version: string; minimum: string }
  | { state: 'missing'; minimum: string }

/** The GitDataSource calls the desktop app supports, carried to the main process over IPC. Writes come later. */
export type GitBridge = Pick<
  GitDataSource,
  | 'listRepositories'
  | 'getBranches'
  | 'getHistory'
  | 'getCommitFiles'
  | 'getFileDiff'
  | 'compareFiles'
  | 'addRepository'
  | 'removeRepository'
>

/** How a main-process handler answers: the value, or the error's message without Electron's wrapper. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * What the preload script exposes to the renderer as `window.gitManager`.
 * Shared by electron/preload (implements it) and the renderer (calls it).
 * Every method crosses IPC, so every method is async; failures reject with git's message.
 */
export interface GitManagerBridge {
  getAppVersion(): Promise<string>
  getGitStatus(): Promise<GitStatus>
  git: GitBridge
}
