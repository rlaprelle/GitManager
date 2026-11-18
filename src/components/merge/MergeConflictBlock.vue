<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { type ConflictChunk, type MergeSide, describeChange, editStartText, isResolved, lineText } from '@/lib/mergeChunks'
import GmIcon from '../GmIcon.vue'

const props = defineProps<{
  chunk: ConflictChunk
  /** Its number in the file, from 1. */
  number: number
  /** The checked-out branch and the branch being merged in. */
  oursName: string
  theirsName: string
  /** The edit box is open. */
  editing: boolean
}>()

const emit = defineEmits<{
  toggle: [side: MergeSide]
  neither: []
  reopen: []
  startEdit: []
  finishEdit: [text: string]
  cancelEdit: []
}>()

/** A base longer than this starts folded away, so one big conflict doesn't push everything else off screen. */
const LONGEST_OPEN_BASE = 3

const SIDES: MergeSide[] = ['ours', 'theirs']

const resolved = computed(() => isResolved(props.chunk))
const baseOpen = ref(false)
const baseFolded = computed(() => props.chunk.base.length > LONGEST_OPEN_BASE && !baseOpen.value)

const nameOf = (side: MergeSide) => (side === 'ours' ? props.oursName : props.theirsName)
const changeBy = (side: MergeSide) => describeChange(props.chunk.base, props.chunk[side])
/** One side is in: the other can still be added after it (on narrow screens, which have no arrows). */
const sideToAdd = computed<MergeSide | null>(() => {
  const { picks } = props.chunk
  return picks.length === 1 ? (picks[0] === 'ours' ? 'theirs' : 'ours') : null
})

const SIDE_NAME = { ours: 'text-gm-ours', theirs: 'text-gm-theirs' }
const SIDE_LINES = { ours: 'bg-gm-ours-bg', theirs: 'bg-gm-theirs-bg' }
const SIDE_BUTTON = { ours: 'border-gm-ours text-gm-ours', theirs: 'border-gm-theirs text-gm-theirs' }

const draft = ref('')
const box = ref<HTMLTextAreaElement | null>(null)

