import { describe, expect, it } from 'vitest'
import { refKind, remoteNamesOf, splitRemoteBranch } from '../refs'

describe('splitRemoteBranch', () => {
  it('takes the first segment as the remote', () => {
    expect(splitRemoteBranch('origin/feature/x')).toEqual({ remote: 'origin', branch: 'feature/x' })
  })

  it.each(['origin', 'origin/', '/main'])('is null for %s, which lacks a remote or a branch', (name) => {
    expect(splitRemoteBranch(name)).toBeNull()
  })
})

describe('remoteNamesOf', () => {
  it('names each remote once, in the order its branches are listed', () => {
    const names = ['origin/main', 'upstream/main', 'origin/release/2.4'].map((name) => ({ name }))
    expect(remoteNamesOf(names)).toEqual(['origin', 'upstream'])
  })
})

describe('refKind', () => {
  const remoteBranches = ['origin/main', 'upstream/main']

  it('marks the checked-out branch as HEAD', () => {
    expect(refKind('main', 'main', remoteBranches)).toBe('head')
  })

  it('knows a remote branch by the branch list, whatever its remote is called', () => {
    expect(refKind('upstream/main', 'main', remoteBranches)).toBe('remote')
    expect(refKind('origin/main', 'main', remoteBranches)).toBe('remote')
  })

  it('treats any other name as a local branch, even one with a slash', () => {
    expect(refKind('feature/x', 'main', remoteBranches)).toBe('local')
  })
})
