import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import type { SampleRepository } from '@/data/sampleTypes'
import { conflictsIn, resultText } from '@/lib/mergeChunks'
import type { GitDataSource } from '@/services/GitDataSource'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import { mergeDraftKey, mergeDrafts } from '../mergeDrafts'
import { useGitManager } from '../useGitManager'
import { heldSource, settle } from './heldSource'

/** Saved merges live here, like localStorage across a restart; a fresh one per test. */
let storage: Map<string, string>
const memoryStorage = () => ({
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
})

beforeEach(() => {
  storage = new Map()
})

async function loaded(source: GitDataSource = new MockGitDataSource()) {
  const gm = useGitManager(source, { comparePaths: { ...SAMPLE_COMPARE_PATHS }, mergeDrafts: mergeDrafts(memoryStorage()) })
  await gm.load()
  return gm
}

type Manager = Awaited<ReturnType<typeof loaded>>

/** Index of the file's first conflict among its chunks, as the arrows address it. */
function firstConflict(gm: Manager): number {
  return gm.mergeFile.value!.chunks.findIndex((chunk) => chunk.kind === 'conflict')
}

/** Opens the dialog, picks `branch` and waits for its preview. */
async function picked(gm: Manager, branch: string) {
  gm.openMergeDialog()
  await gm.chooseMergeBranch(branch)
}

/** In the resolver for merging main (which clashes in two sample files). */
async function resolving(source?: GitDataSource) {
  const gm = await loaded(source)
  await picked(gm, 'main')
  await gm.startMerge()
  return gm
}

/** Settles every conflict in every file with ours. */
function resolveAll(gm: Manager) {
  for (const { path } of gm.mergeSession.value!.files) {
    gm.selectMergeFile(path)
    gm.mergeFile.value!.chunks.forEach((chunk, index) => {
      if (chunk.kind === 'conflict') gm.toggleMergeSide(index, 'ours')
    })
  }
}

describe('the Merge dialog', () => {
  it('offers every branch but the checked-out one, local before remote', async () => {
    const gm = await loaded()
    expect(gm.mergeableBranches.value).toEqual([
      'main',
      'bugfix/sku-null-check',
      'origin/main',
      'origin/bugfix/sku-null-check',
      'origin/feature/stock-reservations',
      'origin/release/2.4',
    ])
  })

  it('previews the picked branch, and closing forgets it', async () => {
    const gm = await loaded()
    await picked(gm, 'main')
    expect(gm.mergeDialog.value).toMatchObject({ fromPull: false, branch: 'main', problem: null })
    expect(gm.mergePreview.value).toMatchObject({ outcome: 'merge-commit', commits: 2 })
    gm.closeMergeDialog()
    expect(gm.mergeDialog.value).toBeNull()
    expect(gm.mergePreview.value).toBeNull()
  })

  it('shows only the latest pick’s preview when answers arrive out of order', async () => {
    const held = heldSource()
    const gm = await loaded(held.source)
    held.hold('previewMerge')
    gm.openMergeDialog()
    void gm.chooseMergeBranch('main')
    void gm.chooseMergeBranch('bugfix/sku-null-check')
    expect(gm.mergeChecking.value).toBe(true)
    const [first, second] = held.callsTo('previewMerge')
    await second!.release()
    await first!.release()
    expect(gm.mergePreview.value?.branch).toBe('bugfix/sku-null-check')
    expect(gm.mergeChecking.value).toBe(false)
  })

  it('shows why a branch can’t be previewed, in the dialog', async () => {
    const source = new MockGitDataSource()
    source.previewMerge = async () => {
      throw new Error('a merge is already in progress')
    }
    const gm = await loaded(source)
    await picked(gm, 'main')
    expect(gm.mergeDialog.value?.problem).toBe('a merge is already in progress')
    expect(gm.mergePreview.value).toBeNull()
  })

  it('says why a merge can’t go ahead, and won’t start it', async () => {
    const source = new MockGitDataSource()
    let merges = 0
    source.merge = async () => (merges++, { message: 'merged' })
    const gm = await loaded(source)
    await picked(gm, 'origin/feature/stock-reservations')
    expect(gm.mergeBlocked.value).toBe('feature/stock-reservations already has every commit on origin/feature/stock-reservations')
    await gm.startMerge()
    expect(merges).toBe(0)
    expect(gm.mergeDialog.value).not.toBeNull()
  })

  it('doesn’t open while another operation runs, or with no branch checked out', async () => {
    const held = heldSource()
    const gm = await loaded(held.source)
    held.hold('fetch')
    void gm.fetchRemote()
    await settle()
    gm.openMergeDialog()
    expect(gm.mergeDialog.value).toBeNull()
    await held.callsTo('fetch')[0]!.release()

    const detachedSource = new MockGitDataSource()
    const list = detachedSource.listRepositories.bind(detachedSource)
    detachedSource.listRepositories = async () => (await list()).map((repo) => ({ ...repo, currentBranch: null }))
    const detached = await loaded(detachedSource)
    detached.openMergeDialog()
    expect(detached.mergeDialog.value).toBeNull()
  })
})

