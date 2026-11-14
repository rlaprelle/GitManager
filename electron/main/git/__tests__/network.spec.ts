// @vitest-environment node
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  SSH_WITH_TIMEOUTS,
  STALL_SETTINGS,
  askpassBeside,
  hasOwnSshCommand,
  networkAccess,
  networkAccessFor,
} from '../network'
import { gitMessage, runGit } from '../runGit'
import { type Fixtures, createFixtures, createScratchRepository, gitInFixture, removeFixtures } from './fixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

describe('networkAccess', () => {
  it('lets git and ssh ask through the sign-in window, even without a terminal', () => {
    const { env } = networkAccess('C:\\Git\\mingw64\\bin\\git-askpass.exe', false)
    expect(env).toMatchObject({
      GIT_ASKPASS: 'C:\\Git\\mingw64\\bin\\git-askpass.exe',
      SSH_ASKPASS: 'C:\\Git\\mingw64\\bin\\git-askpass.exe',
      SSH_ASKPASS_REQUIRE: 'force',
    })
  })

  it('never tells Git Credential Manager to stay hidden', () => {
    expect(networkAccess('askpass.exe', false).env).not.toHaveProperty('GCM_INTERACTIVE')
  })

  it('sets no prompt program when git has none', () => {
    const { env } = networkAccess(null, false)
    expect(env).not.toHaveProperty('GIT_ASKPASS')
    expect(env).not.toHaveProperty('SSH_ASKPASS')
    expect(env).not.toHaveProperty('SSH_ASKPASS_REQUIRE')
  })

  it('gives ssh timeouts, and HTTPS a stall limit', () => {
    const access = networkAccess('askpass.exe', false)
    expect(access.env.GIT_SSH_COMMAND).toBe(SSH_WITH_TIMEOUTS)
    expect(access.settings).toEqual(STALL_SETTINGS)
  })

  it('leaves the user’s own ssh command alone', () => {
    const access = networkAccess('askpass.exe', true)
    expect(access.env).not.toHaveProperty('GIT_SSH_COMMAND')
    expect(access.settings).toEqual(STALL_SETTINGS)
  })
})

describe('hasOwnSshCommand', () => {
  it('is false when nothing names an ssh command', () => {
    expect(hasOwnSshCommand({}, '')).toBe(false)
    expect(hasOwnSshCommand({ GIT_SSH: ' ', GIT_SSH_COMMAND: '' }, '\n')).toBe(false)
  })

  it.each([
    [{ GIT_SSH: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' }, ''],
    [{ GIT_SSH_COMMAND: 'ssh -i key' }, ''],
    [{}, 'C:/Windows/System32/OpenSSH/ssh.exe\n'],
  ])('is true for GIT_SSH, GIT_SSH_COMMAND or core.sshCommand (%o, %j)', (env, configured) => {
    expect(hasOwnSshCommand(env, configured)).toBe(true)
  })
})

describe('askpassBeside', () => {
  it('finds mingw64\\bin from git’s exec path', () => {
    expect(askpassBeside('C:/Program Files/Git/mingw64/libexec/git-core\n')).toBe(
      join('C:/Program Files/Git/mingw64/bin/git-askpass.exe'),
    )
  })
})

describe('gitMessage', () => {
  it('skips git’s advice and the fatal: prefix', () => {
    expect(gitMessage('hint: Diverging branches can’t be fast-forwarded\nhint:\nfatal: Not possible to fast-forward, aborting.\n')).toBe(
      'Not possible to fast-forward, aborting.',
    )
  })
})

describe('running git for the network', () => {
  let fixtures: Fixtures
  let repo: string

  beforeAll(async () => {
    fixtures = await createFixtures()
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(fixtures.root, 'empty.gitconfig'))
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_SSH', '')
    vi.stubEnv('GIT_SSH_COMMAND', '')
    repo = await createScratchRepository(fixtures, 'network')
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (fixtures) await removeFixtures(fixtures)
  })

  /** The environment git itself sees, printed by a shell alias. */
  const environmentSeenByGit = async (options: Parameters<typeof runGit>[2]) => {
    const printed = await runGit(repo, ['-c', 'alias.printenv=!env', 'printenv'], options)
    return Object.fromEntries(printed.split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  }

  it('finds Git for Windows’ sign-in window beside the installed git', async () => {
    const { env } = await networkAccessFor(repo)
    expect(env.SSH_ASKPASS).toMatch(/git-askpass\.exe$/)
    expect((await stat(env.SSH_ASKPASS!)).isFile()).toBe(true)
  })

  it('hands git the sign-in setup and the stall limit, and keeps terminal prompts off', async () => {
    const network = await networkAccessFor(repo)
    const seen = await environmentSeenByGit({ network })
    expect(seen.SSH_ASKPASS_REQUIRE).toBe('force')
    expect(seen.GIT_SSH_COMMAND).toBe(SSH_WITH_TIMEOUTS)
    expect(seen.GIT_TERMINAL_PROMPT).toBe('0')
    expect(seen).not.toHaveProperty('GCM_INTERACTIVE')
    expect((await runGit(repo, ['config', '--get', 'http.lowSpeedTime'], { network })).trim()).toBe('60')
  })

  it('keeps every other command from signing in', async () => {
    const seen = await environmentSeenByGit({})
    expect(seen.GCM_INTERACTIVE).toBe('never')
    expect(seen).not.toHaveProperty('SSH_ASKPASS')
  })

  it('respects a core.sshCommand in the repository’s config', async () => {
    await gitInFixture(fixtures, repo, 'config', 'core.sshCommand', 'ssh -i my-key')
    try {
      expect((await networkAccessFor(repo)).env).not.toHaveProperty('GIT_SSH_COMMAND')
    } finally {
      await gitInFixture(fixtures, repo, 'config', '--unset', 'core.sshCommand')
    }
  })
})
