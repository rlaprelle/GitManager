import { describe, expect, it } from 'vitest'
import type { MergePreview } from '@/types/git'
import {
  blockedMessage,
  divergedElsewhereMessage,
  divergedMessage,
  mergeCommitMessage,
  mergeRefusal,
  mergeSummary,
  mergedMessage,
  movedForwardMessage,
  unfinishedMessage,
} from '../merge'

const preview = (changes: Partial<MergePreview> = {}): MergePreview => ({
  branch: 'feature/login',
  into: 'main',
  ours: 'a'.repeat(40),
  theirs: 'b'.repeat(40),
  commits: 2,
  outcome: 'merge-commit',
  conflicts: [],
  unresolvable: [],
  blockedBy: [],
  ...changes,
})

describe('mergeCommitMessage', () => {
  it('reads as git’s own, leaving out the destination for main and master', () => {
    expect(mergeCommitMessage('feature/login', 'main', false)).toBe("Merge branch 'feature/login'")
    expect(mergeCommitMessage('feature/login', 'master', false)).toBe("Merge branch 'feature/login'")
    expect(mergeCommitMessage('feature/login', 'develop', false)).toBe("Merge branch 'feature/login' into develop")
    expect(mergeCommitMessage('origin/main', 'main', true)).toBe("Merge remote-tracking branch 'origin/main'")
  })
})

describe('status messages', () => {
  it('count commits in words', () => {
    expect(mergedMessage('a', 'main', 1)).toBe('Merged a into main (1 commit)')
    expect(movedForwardMessage('main', 'a', 3)).toBe('Moved main forward to a (3 commits)')
    expect(divergedMessage('main', 'origin/main')).toBe('main and origin/main both have new commits, so Pull can’t just move main forward')
  })

  it('name the repository when a pull’s outcome is told somewhere else', () => {
    expect(divergedElsewhereMessage('pricing-api', divergedMessage('main', 'origin/main'))).toBe(
      'Pull in pricing-api: main and origin/main both have new commits, so Pull can’t just move main forward. Open pricing-api and press Pull again to merge them.',
    )
  })

  it('name the files in the way, in the right number', () => {
    expect(blockedMessage(['a.txt'])).toBe('1 file has uncommitted changes this merge would overwrite (a.txt). Commit or stash it first')
    expect(blockedMessage(['a.txt', 'b.txt'])).toBe('2 files have uncommitted changes this merge would overwrite (a.txt, b.txt). Commit or stash them first')
  })
})

describe('unfinishedMessage', () => {
  it('names the operation and says where to finish it', () => {
    expect(unfinishedMessage('rebase')).toBe('A rebase is in progress here, started outside Git Manager. Finish or abort it in a terminal.')
    expect(unfinishedMessage('cherry-pick')).toContain('A cherry-pick is in progress')
    expect(unfinishedMessage('conflicts')).toBe('Some files have unresolved conflicts from outside Git Manager. Resolve them in a terminal.')
  })
})

describe('mergeSummary', () => {
  it('describes a merge commit with no conflicts', () => {
    expect(mergeSummary(preview())).toEqual({
      effect: 'feature/login has 2 commits that main doesn’t. Makes a merge commit on main.',
      conflicts: 'No conflicts.',
    })
  })

  it('describes a fast-forward', () => {
    expect(mergeSummary(preview({ outcome: 'fast-forward', commits: 1 })).effect).toBe(
      'feature/login has 1 commit that main doesn’t. main moves forward to feature/login; no merge commit.',
    )
  })

  it('names the conflicting files and promises nothing changes yet', () => {
    expect(mergeSummary(preview({ conflicts: ['a.ts', 'b.ts'] })).conflicts).toBe(
      'Conflicts in 2 files: a.ts, b.ts. You’ll choose what to keep before anything changes on disk.',
    )
  })
})

describe('mergeRefusal', () => {
  it('lets an ordinary merge through, conflicts included', () => {
    expect(mergeRefusal(preview({ conflicts: ['a.ts'] }))).toBeNull()
    expect(mergeRefusal(preview({ outcome: 'fast-forward' }))).toBeNull()
  })

  it.each<[string, Partial<MergePreview>, RegExp]>([
    ['nothing to merge', { outcome: 'up-to-date', commits: 0 }, /main already has every commit on feature\/login/],
    ['merge.ff=only', { outcome: 'fast-forward-only' }, /allow only fast-forward merges/],
    ['files only a terminal can resolve', { unresolvable: ['logo.png'] }, /logo\.png can’t be resolved here/],
    ['uncommitted changes in the way', { blockedBy: ['a.ts'] }, /uncommitted changes.*a\.ts/],
  ])('refuses %s', (_name, changes, reason) => {
    expect(mergeRefusal(preview(changes))).toMatch(reason)
  })
})
