import type { LocalBranch } from '@/types/git'

/** 'src/a/B.java' or 'C:\\a\\B.java' → { name: 'B.java', dir: 'src/a/' }. Directories always use '/'. */
export function splitPath(path: string): { name: string; dir: string } {
  const parts = path.split(/[\\/]/)
  const name = parts.pop() ?? ''
  return { name, dir: parts.length ? parts.join('/') + '/' : '' }
}

/** '↑2 ↓1', or '' when the branch is level with its upstream. */
export function syncLabel(branch: Pick<LocalBranch, 'ahead' | 'behind'>): string {
  const parts: string[] = []
  if (branch.ahead) parts.push(`↑${branch.ahead}`)
  if (branch.behind) parts.push(`↓${branch.behind}`)
  return parts.join(' ')
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
