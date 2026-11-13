import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import type { GitBridge } from '@/types/bridge'
import { IpcGitDataSource } from '../IpcGitDataSource'
import { MockGitDataSource } from '../MockGitDataSource'

/** A bridge that records each call and answers from the mock, as main would from real git. */
function recordingBridge() {
  const calls: unknown[][] = []
  const mock = new MockGitDataSource()
  const bridge: GitBridge = {
    listRepositories: (...args) => (calls.push(['listRepositories', ...args]), mock.listRepositories()),
    getBranches: (...args) => (calls.push(['getBranches', ...args]), mock.getBranches(...args)),
    getHistory: (...args) => (calls.push(['getHistory', ...args]), mock.getHistory(...args)),
    getCommitFiles: (...args) => (calls.push(['getCommitFiles', ...args]), mock.getCommitFiles(...args)),
    getFileDiff: (...args) => (calls.push(['getFileDiff', ...args]), mock.getFileDiff(...args)),
    compareFiles: (...args) => (calls.push(['compareFiles', ...args]), mock.compareFiles(...args)),
    addRepository: (...args) => (calls.push(['addRepository', ...args]), mock.addRepository()),
    removeRepository: (...args) => (calls.push(['removeRepository', ...args]), mock.removeRepository(...args)),
    checkout: (...args) => (calls.push(['checkout', ...args]), mock.checkout(...args)),
  }
  return { bridge, calls }
}

describe('IpcGitDataSource', () => {
  it('forwards every call it supports, with its arguments, to the bridge', async () => {
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
    await source.checkout('inventory', { remote: 'origin/release/2.4' }, { leaveCommits: true })
    expect(calls).toEqual([
      ['listRepositories'],
      ['getBranches', 'inventory'],
      ['getHistory', 'inventory', 5],
      ['getCommitFiles', 'inventory', '9f3a1c2'],
      ['getFileDiff', 'inventory', '9f3a1c2', 'src/main/resources/application.yml'],
      ['compareFiles', 'inventory', 'a.yml', 'b.yml'],
      ['addRepository'],
      ['removeRepository', 'pricing'],
      ['checkout', 'inventory', { remote: 'origin/release/2.4' }, { leaveCommits: true }],
    ])
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

  it('rejects Fetch, Pull and Push without calling the bridge', async () => {
    const { bridge, calls } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await expect(source.fetch('inventory')).rejects.toThrow("Fetch isn't available")
    await expect(source.pull('inventory', 'main')).rejects.toThrow("Pull isn't available")
    await expect(source.push('inventory', 'main')).rejects.toThrow("Push isn't available")
    expect(calls).toEqual([])
  })
})
