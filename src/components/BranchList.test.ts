import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import BranchList from './BranchList.vue'

const inventory = sampleRepositories[0]!

function mountList(selectedBranch: string | null = 'feature/stock-reservations') {
  return mount(BranchList, {
    props: {
      localBranches: inventory.localBranches,
      remoteBranches: inventory.remoteBranches,
      currentBranch: 'feature/stock-reservations',
      selectedBranch,
    },
  })
}

function branchButton(wrapper: ReturnType<typeof mountList>, name: string) {
  return wrapper.findAll('button[aria-pressed]').find((b) => b.text().includes(name) && !b.text().includes(`origin/${name}`))!
}

describe('BranchList', () => {
  it('lists local and remote branches', () => {
    const text = mountList().text()
    expect(text).toContain('bugfix/sku-null-check')
    expect(text).toContain('origin/release/2.4')
  })

  it('tags the checked-out branch with HEAD and its sync state', () => {
    const current = branchButton(mountList(), 'feature/stock-reservations')
    expect(current.text()).toContain('HEAD')
    expect(current.text()).toContain('↑2')
  })

  it('offers Checkout only for a selected branch that is not checked out', () => {
    expect(mountList('feature/stock-reservations').text()).not.toContain('Checkout')
    expect(mountList('main').text()).toContain('Checkout')
  })

  it('emits select for local and remote branches', async () => {
    const wrapper = mountList()
    await branchButton(wrapper, 'main').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'origin/release/2.4')!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['main'], ['origin/release/2.4']])
  })

  it('emits checkout with the selected branch', async () => {
    const wrapper = mountList('main')
    await wrapper.findAll('button').find((b) => b.text() === 'Checkout')!.trigger('click')
    expect(wrapper.emitted('checkout')).toEqual([['main']])
  })
})
