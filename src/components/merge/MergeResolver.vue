<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import type { MergeSession } from '@/composables/mergeFlow'
import { pluralize } from '@/lib/format'
import {
  type AlignedChunk,
  type MergeFile,
  type MergeSide,
  alignedChunks,
  conflictsLeftIn,
} from '@/lib/mergeChunks'
import GmIcon from '../GmIcon.vue'
import MergeConflictBlock from './MergeConflictBlock.vue'
import MergeGutter from './MergeGutter.vue'
import MergePaneLines from './MergePaneLines.vue'

const props = defineProps<{
  session: MergeSession
  file: MergeFile
  /** Conflicts left across every file. */
  conflictsLeft: number
  /** Complete merge is running. */
  completing: boolean
}>()

const emit = defineEmits<{
  selectFile: [path: string]
  toggle: [chunkIndex: number, side: MergeSide]
  neither: [chunkIndex: number]
  reopen: [chunkIndex: number]
  edit: [chunkIndex: number, text: string]
  mark: []
  discard: []
  complete: []
}>()

const rows = computed(() => alignedChunks(props.file))
const conflictRows = computed(() => rows.value.filter((row) => row.chunk.kind === 'conflict'))
const leftInFile = computed(() => conflictsLeftIn(props.file))

const branchName = computed(() => props.session.request.branch)

/** Which of the file's conflicts ‹ › and the keyboard are on. */
const currentConflict = ref(0)
/** The chunk whose edit box is open. */
const editingChunk = ref<number | null>(null)

watch(
  () => props.file.path,
  () => {
    currentConflict.value = 0
    editingChunk.value = null
  },
)

const conflictNumber = (row: AlignedChunk) => conflictRows.value.indexOf(row) + 1
/** Changed chunks show filler below their shorter panes. */
const cellTint = (row: AlignedChunk) => (row.chunk.kind === 'same' ? 'bg-gm-code' : 'bg-gm-empty')

function fileState(file: MergeFile): string {
  const left = conflictsLeftIn(file)
  if (left > 0) return pluralize(left, 'conflict', 'conflicts')
  return file.marked ? 'resolved' : 'ready'
}

// ---- the arrows ----

function changesOn(row: AlignedChunk, side: MergeSide): boolean {
  const { chunk } = row
  return chunk.kind === 'conflict' || (chunk.kind === 'one-side' && chunk.side === side)
}

function isTaken(row: AlignedChunk, side: MergeSide): boolean {
  const { chunk } = row
  if (chunk.kind === 'one-side') return chunk.applied
  return chunk.kind === 'conflict' && chunk.picks.includes(side)
}

/** A conflict being edited, or edited by hand, keeps its arrows off until that's finished or undone. */
function isLocked(row: AlignedChunk): boolean {
  return row.chunk.kind === 'conflict' && (row.chunk.edited !== null || editingChunk.value === row.index)
}

/** With both sides in, which came first. */
function orderOf(row: AlignedChunk, side: MergeSide): number | null {
  const { chunk } = row
  return chunk.kind === 'conflict' && chunk.picks.length === 2 ? chunk.picks.indexOf(side) + 1 : null
}

function arrowLabel(row: AlignedChunk, side: MergeSide): string {
  const verb = isTaken(row, side) ? 'Take back' : 'Bring in'
  if (row.chunk.kind !== 'conflict') return `${verb} the change from ${side}, line ${row[side][0]?.number ?? 1}`
  if (isLocked(row)) return editingChunk.value === row.index ? 'Finish editing first' : 'Undo the hand edit to use the arrows'
  return `${verb} ${side} for conflict ${conflictNumber(row)}`
}

function gutterProps(row: AlignedChunk, side: MergeSide) {
  return {
    side,
    active: changesOn(row, side),
    taken: isTaken(row, side),
    locked: isLocked(row),
    order: orderOf(row, side),
    label: arrowLabel(row, side),
  }
}

