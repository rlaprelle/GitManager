import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { sampleRepositories } from '@/data/sampleRepositories'
import BranchList from '../BranchList.vue'

const inventory = sampleRepositories[0]!

function mountList(selectedBranch: string | null = 'feature/stock-reservations', props: Record<string, unknown> = {}) {
  return mount(BranchList, {
    props: {
      localBranches: inventory.localBranches,
      remoteBranches: inventory.remoteBranches,
      currentBranch: 'feature/stock-reservations',
      selectedBranch,
      checkoutableRemotes: ['origin/release/2.4'],
      ...props,
    },
  })
}

function branchButton(wrapper: ReturnType<typeof mountList>, name: string) {
  return wrapper.findAll('button[aria-pressed]').find((b) => b.text().includes(name) && !b.text().includes(`origin/${name}`))!
}

const checkoutButtons = (wrapper: ReturnType<typeof mountList>) =>
  wrapper.findAll('button').filter((b) => ['Checkout', 'Switching…'].includes(b.text()))

describe('BranchList', () => {
  it('offers no Checkout when the host can’t switch branches', () => {
    expect(checkoutButtons(mountList('main', { canCheckout: false }))).toHaveLength(0)
    expect(checkoutButtons(mountList('origin/release/2.4', { canCheckout: false }))).toHaveLength(0)
    expect(checkoutButtons(mountList('main'))).toHaveLength(1)
  })

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

  it('offers Checkout only for a selected local branch that is not checked out', () => {
    expect(checkoutButtons(mountList('feature/stock-reservations'))).toHaveLength(0)
    expect(checkoutButtons(mountList('main'))).toHaveLength(1)
  })

  it('offers Checkout on a selected remote branch only when it has no local branch', () => {
    expect(checkoutButtons(mountList('origin/release/2.4'))).toHaveLength(1)
    expect(checkoutButtons(mountList('origin/main'))).toHaveLength(0)
    expect(checkoutButtons(mountList('origin/feature/stock-reservations'))).toHaveLength(0)
  })

  it('shows each branch’s full name as a tooltip, since long names are cut short', () => {
    const titles = mountList().findAll('span.font-mono').map((span) => span.attributes('title'))
    expect(titles).toContain('bugfix/sku-null-check')
    expect(titles).toContain('origin/feature/stock-reservations')
  })

  it('emits select for local and remote branches', async () => {
    const wrapper = mountList()
    await branchButton(wrapper, 'main').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'origin/release/2.4')!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['main'], ['origin/release/2.4']])
  })

  it('emits checkout with the selected local branch', async () => {
    const wrapper = mountList('main')
    await checkoutButtons(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('checkout')).toEqual([['main']])
    expect(wrapper.emitted('checkoutRemote')).toBeUndefined()
  })

  it('emits checkoutRemote with the selected remote branch', async () => {
    const wrapper = mountList('origin/release/2.4')
    await checkoutButtons(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('checkoutRemote')).toEqual([['origin/release/2.4']])
    expect(wrapper.emitted('checkout')).toBeUndefined()
  })

  it('disables Checkout while an operation runs', async () => {
    for (const selected of ['main', 'origin/release/2.4']) {
      const wrapper = mountList(selected, { busy: true })
      const [button] = checkoutButtons(wrapper)
      expect(button!.text()).toBe('Checkout')
      expect(button!.attributes('disabled')).toBeDefined()
      await button!.trigger('click')
      expect(wrapper.emitted('checkout')).toBeUndefined()
      expect(wrapper.emitted('checkoutRemote')).toBeUndefined()
    }
  })

  it('says it’s switching while a checkout runs', () => {
    for (const selected of ['main', 'origin/release/2.4']) {
      const [button] = checkoutButtons(mountList(selected, { busy: true, switching: true }))
      expect(button!.text()).toBe('Switching…')
    }
  })
})

describe('BranchList with no branches yet', () => {
  it('leaves out the Local and Remote headings when there is nothing under them', () => {
    const wrapper = mount(BranchList, {
      props: { localBranches: [], remoteBranches: [], currentBranch: 'main', selectedBranch: 'main' },
    })
    expect(wrapper.text()).not.toContain('Local')
    expect(wrapper.text()).not.toContain('Remote')
  })
})
