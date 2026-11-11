<script setup lang="ts">
import { computed } from 'vue'
import type { Commit, FileChange, Hunk } from '@/types/git'
import type { DiffMode } from '@/composables/useGitManager'
import { splitPath } from '@/lib/format'
import GmIcon from '../GmIcon.vue'
import ChangedFileList from './ChangedFileList.vue'
import ComparePathInputs from './ComparePathInputs.vue'
import DiffModeToggle from './DiffModeToggle.vue'
import SideBySideDiff from './SideBySideDiff.vue'
import UnifiedDiff from './UnifiedDiff.vue'

const props = defineProps<{
  commit: Commit
  files: FileChange[]
  filesLoading: boolean
  diffLoading: boolean
  selectedFileIndex: number
  compareOpen: boolean
  diffMode: DiffMode
  hunks: Hunk[]
  leftPath: string
  rightPath: string
}>()

const emit = defineEmits<{
  selectFile: [index: number]
  setDiffMode: [mode: DiffMode]
  openCompare: []
  closeCompare: []
  'update:leftPath': [path: string]
  'update:rightPath': [path: string]
  swap: []
}>()

const file = computed<FileChange | undefined>(
  () => props.files[Math.min(props.selectedFileIndex, props.files.length - 1)],
)

const leftLabel = computed(() => {
  if (props.compareOpen) return splitPath(props.leftPath).name
  if (!file.value || file.value.status === 'A') return '(new file)'
  return `${splitPath(file.value.path).name} @ ${props.commit.hash}^`
})

const rightLabel = computed(() => {
  if (props.compareOpen) return splitPath(props.rightPath).name
  return file.value ? `${splitPath(file.value.path).name} @ ${props.commit.hash}` : ''
})

const toolbarButton =
  'inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-gm-line-strong bg-gm-raised px-3 text-gm-text hover:bg-gm-hover'
</script>

<template>
  <section
    aria-label="Diff viewer"
    class="flex min-h-0 flex-[0_0_400px] flex-col border-t border-gm-line-strong bg-gm-sidebar max-[860px]:flex-none"
  >
    <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-gm-line px-4 py-2">
      <template v-if="!compareOpen">
        <h2 class="m-0 min-w-0 truncate text-[13px] font-semibold">
          Changes in
          <span class="font-mono font-medium text-gm-ref-local-text">{{ commit.hash }}</span>
          · {{ commit.message }}
        </h2>
        <button type="button" :class="toolbarButton" class="ml-auto" @click="emit('openCompare')">
          <GmIcon name="compare" :size="15" />
          Compare two files…
        </button>
      </template>
      <template v-else>
        <h2 class="m-0 text-[13px] font-semibold">Compare two files</h2>
        <button type="button" :class="toolbarButton" class="ml-auto" @click="emit('closeCompare')">
          <GmIcon name="back" :size="15" />
          Back to {{ commit.hash }}
        </button>
      </template>
    </div>

    <div class="flex min-h-0 flex-auto flex-wrap">
      <ChangedFileList
        v-if="!compareOpen"
        :files="files"
        :loading="filesLoading"
        :selected-index="selectedFileIndex"
        @select="emit('selectFile', $event)"
      />

      <div class="flex h-full min-w-0 flex-[999_1_480px] flex-col">
        <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-gm-line px-3 py-2">
          <span v-if="!compareOpen" class="min-w-0 truncate font-mono text-[12px] text-gm-soft">{{ file?.path }}</span>
          <ComparePathInputs
            v-else
            :left-path="leftPath"
            :right-path="rightPath"
            @update:left-path="emit('update:leftPath', $event)"
            @update:right-path="emit('update:rightPath', $event)"
            @swap="emit('swap')"
          />
          <div class="ml-auto flex flex-wrap items-center gap-2.5">
            <span v-if="compareOpen" class="max-w-[220px] text-[11px] text-gm-muted">
              Git diff compares one file across revisions, so it isn’t available for two separate files.
            </span>
            <DiffModeToggle :mode="diffMode" :git-disabled="compareOpen" @change="emit('setDiffMode', $event)" />
          </div>
        </div>

        <div
          class="min-h-0 flex-auto overflow-auto bg-gm-code font-mono text-[12px] leading-5 max-[860px]:max-h-[440px]"
        >
          <p v-if="(filesLoading || diffLoading) && !compareOpen" class="m-0 px-4 py-3 font-sans text-gm-muted">Loading diff…</p>
          <UnifiedDiff v-else-if="diffMode === 'git'" :hunks="hunks" />
          <SideBySideDiff v-else :hunks="hunks" :left-label="leftLabel" :right-label="rightLabel" />
        </div>
      </div>
    </div>
  </section>
</template>
