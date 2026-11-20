import { type ComputedRef, computed, ref, shallowRef } from 'vue'
import { errorMessage } from '@/lib/errorMessage'
import { pluralize } from '@/lib/format'
import { MERGE_NOT_SAVED, MOVED_SINCE, mergeRefusal } from '@/lib/merge'
import {
  type MergeFile,
  type MergeSide,
  carryChoices,
  conflictsIn,
  conflictsLeftIn,
  editConflict,
  isResolved,
  reopenConflict,
  resultText,
  toMergeFile,
  toggleSide,
  useNeitherSide,
} from '@/lib/mergeChunks'
import type { GitDataSource, RepositoryOperation } from '@/services/GitDataSource'
import type { Branches, MergePreview, MergeRequest, Repository } from '@/types/git'
import { latestLoad } from './latestLoad'
import type { MergeDrafts } from './mergeDrafts'
import type { ReportOptions, Reporter } from './reporter'

/** The Merge dialog while it's open. */
export interface MergeDialogState {
  /** Opened from a Pull that couldn't fast-forward, rather than from the header. */
  fromPull: boolean
  /** The branch picked to merge; null until one is. */
  branch: string | null
  /** Why the branch can't be previewed or the merge failed, shown in the dialog. */
  problem: string | null
  /**
   * A merge saved for this repository that isn't on screen (the branch it merges into isn't checked
   * out, say). Only one is kept per repository, so resolving another would replace it.
   */
  waiting: WaitingMerge | null
}

/** A saved merge, as the dialog names it. */
export interface WaitingMerge {
  branch: string
  into: string
}

/** A merge being resolved. It exists only here (and in `mergeDrafts`, to survive a restart) until Complete merge: nothing on disk has changed. */
export interface MergeSession {
  request: MergeRequest
  into: string
  commits: number
  files: MergeFile[]
  /** The file on screen. */
  path: string
}

/** What the merge flow needs from useGitManager. */
export interface MergeFlowHost {
  source: GitDataSource
  /** How the merge flow tells the user things; where each appears isn't its business. */
  report: Reporter
  repository: ComputedRef<Repository | undefined>
  branches: ComputedRef<Branches>
  currentBranch: ComputedRef<string>
  operationRunning: ComputedRef<boolean>
  runOperation(name: RepositoryOperation, progress: string, work: (repo: Repository) => Promise<void>): Promise<void>
  /** Resolves when a refresh already running has finished, so what it read can't land after the merge. */
  refreshFinished(): Promise<void> | null
  reload(): Promise<void>
  /** Where a merge being resolved is kept, so closing the app doesn't lose it. */
  drafts: MergeDrafts
}

const NOTHING_ON_DISK = 'Nothing on disk has changed yet'

