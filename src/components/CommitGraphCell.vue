<script setup lang="ts">
import { computed } from 'vue'
import type { GraphRow } from '@/types/git'
import { GRAPH_WIDTH, ROW_HEIGHT, graphGeometry } from '@/lib/graph'

const props = defineProps<{ row: GraphRow; selected: boolean }>()

const geometry = computed(() => graphGeometry(props.row))

// The ring matches the row background so lines appear to stop at the dot.
const ringColor = computed(() =>
  props.selected ? 'var(--color-gm-selected)' : 'var(--color-gm-main)',
)
</script>

<template>
  <svg
    :width="GRAPH_WIDTH"
    :height="ROW_HEIGHT"
    :viewBox="`0 0 ${GRAPH_WIDTH} ${ROW_HEIGHT}`"
    aria-hidden="true"
    class="block"
  >
    <g stroke-width="2" fill="none" stroke-linecap="round">
      <line
        v-for="(segment, i) in geometry.segments"
        :key="`s${i}`"
        :x1="segment.x"
        :y1="segment.y1"
        :x2="segment.x"
        :y2="segment.y2"
        :stroke="segment.color"
      />
      <path v-for="(curve, i) in geometry.curves" :key="`c${i}`" :d="curve.d" :stroke="curve.color" />
      <circle
        :cx="geometry.dot.cx"
        :cy="geometry.dot.cy"
        r="5"
        :fill="geometry.dot.color"
        :stroke="ringColor"
      />
    </g>
  </svg>
</template>
