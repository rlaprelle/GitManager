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

/**
 * Where a renamed file came from, in the fewest words that tell: its old name if that changed
 * ('renamed from Notes.java'), otherwise its old folder ('moved from src/main/').
 */
export function renameLabel(oldPath: string, newPath: string): string {
  const before = splitPath(oldPath)
  if (before.name !== splitPath(newPath).name) return `renamed from ${before.name}`
  return `moved from ${before.dir || 'the top folder'}`
}

/** The seven-character form git shows ('9f3a1c2'); data sources send full hashes. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

/** The checked-out branch, or 'detached HEAD' when a commit is checked out directly. */
export function headLabel(branch: string | null): string {
  return branch ?? 'detached HEAD'
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const twoDigits = (value: number) => String(value).padStart(2, '0')
const clock = (date: Date) => `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
const monthDay = (date: Date) => `${MONTHS[date.getMonth()]} ${date.getDate()}`

/** Whole calendar days from `date` to `now`, in local time: 0 today, 1 yesterday, negative in the future. */
function calendarDaysBefore(date: Date, now: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((midnight(now) - midnight(date)) / DAY)
}

/** 'Today 09:05', 'Yesterday 23:59', 'Nov 5 17:48', or 'Oct 30, 2025' for an earlier year. Local time. */
export function commitDateLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  const days = calendarDaysBefore(date, now)
  if (days === 0) return `Today ${clock(date)}`
  if (days === 1) return `Yesterday ${clock(date)}`
  if (date.getFullYear() !== now.getFullYear()) return `${monthDay(date)}, ${date.getFullYear()}`
  return `${monthDay(date)} ${clock(date)}`
}

/** 'just now', '12 min ago', '3 h ago', '5 days ago', then a date; 'never' when there's no fetch. */
export function lastFetchLabel(iso: string | null, now: Date): string {
  if (iso === null) return 'never'
  const date = new Date(iso)
  const elapsed = now.getTime() - date.getTime()
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  if (elapsed < 7 * DAY) return pluralize(Math.floor(elapsed / DAY), 'day', 'days') + ' ago'
  return monthDay(date)
}
