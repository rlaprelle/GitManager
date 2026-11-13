import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RepositoryOperation } from '@/services/GitDataSource'
import AppHeader from '../AppHeader.vue'

function mountHeader(syncLabel: string | null = '↑2 vs origin', more: { operations?: RepositoryOperation[]; busy?: boolean } = {}) {
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

  it('disables its buttons while an operation runs', async () => {
    const wrapper = mountHeader(null, { busy: true })
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled'), button.text()).toBeDefined()
      await button.trigger('click')
    }
    expect(wrapper.emitted()).not.toHaveProperty('fetch')
    expect(wrapper.emitted()).not.toHaveProperty('push')
  })

  it.each(['Fetch', 'Pull', 'Push'])('emits %s when its button is clicked', async (label) => {
    const wrapper = mountHeader()
    const button = wrapper.findAll('button').find((b) => b.text() === label)!
    await button.trigger('click')
    expect(wrapper.emitted(label.toLowerCase())).toHaveLength(1)
  })
})
