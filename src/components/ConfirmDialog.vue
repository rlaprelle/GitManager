<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import GmIcon from './GmIcon.vue'

const props = defineProps<{
  open: boolean
  title: string
  confirmLabel: string
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

// A native modal dialog: the browser keeps focus inside it, puts it above everything, and
// closes it on Esc (its cancel event), which this passes on so the parent's `open` follows.
function sync(open: boolean): void {
  const element = dialog.value
  if (!element || element.open === open) return
  if (open) element.showModal()
  else element.close()
}

watch(() => props.open, sync)
onMounted(() => sync(props.open))

</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="confirm-title"
    class="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-gm-line-strong bg-gm-raised p-0 text-[13px] text-gm-text shadow-2xl backdrop:bg-gm-backdrop"
    @cancel="emit('cancel')"
  >
    <div class="flex gap-3.5 p-5">
      <span class="mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg bg-gm-warn-bg text-gm-warn">
        <GmIcon name="warning" :size="18" />
      </span>
      <div class="flex min-w-0 flex-col gap-2">
        <h2 id="confirm-title" class="m-0 text-[15px] font-semibold">{{ title }}</h2>
        <div class="text-gm-soft leading-[1.5]"><slot /></div>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t border-gm-line px-5 py-3">
      <button
        type="button"
        autofocus
        class="inline-flex h-9 cursor-pointer items-center rounded-lg border border-gm-line-strong bg-gm-main px-3.5 text-gm-text hover:bg-gm-hover"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center rounded-lg border-0 bg-gm-warn px-3.5 font-semibold text-gm-on-warn"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