describe('a clean merge', () => {
  it('completes from the dialog, reports it, and re-reads the history', async () => {
    const gm = await loaded()
    await picked(gm, 'bugfix/sku-null-check')
    await gm.startMerge()
    expect(gm.mergeDialog.value).toBeNull()
    expect(gm.mergeSession.value).toBeNull()
    expect(gm.status.value).toBe('Merged bugfix/sku-null-check into feature/stock-reservations (1 commit)')
    expect(gm.commits.value[0]!.message).toBe("Merge branch 'bugfix/sku-null-check' into feature/stock-reservations")
    expect(gm.runningOperation.value).toBeNull()
  })

  it('keeps the dialog open with the reason when it fails', async () => {
    const source = new MockGitDataSource()
    source.merge = async () => {
      throw new Error('your changes would be overwritten')
    }
    const gm = await loaded(source)
    await picked(gm, 'bugfix/sku-null-check')
    await gm.startMerge()
    expect(gm.mergeDialog.value?.problem).toBe('your changes would be overwritten')
    expect(gm.status.value).toBe('Failed: your changes would be overwritten')
  })

  it('names the running operation, so the button can say so, and waits for a refresh first', async () => {
    const held = heldSource()
    const gm = await loaded(held.source)
    await picked(gm, 'bugfix/sku-null-check')
    held.hold('listRepositories', 'merge')
    void gm.refresh()
    const merging = gm.startMerge()
    await settle()
    expect(gm.runningOperation.value).toBe('merge')
    expect(held.callsTo('merge')).toHaveLength(0)
    await held.callsTo('listRepositories')[0]!.release()
    await settle()
    expect(held.callsTo('merge')).toHaveLength(1)
    held.letThrough('listRepositories')
    await held.callsTo('merge')[0]!.release()
    await merging
    expect(gm.runningOperation.value).toBeNull()
  })
})

