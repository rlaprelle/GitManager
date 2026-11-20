import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MergeDialogState } from '@/composables/mergeFlow'
import type { MergePreview } from '@/types/git'
import MergeDialog from '../MergeDialog.vue'

// jsdom has <dialog> but not showModal() or close(); the browser's own behaviour is tested in Playwright.
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

const preview = (changes: Partial<MergePreview> = {}): MergePreview => ({
  branch: 'feature/login',
  into: 'main',
  ours: 'a'.repeat(40),
  theirs: 'b'.repeat(40),
  commits: 2,
  outcome: 'merge-commit',
  conflicts: [],
  unresolvable: [],
  blockedBy: [],
  ...changes,
})

const open: MergeDialogState = { fromPull: false, branch: 'feature/login', problem: null, waiting: null }

function mountDialog(props: Partial<InstanceType<typeof MergeDialog>['$props']> = {}) {
  return mount(MergeDialog, {
    props: {
      state: open,
      into: 'main',
      branches: ['feature/login', 'origin/main'],
      preview: preview(),
      checking: false,
      blocked: null,
      merging: false,
      ...props,
    },
    attachTo: document.body,
  })
}

const submit = (wrapper: ReturnType<typeof mountDialog>) => wrapper.get('button[type="submit"]')

describe('MergeDialog', () => {
  it('opens as a modal when there is a state, and closes without one', async () => {
    const wrapper = mountDialog({ state: null })
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(false)
    await wrapper.setProps({ state: open })
    expect(dialog.showModal).toHaveBeenCalledOnce()
    await wrapper.setProps({ state: null })
    expect(dialog.open).toBe(false)
    wrapper.unmount()
  })

  it('names the target as HEAD and says how to merge somewhere else', () => {
    const wrapper = mountDialog()
    expect(wrapper.get('h2').text()).toBe('Merge into main')
    expect(wrapper.get('[data-testid="merge-into"]').text()).toBe('HEAD → main')
    expect(wrapper.text()).toContain('To merge into another branch, check it out first.')
    wrapper.unmount()
  })

  it('offers the branches and reports the one picked', async () => {
    const wrapper = mountDialog({ state: { ...open, branch: null }, preview: null })
    const select = wrapper.get('select')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['Choose a branch…', 'feature/login', 'origin/main'])
    await select.setValue('origin/main')
    expect(wrapper.emitted('choose')).toEqual([['origin/main']])
    wrapper.unmount()
  })

  it('can’t merge before there is a preview, and says when it is checking', () => {
    const wrapper = mountDialog({ preview: null, checking: true })
    expect(wrapper.text()).toContain('Checking…')
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('says what a clean merge will do, and merges on submit', async () => {
    const wrapper = mountDialog()
    expect(wrapper.get('[data-testid="merge-effect"]').text()).toBe('feature/login has 2 commits that main doesn’t. Makes a merge commit on main.')
    expect(wrapper.get('[data-testid="merge-conflicts"]').text()).toBe('No conflicts.')
    expect(submit(wrapper).text()).toBe('Merge')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('merge')).toHaveLength(1)
    wrapper.unmount()
  })

  it('names conflicting files and offers to resolve them', () => {
    const wrapper = mountDialog({ preview: preview({ conflicts: ['a.ts'] }) })
    expect(wrapper.get('[data-testid="merge-conflicts"]').text()).toContain('Conflicts in 1 file: a.ts.')
    expect(submit(wrapper).text()).toBe('Resolve conflicts…')
    wrapper.unmount()
  })

  it('shows why a merge can’t go ahead, instead of what it would do, and won’t start', () => {
    const wrapper = mountDialog({ blocked: 'main already has every commit on feature/login' })
    expect(wrapper.get('[role="alert"]').text()).toBe('main already has every commit on feature/login')
    expect(wrapper.find('[data-testid="merge-effect"]').exists()).toBe(false)
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('shows a failure', () => {
    const wrapper = mountDialog({ state: { ...open, problem: 'a merge is already in progress' } })
    expect(wrapper.get('[role="alert"]').text()).toBe('a merge is already in progress')
    wrapper.unmount()
  })

  it('explains itself when a Pull opened it, and asks about that branch', () => {
    const wrapper = mountDialog({ state: { ...open, fromPull: true, branch: 'origin/main' }, preview: preview({ branch: 'origin/main' }) })
    expect(wrapper.get('h2').text()).toBe('Merge origin/main into main?')
    expect(wrapper.text()).toContain('Pull has fetched, and nothing else has changed.')
    expect(wrapper.text()).toContain('If your team rebases instead')
    expect(wrapper.find('[data-testid="merge-into"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says when another merge is saved and waiting, and nothing of the kind otherwise', () => {
    const waiting = mountDialog({ state: { ...open, waiting: { branch: 'release/2.4', into: 'develop' } } })
    expect(waiting.get('[data-testid="merge-waiting"]').text()).toBe('Your merge of release/2.4 into develop is saved and waiting.')
    waiting.unmount()

    const none = mountDialog()
    expect(none.find('[data-testid="merge-waiting"]').exists()).toBe(false)
    none.unmount()
  })

  it('locks while merging', () => {
    const wrapper = mountDialog({ merging: true })
    expect(submit(wrapper).text()).toBe('Merging…')
    for (const control of wrapper.findAll('button, select')) expect(control.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('goes straight back up if the browser closes it while there is still something to show', async () => {
    const wrapper = mountDialog({ merging: true })
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.showModal).toHaveBeenCalledOnce()
    // What the third Esc in a row does, whatever the cancel handler said.
    dialog.open = false
    await wrapper.get('dialog').trigger('close')
    expect(dialog.showModal).toHaveBeenCalledTimes(2)
    expect(dialog.open).toBe(true)
    expect(wrapper.emitted('close')).toBeUndefined()

    // Closed by the app (no state left): it stays closed.
    await wrapper.setProps({ state: null })
    await wrapper.get('dialog').trigger('close')
    expect(dialog.showModal).toHaveBeenCalledTimes(2)
    expect(dialog.open).toBe(false)
    wrapper.unmount()
  })

  it('closes on Cancel and on Esc', async () => {
    const wrapper = mountDialog()
    await wrapper.findAll('button').find((button) => button.text() === 'Cancel')!.trigger('click')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
