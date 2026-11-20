import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Toast } from '@/composables/toasts'
import ToastStack from '../ToastStack.vue'

const TOASTS: Toast[] = [
  { id: 1, kind: 'notice', message: 'Pull in pricing-api found new commits on both sides' },
  { id: 2, kind: 'warning', message: 'This merge couldn’t be saved' },
]

describe('ToastStack', () => {
  it('shows each toast’s message, oldest first', () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    expect(wrapper.findAll('p').map((message) => message.text())).toEqual(TOASTS.map((toast) => toast.message))
  })

  it('announces a notice politely and a warning at once', () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    expect(wrapper.get('[data-kind="notice"]').attributes('role')).toBe('status')
    expect(wrapper.get('[data-kind="warning"]').attributes('role')).toBe('alert')
  })

  it('asks for the toast whose Dismiss was pressed to go', async () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    await wrapper.get('[data-kind="warning"]').get('button[aria-label="Dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([[2]])
  })

  it('is an empty, named region when there is nothing to say', () => {
    const wrapper = mount(ToastStack, { props: { toasts: [] } })
    expect(wrapper.get('section').attributes('aria-label')).toBe('Notifications')
    expect(wrapper.findAll('p')).toHaveLength(0)
  })
})
