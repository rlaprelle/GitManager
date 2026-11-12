// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MockGitDataSource } from '../../../src/services/MockGitDataSource'
import { IpcChannel } from '../../shared/channels'
import { type IpcRegistrar, registerIpcHandlers } from '../ipc'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

/** Records handlers the way ipcMain.handle would, so tests can invoke them like the preload does. */
function registeredHandlers() {
  const handlers = new Map<string, Handler>()
  const ipc: IpcRegistrar = { handle: (channel, listener) => handlers.set(channel, listener as Handler) }
  registerIpcHandlers(ipc, {
    source: new MockGitDataSource(),
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
})
