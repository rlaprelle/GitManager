import { describe, expect, it } from 'vitest'
import { MAX_TOASTS, useToasts } from '../toasts'

describe('useToasts', () => {
  it('shows toasts in the order they came, a notice unless told otherwise', () => {
    const { toasts, showToast } = useToasts()
    showToast('First')
    showToast('Second', 'warning')
    expect(toasts.value.map(({ kind, message }) => ({ kind, message }))).toEqual([
      { kind: 'notice', message: 'First' },
      { kind: 'warning', message: 'Second' },
    ])
  })

  it('keeps a toast until it is dismissed, and dismisses only that one', () => {
    const { toasts, showToast, dismissToast } = useToasts()
    showToast('Stays')
    showToast('Goes')
    dismissToast(toasts.value[1]!.id)
    expect(toasts.value.map((toast) => toast.message)).toEqual(['Stays'])
  })

  it('doesn’t repeat a message that is already showing, but shows it again once dismissed', () => {
    const { toasts, showToast, dismissToast } = useToasts()
    showToast('Once')
    showToast('Once')
    expect(toasts.value).toHaveLength(1)
    dismissToast(toasts.value[0]!.id)
    showToast('Once')
    expect(toasts.value).toHaveLength(1)
  })

  it('gives every toast its own id, a dismissed one’s included', () => {
    const { toasts, showToast, dismissToast } = useToasts()
    showToast('First')
    const first = toasts.value[0]!.id
    dismissToast(first)
    showToast('Second')
    expect(toasts.value[0]!.id).not.toBe(first)
  })

  it('takes back a toast by what it says, leaving the others', () => {
    const { toasts, showToast, retractToast } = useToasts()
    showToast('No longer true', 'warning')
    showToast('Still true')
    retractToast('No longer true')
    retractToast('Never said')
    expect(toasts.value.map((toast) => toast.message)).toEqual(['Still true'])
  })

  it('drops the oldest when more than fit are showing', () => {
    const { toasts, showToast } = useToasts()
    for (let number = 1; number <= MAX_TOASTS + 1; number++) showToast(`Toast ${number}`)
    expect(toasts.value).toHaveLength(MAX_TOASTS)
    expect(toasts.value[0]!.message).toBe('Toast 2')
  })
})
