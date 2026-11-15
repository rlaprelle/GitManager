/**
 * A remote branch's remote and branch ('origin/feature/x' → origin, feature/x). The UI doesn't
 * know the remotes' names, so it takes the first segment as the remote; null when either part
 * is empty. Only for what the UI shows: the data source checks names against git's own list.
 */
export function splitRemoteBranch(remoteBranch: string): { remote: string; branch: string } | null {
  const slash = remoteBranch.indexOf('/')
  if (slash <= 0 || slash === remoteBranch.length - 1) return null
  return { remote: remoteBranch.slice(0, slash), branch: remoteBranch.slice(slash + 1) }
}

/** The remotes the branches come from, each once, in the order the list shows them. */
export function remoteNamesOf(remoteBranches: { name: string }[]): string[] {
  const remotes = remoteBranches.map((branch) => splitRemoteBranch(branch.name)?.remote)
  return [...new Set(remotes.filter((remote) => remote !== undefined))]
}

export type RefKind = 'head' | 'remote' | 'local'

/**
 * How a commit's branch label is shown. A label is remote when the branch list has it as a
 * remote branch: by name, since a local branch may contain a slash and a remote needn't be origin.
 */
export function refKind(label: string, currentBranch: string, remoteBranchNames: string[]): RefKind {
  if (label === currentBranch) return 'head'
  return remoteBranchNames.includes(label) ? 'remote' : 'local'
}
