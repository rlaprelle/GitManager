<script setup lang="ts">
import type { DiffMode } from '@/composables/useGitManager'

defineProps<{ mode: DiffMode; gitDisabled: boolean }>()

defineEmits<{ change: [mode: DiffMode] }>()

const base = 'h-7 rounded-md border-0 px-3 text-[12px] font-semibold'
const active = 'cursor-pointer bg-gm-accent text-gm-on-accent'
const idle = 'cursor-pointer bg-transparent text-gm-soft'
const disabled = 'cursor-not-allowed bg-transparent text-gm-disabled'
</script>

<template>
  <div
    role="group"
    aria-label="Diff view"
    class="inline-flex gap-0.5 rounded-lg border border-gm-line-strong bg-gm-code p-0.5"
  >
    <button
      type="button"
      :class="[base, mode === 'git' ? active : gitDisabled ? disabled : idle]"
      :aria-pressed="mode === 'git'"
      :disabled="gitDisabled"
      @click="$emit('change', 'git')"
    >
      Git diff
    </button>
    <button
      type="button"
      :class="[base, mode === 'simple' ? active : idle]"
      :aria-pressed="mode === 'simple'"
      @click="$emit('change', 'simple')"
    >
      Simple diff
    </button>
  </div>
</template>
