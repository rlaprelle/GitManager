import type { GitStatus } from '../../../src/types/bridge'
import { runGit } from './runGit'

/**
 * Oldest git the app supports. Everything it runs works from 2.18; 2.30 (Jan 2021) leaves
 * margin and is still years old. The app is tested on current Git for Windows.
 */
export const MINIMUM_GIT_VERSION = '2.30'

/** 'git version 2.46.1.windows.1' → '2.46.1'. */
export function parseGitVersion(output: string): string | null {
  return /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null
}

/** What `git --version` printed (null if git didn't run) → whether the app can use it. */
export function gitStatusFrom(output: string | null): GitStatus {
  const version = output === null ? null : parseGitVersion(output)
  if (version === null) return { state: 'missing', minimum: MINIMUM_GIT_VERSION }
  if (compareVersions(version, MINIMUM_GIT_VERSION) < 0) return { state: 'too-old', version, minimum: MINIMUM_GIT_VERSION }
  return { state: 'ready', version }
}

export async function checkGit(): Promise<GitStatus> {
  const output = await runGit(process.cwd(), ['--version']).catch(() => null)
  return gitStatusFrom(output)
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const difference = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