describe('a merge with conflicts', () => {
  it('opens the resolver on the first file without changing anything', async () => {
    const source = new MockGitDataSource()
    const before = await source.getBranches('inventory')
    const gm = await resolving(source)
    const session = gm.mergeSession.value!
    expect(session.into).toBe('feature/stock-reservations')
    expect(session.files.map((file) => file.path)).toEqual(['src/main/resources/application.yml', 'pom.xml'])
    expect(gm.mergeFile.value?.path).toBe('src/main/resources/application.yml')
    expect(gm.mergeDialog.value).toBeNull()
    expect(gm.mergeConflictsLeft.value).toBe(3)
    expect(gm.status.value).toBe('3 conflicts to resolve in 2 files · Nothing on disk has changed yet')
    expect(await source.getBranches('inventory')).toEqual(before)
  })

  it('stays in the dialog, with the reason, if the conflicts can’t be read', async () => {
    const source = new MockGitDataSource()
    source.getMergeConflicts = async () => {
      throw new Error('a branch has moved')
    }
    const gm = await resolving(source)
    expect(gm.mergeSession.value).toBeNull()
    expect(gm.mergeDialog.value?.problem).toBe('a branch has moved')
  })

  it('keeps the status bar’s count current as conflicts are settled', async () => {
    const gm = await resolving()
    gm.toggleMergeSide(firstConflict(gm), 'theirs')
    expect(gm.status.value).toBe('2 conflicts left · Nothing on disk has changed yet')
    resolveAll(gm)
    expect(gm.status.value).toBe('All conflicts resolved · Nothing on disk has changed yet')
  })

  it('applies choices to the file on screen only', async () => {
    const gm = await resolving()
    gm.toggleMergeSide(firstConflict(gm), 'theirs')
    expect(gm.mergeConflictsLeft.value).toBe(2)
    gm.selectMergeFile('pom.xml')
    expect(gm.mergeFile.value?.path).toBe('pom.xml')
    expect(conflictsIn(gm.mergeFile.value!)[0]!.picks).toEqual([])
  })

  it('ignores a file that isn’t in the merge', async () => {
    const gm = await resolving()
    gm.selectMergeFile('no-such-file')
    expect(gm.mergeFile.value?.path).toBe('src/main/resources/application.yml')
  })

  it('resolves by neither side, by hand, and can reopen', async () => {
    const gm = await resolving()
    const index = firstConflict(gm)
    gm.useNeitherMergeSide(index)
    expect(gm.mergeConflictsLeft.value).toBe(2)
    gm.reopenMergeConflict(index)
    expect(gm.mergeConflictsLeft.value).toBe(3)
    gm.editMergeConflict(index, 'typed: yes')
    expect(gm.mergeConflictsLeft.value).toBe(2)
    expect(resultText(gm.mergeFile.value!)).toContain('typed: yes')
  })

  it('marks a file only once its conflicts are resolved, and any change clears the mark', async () => {
    const gm = await resolving()
    gm.selectMergeFile('pom.xml')
    gm.markMergeFileResolved()
    expect(gm.mergeFile.value?.marked).toBe(false)
    const index = firstConflict(gm)
    gm.toggleMergeSide(index, 'ours')
    gm.markMergeFileResolved()
    expect(gm.mergeFile.value?.marked).toBe(true)
    expect(gm.status.value).toBe('Marked pom.xml as resolved. Nothing is staged or written: this only tracks your progress')
    gm.toggleMergeSide(index, 'theirs')
    expect(gm.mergeFile.value?.marked).toBe(false)
  })

  it('won’t complete with conflicts left', async () => {
    const source = new MockGitDataSource()
    let merges = 0
    source.merge = async () => (merges++, { message: 'merged' })
    const gm = await resolving(source)
    await gm.completeMerge()
    expect(merges).toBe(0)
    expect(gm.mergeSession.value).not.toBeNull()
  })

  it('completes without any file being marked, sending each file’s result as plain data', async () => {
    const source = new MockGitDataSource()
    const sent: unknown[][] = []
    const merge = source.merge.bind(source)
    source.merge = async (...args) => (sent.push(args), merge(...args))
    const gm = await resolving(source)
    resolveAll(gm)
    await gm.completeMerge()
    expect(gm.mergeSession.value).toBeNull()
    expect(gm.status.value).toBe('Merged main into feature/stock-reservations (2 commits)')
    expect(gm.commits.value[0]!.message).toBe("Merge branch 'main' into feature/stock-reservations")
    const [, request, resolutions] = sent[0] as [string, unknown, { path: string; text: string }[]]
    expect(Object.keys(request as object).sort()).toEqual(['branch', 'into', 'ours', 'theirs'])
    expect(resolutions.map((resolution) => resolution.path)).toEqual(['src/main/resources/application.yml', 'pom.xml'])
    expect(resolutions[1]!.text).toContain('<version>2.4.0-SNAPSHOT</version>')
    expect(() => structuredClone(sent[0])).not.toThrow()
  })

  it('keeps every choice when completing fails', async () => {
    const source = new MockGitDataSource()
    source.merge = async () => {
      throw new Error('a branch has moved since')
    }
    const gm = await resolving(source)
    resolveAll(gm)
    await gm.completeMerge()
    expect(gm.status.value).toBe('Failed: a branch has moved since')
    expect(gm.mergeSession.value).not.toBeNull()
    expect(gm.mergeConflictsLeft.value).toBe(0)
  })

  it('discards straight away when nothing was decided', async () => {
    const gm = await resolving()
    gm.discardMerge()
    expect(gm.mergeDiscardPending.value).toBe(false)
    expect(gm.mergeSession.value).toBeNull()
    expect(gm.status.value).toBe('Merge discarded; nothing changed')
  })

  it('asks before discarding a decision, and can be talked out of it', async () => {
    const gm = await resolving()
    gm.toggleMergeSide(firstConflict(gm), 'ours')
    gm.discardMerge()
    expect(gm.mergeDiscardPending.value).toBe(true)
    expect(gm.mergeSession.value).not.toBeNull()
    gm.cancelDiscardMerge()
    expect(gm.mergeDiscardPending.value).toBe(false)
    expect(gm.mergeConflictsLeft.value).toBe(2)
    gm.discardMerge()
    gm.confirmDiscardMerge()
    expect(gm.mergeSession.value).toBeNull()
    expect(gm.mergeDiscardPending.value).toBe(false)
  })

  it('won’t open the dialog on top of a merge being resolved', async () => {
    const gm = await resolving()
    gm.openMergeDialog()
    expect(gm.mergeDialog.value).toBeNull()
  })

  it('forgets the merge when another repository is opened', async () => {
    const gm = await resolving()
    await gm.selectRepository('pricing')
    expect(gm.mergeSession.value).toBeNull()
  })
})

