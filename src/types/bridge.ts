import type { GitDataSource } from '@/services/GitDataSource'
import type { AddRepositoryResult, CloneProgress, CloneRequest } from '@/types/git'

/** Whether the installed git can be used, from `git --version` at startup. */
export type GitStatus =
  | { state: 'ready'; version: string }
  | { state: 'too-old'; version: string; minimum: string }
  | { state: 'missing'; minimum: string }

/**
 * The GitDataSource calls, carried to the main process over IPC. A clone's progress can't travel as a
 * callback argument, so it arrives as events: subscribe with onCloneProgress (which returns its
 * unsubscribe) around cloneRepository.
 */
export type GitBridge = Pick<
  GitDataSource,
  | 'listRepositories'
  | 'getBranches'
  | 'getHistory'
  | 'getCommitFiles'
  | 'getFileDiff'
  | 'compareFiles'
  | 'chooseCompareFile'
  | 'listBranchFiles'
  | 'addRepository'
  | 'removeRepository'
  | 'chooseCloneFolder'
  | 'cancelClone'
  | 'checkout'
  | 'fetch'
  | 'pull'
  | 'push'
> & {
  cloneRepository(request: CloneRequest): Promise<AddRepositoryResult>
  onCloneProgress(listener: (progress: CloneProgress) => void): () => void
}

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
  updates: UpdateSource
}

/**
 * The installed app's updates (only the packaged app checks; elsewhere nothing is ever ready). The
 * renderer asks once for one that downloaded before it was listening, then hears of later ones.
 */
export interface UpdateSource {
  readyVersion(): Promise<string | null>
  onReady(listener: (version: string) => void): () => void
  /** Quits, installs the downloaded version and starts it. */
  install(): Promise<void>
}
