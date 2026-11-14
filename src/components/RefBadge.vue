<script setup lang="ts">
import { computed } from 'vue'
import { refKind } from '@/lib/refs'

const props = defineProps<{ name: string; currentBranch: string; remoteBranchNames: string[] }>()

const kind = computed(() => refKind(props.name, props.currentBranch, props.remoteBranchNames))
</script>

<!--
  Badges shrink (with an ellipsis) only once the commit message beside them has
  given up its space; the full ref name stays available as a tooltip.
-->
<template>
  <span
    v-if="kind === 'head'"
    :title="`HEAD → ${name}`"
    :data-kind="kind"
    class="min-w-0 truncate rounded bg-gm-accent px-[7px] py-px font-mono text-[11px] font-medium text-gm-on-accent"
  >
    HEAD → {{ name }}
  </span>
  <span
    v-else-if="kind === 'local'"
    :title="name"
    :data-kind="kind"
    class="min-w-0 truncate rounded border border-gm-ref-local-line bg-gm-ref-local px-[7px] py-px font-mono text-[11px] text-gm-ref-local-text"
  >
    {{ name }}
  </span>
  <span
    v-else
    :title="name"
    :data-kind="kind"
    class="min-w-0 truncate rounded border border-gm-ref-remote-line bg-transparent px-[7px] py-px font-mono text-[11px] text-gm-subtle"
  >
    {{ name }}
  </span>
</template>
