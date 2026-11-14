import type { RemoteBranch } from '@/types/git'

/** What a fetch changed among the remote branches. */
export interface RemoteChanges {
  updated: number
  added: number
  removed: number
}

/** Compares the remote branches before and after a fetch, by name and tip. */
export function remoteChanges(before: RemoteBranch[], after: RemoteBranch[]): RemoteChanges {
  const tipsBefore = new Map(before.map((branch) => [branch.name, branch.tipHash]))
  const namesAfter = new Set(after.map((branch) => branch.name))
  return {
    updated: after.filter((branch) => tipsBefore.has(branch.name) && tipsBefore.get(branch.name) !== branch.tipHash).length,
    added: after.filter((branch) => !tipsBefore.has(branch.name)).length,
    removed: before.filter((branch) => !namesAfter.has(branch.name)).length,
  }
}

/** 'Fetched: 2 branches updated, 1 new, 1 removed', 'Fetched: 1 new branch', or 'Fetched: everything was up to date'. */
export function fetchedMessage({ updated, added, removed }: RemoteChanges): string {
  // Only the first part names the noun: '2 branches updated, 1 new', '1 new branch, 2 removed'.
  const parts: string[] = []
  if (updated > 0) parts.push(`${updated} ${branches(updated)} updated`)
  if (added > 0) parts.push(parts.length > 0 ? `${added} new` : `${added} new ${branches(added)}`)
  if (removed > 0) parts.push(parts.length > 0 ? `${removed} removed` : `${removed} ${branches(removed)} removed`)
  return parts.length === 0 ? 'Fetched: everything was up to date' : `Fetched: ${parts.join(', ')}`
}

function branches(count: number): string {
  return count === 1 ? 'branch' : 'branches'
}

export function pulledMessage(commitsPulled: number, upstream: string): string {
  return commitsPulled === 0 ? `Already up to date with ${upstream}` : `Pulled ${commits(commitsPulled)} from ${upstream}`
}

export function pushedMessage(commitsPushed: number, upstream: string): string {
  return commitsPushed === 0 ? `Nothing to push; ${upstream} is up to date` : `Pushed ${commits(commitsPushed)} to ${upstream}`
}

/** A branch pushed for the first time, which now tracks the remote's copy. */
export function publishedMessage(branch: string, remote: string): string {
  return `Published ${branch} to ${remote}; it now tracks ${remote}/${branch}`
}

function commits(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}
