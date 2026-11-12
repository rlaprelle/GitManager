<script setup lang="ts">
import { lastFetchLabel } from '@/lib/format'

defineProps<{
  status: string
  repoName: string
  currentBranch: string
  lastFetch: string | null
  now: Date
}>()
</script>

<template>
  <footer
    class="box-border flex min-h-7 flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-gm-line bg-gm-window px-4 py-1 text-[12px] text-gm-muted"
  >
    <span role="status" class="text-gm-soft">{{ status }}</span>
    <span class="ml-auto">{{ repoName }} · {{ currentBranch }} · Last fetch: {{ lastFetchLabel(lastFetch, now) }}</span>
  </footer>
</template>
