import { afterEach, describe, expect, it } from 'vitest'
import { type VueWrapper, mount } from '@vue/test-utils'
import type { MergeSession } from '@/composables/mergeFlow'
import { type MergeFile, editConflict, toMergeFile, toggleSide, useNeitherSide } from '@/lib/mergeChunks'
import MergeResolver from '../MergeResolver.vue'

/** One one-sided change (chunk 0) and one conflict (chunk 2). */
const fileA = (): MergeFile => toMergeFile({ path: 'src/a.ts', base: 'a\nb\nc\nd\n', ours: 'A\nb\nc\nX\n', theirs: 'a\nb\nc\nY\nZ\n' })
const CONFLICT = 2
/** Two conflicts: chunks 0 and 2. */
const fileB = (): MergeFile => toMergeFile({ path: 'b.ts', base: '1\nkeep\n3\n', ours: 'one\nkeep\nthree\n', theirs: 'uno\nkeep\ntres\n' })

let wrapper: VueWrapper

function mountResolver(files: MergeFile[] = [fileA(), fileB()], more: { conflictsLeft?: number; completing?: boolean } = {}) {
  const session: MergeSession = {
    request: { branch: 'feature/login', into: 'main', ours: 'a'.repeat(40), theirs: 'b'.repeat(40) },
    into: 'main',
    commits: 2,
    files,
    path: files[0]!.path,
  }
  wrapper = mount(MergeResolver, {
    props: { session, file: files[0]!, conflictsLeft: more.conflictsLeft ?? 1, completing: more.completing ?? false },
    attachTo: document.body,
  })
  return wrapper
}

afterEach(() => wrapper.unmount())

const button = (name: string) => {
  const found = wrapper.findAll('button').find((candidate) => (candidate.attributes('aria-label') ?? candidate.text()) === name)
  if (!found) throw new Error(`No button "${name}"`)
  return found
}
const paneText = (pane: string) => wrapper.findAll(`[data-pane="${pane}"] [data-merge-line]`).map((line) => line.text())

