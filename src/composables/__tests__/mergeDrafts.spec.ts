import { describe, expect, it } from 'vitest'
import type { MergeSession } from '../mergeFlow'
import { type DraftStorage, mergeDraftKey, mergeDrafts } from '../mergeDrafts'

const merging = (branch: string): MergeSession => ({
  request: { branch, into: 'main', ours: 'a'.repeat(40), theirs: 'b'.repeat(40) },
  into: 'main',
  commits: 1,
  files: [],
  path: '',
})

/** Storage in memory; `room` is how many saves it takes before refusing, as a full quota does. */
function memory(room = Infinity): { kept: Map<string, string>; storage: DraftStorage } {
  const kept = new Map<string, string>()
  let saves = 0
  return {
    kept,
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => {
        if (++saves > room) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        kept.set(key, value)
      },
      removeItem: (key) => void kept.delete(key),
    },
  }
}

describe('mergeDrafts', () => {
  it('keeps one merge per repository, and gives it back', () => {
    const drafts = mergeDrafts(memory().storage)
    expect(drafts.save('inventory', merging('feature/login'))).toBe(true)
    expect(drafts.save('pricing', merging('release/2.4'))).toBe(true)
    expect(drafts.load('inventory')?.request.branch).toBe('feature/login')
    expect(drafts.load('pricing')?.request.branch).toBe('release/2.4')
    expect(drafts.load('billing')).toBeNull()
  })

  it('forgets a merge once it is cleared', () => {
    const drafts = mergeDrafts(memory().storage)
    drafts.save('inventory', merging('feature/login'))
    drafts.clear('inventory')
    expect(drafts.load('inventory')).toBeNull()
  })

  it('says when a merge couldn’t be saved, and leaves no older copy to come back in its place', () => {
    const { kept, storage } = memory(1)
    const drafts = mergeDrafts(storage)
    expect(drafts.save('inventory', merging('feature/login'))).toBe(true)
    expect(drafts.save('inventory', merging('feature/login'))).toBe(false)
    expect(kept.has(mergeDraftKey('inventory'))).toBe(false)
    expect(drafts.load('inventory')).toBeNull()
  })

  it('saves nothing, and says so, where there is no storage at all', () => {
    const drafts = mergeDrafts(null)
    expect(drafts.save('inventory', merging('feature/login'))).toBe(false)
    expect(drafts.load('inventory')).toBeNull()
    expect(() => drafts.clear('inventory')).not.toThrow()
  })

  it('reads nothing from what isn’t a saved merge', () => {
    const { kept, storage } = memory()
    const drafts = mergeDrafts(storage)
    kept.set(mergeDraftKey('inventory'), '{not json')
    expect(drafts.load('inventory')).toBeNull()
    kept.set(mergeDraftKey('inventory'), JSON.stringify({ request: { branch: 'main' } }))
    expect(drafts.load('inventory')).toBeNull()
  })
})
