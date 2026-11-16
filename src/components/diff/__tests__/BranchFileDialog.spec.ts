import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BranchFileDialog from '../BranchFileDialog.vue'

// jsdom has no showModal/close; the real modal behaviour is covered in Playwright.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const files = ['pom.xml', 'src/main/java/Stock.java', 'src/test/java/StockTest.java', 'README.md']

function mountDialog(props: Partial<{ files: string[]; loading: boolean }> = {}) {
  return mount(BranchFileDialog, { props: { open: true, branch: 'release/2.4', files, loading: false, ...props } })
}

const listed = (wrapper: ReturnType<typeof mountDialog>) => wrapper.findAll('li button').map((button) => button.text())

describe('BranchFileDialog', () => {
  it('lists the branch’s files and picks one', async () => {
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('Files on release/2.4')
    expect(listed(wrapper)).toEqual(files)
    await wrapper.findAll('li button')[1]!.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([['src/main/java/Stock.java']])
  })

  it('filters by every word typed, ignoring case, and Enter picks the first match', async () => {
    const wrapper = mountDialog()
    await wrapper.get('input[type="search"]').setValue('STOCK java test')
    expect(listed(wrapper)).toEqual(['src/test/java/StockTest.java'])
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('pick')).toEqual([['src/test/java/StockTest.java']])
  })

  it('says when it is loading or nothing matches', async () => {
    expect(mountDialog({ loading: true }).text()).toContain('Loading files…')
    const wrapper = mountDialog()
    await wrapper.get('input[type="search"]').setValue('nothing-like-this')
    expect(wrapper.text()).toContain('No files match')
  })

  it('shows the first 200 of a long list and asks for a narrower filter', () => {
    const many = Array.from({ length: 250 }, (_, i) => `file-${i}.txt`)
    const wrapper = mountDialog({ files: many })
    expect(listed(wrapper)).toHaveLength(200)
    expect(wrapper.text()).toContain('Showing 200 of 250')
  })

  it('closes with Cancel or Esc', async () => {
    const wrapper = mountDialog()
    await wrapper.findAll('button').find((button) => button.text() === 'Cancel')!.trigger('click')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
