import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RepositoryOperation } from '@/services/GitDataSource'
import AppHeader from '../AppHeader.vue'

function mountHeader(syncLabel: string | null = '↑2 vs origin', more: { operations?: RepositoryOperation[]; running?: RepositoryOperation | null } = {}) {
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
    expect(labels(mountHeader(null))).toEqual(['Fetch', 'Pull', 'Push'])
  })

  it.each(['checkout', 'fetch', 'pull', 'push'] as const)('disables its buttons while %s runs', async (running) => {
    const wrapper = mountHeader(null, { running })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled'), button.text()).toBeDefined()
      await button.trigger('click')
    }
    expect(wrapper.emitted()).not.toHaveProperty('fetch')
    expect(wrapper.emitted()).not.toHaveProperty('pull')
    expect(wrapper.emitted()).not.toHaveProperty('push')
  })

  it('says which operation is running on its button', () => {
    expect(labels(mountHeader(null, { running: 'fetch' }))).toEqual(['Fetching…', 'Pull', 'Push'])
    expect(labels(mountHeader(null, { running: 'pull' }))).toEqual(['Fetch', 'Pulling…', 'Push'])
    expect(labels(mountHeader(null, { running: 'push' }))).toEqual(['Fetch', 'Pull', 'Pushing…'])
    expect(labels(mountHeader(null, { running: 'checkout' }))).toEqual(['Fetch', 'Pull', 'Push'])
  })

  it.each(['Fetch', 'Pull', 'Push'])('emits %s when its button is clicked', async (label) => {
    const wrapper = mountHeader()
    const button = wrapper.findAll('button').find((b) => b.text() === label)!
    await button.trigger('click')
    expect(wrapper.emitted(label.toLowerCase())).toHaveLength(1)
  })
})
