<script setup lang="ts">
import type { MergeSide } from '@/lib/mergeChunks'
import GmIcon from '../GmIcon.vue'

defineProps<{
  side: MergeSide
  /** False for a chunk this side didn't change: an empty gutter. */
  active: boolean
  /** The side's lines are in the result. */
  taken: boolean
  locked: boolean
  /** With both sides of a conflict in, which came first. */
  order: number | null
  label: string
}>()

defineEmits<{ toggle: [] }>()
</script>

<!--
  The arrow that brings a side's change into the result, on a ribbon joining the two: dashed when it
  can be brought in, filled once it's there. MergeResolver draws the ribbon's path, from measurements.
-->
<template>
  <div class="relative bg-gm-code max-[860px]:hidden" :data-ribbon-side="active ? side : undefined">
    <template v-if="active">
      <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
        <path
          stroke-width="1"
          :class="[
            side === 'ours' ? 'stroke-gm-ours-line' : 'stroke-gm-theirs-line',
            !taken && 'fill-transparent [stroke-dasharray:3_3]',
            taken && (side === 'ours' ? 'fill-gm-ours-bg' : 'fill-gm-theirs-bg'),
          ]"
        />
      </svg>
      <button
        type="button"
        class="absolute top-0 left-1/2 z-[1] flex h-5 w-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border p-0 hover:shadow-[0_0_0_3px_var(--color-gm-hover)] disabled:cursor-default disabled:opacity-40 disabled:hover:shadow-none"
        :class="[
          side === 'ours' ? 'border-gm-ours' : 'border-gm-theirs',
          taken && 'text-gm-on-side',
          taken && (side === 'ours' ? 'bg-gm-ours' : 'bg-gm-theirs'),
          !taken && 'bg-gm-code',
          !taken && (side === 'ours' ? 'text-gm-ours' : 'text-gm-theirs'),
        ]"
        :aria-label="label"
        :title="label"
        :aria-pressed="taken"
        :disabled="locked"
        @click="$emit('toggle')"
      >
        <GmIcon :name="side === 'ours' ? 'arrow-right' : 'arrow-left'" :size="14" />
        <span
          v-if="order"
          class="absolute -top-[5px] -right-[7px] size-[13px] rounded-full bg-gm-text text-center font-sans text-[9px] leading-[13px] font-bold text-gm-on-side"
          >{{ order }}</span
        >
      </button>
    </template>
  </div>
</template>
