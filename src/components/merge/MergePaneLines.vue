<script setup lang="ts">
import type { PaneLine } from '@/lib/mergeChunks'

defineProps<{ lines: PaneLine[] }>()

const TINT: Record<NonNullable<PaneLine['source']> | 'none', string> = {
  ours: 'bg-gm-ours-bg',
  theirs: 'bg-gm-theirs-bg',
  edited: 'bg-gm-raised',
  none: 'bg-gm-code',
}
</script>

<!-- Numbered code lines; each takes the colour of where it came from (data-source says which, for tests and the ribbons). -->
<template>
  <div
    v-for="line in lines"
    :key="line.number"
    class="grid min-h-5 grid-cols-[36px_minmax(0,1fr)]"
    :class="TINT[line.source ?? 'none']"
    data-merge-line
    :data-source="line.source ?? 'none'"
  >
    <span class="pr-2 text-right text-gm-faint select-none">{{ line.number }}</span>
    <span class="pr-2.5 pl-1.5 whitespace-pre-wrap text-gm-code-text [overflow-wrap:anywhere]">{{ line.text }}</span>
  </div>
</template>
