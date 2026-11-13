import { stat } from 'node:fs/promises'
import { basename, isAbsolute, normalize, relative, resolve } from 'node:path'
import { localNameOf, switchedMessage } from '../../../src/lib/checkout'
import { layoutLanes, primaryBranchTip } from '../../../src/lib/laneLayout'
import { parseUnifiedDiff } from '../../../src/lib/parseDiff'
import type { GitDataSource } from '../../../src/services/GitDataSource'
import type {
  AddRepositoryResult,
  Branches,
  CheckoutOptions,
  CheckoutResult,
  CheckoutTarget,
  FileChange,
  HistoryPage,
  Hunk,
  OperationResult,
  Repository,
} from '../../../src/types/git'
import {
  BRANCH_FORMAT,
  LOG_FORMAT,
  checkoutRefusal,
  countStatusEntries,
  parseBranches,
  parseCommitLog,
  parseNameStatus,
} from './parse'
import { GitError, runGit } from './runGit'

/** A repository the user added: where it is, and the id the UI knows it by. */
export interface StoredRepository {
  id: string
  path: string
}

/** The user's list of repositories (RepositoryStore keeps it in repositories.json). */
export interface RepositoryCatalog {
  list(): Promise<StoredRepository[]>
  /** Adds a folder, or returns the existing entry for it. */
  add(path: string): Promise<StoredRepository>
  remove(id: string): Promise<void>
}

/** Asks the user for a folder; null when they cancel. */
export type ChooseFolder = () => Promise<string | null>

const FOLDER_NOT_FOUND = 'Folder not found'

/** Uncommitted changes, one NUL-terminated entry per path (untracked files included). */
const STATUS = ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=normal']

/** Full or abbreviated commit hash. Checked so a "hash" can never be read as a git option. */
const COMMIT_HASH = /^[0-9a-f]{4,64}$/i

/**
 * Reads repositories with the user's installed git, and switches branches. Fetch, Pull and
 * Push reject for now, and the desktop app hides their buttons.
 *
 * Every argument that comes from the renderer is checked before it reaches git: repositories
 * are looked up by id (the renderer never supplies a folder), hashes must look like hashes,
 * and paths always follow `--`.
 */
export class GitCliDataSource implements GitDataSource {
  constructor(
    private readonly repositories: RepositoryCatalog,
    private readonly chooseFolder: ChooseFolder,
  ) {}

  async listRepositories(): Promise<Repository[]> {
    const stored = await this.repositories.list()
    return Promise.all(stored.map((repo) => this.summarize(repo)))
  }

  /** Adds the repository the chosen folder belongs to, by its top folder, so a subfolder works too. */
  async addRepository(): Promise<AddRepositoryResult> {
    const chosen = await this.chooseFolder()
    if (chosen === null) return { repository: null, message: '' }
    const topFolder = await git(chosen, ['rev-parse', '--show-toplevel']).catch(() => {
      throw new GitError(`${chosen} isn’t inside a git repository`)
    })
    const path = normalize(topFolder.trim())
    const alreadyListed = (await this.repositories.list()).some((repo) => repo.path.toLowerCase() === path.toLowerCase())
    const repository = await this.summarize(await this.repositories.add(path))
    return { repository, message: alreadyListed ? `${repository.name} is already in the list` : `Added ${repository.name}` }
  }

  async removeRepository(repoId: string): Promise<OperationResult> {
    const repo = await this.stored(repoId)
    await this.repositories.remove(repoId)
    return { message: `Removed ${basename(repo.path)} from the list` }
  }

  async getBranches(repoId: string): Promise<Branches> {
    return this.branchesAt(await this.folderOf(repoId))
  }

  async getHistory(repoId: string, limit: number): Promise<HistoryPage> {
    const folder = await this.folderOf(repoId)
    if (!(await hasCommits(folder))) return { commits: [], hasMore: false }

    const count = Math.max(1, Math.floor(limit))
    const [log, branches] = await Promise.all([
      // HEAD as well as every branch, so a detached HEAD's commits show too.
      git(folder, ['log', 'HEAD', '--branches', '--remotes', '--date-order', '-z', `--format=${LOG_FORMAT}`, `--max-count=${count + 1}`]),
      this.branchesAt(folder),
    ])
    const logged = parseCommitLog(log)
    const page = logged.slice(0, count)
    const rows = layoutLanes(page, primaryBranchTip(branches))
    const localNames = new Set(branches.local.map((branch) => branch.name))
    return {
      commits: page.map(({ hash, message, author, date, refs }, index) => ({
        hash,
        message,
        author,
        date,
        refs: localFirst(refs, localNames),
        graph: rows[index]!,
      })),
      hasMore: logged.length > count,
    }
  }

