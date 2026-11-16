<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import {
  type DividerControls,
  type DividerOrientation,
  arrowKeyStep,
  clampPaneSize,
  sizeAfterMove,
} from '@/lib/paneLayout'

/**
 * The draggable line between two panes. It resizes one of its neighbours (`controls`) and measures the
 * layout itself, so it can keep that pane within `min` and leave the other one `reserve` px. It takes
 * no space of its own: it straddles the panes' shared border. Hidden on narrow screens, where panes stack.
 */
const props = defineProps<{
  orientation: DividerOrientation
  controls: DividerControls
  min: number
  reserve: number
  label: string
}>()

const emit = defineEmits<{ resize: [size: number]; reset: [] }>()

const divider = useTemplateRef<HTMLElement>('divider')
const vertical = computed(() => props.orientation === 'vertical')

/** What the separator reports to assistive technology: the pane's size and its largest. */
const size = ref<number | null>(null)
const largest = ref<number | null>(null)

interface Measure {
  paneSize: number
  containerSize: number
}

function controlledPane(): Element | null {
  const element = divider.value
  return (props.controls === 'previous' ? element?.previousElementSibling : element?.nextElementSibling) ?? null
}

function measure(): Measure | null {
  const pane = controlledPane()
  const container = divider.value?.parentElement
  if (!pane || !container) return null
  const box = pane.getBoundingClientRect()
  return {
    paneSize: vertical.value ? box.width : box.height,
    containerSize: vertical.value ? container.clientWidth : container.clientHeight,
  }
}

function sizeAfter(start: Measure, movedBy: number): number {
  return clampPaneSize(sizeAfterMove(start.paneSize, movedBy, props.controls), props.min, start.containerSize, props.reserve)
}

function updateAria() {
  const now = measure()
  size.value = now ? Math.round(now.paneSize) : null
  largest.value = now ? Math.max(props.min, now.containerSize - props.reserve) : null
}

let drag: { pointerId: number; from: number; start: Measure } | null = null
const dragging = ref(false)

function pointerPosition(event: PointerEvent): number {
  return vertical.value ? event.clientX : event.clientY
}

function startDrag(event: PointerEvent) {
  const start = measure()
  if (event.button !== 0 || !start) return
  // No text selection while dragging. Focus stays where it was: focusing here would leave the
  // keyboard-focus highlight lit after a mouse drag.
  event.preventDefault()
  divider.value?.setPointerCapture?.(event.pointerId)
  drag = { pointerId: event.pointerId, from: pointerPosition(event), start }
  dragging.value = true
}

function followPointer(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  emit('resize', sizeAfter(drag.start, pointerPosition(event) - drag.from))
}

function endDrag() {
  drag = null
  dragging.value = false
}

function moveByKey(event: KeyboardEvent) {
  const step = arrowKeyStep(event.key, event.shiftKey, props.orientation)
  const start = measure()
  if (step === null || !start) return
  event.preventDefault()
  emit('resize', sizeAfter(start, step))
}

let observer: ResizeObserver | null = null

onMounted(() => {
  updateAria()
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(updateAria)
  const pane = controlledPane()
  const container = divider.value?.parentElement
  if (pane) observer.observe(pane)
  if (container) observer.observe(container)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    ref="divider"
    role="separator"
    tabindex="0"
    :aria-label="label"
    :aria-orientation="orientation"
    :aria-valuenow="size ?? undefined"
    :aria-valuemin="min"
    :aria-valuemax="largest ?? undefined"
    title="Drag to resize · double-click to reset"
    class="group relative z-10 flex-none touch-none outline-none max-[860px]:hidden"
    :class="vertical ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize'"
    @pointerdown="startDrag"
    @pointermove="followPointer"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @keydown="moveByKey"
    @dblclick="emit('reset')"
  >
    <span
      class="pointer-events-none absolute bg-gm-accent transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      :class="[vertical ? 'inset-y-0 left-[3px] w-0.5' : 'inset-x-0 top-[3px] h-0.5', dragging ? 'opacity-100' : 'opacity-0']"
    />
  </div>
</template>
