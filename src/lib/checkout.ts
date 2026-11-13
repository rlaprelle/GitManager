import type { Branches, CheckoutTarget } from '@/types/git'

/** What a successful checkout tells the user; both data sources word it the same way. */
export function switchedMessage(branch: string, changesCarried: number, tracking?: string): string {
  const switched = tracking ? `Switched to a new branch ${branch}, tracking ${tracking}` : `Switched to ${branch}`
  if (changesCarried === 0) return switched
  const changes = changesCarried === 1 ? '1 uncommitted change' : `${changesCarried} uncommitted changes`
  return `${switched}; ${changes} came along`
}

/**
 * The local branch a remote branch checks out as: its name without the remote's
 * ('origin/feature/x' → 'feature/x'). Remote names may contain '/', so the longest match wins.
 * Null when no listed remote owns the branch.
 */
export function localNameOf(remoteBranch: string, remotes: string[]): string | null {
  const owner = remotes
    .filter((remote) => remoteBranch.startsWith(`${remote}/`) && remoteBranch.length > remote.length + 1)
    .sort((a, b) => b.length - a.length)[0]
  return owner === undefined ? null : remoteBranch.slice(owner.length + 1)
}

/** The branch a checkout ends on, by the same first-segment rule as remotesToCheckOut. */
export function destinationOf(target: CheckoutTarget): string {
  return 'local' in target ? target.local : target.remote.slice(target.remote.indexOf('/') + 1)
}

/**
 * The remote branches the sidebar offers to check out: those with no local branch of their
 * name. The UI doesn't know the remotes' names, so it takes the first segment as the remote
 * ('origin/feature/x' → 'feature/x'); this only decides which buttons show, and the data
 * source checks the target properly.
 */
export function remotesToCheckOut({ local, remote }: Branches): string[] {
  const localNames = new Set(local.map((branch) => branch.name))
  return remote
    .map((branch) => branch.name)
    .filter((name) => {
      const slash = name.indexOf('/')
      return slash > 0 && slash < name.length - 1 && !localNames.has(name.slice(slash + 1))
    })
}
