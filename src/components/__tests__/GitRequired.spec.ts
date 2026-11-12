import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GitRequired from '../GitRequired.vue'

describe('GitRequired', () => {
  it('explains that git is missing and where to get it', () => {
    const wrapper = mount(GitRequired, { props: { status: { state: 'missing', minimum: '2.30' } } })
    expect(wrapper.get('h1').text()).toBe('Git Manager needs Git for Windows')
    expect(wrapper.text()).toContain('Git wasn’t found on this computer.')
    expect(wrapper.text()).toContain('https://git-scm.com/download/win')
    expect(wrapper.text()).toContain('then restart Git Manager')
  })

  it('names the installed and the required version when git is too old', () => {
    const wrapper = mount(GitRequired, { props: { status: { state: 'too-old', version: '2.29.2', minimum: '2.30' } } })
    expect(wrapper.text()).toContain('Git 2.29.2 is installed, but Git Manager needs 2.30 or newer.')
  })
})