describe('MergeResolver', () => {
  it('says what is being merged into what, with both versions labelled by name', () => {
    mountResolver()
    expect(wrapper.get('h2').text()).toBe('Merging feature/login into main')
    expect(wrapper.get('[data-testid="merge-label-ours"]').text()).toContain('Ours')
    expect(wrapper.get('[data-testid="merge-label-ours"]').text()).toContain('main (HEAD) aaaaaaa')
    expect(wrapper.get('[data-testid="merge-label-theirs"]').text()).toContain('feature/login bbbbbbb')
  })

  it('lines up the three versions, numbering each', () => {
    mountResolver()
    expect(paneText('ours')).toEqual(['1A', '2b', '3c', '4X'])
    expect(paneText('theirs')).toEqual(['1a', '2b', '3c', '4Y', '5Z'])
    expect(paneText('result')).toEqual(['1A', '2b', '3c'])
  })

  it('lists the conflicted files with how each stands, and switches between them', async () => {
    const marked = { ...editConflict(fileB(), 0, 'x'), marked: false }
    const done = { ...useNeitherSide(useNeitherSide(fileB(), 0), 2), path: 'done.ts', marked: true }
    mountResolver([fileA(), marked, done])
    expect(wrapper.findAll('[data-testid="merge-file-state"]').map((state) => state.text())).toEqual(['1 conflict', '1 conflict', 'resolved'])
    await wrapper.get('nav').findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('selectFile')).toEqual([['b.ts']])
  })

  it('calls a file with none left “ready” until it is marked', () => {
    mountResolver([useNeitherSide(fileA(), CONFLICT)], { conflictsLeft: 0 })
    expect(wrapper.get('[data-testid="merge-file-state"]').text()).toBe('ready')
    expect(wrapper.get('[data-testid="merge-left"]').text()).toBe('All conflicts resolved')
  })

  it('offers each side’s arrow on a conflict, and only the changed side’s on a one-sided change', async () => {
    mountResolver()
    await button('Bring in ours for conflict 1').trigger('click')
    await button('Bring in theirs for conflict 1').trigger('click')
    await button('Take back the change from ours, line 1').trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([
      [CONFLICT, 'ours'],
      [CONFLICT, 'theirs'],
      [0, 'ours'],
    ])
    expect(wrapper.findAll('button').some((candidate) => candidate.attributes('aria-label')?.includes('change from theirs'))).toBe(false)
  })

  it('shows which arrows are in, and their order when both are', () => {
    mountResolver([toggleSide(toggleSide(fileA(), CONFLICT, 'theirs'), CONFLICT, 'ours')], { conflictsLeft: 0 })
    expect(button('Take back theirs for conflict 1').attributes('aria-pressed')).toBe('true')
    expect(button('Take back theirs for conflict 1').text()).toBe('1')
    expect(button('Take back ours for conflict 1').text()).toBe('2')
    expect(paneText('result')).toEqual(['1A', '2b', '3c', '4Y', '5Z', '6X'])
    expect(wrapper.get('[data-testid="merge-settled"]').text()).toContain('Conflict 1: theirs then ours')
  })

  it('shows a conflict’s base and what each branch did', () => {
    mountResolver()
    const base = wrapper.get('[data-testid="merge-base"]').text()
    expect(base).toContain('Before either branch changed it')
    expect(base).toContain('d')
    expect(base).toContain('main changed this line.')
    expect(base).toContain('feature/login changed this line and added 1 line.')
  })

  it('folds a long base away until asked', async () => {
    const long = 'l1\nl2\nl3\nl4\n'
    mountResolver([toMergeFile({ path: 'f', base: long, ours: 'o\n', theirs: 't\n' })])
    expect(wrapper.get('[data-testid="merge-base"]').text()).not.toContain('l4')
    await button('Show what it was before (4 lines)').trigger('click')
    expect(wrapper.get('[data-testid="merge-base"]').text()).toContain('l4')
  })

  it('folds a long base away again for another file’s conflict, whatever was unfolded in the last', async () => {
    const withLongBase = (path: string) => toMergeFile({ path, base: 'l1\nl2\nl3\nl4\n', ours: 'o\n', theirs: 't\n' })
    mountResolver([withLongBase('one.ts'), withLongBase('two.ts')])
    await button('Show what it was before (4 lines)').trigger('click')
    expect(wrapper.get('[data-testid="merge-base"]').text()).toContain('l4')
    await wrapper.setProps({ file: withLongBase('two.ts') })
    expect(wrapper.get('[data-testid="merge-base"]').text()).not.toContain('l4')
  })

  it('says so when there was no base', () => {
    mountResolver([toMergeFile({ path: 'f', base: null, ours: 'o\n', theirs: 't\n' })])
    expect(wrapper.get('[data-testid="merge-base"]').text()).toContain('Both added lines here')
  })

  it('offers neither side, and undo once resolved', async () => {
    mountResolver()
    await button('Use neither side for conflict 1').trigger('click')
    expect(wrapper.emitted('neither')).toEqual([[CONFLICT]])
    await wrapper.setProps({ file: useNeitherSide(fileA(), CONFLICT) })
    expect(wrapper.get('[data-testid="merge-settled"]').text()).toContain('neither side')
    await button('Undo conflict 1').trigger('click')
    expect(wrapper.emitted('reopen')).toEqual([[CONFLICT]])
  })

  describe('editing by hand', () => {
    const box = () => wrapper.get('textarea').element as HTMLTextAreaElement

    it('opens a box with both sides to trim, focused, and locks that conflict’s arrows', async () => {
      mountResolver()
      await button('Edit conflict 1 by hand').trigger('click')
      expect(box().value).toBe('X\nY\nZ')
      expect(document.activeElement).toBe(box())
      for (const arrow of wrapper.findAll('button[aria-label="Finish editing first"]')) expect(arrow.attributes('disabled')).toBeDefined()
      expect(wrapper.findAll('button[aria-label="Finish editing first"]')).toHaveLength(2)
    })

    it('sends the typed text on Done', async () => {
      mountResolver()
      await button('Edit conflict 1 by hand').trigger('click')
      await wrapper.get('textarea').setValue('mine')
      await button('Done').trigger('click')
      expect(wrapper.emitted('edit')).toEqual([[CONFLICT, 'mine']])
      expect(wrapper.find('textarea').exists()).toBe(false)
    })

    it('finishes on Ctrl+Enter, and Esc or Cancel change nothing', async () => {
      mountResolver()
      await button('Edit conflict 1 by hand').trigger('click')
      await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('textarea').exists()).toBe(false)
      await button('Edit conflict 1 by hand').trigger('click')
      await button('Cancel').trigger('click')
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.emitted('edit')).toBeUndefined()
      await button('Edit conflict 1 by hand').trigger('click')
      await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
      expect(wrapper.emitted('edit')).toEqual([[CONFLICT, 'X\nY\nZ']])
    })

    it('keeps the arrows locked on an edited conflict, and says how to free them', () => {
      mountResolver([editConflict(fileA(), CONFLICT, 'typed')], { conflictsLeft: 0 })
      const locked = wrapper.findAll('button[aria-label="Undo the hand edit to use the arrows"]')
      expect(locked).toHaveLength(2)
      for (const arrow of locked) expect(arrow.attributes('disabled')).toBeDefined()
      expect(wrapper.get('[data-testid="merge-settled"]').text()).toContain('edited by hand')
      expect(paneText('result')).toContain('4typed')
    })

    it('keeps Complete merge back while a box is open, since what is typed isn’t in the result yet', async () => {
      mountResolver([toggleSide(fileA(), CONFLICT, 'ours')], { conflictsLeft: 0 })
      const complete = () => button('Complete merge')
      expect(complete().attributes('disabled')).toBeUndefined()

      await button('Edit').trigger('click')
      await wrapper.get('textarea').setValue('typed, and not yet Done')
      expect(complete().attributes('disabled')).toBeDefined()
      expect(complete().attributes('title')).toBe('Finish or cancel your edit first')
      await complete().trigger('click')
      expect(wrapper.emitted('complete')).toBeUndefined()

      await button('Cancel').trigger('click')
      expect(complete().attributes('disabled')).toBeUndefined()
      expect(complete().attributes('title')).toBe('Commit the merge and update your files')
    })

    it('keeps the file list back too, on wide screens and narrow, until the box is closed', async () => {
      mountResolver()
      const files = () => [...wrapper.get('nav').findAll('button'), wrapper.get('select')]
      for (const control of files()) expect(control.attributes('disabled')).toBeUndefined()

      await button('Edit conflict 1 by hand').trigger('click')
      for (const control of files()) {
        expect(control.attributes('disabled')).toBeDefined()
        expect(control.attributes('title')).toBe('Finish or cancel your edit first')
      }

      await button('Done').trigger('click')
      for (const control of files()) expect(control.attributes('disabled')).toBeUndefined()
      expect(wrapper.get('nav').findAll('button')[1]!.attributes('title')).toBe('b.ts')
    })

    it('closes the box when another file is shown', async () => {
      mountResolver()
      await button('Edit conflict 1 by hand').trigger('click')
      await wrapper.setProps({ file: fileB() })
      expect(wrapper.find('textarea').exists()).toBe(false)
    })
  })

  describe('narrow-screen controls', () => {
    it('has each side’s lines and a Use button inside the conflict', async () => {
      mountResolver()
      expect(wrapper.get('[data-testid="merge-inline-theirs"]').text()).toContain('feature/login')
      expect(wrapper.get('[data-testid="merge-inline-theirs"]').text()).toContain('Y')
      await button('Use theirs').trigger('click')
      expect(wrapper.emitted('toggle')).toEqual([[CONFLICT, 'theirs']])
    })

    it('can add the other side after using one', async () => {
      mountResolver([toggleSide(fileA(), CONFLICT, 'ours')], { conflictsLeft: 0 })
      await button('Add theirs too').trigger('click')
      expect(wrapper.emitted('toggle')).toEqual([[CONFLICT, 'theirs']])
    })

    it('picks the file from a list', async () => {
      mountResolver()
      await wrapper.get('select').setValue('b.ts')
      expect(wrapper.emitted('selectFile')).toEqual([['b.ts']])
    })
  })

  describe('moving between conflicts', () => {
    const position = () => wrapper.text().match(/Conflict (\d) of (\d)/)!.slice(1, 3).join('/')
    const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))

    it('steps with the buttons and F7, wrapping round', async () => {
      mountResolver([fileB()], { conflictsLeft: 2 })
      expect(position()).toBe('1/2')
      await button('Next conflict').trigger('click')
      expect(position()).toBe('2/2')
      press({ key: 'F7' })
      await wrapper.vm.$nextTick()
      expect(position()).toBe('1/2')
      press({ key: 'F7', shiftKey: true })
      await wrapper.vm.$nextTick()
      expect(position()).toBe('2/2')
      await button('Previous conflict').trigger('click')
      expect(position()).toBe('1/2')
    })

    it('keeps its place when a choice is made, and starts again when the file comes back with other conflicts', async () => {
      const file = fileB()
      mountResolver([file], { conflictsLeft: 2 })
      await button('Next conflict').trigger('click')
      await wrapper.setProps({ file: toggleSide(file, 2, 'ours'), conflictsLeft: 1 })
      expect(position()).toBe('2/2')

      // The merge worked out again: the same file, now with one conflict.
      const reworked = toMergeFile({ path: 'b.ts', base: '1\nkeep\n3\n', ours: 'one\nkeep\n3\n', theirs: 'uno\nkeep\n3\n' })
      await wrapper.setProps({ file: reworked, conflictsLeft: 1 })
      expect(position()).toBe('1/1')
    })

    it('moves focus to the conflict', async () => {
      mountResolver([fileB()], { conflictsLeft: 2 })
      await button('Next conflict').trigger('click')
      await wrapper.vm.$nextTick()
      expect((document.activeElement as HTMLElement).dataset['conflict']).toBe('2')
    })

    it('brings a side in with Alt+arrow, matching the arrows’ directions', () => {
      mountResolver()
      press({ key: 'ArrowRight', altKey: true })
      press({ key: 'ArrowLeft', altKey: true })
      expect(wrapper.emitted('toggle')).toEqual([
        [CONFLICT, 'ours'],
        [CONFLICT, 'theirs'],
      ])
    })

    it('leaves those keys alone for as long as an edit box is open, wherever the focus has gone', async () => {
      mountResolver([fileB()], { conflictsLeft: 2 })
      await button('Edit conflict 1 by hand').trigger('click')
      ;(button('Done').element as HTMLElement).focus()
      press({ key: 'F7' })
      press({ key: 'ArrowRight', altKey: true })
      await wrapper.vm.$nextTick()
      expect(position()).toBe('1/2')
      expect(wrapper.emitted('toggle')).toBeUndefined()
      expect(wrapper.find('textarea').exists()).toBe(true)
    })

    it('leaves those keys alone while the merge is being completed', async () => {
      mountResolver([fileB()], { conflictsLeft: 2, completing: true })
      press({ key: 'F7' })
      press({ key: 'ArrowRight', altKey: true })
      await wrapper.vm.$nextTick()
      expect(position()).toBe('1/2')
      expect(wrapper.emitted('toggle')).toBeUndefined()
    })

    it('leaves those keys alone while typing', async () => {
      mountResolver()
      await button('Edit conflict 1 by hand').trigger('click')
      wrapper.get('textarea').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))
      expect(wrapper.emitted('toggle')).toBeUndefined()
    })
  })

  describe('finishing', () => {
    const complete = () => button('Complete merge')

    it('marks a file only when none of its conflicts are left', async () => {
      mountResolver()
      expect(button('Mark resolved').attributes('disabled')).toBeDefined()
      await wrapper.setProps({ file: useNeitherSide(fileA(), CONFLICT) })
      expect(button('Mark resolved').attributes('disabled')).toBeUndefined()
      await button('Mark resolved').trigger('click')
      expect(wrapper.emitted('mark')).toHaveLength(1)
      await wrapper.setProps({ file: { ...useNeitherSide(fileA(), CONFLICT), marked: true } })
      expect(button('Marked resolved').attributes('disabled')).toBeDefined()
    })

    it('doesn’t take a mark while a conflict is being edited, or the merge completed: it would be cleared at once', async () => {
      mountResolver([toggleSide(fileA(), CONFLICT, 'ours')], { conflictsLeft: 0 })
      expect(button('Mark resolved').attributes('disabled')).toBeUndefined()
      await button('Edit').trigger('click')
      expect(button('Mark resolved').attributes('disabled')).toBeDefined()
      await button('Cancel').trigger('click')
      expect(button('Mark resolved').attributes('disabled')).toBeUndefined()
      await wrapper.setProps({ completing: true })
      expect(button('Mark resolved').attributes('disabled')).toBeDefined()
    })

    it('completes once no conflicts are left anywhere, marked or not', async () => {
      mountResolver([fileA()], { conflictsLeft: 1 })
      expect(complete().attributes('disabled')).toBeDefined()
      await wrapper.setProps({ conflictsLeft: 0, file: useNeitherSide(fileA(), CONFLICT) })
      expect(complete().attributes('disabled')).toBeUndefined()
      await complete().trigger('click')
      expect(wrapper.emitted('complete')).toHaveLength(1)
    })

    it('can always be discarded, except while completing', async () => {
      mountResolver()
      await button('Discard merge').trigger('click')
      expect(wrapper.emitted('discard')).toHaveLength(1)
      await wrapper.setProps({ completing: true })
      expect(button('Discard merge').attributes('disabled')).toBeDefined()
      expect(button('Merging…').attributes('disabled')).toBeDefined()
    })
  })
})
