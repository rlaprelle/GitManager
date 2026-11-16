import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { CompareSide, PickedFile } from '../../../src/types/git'
import { GitError, runGit, runGitBytes } from './runGit'

/** What compareSides needs from the data source: where a repository is, which branches it has, and picked files. */
export interface CompareLookup {
  folderOf(repoId: string): Promise<string>
  branchNamesOf(folder: string): Promise<string[]>
  /** A working-tree path made absolute, refused when it leaves the repository. */
  insideFolder(folder: string, path: string): string
  pickedFiles: PickedFiles
}

/** A file on disk to diff, and how to tidy up after (a branch's version is a temporary copy). */
interface Materialized {
  path: string
  cleanup(): Promise<void>
}

const NOTHING_TO_TIDY = async () => {}

/**
 * Files the user picked with the file picker, by the id handed to the renderer. The renderer only ever
 * sends an id back, so it can't make git read a file the user didn't choose.
 */
export class PickedFiles {
  private readonly paths = new Map<string, string>()

  add(path: string): PickedFile {
    const fileId = randomUUID()
    this.paths.set(fileId, path)
    return { fileId, path }
  }

  pathOf(fileId: string): string {
    const path = this.paths.get(fileId)
    if (path === undefined) throw new GitError('That file is no longer chosen; choose it again')
    return path
  }
}

/**
 * Puts both sides on disk and diffs them with `git diff --no-index`. A working-tree or picked file is used
 * where it is; a branch's version is copied out of git as bytes (so binary files stay binary) into a
 * temporary folder, removed afterwards.
 */
export async function compareSides(lookup: CompareLookup, left: CompareSide, right: CompareSide): Promise<string> {
  const sides = await Promise.allSettled([materialize(lookup, left), materialize(lookup, right)])
  const ready = sides.flatMap((side) => (side.status === 'fulfilled' ? [side.value] : []))
  try {
    const failed = sides.find((side) => side.status === 'rejected')
    if (failed) throw failed.reason
    const [a, b] = ready as [Materialized, Materialized]
    // Exit code 1 means "the files differ", which is the answer, not a failure.
    return await gitDiffNoIndex(a.path, b.path)
  } finally {
    await Promise.all(ready.map((side) => side.cleanup()))
  }
}

function gitDiffNoIndex(left: string, right: string): Promise<string> {
  return runGit(tmpdir(), ['diff', '--no-index', '--no-ext-diff', '--', left, right], { okExitCodes: [1] })
}

async function materialize(lookup: CompareLookup, side: CompareSide): Promise<Materialized> {
  if (side.kind === 'file') return existingFile(lookup.pickedFiles.pathOf(side.fileId))
  const folder = await lookup.folderOf(side.repoId)
  if (side.branch === null) return existingFile(lookup.insideFolder(folder, side.path))
  await requireBranch(lookup, folder, side.branch)
  const bytes = await runGitBytes(folder, ['cat-file', 'blob', `${side.branch}:${treePath(side.path)}`]).catch(() => {
    throw new GitError(`${side.path} isn’t on ${side.branch}`)
  })
  const temporary = await mkdtemp(join(tmpdir(), 'git-manager-compare-'))
  const path = join(temporary, basename(treePath(side.path)))
  await writeFile(path, bytes)
  return { path, cleanup: () => rm(temporary, { recursive: true, force: true }) }
}

async function existingFile(path: string): Promise<Materialized> {
  const found = await stat(path).catch(() => null)
  if (!found?.isFile()) throw new GitError(`${path} isn’t a file`)
  return { path, cleanup: NOTHING_TO_TIDY }
}

/** Only a branch git listed reaches git, so a "branch" can never be read as an option or a revision expression. */
export async function requireBranch(lookup: CompareLookup, folder: string, branch: string): Promise<void> {
  if (!(await lookup.branchNamesOf(folder)).includes(branch)) throw new GitError(`No branch named ${branch}`)
}

/** git's tree paths use forward slashes and start at the repository's top folder. */
function treePath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^(\.\/|\/)+/, '')
}
