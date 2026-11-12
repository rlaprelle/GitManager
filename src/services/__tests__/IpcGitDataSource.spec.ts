import { describe, expect, it } from 'vitest'
import type { GitReadBridge } from '@/types/bridge'
import { IpcGitDataSource } from '../IpcGitDataSource'
import { MockGitDataSource } from '../MockGitDataSource'

/** A bridge that records each call and answers from the mock, as main would from real git. */
function recordingBridge() {
  const calls: unknown[][] = []
  const mock = new MockGitDataSource()
  const bridge: GitReadBridge = {
    listRepositories: (...args) => (calls.push(['listRepositories', ...args]), mock.listRepositories()),
    getBranches: (...args) => (calls.push(['getBranches', ...args]), mock.getBranches(...args)),
    getHistory: (...args) => (calls.push(['getHistory', ...args]), mock.getHistory(...args)),
    getCommitFiles: (...args) => (calls.push(['getCommitFiles', ...args]), mock.getCommitFiles(...args)),
    getFileDiff: (...args) => (calls.push(['getFileDiff', ...args]), mock.getFileDiff(...args)),
    compareFiles: (...args) => (calls.push(['compareFiles', ...args]), mock.compareFiles(...args)),
  }
  return { bridge, calls }
}

describe('IpcGitDataSource', () => {
  it('forwards every read call, with its arguments, to the bridge', async () => {
    const { bridge, calls } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await source.listRepositories()
    await source.getBranches('inventory')
    await source.getHistory('inventory', 5)
    await source.getCommitFiles('inventory', '9f3a1c2')
    await source.getFileDiff('inventory', '9f3a1c2', 'src/main/resources/application.yml')
    await source.compareFiles('inventory', 'a.yml', 'b.yml')
    expect(calls).toEqual([
      ['listRepositories'],
      ['getBranches', 'inventory'],
      ['getHistory', 'inventory', 5],
      ['getCommitFiles', 'inventory', '9f3a1c2'],
      ['getFileDiff', 'inventory', '9f3a1c2', 'src/main/resources/application.yml'],
      ['compareFiles', 'inventory', 'a.yml', 'b.yml'],
    ])
  })

  it('rejects write operations without calling the bridge', async () => {
    const { bridge, calls } = recordingBridge()
    const source = new IpcGitDataSource(bridge)
    await expect(source.checkout('inventory', 'main')).rejects.toThrow("Checkout isn't available in this version yet")
    await expect(source.fetch('inventory')).rejects.toThrow("Fetch isn't available")
    await expect(source.pull('inventory', 'main')).rejects.toThrow("Pull isn't available")
    await expect(source.push('inventory', 'main')).rejects.toThrow("Push isn't available")
    expect(calls).toEqual([])
  })
})
