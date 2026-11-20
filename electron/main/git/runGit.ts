import { type ChildProcess, execFile } from 'node:child_process'

/** A git command failed; the message is git's own explanation, without its "fatal:" prefix. */
export class GitError extends Error {
  override name = 'GitError'

  /** All git wrote to stderr, for callers that turn a known failure into a better message. */
  readonly stderr: string

  /** What git wrote to stdout before failing (`push --porcelain` reports a rejection there). */
  readonly stdout: string

  constructor(message: string, stderr = '', stdout = '') {
    super(message)
    this.stderr = stderr
    this.stdout = stdout
  }
}

export interface RunGitOptions {
  /** Exit codes that mean success for this command (`diff --no-index` exits 1 when files differ). */
  okExitCodes?: number[]
  /** For commands that talk to a remote (fetch, pull, push); see `network.ts`. Others never sign in. */
  network?: NetworkAccess
  /** Hears stderr as it arrives (clone's progress); the whole of it still comes with a failure. */
  onStderr?: (chunk: string) => void
  /** Aborting stops git and everything it started (a transfer's helpers, ssh). The call then rejects. */
  signal?: AbortSignal
  /** Extra environment for this command only (a merge builds its tree in a private index: GIT_INDEX_FILE). */
  env?: Record<string, string>
}

/** How a command that talks to a remote runs: where git and ssh ask for sign-in, and when a stalled transfer fails. */
export interface NetworkAccess {
  env: Record<string, string>
  /** `-c name=value` pairs. */
  settings: string[]
}

/**
 * Settings that keep output machine-readable whatever the user's git config says. The user's
 * config otherwise still applies, so their credential helper and SSH setup keep working later.
 */
const FIXED_SETTINGS = [
  ...['-c', 'color.ui=never'],
  ...['-c', 'core.quotepath=false'],
  ...['-c', 'log.showSignature=false'],
  // 'full' would label commits 'refs/heads/main' instead of 'main'.
  ...['-c', 'log.decorate=short'],
  // 'true' would print a blank context line as an empty line, without its leading space.
  ...['-c', 'diff.suppressBlankEmpty=false'],
]

const ENVIRONMENT = {
  // Never wait for a username/password prompt in a terminal nobody can see.
  GIT_TERMINAL_PROMPT: '0',
  // Reading never takes the index lock, so it can't block the user's own git commands.
  GIT_OPTIONAL_LOCKS: '0',
}

/** Commands that don't talk to a remote never need to sign in, so Git Credential Manager never shows a window for them. */
const NO_SIGN_IN = { GCM_INTERACTIVE: 'never' }

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Runs the installed git with an argument list (no shell) in `cwd`, resolving with its stdout. */
export function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...FIXED_SETTINGS, ...(options.network?.settings ?? []), ...args],
      { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, env: { ...environmentFor(options.network), ...options.env } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (typeof error.code === 'number' && options.okExitCodes?.includes(error.code)) return resolve(stdout)
        if (error.code === 'ENOENT') return reject(new GitError('Git is not installed, or not on the PATH'))
        reject(new GitError(gitMessage(stderr) || error.message, stderr, stdout))
      },
    )
    if (options.onStderr) child.stderr?.on('data', (chunk: string) => options.onStderr!(chunk))
    if (options.signal?.aborted) stopProcessTree(child)
    else options.signal?.addEventListener('abort', () => stopProcessTree(child), { once: true })
  })
}

/**
 * Ends git and the processes it started. On Windows, killing git alone would leave git-remote-https
 * or ssh running, holding the half-made clone's folder open so it can't be deleted.
 */
function stopProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform !== 'win32') {
    child.kill()
    return
  }
  execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
}

/** Runs git like runGit, resolving with stdout as bytes: file contents, which may be binary. */
export function runGitBytes(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...FIXED_SETTINGS, ...args],
      { cwd, encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, env: environmentFor(undefined) },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const message = stderr.toString('utf8')
        reject(new GitError(gitMessage(message) || error.message, message))
      },
    )
  })
}

function environmentFor(network: NetworkAccess | undefined): NodeJS.ProcessEnv {
  if (!network) return { ...process.env, ...ENVIRONMENT, ...NO_SIGN_IN }
  // Started from a shell that sets GCM_INTERACTIVE=never, the app would pass it on and sign-in could never show.
  const { GCM_INTERACTIVE: _inherited, ...inherited } = process.env
  return { ...inherited, ...ENVIRONMENT, ...network.env }
}

/**
 * The first line git wrote to stderr, without its 'fatal: ' / 'error: ' prefix. Advice lines
 * ('hint: ...') are skipped: git prints them before the error they explain.
 */
export function gitMessage(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((candidate) => candidate.trim() && !candidate.startsWith('hint:')) ?? ''
  return line.replace(/^(fatal|error): /, '').trim()
}
