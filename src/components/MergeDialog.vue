<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { MergeDialogState } from '@/composables/mergeFlow'
import { mergeSummary } from '@/lib/merge'
import type { MergePreview } from '@/types/git'
import GmIcon from './GmIcon.vue'

const props = defineProps<{
  /** The dialog's state; null when it's closed. */
  state: MergeDialogState | null
  /** The checked-out branch, which is always what gets merged into. */
  into: string
  branches: string[]
  /** The picked name is a local branch's and a remote one's at once: which is merged, and how to merge the other. */
  sharedNameNote: string | null
  preview: MergePreview | null
  checking: boolean
  /** Why the previewed merge can't go ahead. */
  blocked: string | null
  /** The merge is running. */
  merging: boolean
}>()

const emit = defineEmits<{ choose: [branch: string]; merge: []; close: [] }>()

const summary = computed(() => (props.preview && !props.blocked ? mergeSummary(props.preview) : null))
const title = computed(() => (props.state?.fromPull && props.state.branch ? `Merge ${props.state.branch} into ${props.into}?` : `Merge into ${props.into}`))
const canMerge = computed(() => props.preview !== null && props.blocked === null && !props.checking && !props.merging)
const mergeLabel = computed(() => {
  if (props.merging) return 'Merging…'
  return props.preview && props.preview.conflicts.length > 0 ? 'Resolve conflicts…' : 'Merge'
})

const dialog = ref<HTMLDialogElement | null>(null)

// A native modal dialog, as ConfirmDialog: focus stays inside, and Esc (its cancel event) closes it.
function sync(open: boolean): void {
  const element = dialog.value
  if (!element || element.open === open) return
  if (open) element.showModal()
  else element.close()
}

watch(() => props.state !== null, sync)
onMounted(() => sync(props.state !== null))

function onEscape(event: Event): void {
  event.preventDefault()
  emit('close')
}

// Esc pressed again and again gets past a refused cancel: the browser closes the dialog itself on
// the third press, and the app wouldn't know. While there is a state to show (a merge running, or
// why one failed), the dialog goes straight back up.
function onClosed(): void {
  const element = dialog.value
  if (props.state !== null && element && !element.open) element.showModal()
}

function onChoose(event: Event): void {
  emit('choose', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="merge-title"
    class="m-auto w-[min(480px,calc(100vw-32px))] rounded-xl border border-gm-line-strong bg-gm-raised p-0 text-[13px] text-gm-text shadow-2xl backdrop:bg-gm-backdrop"
    @cancel="onEscape"
    @close="onClosed"
  >
    <form v-if="state" class="flex flex-col" @submit.prevent="emit('merge')">
      <div class="flex flex-col gap-4 p-5">
        <div class="flex items-center gap-3">
          <span class="flex size-8 flex-none items-center justify-center rounded-lg bg-gm-selected text-gm-accent">
            <GmIcon name="merge" :size="18" />
          </span>
          <h2 id="merge-title" class="m-0 min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{{ title }}</h2>
        </div>

        <p v-if="state.fromPull" class="m-0 leading-[1.5] text-gm-soft">
          <span class="font-mono">{{ into }}</span> and <span class="font-mono">{{ state.branch }}</span> both have new
          commits, so Pull can’t just move <span class="font-mono">{{ into }}</span> forward. Pull has fetched, and nothing
          else has changed.
        </p>

        <p v-if="state.waiting" class="m-0 rounded-lg bg-gm-selected px-3 py-2 leading-[1.5] text-gm-soft [overflow-wrap:anywhere]" data-testid="merge-waiting">
          Your merge of <span class="font-mono">{{ state.waiting.branch }}</span> into
          <span class="font-mono">{{ state.waiting.into }}</span> is saved and waiting.
        </p>

        <label class="flex flex-col gap-1.5 text-[12px] text-gm-muted">
          Branch to merge
          <select
            class="box-border h-9 min-w-0 rounded-lg border border-gm-line-input bg-gm-code px-3 font-mono text-[12px] text-gm-text"
            :value="state.branch ?? ''"
            :disabled="merging"
            @change="onChoose"
          >
            <option value="" disabled>Choose a branch…</option>
            <option v-for="branch in branches" :key="branch" :value="branch">{{ branch }}</option>
          </select>
        </label>

        <!-- Not a refusal (the merge can go ahead), but easy to get wrong, so it looks like a warning. -->
        <p
          v-if="sharedNameNote"
          class="m-0 rounded-lg bg-gm-warn-bg px-3 py-2 leading-[1.5] text-gm-warn [overflow-wrap:anywhere]"
          role="status"
          data-testid="merge-shared-name"
        >
          {{ sharedNameNote }}
        </p>

        <div v-if="!state.fromPull" class="flex flex-col gap-1.5 text-[12px] text-gm-muted">
          <span>Into</span>
          <span class="flex flex-wrap items-center gap-2">
            <span class="rounded bg-gm-accent px-[7px] py-px font-mono text-[11px] font-medium text-gm-on-accent" data-testid="merge-into">
              HEAD → {{ into }}
            </span>
            To merge into another branch, check it out first.
          </span>
        </div>

        <div class="flex min-h-9 flex-col gap-1 text-[12px] leading-[1.5] text-gm-muted" aria-live="polite">
          <p v-if="checking" class="m-0">Checking…</p>
          <template v-else-if="summary">
            <p class="m-0 [overflow-wrap:anywhere]" data-testid="merge-effect">{{ summary.effect }}</p>
            <p
              class="m-0 [overflow-wrap:anywhere]"
              :class="preview?.conflicts.length ? 'text-gm-conflict' : ''"
              data-testid="merge-conflicts"
            >
              {{ summary.conflicts }}
            </p>
            <p v-if="state.fromPull" class="m-0">If your team rebases instead, cancel and rebase in a terminal.</p>
          </template>
        </div>

        <p
          v-if="blocked || state.problem"
          class="m-0 rounded-lg bg-gm-warn-bg px-3 py-2 leading-[1.5] text-gm-warn [overflow-wrap:anywhere] first-letter:uppercase"
          role="alert"
        >
          {{ state.problem ?? blocked }}
        </p>
      </div>

      <div class="flex justify-end gap-2 border-t border-gm-line px-5 py-3">
        <button
          type="button"
          autofocus
          class="inline-flex h-9 cursor-pointer items-center rounded-lg border border-gm-line-strong bg-gm-main px-3.5 text-gm-text hover:bg-gm-hover disabled:cursor-default disabled:text-gm-disabled"
          :disabled="merging"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="inline-flex h-9 cursor-pointer items-center rounded-lg border-0 bg-gm-accent px-3.5 font-semibold text-gm-on-accent disabled:cursor-default disabled:opacity-60"
          :disabled="!canMerge"
        >
          {{ mergeLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>
