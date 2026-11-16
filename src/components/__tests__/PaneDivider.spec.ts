import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { DividerControls, DividerOrientation } from '@/lib/paneLayout'
import PaneDivider from '../PaneDivider.vue'

interface Layout {
  orientation?: DividerOrientation
  controls?: DividerControls
  /** The controlled pane's current length along the divider's axis. */
  paneSize?: number
  /** The parent's length along the axis. */
  containerSize?: number
}

/**
 * jsdom has no layout, so the parent and the panes report the lengths a real layout would give:
 * a pane before the divider, the divider, and a pane after it, inside one parent.
 */
function mountDivider({ orientation = 'vertical', controls = 'previous', paneSize = 260, containerSize = 1200 }: Layout = {}) {
  const Host = defineComponent(() => () =>
    h('div', { class: 'parent' }, [
      h('div', { class: 'before' }),
      h(PaneDivider, { orientation, controls, min: 180, reserve: 720, label: 'Resize the sidebar' }),
      h('div', { class: 'after' }),
    ]),
  )
  const wrapper = mount(Host, { attachTo: document.body })
  const vertical = orientation === 'vertical'
  const parent = wrapper.get('.parent').element as HTMLElement
  Object.defineProperty(parent, vertical ? 'clientWidth' : 'clientHeight', { value: containerSize })
  const pane = wrapper.get(controls === 'previous' ? '.before' : '.after').element as HTMLElement
  pane.getBoundingClientRect = () => ({ width: paneSize, height: paneSize }) as DOMRect
  const divider = wrapper.findComponent(PaneDivider)
  return { wrapper, divider, separator: wrapper.get('[role="separator"]') }
}

/**
 * jsdom has no PointerEvent, and Vue Test Utils can't set `button` on the MouseEvent it falls back to,
 * so pointer events are built here: a MouseEvent (clientX/Y, button) plus the pointerId PointerEvent adds.
 */
async function pointer(
  target: { element: Element },
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { clientX?: number; clientY?: number; button?: number },
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.element.dispatchEvent(event)
  await Promise.resolve()
}

describe('PaneDivider', () => {
  it('is a focusable, labelled separator across the axis it moves on', () => {
    const { separator } = mountDivider({ orientation: 'horizontal' })
    expect(separator.attributes('aria-label')).toBe('Resize the sidebar')
    expect(separator.attributes('aria-orientation')).toBe('horizontal')
    expect(separator.attributes('tabindex')).toBe('0')
    expect(separator.attributes('aria-valuemin')).toBe('180')
  })

  it('dragging grows the pane before it by as far as the pointer moved', async () => {
    const { divider, separator } = mountDivider()
    await pointer(separator, 'pointerdown', { button: 0, clientX: 500 })
    await pointer(separator, 'pointermove', { clientX: 540 })
    await pointer(separator, 'pointermove', { clientX: 470 })
    expect(divider.emitted('resize')).toEqual([[300], [230]])
  })

  it('dragging down shrinks the pane after it', async () => {
    const { divider, separator } = mountDivider({ orientation: 'horizontal', controls: 'next', paneSize: 400 })
    await pointer(separator, 'pointerdown', { button: 0, clientY: 300 })
    await pointer(separator, 'pointermove', { clientY: 350 })
    expect(divider.emitted('resize')).toEqual([[350]])
  })

  it('keeps the pane within its minimum and the space its neighbour keeps', async () => {
    const { divider, separator } = mountDivider()
    await pointer(separator, 'pointerdown', { button: 0, clientX: 500 })
    await pointer(separator, 'pointermove', { clientX: 100 })
    await pointer(separator, 'pointermove', { clientX: 1100 })
    expect(divider.emitted('resize')).toEqual([[180], [480]])
  })

  it('stops following the pointer once it is released', async () => {
    const { divider, separator } = mountDivider()
    await pointer(separator, 'pointerdown', { button: 0, clientX: 500 })
    await pointer(separator, 'pointerup', { clientX: 520 })
    await pointer(separator, 'pointermove', { clientX: 600 })
    expect(divider.emitted('resize')).toBeUndefined()
  })

  it('ignores drags with any button but the main one', async () => {
    const { divider, separator } = mountDivider()
    await pointer(separator, 'pointerdown', { button: 2, clientX: 500 })
    await pointer(separator, 'pointermove', { clientX: 540 })
    expect(divider.emitted('resize')).toBeUndefined()
  })

  it('moves with the arrow keys along its axis, further with Shift', async () => {
    const { divider, separator } = mountDivider()
    await separator.trigger('keydown', { key: 'ArrowRight' })
    await separator.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    await separator.trigger('keydown', { key: 'ArrowDown' })
    expect(divider.emitted('resize')).toEqual([[276], [196]])
  })

  it('double-click asks for the default size back', async () => {
    const { divider, separator } = mountDivider()
    await separator.trigger('dblclick')
    expect(divider.emitted('reset')).toHaveLength(1)
  })
})