/** Grows the box with its text, wrapped lines included, so it never scrolls inside itself. */
function fit(): void {
  const element = box.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight + 2}px`
}

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return
    draft.value = editStartText(props.chunk)
    await nextTick()
    fit()
    box.value?.focus()
  },
  { immediate: true },
)

function onInput(): void {
  fit()
}
</script>

<template>
  <!-- Editing: a plain text box for just this conflict. -->
  <div
    v-if="editing"
    class="flex flex-col gap-1.5 border border-gm-accent bg-gm-raised px-2.5 pt-1.5 pb-2 font-sans text-[12px] leading-[1.4] text-gm-soft"
    role="group"
    :aria-label="`Editing conflict ${number}`"
    :data-conflict="number"
  >
    <p class="m-0"><b class="font-semibold text-gm-text">Editing conflict {{ number }}</b> — keep, change or delete any of these lines.</p>
    <textarea
      ref="box"
      v-model="draft"
      :aria-label="`Lines for conflict ${number}`"
      class="box-border w-full resize-none overflow-hidden rounded border border-gm-line-input bg-gm-code px-1.5 font-mono text-[12px] leading-5 text-gm-code-text"
      rows="2"
      spellcheck="false"
      @input="onInput"
      @keydown.ctrl.enter.prevent="emit('finishEdit', draft)"
      @keydown.esc.prevent.stop="emit('cancelEdit')"
    ></textarea>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="inline-flex h-7 cursor-pointer items-center rounded-md border-0 bg-gm-accent px-2.5 text-[12px] font-semibold text-gm-on-accent"
        @click="emit('finishEdit', draft)"
      >
        Done
      </button>
      <button
        type="button"
        class="inline-flex h-7 cursor-pointer items-center rounded-md border border-gm-line-strong bg-gm-raised px-2.5 text-[12px] text-gm-text hover:bg-gm-hover"
        @click="emit('cancelEdit')"
      >
        Cancel
      </button>
      <span class="ml-auto text-[11px] text-gm-muted">Ctrl+Enter done · Esc cancel</span>
    </div>
  </div>

  <!-- Resolved: its lines are in the pane above; this says how, with the ways back. -->
  <div
    v-else-if="resolved"
    class="flex min-h-5 flex-wrap items-center gap-x-1.5 border-t border-gm-line bg-gm-code px-2.5 font-sans text-[11px] text-gm-muted"
    tabindex="-1"
    :data-conflict="number"
    data-testid="merge-settled"
  >
    <GmIcon name="check" :size="12" class="text-gm-resolved" />
    <span>
      Conflict {{ number }}:
      <span v-if="chunk.edited" class="text-gm-text">edited by hand</span>
      <template v-else-if="chunk.neither">neither side</template>
      <template v-else>
        <template v-for="(side, index) in chunk.picks" :key="side">
          {{ index > 0 ? ' then ' : '' }}<span :class="SIDE_NAME[side]">{{ side }}</span>
        </template>
      </template>
    </span>
    <span aria-hidden="true">·</span>
    <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-gm-link hover:text-gm-link-hover" @click="emit('startEdit')">Edit</button>
    <span aria-hidden="true">·</span>
    <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-gm-link hover:text-gm-link-hover" :aria-label="`Undo conflict ${number}`" @click="emit('reopen')">
      Undo
    </button>
    <template v-if="sideToAdd">
      <span class="min-[861px]:hidden" aria-hidden="true">·</span>
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-gm-link hover:text-gm-link-hover min-[861px]:hidden"
        @click="emit('toggle', sideToAdd!)"
      >
        Add {{ sideToAdd }} too
      </button>
    </template>
  </div>

  <!-- Open: what clashed, and every way to settle it. -->
  <div
    v-else
    class="box-border flex h-full min-h-10 flex-col gap-1.5 border border-dashed border-gm-conflict bg-gm-conflict-bg px-2.5 py-1.5 font-sans text-[12px] leading-[1.4] text-gm-soft"
    role="group"
    tabindex="-1"
    :aria-label="`Conflict ${number}, unresolved`"
    :data-conflict="number"
    data-testid="merge-conflict"
  >
    <p class="m-0 flex items-start gap-1.5">
      <GmIcon name="warning" :size="14" class="mt-px flex-none text-gm-conflict" />
      <span><b class="font-semibold text-gm-conflict">Conflict {{ number }}</b> — bring in a side, or both, in the order you choose.</span>
    </p>

    <div class="flex flex-col gap-[3px]" data-testid="merge-base">
      <template v-if="chunk.base.length === 0">
        <span class="text-[11px] text-gm-muted">Before either branch changed it: nothing. Both added lines here.</span>
      </template>
      <button
        v-else-if="baseFolded"
        type="button"
        class="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-gm-link hover:text-gm-link-hover"
        @click="baseOpen = true"
      >
        Show what it was before ({{ chunk.base.length }} lines)
      </button>
      <template v-else>
        <span class="text-[11px] text-gm-muted">Before either branch changed it</span>
        <code class="flex flex-col rounded bg-gm-code px-1.5 py-px font-mono text-[12px] leading-5 text-gm-code-text">
          <span v-for="(line, index) in chunk.base" :key="index" class="min-h-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ lineText(line) }}</span>
        </code>
      </template>
      <span class="text-[11px] text-gm-muted [overflow-wrap:anywhere]">
        <span class="text-gm-ours">{{ oursName }}</span> {{ changeBy('ours') }}.
        <span class="text-gm-theirs">{{ theirsName }}</span> {{ changeBy('theirs') }}.
      </span>
    </div>

    <!-- Narrow screens have no side panes or arrows: each side's lines and button are here instead. -->
    <div v-for="side in SIDES" :key="side" class="flex flex-col gap-1 min-[861px]:hidden" :data-testid="`merge-inline-${side}`">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 text-[11px] text-gm-subtle [overflow-wrap:anywhere]">
          <b class="font-semibold text-gm-text capitalize">{{ side }}</b> {{ nameOf(side) }}
        </span>
        <button
          type="button"
          class="h-7 flex-none cursor-pointer rounded-full border bg-gm-code px-2.5 text-[12px] font-semibold"
          :class="SIDE_BUTTON[side]"
          @click="emit('toggle', side)"
        >
          Use {{ side }}
        </button>
      </div>
      <code class="flex flex-col rounded px-1.5 font-mono text-[12px] leading-5 text-gm-code-text" :class="SIDE_LINES[side]">
        <span v-for="(line, index) in chunk[side]" :key="index" class="min-h-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ lineText(line) }}</span>
      </code>
    </div>

    <p class="m-0 flex flex-wrap gap-x-1.5 text-[11px]">
      <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-gm-link hover:text-gm-link-hover" :aria-label="`Edit conflict ${number} by hand`" @click="emit('startEdit')">
        Edit by hand
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-gm-link hover:text-gm-link-hover" :aria-label="`Use neither side for conflict ${number}`" @click="emit('neither')">
        Use neither side
      </button>
    </p>
  </div>
</template>