export function useMergeFlow(host: MergeFlowHost) {
  const { source, report, drafts } = host

  /** A message about a repository says which, in case the user has moved on by the time they read it. */
  const about = (repo: Repository | undefined): ReportOptions => (repo ? { repository: repo.name } : {})

  const mergeDialog = ref<MergeDialogState | null>(null)
  const previewLoad = latestLoad<MergePreview | null>(null)
  // shallow: files are replaced whole on every change, and must reach IPC as plain objects.
  const mergeSession = shallowRef<MergeSession | null>(null)
  const mergeDiscardPending = ref(false)
  /** The user is being asked whether the merge they are starting may replace the one that is waiting. */
  const mergeReplacePending = ref(false)

  /**
   * The user has been told that the merge on screen couldn't be saved (once per merge is enough):
   * which repository that was said about, so it can be taken back about the same one.
   */
  let toldNotSaved: ReportOptions | null = null

  /**
   * Every change to the merge goes through here, so what's saved always matches the screen. When it
   * can't be saved the merge carries on, and the user is warned: closing the app would now lose it.
   */
  function setSession(repoId: string, session: MergeSession): void {
    mergeSession.value = session
    noLongerWaiting()
    if (drafts.save(repoId, session) || toldNotSaved) return
    toldNotSaved = about(host.repository.value)
    report.warn(MERGE_NOT_SAVED, toldNotSaved)
  }

  function endSession(repoId: string): void {
    closeSession()
    noLongerWaiting()
    drafts.clear(repoId)
  }

  /**
   * What was last said about a saved merge that couldn't be shown yet (its branch isn't checked
   * out, say). It is taken back once that merge is on screen again, or gone.
   */
  let waitingNotice: { message: string; about: ReportOptions } | null = null

  function noLongerWaiting(): void {
    if (waitingNotice !== null) report.retract(waitingNotice.message, waitingNotice.about)
    waitingNotice = null
  }

  /**
   * The repository is being taken off the list. If it is ever added again it is a new one to the
   * app, so nothing could use what is saved for it: it would only sit in storage, taking up room.
   */
  function forgetSavedMerge(repoId: string): void {
    drafts.clear(repoId)
    if (host.repository.value?.id === repoId) noLongerWaiting()
  }

  /** Takes the merge off the screen, leaving whatever is saved of it. A warning about it goes with it. */
  function closeSession(): void {
    mergeSession.value = null
    if (toldNotSaved) report.retract(MERGE_NOT_SAVED, toldNotSaved)
    toldNotSaved = null
  }

  /**
   * What can be merged into the checked-out branch: other local branches, then remote ones. A merge
   * names its branch as the branch list does, and a name that is both a local branch and a remote
   * one ('origin/main' made by hand) means the local branch, as it does to git: it is offered once.
   */
  const mergeableBranches = computed(() => {
    const { local, remote } = host.branches.value
    const localNames = local.map((branch) => branch.name)
    const remoteOnly = remote.map((branch) => branch.name).filter((name) => !localNames.includes(name))
    return [...localNames.filter((name) => name !== host.currentBranch.value), ...remoteOnly]
  })

  const mergePreview = previewLoad.value
  const mergeChecking = previewLoad.loading
  /** Why the previewed merge can't go ahead, or null. */
  const mergeBlocked = computed(() => (mergePreview.value ? mergeRefusal(mergePreview.value) : null))

  const mergeFile = computed(() => {
    const session = mergeSession.value
    return session?.files.find((file) => file.path === session.path) ?? null
  })
  const mergeConflictsLeft = computed(() => (mergeSession.value?.files ?? []).reduce((left, file) => left + conflictsLeftIn(file), 0))

  // ---- the dialog ----

  /** There is a branch to merge into, nothing else is running, and no merge is already being resolved. */
  function dialogMayOpen(): boolean {
    return Boolean(host.repository.value && host.currentBranch.value && !host.operationRunning.value && !mergeSession.value)
  }

  function openMergeDialog(): void {
    if (!dialogMayOpen()) return
    previewLoad.clear()
    mergeDialog.value = { fromPull: false, branch: null, problem: null, waiting: waitingMerge() }
  }

  /** No merge is on screen when the dialog opens, so one that is saved is waiting for its branch. */
  function waitingMerge(): WaitingMerge | null {
    const repo = host.repository.value
    const saved = repo ? drafts.load(repo.id) : null
    return saved ? { branch: saved.request.branch, into: saved.request.into } : null
  }

  /** Pull found both sides have new commits: offers to merge the upstream, already picked. */
  async function offerMerge(upstream: string): Promise<void> {
    if (!dialogMayOpen()) return
    mergeDialog.value = { fromPull: true, branch: null, problem: null, waiting: waitingMerge() }
    await chooseMergeBranch(upstream)
  }

  function closeMergeDialog(): void {
    if (host.operationRunning.value) return
    endDialog()
    // A saved merge the open dialog kept off screen can come back now, if it is able to continue.
    const repo = host.repository.value
    if (repo) void resumeSavedMerge(repo, { quietly: true })
  }

  /** Works out what merging the branch would do. Changes nothing, so it runs as soon as one is picked. */
  async function chooseMergeBranch(branch: string): Promise<void> {
    const repo = host.repository.value
    const dialog = mergeDialog.value
    if (!repo || !dialog) return
    mergeDialog.value = { ...dialog, branch, problem: null }
    await previewLoad.run(
      () => source.previewMerge(repo.id, branch),
      (error) => setDialogProblem(errorMessage(error)),
    )
  }

  function setDialogProblem(problem: string): void {
    if (mergeDialog.value) mergeDialog.value = { ...mergeDialog.value, problem }
  }

  /**
   * The dialog's Merge button: a clean merge completes now; conflicts open the resolver first. That
   * would save this merge over one that is waiting, so the user is asked before that happens.
   */
  async function startMerge(): Promise<void> {
    const preview = mergePreview.value
    if (!preview || mergeRefusal(preview)) return
    if (preview.conflicts.length > 0 && mergeDialog.value?.waiting) mergeReplacePending.value = true
    else await runMerge(preview)
  }

  /** The user agreed to drop the waiting merge's choices for the one they are starting. */
  async function confirmReplaceMerge(): Promise<void> {
    const preview = mergePreview.value
    if (!mergeReplacePending.value || !preview) return
    mergeReplacePending.value = false
    await runMerge(preview)
  }

  /** Back to the dialog, with the waiting merge untouched. */
  function cancelReplaceMerge(): void {
    mergeReplacePending.value = false
  }

  async function runMerge(preview: MergePreview): Promise<void> {
    await host.runOperation('merge', 'Merging…', async (repo) => {
      try {
        await host.refreshFinished()
        if (preview.conflicts.length > 0) await openResolver(repo, preview)
        else await finishCleanMerge(repo, preview)
      } catch (error) {
        const reason = errorMessage(error)
        // The dialog stays open with the reason, and that is where the user is looking.
        report.failure(`Failed: ${reason}`, { alreadyShown: true })
        setDialogProblem(reason)
      }
    })
  }

  async function finishCleanMerge(repo: Repository, preview: MergePreview): Promise<void> {
    const { message } = await source.merge(repo.id, requestOf(preview), [])
    endDialog()
    report.info(message)
    await host.reload()
  }

  async function openResolver(repo: Repository, preview: MergePreview): Promise<void> {
    const files = await conflictFiles(repo, preview)
    if (!stillOpen(repo)) return
    setSession(repo.id, sessionFor(preview, files, files[0]?.path ?? ''))
    endDialog()
    const conflicts = files.reduce((total, file) => total + conflictsLeftIn(file), 0)
    report.info(`${pluralize(conflicts, 'conflict', 'conflicts')} to resolve in ${pluralize(files.length, 'file', 'files')} · ${NOTHING_ON_DISK}`)
  }

  async function conflictFiles(repo: Repository, preview: MergePreview): Promise<MergeFile[]> {
    return (await source.getMergeConflicts(repo.id, requestOf(preview))).map(toMergeFile)
  }

  function sessionFor(preview: MergePreview, files: MergeFile[], path: string): MergeSession {
    return { request: requestOf(preview), into: preview.into, commits: preview.commits, files, path }
  }

  function endDialog(): void {
    mergeDialog.value = null
    mergeReplacePending.value = false
    previewLoad.clear()
  }

  // ---- picking a merge back up ----

  function stillOpen(repo: Repository): boolean {
    return host.repository.value?.id === repo.id
  }

  /**
   * A merge left unfinished in this repository comes back, with the user's choices. Whatever stands
   * in the way for now (another branch checked out, a detached HEAD) leaves it saved: their work is
   * only ever dropped by them, or when there's nothing left it could apply to. `quietly`: a
   * refresh looking for it, which says nothing if it can't continue yet.
   */
  async function resumeSavedMerge(repo: Repository, { quietly = false } = {}): Promise<void> {
    // A refresh can finish after another repository was opened: the branches on screen are then
    // that one's, and say nothing about this repository's saved merge.
    if (!stillOpen(repo)) return
    if (mergeSession.value || mergeDialog.value) return
    const draft = drafts.load(repo.id)
    if (!draft) return
    const { branch, into } = draft.request
    const say = (message: string) => {
      if (quietly) return
      waitingNotice = { message, about: about(repo) }
      report.notice(message, waitingNotice.about)
    }
    const { local, remote } = host.branches.value
    const listed = [...local, ...remote]
    if (listed.length > 0 && !listed.some((candidate) => candidate.name === branch)) {
      drafts.clear(repo.id)
      noLongerWaiting()
      report.warn(`Your merge of ${branch} was dropped: that branch no longer exists`, about(repo))
      return
    }
    const waitingForBranch = `Your merge of ${branch} into ${into} is waiting: check out ${into} to continue it`
    if (repo.currentBranch !== into) return say(waitingForBranch)
    if (waitingNotice?.message === waitingForBranch) noLongerWaiting()
    try {
      const preview = await source.previewMerge(repo.id, branch)
      // The dialog may have been opened while git was answering: it wins, and the merge stays waiting.
      if (!stillOpen(repo) || mergeSession.value || mergeDialog.value) return
      if (preview.ours === draft.request.ours && preview.theirs === draft.request.theirs) {
        mergeSession.value = draft
        noLongerWaiting()
        report.info(`Continuing your merge of ${branch} into ${into} · ${NOTHING_ON_DISK}`)
      } else await workOutAgain(repo, draft, preview)
    } catch (error) {
      say(`Couldn’t continue your merge of ${branch} yet: ${errorMessage(error)}. Your choices are saved`)
    }
  }

  /** A branch moved under a merge being resolved: the merge is redone, keeping what still applies. */
  async function workOutAgain(repo: Repository, earlier: MergeSession, preview: MergePreview): Promise<void> {
    const { branch, into } = earlier.request
    if (preview.into !== into) {
      report.warn(`${preview.into} is checked out now: check out ${into} to finish this merge, or discard it`, about(repo))
      return
    }
    if (preview.outcome === 'up-to-date') {
      endSession(repo.id)
      report.notice(`${into} already has every commit on ${branch}, so there is nothing left to merge`, about(repo))
      return
    }
    const refusal = mergeRefusal(preview)
    if (refusal) {
      // Possibly temporary (a file to commit, say): the merge stays open, and Complete tries again.
      mergeSession.value = earlier
      report.warn(`This merge can’t continue yet: ${refusal}. Your choices are kept`, about(repo))
      return
    }
    if (preview.conflicts.length === 0) {
      endSession(repo.id)
      report.notice(`${branch} no longer conflicts with ${into}: start the merge again from Merge…`, about(repo))
      return
    }
    // Two looks at one saved merge can overlap (opening the repository, then a refresh). The first to
    // finish puts the merge on screen, where choices can be made at once: the other mustn't replace it.
    const onScreen = mergeSession.value
    const { files, changed } = carryChoices(earlier.files, await conflictFiles(repo, preview))
    if (!stillOpen(repo) || mergeDialog.value || mergeSession.value !== onScreen) return
    const path = files.some((file) => file.path === earlier.path) ? earlier.path : (files[0]?.path ?? '')
    setSession(repo.id, sessionFor(preview, files, path))
    report.notice(
      `A branch moved, so the merge was worked out again: ${pluralize(changed, 'file needs', 'files need')} another look · ${NOTHING_ON_DISK}`,
      about(repo),
    )
  }

  // ---- resolving ----

  function selectMergeFile(path: string): void {
    const session = mergeSession.value
    const repo = host.repository.value
    if (repo && session?.files.some((file) => file.path === path)) setSession(repo.id, { ...session, path })
  }

  /** Applies a change to the file on screen. */
  function changeFile(change: (file: MergeFile) => MergeFile): void {
    const session = mergeSession.value
    const repo = host.repository.value
    // While Complete runs, what it sent is what counts: a change now would be lost or, worse, half-applied.
    if (!session || !repo || host.operationRunning.value) return
    setSession(repo.id, { ...session, files: session.files.map((file) => (file.path === session.path ? change(file) : file)) })
    const left = mergeConflictsLeft.value
    report.info(`${left > 0 ? `${pluralize(left, 'conflict', 'conflicts')} left` : 'All conflicts resolved'} · ${NOTHING_ON_DISK}`)
  }

  function toggleMergeSide(chunkIndex: number, side: MergeSide): void {
    changeFile((file) => toggleSide(file, chunkIndex, side))
  }

  function useNeitherMergeSide(chunkIndex: number): void {
    changeFile((file) => useNeitherSide(file, chunkIndex))
  }

  function reopenMergeConflict(chunkIndex: number): void {
    changeFile((file) => reopenConflict(file, chunkIndex))
  }

  function editMergeConflict(chunkIndex: number, text: string): void {
    changeFile((file) => editConflict(file, chunkIndex, text))
  }

  /** The user's own "I've checked this file": nothing is staged, and Complete merge doesn't need it. */
  function markMergeFileResolved(): void {
    changeFile((file) => (conflictsLeftIn(file) === 0 ? { ...file, marked: true } : file))
    const path = mergeFile.value?.marked ? mergeFile.value.path : null
    if (path) report.info(`Marked ${path} as resolved. Nothing is staged or written: this only tracks your progress`)
  }

  // ---- finishing ----

  /** Commits the result and moves the branch: only now do files change. A failure keeps every choice. */
  async function completeMerge(): Promise<void> {
    const session = mergeSession.value
    if (!session || mergeConflictsLeft.value > 0) return
    await host.runOperation('merge', 'Merging…', async (repo) => {
      try {
        await host.refreshFinished()
        const resolutions = session.files.map((file) => ({ path: file.path, text: resultText(file) }))
        const { message } = await source.merge(repo.id, session.request, resolutions)
        endSession(repo.id)
        report.info(message)
        await host.reload()
      } catch (error) {
        await explainFailedCompletion(repo, session, error)
      }
    })
  }

  async function explainFailedCompletion(repo: Repository, session: MergeSession, error: unknown): Promise<void> {
    const reason = errorMessage(error)
    if (!reason.includes(MOVED_SINCE)) {
      report.failure(`Failed: ${reason}`, about(repo))
      return
    }
    try {
      await workOutAgain(repo, session, await source.previewMerge(repo.id, session.request.branch))
    } catch (again) {
      report.failure(`Failed: ${errorMessage(again)}`, about(repo))
    }
  }

  /** Leaves the merge. Asks first only if that would throw away a decision. */
  function discardMerge(): void {
    if (host.operationRunning.value) return
    const decided = mergeSession.value?.files.some((file) => conflictsIn(file).some(isResolved)) ?? false
    if (decided) mergeDiscardPending.value = true
    else dropSession()
  }

  function confirmDiscardMerge(): void {
    if (mergeDiscardPending.value) dropSession()
  }

  function cancelDiscardMerge(): void {
    mergeDiscardPending.value = false
  }

  function dropSession(): void {
    mergeDiscardPending.value = false
    const repo = host.repository.value
    if (repo) endSession(repo.id)
    else closeSession()
    report.info('Merge discarded; nothing changed')
  }

  /** Another repository is being opened: nothing on screen applies to it. A saved merge stays saved. */
  function resetMerge(): void {
    endDialog()
    closeSession()
    // What was said about a merge waiting in the repository being left still holds, and says where.
    waitingNotice = null
    mergeDiscardPending.value = false
  }

  return {
    mergeDialog,
    mergeableBranches,
    mergePreview,
    mergeChecking,
    mergeBlocked,
    mergeSession,
    mergeFile,
    mergeConflictsLeft,
    mergeDiscardPending,
    mergeReplacePending,
    openMergeDialog,
    offerMerge,
    closeMergeDialog,
    chooseMergeBranch,
    startMerge,
    confirmReplaceMerge,
    cancelReplaceMerge,
    selectMergeFile,
    toggleMergeSide,
    useNeitherMergeSide,
    reopenMergeConflict,
    editMergeConflict,
    markMergeFileResolved,
    completeMerge,
    discardMerge,
    confirmDiscardMerge,
    cancelDiscardMerge,
    resetMerge,
    resumeSavedMerge,
    forgetSavedMerge,
  }
}

/** Only what identifies the merge (a preview has more fields, and may be a reactive proxy). */
function requestOf({ branch, into, ours, theirs }: MergePreview): MergeRequest {
  return { branch, into, ours, theirs }
}
