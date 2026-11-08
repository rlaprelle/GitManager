import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { SAMPLE_COMPARE_PATHS } from '@/data/sampleRepositories'
import { MockGitDataSource } from '@/services/MockGitDataSource'
import App from '../App.vue'

async function mountApp(source = new MockGitDataSource()) {
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

  it('applies a custom accent colour', async () => {
    const wrapper = mount(App, {
      props: { source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS, accent: '#F0A35E' },
    })
    expect(wrapper.get('div').attributes('style')).toContain('--color-gm-accent: #F0A35E')
  })
})
