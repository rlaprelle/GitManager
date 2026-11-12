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

    it('waits for both paths before comparing', async () => {
      const source = new MockGitDataSource()
      let compared = 0
      source.compareFiles = async () => {
        compared++
        return []
      }
      const empty = useGitManager(source, { comparePaths: { left: '', right: '' } })
      await empty.load()
      await empty.openCompare()
      await empty.setLeftPath('a.yml')
      expect(compared).toBe(0)
      expect(empty.status.value).toBe('Comparing two files')
      await empty.setRightPath('b.yml')
      expect(compared).toBe(1)
    })
  })

  it('shows full commit hashes shortened to seven characters in its messages', async () => {
    const source = new MockGitDataSource()
    const getHistory = source.getHistory.bind(source)
    source.getHistory = async (repoId, limit) => {
      const page = await getHistory(repoId, limit)
      return { ...page, commits: page.commits.map((commit) => ({ ...commit, hash: commit.hash.padEnd(40, '0') })) }
    }
    source.getCommitFiles = async () => []
    const full = await loadedManager(source)
    await full.selectCommit(1)
    expect(full.status.value).toBe('Viewing commit 4e7b0d9')
  })

  describe('the history pane message', () => {
    it('is empty once the history has commits', () => {
      expect(gm.historyMessage.value).toBeNull()
    })

    it('says the history is loading, failed, or has no commits yet', async () => {
      const held = heldSource()
      held.hold('getHistory')
      const slow = manager(held.source)
      const loaded = slow.load()
      await settle()
      expect(slow.historyMessage.value).toBe('Loading history…')
      await held.callsTo('getHistory')[0]!.fail(new Error('Folder not found'))
      await loaded
      expect(slow.historyMessage.value).toBe('Couldn’t load history')

      const source = new MockGitDataSource()
      source.getHistory = async () => ({ commits: [], hasMore: false })
      expect((await loadedManager(source)).historyMessage.value).toBe('No commits yet')
    })
  })

  describe('adding and removing repositories', () => {
    /** The mock, except that adding returns this repository (as the desktop app's folder picker would). */
    function addingSource(addedId: string, message: string) {
      const source = new MockGitDataSource()
      source.addRepository = async () => {
        const repository = (await source.listRepositories()).find((repo) => repo.id === addedId)!
        return { repository: { ...repository, id: addedId }, message }
      }
      return source
    }

    it('in the browser, explains what Add repository would ask for', async () => {
      await gm.addRepository()
      expect(gm.status.value).toBe('Add repository: choose a folder that contains a .git directory')
      expect(gm.repositories.value).toHaveLength(5)
    })

    it('opens a repository that was already listed when it is added again', async () => {
      const adding = await loadedManager(addingSource('storefront', 'storefront-web is already in the list'))
      await adding.addRepository()
      expect(adding.repositories.value).toHaveLength(5)
      expect(adding.repository.value?.name).toBe('storefront-web')
      expect(adding.commit.value?.hash).toBe('5f8c2a4')
      expect(adding.status.value).toBe('storefront-web is already in the list')
    })

    it('adds a new repository to the end of the list and opens it', async () => {
      const source = new MockGitDataSource()
      const listRepositories = source.listRepositories.bind(source)
      source.listRepositories = async () => (await listRepositories()).filter((repo) => repo.id !== 'dotfiles')
      source.addRepository = async () => ({
        repository: (await listRepositories()).find((repo) => repo.id === 'dotfiles')!,
        message: 'Added dotfiles',
      })
      const adding = await loadedManager(source)
      await adding.addRepository()
      expect(adding.repositories.value.map((repo) => repo.id).at(-1)).toBe('dotfiles')
      expect(adding.repository.value?.name).toBe('dotfiles')
      expect(adding.status.value).toBe('Added dotfiles')
    })

    it('leaves everything as it was when the user cancels', async () => {
      const source = new MockGitDataSource()
      source.addRepository = async () => ({ repository: null, message: '' })
      const adding = await loadedManager(source)
      await adding.addRepository()
      expect(adding.status.value).toBe('Ready')
      expect(adding.repository.value?.name).toBe('inventory-service')
    })

    it('reports a folder that could not be added', async () => {
      const source = new MockGitDataSource()
      source.addRepository = async () => {
        throw new Error('C:\\temp isn’t inside a git repository')
      }
      const adding = await loadedManager(source)
      await adding.addRepository()
      expect(adding.status.value).toBe('Failed: C:\\temp isn’t inside a git repository')
    })

    it('removing another repository keeps the open one', async () => {
      await gm.removeRepository('pricing')
      expect(gm.repositories.value.map((repo) => repo.id)).not.toContain('pricing')
      expect(gm.repository.value?.name).toBe('inventory-service')
      expect(gm.status.value).toBe('Removed pricing-api from the list')
    })

    it('removing the open repository opens the first one left', async () => {
      await gm.removeRepository('inventory')
      expect(gm.repository.value?.name).toBe('pricing-api')
      expect(gm.commit.value?.hash).toBe('7c1d2e0')
    })

    it('removing the last repository leaves nothing open', async () => {
      for (const id of ['inventory', 'pricing', 'storefront', 'buildtools', 'dotfiles']) await gm.removeRepository(id)
      expect(gm.repositories.value).toEqual([])
      expect(gm.repository.value).toBeUndefined()
      expect(gm.commits.value).toEqual([])
      expect(gm.branches.value).toEqual({ local: [], remote: [] })
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

    it('shows a detached HEAD as such, and refuses to pull or push without a branch', async () => {
      const source = new MockGitDataSource()
      const listRepositories = source.listRepositories.bind(source)
      source.listRepositories = async () => (await listRepositories()).map((repo) => ({ ...repo, currentBranch: null }))
      const detached = await loadedManager(source)
      expect(detached.headLabel.value).toBe('detached HEAD')
      await detached.pull()
      expect(detached.status.value).toBe('Failed: no branch is checked out')
      await detached.push()
      expect(detached.status.value).toBe('Failed: no branch is checked out')
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
