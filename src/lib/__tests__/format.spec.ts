import { describe, expect, it } from 'vitest'
import { commitDateLabel, lastFetchLabel, pluralize, shortHash, splitPath, syncLabel } from '../format'

describe('splitPath', () => {
  it('splits a forward-slash path into file name and directory', () => {
    expect(splitPath('src/main/App.java')).toEqual({ name: 'App.java', dir: 'src/main/' })
  })

  it('handles Windows paths and normalises the directory to forward slashes', () => {
    expect(splitPath('C:\\dev\\app\\application.yml')).toEqual({ name: 'application.yml', dir: 'C:/dev/app/' })
  })

  it('returns an empty directory for a bare file name', () => {
    expect(splitPath('pom.xml')).toEqual({ name: 'pom.xml', dir: '' })
  })
})

describe('syncLabel', () => {
  it('is empty when level with upstream', () => {
    expect(syncLabel({ ahead: 0, behind: 0 })).toBe('')
  })

  it('shows ahead and behind counts', () => {
    expect(syncLabel({ ahead: 2, behind: 1 })).toBe('↑2 ↓1')
  })
})

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'commit', 'commits')).toBe('1 commit')
    expect(pluralize(3, 'commit', 'commits')).toBe('3 commits')
  })
})

/** A local time, so the tests don't depend on the machine's time zone. */
function local(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes)
}

const now = local(2026, 11, 10, 15, 30)

describe('commitDateLabel', () => {
  it('says Today or Yesterday with the time for the last two calendar days', () => {
    expect(commitDateLabel(local(2026, 11, 10, 9, 5).toISOString(), now)).toBe('Today 09:05')
    expect(commitDateLabel(local(2026, 11, 9, 23, 59).toISOString(), now)).toBe('Yesterday 23:59')
  })

  it('goes by calendar day, not by 24 hours', () => {
    const justAfterMidnight = local(2026, 11, 10, 0, 10)
    expect(commitDateLabel(local(2026, 11, 9, 23, 50).toISOString(), justAfterMidnight)).toBe('Yesterday 23:50')
  })

  it('shows month, day and time earlier this year, and the year before that', () => {
    expect(commitDateLabel(local(2026, 11, 5, 17, 48).toISOString(), now)).toBe('Nov 5 17:48')
    expect(commitDateLabel(local(2025, 10, 30, 11, 22).toISOString(), now)).toBe('Oct 30, 2025')
  })

  it('shows a date in the future (a skewed clock) as a plain date rather than Today', () => {
    expect(commitDateLabel(local(2026, 11, 12, 8, 0).toISOString(), now)).toBe('Nov 12 08:00')
  })
})

describe('lastFetchLabel', () => {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

  it('says never for a repository that has never been fetched', () => {
    expect(lastFetchLabel(null, now)).toBe('never')
  })

  it('says just now under a minute, then minutes, hours and days', () => {
    expect(lastFetchLabel(ago(0.5), now)).toBe('just now')
    expect(lastFetchLabel(ago(12), now)).toBe('12 min ago')
    expect(lastFetchLabel(ago(60 * 3 + 20), now)).toBe('3 h ago')
    expect(lastFetchLabel(ago(60 * 24), now)).toBe('1 day ago')
    expect(lastFetchLabel(ago(60 * 24 * 5), now)).toBe('5 days ago')
  })

  it('switches to a date after a week', () => {
    expect(lastFetchLabel(local(2026, 10, 30, 11, 22).toISOString(), now)).toBe('Oct 30')
  })
})

describe('shortHash', () => {
  it('shows the first seven characters, as git does', () => {
    expect(shortHash('9f3a1c2e4b5d6f708192a3b4c5d6e7f809102030')).toBe('9f3a1c2')
    expect(shortHash('9f3a1c2')).toBe('9f3a1c2')
  })
})
