import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_COMPARE_PATHS } from '@/data/sampleRepositories'
import { expiryJobDiff, reservationConfigDiff, sampleCompareDiff, skuLookupDiff } from '@/data/sampleDiffs'
import { invertHunks } from '@/lib/diff'
import type { GitDataSource } from '@/services/GitDataSource'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import { HISTORY_LIMIT, useGitManager } from '../useGitManager'
import { heldSource, settle } from './heldSource'

function manager(source: GitDataSource = new MockGitDataSource()) {
  return useGitManager(source, { comparePaths: { ...SAMPLE_COMPARE_PATHS } })
}

async function loadedManager(source?: GitDataSource) {
  const gm = manager(source)
  await gm.load()
  return gm
}

describe('useGitManager', () => {
  let gm: Awaited<ReturnType<typeof loadedManager>>

  beforeEach(async () => {
    gm = await loadedManager()
  })

  describe('after loading', () => {
    it('opens the first repository on its checked-out branch, newest commit and first file', () => {
      expect(gm.loading.value).toBe(false)
      expect(gm.repository.value?.name).toBe('inventory-service')
      expect(gm.selectedBranch.value).toBe('feature/stock-reservations')
      expect(gm.commit.value?.hash).toBe('9f3a1c2')
      expect(gm.file.value?.path).toMatch(/ReservationExpiryJob\.java$/)
      expect(gm.activeHunks.value).toEqual(expiryJobDiff)
      expect(gm.status.value).toBe('Ready')
    })

    it('has the repository’s branches, history and the commit’s files', () => {
      expect(gm.branches.value.local.map((branch) => branch.name)).toContain('main')
      expect(gm.commits.value).toHaveLength(10)
      expect(gm.historyHasMore.value).toBe(false)
      expect(gm.files.value.map((file) => file.status)).toEqual(['A', 'M'])
    })

    it('reports how far the checked-out branch is ahead of origin', () => {
      expect(gm.headerSyncLabel.value).toBe('↑2 vs origin')
    })

    it('asks for at most HISTORY_LIMIT commits and passes on whether there are more', async () => {
      const source = new MockGitDataSource()
      const limits: number[] = []
      const getHistory = source.getHistory.bind(source)
      source.getHistory = async (repoId, limit) => {
        limits.push(limit)
        return { ...(await getHistory(repoId, limit)), hasMore: true }
      }
      const capped = await loadedManager(source)
      expect(limits).toEqual([HISTORY_LIMIT])
      expect(capped.historyHasMore.value).toBe(true)
    })
  })

  describe('selection', () => {
    it('switching repository resets to its newest commit and current branch', async () => {
      await gm.selectCommit(3)
      await gm.selectRepository('storefront')
      expect(gm.repository.value?.name).toBe('storefront-web')
      expect(gm.selectedBranch.value).toBe('develop')
      expect(gm.commit.value?.hash).toBe('5f8c2a4')
      expect(gm.status.value).toBe('Opened storefront-web')
    })

    it('hides the sync label for a repository that is level with origin', async () => {
      await gm.selectRepository('pricing')
      expect(gm.headerSyncLabel.value).toBeNull()
    })

    it('selecting a local branch jumps to its tip commit', async () => {
      await gm.selectBranch('main')
      expect(gm.commit.value?.hash).toBe('c81f5a3')
      expect(gm.status.value).toBe('Selected main (tip c81f5a3)')
    })

    it('selecting a remote branch jumps to its tip commit', async () => {
      await gm.selectBranch('origin/release/2.4')
      expect(gm.commit.value?.hash).toBe('e5d9a72')
    })

    it('selecting a commit resets the file selection, closes compare and loads its first file', async () => {
      await gm.selectFile(1)
      await gm.openCompare()
      await gm.selectCommit(3)
      expect(gm.selectedFileIndex.value).toBe(0)
      expect(gm.compareOpen.value).toBe(false)
      expect(gm.file.value?.path).toMatch(/SkuLookup\.java$/)
      expect(gm.activeHunks.value).toEqual(skuLookupDiff)
      expect(gm.status.value).toBe('Viewing commit 2d6e914')
    })

    it('the active diff follows the selected file', async () => {
      await gm.selectFile(1)
      expect(gm.file.value?.path).toBe('src/main/resources/application.yml')
      expect(gm.activeHunks.value).toEqual(reservationConfigDiff)
    })
  })

  describe('loading in pieces', () => {
    it('shows each area as loading until its data arrives', async () => {
      const held = heldSource()
      held.hold('getHistory', 'getCommitFiles', 'getFileDiff')
      const slow = manager(held.source)
      const loaded = slow.load()

      await settle()
      expect(slow.repository.value?.name).toBe('inventory-service')
      expect(slow.historyLoading.value).toBe(true)
      expect(slow.commits.value).toEqual([])

      await held.callsTo('getHistory')[0]!.release()
      expect(slow.historyLoading.value).toBe(false)
      expect(slow.filesLoading.value).toBe(true)

      await held.callsTo('getCommitFiles')[0]!.release()
      expect(slow.filesLoading.value).toBe(false)
      expect(slow.diffLoading.value).toBe(true)
      expect(slow.activeHunks.value).toEqual([])

      await held.callsTo('getFileDiff')[0]!.release()
      await loaded
      expect(slow.diffLoading.value).toBe(false)
      expect(slow.activeHunks.value).toEqual(expiryJobDiff)
    })

    it('ignores a repository’s history that arrives after another repository was opened', async () => {
      const held = heldSource()
      const slow = await loadedManager(held.source)
      held.hold('getHistory')
      const first = slow.selectRepository('pricing')
      const second = slow.selectRepository('storefront')
      const [pricingCall, storefrontCall] = held.callsTo('getHistory')

      await storefrontCall!.release()
      await pricingCall!.release()
      await Promise.all([first, second])
      expect(slow.repository.value?.name).toBe('storefront-web')
      expect(slow.commit.value?.hash).toBe('5f8c2a4')
    })

    it('ignores a commit’s file list that arrives after another commit was selected', async () => {
      const held = heldSource()
      const slow = await loadedManager(held.source)
      held.hold('getCommitFiles')
      const first = slow.selectCommit(1)
      const second = slow.selectCommit(3)
      const [olderCall, newerCall] = held.callsTo('getCommitFiles')

      await newerCall!.release()
      await olderCall!.release()
      await Promise.all([first, second])
      expect(slow.file.value?.path).toMatch(/SkuLookup\.java$/)
      expect(slow.activeHunks.value).toEqual(skuLookupDiff)
    })

    it('ignores a file’s diff that arrives after another file was selected', async () => {
      const held = heldSource()
      const slow = await loadedManager(held.source)
      held.hold('getFileDiff')
      const first = slow.selectFile(0)
      const second = slow.selectFile(1)
      const [olderCall, newerCall] = held.callsTo('getFileDiff')

      await newerCall!.release()
      await olderCall!.release()
      await Promise.all([first, second])
      expect(slow.activeHunks.value).toEqual(reservationConfigDiff)
    })
  })

  describe('load failures', () => {
    it('reports a failure to load repositories', async () => {
      const source = new MockGitDataSource()
      source.listRepositories = async () => {
        throw new Error('backend offline')
      }
      const failing = await loadedManager(source)
      expect(failing.loading.value).toBe(false)
      expect(failing.repository.value).toBeUndefined()
      expect(failing.status.value).toBe("Couldn't load repositories: backend offline")
    })

    it.each([
      ['getBranches', "Couldn't load branches: disk error"],
      ['getHistory', "Couldn't load history: disk error"],
      ['getCommitFiles', "Couldn't load changed files: disk error"],
      ['getFileDiff', "Couldn't load diff: disk error"],
    ] as const)('reports a failed %s in the status bar and leaves that area empty', async (method, message) => {
      const source = new MockGitDataSource()
      source[method] = async () => {
        throw new Error('disk error')
      }
      const failing = await loadedManager(source)
      expect(failing.status.value).toBe(message)
      expect(failing.repository.value?.name).toBe('inventory-service')
      expect(failing.historyLoading.value || failing.filesLoading.value || failing.diffLoading.value).toBe(false)
      if (method === 'getBranches') expect(failing.branches.value).toEqual({ local: [], remote: [] })
      if (method === 'getHistory') expect(failing.commits.value).toEqual([])
      if (method === 'getCommitFiles') expect(failing.files.value).toEqual([])
      if (method === 'getFileDiff') expect(failing.activeHunks.value).toEqual([])
    })
  })

  describe('diff mode', () => {
    it('defaults to the git diff and can switch to the simple diff', () => {
      expect(gm.diffMode.value).toBe('git')
      gm.setDiffMode('simple')
      expect(gm.diffMode.value).toBe('simple')
    })

    it('is forced to simple while comparing two files, and restored afterwards', async () => {
      await gm.openCompare()
      gm.setDiffMode('git')
      expect(gm.diffMode.value).toBe('simple')
      gm.closeCompare()
      expect(gm.diffMode.value).toBe('git')
    })
  })

  describe('compare two files', () => {
    it('loads the diff between the two paths in the open repository', async () => {
      const source = new MockGitDataSource()
      const compared: string[][] = []
      const compareFiles = source.compareFiles.bind(source)
      source.compareFiles = (repoId, left, right) => {
        compared.push([repoId, left, right])
        return compareFiles(repoId, left, right)
      }
      const comparing = await loadedManager(source)
      await comparing.openCompare()
      expect(comparing.compareOpen.value).toBe(true)
      expect(compared).toEqual([['inventory', SAMPLE_COMPARE_PATHS.left, SAMPLE_COMPARE_PATHS.right]])
      expect(comparing.activeHunks.value).toEqual(sampleCompareDiff)
      expect(comparing.status.value).toBe('Comparing two files')
    })

    it('swapping the paths reverses the diff', async () => {
      await gm.openCompare()
      await gm.swapComparePaths()
      expect(gm.leftPath.value).toBe(SAMPLE_COMPARE_PATHS.right)
      expect(gm.rightPath.value).toBe(SAMPLE_COMPARE_PATHS.left)
      expect(gm.activeHunks.value).toEqual(invertHunks(sampleCompareDiff))
    })

    it('closing returns to the selected commit and its diff', async () => {
      await gm.openCompare()
      gm.closeCompare()
      expect(gm.status.value).toBe('Viewing commit 9f3a1c2')
      expect(gm.activeHunks.value).toEqual(expiryJobDiff)
    })

    it('reports a failed comparison in the status bar', async () => {
      const source = new MockGitDataSource()
      source.compareFiles = async () => {
        throw new Error('file not found')
      }
      const failing = await loadedManager(source)
      await failing.openCompare()
      expect(failing.status.value).toBe("Couldn't compare files: file not found")
      expect(failing.activeHunks.value).toEqual([])
    })
  })

  describe('repository operations', () => {
    it('checking out a branch makes it the current branch', async () => {
      await gm.checkoutBranch('main')
      expect(gm.currentBranch.value).toBe('main')
      expect(gm.status.value).toBe('Switched to branch main')
    })

    it('fetching updates the last-fetch time', async () => {
      const before = Date.now()
      await gm.fetchRemote()
      expect(Date.parse(gm.repository.value!.lastFetch!)).toBeGreaterThanOrEqual(before)
      expect(gm.status.value).toBe('Fetched origin: no new commits')
    })

    it('pull and push report against the current branch', async () => {
      await gm.pull()
      expect(gm.status.value).toBe('Pulled origin/feature/stock-reservations: already up to date')
      await gm.push()
      expect(gm.status.value).toBe('Pushed feature/stock-reservations to origin/feature/stock-reservations')
    })

    it('a failed checkout leaves the current branch alone', async () => {
      const source = new MockGitDataSource()
      source.checkout = async () => {
        throw new Error('local changes would be overwritten')
      }
      const failing = await loadedManager(source)
      await failing.checkoutBranch('main')
      expect(failing.currentBranch.value).toBe('feature/stock-reservations')
      expect(failing.status.value).toBe('Failed: local changes would be overwritten')
    })
  })
})
