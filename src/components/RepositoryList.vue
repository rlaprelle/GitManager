<script setup lang="ts">
import type { Repository } from '@/types/git'
import GmIcon from './GmIcon.vue'

defineProps<{
  repositories: Repository[]
  selectedId: string | undefined
}>()

defineEmits<{ select: [id: string]; add: [] }>()
</script>

<template>
  <section class="max-h-[46%] flex-[0_1_auto] overflow-auto px-2 pt-3 pb-2">
    <div class="flex items-center justify-between px-2 pb-2">
      <h2 class="m-0 text-[11px] font-semibold tracking-[0.08em] text-gm-muted uppercase">Repositories</h2>
      <button
        type="button"
        aria-label="Add repository"
        class="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-gm-soft hover:bg-gm-hover"
        @click="$emit('add')"
      >
        <GmIcon name="plus" />
      </button>
    </div>

    <div class="flex flex-col gap-0.5">
      <button
        v-for="repo in repositories"
        :key="repo.id"
        type="button"
        class="gm-row-hover flex w-full cursor-pointer items-start gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left text-gm-text"
        :class="repo.id === selectedId ? 'bg-gm-selected' : 'bg-transparent'"
        :aria-pressed="repo.id === selectedId"
        @click="$emit('select', repo.id)"
      >
        <GmIcon name="folder" :stroke-width="1.8" class="mt-px flex-none text-gm-muted" />
        <span class="flex min-w-0 flex-auto flex-col gap-[3px]">
          <span class="flex items-center justify-between gap-2">
            <span class="truncate font-semibold">{{ repo.name }}</span>
            <span
              v-if="repo.changedFileCount > 0"
              class="flex-none rounded-full bg-gm-warn-bg px-[7px] py-px text-[11px] text-gm-warn"
            >
              {{ repo.changedFileCount }} changed
            </span>
          </span>
          <span class="truncate font-mono text-[11px] text-gm-faint">{{ repo.path }}</span>
          <span class="truncate text-[12px] text-gm-muted">on {{ repo.currentBranch }}</span>
        </span>
      </button>
    </div>
  </section>
</template>
