import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Toast } from '@/composables/toasts'
import ToastStack from '../ToastStack.vue'

const TOASTS: Toast[] = [
  { id: 1, kind: 'notice', message: 'Your merge of main into feature/login is waiting', context: 'pricing-api' },
  { id: 2, kind: 'warning', message: 'This merge couldn’t be saved', context: null },
  { id: 3, kind: 'failure', message: 'Failed: no upstream branch to pull from', context: 'inventory-service' },
]

describe('ToastStack', () => {
  it('shows each toast’s message, oldest first', () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    expect(wrapper.findAll('p').map((message) => message.text())).toEqual(TOASTS.map((toast) => toast.message))
  })

  it('says what a toast is about, above its message, when it has that to say', () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    expect(wrapper.get('[data-kind="failure"]').get('[data-testid="toast-context"]').text()).toBe('inventory-service')
    expect(wrapper.get('[data-kind="notice"]').get('[data-testid="toast-context"]').text()).toBe('pricing-api')
    expect(wrapper.get('[data-kind="notice"]').get('p').text()).toBe('Your merge of main into feature/login is waiting')
    expect(wrapper.get('[data-kind="warning"]').find('[data-testid="toast-context"]').exists()).toBe(false)
  })

  it('announces a notice politely, and a warning or a failure at once', () => {
    const wrapper = mount(ToastStack, { props: { toasts: TOASTS } })
    expect(wrapper.get('[data-kind="notice"]').attributes('role')).toBe('status')
    expect(wrapper.get('[data-kind="warning"]').attributes('role')).toBe('alert')
    expect(wrapper.get('[data-kind="failure"]').attributes('role')).toBe('alert')
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
