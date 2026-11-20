import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  MERGE_IN_PROGRESS,
  MOVED_SINCE,
  mergeCommitMessage,
  mergeRefusal,
  mergedMessage,
  movedForwardMessage,
} from '../../../src/lib/merge'
import type {
  Branches,
  ConflictFile,
  MergeOutcome,
  MergePreview,
  MergeRequest,
  MergeResolution,
  OperationResult,
  UnfinishedOperation,
} from '../../../src/types/git'
import { LOCAL_BRANCH_PREFIX, REMOTE_BRANCH_PREFIX, mergeOverwriteRefusal } from './parse'
import { GitError, runGit, runGitBytes } from './runGit'

/*
 * Merging without touching the working tree until the very end, for people who find git's
 * half-merged working folders frightening:
 *
 *  1. `git merge-tree --write-tree` works the merge out in memory: a tree, plus each conflicted
 *     file's stages (1 base, 2 ours, 3 theirs). Needs git 2.38.
 *  2. The user resolves the conflicts in the app, from those stages.
 *  3. Their text goes in as blobs (`hash-object -w --no-filters`: it is already in the form git
 *     stores), a private index file swaps them into the merged tree (`read-tree`, `update-index`,
 *     `write-tree`), and `commit-tree` makes the merge commit with both parents.
 *  4. `git merge --ff-only <commit>` moves the branch: the only step that writes files, and git
 *     refuses it, changing nothing, if it would overwrite uncommitted changes or ignored files.
 */

/** A full commit hash (SHA-1 or SHA-256): what a preview hands out and later calls must give back. */
const FULL_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** A regular file (plain or executable); anything else (a link, a submodule) can't be resolved as text. */
const REGULAR_FILE_MODES = new Set(['100644', '100755'])

/** The mode git gives a submodule's entry in a tree: a commit of another repository, not a file. */
const SUBMODULE_MODE = '160000'

/** git calls a file binary when its first 8000 bytes hold a NUL; the app does the same. */
const BINARY_SNIFF_BYTES = 8000

const LFS_POINTER = 'version https://git-lfs.github.com/spec/'

/** One stage of a conflicted file, as merge-tree lists it. */
interface Stage {
  mode: string
  oid: string
  stage: 1 | 2 | 3
  path: string
}

/** merge-tree's answer: the merged tree (conflicted files hold conflict markers) and the conflicted files' stages. */
interface MergedTree {
  tree: string
  stages: Stage[]
}

/** Everything a preview and a merge both need, worked out the same way for each. */
interface MergePlan {
  preview: MergePreview
  /** The merged tree, for a merge commit. */
  tree: string | null
  stages: Stage[]
}

export async function previewMerge(folder: string, branches: Branches, branch: string): Promise<MergePreview> {
  return (await planMerge(folder, branches, branch)).preview
}

/** The three versions of each file the user can resolve. */
export async function mergeConflicts(folder: string, branches: Branches, request: MergeRequest): Promise<ConflictFile[]> {
  const plan = await plannedFor(folder, branches, request)
  return Promise.all(plan.preview.conflicts.map((path) => conflictFile(folder, plan.stages, path)))
}

export async function merge(
  folder: string,
  branches: Branches,
  request: MergeRequest,
  resolutions: MergeResolution[],
): Promise<OperationResult> {
  const { preview, tree, stages } = await plannedFor(folder, branches, request)
  const refusal = mergeRefusal(preview)
  if (refusal) throw new GitError(refusal)
  if (preview.outcome === 'fast-forward') {
    if (resolutions.length > 0) throw new GitError('a fast-forward has nothing to resolve')
    await moveBranchTo(folder, preview.theirs, preview)
    return { message: movedForwardMessage(preview.into, preview.branch, preview.commits) }
  }
  const resolvedTree = await treeWithResolutions(folder, tree!, stages, preview.conflicts, resolutions)
  const commit = await commitMerge(folder, resolvedTree, preview, isRemoteBranch(branches, preview.branch))
  await moveBranchTo(folder, commit, preview)
  return { message: mergedMessage(preview.branch, preview.into, preview.commits) }
}

