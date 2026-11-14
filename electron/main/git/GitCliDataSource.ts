import { stat } from 'node:fs/promises'
import { basename, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { localNameOf, switchedMessage } from '../../../src/lib/checkout'
import { errorMessage } from '../../../src/lib/errorMessage'
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
import { lastFetchTime, preservingFetchHead } from './fetchHead'
import { networkAccessFor } from './network'
import {
  BRANCH_FORMAT,
  BRANCH_REFS,
  LOG_FORMAT,
  PUSH_FLAG,
  type PushedRef,
  UPSTREAM_FORMAT,
  type Upstream,
  checkoutRefusal,
  countStatusEntries,
  localBranchRef,
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

/** The remote a new branch is published to when there is more than one. */
const DEFAULT_REMOTE = 'origin'

/** What git gives as the remote of an upstream branch in the same repository. */
const THIS_REPOSITORY = '.'

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
    const changed = (await this.changedFiles(folder, range)).find((file) => file.path === checkedPath(path))
    if (!changed) throw new GitError(`${path} is not changed in ${hash.slice(0, 7)}`)
    // A renamed file needs both paths in the pathspec, or git sees a deletion and an addition.
    const paths = changed.oldPath ? [changed.oldPath, changed.path] : [changed.path]
    // Literal, so a name like '[id].txt' or ':!a.txt' is a file name, not a wildcard or pathspec magic.
    const diff = await git(folder, ['--literal-pathspecs', 'diff-tree', '-p', '--no-ext-diff', '-M', ...range, '--', ...paths])
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
    await git(folder, ['switch', '--quiet', ...plan.args]).catch(
      explainRefusal((error) => checkoutRefusal(error.stderr, plan.branch)),
    )
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
    await assertCheckedOut(folder, branch)
    const upstream = await fetchedUpstreamOf(folder, branch)
    const { behind, ahead } = await divergenceFrom(folder, upstream.ref)
    if (behind === 0) return { message: pulledMessage(0, upstream.name) }
    if (ahead > 0) {
      throw new GitError(`can’t fast-forward: ${branch} and ${upstream.name} both have new commits. Merge or rebase them in a terminal.`)
    }
    await fastForward(folder, upstream)
    return { message: pulledMessage(behind, upstream.name) }
  }

  /**
   * Pushes a branch to its upstream, by explicit refspec so push.default can't send it anywhere
   * else; never forced. A branch without an upstream is published to origin (or the only
   * remote) and tracks it from then on.
   */
  async push(repoId: string, branch: string): Promise<OperationResult> {
    const folder = await this.folderOf(repoId)
    if (!hasBranchNamed((await this.branchesAt(folder)).local, branch)) throw new GitError(`Unknown branch: ${branch}`)
    const upstream = await upstreamOf(folder, branch)
    if (!upstream) return publish(folder, branch)

    const pushing = await commitsToPush(folder, branch, upstream)
    const refspec = `${localBranchRef(branch)}:${upstream.remoteRef}`
    const pushed = await pushRef(folder, { remote: upstream.remote, refspec, branch, upstreamName: upstream.name })
    return { message: pushedMessage(pushed.flag === PUSH_FLAG.upToDate ? 0 : pushing, upstream.name) }
  }

  /** One repository's list entry. A repository git can't read is still listed, with the problem. */
  private async summarize(stored: StoredRepository): Promise<Repository> {
    try {
      return await readSummary(stored)
    } catch (error) {
      return unreadableRepository(stored, errorMessage(error))
    }
  }

  private async branchesAt(folder: string): Promise<Branches> {
    return parseBranches(await git(folder, ['for-each-ref', `--format=${BRANCH_FORMAT}`, ...BRANCH_REFS]))
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

async function readSummary({ id, path }: StoredRepository): Promise<Repository> {
  if (!(await isFolder(path))) throw new GitError(FOLDER_NOT_FOUND)
  const [currentBranch, changes, lastFetch] = await Promise.all([
    checkedOutBranch(path),
    git(path, STATUS),
    lastFetchTime(path),
  ])
  return { id, name: basename(path), path, currentBranch, changedFileCount: countStatusEntries(changes), lastFetch, problem: null }
}

function unreadableRepository({ id, path }: StoredRepository, problem: string): Repository {
  return { id, name: basename(path), path, currentBranch: null, changedFileCount: 0, lastFetch: null, problem }
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
  return 'local' in target ? localSwitchPlan(branches, target.local) : remoteSwitchPlan(folder, branches, target.remote)
}

function localSwitchPlan(branches: Branches, name: string): SwitchPlan {
  if (!hasBranchNamed(branches.local, name)) throw new GitError(`Unknown branch: ${name}`)
  // --no-guess: never create a branch from a remote one of the same name; only a remote target does that.
  return { args: ['--no-guess', name], branch: name }
}

/** A new local branch, named as the remote one without its remote, tracking it. */
async function remoteSwitchPlan(folder: string, branches: Branches, remoteBranch: string): Promise<SwitchPlan> {
  if (!hasBranchNamed(branches.remote, remoteBranch)) throw new GitError(`Unknown branch: ${remoteBranch}`)
  const name = localNameOf(remoteBranch, await remotesOf(folder))
  if (name === null) throw new GitError(`${remoteBranch} belongs to no remote`)
  if (hasBranchNamed(branches.local, name)) throw new GitError(`A local branch ${name} already exists`)
  return { args: ['--track', remoteBranch], branch: name, tracking: remoteBranch }
}

function hasBranchNamed(branches: { name: string }[], name: string): boolean {
  return branches.some((branch) => branch.name === name)
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
  if (!isInside(relative(folder, absolute))) throw new GitError(`${path} is outside the repository`)
  return absolute
}

/** A path relative to the repository names something in it: not the folder itself, and not above it ('..foo' is a file). */
function isInside(fromFolder: string): boolean {
  const goesUp = fromFolder === '..' || fromFolder.startsWith(`..${sep}`)
  return fromFolder !== '' && !goesUp && !isAbsolute(fromFolder)
}

/** Runs a command that talks to a remote: git may show its sign-in windows, and stalls fail. */
async function networkGit(folder: string, args: string[]): Promise<string> {
  return runGit(folder, args, { network: await networkAccessFor(folder) })
}

/** `git fetch` with `args`; a failed fetch leaves the last fetch's time and record as they were. */
async function fetchKeepingLastFetch(folder: string, args: string[]): Promise<void> {
  await preservingFetchHead(folder, () => networkGit(folder, ['fetch', ...args]))
}

async function remotesOf(folder: string): Promise<string[]> {
  return (await git(folder, ['remote'])).split('\n').map((line) => line.trim()).filter(Boolean)
}

/** The upstream of a branch git listed (so its name is safe in a ref pattern). */
async function upstreamOf(folder: string, branch: string): Promise<Upstream | null> {
  return parseUpstream(await git(folder, ['for-each-ref', `--format=${UPSTREAM_FORMAT}`, localBranchRef(branch)]), branch)
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
  const remote = publishRemoteOf(remotes)
  if (remote === null) throw new GitError(`${branch} tracks no branch yet, and there’s no remote called origin to publish it to`)
  const refspec = `${localBranchRef(branch)}:${localBranchRef(branch)}`
  await pushRef(folder, { remote, refspec, branch, upstreamName: `${remote}/${branch}`, options: ['--set-upstream'] })
  return { message: publishedMessage(branch, remote) }
}

/** origin when there is one, else the only remote; null when there are several and none is origin. */
function publishRemoteOf(remotes: string[]): string | null {
  if (remotes.includes(DEFAULT_REMOTE)) return DEFAULT_REMOTE
  return remotes.length === 1 ? remotes[0]! : null
}

/** Commits the push will send. A deleted upstream is pushed again, so count what the remote has on no branch. */
async function commitsToPush(folder: string, branch: string, upstream: Upstream): Promise<number> {
  return upstream.gone
    ? commitCount(folder, localBranchRef(branch), `--remotes=${upstream.remote}`)
    : commitCount(folder, `${upstream.ref}..${localBranchRef(branch)}`)
}

/** One refspec to push, and what a refusal of it names. */
interface PushRequest {
  remote: string
  refspec: string
  branch: string
  /** The remote branch as the status bar names it: origin/main. */
  upstreamName: string
  options?: string[]
}

/**
 * `git push --porcelain` of one refspec, answering git's report for it. A refusal (the remote
 * has commits the branch lacks, or a hook declined) becomes one line naming the branch.
 */
async function pushRef(folder: string, { remote, refspec, branch, upstreamName, options = [] }: PushRequest): Promise<PushedRef> {
  const stdout = await networkGit(folder, ['push', '--porcelain', ...options, '--', remote, refspec]).catch(
    explainRefusal((error) => {
      const [report] = parsePushPorcelain(error.stdout)
      return report?.flag === PUSH_FLAG.rejected ? pushRefusal(report.summary, branch, upstreamName) : null
    }),
  )
  const [report] = parsePushPorcelain(stdout)
  if (!report) throw new GitError(`git didn’t say whether ${branch} was pushed`)
  return report
}

/** Fails unless `branch` is the one checked out: a pull merges into the working folder. */
async function assertCheckedOut(folder: string, branch: string): Promise<void> {
  const current = await checkedOutBranch(folder)
  if (current === null) throw new GitError('no branch is checked out')
  if (current !== branch) throw new GitError(`${branch} isn’t checked out; ${current} is`)
}

/** The branch's upstream after fetching its remote (an upstream in this repository needs no fetch). */
async function fetchedUpstreamOf(folder: string, branch: string): Promise<Upstream> {
  const upstream = await upstreamOf(folder, branch)
  if (!upstream) throw new GitError(`${branch} has no upstream branch to pull from`)
  if (upstream.remote !== THIS_REPOSITORY) await fetchKeepingLastFetch(folder, ['--prune', '--quiet', '--', upstream.remote])
  const fetched = await upstreamOf(folder, branch)
  if (!fetched || fetched.gone) throw new GitError(`${upstream.name} no longer exists on ${upstream.remote}`)
  return fetched
}

/** Commits `ref` has that HEAD lacks (behind), and the other way round (ahead). */
async function divergenceFrom(folder: string, ref: string): Promise<{ behind: number; ahead: number }> {
  const [behind, ahead] = await Promise.all([commitCount(folder, `HEAD..${ref}`), commitCount(folder, `${ref}..HEAD`)])
  return { behind, ahead }
}

async function fastForward(folder: string, upstream: Upstream): Promise<void> {
  await git(folder, ['merge', '--ff-only', '--quiet', upstream.ref]).catch(
    explainRefusal((error) => pullRefusal(error.stderr, upstream.name)),
  )
}

/**
 * A `.catch` handler that turns a refusal git explains in its output into one readable line.
 * `explain` returns null for failures it doesn't recognise, which are rethrown unchanged.
 */
function explainRefusal(explain: (error: GitError) => string | null): (error: unknown) => never {
  return (error) => {
    if (!(error instanceof GitError)) throw error
    const refusal = explain(error)
    throw refusal === null ? error : new GitError(refusal, error.stderr, error.stdout)
  }
}
