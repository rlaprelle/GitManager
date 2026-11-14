import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { expiryJobDiff, reservationConfigDiff, sampleCompareDiff, skuLookupDiff } from '@/data/sampleDiffs'
import { invertHunks } from '@/lib/diff'
import type { GitDataSource } from '@/services/GitDataSource'
import type { SampleRepository } from '@/data/sampleTypes'
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

  describe('showing more history', () => {
    /** A repository with `count` commits in a line, newest first: c<count-1> … c0. */
    function longRepository(id: string, count: number): SampleRepository {
      const commits = Array.from({ length: count }, (_, i) => {
        const n = count - 1 - i
        return {
          hash: `c${n}`,
          parents: n > 0 ? [`c${n - 1}`] : [],
          message: `Commit ${n}`,
          author: 'You',
          date: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
          refs: [],
          files: [],
        }
      })
      return {
        ...structuredClone(sampleRepositories[0]!),
        id,
        name: id,
        currentBranch: 'main',
        localBranches: [{ name: 'main', ahead: 0, behind: 0, tipHash: commits[0]!.hash }],
        remoteBranches: [],
        commits,
      }
    }

    it('shows the next page on request, keeping the selected commit', async () => {
      const gm = await loadedManager(new MockGitDataSource([longRepository('long', 450)]))
      expect(gm.commits.value).toHaveLength(HISTORY_LIMIT)
      expect(gm.historyHasMore.value).toBe(true)
      await gm.selectCommit(5)

      await gm.showMoreHistory()
      expect(gm.commits.value).toHaveLength(2 * HISTORY_LIMIT)
      expect(gm.commit.value?.hash).toBe('c444')
      await gm.showMoreHistory()
      expect(gm.commits.value).toHaveLength(450)
      expect(gm.historyHasMore.value).toBe(false)
    })

    it('keeps the rows on screen while the next page loads, and says it is loading', async () => {
      const held = heldSource(new MockGitDataSource([longRepository('long', 450)]))
      const gm = await loadedManager(held.source)
      held.hold('getHistory')
      const more = gm.showMoreHistory()
      await settle()
      expect(gm.loadingMoreHistory.value).toBe(true)
      expect(gm.historyMessage.value).toBeNull()
      expect(gm.commits.value).toHaveLength(HISTORY_LIMIT)
      await held.callsTo('getHistory')[0]!.release()
      await more
      expect(gm.loadingMoreHistory.value).toBe(false)
    })

    it('keeps the longer history through a refresh, and starts again at one page for another repository', async () => {
      const gm = await loadedManager(new MockGitDataSource([longRepository('long', 450), longRepository('other', 450)]))
      await gm.showMoreHistory()
      await gm.refresh()
      expect(gm.commits.value).toHaveLength(2 * HISTORY_LIMIT)
      await gm.selectRepository('other')
      expect(gm.commits.value).toHaveLength(HISTORY_LIMIT)
    })
  })

  describe('refreshing after changes made outside the app', () => {
    it('opens the tip of a branch the user picked while the history was still loading', async () => {
      const held = heldSource()
      const opening = manager(held.source)
      held.hold('getHistory')
      const loading = opening.load()
      await settle()
      // Branches are on screen; the history isn't yet.
      await opening.selectBranch('main')

      await held.callsTo('getHistory')[0]!.release()
      await loading
      expect(opening.selectedBranch.value).toBe('main')
      expect(opening.commit.value?.hash).toBe('c81f5a3')
      expect(opening.files.value).not.toEqual([])
    })

    it('keeps a branch the user picked while the refresh was still reading', async () => {
      const held = heldSource()
      const refreshing = await loadedManager(held.source)
      held.hold('getHistory')
      const refresh = refreshing.refresh()
      await settle()
      // The window regained focus, and the user clicks a branch before git answers.
      await refreshing.selectBranch('main')
      expect(refreshing.commit.value?.hash).toBe('c81f5a3')

      await held.callsTo('getHistory')[0]!.release()
      await refresh
      expect(refreshing.selectedBranch.value).toBe('main')
      expect(refreshing.commit.value?.hash).toBe('c81f5a3')
    })

    /** A mock over its own copy of the sample data, which the test can change "outside the app". */
    function changeableSource() {
      const repositories = structuredClone(sampleRepositories)
      return { source: new MockGitDataSource(repositories), inventory: repositories[0]! }
    }

    const newCommit = (hash: string, parent: string) => ({
      hash,
      parents: [parent],
      message: 'Made outside the app',
      author: 'You',
      date: new Date().toISOString(),
      refs: [],
      files: [{ path: 'NOTES.md', status: 'A' as const, hunks: [{ oldStart: 0, newStart: 1, context: '', lines: ['+hi'] }] }],
    })

    it('shows a new commit and keeps the selected one selected', async () => {
      const { source, inventory } = changeableSource()
      const gm = await loadedManager(source)
      await gm.selectCommit(3)
      inventory.commits.unshift(newCommit('aaaa111', '9f3a1c2'))

      await gm.refresh()
      expect(gm.commits.value[0]!.hash).toBe('aaaa111')
      expect(gm.commit.value?.hash).toBe('2d6e914')
      expect(gm.activeHunks.value).toEqual(skuLookupDiff)
    })

    it('opens the newest commit when the selected one no longer exists (amended or rebased)', async () => {
      const { source, inventory } = changeableSource()
      const gm = await loadedManager(source)
      inventory.commits[0] = { ...newCommit('bbbb222', '4e7b0d9'), message: 'Add reservation expiry job (amended)' }

      await gm.refresh()
      expect(gm.commit.value?.hash).toBe('bbbb222')
      expect(gm.files.value.map((file) => file.path)).toEqual(['NOTES.md'])
    })

    it('updates the repository list: changed files and the checked-out branch', async () => {
      const { source, inventory } = changeableSource()
      const gm = await loadedManager(source)
      inventory.changedFileCount = 7
      inventory.currentBranch = 'main'

      await gm.refresh()
      expect(gm.repository.value?.changedFileCount).toBe(7)
      expect(gm.headLabel.value).toBe('main')
    })

    it('keeps the history on screen while it reloads, instead of showing "Loading history…"', async () => {
      const held = heldSource()
      const gm = await loadedManager(held.source)
      held.hold('getHistory')
      const refreshed = gm.refresh()
      await settle()
      expect(gm.historyMessage.value).toBeNull()
      expect(gm.commits.value).toHaveLength(10)
      await held.callsTo('getHistory')[0]!.release()
      await refreshed
    })

    it('opens the first repository when the open one has gone from the list', async () => {
      const source = new MockGitDataSource()
      const gm = await loadedManager(source)
      await source.removeRepository('inventory')
      await gm.refresh()
      expect(gm.repository.value?.name).toBe('pricing-api')
    })

    it('says so when asked (F5), and stays quiet otherwise', async () => {
      await gm.refresh()
      expect(gm.status.value).toBe('Ready')
      await gm.refresh({ announce: true })
      expect(gm.status.value).toBe('Refreshed inventory-service')
    })

    it('reports a refresh that fails', async () => {
      const source = new MockGitDataSource()
      const gm = await loadedManager(source)
      source.listRepositories = async () => {
        throw new Error('disk asleep')
      }
      await gm.refresh()
      expect(gm.status.value).toBe('Couldn’t refresh: disk asleep')
      expect(gm.repository.value?.name).toBe('inventory-service')
    })

    it('runs one refresh at a time', async () => {
      const held = heldSource()
      const gm = await loadedManager(held.source)
      held.hold('listRepositories')
      const first = gm.refresh()
      const second = gm.refresh()
      await settle()
      expect(held.callsTo('listRepositories')).toHaveLength(1)
      await held.callsTo('listRepositories')[0]!.release()
      await Promise.all([first, second])
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
    it('checking out a branch makes it the current branch, keeping the selected commit', async () => {
      await gm.selectBranch('main')
      const selected = gm.commit.value?.hash
      await gm.checkoutBranch('main')
      expect(gm.currentBranch.value).toBe('main')
      expect(gm.selectedBranch.value).toBe('main')
      expect(gm.commit.value?.hash).toBe(selected)
      expect(gm.status.value).toBe('Switched to main; 3 uncommitted changes came along')
      expect(gm.operationRunning.value).toBe(false)
    })

    it('checking out a remote branch switches to its new local branch, and lists it', async () => {
      await gm.selectBranch('origin/release/2.4')
      const selected = gm.commit.value?.hash
      expect(gm.checkoutableRemotes.value).toContain('origin/release/2.4')

      await gm.checkoutRemoteBranch('origin/release/2.4')
      expect(gm.currentBranch.value).toBe('release/2.4')
      expect(gm.selectedBranch.value).toBe('release/2.4')
      expect(gm.commit.value?.hash).toBe(selected)
      expect(gm.branches.value.local.map((branch) => branch.name)).toContain('release/2.4')
      expect(gm.checkoutableRemotes.value).not.toContain('origin/release/2.4')
      expect(gm.status.value).toBe('Switched to a new branch release/2.4, tracking origin/release/2.4; 3 uncommitted changes came along')
    })

    it('runs one operation at a time, and refreshes only after it', async () => {
      const held = heldSource()
      const busy = await loadedManager(held.source)
      held.hold('checkout', 'listRepositories')
      const checkingOut = busy.checkoutBranch('main')
      await settle()
      expect(busy.operationRunning.value).toBe(true)
      expect(busy.status.value).toBe('Switching to main…')

      await busy.checkoutBranch('bugfix/sku-null-check')
      await busy.fetchRemote()
      await busy.refresh({ announce: true })
      expect(held.callsTo('checkout')).toHaveLength(1)
      expect(held.callsTo('listRepositories')).toHaveLength(0)

      await held.callsTo('checkout')[0]!.release()
      expect(held.callsTo('listRepositories')).toHaveLength(1)
      await held.callsTo('listRepositories')[0]!.release()
      await checkingOut
      expect(busy.operationRunning.value).toBe(false)
      expect(busy.currentBranch.value).toBe('main')
      expect(busy.status.value).toBe('Switched to main; 3 uncommitted changes came along')
    })

    it('waits for a refresh already running before checking out', async () => {
      const held = heldSource()
      const waiting = await loadedManager(held.source)
      held.hold('listRepositories')
      const refreshing = waiting.refresh()
      await settle()
      const checkingOut = waiting.checkoutBranch('main')
      await settle()
      expect(held.callsTo('checkout')).toHaveLength(0)

      held.letThrough('listRepositories')
      await held.callsTo('listRepositories')[0]!.release()
      await Promise.all([refreshing, checkingOut])
      expect(waiting.currentBranch.value).toBe('main')
    })

    it('asks before leaving a detached HEAD’s commits, and goes ahead only when told to', async () => {
      const source = new MockGitDataSource()
      const calls: unknown[][] = []
      const checkout = source.checkout.bind(source)
      source.checkout = async (repoId, target, options) => {
        calls.push([target, options])
        return options?.leaveCommits ? checkout(repoId, target, options) : { kind: 'confirm', commitsLeft: 2 }
      }
      const asking = await loadedManager(source)
      await asking.checkoutRemoteBranch('origin/release/2.4')
      expect(asking.pendingCheckout.value).toEqual({
        target: { remote: 'origin/release/2.4' },
        branch: 'origin/release/2.4',
        destination: 'release/2.4',
        commitsLeft: 2,
      })
      expect(asking.status.value).toBe('Switching to origin/release/2.4 would leave 2 commits on no branch')
      expect(asking.currentBranch.value).toBe('feature/stock-reservations')
      expect(asking.operationRunning.value).toBe(false)

      await asking.confirmCheckout()
      expect(calls).toEqual([
        [{ remote: 'origin/release/2.4' }, {}],
        [{ remote: 'origin/release/2.4' }, { leaveCommits: true }],
      ])
      expect(asking.pendingCheckout.value).toBeNull()
      expect(asking.currentBranch.value).toBe('release/2.4')
    })

    it('cancelling the question changes nothing', async () => {
      const source = new MockGitDataSource()
      source.checkout = async () => ({ kind: 'confirm', commitsLeft: 1 })
      const asking = await loadedManager(source)
      await asking.checkoutBranch('main')
      asking.cancelCheckout()
      expect(asking.pendingCheckout.value).toBeNull()
      expect(asking.currentBranch.value).toBe('feature/stock-reservations')
      expect(asking.status.value).toBe('Checkout cancelled; nothing changed')
      await asking.confirmCheckout()
      expect(asking.currentBranch.value).toBe('feature/stock-reservations')
    })

    it('drops the question when another repository is opened', async () => {
      const source = new MockGitDataSource()
      source.checkout = async () => ({ kind: 'confirm', commitsLeft: 1 })
      const asking = await loadedManager(source)
      await asking.checkoutBranch('main')
      await asking.selectRepository('pricing')
      expect(asking.pendingCheckout.value).toBeNull()
    })

    it('fetching reloads the repository, with the last-fetch time the source recorded', async () => {
      const before = Date.now()
      await gm.fetchRemote()
      expect(Date.parse(gm.repository.value!.lastFetch!)).toBeGreaterThanOrEqual(before)
      expect(gm.status.value).toBe('Fetched: everything was up to date')
    })

    it('pulls and pushes the checked-out branch, then shows what changed', async () => {
      await gm.pull()
      expect(gm.status.value).toBe('Already up to date with origin/feature/stock-reservations')
      await gm.push()
      expect(gm.status.value).toBe('Pushed 2 commits to origin/feature/stock-reservations')
      expect(gm.headerSyncLabel.value).toBeNull()
      expect(gm.branches.value.local.find((branch) => branch.name === 'feature/stock-reservations')!.ahead).toBe(0)
    })

    it('says what is running, one operation at a time, and keeps the selection when it reloads', async () => {
      const held = heldSource()
      const busy = await loadedManager(held.source)
      const selected = busy.commit.value!.hash
      held.hold('push')
      const pushing = busy.push()
      await settle()
      expect(busy.runningOperation.value).toBe('push')
      expect(busy.operationRunning.value).toBe(true)
      expect(busy.status.value).toBe('Pushing…')

      await busy.fetchRemote()
      await busy.pull()
      await busy.checkoutBranch('main')
      await busy.refresh()
      expect(held.callsTo('push')).toHaveLength(1)

      held.hold('listRepositories')
      await held.callsTo('push')[0]!.release()
      // Still running while it re-reads, so nothing else starts in between.
      expect(busy.runningOperation.value).toBe('push')
      await held.callsTo('listRepositories')[0]!.release()
      await pushing
      expect(busy.runningOperation.value).toBeNull()
      expect(busy.status.value).toBe('Pushed 2 commits to origin/feature/stock-reservations')
      expect(busy.commit.value!.hash).toBe(selected)
    })

    it('waits for a refresh already running before fetching', async () => {
      const held = heldSource()
      const waiting = await loadedManager(held.source)
      held.hold('listRepositories')
      const refreshing = waiting.refresh()
      await settle()
      const fetching = waiting.fetchRemote()
      await settle()
      expect(waiting.status.value).toBe('Fetching…')
      expect(held.callsTo('fetch')).toHaveLength(0)

      held.letThrough('listRepositories')
      await held.callsTo('listRepositories')[0]!.release()
      await Promise.all([refreshing, fetching])
      expect(waiting.status.value).toBe('Fetched: everything was up to date')
    })

    it('re-reads the repository after a failure too, since a refused pull has still fetched', async () => {
      const source = new MockGitDataSource()
      const failing = await loadedManager(source)
      let reads = 0
      const listRepositories = source.listRepositories.bind(source)
      source.listRepositories = async () => (reads++, listRepositories())
      source.pull = async () => {
        throw new Error('can’t fast-forward: main and origin/main both have new commits')
      }
      await failing.pull()
      expect(failing.status.value).toBe('Failed: can’t fast-forward: main and origin/main both have new commits')
      expect(reads).toBe(1)
      expect(failing.runningOperation.value).toBeNull()
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
      expect(failing.operationRunning.value).toBe(false)
    })
  })
})
