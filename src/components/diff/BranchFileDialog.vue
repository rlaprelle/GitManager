<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

/** A branch's files to pick one from, with a filter: the Windows file picker can't see inside git. */
const props = defineProps<{
  open: boolean
  branch: string
  files: string[]
  loading: boolean
}>()

const emit = defineEmits<{ pick: [path: string]; close: [] }>()

/** Enough to scroll through; a long list asks for a narrower filter instead. */
const SHOWN = 200

const filter = ref('')
const matches = computed(() => {
  const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean)
  return props.files.filter((path) => words.every((word) => path.toLowerCase().includes(word)))
})
const shown = computed(() => matches.value.slice(0, SHOWN))

const dialog = ref<HTMLDialogElement | null>(null)

function sync(open: boolean): void {
  const element = dialog.value
  if (!element || element.open === open) return
  if (open) {
    filter.value = ''
    element.showModal()
  } else element.close()
}

function pickFirst(): void {
  const first = shown.value[0]
  if (first) emit('pick', first)
}

watch(() => props.open, sync)
onMounted(() => sync(props.open))
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="branch-files-title"
    class="m-auto flex max-h-[min(560px,calc(100vh-64px))] w-[min(620px,calc(100vw-32px))] flex-col rounded-xl border border-gm-line-strong bg-gm-raised p-0 text-[13px] text-gm-text shadow-2xl backdrop:bg-gm-backdrop [&:not([open])]:hidden"
    @cancel.prevent="emit('close')"
  >
    <div class="flex flex-none flex-col gap-3 border-b border-gm-line p-4">
      <h2 id="branch-files-title" class="m-0 text-[15px] font-semibold">
        Files on <span class="font-mono text-gm-ref-local-text">{{ branch }}</span>
      </h2>
      <input
        v-model="filter"
        type="search"
        aria-label="Filter files"
        placeholder="Type part of a path"
        autofocus
        spellcheck="false"
        class="box-border h-9 w-full rounded-lg border border-gm-line-input bg-gm-code px-3 font-mono text-[12px] text-gm-text"
        @keydown.enter.prevent="pickFirst"
      />
    </div>
    <div class="min-h-0 flex-auto overflow-auto p-2">
      <p v-if="loading" class="m-0 px-2 py-1 text-gm-muted">Loading files…</p>
      <p v-else-if="matches.length === 0" class="m-0 px-2 py-1 text-gm-muted">No files match</p>
      <ul v-else class="m-0 flex list-none flex-col gap-px p-0" aria-label="Files">
        <li v-for="path in shown" :key="path">
          <button
            type="button"
            class="gm-row-hover w-full cursor-pointer truncate rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-[12px] text-gm-text"
            :title="path"
            @click="emit('pick', path)"
          >
            {{ path }}
          </button>
        </li>
      </ul>
      <p v-if="matches.length > SHOWN" class="m-0 px-2 py-1.5 text-[12px] text-gm-muted">
        Showing {{ SHOWN }} of {{ matches.length }}: type more to narrow it down.
      </p>
    </div>
    <div class="flex flex-none justify-end border-t border-gm-line px-4 py-3">
      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center rounded-lg border border-gm-line-strong bg-gm-main px-3.5 text-gm-text hover:bg-gm-hover"
        @click="emit('close')"
      >
        Cancel
      </button>
    </div>
  </dialog>
</template>