/** The plan for a request, refused if either branch has moved, or another is checked out, since its preview. */
async function plannedFor(folder: string, branches: Branches, request: MergeRequest): Promise<MergePlan> {
  if (!FULL_HASH.test(request.ours) || !FULL_HASH.test(request.theirs)) throw new GitError('Not a merge this app worked out')
  const plan = await planMerge(folder, branches, request.branch)
  const { into, ours, theirs } = plan.preview
  if (into !== request.into || ours !== request.ours || theirs !== request.theirs) throw new GitError(MOVED_SINCE)
  return plan
}

async function planMerge(folder: string, branches: Branches, branch: string): Promise<MergePlan> {
  const into = await checkedOutBranch(folder)
  if (into === null) throw new GitError('no branch is checked out: check out the branch to merge into first')
  if ((await unfinishedOperation(folder)) !== null) throw new GitError(MERGE_IN_PROGRESS)
  const ref = refOf(branches, branch, into)
  const [ours, theirs] = await Promise.all([commitOf(folder, 'HEAD'), commitOf(folder, ref)])
  const commits = await commitCount(folder, `${ours}..${theirs}`)
  const outcome = commits === 0 ? 'up-to-date' : await outcomeOf(folder, ours, theirs)
  const merged = outcome === 'merge-commit' ? await mergeTree(folder, ours, theirs) : null
  const target = merged?.tree ?? (outcome === 'fast-forward' ? theirs : null)
  const { conflicts, unresolvable } = merged ? await sortConflicts(folder, merged.stages) : { conflicts: [], unresolvable: [] }
  const blockedBy = target === null ? [] : await filesInTheWay(folder, ours, target)
  return {
    preview: { branch, into, ours, theirs, commits, outcome, conflicts, unresolvable, blockedBy },
    tree: merged?.tree ?? null,
    stages: merged?.stages ?? [],
  }
}

async function checkedOutBranch(folder: string): Promise<string | null> {
  const name = await git(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1])
  return name.trim() || null
}

/** What git leaves in its folder while each operation is under way. */
const UNFINISHED_MARKERS: [string, UnfinishedOperation][] = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
]

