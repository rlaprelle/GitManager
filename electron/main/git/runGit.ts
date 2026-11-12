import { execFile } from 'node:child_process'

/** A git command failed; the message is git's own explanation, without its "fatal:" prefix. */
export class GitError extends Error {
  override name = 'GitError'
}

export interface RunGitOptions {
  /** Exit codes that mean success for this command (`diff --no-index` exits 1 when files differ). */
  okExitCodes?: number[]
}

/**
 * Settings that keep output machine-readable whatever the user's git config says. The user's
 * config otherwise still applies, so their credential helper and SSH setup keep working later.
 */
const FIXED_SETTINGS = ['-c', 'color.ui=never', '-c', 'core.quotepath=false', '-c', 'log.showSignature=false']

const ENVIRONMENT = {
  // Never wait for a username/password prompt nobody can see.
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  // Reading never takes the index lock, so it can't block the user's own git commands.
  GIT_OPTIONAL_LOCKS: '0',
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Runs the installed git with an argument list (no shell) in `cwd`, resolving with its stdout. */
export function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...FIXED_SETTINGS, ...args],
      { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, env: { ...process.env, ...ENVIRONMENT } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (typeof error.code === 'number' && options.okExitCodes?.includes(error.code)) return resolve(stdout)
        if (error.code === 'ENOENT') return reject(new GitError('Git is not installed, or not on the PATH'))
        reject(new GitError(gitMessage(stderr) || error.message))
      },
    )
  })
}

/** The first line git wrote to stderr, without its 'fatal: ' / 'error: ' prefix. */
function gitMessage(stderr: string): string {
  const line = stderr.split('\n').find((candidate) => candidate.trim()) ?? ''
  return line.replace(/^(fatal|error): /, '').trim()
}
