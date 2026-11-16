import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBar from '../StatusBar.vue'

const now = new Date('2026-11-15T12:00:00Z')

describe('StatusBar', () => {
  it('shows the status, and the open repository with its last fetch', () => {
    const wrapper = mount(StatusBar, {
      props: { status: 'Ready', repoName: 'tools', currentBranch: 'main', lastFetch: null, now },
    })
    expect(wrapper.get('[role="status"]').text()).toBe('Ready')
    expect(wrapper.text()).toContain('tools · main · Last fetch: never')
  })

  it('offers no update until one is ready', () => {
    expect(mount(StatusBar, { props: { status: 'Ready', now } }).find('button').exists()).toBe(false)
  })

  it('offers a restart into a downloaded update', async () => {
    const wrapper = mount(StatusBar, { props: { status: 'Ready', now, updateVersion: '0.2.1' } })
    const button = wrapper.get('button')
    expect(button.text()).toBe('Version 0.2.1 is ready · Restart now')
    await button.trigger('click')
    expect(wrapper.emitted('installUpdate')).toHaveLength(1)
  })

  it('says why a restart into the update failed', () => {
    const wrapper = mount(StatusBar, {
      props: { status: 'Ready', now, updateVersion: '0.2.1', updateProblem: 'disk full' },
    })
    expect(wrapper.text()).toContain('Couldn’t restart into the update: disk full')
  })
})
