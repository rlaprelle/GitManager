import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { UpdateSource } from '@/types/bridge'
import { useUpdateNotice } from '../useUpdateNotice'

function fakeUpdates(alreadyReady: string | null = null) {
  const listeners = new Set<(version: string) => void>()
  const updates: UpdateSource = {
    readyVersion: vi.fn(async () => alreadyReady),
    onReady: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    install: vi.fn(async () => {}),
  }
  return { updates, announce: (version: string) => listeners.forEach((listener) => listener(version)), listeners }
}

describe('useUpdateNotice', () => {
  it('has nothing to offer without an update source (the browser build)', async () => {
    const notice = useUpdateNotice(undefined)
    expect(notice.readyVersion.value).toBeNull()
    await notice.install()
    expect(notice.problem.value).toBeNull()
  })

  it('picks up an update that downloaded before it was listening', async () => {
    const { updates } = fakeUpdates('0.2.1')
    const notice = useUpdateNotice(updates)
    await vi.waitFor(() => expect(notice.readyVersion.value).toBe('0.2.1'))
  })

  it('hears of an update when it downloads, and stops listening with its scope', () => {
    const { updates, announce, listeners } = fakeUpdates()
    const scope = effectScope()
    const notice = scope.run(() => useUpdateNotice(updates))!
    announce('0.2.2')
    expect(notice.readyVersion.value).toBe('0.2.2')
    scope.stop()
    expect(listeners.size).toBe(0)
  })

  it('restarts into the update, and says why if it can’t', async () => {
    const { updates } = fakeUpdates('0.2.1')
    const notice = useUpdateNotice(updates)
    await notice.install()
    expect(updates.install).toHaveBeenCalledTimes(1)
    vi.mocked(updates.install).mockRejectedValueOnce(new Error('Only the installed app updates itself'))
    await notice.install()
    expect(notice.problem.value).toBe('Only the installed app updates itself')
  })
})
