import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import type { Repository } from '@/types/git'
import RepositoryList from '../RepositoryList.vue'

const listed: Repository[] = sampleRepositories.map((repo) => ({ ...repo, problem: null }))

function mountList(selectedId = 'inventory', repositories = listed) {
  return mount(RepositoryList, { props: { repositories, selectedId } })
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

  it('says "on detached HEAD" when a commit is checked out instead of a branch', () => {
    const wrapper = mountList('inventory', [{ ...listed[0]!, currentBranch: null }])
    expect(rows(wrapper)[0]!.text()).toContain('on detached HEAD')
  })

  it('shows why a repository can’t be read in place of its branch', () => {
    const wrapper = mountList('inventory', [{ ...listed[0]!, currentBranch: null, problem: 'Folder not found' }])
    expect(rows(wrapper)[0]!.text()).toContain('Folder not found')
    expect(rows(wrapper)[0]!.text()).not.toContain('on detached HEAD')
  })

  it('removes a repository from the list with its own button, without selecting it', async () => {
    const wrapper = mountList()
    await wrapper.get('button[aria-label="Remove pricing-api from the list"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['pricing']])
    expect(wrapper.emitted('select')).toBeUndefined()
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
