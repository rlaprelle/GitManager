<script setup lang="ts">
import type { Commit } from '@/types/git'
import { pluralize } from '@/lib/format'
import CommitGraphCell from './CommitGraphCell.vue'
import RefBadge from './RefBadge.vue'

defineProps<{
  commits: Commit[]
  selectedIndex: number
  currentBranch: string
}>()

defineEmits<{ select: [index: number] }>()

const columns = 'grid grid-cols-[64px_minmax(0,1fr)_130px_120px_76px] items-center gap-3 pr-4 pl-2'
</script>

<template>
  <section aria-label="Commit graph" class="flex min-h-[220px] flex-auto flex-col">
    <div class="flex flex-none items-center gap-3 border-b border-gm-line px-4 py-2.5">
      <h2 class="m-0 text-[13px] font-semibold">History</h2>
      <span class="text-[12px] text-gm-muted">{{ pluralize(commits.length, 'commit', 'commits') }} · all branches</span>
    </div>

    <div class="min-h-0 flex-auto overflow-auto max-[860px]:max-h-[440px]">
      <div class="min-w-[760px]">
        <div
          :class="columns"
          class="sticky top-0 z-[1] h-[30px] border-b border-gm-line bg-gm-main text-[11px] font-semibold tracking-[0.06em] text-gm-faint uppercase"
        >
          <span>Graph</span><span>Description</span><span>Author</span><span>Date</span><span>Commit</span>
        </div>

        <button
          v-for="(commit, index) in commits"
          :key="commit.hash"
          type="button"
          :class="[columns, index === selectedIndex ? 'bg-gm-selected' : 'bg-transparent']"
          class="gm-row-hover h-8 w-full cursor-pointer border-0 text-left text-gm-text"
          :aria-pressed="index === selectedIndex"
          @click="$emit('select', index)"
        >
          <CommitGraphCell :row="commit.graph" :selected="index === selectedIndex" />
          <span class="flex min-w-0 items-center gap-1.5">
            <RefBadge v-for="ref in commit.refs" :key="ref" :name="ref" :current-branch="currentBranch" />
            <span class="truncate">{{ commit.message }}</span>
          </span>
          <span class="truncate text-[12px] text-gm-muted">{{ commit.author }}</span>
          <span class="text-[12px] whitespace-nowrap text-gm-muted">{{ commit.date }}</span>
          <span class="font-mono text-[12px] text-gm-subtle">{{ commit.hash }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
