<script setup lang="ts">
import { computed } from 'vue'
import type { Hunk } from '@/types/git'
import { type UnifiedLine, toUnifiedLines } from '@/lib/diff'

const props = defineProps<{ hunks: Hunk[] }>()

const lines = computed(() => toUnifiedLines(props.hunks))

const STYLE: Record<UnifiedLine['kind'], { row: string; sign: string; text: string; marker: string }> = {
  hunk: { row: 'bg-gm-hunk', sign: 'text-gm-link', text: 'text-gm-link', marker: '' },
  del: { row: 'bg-gm-del', sign: 'text-gm-del-sign', text: 'text-gm-del-text', marker: '-' },
  add: { row: 'bg-gm-add', sign: 'text-gm-add-sign', text: 'text-gm-add-text', marker: '+' },
  context: { row: 'bg-transparent', sign: 'text-gm-soft', text: 'text-gm-soft', marker: '' },
  // git's "\ No newline at end of file": a quiet remark about the line above, not a line.
  note: { row: 'bg-transparent', sign: 'text-gm-faint', text: 'text-gm-faint italic font-sans text-[11px]', marker: '' },
}
</script>

<template>
  <div data-testid="unified-diff">
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="grid min-h-5 grid-cols-[48px_48px_20px_minmax(0,1fr)]"
      :class="STYLE[line.kind].row"
      :data-kind="line.kind"
    >
      <span class="pr-2 text-right text-gm-faint select-none">{{ line.oldNo ?? '' }}</span>
      <span class="pr-2 text-right text-gm-faint select-none">{{ line.newNo ?? '' }}</span>
      <span class="text-center select-none" :class="STYLE[line.kind].sign">{{ STYLE[line.kind].marker }}</span>
      <span class="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]" :class="STYLE[line.kind].text">{{ line.text }}</span>
    </div>
  </div>
</template>
