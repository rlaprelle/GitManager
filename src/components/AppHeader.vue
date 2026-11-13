<script setup lang="ts">
import { computed } from 'vue'
import { ALL_OPERATIONS, type RepositoryOperation } from '@/services/GitDataSource'
import GmIcon from './GmIcon.vue'

const props = withDefaults(
  defineProps<{
    repoName: string
    currentBranch: string
    /** e.g. '↑2 vs origin'; null hides it. */
    syncLabel: string | null
    /** The operations the host offers; Fetch, Pull and Push show only when listed. */
    operations?: readonly RepositoryOperation[]
    /** True while an operation runs: the buttons are disabled. */
    busy?: boolean
  }>(),
  { operations: () => ALL_OPERATIONS, busy: false },
)

const offers = (operation: RepositoryOperation) => props.operations.includes(operation)
const offersRemoteOperations = computed(() => offers('fetch') || offers('pull') || offers('push'))

defineEmits<{ fetch: []; pull: []; push: [] }>()

const secondaryButton =
  'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gm-line-strong bg-gm-raised px-3.5 text-gm-text hover:bg-gm-hover disabled:cursor-default disabled:text-gm-disabled'
</script>

<template>
  <header
    class="flex flex-none flex-wrap items-center gap-x-4 gap-y-3 border-b border-gm-line bg-gm-window px-4 py-2"
  >
    <div class="flex items-center gap-2.5">
      <GmIcon name="logo" :size="22" class="text-gm-accent" />
      <span class="text-[14px] font-bold tracking-[0.01em]">Git Manager</span>
    </div>

    <div class="h-[22px] w-px bg-gm-line-strong"></div>

    <div class="flex min-w-0 flex-wrap items-center gap-2.5">
      <span class="text-[14px] font-semibold" data-testid="header-repo">{{ repoName }}</span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-gm-chip-line bg-gm-chip px-2.5 py-1 font-mono text-[12px] text-gm-chip-text"
        data-testid="header-branch"
      >
        <GmIcon name="branch" :size="14" />
        {{ currentBranch }}
      </span>
      <span v-if="syncLabel" class="text-[12px] text-gm-warn">{{ syncLabel }}</span>
    </div>

    <div v-if="offersRemoteOperations" class="ml-auto flex flex-wrap gap-2">
      <button v-if="offers('fetch')" type="button" :class="secondaryButton" :disabled="busy" @click="$emit('fetch')">
        <GmIcon name="fetch" />
        Fetch
      </button>
      <button v-if="offers('pull')" type="button" :class="secondaryButton" :disabled="busy" @click="$emit('pull')">
        <GmIcon name="pull" />
        Pull
      </button>
      <button
        v-if="offers('push')"
        type="button"
        class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-gm-accent px-3.5 font-semibold text-gm-on-accent disabled:cursor-default disabled:opacity-60"
        :disabled="busy"
        @click="$emit('push')"
      >
        <GmIcon name="push" />
        Push
      </button>
    </div>
  </header>
</template>
