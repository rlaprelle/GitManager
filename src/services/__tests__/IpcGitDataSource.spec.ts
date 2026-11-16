import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import type { GitBridge } from '@/types/bridge'
import type { CloneProgress } from '@/types/git'
import { IpcGitDataSource } from '../IpcGitDataSource'
import { MockGitDataSource } from '../MockGitDataSource'

/** A bridge that records each call and answers from the mock, as main would from real git. */
function recordingBridge() {
  const calls: unknown[][] = []
  const mock = new MockGitDataSource(undefined, 0)
  const progressListeners = new Set<(progress: CloneProgress) => void>()
  const bridge: GitBridge = {
    listRepositories: (...args) => (calls.push(['listRepositories', ...args]), mock.listRepositories()),
    getBranches: (...args) => (calls.push(['getBranches', ...args]), mock.getBranches(...args)),
    getHistory: (...args) => (calls.push(['getHistory', ...args]), mock.getHistory(...args)),
    getCommitFiles: (...args) => (calls.push(['getCommitFiles', ...args]), mock.getCommitFiles(...args)),
    getFileDiff: (...args) => (calls.push(['getFileDiff', ...args]), mock.getFileDiff(...args)),
    compareFiles: (...args) => (calls.push(['compareFiles', ...args]), mock.compareFiles(...args)),
    addRepository: (...args) => (calls.push(['addRepository', ...args]), mock.addRepository()),
    removeRepository: (...args) => (calls.push(['removeRepository', ...args]), mock.removeRepository(...args)),
    chooseCloneFolder: (...args) => (calls.push(['chooseCloneFolder', ...args]), mock.chooseCloneFolder()),
    // As main does: progress travels separately, to whoever is listening.
    cloneRepository: (...args) => (
      calls.push(['cloneRepository', ...args]),
      mock.cloneRepository(args[0], (progress) => progressListeners.forEach((listener) => listener(progress)))
    ),
    cancelClone: (...args) => (calls.push(['cancelClone', ...args]), mock.cancelClone()),
    onCloneProgress: (listener) => {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    },
    checkout: (...args) => (calls.push(['checkout', ...args]), mock.checkout(...args)),
    fetch: (...args) => (calls.push(['fetch', ...args]), mock.fetch(...args)),
    pull: (...args) => (calls.push(['pull', ...args]), mock.pull(...args)),
    push: (...args) => (calls.push(['push', ...args]), mock.push(...args)),
  }
  return { bridge, calls, progressListeners }
}

describe('IpcGitDataSource', () => {
  it('forwards every call, with its arguments, to the bridge', async () => {
    const { bridge, calls } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await source.listRepositories()
    await source.getBranches('inventory')
    await source.getHistory('inventory', 5)
    await source.getCommitFiles('inventory', '9f3a1c2')
    await source.getFileDiff('inventory', '9f3a1c2', 'src/main/resources/application.yml')
    await source.compareFiles('inventory', 'a.yml', 'b.yml')
    await source.addRepository()
    await source.removeRepository('pricing')
    await source.chooseCloneFolder()
    await source.cloneRepository({ url: 'https://host/tools.git', name: 'tools' })
    await source.cancelClone()
    await source.checkout('inventory', { remote: 'origin/release/2.4' }, { leaveCommits: true })
    await source.fetch('inventory')
    await source.pull('inventory', 'release/2.4')
    await source.push('inventory', 'release/2.4')
    expect(calls).toEqual([
      ['listRepositories'],
      ['getBranches', 'inventory'],
      ['getHistory', 'inventory', 5],
      ['getCommitFiles', 'inventory', '9f3a1c2'],
      ['getFileDiff', 'inventory', '9f3a1c2', 'src/main/resources/application.yml'],
      ['compareFiles', 'inventory', 'a.yml', 'b.yml'],
      ['addRepository'],
      ['removeRepository', 'pricing'],
      ['chooseCloneFolder'],
      ['cloneRepository', { url: 'https://host/tools.git', name: 'tools' }],
      ['cancelClone'],
      ['checkout', 'inventory', { remote: 'origin/release/2.4' }, { leaveCommits: true }],
      ['fetch', 'inventory'],
      ['pull', 'inventory', 'release/2.4'],
      ['push', 'inventory', 'release/2.4'],
    ])
  })

  it('hands a clone’s progress events to its caller, and stops listening when the clone ends', async () => {
    const { bridge, calls, progressListeners } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await source.chooseCloneFolder()
    const heard: CloneProgress[] = []
    const result = await source.cloneRepository(reactive({ url: 'https://host/tools.git', name: 'tools' }), (progress) =>
      heard.push(progress),
    )
    expect(result.repository?.name).toBe('tools')
    expect(heard.at(-1)).toEqual({ phase: 'Resolving deltas', percent: 100 })
    expect(progressListeners.size).toBe(0)
    expect(() => structuredClone(calls.at(-1))).not.toThrow()

    await expect(source.cloneRepository({ url: 'https://host/tools.git', name: 'tools' }, () => {})).rejects.toThrow(
      'already exists',
    )
    expect(progressListeners.size).toBe(0)
  })

  it('sends plain copies over IPC, even of Vue reactive objects, which IPC can’t clone', async () => {
    const { bridge, calls } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await source.checkout('inventory', reactive({ local: 'main' }), reactive({ leaveCommits: true }))
    await source.checkout('inventory', reactive({ remote: 'origin/release/2.4' }))
    for (const [, , target, options] of calls) {
      // Electron's IPC clones its arguments the way structuredClone does, which throws on a proxy.
      expect(() => structuredClone([target, options])).not.toThrow()
    }
    expect(calls.map((call) => call.slice(2))).toEqual([
      [{ local: 'main' }, { leaveCommits: true }],
      [{ remote: 'origin/release/2.4' }, {}],
    ])
  })
})
