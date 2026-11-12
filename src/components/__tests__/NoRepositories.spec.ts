import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NoRepositories from '../NoRepositories.vue'

describe('NoRepositories', () => {
  it('invites the user to add a repository and says nothing will be changed', async () => {
    const wrapper = mount(NoRepositories)
    expect(wrapper.get('h1').text()).toBe('Add a repository to get started')
    expect(wrapper.text()).toContain('only reads it')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })
})
