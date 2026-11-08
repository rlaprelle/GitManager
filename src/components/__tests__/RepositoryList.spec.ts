import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import RepositoryList from '../RepositoryList.vue'

function mountList(selectedId = 'inventory') {
  return mount(RepositoryList, { props: { repositories: sampleRepositories, selectedId } })
}

function rows(wrapper: ReturnType<typeof mountList>) {
  return wrapper.findAll('button[aria-pressed]')
}

describe('RepositoryList', () => {
  it('lists every repository with its path and current branch', () => {
    const [first] = rows(mountList())
    expect(rows(mountList())).toHaveLength(5)
    expect(first!.text()).toContain('inventory-service')
    expect(first!.text()).toContain('C:\\dev\\inventory-service')
    expect(first!.text()).toContain('on feature/stock-reservations')
  })

  it('shows a changed-files badge only for repositories with local changes', () => {
    const texts = rows(mountList()).map((r) => r.text())
    expect(texts[0]).toContain('3 changed')
    expect(texts[1]).not.toContain('changed')
  })

  it('marks only the selected repository as pressed', () => {
    const pressed = rows(mountList('pricing')).map((r) => r.attributes('aria-pressed'))
    expect(pressed).toEqual(['false', 'true', 'false', 'false', 'false'])
  })

  it('emits the repository id when a row is clicked', async () => {
    const wrapper = mountList()
    await rows(wrapper)[2]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['storefront']])
  })

  it('emits add from the add-repository button', async () => {
    const wrapper = mountList()
    await wrapper.get('button[aria-label="Add repository"]').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })
})
