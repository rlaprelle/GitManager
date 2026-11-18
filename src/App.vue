<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRaw } from 'vue'
import { ALL_OPERATIONS, type GitDataSource, type RepositoryOperation } from '@/services/GitDataSource'
import { useGitManager } from '@/composables/useGitManager'
import { useNow } from '@/composables/useNow'
import { usePaneSizes } from '@/composables/usePaneSizes'
import { useUpdateNotice } from '@/composables/useUpdateNotice'
import type { UpdateSource } from '@/types/bridge'
import { PANE_LIMITS } from '@/lib/paneLayout'
import { pluralize } from '@/lib/format'
import { unfinishedMessage } from '@/lib/merge'
import AppHeader from '@/components/AppHeader.vue'
import BranchList from '@/components/BranchList.vue'
import CloneDialog from '@/components/CloneDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import CommitHistory from '@/components/CommitHistory.vue'
import MergeDialog from '@/components/MergeDialog.vue'
import MergeResolver from '@/components/merge/MergeResolver.vue'
import NoRepositories from '@/components/NoRepositories.vue'
import PaneDivider from '@/components/PaneDivider.vue'
import RepositoryList from '@/components/RepositoryList.vue'
import StatusBar from '@/components/StatusBar.vue'
import DiffPanel from '@/components/diff/DiffPanel.vue'
import BranchFileDialog from '@/components/diff/BranchFileDialog.vue'

const props = withDefaults(
  defineProps<{
    source: GitDataSource
    comparePaths: { left: string; right: string }
    /** Overrides the accent colour (default #5B9DFF). */
    accent?: string
    /** The operations that change a repository this host offers; the others' buttons are hidden. */
    operations?: readonly RepositoryOperation[]
    /** The installed desktop app's updates; the browser build has none. */
    updates?: UpdateSource
    /** The host has a file picker, so Compare can take any file on disk (the desktop app). */
    canChooseFiles?: boolean
  }>(),
  { operations: () => ALL_OPERATIONS, canChooseFiles: false },
)

const {
  repositories,
  loading,
  status,
  selectedBranch,
  selectedCommitIndex,
  selectedFileIndex,
  compareOpen,
  leftSide,
  rightSide,
  leftBranches,
  rightBranches,
  compareLabels,
  branchFilePicker,
  setComparePath,
  setCompareRepository,
  setCompareBranch,
  chooseCompareFile,
  openBranchFilePicker,
  pickBranchFile,
  closeBranchFilePicker,
  historyLoading,
  loadingMoreHistory,
  runningOperation,
  operationRunning,
  pendingCheckout,
  filesLoading,
  diffLoading,
  repository,
  branches,
  checkoutableRemotes,
  remoteBranchNames,
  commits,
  historyHasMore,
  commit,
  files,
  currentBranch,
  headLabel,
  headerSyncLabel,
  historyMessage,
  diffMode,
  activeHunks,
  diffMessage,
  load,
  selectRepository,
  selectBranch,
  selectCommit,
  selectFile,
  setDiffMode,
  openCompare,
  closeCompare,
  swapComparePaths,
  checkoutBranch,
  checkoutRemoteBranch,
  confirmCheckout,
  cancelCheckout,
  fetchRemote,
  pull,
  push,
  addRepository,
  removeRepository,
  cloneDialogOpen,
  cloneFolder,
  cloneProgress,
  cloneError,
  openCloneDialog,
  closeCloneDialog,
  chooseCloneFolder,
  cloneRepository,
  cancelClone,
  refresh,
  showMoreHistory,
  unfinishedOperation,
  mergeDialog,
  mergeableBranches,
  mergePreview,
  mergeChecking,
  mergeBlocked,
  mergeSession,
  mergeFile,
  mergeConflictsLeft,
  mergeDiscardPending,
  openMergeDialog,
  closeMergeDialog,
  chooseMergeBranch,
  startMerge,
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
  // The data source is a service, not state: unwrap it in case a parent passed it in reactive props.
} = useGitManager(toRaw(props.source), { comparePaths: props.comparePaths, canMerge: props.operations.includes('merge') })

