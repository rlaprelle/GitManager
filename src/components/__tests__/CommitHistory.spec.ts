import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import { sampleHistoryPage } from '@/services/MockGitDataSource'
import type { Commit } from '@/types/git'
import CommitHistory from '../CommitHistory.vue'

const inventory = sampleRepositories[0]!
const inventoryCommits = sampleHistoryPage(inventory, 200).commits

function mountHistory(
  selectedIndex = 0,
  overrides: { hasMore?: boolean; loading?: boolean; commits?: Commit[] } = {},
) {
  const loading = overrides.loading ?? false
  return mount(CommitHistory, {
    props: {
      commits: loading ? [] : (overrides.commits ?? inventoryCommits),
      hasMore: overrides.hasMore ?? false,
      loading,
      selectedIndex,
      currentBranch: inventory.currentBranch,
      now: new Date(),
    },
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

  it('says when only the newest commits are shown', () => {
    expect(mountHistory(0, { hasMore: true }).text()).toContain('Showing the latest 10 commits · all branches')
  })

  it('shows a loading message instead of rows while the history loads', () => {
    const wrapper = mountHistory(0, { loading: true })
    expect(wrapper.text()).toContain('Loading history…')
    expect(wrapper.text()).not.toContain('0 commits')
    expect(rows(wrapper)).toHaveLength(0)
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

  it('gives every ref badge its full name as a tooltip, since narrow rows truncate it', () => {
    const titles = rows(mountHistory())[3]!.findAll('[title]').map((badge) => badge.attributes('title'))
    expect(titles).toEqual(['bugfix/sku-null-check', 'origin/bugfix/sku-null-check'])
    expect(rows(mountHistory())[0]!.find('[title]').attributes('title')).toBe('HEAD → feature/stock-reservations')
  })

  it('draws a graph dot in every row', () => {
    expect(mountHistory().findAll('svg circle')).toHaveLength(10)
  })

  it('keeps the design’s 64px graph column for three lanes and widens it for more', () => {
    const graphWidth = (wrapper: ReturnType<typeof mountHistory>) => wrapper.get('svg').attributes('width')
    expect(graphWidth(mountHistory())).toBe('64')
    const wide = inventoryCommits.map((commit, index) => (index === 0 ? { ...commit, graph: { ...commit.graph, lane: 5 } } : commit))
    expect(graphWidth(mountHistory(0, { commits: wide }))).toBe('118')
  })

  it('marks the selected commit and emits the clicked index', async () => {
    const wrapper = mountHistory(3)
    expect(rows(wrapper)[3]!.attributes('aria-pressed')).toBe('true')
    await rows(wrapper)[5]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[5]])
  })
})
