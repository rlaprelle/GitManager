import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '../ConfirmDialog.vue'

// jsdom has <dialog> but not showModal() or close(); stand-ins that set `open` the way the
// browser would. The browser's own modal behaviour (focus, Esc) is tested in Playwright.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mountDialog(open: boolean) {
  return mount(ConfirmDialog, {
    props: { open, title: 'Leave 2 commits behind?', confirmLabel: 'Switch anyway' },
    slots: { default: 'They aren’t on any branch.' },
    attachTo: document.body,
  })
}

describe('ConfirmDialog', () => {
  it('opens as a modal dialog when asked, with its title and text', () => {
    const wrapper = mountDialog(true)
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.showModal).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(wrapper.get('h2').text()).toBe('Leave 2 commits behind?')
    expect(dialog.getAttribute('aria-labelledby')).toBe(wrapper.get('h2').attributes('id'))
    expect(wrapper.text()).toContain('They aren’t on any branch.')
    wrapper.unmount()
  })

  it('stays closed until asked, and closes when told', async () => {
    const wrapper = mountDialog(false)
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(false)
    await wrapper.setProps({ open: true })
    expect(dialog.open).toBe(true)
    await wrapper.setProps({ open: false })
    expect(dialog.open).toBe(false)
    wrapper.unmount()
  })

  it('emits confirm or cancel from its buttons, focusing Cancel first', async () => {
    const wrapper = mountDialog(true)
    const [cancel, confirm] = wrapper.findAll('button')
    expect(cancel!.text()).toBe('Cancel')
    expect(cancel!.attributes('autofocus')).toBeDefined()
    expect(confirm!.text()).toBe('Switch anyway')
    await confirm!.trigger('click')
    await cancel!.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('passes on Esc (the dialog’s cancel event) as cancel', async () => {
    const wrapper = mountDialog(true)
    wrapper.get('dialog').element.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
})
