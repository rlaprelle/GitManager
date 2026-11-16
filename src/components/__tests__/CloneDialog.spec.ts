import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CloneDialog from '../CloneDialog.vue'

// jsdom has no showModal/close; the real modal behaviour is covered in Playwright.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

type Props = Partial<{ folder: string | null; cloning: boolean; progress: string | null; error: string | null }>

function mountDialog(props: Props = {}) {
  return mount(CloneDialog, {
    props: { open: true, folder: 'C:\\dev', cloning: false, progress: null, error: null, ...props },
  })
}

const urlInput = (wrapper: ReturnType<typeof mountDialog>) => wrapper.get('input[placeholder^="https://"]')
const nameInput = (wrapper: ReturnType<typeof mountDialog>) => wrapper.findAll('input')[1]!
const button = (wrapper: ReturnType<typeof mountDialog>, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!

describe('CloneDialog', () => {
  it('names the folder after the URL, and shows where the clone will go', async () => {
    const wrapper = mountDialog()
    await urlInput(wrapper).setValue('https://github.com/rlaprelle/GitManager.git')
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('GitManager')
    expect(wrapper.get('[data-testid="clone-destination"]').text()).toBe('C:\\dev\\GitManager')
  })

  it('keeps a name the user typed when the URL changes', async () => {
    const wrapper = mountDialog()
    await urlInput(wrapper).setValue('https://host/tools.git')
    await nameInput(wrapper).setValue('my-tools')
    await urlInput(wrapper).setValue('https://host/other.git')
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('my-tools')
  })

  it('emits the request on Clone', async () => {
    const wrapper = mountDialog()
    await urlInput(wrapper).setValue('  https://host/tools.git ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('clone')).toEqual([[{ url: 'https://host/tools.git', name: 'tools' }]])
  })

  it('won’t clone until there is a usable URL, name and folder', async () => {
    const noFolder = mountDialog({ folder: null })
    await urlInput(noFolder).setValue('https://host/tools.git')
    expect(button(noFolder, 'Clone').attributes('disabled')).toBeDefined()
    expect(noFolder.get('[data-testid="clone-folder"]').text()).toBe('No folder chosen')

    const badUrl = mountDialog()
    await urlInput(badUrl).setValue('--upload-pack=calc')
    await urlInput(badUrl).trigger('blur')
    expect(button(badUrl, 'Clone').attributes('disabled')).toBeDefined()
    expect(badUrl.text()).toContain('isn’t a repository URL')

    const badName = mountDialog()
    await urlInput(badName).setValue('https://host/tools.git')
    await nameInput(badName).setValue('a/b')
    expect(badName.text()).toContain('"a/b" can’t be a folder name')
    await badName.get('form').trigger('submit')
    expect(badName.emitted('clone')).toBeUndefined()
  })

  it('asks for a folder with Browse…', async () => {
    const wrapper = mountDialog()
    await button(wrapper, 'Browse…').trigger('click')
    expect(wrapper.emitted('chooseFolder')).toHaveLength(1)
  })

  it('Cancel closes the dialog; while cloning it stops the clone instead', async () => {
    const idle = mountDialog()
    await button(idle, 'Cancel').trigger('click')
    expect(idle.emitted('close')).toHaveLength(1)

    const cloning = mountDialog({ cloning: true, progress: 'Cloning tools… Receiving objects 42%' })
    await button(cloning, 'Cancel clone').trigger('click')
    expect(cloning.emitted('cancelClone')).toHaveLength(1)
    expect(cloning.emitted('close')).toBeUndefined()
  })

  it('locks the form and shows git’s progress while cloning', () => {
    const wrapper = mountDialog({ cloning: true, progress: 'Cloning tools… Receiving objects 42%' })
    expect(wrapper.get('[role="status"]').text()).toBe('Cloning tools… Receiving objects 42%')
    expect(urlInput(wrapper).attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Cloning…').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Browse…').attributes('disabled')).toBeDefined()
  })

  it('shows why the last attempt failed', () => {
    const wrapper = mountDialog({ error: 'repository not found' })
    expect(wrapper.get('[role="alert"]').text()).toBe('repository not found')
  })

  it('Esc closes the dialog, but not while cloning', async () => {
    const idle = mountDialog()
    await idle.get('dialog').trigger('cancel')
    expect(idle.emitted('close')).toHaveLength(1)

    const cloning = mountDialog({ cloning: true })
    await cloning.get('dialog').trigger('cancel')
    expect(cloning.emitted('close')).toBeUndefined()
  })
})
