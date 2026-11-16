import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NoRepositories from '../NoRepositories.vue'

const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find((b) => b.text() === text)

describe('NoRepositories', () => {
  it('invites the user to add a repository and says nothing will be changed', async () => {
    const wrapper = mount(NoRepositories)
    expect(wrapper.get('h1').text()).toBe('Add a repository to get started')
    expect(wrapper.text()).toContain('Browsing never changes a repository')
    await button(wrapper, 'Add repository…')!.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('offers to clone one instead', async () => {
    const wrapper = mount(NoRepositories)
    await button(wrapper, 'Clone repository…')!.trigger('click')
    expect(wrapper.emitted('clone')).toHaveLength(1)
  })

  it('offers no Clone on a host that can’t clone', () => {
    expect(button(mount(NoRepositories, { props: { canClone: false } }), 'Clone repository…')).toBeUndefined()
  })
})
