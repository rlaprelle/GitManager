<script setup lang="ts">
import { computed } from 'vue'
import type { GitStatus } from '@/types/bridge'
import GmIcon from './GmIcon.vue'

const props = defineProps<{ status: Exclude<GitStatus, { state: 'ready' }> }>()

const DOWNLOAD_URL = 'https://git-scm.com/download/win'

const problem = computed(() =>
  props.status.state === 'too-old'
    ? `Git ${props.status.version} is installed, but Git Manager needs ${props.status.minimum} or newer.`
    : 'Git wasn’t found on this computer.',
)
</script>

<!-- Shown instead of the app when the installed git can't be used. The window refuses navigation, so the address is text to copy, not a link. -->
<template>
  <div class="flex min-h-[640px] h-screen items-center justify-center bg-gm-window p-6 font-sans text-[13px] text-gm-text">
    <main class="flex max-w-[460px] flex-col gap-4 rounded-xl border border-gm-line-strong bg-gm-main p-8">
      <GmIcon name="logo" :size="32" class="text-gm-accent" />
      <h1 class="m-0 text-[18px] font-semibold">Git Manager needs Git for Windows</h1>
      <p class="m-0 text-gm-soft">
        {{ problem }} Git Manager reads your repositories with the git you already have, so it uses your settings,
        credentials and SSH keys.
      </p>
      <p class="m-0 text-gm-soft">Install or update Git for Windows from</p>
      <p class="m-0 rounded-md border border-gm-line bg-gm-code px-3 py-2 font-mono text-[12px] text-gm-link select-all">
        {{ DOWNLOAD_URL }}
      </p>
      <p class="m-0 text-gm-muted">then restart Git Manager.</p>
    </main>
  </div>
</template>
