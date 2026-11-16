// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, type UpdaterLike, startUpdateChecks } from '../updates'

/** Stands in for electron-updater's autoUpdater: checks are counted, events are emitted by the test. */
function fakeUpdater(check: () => Promise<unknown> = async () => null) {
  const emitter = new EventEmitter()
  const updater = Object.assign(emitter, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(check),
    quitAndInstall: vi.fn(),
  })
  return updater as typeof updater & UpdaterLike
}

describe('startUpdateChecks', () => {
  it('downloads updates by itself and installs them on quit if the user never restarts', () => {
    const updater = fakeUpdater()
    startUpdateChecks(updater, () => {})
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('checks when the app starts, then every 4 hours', () => {
    vi.useFakeTimers()
    try {
      const updater = fakeUpdater()
      startUpdateChecks(updater, () => {})
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
      expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says which version is ready once it has downloaded', () => {
    const updater = fakeUpdater()
    const notify = vi.fn()
    const updates = startUpdateChecks(updater, notify)
    expect(updates.readyVersion()).toBeNull()
    updater.emit('update-downloaded', { version: '0.2.1' })
    expect(notify).toHaveBeenCalledWith('0.2.1')
    expect(updates.readyVersion()).toBe('0.2.1')
  })

  it('restarts into the update only once one is ready', () => {
    const updater = fakeUpdater()
    const updates = startUpdateChecks(updater, () => {})
    expect(() => updates.install()).toThrow('No update is ready to install')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updater.emit('update-downloaded', { version: '0.2.1' })
    updates.install()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('shrugs off a failed check (offline, GitHub down) and an updater error; the next check tries again', async () => {
    const updater = fakeUpdater(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    const log = vi.fn()
    startUpdateChecks(updater, () => {}, log)
    updater.emit('error', new Error('checksum mismatch'))
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Update check failed: checksum mismatch',
      'Update check failed: net::ERR_INTERNET_DISCONNECTED',
    ])
  })
})
