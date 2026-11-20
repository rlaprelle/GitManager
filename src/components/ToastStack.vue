<script setup lang="ts">
import type { Toast } from '@/composables/toasts'
import GmIcon from './GmIcon.vue'

defineProps<{ toasts: Toast[] }>()

defineEmits<{ dismiss: [id: number] }>()
</script>

<!--
  What the user must not miss, over the bottom right corner and above the status bar. Each toast
  stays until dismissed. Only the toasts take clicks: the stack itself lets them through to the panes.
-->
<template>
  <section
    aria-label="Notifications"
    class="pointer-events-none fixed right-4 bottom-10 z-20 flex w-[min(400px,calc(100vw-32px))] flex-col gap-2"
    data-testid="toasts"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-gm-raised py-3 pr-2 pl-3.5 text-[13px] leading-[1.5] text-gm-text shadow-2xl"
      :class="toast.kind === 'warning' ? 'border-gm-warn' : 'border-gm-accent'"
      :role="toast.kind === 'warning' ? 'alert' : 'status'"
      :data-kind="toast.kind"
    >
      <GmIcon
        :name="toast.kind === 'warning' ? 'warning' : 'info'"
        :size="18"
        class="mt-px flex-none"
        :class="toast.kind === 'warning' ? 'text-gm-warn' : 'text-gm-accent'"
      />
      <p class="m-0 min-w-0 flex-auto [overflow-wrap:anywhere]">{{ toast.message }}</p>
      <button
        type="button"
        class="flex size-7 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-gm-muted hover:bg-gm-hover hover:text-gm-text"
        aria-label="Dismiss"
        title="Dismiss"
        @click="$emit('dismiss', toast.id)"
      >
        <GmIcon name="remove" :size="14" />
      </button>
    </div>
  </section>
</template>