// ---- moving between conflicts ----

async function goToConflict(position: number): Promise<void> {
  const count = conflictRows.value.length
  if (count === 0) return
  currentConflict.value = (position + count) % count
  await nextTick()
  const target = grid.value?.querySelector<HTMLElement>(`[data-conflict="${currentConflict.value + 1}"]`)
  target?.scrollIntoView?.({ block: 'center' })
  target?.focus({ preventScroll: true })
}

function toggleCurrent(side: MergeSide): void {
  const row = conflictRows.value[currentConflict.value]
  if (row && !isLocked(row)) emit('toggle', row.index, side)
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest?.('textarea, select, dialog')) return
  if (event.key === 'F7') {
    event.preventDefault()
    void goToConflict(currentConflict.value + (event.shiftKey ? -1 : 1))
  } else if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    event.preventDefault()
    toggleCurrent(event.key === 'ArrowRight' ? 'ours' : 'theirs')
  }
}

function finishEdit(row: AlignedChunk, text: string): void {
  editingChunk.value = null
  emit('edit', row.index, text)
}

// ---- ribbons: from a side's changed lines to where they land in the result ----

const grid = ref<HTMLElement | null>(null)

/** Where the elements matching `selector` start and end, measured from the top of `cell`. */
function extent(cell: Element, selector: string): [number, number] | null {
  const found = cell.querySelectorAll(selector)
  if (found.length === 0) return null
  const top = cell.getBoundingClientRect().top
  return [found[0]!.getBoundingClientRect().top - top, found[found.length - 1]!.getBoundingClientRect().bottom - top]
}

/** Drawn from measurements, because wrapped lines make rows taller than their line count says. */
function drawRibbons(): void {
  for (const gutter of grid.value?.querySelectorAll<HTMLElement>('[data-ribbon-side]') ?? []) {
    const side = gutter.dataset['ribbonSide'] as MergeSide
    const [sideCell, resultCell] =
      side === 'ours' ? [gutter.previousElementSibling, gutter.nextElementSibling] : [gutter.nextElementSibling, gutter.previousElementSibling]
    if (!sideCell || !resultCell) continue
    const from = extent(sideCell, `[data-source="${side}"]`) ?? [0, 2]
    const to = extent(resultCell, `[data-source="${side}"]`) ?? extent(resultCell, '[data-conflict]:not([data-testid="merge-settled"]), [data-source="edited"]') ?? [0, 0]
    const width = gutter.offsetWidth
    const middle = width / 2
    const [sideX, resultX] = side === 'ours' ? [0, width] : [width, 0]
    gutter.querySelector('path')?.setAttribute(
      'd',
      `M${sideX},${from[0]} C${middle},${from[0]} ${middle},${to[0]} ${resultX},${to[0]} ` +
        `L${resultX},${to[1]} C${middle},${to[1]} ${middle},${from[1]} ${sideX},${from[1]} Z`,
    )
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  drawRibbons()
  if (typeof ResizeObserver !== 'undefined' && grid.value) {
    resizeObserver = new ResizeObserver(drawRibbons)
    resizeObserver.observe(grid.value)
  }
})
onUpdated(drawRibbons)
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
})

const smallButton =
  'inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-gm-line-strong bg-gm-raised px-2.5 text-[12px] text-gm-text hover:bg-gm-hover disabled:cursor-default disabled:text-gm-disabled disabled:hover:bg-gm-raised'
const label = 'sticky top-0 z-[2] flex items-center gap-1.5 overflow-hidden border-b border-gm-line-strong bg-gm-raised px-3 py-1.5 font-sans text-[11px] whitespace-nowrap text-gm-subtle'
const sideOnly = 'max-[860px]:hidden'
</script>

