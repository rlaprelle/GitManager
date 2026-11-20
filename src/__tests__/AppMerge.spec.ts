import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { heldSource } from '@/composables/__tests__/heldSource'
import { ALL_OPERATIONS, type GitDataSource, type RepositoryOperation } from '@/services/GitDataSource'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import App from '../App.vue'

// Checks the wiring from the header through the dialog and resolver to the source and back.
// jsdom has no showModal; the real dialog behaviour is covered in Playwright.
beforeEach(() => {
  localStorage.clear() // A merge left open by one test would otherwise resume in the next.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

let wrapper: VueWrapper

afterEach(() => {
  wrapper.unmount()
  vi.restoreAllMocks()
})

async function mountApp(source: GitDataSource = new MockGitDataSource(), operations: readonly RepositoryOperation[] = ALL_OPERATIONS) {
  wrapper = mount(App, { props: { source, comparePaths: SAMPLE_COMPARE_PATHS, operations }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const status = () => wrapper.get('footer [role="status"]').text()
const button = (name: string) => {
  const found = wrapper.findAll('button').find((candidate) => (candidate.attributes('aria-label') ?? candidate.text()) === name)
  if (!found) throw new Error(`No button "${name}"`)
  return found
}
const hasButton = (name: string) => wrapper.findAll('button').some((candidate) => candidate.text() === name)
const click = async (name: string) => {
  await button(name).trigger('click')
  await flushPromises()
}

async function chooseBranch(branch: string) {
  await click('Merge…')
  await wrapper.get('dialog select').setValue(branch)
  await flushPromises()
}

async function openResolver() {
  await chooseBranch('main')
  await wrapper.get('dialog form').trigger('submit')
  await flushPromises()
}

const resolver = () => wrapper.find('[data-testid="merge-resolver"]')

describe('App merging', () => {
  it('hides Merge when the host doesn’t offer it', async () => {
    await mountApp(new MockGitDataSource(), ALL_OPERATIONS.filter((operation) => operation !== 'merge'))
    expect(hasButton('Merge…')).toBe(false)
  })

  it('completes a clean merge from the dialog, and the history shows it', async () => {
    await mountApp()
    await chooseBranch('bugfix/sku-null-check')
    expect(wrapper.get('[data-testid="merge-conflicts"]').text()).toBe('No conflicts.')
    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()
    expect(status()).toBe('Merged bugfix/sku-null-check into feature/stock-reservations (1 commit)')
    expect(wrapper.text()).toContain("Merge branch 'bugfix/sku-null-check' into feature/stock-reservations")
    expect(resolver().exists()).toBe(false)
  })

  it('resolves conflicts in the resolver, in place of the usual panes, with the header locked', async () => {
    await mountApp()
    await openResolver()
    expect(resolver().exists()).toBe(true)
    expect(wrapper.find('nav[aria-label="Repositories and branches"]').exists()).toBe(false)
    expect(status()).toBe('3 conflicts to resolve in 2 files · Nothing on disk has changed yet')
    expect(button('Fetch').attributes('disabled')).toBeDefined()
    expect(button('Complete merge').attributes('disabled')).toBeDefined()

    await click('Bring in ours for conflict 1')
    await click('Bring in theirs for conflict 2')
    await wrapper.get('[data-testid="merge-resolver"] nav').findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="merge-file"]').text()).toBe('pom.xml')
    await click('Edit conflict 1 by hand')
    await wrapper.get('textarea').setValue('  <version>2.4.0</version>')
    await click('Done')
    await click('Mark resolved')
    expect(button('Marked resolved').attributes('disabled')).toBeDefined()

    await click('Complete merge')
    expect(status()).toBe('Merged main into feature/stock-reservations (2 commits)')
    expect(resolver().exists()).toBe(false)
    expect(wrapper.find('nav[aria-label="Repositories and branches"]').exists()).toBe(true)
    expect(button('Fetch').attributes('disabled')).toBeUndefined()
  })

  it('leaves at once when nothing was decided', async () => {
    await mountApp()
    await openResolver()
    await click('Discard merge')
    expect(resolver().exists()).toBe(false)
    expect(status()).toBe('Merge discarded; nothing changed')
  })

  it('asks before discarding decisions, and can stay', async () => {
    await mountApp()
    await openResolver()
    await click('Bring in ours for conflict 1')
    await click('Discard merge')
    const dialog = wrapper.findAll('dialog').find((candidate) => candidate.text().includes('Discard this merge?'))!
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    await dialog.findAll('button').find((candidate) => candidate.text() === 'Cancel')!.trigger('click')
    await flushPromises()
    expect(resolver().exists()).toBe(true)
    await click('Discard merge')
    await dialog.findAll('button').find((candidate) => candidate.text() === 'Discard merge')!.trigger('click')
    await flushPromises()
    expect(resolver().exists()).toBe(false)
  })

  it('names the branch the merge is into when asking about discarding it, whatever is checked out by then', async () => {
    const repositories = structuredClone(sampleRepositories)
    await mountApp(new MockGitDataSource(repositories))
    await openResolver()
    await click('Bring in ours for conflict 1')
    // Outside the app, another branch is checked out; the app sees it when its window is looked at again.
    repositories[0]!.currentBranch = 'main'
    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    await click('Discard merge')
    const asking = wrapper.findAll('dialog').find((dialog) => dialog.text().includes('Discard this merge?'))!
    expect(asking.text()).toContain('feature/stock-reservations stays where it was')
  })

  it('picks up a merge left open, with its choices, when the app starts again', async () => {
    await mountApp()
    await openResolver()
    await click('Bring in ours for conflict 1')
    wrapper.unmount()

    await mountApp()
    expect(resolver().exists()).toBe(true)
    expect(button('Take back ours for conflict 1').attributes('aria-pressed')).toBe('true')
    expect(status()).toBe('Continuing your merge of main into feature/stock-reservations · Nothing on disk has changed yet')
  })

  it('asks before a merge with conflicts replaces one that is saved and waiting', async () => {
    // A merge left half resolved; then main is checked out outside the app, where the feature branch clashes too.
    const repositories = structuredClone(sampleRepositories)
    await mountApp(new MockGitDataSource(repositories))
    await openResolver()
    wrapper.unmount()
    const inventory = repositories[0]!
    inventory.currentBranch = 'main'
    inventory.mergeConflicts = { ...inventory.mergeConflicts, 'feature/stock-reservations': inventory.mergeConflicts!['main']! }
    await mountApp(new MockGitDataSource(repositories))
    expect(resolver().exists()).toBe(false)

    await chooseBranch('feature/stock-reservations')
    expect(wrapper.get('[data-testid="merge-waiting"]').text()).toBe('Your merge of main into feature/stock-reservations is saved and waiting.')
    const asking = () => wrapper.findAll('dialog').find((dialog) => dialog.text().includes('Replace your saved merge?'))!
    const answer = async (name: string) => {
      await asking().findAll('button').find((candidate) => candidate.text() === name)!.trigger('click')
      await flushPromises()
    }
    expect((asking().element as HTMLDialogElement).open).toBe(false)

    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()
    expect((asking().element as HTMLDialogElement).open).toBe(true)
    expect(asking().text()).toContain('The choices you made merging main into feature/stock-reservations will be dropped.')

    await answer('Cancel')
    expect((asking().element as HTMLDialogElement).open).toBe(false)
    expect(wrapper.find('#merge-title').exists()).toBe(true)
    expect(resolver().exists()).toBe(false)

    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()
    await answer('Replace it')
    expect(resolver().get('h2').text()).toBe('Merging feature/stock-reservations into main')
  })

  it('warns in a toast when the merge can’t be saved, until the toast is dismissed', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    await mountApp()
    await openResolver()
    const warning = () => wrapper.get('[data-testid="toasts"]').find('[role="alert"]')
    expect(warning().get('p').text()).toBe('This merge couldn’t be saved, so closing the app would lose it. Complete or discard it before you close.')
    expect(warning().get('[data-testid="toast-context"]').text()).toBe('inventory-service')

    await warning().get('button[aria-label="Dismiss"]').trigger('click')
    expect(warning().exists()).toBe(false)
    expect(resolver().exists()).toBe(true)
  })

  it('shows a notice while something is left unfinished outside the app', async () => {
    const source = new MockGitDataSource()
    source.getUnfinishedOperation = async () => 'merge'
    await mountApp(source)
    expect(wrapper.get('[data-testid="unfinished-operation"]').text()).toBe(
      'A merge is in progress here, started outside Git Manager. Finish or abort it in a terminal.',
    )
  })

  it('shows no such notice normally', async () => {
    await mountApp()
    expect(wrapper.find('[data-testid="unfinished-operation"]').exists()).toBe(false)
  })

  it('offers the merge when Pull finds both sides have moved on', async () => {
    const repositories = structuredClone(sampleRepositories)
    repositories[0]!.localBranches[0]!.behind = 1
    await mountApp(new MockGitDataSource(repositories))
    await click('Pull')
    expect(wrapper.get('#merge-title').text()).toBe(
      'Merge origin/feature/stock-reservations into feature/stock-reservations?',
    )
  })

  it('tells of a Pull that finished after another repository was opened in a toast, until it is dismissed', async () => {
    const repositories = structuredClone(sampleRepositories)
    repositories[0]!.localBranches[0]!.behind = 1
    const held = heldSource(new MockGitDataSource(repositories))
    await mountApp(held.source)
    held.hold('pull')
    await click('Pull')
    await wrapper.findAll('button').find((candidate) => /^pricing-api/.test(candidate.text()))!.trigger('click')
    await flushPromises()
    await held.callsTo('pull')[0]!.release()
    await flushPromises()

    const toasts = () => wrapper.get('[data-testid="toasts"]')
    expect(toasts().get('[data-testid="toast-context"]').text()).toBe('inventory-service')
    expect(toasts().get('[role="status"] p').text()).toBe(
      'feature/stock-reservations and origin/feature/stock-reservations both have new commits, so Pull can’t just move feature/stock-reservations forward. Open inventory-service and press Pull again to merge them.',
    )
    expect(wrapper.find('#merge-title').exists()).toBe(false)
    await toasts().get('button[aria-label="Dismiss"]').trigger('click')
    expect(toasts().findAll('[data-kind]')).toHaveLength(0)
  })
})
