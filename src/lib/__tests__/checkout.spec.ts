import { describe, expect, it } from 'vitest'
import { destinationOf, localNameOf, remotesToCheckOut, switchedMessage } from '../checkout'

describe('switchedMessage', () => {
  it('names the branch', () => {
    expect(switchedMessage('main', 0)).toBe('Switched to main')
  })

  it('says how many uncommitted changes came along', () => {
    expect(switchedMessage('main', 1)).toBe('Switched to main; 1 uncommitted change came along')
    expect(switchedMessage('main', 3)).toBe('Switched to main; 3 uncommitted changes came along')
  })

  it('names the remote branch a new branch tracks', () => {
    expect(switchedMessage('feature/x', 2, 'origin/feature/x')).toBe(
      'Switched to a new branch feature/x, tracking origin/feature/x; 2 uncommitted changes came along',
    )
  })
})

describe('localNameOf', () => {
  it('drops the remote’s name', () => {
    expect(localNameOf('origin/feature/x', ['origin'])).toBe('feature/x')
  })

  it('picks the longest remote that owns the branch, since remote names may contain a slash', () => {
    expect(localNameOf('team/a/topic', ['team', 'team/a'])).toBe('topic')
  })

  it('is null when no remote owns the branch, or the name is only the remote', () => {
    expect(localNameOf('upstream/main', ['origin'])).toBeNull()
    expect(localNameOf('origin/', ['origin'])).toBeNull()
    expect(localNameOf('originals/main', ['origin'])).toBeNull()
  })
})

describe('remotesToCheckOut', () => {
  const local = (name: string) => ({ name, ahead: 0, behind: 0, tipHash: 'a1' })
  const remote = (name: string) => ({ name, tipHash: 'b2' })

  it('offers the remote branches that have no local branch of their name', () => {
    const branches = {
      local: [local('main'), local('feature/x')],
      remote: [remote('origin/main'), remote('origin/feature/x'), remote('origin/feature/y'), remote('origin/release/2.4')],
    }
    expect(remotesToCheckOut(branches)).toEqual(['origin/feature/y', 'origin/release/2.4'])
  })

  it('offers nothing for a name with no branch after the remote', () => {
    expect(remotesToCheckOut({ local: [], remote: [remote('origin'), remote('origin/')] })).toEqual([])
  })
})

describe('destinationOf', () => {
  it('is the local branch, or the remote branch without its remote', () => {
    expect(destinationOf({ local: 'main' })).toBe('main')
    expect(destinationOf({ remote: 'origin/feature/x' })).toBe('feature/x')
  })
})
