import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useNow } from '../useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves on every minute, so date labels roll over at midnight', () => {
    const scope = effectScope()
    const now = scope.run(() => useNow())!
    expect(now.value.getDate()).toBe(10)

    vi.advanceTimersByTime(60_000)
    expect(now.value.getDate()).toBe(11)
    scope.stop()
  })

  it('stops ticking when its owner goes away', () => {
    const scope = effectScope()
    const now = scope.run(() => useNow())!
    scope.stop()
    const stopped = now.value

    vi.advanceTimersByTime(5 * 60_000)
    expect(now.value).toBe(stopped)
  })
})
