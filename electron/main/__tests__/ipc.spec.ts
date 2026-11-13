// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GitDataSource } from '../../../src/services/GitDataSource'
import { MockGitDataSource } from '../../../src/services/MockGitDataSource'
import { IpcChannel } from '../../shared/channels'
import { type IpcRegistrar, registerIpcHandlers } from '../ipc'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

/** Records handlers the way ipcMain.handle would, so tests can invoke them like the preload does. */
function registeredHandlers(source: GitDataSource = new MockGitDataSource()) {
  const handlers = new Map<string, Handler>()
  const ipc: IpcRegistrar = { handle: (channel, listener) => handlers.set(channel, listener as Handler) }
  registerIpcHandlers(ipc, {
    source,
    appVersion: '1.2.3',
    checkGit: async () => ({ state: 'ready', version: '2.46.1' }),
  })
  return (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
}

describe('registerIpcHandlers', () => {
  it('answers every channel the preload uses', () => {
    const handlers = new Set<string>()
    registerIpcHandlers({ handle: (channel) => handlers.add(channel) }, {
      source: new MockGitDataSource(),
      appVersion: '1.2.3',
      checkGit: async () => ({ state: 'missing', minimum: '2.30' }),
    })
    expect([...handlers].sort()).toEqual(Object.values(IpcChannel).sort())
  })

  it('wraps each answer as ok with its value', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.GetAppVersion)).toEqual({ ok: true, value: '1.2.3' })
    expect(await invoke(IpcChannel.GetGitStatus)).toEqual({ ok: true, value: { state: 'ready', version: '2.46.1' } })
    const history = (await invoke(IpcChannel.GetHistory, 'inventory', 2)) as { ok: true; value: { commits: unknown[] } }
    expect(history.ok).toBe(true)
    expect(history.value.commits).toHaveLength(2)
  })

  it('passes a failure on as its plain message, not Electron’s "Error invoking remote method" wrapper', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.GetBranches, 'no-such-repo')).toEqual({ ok: false, message: 'Unknown repository: no-such-repo' })
  })

  it('refuses arguments of the wrong type before they reach the data source', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.GetBranches, { id: 'inventory' })).toEqual({ ok: false, message: 'Expected text, got object' })
    expect(await invoke(IpcChannel.GetHistory, 'inventory', 'all')).toEqual({ ok: false, message: 'Expected a count from 1 to 10000' })
    expect(await invoke(IpcChannel.GetHistory, 'inventory', 1e9)).toEqual({ ok: false, message: 'Expected a count from 1 to 10000' })
    expect(await invoke(IpcChannel.GetFileDiff, 'inventory', '9f3a1c2')).toEqual({ ok: false, message: 'Expected text, got undefined' })
    expect(await invoke(IpcChannel.RemoveRepository, 7)).toEqual({ ok: false, message: 'Expected text, got number' })
  })

  it('adds and removes repositories', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.AddRepository)).toEqual({
      ok: true,
      value: { repository: null, message: 'Add repository: choose a folder that contains a .git directory' },
    })
    expect(await invoke(IpcChannel.RemoveRepository, 'pricing')).toEqual({ ok: true, value: { message: 'Removed pricing-api from the list' } })
  })

  it('checks out a local or a remote branch', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.Checkout, 'inventory', { local: 'main' })).toEqual({
      ok: true,
      value: { kind: 'switched', branch: 'main', message: 'Switched to main; 3 uncommitted changes came along' },
    })
    expect(await invoke(IpcChannel.Checkout, 'inventory', { remote: 'origin/release/2.4' })).toMatchObject({
      ok: true,
      value: { kind: 'switched', branch: 'release/2.4' },
    })
  })

  it('passes the source only a well-formed checkout target and options', async () => {
    const received: unknown[][] = []
    const source = new MockGitDataSource()
    source.checkout = async (...args) => {
      received.push(args)
      return { kind: 'confirm', commitsLeft: 1 }
    }
    const invoke = registeredHandlers(source)
    await invoke(IpcChannel.Checkout, 'inventory', { local: 'main' })
    await invoke(IpcChannel.Checkout, 'inventory', { remote: 'origin/x' }, { leaveCommits: true })
    expect(received).toEqual([
      ['inventory', { local: 'main' }, {}],
      ['inventory', { remote: 'origin/x' }, { leaveCommits: true }],
    ])

    const target = 'Expected a branch to check out: { local } or { remote }'
    const options = 'Expected checkout options: { leaveCommits?: boolean }'
    for (const [badTarget, badOptions, message] of [
      ['main', undefined, target],
      [{}, undefined, target],
      [{ local: 'main', remote: 'origin/main' }, undefined, target],
      [{ local: 7 }, undefined, target],
      [{ branch: 'main' }, undefined, target],
      [['main'], undefined, target],
      [null, undefined, target],
      [{ local: 'main' }, { leaveCommits: 'yes' }, options],
      [{ local: 'main' }, { leaveCommits: true, force: true }, options],
      [{ local: 'main' }, true, options],
    ] as const) {
      expect(await invoke(IpcChannel.Checkout, 'inventory', badTarget, badOptions), JSON.stringify([badTarget, badOptions])).toEqual({
        ok: false,
        message,
      })
    }
    expect(await invoke(IpcChannel.Checkout, 3, { local: 'main' })).toEqual({ ok: false, message: 'Expected text, got number' })
    expect(received).toHaveLength(2)
  })
})