  async getCommitFiles(repoId: string, hash: string): Promise<FileChange[]> {
    const folder = await this.folderOf(repoId)
    const range = await comparedRange(folder, hash)
    return this.changedFiles(folder, range)
  }

  /**
   * Renames are detected (-M, git's default 50% similarity) so a moved file is one change, not
   * a deletion plus an addition. --no-commit-id: with one commit (a root), diff-tree otherwise
   * prints its hash first.
   */
  private async changedFiles(folder: string, range: string[]): Promise<FileChange[]> {
    return parseNameStatus(await git(folder, ['diff-tree', '-r', '-z', '--no-commit-id', '--name-status', '-M', ...range]))
  }

  async getFileDiff(repoId: string, hash: string, path: string): Promise<Hunk[]> {
    const folder = await this.folderOf(repoId)
    const range = await comparedRange(folder, hash)
    // A renamed file needs both paths in the pathspec, or git sees a deletion and an addition.
    const renamedFrom = (await this.changedFiles(folder, range)).find((file) => file.path === path)?.oldPath
    const paths = renamedFrom ? [renamedFrom, checkedPath(path)] : [checkedPath(path)]
    const diff = await git(folder, ['diff-tree', '-p', '--no-ext-diff', '-M', ...range, '--', ...paths])
    if (!diff.trim()) throw new GitError(`${path} is not changed in ${hash.slice(0, 7)}`)
    return parseUnifiedDiff(diff)
  }

  async compareFiles(repoId: string, leftPath: string, rightPath: string): Promise<Hunk[]> {
    const folder = await this.folderOf(repoId)
    const left = insideFolder(folder, leftPath)
    const right = insideFolder(folder, rightPath)
    // Exit code 1 means "the files differ", which is the answer, not a failure.
    const diff = await git(folder, ['diff', '--no-index', '--no-ext-diff', '--', left, right], [1])
    return parseUnifiedDiff(diff)
  }

  /**
   * `git switch`, after checking the target is one of the repository's branches: the name never
   * reaches git unless git listed it, so it can't be read as an option. Uncommitted changes come
   * along as git allows; when git refuses, the error names the files.
   */
  async checkout(repoId: string, target: CheckoutTarget, options: CheckoutOptions = {}): Promise<CheckoutResult> {
    const folder = await this.folderOf(repoId)
    const plan = await switchPlan(folder, await this.branchesAt(folder), target)
    if (!options.leaveCommits) {
      const commitsLeft = await commitsOnlyOnDetachedHead(folder)
      if (commitsLeft > 0) return { kind: 'confirm', commitsLeft }
    }
    await git(folder, ['switch', '--quiet', ...plan.args]).catch((error: unknown) => {
      const refusal = error instanceof GitError ? checkoutRefusal(error.stderr, plan.branch) : null
      throw refusal ? new GitError(refusal, (error as GitError).stderr) : error
    })
    const changes = countStatusEntries(await git(folder, STATUS))
    return { kind: 'switched', branch: plan.branch, message: switchedMessage(plan.branch, changes, plan.tracking) }
  }

  async fetch(): Promise<OperationResult> {
    throw notYetAvailable('Fetch')
  }

  async pull(): Promise<OperationResult> {
    throw notYetAvailable('Pull')
  }

  async push(): Promise<OperationResult> {
    throw notYetAvailable('Push')
  }

  /** One repository's list entry. A repository git can't read is still listed, with the problem. */
  private async summarize({ id, path }: StoredRepository): Promise<Repository> {
    const unreadable = (problem: string): Repository => ({
      id,
      name: basename(path),
      path,
      currentBranch: null,
      changedFileCount: 0,
      lastFetch: null,
      problem,
    })
    if (!(await isFolder(path))) return unreadable(FOLDER_NOT_FOUND)
    try {
      const [currentBranch, changes, lastFetch] = await Promise.all([
        checkedOutBranch(path),
        git(path, STATUS),
        lastFetchTime(path),
      ])
      return { ...unreadable(''), currentBranch, changedFileCount: countStatusEntries(changes), lastFetch, problem: null }
    } catch (error) {
      return unreadable(error instanceof Error ? error.message : String(error))
    }
  }