describe('a merge left unfinished', () => {
  const KEY = mergeDraftKey('inventory')

  /** A source whose repositories survive "restarting the app", as a real repository would. */
  const sameRepositories = () => {
    const repositories = structuredClone(sampleRepositories)
    return { repositories, source: () => new MockGitDataSource(repositories) }
  }

  it('comes back after a restart, with the user’s choices and file', async () => {
    const { source } = sameRepositories()
    const before = await resolving(source())
    before.toggleMergeSide(firstConflict(before), 'theirs')
    before.selectMergeFile('pom.xml')

    const after = await loaded(source())
    expect(after.mergeSession.value?.request.branch).toBe('main')
    expect(after.mergeFile.value?.path).toBe('pom.xml')
    expect(after.mergeConflictsLeft.value).toBe(2)
    expect(after.status.value).toBe('Continuing your merge of main into feature/stock-reservations · Nothing on disk has changed yet')
  })

  it('stays with its repository when another is opened, and returns with it', async () => {
    const gm = await resolving()
    gm.toggleMergeSide(firstConflict(gm), 'ours')
    await gm.selectRepository('pricing')
    expect(gm.mergeSession.value).toBeNull()
    await gm.selectRepository('inventory')
    expect(gm.mergeConflictsLeft.value).toBe(2)
  })

  it.each<[string, (gm: Manager) => unknown]>([
    ['discarding', (gm) => gm.discardMerge()],
    [
      'completing',
      (gm) => {
        resolveAll(gm)
        return gm.completeMerge()
      },
    ],
  ])('is forgotten after %s', async (_name, finish) => {
    const gm = await resolving()
    expect(storage.has(KEY)).toBe(true)
    await finish(gm)
    expect(storage.has(KEY)).toBe(false)
  })

  it('is ignored if what was saved is unreadable', async () => {
    storage.set(KEY, '{not json')
    expect((await loaded()).mergeSession.value).toBeNull()
    storage.set(KEY, JSON.stringify({ request: { branch: 'main' } }))
    expect((await loaded()).mergeSession.value).toBeNull()
  })

  it('is worked out again if a branch moved, keeping choices in files that came out the same', async () => {
    const { repositories, source } = sameRepositories()
    const before = await resolving(source())
    before.selectMergeFile('pom.xml')
    before.toggleMergeSide(firstConflict(before), 'ours')
    before.selectMergeFile('src/main/resources/application.yml')
    before.toggleMergeSide(firstConflict(before), 'ours')

    // main gets a new commit that changes application.yml's conflict but not pom.xml's.
    const inventory = repositories.find((repo) => repo.id === 'inventory')!
    const main = inventory.localBranches.find((branch) => branch.name === 'main')!
    inventory.commits.unshift({ hash: 'bb00001', message: 'More', author: 'A', date: new Date().toISOString(), refs: [], parents: [main.tipHash], files: [] })
    main.tipHash = 'bb00001'
    const yml = inventory.mergeConflicts!['main']![0]!
    yml.theirs = yml.theirs.replace('include: health,info', 'include: health,prometheus')

    const after = await loaded(source())
    expect(after.mergeSession.value?.request.theirs).toBe('bb00001')
    expect(after.status.value).toContain('1 file needs another look')
    expect(after.mergeConflictsLeft.value).toBe(2)
    after.selectMergeFile('pom.xml')
    expect(conflictsIn(after.mergeFile.value!)[0]!.picks).toEqual(['ours'])
  })

  it('waits, with its choices saved, while another branch is checked out, and returns with that branch', async () => {
    const { repositories, source } = sameRepositories()
    const before = await resolving(source())
    before.toggleMergeSide(firstConflict(before), 'ours')
    repositories.find((repo) => repo.id === 'inventory')!.currentBranch = 'bugfix/sku-null-check'

    const after = await loaded(source())
    expect(after.mergeSession.value).toBeNull()
    expect(after.status.value).toBe('Your merge of main into feature/stock-reservations is waiting: check out feature/stock-reservations to continue it')
    expect(storage.has(KEY)).toBe(true)

    await after.checkoutBranch('feature/stock-reservations')
    expect(after.mergeSession.value?.request.branch).toBe('main')
    expect(after.mergeConflictsLeft.value).toBe(2)
  })

  it('keeps its choices when it can’t be read back yet', async () => {
    const { source } = sameRepositories()
    const before = await resolving(source())
    before.toggleMergeSide(firstConflict(before), 'ours')
    const failing = source()
    failing.previewMerge = async () => {
      throw new Error('no branch is checked out')
    }
    const after = await loaded(failing)
    expect(after.mergeSession.value).toBeNull()
    expect(after.status.value).toBe('Couldn’t continue your merge of main yet: no branch is checked out. Your choices are saved')
    expect(storage.has(KEY)).toBe(true)
  })

  it('stays open, choices intact, when a branch moved and something now blocks the merge', async () => {
    const { source } = sameRepositories()
    const before = await resolving(source())
    before.toggleMergeSide(firstConflict(before), 'ours')
    const blocked = source()
    const preview = blocked.previewMerge.bind(blocked)
    blocked.previewMerge = async (...args) => ({ ...(await preview(...args)), theirs: 'moved00', blockedBy: ['pom.xml'] })
    const after = await loaded(blocked)
    expect(after.mergeConflictsLeft.value).toBe(2)
    expect(after.status.value).toContain('This merge can’t continue yet')
    expect(after.status.value).toContain('Your choices are kept')
    expect(storage.has(KEY)).toBe(true)
  })

  it('is dropped, saying so, once the branch no longer exists', async () => {
    const { repositories, source } = sameRepositories()
    await resolving(source())
    const inventory = repositories.find((repo) => repo.id === 'inventory')!
    inventory.localBranches = inventory.localBranches.filter((branch) => branch.name !== 'main')
    inventory.remoteBranches = inventory.remoteBranches.filter((branch) => branch.name !== 'main')
    const after = await loaded(source())
    expect(after.mergeSession.value).toBeNull()
    expect(after.status.value).toBe('Your merge of main was dropped: that branch no longer exists')
    expect(storage.has(KEY)).toBe(false)
  })

  it('doesn’t appear in another repository opened while it was being worked out again', async () => {
    const { repositories, source } = sameRepositories()
    await resolving(source())
    const inventory = repositories.find((repo) => repo.id === 'inventory')!
    inventory.localBranches.find((branch) => branch.name === 'main')!.tipHash = 'c81f5a3'
    inventory.commits.unshift({ hash: 'bb00003', message: 'More', author: 'A', date: new Date().toISOString(), refs: [], parents: ['c81f5a3'], files: [] })
    inventory.localBranches.find((branch) => branch.name === 'main')!.tipHash = 'bb00003'

    const held = heldSource(source())
    held.hold('getMergeConflicts')
    const gm = useGitManager(held.source, { comparePaths: { ...SAMPLE_COMPARE_PATHS }, mergeDrafts: mergeDrafts(memoryStorage()) })
    const loading = gm.load()
    await settle()
    await gm.selectRepository('pricing')
    await held.callsTo('getMergeConflicts')[0]!.release()
    await loading
    expect(gm.repository.value?.id).toBe('pricing')
    expect(gm.mergeSession.value).toBeNull()
    expect(storage.has(KEY)).toBe(true)
  })

  it('takes no more choices while Complete is running', async () => {
    const held = heldSource()
    const gm = await resolving(held.source)
    resolveAll(gm)
    held.hold('merge')
    const completing = gm.completeMerge()
    await settle()
    const index = firstConflict(gm)
    gm.reopenMergeConflict(index)
    expect(gm.mergeConflictsLeft.value).toBe(0)
    await held.callsTo('merge')[0]!.release()
    await completing
  })

  it('reworks the merge when Complete finds a branch moved, instead of leaving the user stuck', async () => {
    const repositories = structuredClone(sampleRepositories)
    const source = new MockGitDataSource(repositories)
    const gm = await resolving(source)
    resolveAll(gm)
    const inventory = repositories.find((repo) => repo.id === 'inventory')!
    const main = inventory.localBranches.find((branch) => branch.name === 'main')!
    inventory.commits.unshift({ hash: 'bb00002', message: 'More', author: 'A', date: new Date().toISOString(), refs: [], parents: [main.tipHash], files: [] })
    main.tipHash = 'bb00002'
    await gm.completeMerge()
    expect(gm.mergeSession.value?.request.theirs).toBe('bb00002')
    expect(gm.mergeConflictsLeft.value).toBe(0)
    expect(gm.status.value).toContain('0 files need another look')
  })
})

