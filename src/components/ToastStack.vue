<script setup lang="ts">
import type { Toast, ToastKind } from '@/composables/toasts'
import GmIcon, { type IconName } from './GmIcon.vue'

defineProps<{ toasts: Toast[] }>()

defineEmits<{ dismiss: [id: number] }>()

/** How each kind looks, and how urgently a screen reader says it: a notice waits its turn, the others interrupt. */
const LOOK: Record<ToastKind, { icon: IconName; edge: string; ink: string; role: 'status' | 'alert' }> = {
  notice: { icon: 'info', edge: 'border-gm-accent', ink: 'text-gm-accent', role: 'status' },
  warning: { icon: 'warning', edge: 'border-gm-warn', ink: 'text-gm-warn', role: 'alert' },
  failure: { icon: 'warning', edge: 'border-gm-failure', ink: 'text-gm-failure', role: 'alert' },
}
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
      :class="LOOK[toast.kind].edge"
      :role="LOOK[toast.kind].role"
      :data-kind="toast.kind"
    >
      <GmIcon :name="LOOK[toast.kind].icon" :size="18" class="mt-px flex-none" :class="LOOK[toast.kind].ink" />
      <div class="flex min-w-0 flex-auto flex-col gap-0.5">
        <span v-if="toast.context" class="font-mono text-[11px] text-gm-muted [overflow-wrap:anywhere]" data-testid="toast-context">
          {{ toast.context }}
        </span>
        <p class="m-0 [overflow-wrap:anywhere]">{{ toast.message }}</p>
      </div>
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