  private async branchesAt(folder: string): Promise<Branches> {
    return parseBranches(await git(folder, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']))
  }

  private async stored(repoId: string): Promise<StoredRepository> {
    const repo = (await this.repositories.list()).find((candidate) => candidate.id === repoId)
    if (!repo) throw new GitError(`Unknown repository: ${repoId}`)
    return repo
  }

  /**
   * The repository's folder, checked to exist: on Windows a missing working folder makes
   * starting git fail exactly as if git weren't installed.
   */
  private async folderOf(repoId: string): Promise<string> {
    const repo = await this.stored(repoId)
    if (!(await isFolder(repo.path))) throw new GitError(`${FOLDER_NOT_FOUND}: ${repo.path}`)
    return repo.path
  }
}

async function isFolder(path: string): Promise<boolean> {
  const found = await stat(path).catch(() => null)
  return found?.isDirectory() ?? false
}

/** Local branches before remote ones, as the design shows them; git's own order otherwise. */
function localFirst(refs: string[], localNames: Set<string>): string[] {
  return [...refs.filter((ref) => localNames.has(ref)), ...refs.filter((ref) => !localNames.has(ref))]
}

function git(folder: string, args: string[], okExitCodes?: number[]): Promise<string> {
  return runGit(folder, args, { okExitCodes })
}

/** The checked-out branch, or null when HEAD is detached (a commit is checked out directly). */
async function checkedOutBranch(folder: string): Promise<string | null> {
  const name = await git(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1])
  return name.trim() || null
}

async function hasCommits(folder: string): Promise<boolean> {
  const head = await git(folder, ['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], [1])
  return head.trim() !== ''
}

/** When FETCH_HEAD was last written, which git does on every fetch; null if never. */
async function lastFetchTime(folder: string): Promise<string | null> {
  const fetchHead = (await git(folder, ['rev-parse', '--git-path', 'FETCH_HEAD'])).trim()
  const found = await stat(resolve(folder, fetchHead)).catch(() => null)
  return found ? found.mtime.toISOString() : null
}

/**
 * What diff-tree compares for a commit: its first parent and the commit, or the commit alone
 * (`--root`) for a root commit. A merge therefore shows what it brought into its first parent.
 */
async function comparedRange(folder: string, hash: string): Promise<string[]> {
  if (!COMMIT_HASH.test(hash)) throw new GitError(`Not a commit hash: ${hash}`)
  const line = await git(folder, ['rev-list', '--parents', '--max-count=1', `${hash}^{commit}`]).catch(() => {
    throw new GitError(`Unknown commit: ${hash}`)
  })
  const [commit = '', firstParent] = line.trim().split(' ')
  return firstParent ? [firstParent, commit] : ['--root', commit]
}

/** What `git switch` is given for a target, and the branch it ends on. */
interface SwitchPlan {
  args: string[]
  branch: string
  /** The remote branch a new local branch tracks. */
  tracking?: string
}

async function switchPlan(folder: string, branches: Branches, target: CheckoutTarget): Promise<SwitchPlan> {
  if ('local' in target) {
    if (!branches.local.some((branch) => branch.name === target.local)) throw new GitError(`Unknown branch: ${target.local}`)
    // --no-guess: never create a branch from a remote one of the same name; only a remote target does that.
    return { args: ['--no-guess', target.local], branch: target.local }
  }
  if (!branches.remote.some((branch) => branch.name === target.remote)) throw new GitError(`Unknown branch: ${target.remote}`)
  const remotes = (await git(folder, ['remote'])).split('\n').map((line) => line.trim()).filter(Boolean)
  const name = localNameOf(target.remote, remotes)
  if (name === null) throw new GitError(`${target.remote} belongs to no remote`)
  if (branches.local.some((branch) => branch.name === name)) throw new GitError(`A local branch ${name} already exists`)
  return { args: ['--track', target.remote], branch: name, tracking: target.remote }
}

/** Commits that switching away from a detached HEAD would leave on no branch, remote branch or tag. */
async function commitsOnlyOnDetachedHead(folder: string): Promise<number> {
  if ((await checkedOutBranch(folder)) !== null || !(await hasCommits(folder))) return 0
  const count = await git(folder, ['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes', '--tags'])
  return Number(count.trim())
}

function checkedPath(path: string): string {
  if (!path || path.includes('\0')) throw new GitError('Not a file path')
  return path
}

/** Resolves a path typed by the user against the repository, refusing anything outside its folder. */
function insideFolder(folder: string, path: string): string {
  const absolute = resolve(folder, checkedPath(path.trim()))
  const fromFolder = relative(folder, absolute)
  if (fromFolder.startsWith('..') || isAbsolute(fromFolder)) throw new GitError(`${path} is outside the repository`)
  return absolute
}

function notYetAvailable(operation: string): GitError {
  return new GitError(`${operation} isn't available in this version yet`)
}
