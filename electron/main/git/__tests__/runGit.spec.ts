// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { runGit } from '../runGit'

// `git hash-object --stdin` waits for its input to end, which never comes: a command that runs until stopped.
const WAITS_FOREVER = ['hash-object', '--stdin']

describe('runGit stopping a command', () => {
  it('stops git when its signal is aborted while it runs', async () => {
    const stop = new AbortController()
    const running = runGit(tmpdir(), WAITS_FOREVER, { signal: stop.signal })
    setTimeout(() => stop.abort(), 200)
    await expect(running).rejects.toThrow()
  }, 20_000)

  it('stops git straight away when its signal was aborted before it started', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(runGit(tmpdir(), WAITS_FOREVER, { signal: stop.signal })).rejects.toThrow()
  }, 20_000)

  it('passes stderr on as it arrives', async () => {
    const heard: string[] = []
    await expect(runGit(tmpdir(), ['no-such-command'], { onStderr: (chunk) => heard.push(chunk) })).rejects.toThrow()
    expect(heard.join('')).toContain('no-such-command')
  })
})