const updateNotice = useUpdateNotice(props.updates)

/** Date labels ('Today 11:42', '12 min ago') are formatted against this, so they stay right while the app is open. */
const now = useNow()

/** Once the history has loaded, the diff panel says why there's no commit to show ('No commits yet'). */
const diffEmptyMessage = computed(() => (historyLoading.value ? '' : (historyMessage.value ?? '')))

const canCheckout = computed(() => props.operations.includes('checkout'))
const canClone = computed(() => props.operations.includes('clone'))

const compareView = computed(() => ({
  leftSide: leftSide.value,
  rightSide: rightSide.value,
  leftBranches: leftBranches.value,
  rightBranches: rightBranches.value,
  repositories: repositories.value.filter((repo) => repo.problem === null).map(({ id, name }) => ({ id, name })),
  openRepoId: repository.value?.id ?? '',
  canChooseFiles: props.canChooseFiles,
}))

const pendingCommits = computed(() => pluralize(pendingCheckout.value?.commitsLeft ?? 0, 'commit', 'commits'))

const accentStyle = computed(() => (props.accent ? { '--color-gm-accent': props.accent } : {}))

/** Sizes the user dragged the panes to; published as CSS variables on the root for the panes below. */
const { sizes: paneSizes, paneVars, setPaneSize, resetPaneSize } = usePaneSizes()
const rootStyle = computed(() => ({ ...accentStyle.value, ...paneVars.value }))

/*
 * A dragged size applies at desktop width only (narrow screens stack the panes) and overrides the pane's
 * own flex sizing (!). min() keeps a size remembered from a bigger window from crowding out the neighbour:
 * the subtracted px are PANE_LIMITS' reserves.
 */
const sizedSidebar = 'min-[860px]:flex-[0_0_min(var(--gm-sidebar-size),calc(100%_-_720px))]!'
const sizedRepositories =
  'min-[860px]:flex-[0_0_var(--gm-repositories-size)]! min-[860px]:max-h-[calc(100%_-_140px)]!'
const sizedDiff = 'min-[860px]:flex-[0_0_min(var(--gm-diff-size),calc(100%_-_220px))]!'

// Changes made outside the app (a commit, a branch switch, an edited file) show up when the
// window regains focus, quietly, or on F5, which also says so in the status bar.
function refreshOnFocus(): void {
  void refresh()
}

function refreshOnF5(event: KeyboardEvent): void {
  if (event.key !== 'F5') return
  event.preventDefault()
  void refresh({ announce: true })
}

onMounted(() => {
  void load()
  window.addEventListener('focus', refreshOnFocus)
  window.addEventListener('keydown', refreshOnF5)
})

onUnmounted(() => {
  window.removeEventListener('focus', refreshOnFocus)
  window.removeEventListener('keydown', refreshOnF5)
})
</script>

