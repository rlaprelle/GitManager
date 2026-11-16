// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GitDataSource } from '../../../src/services/GitDataSource'
import { MockGitDataSource } from '../../../src/services/MockGitDataSource'
import { IpcChannel, IpcEvent } from '../../shared/channels'
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

  it('clones into the chosen folder, sending progress to the window that asked', async () => {
    const handlers = new Map<string, Handler>()
    registerIpcHandlers({ handle: (channel, listener) => handlers.set(channel, listener as Handler) }, {
      source: new MockGitDataSource(undefined, 0),
      appVersion: '1.2.3',
      checkGit: async () => ({ state: 'missing', minimum: '2.30' }),
    })
    const sent: unknown[][] = []
    const window = { sender: { send: (...args: unknown[]) => sent.push(args) } }
    expect(await handlers.get(IpcChannel.ChooseCloneFolder)!(window)).toEqual({ ok: true, value: 'C:\\dev' })
    const result = (await handlers.get(IpcChannel.CloneRepository)!(window, { url: 'https://host/tools.git', name: 'tools' })) as {
      ok: true
      value: { message: string }
    }
    expect(result.value.message).toBe('Cloned tools')
    expect(sent[0]).toEqual([IpcEvent.CloneProgress, { phase: 'Receiving objects', percent: 0 }])
    expect(await handlers.get(IpcChannel.CancelClone)!(window)).toEqual({ ok: true, value: undefined })
  })

  it('reports no update and refuses to install one when this run doesn’t update itself', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.GetReadyUpdate)).toEqual({ ok: true, value: null })
    expect(await invoke(IpcChannel.InstallUpdate)).toEqual({ ok: false, message: 'Only the installed app updates itself' })
  })

  it('reports a downloaded update and restarts into it', async () => {
    const handlers = new Map<string, Handler>()
    let installed = 0
    registerIpcHandlers({ handle: (channel, listener) => handlers.set(channel, listener as Handler) }, {
      source: new MockGitDataSource(),
      appVersion: '1.2.3',
      checkGit: async () => ({ state: 'missing', minimum: '2.30' }),
      updates: { readyVersion: () => '0.2.1', install: () => void installed++ },
    })
    expect(await handlers.get(IpcChannel.GetReadyUpdate)!({})).toEqual({ ok: true, value: '0.2.1' })
    expect(await handlers.get(IpcChannel.InstallUpdate)!({})).toEqual({ ok: true, value: undefined })
    expect(installed).toBe(1)
  })

  it('passes the source only well-formed sides to compare', async () => {
    const invoke = registeredHandlers()
    const side = { kind: 'repository', repoId: 'inventory', branch: 'main', path: 'pom.xml' }
    const ok = (await invoke(IpcChannel.CompareFiles, side, { ...side, branch: 'origin/release/2.4' })) as { ok: boolean }
    expect(ok.ok).toBe(true)
    const refused = 'Expected a file to compare: { kind: "repository", repoId, branch, path } or { kind: "file", fileId }'
    expect(await invoke(IpcChannel.CompareFiles, 'pom.xml', side)).toEqual({ ok: false, message: refused })
    expect(await invoke(IpcChannel.CompareFiles, { kind: 'disk', path: 'C:/x' }, side)).toEqual({ ok: false, message: refused })
    expect(await invoke(IpcChannel.CompareFiles, { ...side, branch: 3 }, side)).toEqual({ ok: false, message: 'Expected text, got number' })
    expect(await invoke(IpcChannel.CompareFiles, { kind: 'file', fileId: 7 }, side)).toEqual({ ok: false, message: 'Expected text, got number' })
    expect(await invoke(IpcChannel.ListBranchFiles, 'inventory', ['main'])).toEqual({ ok: false, message: 'Expected text, got object' })
  })

  it('passes the source only a clone request of two pieces of text', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.CloneRepository, 'https://host/tools.git')).toEqual({
      ok: false,
      message: 'Expected a clone request: { url, name }',
    })
    expect(await invoke(IpcChannel.CloneRepository, { url: ['x'], name: 'tools' })).toEqual({
      ok: false,
      message: 'Expected text, got object',
    })
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

  it('fetches, pulls and pushes', async () => {
    const invoke = registeredHandlers()
    expect(await invoke(IpcChannel.Fetch, 'inventory')).toEqual({ ok: true, value: { message: 'Fetched: everything was up to date' } })
    expect(await invoke(IpcChannel.Pull, 'inventory', 'feature/stock-reservations')).toEqual({
      ok: true,
      value: { message: 'Already up to date with origin/feature/stock-reservations' },
    })
    expect(await invoke(IpcChannel.Push, 'inventory', 'feature/stock-reservations')).toEqual({
      ok: true,
      value: { message: 'Pushed 2 commits to origin/feature/stock-reservations' },
    })
  })

  it('passes fetch, pull and push only text', async () => {
    const received: unknown[][] = []
    const source = new MockGitDataSource()
    const record = async (...args: unknown[]) => (received.push(args), { message: 'done' })
    source.fetch = record
    source.pull = record
    source.push = record
    const invoke = registeredHandlers(source)
    expect(await invoke(IpcChannel.Fetch, { id: 'inventory' })).toEqual({ ok: false, message: 'Expected text, got object' })
    expect(await invoke(IpcChannel.Pull, 'inventory')).toEqual({ ok: false, message: 'Expected text, got undefined' })
    expect(await invoke(IpcChannel.Pull, 'inventory', ['main'])).toEqual({ ok: false, message: 'Expected text, got object' })
    expect(await invoke(IpcChannel.Push, 7, 'main')).toEqual({ ok: false, message: 'Expected text, got number' })
    expect(await invoke(IpcChannel.Push, 'inventory', true)).toEqual({ ok: false, message: 'Expected text, got boolean' })
    expect(received).toEqual([])
  })
})
