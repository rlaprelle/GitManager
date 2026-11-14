import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, normalize, relative, resolve } from 'node:path'
import { localNameOf, switchedMessage } from '../../../src/lib/checkout'
import { layoutLanes, primaryBranchTip } from '../../../src/lib/laneLayout'
import { parseUnifiedDiff } from '../../../src/lib/parseDiff'
import { fetchedMessage, publishedMessage, pulledMessage, pushedMessage, remoteChanges } from '../../../src/lib/remoteOperations'
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
import { networkAccessFor } from './network'
import {
  BRANCH_FORMAT,
  LOG_FORMAT,
  type PushedRef,
  UPSTREAM_FORMAT,
  type Upstream,
  checkoutRefusal,
  countStatusEntries,
  parseBranches,
  parseCommitLog,
  parseNameStatus,
  parsePushPorcelain,
  parseUpstream,
  pullRefusal,
  pushRefusal,
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
 * Reads repositories with the user's installed git; switches branches, fetches, pulls and
 * pushes. Commands that talk to a remote may show git's own sign-in windows (`network.ts`).
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

  /**
   * `git fetch --all --prune`: every remote, dropping branches deleted there. The message comes
   * from comparing the remote branches before and after, not from git's (translated) output.
   */
  async fetch(repoId: string): Promise<OperationResult> {
    const folder = await this.folderOf(repoId)
    if ((await remotesOf(folder)).length === 0) throw new GitError('this repository has no remote to fetch from')
    const before = (await this.branchesAt(folder)).remote
    await fetchKeepingLastFetch(folder, ['--all', '--prune', '--quiet'])
    const after = (await this.branchesAt(folder)).remote
    return { message: fetchedMessage(remoteChanges(before, after)) }
  }

  /**
   * Fast-forwards the checked-out branch to its upstream, after fetching the upstream's remote.
   * Never merges or rebases: when both sides have new commits it refuses, changing nothing but
   * the fetched remote branches. Done as fetch + `merge --ff-only` rather than `git pull`, so
   * the user's pull.rebase setting can't change what happens.
   */
  async pull(repoId: string, branch: string): Promise<OperationResult> {
    const folder = await this.folderOf(repoId)
    const current = await checkedOutBranch(folder)
    if (current === null) throw new GitError('no branch is checked out')
    if (current !== branch) throw new GitError(`${branch} isn’t checked out; ${current} is`)
    const upstream = await upstreamOf(folder, branch)
    if (!upstream) throw new GitError(`${branch} has no upstream branch to pull from`)

    if (upstream.remote !== '.') await fetchKeepingLastFetch(folder, ['--prune', '--quiet', '--', upstream.remote])
    const fetched = await upstreamOf(folder, branch)
    if (!fetched || fetched.gone) throw new GitError(`${upstream.name} no longer exists on ${upstream.remote}`)

    const [behind, ahead] = await Promise.all([
      commitCount(folder, `HEAD..${fetched.ref}`),
      commitCount(folder, `${fetched.ref}..HEAD`),
    ])
    if (behind === 0) return { message: pulledMessage(0, fetched.name) }
    if (ahead > 0) {
      throw new GitError(`can’t fast-forward: ${branch} and ${fetched.name} both have new commits. Merge or rebase them in a terminal.`)
    }
    await git(folder, ['merge', '--ff-only', '--quiet', fetched.ref]).catch((error: unknown) => {
      const refusal = error instanceof GitError ? pullRefusal(error.stderr, fetched.name) : null
      throw refusal ? new GitError(refusal, (error as GitError).stderr) : error
    })
    return { message: pulledMessage(behind, fetched.name) }
  }

  /**
   * Pushes a branch to its upstream, by explicit refspec so push.default can't send it anywhere
   * else; never forced. A branch without an upstream is published to origin (or the only
   * remote) and tracks it from then on.
   */
  async push(repoId: string, branch: string): Promise<OperationResult> {
    const folder = await this.folderOf(repoId)
    if (!(await this.branchesAt(folder)).local.some((candidate) => candidate.name === branch)) {
      throw new GitError(`Unknown branch: ${branch}`)
    }
    const upstream = await upstreamOf(folder, branch)
    if (!upstream) return publish(folder, branch)

    // A deleted upstream is pushed again: count what the remote has on no branch.
    const pushing = upstream.gone
      ? await commitCount(folder, `refs/heads/${branch}`, `--remotes=${upstream.remote}`)
      : await commitCount(folder, `${upstream.ref}..refs/heads/${branch}`)
    const pushed = await pushRef(folder, upstream.remote, `refs/heads/${branch}:${upstream.remoteRef}`, branch, upstream.name)
    return { message: pushedMessage(pushed.flag === '=' ? 0 : pushing, upstream.name) }
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
  const found = await stat(await fetchHeadPath(folder)).catch(() => null)
  return found ? found.mtime.toISOString() : null
}

async function fetchHeadPath(folder: string): Promise<string> {
  return resolve(folder, (await git(folder, ['rev-parse', '--git-path', 'FETCH_HEAD'])).trim())
}

/**
 * `git fetch` with `args`, leaving FETCH_HEAD as it was when the fetch fails. Git empties
 * FETCH_HEAD before it connects, so a fetch that fails would otherwise look like one that
 * succeeded just now (the last fetch time is FETCH_HEAD's), and lose what the last good fetch
 * recorded. When some remotes answered (`--all`), git keeps what they sent, and so does this.
 */
async function fetchKeepingLastFetch(folder: string, args: string[]): Promise<void> {
  const fetchHead = await fetchHeadPath(folder)
  const before = await snapshotOf(fetchHead)
  try {
    await networkGit(folder, ['fetch', ...args])
  } catch (error) {
    const after = await stat(fetchHead).catch(() => null)
    if (after?.size === 0) await restore(fetchHead, before)
    throw error
  }
}

interface FileSnapshot {
  content: Buffer
  accessed: Date
  modified: Date
}

async function snapshotOf(path: string): Promise<FileSnapshot | null> {
  const found = await stat(path).catch(() => null)
  if (!found) return null
  return { content: await readFile(path), accessed: found.atime, modified: found.mtime }
}

/** Puts a file back as `snapshot` recorded it, or removes it if there was none. */
async function restore(path: string, snapshot: FileSnapshot | null): Promise<void> {
  if (!snapshot) {
    await rm(path, { force: true })
    return
  }
  await writeFile(path, snapshot.content)
  await utimes(path, snapshot.accessed, snapshot.modified)
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
  const name = localNameOf(target.remote, await remotesOf(folder))
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

/** Runs a command that talks to a remote: git may show its sign-in windows, and stalls fail. */
async function networkGit(folder: string, args: string[]): Promise<string> {
  return runGit(folder, args, { network: await networkAccessFor(folder) })
}

async function remotesOf(folder: string): Promise<string[]> {
  return (await git(folder, ['remote'])).split('\n').map((line) => line.trim()).filter(Boolean)
}

/** The upstream of a branch git listed (so its name is safe in a ref pattern). */
async function upstreamOf(folder: string, branch: string): Promise<Upstream | null> {
  return parseUpstream(await git(folder, ['for-each-ref', `--format=${UPSTREAM_FORMAT}`, `refs/heads/${branch}`]), branch)
}

/** How many commits `rev-list --count` finds in `range`, leaving out those `exclude` reaches. */
async function commitCount(folder: string, range: string, ...exclude: string[]): Promise<number> {
  const args = exclude.length > 0 ? [range, '--not', ...exclude] : [range]
  return Number((await git(folder, ['rev-list', '--count', ...args])).trim())
}

/** Pushes a branch that tracks nothing yet to origin, or to the only remote, and makes it track that. */
async function publish(folder: string, branch: string): Promise<OperationResult> {
  const remotes = await remotesOf(folder)
  if (remotes.length === 0) throw new GitError('this repository has no remote to push to')
  const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : null
  if (remote === null) throw new GitError(`${branch} tracks no branch yet, and there’s no remote called origin to publish it to`)
  await pushRef(folder, remote, `refs/heads/${branch}:refs/heads/${branch}`, branch, `${remote}/${branch}`, ['--set-upstream'])
  return { message: publishedMessage(branch, remote) }
}

/**
 * `git push --porcelain` of one refspec, answering git's report for it. A refusal (the remote
 * has commits the branch lacks, or a hook declined) becomes one line naming the branch.
 */
async function pushRef(
  folder: string,
  remote: string,
  refspec: string,
  branch: string,
  upstreamName: string,
  options: string[] = [],
): Promise<PushedRef> {
  const stdout = await networkGit(folder, ['push', '--porcelain', ...options, '--', remote, refspec]).catch((error: unknown) => {
    if (!(error instanceof GitError)) throw error
    const [report] = parsePushPorcelain(error.stdout)
    const refusal = report?.flag === '!' ? pushRefusal(report.summary, branch, upstreamName) : null
    throw refusal ? new GitError(refusal, error.stderr, error.stdout) : error
  })
  const [report] = parsePushPorcelain(stdout)
  if (!report) throw new GitError(`git didn’t say whether ${branch} was pushed`)
  return report
}