<template>
  <div class="flex min-h-0 flex-auto flex-col" data-testid="merge-resolver">
    <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-gm-line bg-gm-window px-4 py-2">
      <h2 class="m-0 min-w-0 text-[13px] font-normal text-gm-muted [overflow-wrap:anywhere]">
        Merging <span class="font-mono text-gm-ref-local-text">{{ branchName }}</span> into
        <span class="font-mono text-gm-text">{{ session.into }}</span>
      </h2>
      <div class="ml-auto flex gap-2 max-[860px]:ml-0 max-[860px]:w-full">
        <button
          type="button"
          class="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-gm-line-strong bg-gm-raised px-3.5 text-gm-text hover:bg-gm-hover disabled:cursor-default disabled:text-gm-disabled max-[860px]:flex-1"
          :disabled="completing"
          @click="emit('discard')"
        >
          Discard merge
        </button>
        <button
          type="button"
          class="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-gm-accent px-3.5 font-semibold text-gm-on-accent disabled:cursor-default disabled:opacity-60 max-[860px]:flex-1"
          :disabled="conflictsLeft > 0 || completing"
          :title="conflictsLeft > 0 ? 'Resolve every conflict first' : 'Commit the merge and update your files'"
          @click="emit('complete')"
        >
          {{ completing ? 'Merging…' : 'Complete merge' }}
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-auto">
      <nav aria-label="Conflicted files" class="flex w-[232px] flex-none flex-col border-r border-gm-line bg-gm-sidebar max-[860px]:hidden">
        <h3 class="m-0 px-4 pt-3 pb-2 text-[12px] font-semibold text-gm-muted">Conflicted files</h3>
        <ul class="m-0 min-h-0 flex-auto list-none overflow-auto px-2 py-0">
          <li v-for="candidate in session.files" :key="candidate.path">
            <button
              type="button"
              class="gm-row-hover flex w-full cursor-pointer items-center gap-2 rounded-md border-0 px-2 py-[7px] text-left text-gm-text"
              :class="candidate.path === file.path ? 'bg-gm-selected' : 'bg-transparent'"
              :aria-current="candidate.path === file.path ? 'true' : undefined"
              :title="candidate.path"
              @click="emit('selectFile', candidate.path)"
            >
              <span class="min-w-0 flex-auto truncate font-mono text-[12px]">{{ candidate.path }}</span>
              <span
                class="inline-flex flex-none items-center gap-[3px] text-[11px]"
                :class="conflictsLeftIn(candidate) > 0 ? 'font-semibold text-gm-conflict' : candidate.marked ? 'text-gm-resolved' : 'text-gm-soft'"
                data-testid="merge-file-state"
              >
                <GmIcon :name="conflictsLeftIn(candidate) > 0 ? 'warning' : 'check'" :size="12" />
                {{ fileState(candidate) }}
              </span>
            </button>
          </li>
        </ul>
        <p class="m-0 border-t border-gm-line px-4 py-3 text-[11px] leading-[1.5] text-gm-muted">
          F7 next conflict · Shift+F7 previous<br />
          Alt+→ bring in ours · Alt+← bring in theirs
        </p>
      </nav>

      <main class="flex min-w-0 flex-auto flex-col bg-gm-main">
        <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-gm-line px-4 py-2">
          <span class="min-w-0 truncate font-mono text-[12px] text-gm-soft max-[860px]:hidden" data-testid="merge-file">{{ file.path }}</span>
          <select
            aria-label="Conflicted file"
            class="box-border h-8 min-w-0 flex-[1_1_160px] rounded-md border border-gm-line-input bg-gm-code px-2 font-mono text-[12px] text-gm-text min-[861px]:hidden"
            :value="file.path"
            @change="emit('selectFile', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="candidate in session.files" :key="candidate.path" :value="candidate.path">
              {{ candidate.path }} · {{ fileState(candidate) }}
            </option>
          </select>
          <span v-if="conflictRows.length > 0" class="inline-flex items-center gap-1 text-[12px] text-gm-muted max-[860px]:hidden">
            <button type="button" :class="smallButton" class="w-7 !px-0" aria-label="Previous conflict" @click="goToConflict(currentConflict - 1)">‹</button>
            <span>Conflict {{ currentConflict + 1 }} of {{ conflictRows.length }}</span>
            <button type="button" :class="smallButton" class="w-7 !px-0" aria-label="Next conflict" @click="goToConflict(currentConflict + 1)">›</button>
          </span>
          <span
            class="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold"
            :class="leftInFile > 0 ? 'text-gm-conflict' : 'text-gm-resolved'"
            data-testid="merge-left"
          >
            <GmIcon :name="leftInFile > 0 ? 'warning' : 'check'" :size="14" />
            {{ leftInFile > 0 ? `${pluralize(leftInFile, 'conflict', 'conflicts')} left` : 'All conflicts resolved' }}
          </span>
          <button
            type="button"
            :class="smallButton"
            :disabled="leftInFile > 0 || file.marked"
            title="Marks this file as checked. Nothing is staged or written."
            @click="emit('mark')"
          >
            {{ file.marked ? 'Marked resolved' : 'Mark resolved' }}
          </button>
        </div>

        <div class="min-h-0 flex-auto overflow-auto bg-gm-code max-[860px]:overflow-visible" :inert="completing">
          <div
            ref="grid"
            class="grid grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)] font-mono text-[12px] leading-5 max-[860px]:grid-cols-[minmax(0,1fr)]"
          >
            <div :class="[label, sideOnly]" data-testid="merge-label-ours">
              <span class="size-2 flex-none rounded-full bg-gm-ours"></span><strong class="font-semibold text-gm-text">Ours</strong>
              {{ session.into }} (HEAD) <span class="font-mono text-gm-ref-local-text">{{ session.request.ours.slice(0, 7) }}</span>
            </div>
            <div :class="[label, sideOnly]" class="!p-0"></div>
            <div :class="label"><strong class="font-semibold text-gm-text">Result</strong> what will be committed</div>
            <div :class="[label, sideOnly]" class="!p-0"></div>
            <div :class="[label, sideOnly]" data-testid="merge-label-theirs">
              <span class="size-2 flex-none rounded-full bg-gm-theirs"></span><strong class="font-semibold text-gm-text">Theirs</strong>
              {{ branchName }} <span class="font-mono text-gm-ref-local-text">{{ session.request.theirs.slice(0, 7) }}</span>
            </div>

            <template v-for="row in rows" :key="row.index">
              <div :class="[sideOnly, cellTint(row)]" class="min-w-0" data-pane="ours">
                <MergePaneLines :lines="row.ours" />
              </div>
              <MergeGutter v-bind="gutterProps(row, 'ours')" @toggle="emit('toggle', row.index, 'ours')" />
              <div class="min-w-0 border-x border-gm-line max-[860px]:border-x-0" :class="cellTint(row)" data-pane="result">
                <MergePaneLines :lines="row.result" />
                <MergeConflictBlock
                  v-if="row.chunk.kind === 'conflict'"
                  :chunk="row.chunk"
                  :number="conflictNumber(row)"
                  :ours-name="session.into"
                  :theirs-name="branchName"
                  :editing="editingChunk === row.index"
                  @toggle="emit('toggle', row.index, $event)"
                  @neither="emit('neither', row.index)"
                  @reopen="emit('reopen', row.index)"
                  @start-edit="editingChunk = row.index"
                  @finish-edit="finishEdit(row, $event)"
                  @cancel-edit="editingChunk = null"
                />
              </div>
              <MergeGutter v-bind="gutterProps(row, 'theirs')" @toggle="emit('toggle', row.index, 'theirs')" />
              <div :class="[sideOnly, cellTint(row)]" class="min-w-0" data-pane="theirs">
                <MergePaneLines :lines="row.theirs" />
              </div>
            </template>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
