import { describe, expect, it } from 'vitest'
import { useReporter } from '../reporter'

const shown = (reporting: ReturnType<typeof useReporter>) =>
  reporting.toasts.value.map(({ kind, message, context }) => ({ kind, message, context }))

describe('useReporter', () => {
  it('starts with nothing to say', () => {
    const reporting = useReporter()
    expect(reporting.status.value).toBe('Ready')
    expect(reporting.toasts.value).toEqual([])
  })

  it('puts running commentary in the status bar, and nowhere else', () => {
    const reporting = useReporter()
    reporting.report.info('Fetching…')
    reporting.report.info('Fetched: everything was up to date')
    expect(reporting.status.value).toBe('Fetched: everything was up to date')
    expect(reporting.toasts.value).toEqual([])
  })

  it.each([
    ['notice', 'notice'],
    ['warn', 'warning'],
    ['failure', 'failure'],
  ] as const)('raises a %s as a toast too, since the status bar is easy to miss', (level, kind) => {
    const reporting = useReporter()
    reporting.report[level]('Something to know')
    expect(reporting.status.value).toBe('Something to know')
    expect(shown(reporting)).toEqual([{ kind, message: 'Something to know', context: null }])
  })

  it('names the repository a lasting message is about', () => {
    const reporting = useReporter()
    reporting.report.failure('Failed: no upstream branch', { repository: 'pricing-api' })
    expect(shown(reporting)).toEqual([{ kind: 'failure', message: 'Failed: no upstream branch', context: 'pricing-api' }])
  })

  it('doesn’t announce again what the user is already being shown, but still logs it', () => {
    const reporting = useReporter()
    reporting.report.failure('Failed: that folder isn’t empty', { alreadyShown: true })
    expect(reporting.status.value).toBe('Failed: that folder isn’t empty')
    expect(reporting.toasts.value).toEqual([])
  })

  it('takes a message back once it no longer holds, and lets the user dismiss one', () => {
    const reporting = useReporter()
    reporting.report.warn('This merge couldn’t be saved')
    reporting.report.notice('Your merge is waiting')
    reporting.report.retract('This merge couldn’t be saved')
    expect(shown(reporting).map((toast) => toast.message)).toEqual(['Your merge is waiting'])
    reporting.dismissToast(reporting.toasts.value[0]!.id)
    expect(reporting.toasts.value).toEqual([])
  })
})
