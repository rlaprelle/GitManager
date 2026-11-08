<script setup lang="ts">
import { computed } from 'vue'
import type { Hunk } from '@/types/git'
import { type CellKind, toSideBySideRows } from '@/lib/diff'

const props = defineProps<{ hunks: Hunk[]; leftLabel: string; rightLabel: string }>()

const rows = computed(() => toSideBySideRows(props.hunks))

const CELL_BG: Record<CellKind, string> = {
  context: 'bg-transparent',
  del: 'bg-gm-del',
  add: 'bg-gm-add',
  empty: 'bg-gm-empty',
}
</script>

<template>
  <div data-testid="side-by-side-diff">
    <div
      class="sticky top-0 z-[1] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-gm-line-strong bg-gm-raised font-sans text-[11px] text-gm-subtle"
    >
      <span class="truncate border-r border-gm-line-strong px-3 py-1.5" data-testid="left-label">{{ leftLabel }}</span>
      <span class="truncate px-3 py-1.5" data-testid="right-label">{{ rightLabel }}</span>
    </div>

    <template v-for="(row, i) in rows" :key="i">
      <div v-if="row.kind === 'separator'" class="bg-gm-hunk px-3 py-0.5 text-[11px] text-gm-link">
        {{ row.label }}
      </div>
      <div v-else class="grid min-h-5 grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)]" data-kind="line">
        <span class="pr-2 text-right text-gm-faint select-none" :class="CELL_BG[row.left.kind]">{{ row.left.no ?? '' }}</span>
        <span
          class="border-r border-gm-line pr-2.5 pl-1.5 whitespace-pre-wrap text-gm-code-text [overflow-wrap:anywhere]"
          :class="CELL_BG[row.left.kind]"
          data-side="left"
          :data-cell="row.left.kind"
          >{{ row.left.text }}</span
        >
        <span class="pr-2 text-right text-gm-faint select-none" :class="CELL_BG[row.right.kind]">{{ row.right.no ?? '' }}</span>
        <span
          class="pr-2.5 pl-1.5 whitespace-pre-wrap text-gm-code-text [overflow-wrap:anywhere]"
          :class="CELL_BG[row.right.kind]"
          data-side="right"
          :data-cell="row.right.kind"
          >{{ row.right.text }}</span
        >
      </div>
    </template>
  </div>
</template>
