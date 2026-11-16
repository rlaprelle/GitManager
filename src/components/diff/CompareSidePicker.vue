<script setup lang="ts">
import { computed } from 'vue'
import type { CompareChoice } from '@/composables/useGitManager'

/**
 * One side of a comparison: which repository, which version of it (working tree or a branch), and which
 * file. Browse… looks inside git for a branch (the app's own list) or anywhere on disk for the working
 * tree (the host's file picker, where it has one).
 */
const props = defineProps<{
  which: 'left' | 'right'
  heading: string
  side: CompareChoice
  repositories: { id: string; name: string }[]
  openRepoId: string
  branches: string[]
  /** The host has a file picker (the desktop app). */
  canChooseFiles: boolean
}>()

const emit = defineEmits<{
  path: [path: string]
  repository: [repoId: string]
  branch: [branch: string | null]
  chooseFile: []
  browseBranch: []
}>()

// git branch names can be neither empty nor contain ':', so these can't be mistaken for a branch.
const WORKING_TREE = ''
const ON_DISK = ':on-disk'

const picked = computed(() => props.side.fileId !== null)
const versionValue = computed(() => (picked.value ? ON_DISK : (props.side.branch ?? WORKING_TREE)))
const offersBrowse = computed(() => props.side.branch !== null || props.canChooseFiles)

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function chooseVersion(event: Event): void {
  const value = valueOf(event)
  emit('branch', value === WORKING_TREE ? null : value)
}

function browse(): void {
  if (props.side.branch !== null) emit('browseBranch')
  else emit('chooseFile')
}

const select =
  'box-border h-8 min-w-0 flex-[1_1_0px] rounded-md border border-gm-line-input bg-gm-code px-2 text-[12px] text-gm-text'
</script>

<template>
  <!-- The heading labels the path box; the two lists carry their own names ('Left file: version'). -->
  <div class="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
    <label :for="`gm-${which}`" class="text-[11px] text-gm-muted">{{ heading }}</label>
    <div class="flex min-w-0 gap-1.5">
      <select
        :class="select"
        :aria-label="`${heading}: repository`"
        :value="picked ? openRepoId : (side.repoId ?? openRepoId)"
        :disabled="picked"
        @change="emit('repository', valueOf($event))"
      >
        <option v-for="repo in repositories" :key="repo.id" :value="repo.id">{{ repo.name }}</option>
      </select>
      <select :class="select" class="font-mono" :aria-label="`${heading}: version`" :value="versionValue" @change="chooseVersion">
        <option v-if="picked" :value="ON_DISK" disabled>File on disk</option>
        <option :value="WORKING_TREE">Working tree</option>
        <option v-for="branch in branches" :key="branch" :value="branch">{{ branch }}</option>
      </select>
    </div>
    <div class="flex min-w-0 gap-1.5">
      <!-- Commit on change (blur / Enter), not every keystroke: each change re-runs the comparison. -->
      <input
        :id="`gm-${which}`"
        type="text"
        class="box-border h-8 min-w-0 flex-auto rounded-md border border-gm-line-input bg-gm-code px-2.5 font-mono text-[12px] text-gm-text"
        :value="side.path"
        :title="side.path"
        spellcheck="false"
        @change="emit('path', valueOf($event))"
      />
      <button
        v-if="offersBrowse"
        type="button"
        class="inline-flex h-8 flex-none cursor-pointer items-center rounded-md border border-gm-line-strong bg-gm-raised px-2.5 text-[12px] text-gm-text hover:bg-gm-hover"
        :aria-label="`Browse for the ${which} file`"
        @click="browse"
      >
        Browse…
      </button>
    </div>
  </div>
</template>