describe('an operation left unfinished outside the app', () => {
  it('is reported for the open repository, and follows a refresh', async () => {
    const source = new MockGitDataSource()
    let unfinished: 'rebase' | null = 'rebase'
    source.getUnfinishedOperation = async () => unfinished
    const gm = await loaded(source)
    expect(gm.unfinishedOperation.value).toBe('rebase')
    unfinished = null
    await gm.refresh()
    expect(gm.unfinishedOperation.value).toBeNull()
  })

  it('is nothing to report in an ordinary repository', async () => {
    expect((await loaded()).unfinishedOperation.value).toBeNull()
  })
})

describe('a Pull that can’t fast-forward', () => {
  function divergedRepositories(): SampleRepository[] {
    const repositories = structuredClone(sampleRepositories)
    const inventory = repositories.find((repo) => repo.id === 'inventory')!
    inventory.localBranches.find((branch) => branch.name === 'feature/stock-reservations')!.behind = 1
    return repositories
  }

  it('says so and offers to merge the upstream, already previewed', async () => {
    const gm = await loaded(new MockGitDataSource(divergedRepositories()))
    await gm.pull()
    expect(gm.status.value).toBe(
      'feature/stock-reservations and origin/feature/stock-reservations both have new commits, so Pull can’t just move feature/stock-reservations forward',
    )
    expect(gm.mergeDialog.value).toMatchObject({ fromPull: true, branch: 'origin/feature/stock-reservations' })
    expect(gm.mergePreview.value?.branch).toBe('origin/feature/stock-reservations')
  })

  it('offers nothing when the host can’t merge (git too old)', async () => {
    const gm = useGitManager(new MockGitDataSource(divergedRepositories()), {
      comparePaths: { ...SAMPLE_COMPARE_PATHS },
      mergeDrafts: mergeDrafts(memoryStorage()),
      canMerge: false,
    })
    await gm.load()
    await gm.pull()
    expect(gm.status.value).toContain('both have new commits')
    expect(gm.mergeDialog.value).toBeNull()
  })

  it('offers nothing after an ordinary pull', async () => {
    const gm = await loaded()
    await gm.pull()
    expect(gm.mergeDialog.value).toBeNull()
  })
})
