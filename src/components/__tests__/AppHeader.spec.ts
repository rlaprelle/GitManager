import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RepositoryOperation } from '@/services/GitDataSource'
import AppHeader from '../AppHeader.vue'

interface HeaderOptions {
  operations?: RepositoryOperation[]
  running?: RepositoryOperation | null
  locked?: boolean
  canMerge?: boolean
}

function mountHeader(syncLabel: string | null = '↑2 vs origin', more: HeaderOptions = {}) {
  return mount(AppHeader, { props: { repoName: 'inventory-service', currentBranch: 'main', syncLabel, ...more } })
}

const labels = (wrapper: ReturnType<typeof mountHeader>) => wrapper.findAll('button').map((b) => b.text())

describe('AppHeader', () => {
  it('shows the repository and checked-out branch', () => {
    const wrapper = mountHeader()
    expect(wrapper.get('[data-testid="header-repo"]').text()).toBe('inventory-service')
    expect(wrapper.get('[data-testid="header-branch"]').text()).toBe('main')
  })

  it('shows the sync label only when there is one', () => {
    expect(mountHeader().text()).toContain('↑2 vs origin')
    expect(mountHeader(null).text()).not.toContain('vs origin')
  })

  it('shows only the operations the host offers', () => {
    expect(labels(mountHeader(null, { operations: ['checkout'] }))).toEqual([])
    expect(labels(mountHeader(null, { operations: ['checkout', 'fetch'] }))).toEqual(['Fetch'])
    expect(labels(mountHeader(null, { operations: ['pull', 'push'] }))).toEqual(['Pull', 'Push'])
    expect(labels(mountHeader(null, { operations: ['merge'] }))).toEqual(['Merge…'])
    expect(labels(mountHeader(null))).toEqual(['Fetch', 'Pull', 'Merge…', 'Push'])
  })

  it.each(['checkout', 'fetch', 'pull', 'push', 'merge'] as const)('disables its buttons while %s runs', async (running) => {
    const wrapper = mountHeader(null, { running })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled'), button.text()).toBeDefined()
      await button.trigger('click')
    }
    for (const event of ['fetch', 'pull', 'merge', 'push']) expect(wrapper.emitted()).not.toHaveProperty(event)
  })

  it('disables every button while a merge is being resolved, without claiming anything is running', () => {
    const wrapper = mountHeader(null, { locked: true })
    expect(labels(wrapper)).toEqual(['Fetch', 'Pull', 'Merge…', 'Push'])
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled'), button.text()).toBeDefined()
  })

  it('offers no merge with no branch to merge into, and leaves the other buttons alone', () => {
    const wrapper = mountHeader(null, { canMerge: false })
    const disabled = wrapper.findAll('button').filter((button) => button.attributes('disabled') !== undefined)
    expect(disabled.map((button) => button.text())).toEqual(['Merge…'])
  })

  it('says which operation is running on its button', () => {
    expect(labels(mountHeader(null, { running: 'fetch' }))).toEqual(['Fetching…', 'Pull', 'Merge…', 'Push'])
    expect(labels(mountHeader(null, { running: 'pull' }))).toEqual(['Fetch', 'Pulling…', 'Merge…', 'Push'])
    expect(labels(mountHeader(null, { running: 'merge' }))).toEqual(['Fetch', 'Pull', 'Merging…', 'Push'])
    expect(labels(mountHeader(null, { running: 'push' }))).toEqual(['Fetch', 'Pull', 'Merge…', 'Pushing…'])
    expect(labels(mountHeader(null, { running: 'checkout' }))).toEqual(['Fetch', 'Pull', 'Merge…', 'Push'])
  })

  it.each([
    ['Fetch', 'fetch'],
    ['Pull', 'pull'],
    ['Merge…', 'merge'],
    ['Push', 'push'],
  ])('emits when %s is clicked', async (label, event) => {
    const wrapper = mountHeader()
    const button = wrapper.findAll('button').find((b) => b.text() === label)!
    await button.trigger('click')
    expect(wrapper.emitted(event)).toHaveLength(1)
  })
})
