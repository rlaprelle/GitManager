import { describe, expect, it } from 'vitest'
import { fetchedMessage, publishedMessage, pulledMessage, pushedMessage, remoteChanges } from '../remoteOperations'

const branch = (name: string, tipHash: string) => ({ name, tipHash })

describe('remoteChanges', () => {
  it('counts moved, new and deleted remote branches', () => {
    const before = [branch('origin/main', 'a1'), branch('origin/old', 'b1'), branch('origin/same', 'c1')]
    const after = [branch('origin/main', 'a2'), branch('origin/new', 'd1'), branch('origin/same', 'c1')]
    expect(remoteChanges(before, after)).toEqual({ updated: 1, added: 1, removed: 1 })
  })

  it('finds nothing when nothing changed', () => {
    const branches = [branch('origin/main', 'a1')]
    expect(remoteChanges(branches, [...branches])).toEqual({ updated: 0, added: 0, removed: 0 })
  })
})

describe('fetchedMessage', () => {
  it.each([
    [{ updated: 0, added: 0, removed: 0 }, 'Fetched: everything was up to date'],
    [{ updated: 2, added: 1, removed: 1 }, 'Fetched: 2 branches updated, 1 new, 1 removed'],
    [{ updated: 1, added: 0, removed: 0 }, 'Fetched: 1 branch updated'],
    [{ updated: 0, added: 1, removed: 2 }, 'Fetched: 1 new branch, 2 removed'],
    [{ updated: 0, added: 0, removed: 1 }, 'Fetched: 1 branch removed'],
  ])('words %o as %s', (changes, message) => {
    expect(fetchedMessage(changes)).toBe(message)
  })
})

describe('pull and push wording', () => {
  it('says how many commits came or went, or that there were none', () => {
    expect(pulledMessage(3, 'origin/main')).toBe('Pulled 3 commits from origin/main')
    expect(pulledMessage(1, 'origin/main')).toBe('Pulled 1 commit from origin/main')
    expect(pulledMessage(0, 'origin/main')).toBe('Already up to date with origin/main')
    expect(pushedMessage(2, 'origin/feature')).toBe('Pushed 2 commits to origin/feature')
    expect(pushedMessage(1, 'origin/feature')).toBe('Pushed 1 commit to origin/feature')
    expect(pushedMessage(0, 'origin/feature')).toBe('Nothing to push; origin/feature is up to date')
  })

  it('says where a published branch went and what it tracks now', () => {
    expect(publishedMessage('feature/x', 'origin')).toBe('Published feature/x to origin; it now tracks origin/feature/x')
  })
})
