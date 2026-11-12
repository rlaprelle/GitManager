<script setup lang="ts">
import type { Commit } from '@/types/git'
import { computed } from 'vue'
import { commitDateLabel, pluralize, shortHash } from '@/lib/format'
import { graphWidth, laneCount } from '@/lib/graph'
import CommitGraphCell from './CommitGraphCell.vue'
import RefBadge from './RefBadge.vue'

const props = defineProps<{
  commits: Commit[]
  /** The repository has older commits than `commits` holds. */
  hasMore: boolean
  /** Shown instead of rows and the commit count: 'Loading history…', 'No commits yet', ... */
  message: string | null
  selectedIndex: number
  currentBranch: string
  /** The clock dates are labelled against ('Today', 'Yesterday'). */
  now: Date
}>()

defineEmits<{ select: [index: number] }>()

const columns = 'grid items-center gap-3 pr-4 pl-2'

/** Every row's graph is as wide as the busiest row needs, so lanes line up down the column. */
const graphColumnWidth = computed(() => graphWidth(laneCount(props.commits.map((commit) => commit.graph))))

// A CSSOM style binding, which the content security policy allows (unlike a style attribute in markup).
const columnTemplate = computed(() => ({
  gridTemplateColumns: `${graphColumnWidth.value}px minmax(0,1fr) 130px 120px 76px`,
}))
</script>

<template>
  <section aria-label="Commit graph" class="flex min-h-[220px] flex-auto flex-col">
    <div class="flex flex-none items-center gap-3 border-b border-gm-line px-4 py-2.5">
      <h2 class="m-0 text-[13px] font-semibold">History</h2>
      <span v-if="!message" class="text-[12px] text-gm-muted">
        {{ hasMore ? 'Showing the latest ' : '' }}{{ pluralize(commits.length, 'commit', 'commits') }} · all branches
      </span>
    </div>

    <div class="min-h-0 flex-auto overflow-auto max-[860px]:max-h-[440px]">
      <div class="min-w-[760px]">
        <div
          :class="columns"
          :style="columnTemplate"
          class="sticky top-0 z-[1] h-[30px] border-b border-gm-line bg-gm-main text-[11px] font-semibold tracking-[0.06em] text-gm-faint uppercase"
        >
          <span>Graph</span><span>Description</span><span>Author</span><span>Date</span><span>Commit</span>
        </div>

        <p v-if="message" class="m-0 px-4 py-3 text-[12px] text-gm-muted">{{ message }}</p>

        <button
          v-for="(commit, index) in commits"
          :key="commit.hash"
          type="button"
          :class="[columns, index === selectedIndex ? 'bg-gm-selected' : 'bg-transparent']"
          :style="columnTemplate"
          class="gm-row-hover h-8 w-full cursor-pointer border-0 text-left text-gm-text"
          :aria-pressed="index === selectedIndex"
          @click="$emit('select', index)"
        >
          <CommitGraphCell :row="commit.graph" :selected="index === selectedIndex" :width="graphColumnWidth" />
          <span data-testid="commit-description" class="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <RefBadge v-for="ref in commit.refs" :key="ref" :name="ref" :current-branch="currentBranch" />
            <span class="min-w-[8ch] shrink-[1000] truncate">{{ commit.message }}</span>
          </span>
          <span class="truncate text-[12px] text-gm-muted">{{ commit.author }}</span>
          <span class="text-[12px] whitespace-nowrap text-gm-muted">{{ commitDateLabel(commit.date, now) }}</span>
          <span class="font-mono text-[12px] text-gm-subtle">{{ shortHash(commit.hash) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
