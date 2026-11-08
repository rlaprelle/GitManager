import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_COMPARE_PATHS } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import { invertHunks } from '@/lib/diff'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import { useGitManager } from '../useGitManager'

async function loadedManager(source = new MockGitDataSource()) {
  const gm = useGitManager(source, { comparePaths: { ...SAMPLE_COMPARE_PATHS } })
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
      expect(gm.status.value).toBe('Ready')
    })

    it('reports how far the checked-out branch is ahead of origin', () => {
      expect(gm.headerSyncLabel.value).toBe('↑2 vs origin')
    })
  })

  describe('selection', () => {
    it('switching repository resets to its newest commit and current branch', () => {
      gm.selectCommit(3)
      gm.selectRepository('storefront')
      expect(gm.repository.value?.name).toBe('storefront-web')
      expect(gm.selectedBranch.value).toBe('develop')
      expect(gm.commit.value?.hash).toBe('5f8c2a4')
      expect(gm.status.value).toBe('Opened storefront-web')
    })

    it('hides the sync label for a repository that is level with origin', () => {
      gm.selectRepository('pricing')
      expect(gm.headerSyncLabel.value).toBeNull()
    })

    it('selecting a local branch jumps to its tip commit', () => {
      gm.selectBranch('main')
      expect(gm.commit.value?.hash).toBe('c81f5a3')
      expect(gm.status.value).toBe('Selected main (tip c81f5a3)')
    })

    it('selecting a remote branch jumps to its tip commit', () => {
      gm.selectBranch('origin/release/2.4')
      expect(gm.commit.value?.hash).toBe('e5d9a72')
    })

    it('selecting a commit resets the file selection and closes compare', async () => {
      gm.selectFile(1)
      await gm.openCompare()
      gm.selectCommit(2)
      expect(gm.selectedFileIndex.value).toBe(0)
      expect(gm.compareOpen.value).toBe(false)
      expect(gm.status.value).toBe('Viewing commit c81f5a3')
    })

    it('the active diff follows the selected file', () => {
      gm.selectFile(1)
      expect(gm.file.value?.path).toBe('src/main/resources/application.yml')
      expect(gm.activeHunks.value).toBe(gm.file.value?.hunks)
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
    it('loads the diff between the two paths when opened', async () => {
      await gm.openCompare()
      expect(gm.compareOpen.value).toBe(true)
      expect(gm.activeHunks.value).toEqual(sampleCompareDiff)
      expect(gm.status.value).toBe('Comparing two files')
    })

    it('swapping the paths reverses the diff', async () => {
      await gm.openCompare()
      await gm.swapComparePaths()
      expect(gm.leftPath.value).toBe(SAMPLE_COMPARE_PATHS.right)
      expect(gm.rightPath.value).toBe(SAMPLE_COMPARE_PATHS.left)
      expect(gm.activeHunks.value).toEqual(invertHunks(sampleCompareDiff))
    })

    it('closing returns to the selected commit', async () => {
      await gm.openCompare()
      gm.closeCompare()
      expect(gm.status.value).toBe('Viewing commit 9f3a1c2')
      expect(gm.activeHunks.value).toBe(gm.file.value?.hunks)
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
      await gm.fetchRemote()
      expect(gm.repository.value?.lastFetch).toBe('just now')
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
})
