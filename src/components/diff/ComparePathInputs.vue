<script setup lang="ts">
import GmIcon from '../GmIcon.vue'

defineProps<{ leftPath: string; rightPath: string }>()

const emit = defineEmits<{
  'update:leftPath': [path: string]
  'update:rightPath': [path: string]
  swap: []
}>()

// Commit on change (blur / Enter), not every keystroke: each change re-runs the comparison.
function valueOf(event: Event): string {
  return (event.target as HTMLInputElement).value
}

const inputClass =
  'box-border h-8 min-w-0 rounded-md border border-gm-line-input bg-gm-code px-2.5 font-mono text-[12px] text-gm-text'
</script>

<template>
  <div class="flex min-w-0 flex-[1_1_420px] flex-wrap items-end gap-2">
    <div class="flex min-w-0 flex-[1_1_180px] flex-col gap-1">
      <label for="gm-left" class="text-[11px] text-gm-muted">Left file</label>
      <input
        id="gm-left"
        type="text"
        :class="inputClass"
        :value="leftPath"
        @change="emit('update:leftPath', valueOf($event))"
      />
    </div>
    <button
      type="button"
      aria-label="Swap left and right files"
      class="inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-md border border-gm-line-strong bg-gm-raised text-gm-text hover:bg-gm-hover"
      @click="emit('swap')"
    >
      <GmIcon name="swap" :size="15" />
    </button>
    <div class="flex min-w-0 flex-[1_1_180px] flex-col gap-1">
      <label for="gm-right" class="text-[11px] text-gm-muted">Right file</label>
      <input
        id="gm-right"
        type="text"
        :class="inputClass"
        :value="rightPath"
        @change="emit('update:rightPath', valueOf($event))"
      />
    </div>
  </div>
</template>
