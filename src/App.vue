<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRaw } from 'vue'
import type { GitDataSource } from '@/services/GitDataSource'
import { useGitManager } from '@/composables/useGitManager'
import { useNow } from '@/composables/useNow'
import AppHeader from '@/components/AppHeader.vue'
import BranchList from '@/components/BranchList.vue'
import CommitHistory from '@/components/CommitHistory.vue'
import NoRepositories from '@/components/NoRepositories.vue'
import RepositoryList from '@/components/RepositoryList.vue'
import StatusBar from '@/components/StatusBar.vue'
import DiffPanel from '@/components/diff/DiffPanel.vue'

const props = withDefaults(
  defineProps<{
    source: GitDataSource
    comparePaths: { left: string; right: string }
    /** Overrides the accent colour (default #5B9DFF). */
    accent?: string
    /** False hides Fetch, Pull, Push and Checkout: the desktop app reads real repositories but can't change them yet. */
    writable?: boolean
  }>(),
  { writable: true },
)

const {
  repositories,
  loading,
  status,
  selectedBranch,
  selectedCommitIndex,
  selectedFileIndex,
  compareOpen,
  leftPath,
  rightPath,
  historyLoading,
  filesLoading,
  diffLoading,
  repository,
  branches,
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
  load,
  selectRepository,
  selectBranch,
  selectCommit,
  selectFile,
  setDiffMode,
  openCompare,
  closeCompare,
  setLeftPath,
  setRightPath,
  swapComparePaths,
  checkoutBranch,
  fetchRemote,
  pull,
  push,
  addRepository,
  removeRepository,
  refresh,
  // The data source is a service, not state: unwrap it in case a parent passed it in reactive props.
} = useGitManager(toRaw(props.source), { comparePaths: props.comparePaths })

/** Date labels ('Today 11:42', '12 min ago') are formatted against this, so they stay right while the app is open. */
const now = useNow()

/** Once the history has loaded, the diff panel says why there's no commit to show ('No commits yet'). */
const diffEmptyMessage = computed(() => (historyLoading.value ? '' : (historyMessage.value ?? '')))

const accentStyle = computed(() => (props.accent ? { '--color-gm-accent': props.accent } : {}))

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
    :style="accentStyle"
  >
    <template v-if="repository">
      <AppHeader
        :repo-name="repository.name"
        :current-branch="headLabel"
        :sync-label="headerSyncLabel"
        :writable="writable"
        @fetch="fetchRemote"
        @pull="pull"
        @push="push"
      />

      <!--
        Wraps only on narrow screens, where the page scrolls. A wrapping row takes its height from its content,
        so on the desktop it must not wrap: the panes get the window's height and scroll inside themselves.
      -->
      <div class="flex min-h-0 flex-auto max-[860px]:flex-wrap">
        <nav
          aria-label="Repositories and branches"
          class="flex min-w-0 flex-[1_1_260px] flex-col border-r border-gm-line bg-gm-sidebar"
        >
          <RepositoryList
            :repositories="repositories"
            :selected-id="repository.id"
            @select="selectRepository"
            @add="addRepository"
            @remove="removeRepository"
          />
          <BranchList
            :local-branches="branches.local"
            :remote-branches="branches.remote"
            :current-branch="currentBranch"
            :selected-branch="selectedBranch"
            :writable="writable"
            @select="selectBranch"
            @checkout="checkoutBranch"
          />
        </nav>

        <main class="flex min-w-0 flex-[999_1_560px] flex-col bg-gm-main">
          <CommitHistory
            :commits="commits"
            :has-more="historyHasMore"
            :message="historyMessage"
            :selected-index="selectedCommitIndex"
            :current-branch="currentBranch"
            :now="now"
            @select="selectCommit"
          />
          <DiffPanel
            :commit="commit"
            :empty-message="diffEmptyMessage"
            :files="files"
            :files-loading="filesLoading"
            :diff-loading="diffLoading"
            :selected-file-index="selectedFileIndex"
            :compare-open="compareOpen"
            :diff-mode="diffMode"
            :hunks="activeHunks"
            :left-path="leftPath"
            :right-path="rightPath"
            @select-file="selectFile"
            @set-diff-mode="setDiffMode"
            @open-compare="openCompare"
            @close-compare="closeCompare"
            @update:left-path="setLeftPath"
            @update:right-path="setRightPath"
            @swap="swapComparePaths"
          />
        </main>
      </div>

      <StatusBar
        :status="status"
        :repo-name="repository.name"
        :current-branch="headLabel"
        :last-fetch="repository.lastFetch"
        :now="now"
      />
    </template>

    <template v-else-if="!loading && repositories.length === 0">
      <NoRepositories @add="addRepository" />
      <StatusBar :status="status" :now="now" />
    </template>

    <div v-else class="flex flex-auto items-center justify-center text-gm-muted" role="status">
      {{ loading ? 'Loading repositories…' : status }}
    </div>
  </div>
</template>
