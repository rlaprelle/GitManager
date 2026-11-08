import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import CommitHistory from '../CommitHistory.vue'

const inventory = sampleRepositories[0]!

function mountHistory(selectedIndex = 0) {
  return mount(CommitHistory, {
    props: { commits: inventory.commits, selectedIndex, currentBranch: inventory.currentBranch },
  })
}

function rows(wrapper: ReturnType<typeof mountHistory>) {
  return wrapper.findAll('button[aria-pressed]')
}

describe('CommitHistory', () => {
  it('shows the commit count and one row per commit', () => {
    const wrapper = mountHistory()
    expect(wrapper.text()).toContain('10 commits · all branches')
    expect(rows(wrapper)).toHaveLength(10)
  })

  it('shows message, author, date and hash in each row', () => {
    const text = rows(mountHistory())[2]!.text()
    expect(text).toContain("Merge branch 'bugfix/sku-null-check'")
    expect(text).toContain('M. Okafor')
    expect(text).toContain('Yesterday 16:20')
    expect(text).toContain('c81f5a3')
  })

  it('marks the checked-out branch ref as HEAD and leaves others plain', () => {
    const wrapper = mountHistory()
    expect(rows(wrapper)[0]!.text()).toContain('HEAD → feature/stock-reservations')
    expect(rows(wrapper)[2]!.text()).not.toContain('HEAD')
    expect(rows(wrapper)[2]!.text()).toContain('origin/main')
  })

  it('draws a graph dot in every row', () => {
    expect(mountHistory().findAll('svg circle')).toHaveLength(10)
  })

  it('marks the selected commit and emits the clicked index', async () => {
    const wrapper = mountHistory(3)
    expect(rows(wrapper)[3]!.attributes('aria-pressed')).toBe('true')
    await rows(wrapper)[5]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[5]])
  })
})
