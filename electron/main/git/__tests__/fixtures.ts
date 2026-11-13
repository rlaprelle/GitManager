import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Fixtures {
  root: string
  /** Merge, deletion, binary file, no trailing newline, a path with a space and accent, a remote one commit behind, one uncommitted change. */
  sample: string
  /** `git init` and nothing else. */
  empty: string
  /** Two commits with the older one checked out directly (detached HEAD). */
  detached: string
}

/**
 * Builds throwaway repositories with git. Commands run with an empty global config so the
 * user's own settings (signing, hooks, autocrlf, default branch) can't change the fixtures.
 */
export async function createFixtures(): Promise<Fixtures> {
  const root = await mkdtemp(join(tmpdir(), 'git-manager-fixtures-'))
  const emptyConfig = join(root, 'empty.gitconfig')
  await writeFile(emptyConfig, '')
  let clock = Date.UTC(2026, 10, 1, 9, 0) / 1000

  const git = async (cwd: string, ...args: string[]) => {
    clock += 3600
    const date = `${clock} +0000`
    const { stdout } = await run('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Ada Lovelace',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada Lovelace',
        GIT_COMMITTER_EMAIL: 'ada@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    })
    return stdout
  }
  const write = async (repo: string, path: string, content: string | Buffer) => {
    await mkdir(join(repo, path, '..'), { recursive: true })
    await writeFile(join(repo, path), content)
  }
  const commit = async (repo: string, message: string) => {
    await git(repo, 'add', '--all')
    await git(repo, 'commit', '--quiet', '-m', message)
  }

  const sample = join(root, 'sample')
  await mkdir(sample)
  await git(sample, 'init', '--quiet', '-b', 'main')
  await write(sample, 'README.md', '# Sample\n')
  await write(sample, 'app.yml', ['port: 8080', 'host: localhost', 'debug: false', ''].join('\n'))
  await write(sample, 'notes.txt', 'to be deleted\n')
  await write(sample, 'config/left.yml', ['  name: left', '  size: 1', '  mode: fast', ''].join('\n'))
  await write(sample, 'config/right.yml', ['  name: right', '  size: 1', '  mode: slow', ''].join('\n'))
  await commit(sample, 'Initial commit')

  await write(sample, 'app.yml', ['port: 9090', 'host: localhost', 'debug: false', 'timeout: 30s', ''].join('\n'))
  await write(sample, 'docs/read me é.md', 'Accented and spaced\n')
  await commit(sample, 'Configure port and timeout')

  await git(sample, 'checkout', '--quiet', '-b', 'feature/search')
  await write(sample, 'src/search.ts', 'export const search = () => []\n')
  await commit(sample, 'Add search')

  await git(sample, 'checkout', '--quiet', 'main')
  await git(sample, 'rm', '--quiet', 'notes.txt')
  await write(sample, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00]))
  await write(sample, 'no-newline.txt', 'last line')
  await commit(sample, 'Remove notes, add logo')

  await git(sample, 'merge', '--quiet', '--no-ff', '-m', "Merge branch 'feature/search'", 'feature/search')

  const origin = join(root, 'origin.git')
  await git(root, 'clone', '--quiet', '--bare', sample, origin)
  await git(sample, 'remote', 'add', 'origin', origin)
  await git(sample, 'fetch', '--quiet', 'origin')
  await git(sample, 'branch', '--quiet', '--set-upstream-to=origin/main', 'main')

  await write(sample, 'README.md', '# Sample\n\nAhead of origin.\n')
  await commit(sample, 'Describe the sample')
  await write(sample, 'README.md', '# Sample\n\nUncommitted.\n')

  const empty = join(root, 'empty')
  await mkdir(empty)
  await git(empty, 'init', '--quiet', '-b', 'main')

  const detached = join(root, 'detached')
  await mkdir(detached)
  await git(detached, 'init', '--quiet', '-b', 'main')
  await write(detached, 'a.txt', 'a\n')
  await commit(detached, 'First')
  await write(detached, 'a.txt', 'b\n')
  await commit(detached, 'Second')
  await git(detached, 'checkout', '--quiet', '--detach', 'HEAD~1')

  return { root, sample, empty, detached }
}

export async function removeFixtures(fixtures: Fixtures): Promise<void> {
  await rm(fixtures.root, { recursive: true, force: true, maxRetries: 5 })
}

/** Runs git in a fixture, for tests that look up what it holds (hashes, for instance). */
export async function fixtureGit(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout
}

/**
 * Runs git the way the user would outside the app, at the current time, but with the fixtures'
 * empty global config so their own settings can't interfere.
 */
