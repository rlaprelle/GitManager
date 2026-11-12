import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AppHeader from '../AppHeader.vue'

function mountHeader(syncLabel: string | null = '↑2 vs origin', writable = true) {
  return mount(AppHeader, { props: { repoName: 'inventory-service', currentBranch: 'main', syncLabel, writable } })
}

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

  it('hides Fetch, Pull and Push when the app can only read', () => {
    const labels = mountHeader('↑2 vs origin', false).findAll('button').map((b) => b.text())
    expect(labels).not.toContain('Fetch')
    expect(labels).not.toContain('Pull')
    expect(labels).not.toContain('Push')
  })

  it.each(['Fetch', 'Pull', 'Push'])('emits %s when its button is clicked', async (label) => {
    const wrapper = mountHeader()
    const button = wrapper.findAll('button').find((b) => b.text() === label)!
    await button.trigger('click')
    expect(wrapper.emitted(label.toLowerCase())).toHaveLength(1)
  })
})
