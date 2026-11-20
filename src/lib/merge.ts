import type { MergePreview, UnfinishedOperation } from '@/types/git'
import { pluralize } from './format'

// Merge wording shared by both data sources, so the browser and the desktop app say the same.

/** The commit message git itself would write for this merge. */
export function mergeCommitMessage(branch: string, into: string, remote: boolean): string {
  const merged = remote ? `Merge remote-tracking branch '${branch}'` : `Merge branch '${branch}'`
  // git leaves out the destination when merging into main or master (merge.suppressDest's default).
  return into === 'main' || into === 'master' ? merged : `${merged} into ${into}`
}

export function mergedMessage(branch: string, into: string, commits: number): string {
  return `Merged ${branch} into ${into} (${pluralize(commits, 'commit', 'commits')})`
}

export function movedForwardMessage(into: string, branch: string, commits: number): string {
  return `Moved ${into} forward to ${branch} (${pluralize(commits, 'commit', 'commits')})`
}

/** Pull couldn't fast-forward: what the status bar says while the merge dialog offers to merge. */
export function divergedMessage(branch: string, upstream: string): string {
  return `${branch} and ${upstream} both have new commits, so Pull can’t just move ${branch} forward`
}

/**
 * The same, for a Pull that finished after the user had opened another repository: the merge dialog
 * would be about the wrong one, so they are told how to get to it.
 */
export function divergedElsewhereMessage(repoName: string, diverged: string): string {
  return `${diverged}. Open ${repoName} and press Pull again to merge them.`
}

export function upToDateMessage(into: string, branch: string): string {
  return `${into} already has every commit on ${branch}`
}

export const MERGE_IN_PROGRESS =
  'a merge, rebase or cherry-pick is already in progress here (started outside Git Manager): finish or abort it in a terminal first'

const UNFINISHED_NAME: Record<Exclude<UnfinishedOperation, 'conflicts'>, string> = {
  merge: 'A merge',
  rebase: 'A rebase',
  'cherry-pick': 'A cherry-pick',
  revert: 'A revert',
}

/** The notice above the panes. The app doesn't resolve these: in a rebase, git's "ours" and "theirs" swap meaning. */
export function unfinishedMessage(operation: UnfinishedOperation): string {
  if (operation === 'conflicts') return 'Some files have unresolved conflicts from outside Git Manager. Resolve them in a terminal.'
  return `${UNFINISHED_NAME[operation]} is in progress here, started outside Git Manager. Finish or abort it in a terminal.`
}

export function fastForwardOnlyMessage(into: string, branch: string): string {
  return `${into} has commits ${branch} doesn’t, and your git settings (merge.ff=only) allow only fast-forward merges`
}

export function blockedMessage(files: string[]): string {
  return `${pluralize(files.length, 'file has', 'files have')} uncommitted changes this merge would overwrite (${files.join(', ')}). Commit or stash ${files.length === 1 ? 'it' : 'them'} first`
}

export function unresolvableMessage(files: string[]): string {
  return `${files.join(', ')} can’t be resolved here (deleted on one side, binary, or not a plain file). Merge in a terminal instead`
}

/** A merge being resolved couldn't be kept for a restart (storage full or unavailable): a warning, once per merge. */
export const MERGE_NOT_SAVED = 'This merge couldn’t be saved, so closing the app would lose it. Complete or discard it before you close.'

export const MOVED_SINCE = 'a branch has moved since this merge was worked out. Start the merge again'

/** What the Merge dialog says a merge will do: the commits and the result, then any conflicts. */
export function mergeSummary({ branch, into, commits, outcome, conflicts }: MergePreview): { effect: string; conflicts: string } {
  const brings = `${branch} has ${pluralize(commits, 'commit', 'commits')} that ${into} doesn’t.`
  const result = outcome === 'fast-forward' ? `${into} moves forward to ${branch}; no merge commit.` : `Makes a merge commit on ${into}.`
  return {
    effect: `${brings} ${result}`,
    conflicts:
      conflicts.length === 0
        ? 'No conflicts.'
        : `Conflicts in ${pluralize(conflicts.length, 'file', 'files')}: ${conflicts.join(', ')}. You’ll choose what to keep before anything changes on disk.`,
  }
}

/** Why a preview can't go ahead, or null when it can. */
export function mergeRefusal(preview: MergePreview): string | null {
  if (preview.outcome === 'up-to-date') return upToDateMessage(preview.into, preview.branch)
  if (preview.outcome === 'fast-forward-only') return fastForwardOnlyMessage(preview.into, preview.branch)
  if (preview.unresolvable.length > 0) return unresolvableMessage(preview.unresolvable)
  if (preview.blockedBy.length > 0) return blockedMessage(preview.blockedBy)
  return null
}
