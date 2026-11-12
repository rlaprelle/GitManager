import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { SAMPLE_COMPARE_PATHS } from '@/data/sampleRepositories'
import type { GitDataSource } from '@/services/GitDataSource'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import { heldSource } from '@/composables/__tests__/heldSource'
import App from '../App.vue'

async function mountApp(source: GitDataSource = new MockGitDataSource()) {
  const wrapper = mount(App, { props: { source, comparePaths: SAMPLE_COMPARE_PATHS } })
  await flushPromises()
  return wrapper
}

function statusText(wrapper: Awaited<ReturnType<typeof mountApp>>) {
  return wrapper.get('footer [role="status"]').text()
}

function buttonByText(wrapper: Awaited<ReturnType<typeof mountApp>>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!
}

// Checks the wiring between the composable and the components; behaviour details live in their own tests.
describe('App', () => {
  it('shows a loading message until repositories arrive', () => {
    const wrapper = mount(App, { props: { source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS } })
    expect(wrapper.text()).toContain('Loading repositories…')
  })

  it('renders the first repository once loaded', async () => {
    const wrapper = await mountApp()
    expect(wrapper.get('[data-testid="header-repo"]').text()).toBe('inventory-service')
    expect(statusText(wrapper)).toBe('Ready')
    expect(wrapper.text()).toContain('Last fetch: 12 min ago')
  })

  it('switches repository from the sidebar', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'pricing-api').trigger('click')
    expect(wrapper.get('[data-testid="header-repo"]').text()).toBe('pricing-api')
    expect(wrapper.text()).toContain('5 commits · all branches')
  })

  it('selecting a commit updates the diff panel', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'Paginate GET /items').trigger('click')
    expect(wrapper.text()).toContain('Changes in 18c4b6f · Paginate GET /items')
    expect(statusText(wrapper)).toBe('Viewing commit 18c4b6f')
  })

  it('shows the repository while its history loads, then the history and diff', async () => {
    const held = heldSource()
    held.hold('getHistory')
    const wrapper = await mountApp(held.source)
    expect(wrapper.get('[data-testid="header-repo"]').text()).toBe('inventory-service')
    expect(wrapper.text()).toContain('Loading history…')

    await held.callsTo('getHistory')[0]!.release()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Loading history…')
    expect(wrapper.text()).toContain('Changes in 9f3a1c2 · Add reservation expiry job')
    expect(wrapper.findAll('[data-testid="unified-diff"] [data-kind="add"]')).toHaveLength(24)
  })

  it('selecting a file shows that file’s diff', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'application.yml').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('src/main/resources/application.yml')
    expect(wrapper.get('[data-testid="unified-diff"]').text()).toContain('hold-duration: 15m')
  })

  it('checks out a branch and moves HEAD to it', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'bugfix/sku-null-check').trigger('click')
    await buttonByText(wrapper, 'Checkout').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="header-branch"]').text()).toBe('bugfix/sku-null-check')
    expect(statusText(wrapper)).toBe('Switched to branch bugfix/sku-null-check')
  })

  it('fetch, pull and push report in the status bar', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'Fetch').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Last fetch: just now')
    await buttonByText(wrapper, 'Push').trigger('click')
    await flushPromises()
    expect(statusText(wrapper)).toBe('Pushed feature/stock-reservations to origin/feature/stock-reservations')
  })

  it('opens compare mode and swaps the two files', async () => {
    const wrapper = await mountApp()
    await buttonByText(wrapper, 'Compare two files').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('application.yml')
    await wrapper.get('button[aria-label="Swap left and right files"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('application-prod.yml')
    expect(wrapper.get('[data-side="left"][data-cell="del"]').text()).toContain('db.internal')
  })

  it('with no repositories, invites the user to add one and opens it', async () => {
    const source = new MockGitDataSource()
    const all = await source.listRepositories()
    let added = false
    source.listRepositories = async () => (added ? all.filter((repo) => repo.id === 'pricing') : [])
    source.addRepository = async () => {
      added = true
      return { repository: all.find((repo) => repo.id === 'pricing')!, message: 'Added pricing-api' }
    }
    const wrapper = await mountApp(source)
    expect(wrapper.get('h1').text()).toBe('Add a repository to get started')

    await buttonByText(wrapper, 'Add repository…').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="header-repo"]').text()).toBe('pricing-api')
    expect(statusText(wrapper)).toBe('Added pricing-api')
  })

  it('reports a failed add on the first-run screen', async () => {
    const source = new MockGitDataSource()
    source.listRepositories = async () => []
    source.addRepository = async () => {
      throw new Error('D:/downloads isn’t inside a git repository')
    }
    const wrapper = await mountApp(source)
    await buttonByText(wrapper, 'Add repository…').trigger('click')
    await flushPromises()
    expect(statusText(wrapper)).toBe('Failed: D:/downloads isn’t inside a git repository')
  })

  it('removes a repository from the sidebar', async () => {
    const wrapper = await mountApp()
    await wrapper.get('button[aria-label="Remove storefront-web from the list"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('nav').text()).not.toContain('storefront-web')
    expect(statusText(wrapper)).toBe('Removed storefront-web from the list')
  })

  it('a read-only app offers no Fetch, Pull, Push or Checkout', async () => {
    const wrapper = mount(App, { props: { source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS, writable: false } })
    await flushPromises()
    await buttonByText(wrapper, 'main').trigger('click')
    const labels = wrapper.findAll('button').map((button) => button.text())
    for (const label of ['Fetch', 'Pull', 'Push', 'Checkout']) expect(labels).not.toContain(label)
  })

  it('says a repository has no commits yet, in the history and in the diff panel', async () => {
    const source = new MockGitDataSource()
    source.getHistory = async () => ({ commits: [], hasMore: false })
    const wrapper = await mountApp(source)
    expect(wrapper.get('section[aria-label="Commit graph"]').text()).toContain('No commits yet')
    expect(wrapper.get('section[aria-label="Diff viewer"]').text()).toContain('No commits yet')
  })

  it('applies a custom accent colour', async () => {
    const wrapper = mount(App, {
      props: { source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS, accent: '#F0A35E' },
    })
    expect(wrapper.get('div').attributes('style')).toContain('--color-gm-accent: #F0A35E')
  })
})
