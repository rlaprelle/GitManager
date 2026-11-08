<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ name: string; currentBranch: string }>()

const kind = computed<'head' | 'remote' | 'local'>(() => {
  if (props.name.startsWith('origin/')) return 'remote'
  return props.name === props.currentBranch ? 'head' : 'local'
})
</script>

<template>
  <span
    v-if="kind === 'head'"
    class="inline-flex flex-none items-center gap-1 rounded bg-gm-accent px-[7px] py-px font-mono text-[11px] font-medium text-gm-on-accent"
  >
    HEAD → {{ name }}
  </span>
  <span
    v-else-if="kind === 'local'"
    class="flex-none rounded border border-gm-ref-local-line bg-gm-ref-local px-[7px] py-px font-mono text-[11px] text-gm-ref-local-text"
  >
    {{ name }}
  </span>
  <span
    v-else
    class="flex-none rounded border border-gm-ref-remote-line bg-transparent px-[7px] py-px font-mono text-[11px] text-gm-subtle"
  >
    {{ name }}
  </span>
</template>
