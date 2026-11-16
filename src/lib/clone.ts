import type { CloneProgress } from '@/types/git'

/**
 * The folder name git itself would pick: the URL's last part without `.git`
 * (`git@github.com:rlaprelle/GitManager.git` → `GitManager`). Empty while the URL has none.
 */
export function repositoryNameFromUrl(url: string): string {
  const path = url.trim().replace(/^[a-z]+:\/\/[^/]*/i, '')
  const last = path.replace(/[/\\]+$/, '').split(/[/\\:]/).pop() ?? ''
  return last.replace(/\.git$/i, '')
}

const URL_WITH_SCHEME = /^(https?|ssh|git|file):\/\/[^\s/][^\s]*$|^file:\/\/\/[^\s]+$/i
/** `[user@]host:path`, git's scp-like form. A one-letter host would be a Windows drive (`C:\repos`). */
const SCP_LIKE = /^([\w.-]+@)?[\w-][\w.-]+:(?![\\/])[^\s]+$/

/**
 * Why git shouldn't be given this URL, or null if it may. Only transports that fetch a repository:
 * nothing git could read as an option (`-…`), and no `ext::`/`fd::`, which run commands. Local
 * paths go through file:// so a typed path is never mistaken for one of those.
 */
export function cloneUrlProblem(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Enter the repository’s URL'
  const allowed = !trimmed.includes('::') && (URL_WITH_SCHEME.test(trimmed) || SCP_LIKE.test(trimmed))
  return allowed
    ? null
    : `${trimmed} isn’t a repository URL git can clone: use https://, ssh://, git://, file:// or user@host:path`
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/

/** Why Windows can't have a folder of this name inside the chosen one, or null if it can. */
export function folderNameProblem(name: string): string | null {
  if (!name) return 'Enter a folder name'
  const unusable =
    FORBIDDEN_CHARACTERS.test(name) ||
    name === '.' ||
    name === '..' ||
    /[. ]$/.test(name) ||
    RESERVED_NAMES.test(name)
  return unusable ? `"${name}" can’t be a folder name` : null
}

const PROGRESS_LINE = /^(?:remote: )?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/
const LINE_BREAKS = /[\r\n]+/

/**
 * The newest progress git reported in what it has written to stderr so far. `git clone --progress`
 * rewrites its line with carriage returns ("Receiving objects:  42% (420/1000)\r"), so the last
 * matching line wins.
 */
export function latestCloneProgress(stderr: string): CloneProgress | null {
  const lines = stderr.split(LINE_BREAKS).reverse()
  for (const line of lines) {
    const match = PROGRESS_LINE.exec(line.trim())
    if (match) return { phase: match[1]!, percent: Number(match[2]) }
  }
  return null
}

/** The status line while a clone runs: 'Cloning tools… Receiving objects 42%'. */
export function cloneProgressLabel(name: string, progress: CloneProgress | null): string {
  return progress ? `Cloning ${name}… ${progress.phase} ${progress.percent}%` : `Cloning ${name}…`
}

/** What a cancelled clone rejects with; the UI says it without "Failed: ". */
export const CLONE_CANCELLED = 'Clone cancelled'

/**
 * Why a clone failed, from git's stderr. Clone starts with "Cloning into 'x'..." and mixes in
 * progress, so the reason is the first fatal/error line rather than the first line.
 */
export function cloneFailureMessage(stderr: string): string {
  const line = stderr.split(LINE_BREAKS).find((candidate) => /^(fatal|error): /.test(candidate.trim())) ?? ''
  return line.trim().replace(/^(fatal|error): /, '')
}