/** An operation someone started (in a terminal) and hasn't finished. Runs on every refresh, so it asks git little. */
export async function unfinishedOperation(folder: string): Promise<UnfinishedOperation | null> {
  const output = await git(folder, ['rev-parse', ...UNFINISHED_MARKERS.flatMap(([name]) => ['--git-path', name])])
  // Each path is relative to the folder, or absolute (in a linked worktree, say).
  const paths = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const found = await Promise.all(paths.map((path) => exists(resolve(folder, path))))
  const marker = found.indexOf(true)
  if (marker >= 0) return UNFINISHED_MARKERS[marker]![1]
  // Unmerged files with none of the above: a `stash pop` that stopped on conflicts.
  return (await git(folder, ['ls-files', '--unmerged'])).trim() === '' ? null : 'conflicts'
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

/** The full ref of a branch the repository lists, so a name never reaches git unchecked. */
function refOf(branches: Branches, branch: string, into: string): string {
  if (branches.local.some((candidate) => candidate.name === branch)) {
    if (branch === into) throw new GitError(`${branch} is the branch you’re on: pick another to merge into it`)
    return `${LOCAL_BRANCH_PREFIX}${branch}`
  }
  if (branches.remote.some((candidate) => candidate.name === branch)) return `${REMOTE_BRANCH_PREFIX}${branch}`
  throw new GitError(`Unknown branch: ${branch}`)
}

function isRemoteBranch(branches: Branches, branch: string): boolean {
  return !branches.local.some((candidate) => candidate.name === branch)
}

async function commitOf(folder: string, ref: string): Promise<string> {
  return (await git(folder, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
}

async function commitCount(folder: string, range: string): Promise<number> {
  return Number((await git(folder, ['rev-list', '--count', range])).trim())
}

/** Fast-forward when git's defaults and the user's merge.ff allow it; otherwise a merge commit, unless merge.ff=only. */
async function outcomeOf(folder: string, ours: string, theirs: string): Promise<MergeOutcome> {
  // The checked-out branch can move forward when it has no commits the other lacks.
  const [oursOnly, setting] = await Promise.all([commitCount(folder, `${theirs}..${ours}`), mergeFfSetting(folder)])
  if (oursOnly === 0) return setting === 'false' ? 'merge-commit' : 'fast-forward'
  return setting === 'only' ? 'fast-forward-only' : 'merge-commit'
}

/** merge.ff as git reads it: 'false', 'only', or (unset or true) 'true'. */
async function mergeFfSetting(folder: string): Promise<'true' | 'false' | 'only'> {
  const value = (await git(folder, ['config', '--get', 'merge.ff'], [1])).trim().toLowerCase()
  if (value === 'only') return 'only'
  return ['false', 'no', 'off', '0'].includes(value) ? 'false' : 'true'
}

/** `git merge-tree --write-tree`: exits 1 when there are conflicts, which is an answer, not a failure. */
async function mergeTree(folder: string, ours: string, theirs: string): Promise<MergedTree> {
  const output = await git(folder, ['merge-tree', '--write-tree', '--no-messages', '-z', ours, theirs], [1])
  return parseMergeTree(output)
}

/** The tree, then one `<mode> <oid> <stage>\t<path>` entry per stage of each conflicted file, all NUL-terminated. */
export function parseMergeTree(output: string): MergedTree {
  const [tree = '', ...entries] = output.split('\0')
  const stages = entries.filter(Boolean).map((entry) => {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t([\s\S]+)$/.exec(entry)
    if (!match) throw new GitError(`git merge-tree said something unexpected: ${entry}`)
    return { mode: match[1]!, oid: match[2]!, stage: Number(match[3]) as 1 | 2 | 3, path: match[4]! }
  })
  if (!FULL_HASH.test(tree)) throw new GitError('git merge-tree gave no merged tree')
  return { tree, stages }
}

/** Splits the conflicted files into those the user can resolve as text and those that need a terminal. */
async function sortConflicts(folder: string, stages: Stage[]): Promise<{ conflicts: string[]; unresolvable: string[] }> {
  const paths = [...new Set(stages.map((stage) => stage.path))]
  const resolvable = await Promise.all(paths.map((path) => isResolvableAsText(folder, stagesOf(stages, path))))
  return {
    conflicts: paths.filter((_, index) => resolvable[index]),
    unresolvable: paths.filter((_, index) => !resolvable[index]),
  }
}

function stagesOf(stages: Stage[], path: string): Stage[] {
  return stages.filter((stage) => stage.path === path)
}

/** Both sides still have the file, and every version is a regular file the app can show and write back exactly. */
async function isResolvableAsText(folder: string, stages: Stage[]): Promise<boolean> {
  const has = (n: number) => stages.some((stage) => stage.stage === n)
  if (!has(2) || !has(3)) return false
  if (!stages.every((stage) => REGULAR_FILE_MODES.has(stage.mode))) return false
  const contents = await Promise.all(stages.map((stage) => blob(folder, stage.oid)))
  return contents.every(isEditableText)
}

/**
 * Not binary, not a Git LFS pointer, and valid UTF-8: text in another encoding would come back
 * from the app changed (every byte UTF-8 can't read becomes U+FFFD).
 */
function isEditableText(bytes: Buffer): boolean {
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return false
  const text = bytes.toString('utf8')
  return !text.startsWith(LFS_POINTER) && Buffer.from(text, 'utf8').equals(bytes)
}

async function blob(folder: string, oid: string): Promise<Buffer> {
  return runGitBytes(folder, ['cat-file', 'blob', oid])
}

async function conflictFile(folder: string, stages: Stage[], path: string): Promise<ConflictFile> {
  const text = async (n: number) => {
    const stage = stagesOf(stages, path).find((candidate) => candidate.stage === n)
    return stage ? (await blob(folder, stage.oid)).toString('utf8') : null
  }
  const [base, ours, theirs] = await Promise.all([text(1), text(2), text(3)])
  return { path, base, ours: ours ?? '', theirs: theirs ?? '' }
}

/**
 * What moving from `from` to `to` would overwrite: files the move changes that have uncommitted
 * changes, and files it adds that already exist on disk. That second check is what catches ignored
 * files, which `git status` doesn't list.
 *
 * A submodule is never in the way. Git moves its pointer and leaves its checkout as it is, whatever
 * state that is in (as on a switch), so nothing of the user's is overwritten; `git status` calls it
 * modified all the same whenever that checkout is out of step.
 */
async function filesInTheWay(folder: string, from: string, to: string): Promise<string[]> {
  const [changes, status] = await Promise.all([
    git(folder, ['diff-tree', '-r', '-z', '--no-renames', from, to]),
    git(folder, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']),
  ])
  const files = parseTreeChanges(changes).filter((change) => !change.submodule)
  const changed = files.map((change) => change.path)
  const added = files.filter((change) => change.added).map((change) => change.path)
  const dirty = new Set(status.split('\0').filter(Boolean).map((entry) => entry.slice(3)))
  const onDisk = await Promise.all(added.map((path) => exists(resolve(folder, path))))
  const inTheWay = new Set([...changed.filter((path) => dirty.has(path)), ...added.filter((_, index) => onDisk[index])])
  return [...inTheWay]
}

/** One path that differs between two trees. */
interface TreeChange {
  path: string
  /** The path is new: nothing was there before. */
  added: boolean
  /** A submodule's pointer, before or after, rather than a file. */
  submodule: boolean
}

/** `git diff-tree -r -z`: `:<mode before> <mode after> <oid> <oid> <status>`, then the path, each NUL-terminated. */
export function parseTreeChanges(output: string): TreeChange[] {
  const fields = output.split('\0').filter(Boolean)
  const changes: TreeChange[] = []
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:(\d+) (\d+) [0-9a-f]+ [0-9a-f]+ ([A-Z])/.exec(fields[index]!)
    const path = fields[index + 1]
    if (!match || path === undefined) throw new GitError(`git diff-tree said something unexpected: ${fields[index]}`)
    changes.push({ path, added: match[3] === 'A', submodule: match[1] === SUBMODULE_MODE || match[2] === SUBMODULE_MODE })
  }
  return changes
}

/** The merged tree with each conflicted file replaced by the user's text. */
async function treeWithResolutions(
  folder: string,
  tree: string,
  stages: Stage[],
  conflicts: string[],
  resolutions: MergeResolution[],
): Promise<string> {
  checkResolutions(conflicts, resolutions)
  if (resolutions.length === 0) return tree
  const scratch = await mkdtemp(join(tmpdir(), 'git-manager-merge-'))
  try {
    const index = { GIT_INDEX_FILE: join(scratch, 'index') }
    await runGit(folder, ['read-tree', tree], { env: index })
    for (const [n, resolution] of resolutions.entries()) {
      const oid = await storeText(folder, join(scratch, `resolved-${n}`), resolution)
      const mode = mergedMode(stagesOf(stages, resolution.path))
      await runGit(folder, ['update-index', '--cacheinfo', `${mode},${oid},${resolution.path}`], { env: index })
    }
    return (await runGit(folder, ['write-tree'], { env: index })).trim()
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Exactly one resolution per conflicted file: one missing would commit conflict markers. */
function checkResolutions(conflicts: string[], resolutions: MergeResolution[]): void {
  const resolved = resolutions.map((resolution) => resolution.path)
  const missing = conflicts.filter((path) => !resolved.includes(path))
  if (missing.length > 0) throw new GitError(`${missing.join(', ')} still ${missing.length === 1 ? 'has' : 'have'} conflicts to resolve`)
  const extra = resolved.filter((path, index) => !conflicts.includes(path) || resolved.indexOf(path) !== index)
  if (extra.length > 0) throw new GitError(`Not a conflicted file of this merge: ${extra.join(', ')}`)
}

/** The three-way answer for a file's mode: theirs if only they changed it (a new executable bit), else ours. */
function mergedMode(stages: Stage[]): string {
  const modeOf = (n: number) => stages.find((stage) => stage.stage === n)?.mode
  return modeOf(2) === modeOf(1) ? modeOf(3)! : modeOf(2)!
}

/**
 * Stores the text exactly as given. It came from blobs and is already in the form git stores, so
 * running the file's filters again (line endings, encodings) would change what the user saw.
 */
async function storeText(folder: string, scratchFile: string, resolution: MergeResolution): Promise<string> {
  await writeFile(scratchFile, resolution.text, 'utf8')
  return (await git(folder, ['hash-object', '-w', '--no-filters', '--', scratchFile])).trim()
}

/** commit-tree ignores commit.gpgsign, so a user who signs their commits has to be honoured here. */
async function signingOption(folder: string): Promise<string[]> {
  const setting = await git(folder, ['config', '--type=bool', '--get', 'commit.gpgsign'], [1])
  return setting.trim() === 'true' ? ['-S'] : []
}

async function commitMerge(folder: string, tree: string, preview: MergePreview, remote: boolean): Promise<string> {
  const message = mergeCommitMessage(preview.branch, preview.into, remote)
  const signing = await signingOption(folder)
  const commit = await git(folder, ['commit-tree', ...signing, tree, '-p', preview.ours, '-p', preview.theirs, '-m', message]).catch(
    (error: unknown) => {
      if (error instanceof GitError && /tell me who you are|unable to auto-detect email/i.test(error.stderr)) {
        throw new GitError('git doesn’t know your name and email yet: set user.name and user.email (git config --global), then merge again')
      }
      throw error
    },
  )
  return commit.trim()
}

/**
 * The one step that writes files: git refuses it, changing nothing, when it would overwrite
 * uncommitted changes or (by default it wouldn't care) ignored files. The user's merge settings for
 * this branch and autostash are switched off for it, since `--squash` from
 * `branch.<name>.mergeoptions` would leave the branch where it was while reporting success.
 */
async function moveBranchTo(folder: string, commit: string, { branch, into }: MergePreview): Promise<void> {
  const settings = settingsForOneCommand([
    [`branch.${into}.mergeoptions`, ''],
    ['merge.autoStash', 'false'],
  ])
  await runGit(folder, ['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', commit], { env: settings }).catch((error: unknown) => {
    if (!(error instanceof GitError)) throw error
    const refusal = mergeOverwriteRefusal(error.stderr, branch)
    throw refusal === null ? error : new GitError(refusal, error.stderr, error.stdout)
  })
  if ((await commitOf(folder, 'HEAD')) !== commit) throw new GitError(`git didn’t move ${into} to the merge`)
}

/**
 * Git settings for one command, as environment variables: GIT_CONFIG_COUNT and its numbered pairs
 * take any key, where `-c name=value` can't take one that holds '=' (a branch name may). They are
 * numbered after any pairs the app itself was started with, so those still reach this command, and
 * these win where both set the same thing (git reads the pairs in order).
 */
function settingsForOneCommand(settings: [key: string, value: string][]): Record<string, string> {
  const first = inheritedSettingCount()
  const variables: Record<string, string> = { GIT_CONFIG_COUNT: String(first + settings.length) }
  settings.forEach(([key, value], index) => {
    variables[`GIT_CONFIG_KEY_${first + index}`] = key
    variables[`GIT_CONFIG_VALUE_${first + index}`] = value
  })
  return variables
}

/** How many settings the app's own environment carries this way; none when the count isn't a number. */
function inheritedSettingCount(): number {
  const count = Number.parseInt(process.env['GIT_CONFIG_COUNT'] ?? '', 10)
  return Number.isInteger(count) && count > 0 ? count : 0
}

function git(folder: string, args: string[], okExitCodes?: number[]): Promise<string> {
  return runGit(folder, args, { okExitCodes })
}
