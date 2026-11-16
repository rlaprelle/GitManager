<script setup lang="ts">
import { lastFetchLabel } from '@/lib/format'

withDefaults(
  defineProps<{
    status: string
    /** Left out when no repository is open; the bar then shows the status alone. */
    repoName?: string
    currentBranch?: string
    lastFetch?: string | null
    now: Date
    /** A downloaded update waiting for a restart (desktop only). */
    updateVersion?: string | null
    /** Why restarting into the update failed. */
    updateProblem?: string | null
  }>(),
  { updateVersion: null, updateProblem: null },
)

defineEmits<{ installUpdate: [] }>()
</script>

<template>
  <footer
    class="box-border flex min-h-7 flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-gm-line bg-gm-window px-4 py-1 text-[12px] text-gm-muted"
  >
    <span role="status" class="text-gm-soft">{{ status }}</span>
    <span class="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
      <span v-if="updateProblem" class="text-gm-warn">Couldn’t restart into the update: {{ updateProblem }}</span>
      <button
        v-if="updateVersion"
        type="button"
        class="cursor-pointer rounded border-0 bg-transparent p-0 font-semibold text-gm-link hover:text-gm-link-hover"
        @click="$emit('installUpdate')"
      >
        Version {{ updateVersion }} is ready · Restart now
      </button>
      <span v-if="repoName">{{ repoName }} · {{ currentBranch }} · Last fetch: {{ lastFetchLabel(lastFetch ?? null, now) }}</span>
    </span>
  </footer>
</template>