async function userGit(fixtures: Fixtures, cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(fixtures.root, 'empty.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Grace Hopper',
      GIT_AUTHOR_EMAIL: 'grace@example.com',
      GIT_COMMITTER_NAME: 'Grace Hopper',
      GIT_COMMITTER_EMAIL: 'grace@example.com',
    },
  })
  return stdout
}

/** A small repository of a test's own (one commit on main), which it may change freely. */
export async function createScratchRepository(fixtures: Fixtures, name: string): Promise<string> {
  const repo = join(fixtures.root, name)
  await mkdir(repo)
  await userGit(fixtures, repo, 'init', '--quiet', '-b', 'main')
  await commitInFixture(fixtures, repo, 'README.md', `# ${name}\n`, 'Start')
  return repo
}

/** Writes a file and commits it, as the user would in their own terminal. */
export async function commitInFixture(fixtures: Fixtures, repo: string, path: string, content: string, message: string) {
  await mkdir(join(repo, path, '..'), { recursive: true })
  await writeFile(join(repo, path), content)
  await userGit(fixtures, repo, 'add', '--all')
  await userGit(fixtures, repo, 'commit', '--quiet', '-m', message)
}

/**
 * A repository with `count` commits in a line on main ('Commit 1' … 'Commit <count>'), made in
 * one `git fast-import` run: a few hundred commits one by one would take a minute on Windows.
 */
export async function createLongRepository(fixtures: Fixtures, name: string, count: number): Promise<string> {
  const repo = join(fixtures.root, name)
  await mkdir(repo)
  await userGit(fixtures, repo, 'init', '--quiet', '-b', 'main')
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`
  const start = Math.floor(Date.UTC(2026, 0, 1) / 1000)
  let stream = ''
  for (let n = 1; n <= count; n++) {
    stream += 'commit refs/heads/main\n'
    stream += `mark :${n}\n`
    stream += `committer Ada Lovelace <ada@example.com> ${start + n * 60} +0000\n`
    stream += data(`Commit ${n}`)
    if (n > 1) stream += `from :${n - 1}\n`
    stream += `M 644 inline counter.txt\n${data(String(n))}\n`
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['fast-import', '--quiet'], { cwd: repo })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git fast-import exited ${code}`))))
    child.stdin.end(stream)
  })
  await userGit(fixtures, repo, 'reset', '--quiet', '--hard')
  return repo
}

/** Moves a file with `git mv` (optionally rewriting it) and commits, as the user would. */
export async function renameInFixture(
  fixtures: Fixtures,
  repo: string,
  from: string,
  to: string,
  message: string,
  newContent?: string,
): Promise<void> {
  await mkdir(join(repo, to, '..'), { recursive: true })
  await userGit(fixtures, repo, 'mv', from, to)
  if (newContent !== undefined) await writeFile(join(repo, to), newContent)
  await userGit(fixtures, repo, 'add', '--all')
  await userGit(fixtures, repo, 'commit', '--quiet', '-m', message)
}

/**
 * A repository of a test's own with a remote, 'origin' (a bare repository beside it), and
 * main checked out tracking origin/main. It has a second local branch, feature/local, and
 * origin has a branch with no local twin, origin/feature/remote.
 */
export async function createRepositoryWithRemote(fixtures: Fixtures, name: string): Promise<string> {
  const repo = await createScratchRepository(fixtures, name)
  await userGit(fixtures, repo, 'switch', '--quiet', '-c', 'feature/local')
  await commitInFixture(fixtures, repo, 'local.txt', 'local\n', 'Work locally')
  await userGit(fixtures, repo, 'switch', '--quiet', '-c', 'feature/remote', 'main')
  await commitInFixture(fixtures, repo, 'remote.txt', 'remote\n', 'Work someone pushed')
  await userGit(fixtures, repo, 'switch', '--quiet', 'main')

  const origin = join(fixtures.root, `${name}-origin.git`)
  await userGit(fixtures, fixtures.root, 'clone', '--quiet', '--bare', repo, origin)
  await userGit(fixtures, repo, 'remote', 'add', 'origin', origin)
  await userGit(fixtures, repo, 'fetch', '--quiet', 'origin')
  await userGit(fixtures, repo, 'branch', '--quiet', '--set-upstream-to=origin/main', 'main')
  await userGit(fixtures, repo, 'branch', '--quiet', '-D', 'feature/remote')
  return repo
}

/** Runs git in a test's own repository, as the user would in their own terminal. */
export async function gitInFixture(fixtures: Fixtures, repo: string, ...args: string[]): Promise<string> {
  return userGit(fixtures, repo, ...args)
}

/** Creates and checks out a branch, as the user would. */
export async function switchToNewBranchInFixture(fixtures: Fixtures, repo: string, branch: string): Promise<void> {
  await userGit(fixtures, repo, 'switch', '--quiet', '-c', branch)
}
