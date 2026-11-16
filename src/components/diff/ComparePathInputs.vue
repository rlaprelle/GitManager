<script setup lang="ts">
import type { CompareChoice } from '@/composables/useGitManager'
import GmIcon from '../GmIcon.vue'
import CompareSidePicker from './CompareSidePicker.vue'

/** Everything the two sides of a comparison show and offer. */
export interface CompareView {
  leftSide: CompareChoice
  rightSide: CompareChoice
  leftBranches: string[]
  rightBranches: string[]
  repositories: { id: string; name: string }[]
  openRepoId: string
  canChooseFiles: boolean
}

defineProps<{ view: CompareView }>()

const emit = defineEmits<{
  path: [which: 'left' | 'right', path: string]
  repository: [which: 'left' | 'right', repoId: string]
  branch: [which: 'left' | 'right', branch: string | null]
  chooseFile: [which: 'left' | 'right']
  browseBranch: [which: 'left' | 'right']
  swap: []
}>()
</script>

<template>
  <div class="flex min-w-0 flex-[1_1_480px] flex-wrap items-end gap-2">
    <CompareSidePicker
      which="left"
      heading="Left file"
      :side="view.leftSide"
      :repositories="view.repositories"
      :open-repo-id="view.openRepoId"
      :branches="view.leftBranches"
      :can-choose-files="view.canChooseFiles"
      @path="emit('path', 'left', $event)"
      @repository="emit('repository', 'left', $event)"
      @branch="emit('branch', 'left', $event)"
      @choose-file="emit('chooseFile', 'left')"
      @browse-branch="emit('browseBranch', 'left')"
    />
    <button
      type="button"
      aria-label="Swap left and right files"
      class="mb-0 inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-md border border-gm-line-strong bg-gm-raised text-gm-text hover:bg-gm-hover"
      @click="emit('swap')"
    >
      <GmIcon name="swap" :size="15" />
    </button>
    <CompareSidePicker
      which="right"
      heading="Right file"
      :side="view.rightSide"
      :repositories="view.repositories"
      :open-repo-id="view.openRepoId"
      :branches="view.rightBranches"
      :can-choose-files="view.canChooseFiles"
      @path="emit('path', 'right', $event)"
      @repository="emit('repository', 'right', $event)"
      @branch="emit('branch', 'right', $event)"
      @choose-file="emit('chooseFile', 'right')"
      @browse-branch="emit('browseBranch', 'right')"
    />
  </div>
</template>
