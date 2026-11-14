import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type NetworkAccess, runGit } from './runGit'

/**
 * A transfer that moves less than 1000 bytes a second for a whole minute has stalled; git gives
 * up on it. A slow transfer that keeps moving is never cut off. (HTTPS only: ssh has its own.)
 */
export const STALL_SETTINGS = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60']

/**
 * ssh with the same idea: 20 s to connect, and a connection that answers no keepalive for a
 * minute (four missed, 15 s apart) is dropped.
 */
export const SSH_WITH_TIMEOUTS = 'ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'

/**
 * How fetch, pull and push run. Unlike other commands, git may sign in: Git Credential Manager
 * shows its own window for HTTPS (it isn't told GCM_INTERACTIVE=never), and git and ssh ask
 * for passwords, passphrases and unknown host keys through `askpass`, a small window. With
 * SSH_ASKPASS_REQUIRE=force ssh uses it although it has no terminal. A terminal prompt stays
 * off (GIT_TERMINAL_PROMPT=0): nobody would see it.
 *
 * ssh gets timeouts only when the user hasn't chosen their own ssh command, which always wins.
 */
export function networkAccess(askpass: string | null, ownSshCommand: boolean): NetworkAccess {
  const prompts: Record<string, string> = askpass
    ? { GIT_ASKPASS: askpass, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force' }
    : {}
  return {
    env: { ...prompts, ...(ownSshCommand ? {} : { GIT_SSH_COMMAND: SSH_WITH_TIMEOUTS }) },
    settings: STALL_SETTINGS,
  }
}

/** Whether the user picked the ssh git runs: GIT_SSH or GIT_SSH_COMMAND, or core.sshCommand (`configured`). */
export function hasOwnSshCommand(env: NodeJS.ProcessEnv, configured: string): boolean {
  return Boolean(env.GIT_SSH?.trim() || env.GIT_SSH_COMMAND?.trim() || configured.trim())
}

/**
 * Git for Windows' sign-in window, beside git itself: `git --exec-path` is
 * <install>\mingw64\libexec\git-core, and the window is <install>\mingw64\bin\git-askpass.exe.
 * Git for Windows' own shell uses the same program for SSH_ASKPASS.
 */
export function askpassBeside(execPath: string): string {
  return join(execPath.trim(), '..', '..', 'bin', 'git-askpass.exe')
}

let askpassLookup: Promise<string | null> | null = null

/** Where git-askpass.exe is, looked up once; null when this git has none (git and ssh then can't ask). */
function findAskpass(folder: string): Promise<string | null> {
  askpassLookup ??= runGit(folder, ['--exec-path'])
    .then(async (execPath) => {
      const askpass = askpassBeside(execPath)
      const found = await stat(askpass).catch(() => null)
      return found?.isFile() ? askpass : null
    })
    .catch(() => {
      askpassLookup = null // try again next time
      return null
    })
  return askpassLookup
}

/** The network setup for a command in `folder`, whose own config may name an ssh command. */
export async function networkAccessFor(folder: string): Promise<NetworkAccess> {
  const [askpass, configured] = await Promise.all([
    findAskpass(folder),
    // Exit code 1: not set.
    runGit(folder, ['config', '--get', 'core.sshCommand'], { okExitCodes: [1] }),
  ])
  return networkAccess(askpass, hasOwnSshCommand(process.env, configured))
}