<template>
  <div
    class="flex h-screen min-h-[640px] flex-col overflow-hidden bg-gm-window font-sans text-[13px] text-gm-text max-[860px]:h-auto"
    :style="rootStyle"
  >
    <template v-if="repository">
      <AppHeader
        :repo-name="repository.name"
        :current-branch="headLabel"
        :sync-label="headerSyncLabel"
        :operations="operations"
        :running="runningOperation"
        :locked="mergeSession !== null"
        :can-merge="currentBranch !== ''"
        @fetch="fetchRemote"
        @pull="pull"
        @merge="openMergeDialog"
        @push="push"
      />

      <p
        v-if="unfinishedOperation"
        class="m-0 flex-none border-b border-gm-line bg-gm-warn-bg px-4 py-1.5 text-[12px] text-gm-warn"
        role="note"
        data-testid="unfinished-operation"
      >
        {{ unfinishedMessage(unfinishedOperation) }}
      </p>

      <!-- While a merge is being resolved it takes over from the panes below; Discard or Complete brings them back. -->
      <MergeResolver
        v-if="mergeSession && mergeFile"
        :session="mergeSession"
        :file="mergeFile"
        :conflicts-left="mergeConflictsLeft"
        :completing="runningOperation === 'merge'"
        @select-file="selectMergeFile"
        @toggle="toggleMergeSide"
        @neither="useNeitherMergeSide"
        @reopen="reopenMergeConflict"
        @edit="editMergeConflict"
        @mark="markMergeFileResolved"
        @discard="discardMerge"
        @complete="completeMerge"
      />

      <!--
        Wraps only on narrow screens, where the page scrolls. A wrapping row takes its height from its content,
        so on the desktop it must not wrap: the panes get the window's height and scroll inside themselves.
      -->
      <div v-else class="flex min-h-0 flex-auto max-[860px]:flex-wrap">
        <nav
          aria-label="Repositories and branches"
          class="flex min-w-0 flex-[1_1_260px] flex-col border-r border-gm-line bg-gm-sidebar"
          :class="paneSizes.sidebar !== null && sizedSidebar"
        >
          <RepositoryList
            :class="paneSizes.repositories !== null && sizedRepositories"
            :repositories="repositories"
            :selected-id="repository.id"
            :can-clone="canClone"
            @select="selectRepository"
            @add="addRepository"
            @clone="openCloneDialog"
            @remove="removeRepository"
          />
          <PaneDivider
            orientation="horizontal"
            controls="previous"
            :min="PANE_LIMITS.repositories.min"
            :reserve="PANE_LIMITS.repositories.reserve"
            label="Resize the repository list"
            @resize="setPaneSize('repositories', $event)"
            @reset="resetPaneSize('repositories')"
          />
          <BranchList
            :local-branches="branches.local"
            :remote-branches="branches.remote"
            :current-branch="currentBranch"
            :selected-branch="selectedBranch"
            :can-checkout="canCheckout"
            :checkoutable-remotes="checkoutableRemotes"
            :busy="operationRunning"
            :switching="runningOperation === 'checkout'"
            @select="selectBranch"
            @checkout="checkoutBranch"
            @checkout-remote="checkoutRemoteBranch"
          />
        </nav>

        <PaneDivider
          orientation="vertical"
          controls="previous"
          :min="PANE_LIMITS.sidebar.min"
          :reserve="PANE_LIMITS.sidebar.reserve"
          label="Resize the sidebar"
          @resize="setPaneSize('sidebar', $event)"
          @reset="resetPaneSize('sidebar')"
        />

        <main class="flex min-w-0 flex-[999_1_560px] flex-col bg-gm-main">
          <CommitHistory
            :commits="commits"
            :has-more="historyHasMore"
            :loading-more="loadingMoreHistory"
            :message="historyMessage"
            :selected-index="selectedCommitIndex"
            :current-branch="currentBranch"
            :remote-branch-names="remoteBranchNames"
            :now="now"
            @select="selectCommit"
            @show-more="showMoreHistory"
          />
          <PaneDivider
            orientation="horizontal"
            controls="next"
            :min="PANE_LIMITS.diff.min"
            :reserve="PANE_LIMITS.diff.reserve"
            label="Resize the diff panel"
            @resize="setPaneSize('diff', $event)"
            @reset="resetPaneSize('diff')"
          />
          <DiffPanel
            :class="paneSizes.diff !== null && sizedDiff"
            :file-list-sized="paneSizes.fileList !== null"
            :commit="commit"
            :empty-message="diffEmptyMessage"
            :files="files"
            :files-loading="filesLoading"
            :diff-loading="diffLoading"
            :selected-file-index="selectedFileIndex"
            :compare-open="compareOpen"
            :diff-mode="diffMode"
            :hunks="activeHunks"
            :diff-message="diffMessage"
            :compare-view="compareView"
            :compare-labels="compareLabels"
            @select-file="selectFile"
            @set-diff-mode="setDiffMode"
            @open-compare="openCompare"
            @close-compare="closeCompare"
            @compare-path="setComparePath"
            @compare-repository="setCompareRepository"
            @compare-branch="setCompareBranch"
            @choose-compare-file="chooseCompareFile"
            @browse-branch-files="openBranchFilePicker"
            @swap="swapComparePaths"
            @resize-file-list="setPaneSize('fileList', $event)"
            @reset-file-list="resetPaneSize('fileList')"
          />
        </main>
      </div>

      <ConfirmDialog
        :open="pendingCheckout !== null"
        :title="`Leave ${pendingCommits} behind?`"
        confirm-label="Switch anyway"
        @confirm="confirmCheckout"
        @cancel="cancelCheckout"
      >
        HEAD is detached, and {{ pendingCommits }} on it {{ pendingCheckout?.commitsLeft === 1 ? 'isn’t' : 'aren’t' }}
        on any branch. After switching to <span class="font-mono text-gm-text">{{ pendingCheckout?.destination }}</span>, only
        git’s reflog will still have {{ pendingCheckout?.commitsLeft === 1 ? 'it' : 'them' }}, and only for a while.
        To keep {{ pendingCheckout?.commitsLeft === 1 ? 'it' : 'them' }}, create a branch first.
      </ConfirmDialog>

      <MergeDialog
        :state="mergeDialog"
        :into="currentBranch"
        :branches="mergeableBranches"
        :preview="mergePreview"
        :checking="mergeChecking"
        :blocked="mergeBlocked"
        :merging="runningOperation === 'merge'"
        @choose="chooseMergeBranch"
        @merge="startMerge"
        @close="closeMergeDialog"
      />

      <ConfirmDialog
        :open="mergeDiscardPending"
        title="Discard this merge?"
        confirm-label="Discard merge"
        @confirm="confirmDiscardMerge"
        @cancel="cancelDiscardMerge"
      >
        The choices you made are dropped. Nothing on disk has changed, so
        <span class="font-mono text-gm-text">{{ currentBranch }}</span> stays where it was.
      </ConfirmDialog>

      <StatusBar
        :status="status"
        :repo-name="repository.name"
        :current-branch="headLabel"
        :last-fetch="repository.lastFetch"
        :now="now"
        :update-version="updateNotice.readyVersion.value"
        :update-problem="updateNotice.problem.value"
        @install-update="updateNotice.install"
      />
    </template>

    <template v-else-if="!loading && repositories.length === 0">
      <NoRepositories :can-clone="canClone" @add="addRepository" @clone="openCloneDialog" />
      <StatusBar
        :status="status"
        :now="now"
        :update-version="updateNotice.readyVersion.value"
        :update-problem="updateNotice.problem.value"
        @install-update="updateNotice.install"
      />
    </template>

    <div v-else class="flex flex-auto items-center justify-center text-gm-muted" role="status">
      {{ loading ? 'Loading repositories…' : status }}
    </div>

    <BranchFileDialog
      :open="branchFilePicker !== null"
      :branch="branchFilePicker?.branch ?? ''"
      :files="branchFilePicker?.files ?? []"
      :loading="branchFilePicker?.loading ?? false"
      @pick="pickBranchFile"
      @close="closeBranchFilePicker"
    />

    <CloneDialog
      :open="cloneDialogOpen"
      :folder="cloneFolder"
      :cloning="runningOperation === 'clone'"
      :progress="cloneProgress"
      :error="cloneError"
      @choose-folder="chooseCloneFolder"
      @clone="cloneRepository"
      @close="closeCloneDialog"
      @cancel-clone="cancelClone"
    />
  </div>
</template>
