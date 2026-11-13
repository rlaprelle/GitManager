import { describe, expect, it } from 'vitest'
import { invertHunks } from '@/lib/diff'
import type { Commit, Hunk, Repository } from '@/types/git'
import type { GitDataSource } from '../GitDataSource'

/**
 * Rules every GitDataSource must follow, whatever repositories it serves. Run against the
 * mock and against real git so the two can't drift apart.
 */
export interface ContractSubject {
  source: GitDataSource
  /** Two files in the first repository's working tree that differ. */
  comparePaths: { left: string; right: string }
}

/**
 * A repository the checkout rules may change: a fresh one per call. It has a remote 'origin',
 * a branch checked out, another local branch, and a remote branch with no local twin.
 */
export interface CheckoutSubject {
  source: GitDataSource
  repoId: string
  /** A local branch that isn't checked out. */
  otherLocal: string
  /** A remote branch ('origin/…') with no local branch of the same name. */
  remoteOnly: string
}

/** Enough to cover every sample commit while keeping real-git runs quick. */
const COMMITS_CHECKED_PER_REPOSITORY = 25
const WHOLE_HISTORY = 10_000

export function describeGitDataSourceContract(
  name: string,
  createSubject: () => Promise<ContractSubject>,
  createCheckoutSubject: () => Promise<CheckoutSubject>,
): void {
  describe(`${name} follows the GitDataSource contract for checkout`, () => {
    const currentBranchOf = async ({ source, repoId }: CheckoutSubject) =>
      (await source.listRepositories()).find((repo) => repo.id === repoId)!.currentBranch

    it('switches to a local branch', async () => {
      const subject = await createCheckoutSubject()
      const result = await subject.source.checkout(subject.repoId, { local: subject.otherLocal })
      expect(result).toMatchObject({ kind: 'switched', branch: subject.otherLocal })
      if (result.kind === 'switched') expect(result.message).toMatch(new RegExp(`^Switched to ${subject.otherLocal}\\b`))
      expect(await currentBranchOf(subject)).toBe(subject.otherLocal)
    })

    it('checks out a remote branch as a new local branch level with it', async () => {
      const subject = await createCheckoutSubject()
      const localName = subject.remoteOnly.slice('origin/'.length)
      const result = await subject.source.checkout(subject.repoId, { remote: subject.remoteOnly })
      expect(result).toMatchObject({ kind: 'switched', branch: localName })
      expect(await currentBranchOf(subject)).toBe(localName)
      const { local, remote } = await subject.source.getBranches(subject.repoId)
      const tip = remote.find((branch) => branch.name === subject.remoteOnly)!.tipHash
      expect(local.find((branch) => branch.name === localName)).toEqual({ name: localName, ahead: 0, behind: 0, tipHash: tip })
    })

    it('rejects a branch the repository doesn’t have, or that looks like an option, and changes nothing', async () => {
      const subject = await createCheckoutSubject()
      const before = await currentBranchOf(subject)
      for (const target of [{ local: 'no-such-branch' }, { local: '-f' }, { local: '--orphan=x' }, { remote: 'origin/no-such' }, { remote: '-f' }]) {
        await expect(subject.source.checkout(subject.repoId, target), JSON.stringify(target)).rejects.toThrow()
      }
      await expect(subject.source.checkout('no-such-repository', { local: subject.otherLocal })).rejects.toThrow()
      expect(await currentBranchOf(subject)).toBe(before)
    })

    it('rejects a remote branch that already has a local branch of its name', async () => {
      const subject = await createCheckoutSubject()
      await subject.source.checkout(subject.repoId, { remote: subject.remoteOnly })
      await subject.source.checkout(subject.repoId, { local: subject.otherLocal })
      const localName = subject.remoteOnly.slice('origin/'.length)
      await expect(subject.source.checkout(subject.repoId, { remote: subject.remoteOnly })).rejects.toThrow(
        `A local branch ${localName} already exists`,
      )
      expect(await currentBranchOf(subject)).toBe(subject.otherLocal)
    })
  })

  describe(`${name} follows the GitDataSource contract`, () => {
    async function eachRepository(check: (source: GitDataSource, repo: Repository) => Promise<void>) {
      const { source } = await createSubject()
      const repositories = await source.listRepositories()
      expect(repositories.length).toBeGreaterThan(0)
      for (const repo of repositories) await check(source, repo)
    }

    async function eachCheckedCommit(check: (source: GitDataSource, repo: Repository, commit: Commit) => Promise<void>) {
      await eachRepository(async (source, repo) => {
        const { commits } = await source.getHistory(repo.id, COMMITS_CHECKED_PER_REPOSITORY)
        for (const commit of commits) await check(source, repo, commit)
      })
    }

    it('lists repositories with unique ids', async () => {
      const { source } = await createSubject()
      const ids = (await source.listRepositories()).map((repo) => repo.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('lists unique branch names, with the checked-out branch among the local ones', async () => {
      await eachRepository(async (source, repo) => {
        const { local, remote } = await source.getBranches(repo.id)
        const names = [...local, ...remote].map((branch) => branch.name)
        expect(new Set(names).size, repo.name).toBe(names.length)
        // A detached HEAD has no current branch, and a new repository's branch has no commit to exist on yet.
        const { commits } = await source.getHistory(repo.id, 1)
        if (repo.currentBranch !== null && commits.length > 0) {
          expect(local.map((branch) => branch.name), repo.name).toContain(repo.currentBranch)
        }
      })
    })

    it('returns history with unique hashes, and a limited page is the start of the whole history', async () => {
      await eachRepository(async (source, repo) => {
        const whole = await source.getHistory(repo.id, WHOLE_HISTORY)
        const hashes = whole.commits.map((commit) => commit.hash)
        expect(new Set(hashes).size, repo.name).toBe(hashes.length)
        expect(whole.hasMore, repo.name).toBe(false)

        // Graph rows depend on what the page holds (whether main is in view), so compare without them.
        const withoutGraph = ({ graph: _graph, ...commit }: Commit) => commit
        const page = await source.getHistory(repo.id, 2)
        expect(page.commits.map(withoutGraph), repo.name).toEqual(whole.commits.slice(0, 2).map(withoutGraph))
        expect(page.hasMore, repo.name).toBe(whole.commits.length > 2)
      })
    })

    it('dates every commit, and the last fetch if there was one, with an ISO 8601 timestamp', async () => {
      await eachRepository(async (source, repo) => {
        if (repo.lastFetch !== null) expect(isIsoTimestamp(repo.lastFetch), repo.name).toBe(true)
        const { commits } = await source.getHistory(repo.id, COMMITS_CHECKED_PER_REPOSITORY)
        for (const commit of commits) expect(isIsoTimestamp(commit.date), `${commit.hash} ${commit.date}`).toBe(true)
      })
    })

    it('labels commits only with branches the repository has', async () => {
      await eachRepository(async (source, repo) => {
        const { local, remote } = await source.getBranches(repo.id)
        const branchNames = new Set([...local, ...remote].map((branch) => branch.name))
        const { commits } = await source.getHistory(repo.id, WHOLE_HISTORY)
        for (const ref of commits.flatMap((commit) => commit.refs)) expect(branchNames, repo.name).toContain(ref)
      })
    })

    it('lists each commit’s changed files once, with a status of A, M, D or R (with the old path)', async () => {
      await eachCheckedCommit(async (source, repo, commit) => {
        const files = await source.getCommitFiles(repo.id, commit.hash)
        const paths = files.map((file) => file.path)
        expect(new Set(paths).size, commit.hash).toBe(paths.length)
        for (const file of files) {
          const label = `${commit.hash} ${file.path}`
          expect(['A', 'M', 'D', 'R'], label).toContain(file.status)
          if (file.status === 'R') expect(file.oldPath, label).toBeTruthy()
          else expect(file.oldPath, label).toBeUndefined()
        }
      })
    })

    it('gives every changed file a diff that matches its status', async () => {
      await eachCheckedCommit(async (source, repo, commit) => {
        for (const file of await source.getCommitFiles(repo.id, commit.hash)) {
          const hunks = await source.getFileDiff(repo.id, commit.hash, file.path)
          expectDiffMatchesStatus(hunks, file.status, `${commit.hash} ${file.path}`)
        }
      })
    })

    it('describes a problem only for a repository it can’t read', async () => {
      const { source } = await createSubject()
      for (const repo of await source.listRepositories()) {
        if (repo.problem === null) continue
        expect(repo.problem, repo.name).not.toBe('')
      }
      const first = (await source.listRepositories())[0]!
      expect(first.problem).toBeNull()
    })

    it('removes a repository from the list, and rejects one it doesn’t know', async () => {
      const { source } = await createSubject()
      const [first, ...rest] = await source.listRepositories()
      const result = await source.removeRepository(first!.id)
      expect(result.message).toBe(`Removed ${first!.name} from the list`)
      expect((await source.listRepositories()).map((repo) => repo.id)).toEqual(rest.map((repo) => repo.id))
      await expect(source.removeRepository('no-such-repository')).rejects.toThrow()
    })

    it('rejects a repository, commit or file it doesn’t know', async () => {
      const { source } = await createSubject()
      // The first repository must have commits.
      const repo = (await source.listRepositories())[0]!
      const newest = (await source.getHistory(repo.id, 1)).commits[0]!

      await expect(source.getBranches('no-such-repository')).rejects.toThrow()
      await expect(source.getHistory('no-such-repository', 10)).rejects.toThrow()
      await expect(source.getCommitFiles(repo.id, 'f00dfeed')).rejects.toThrow()
      await expect(source.getFileDiff(repo.id, newest.hash, 'no/such/file.txt')).rejects.toThrow()
    })

    it('compares two files, and swapping them inverts the diff', async () => {
      const { source, comparePaths } = await createSubject()
      const repo = (await source.listRepositories())[0]!
      const forward = await source.compareFiles(repo.id, comparePaths.left, comparePaths.right)
      const backward = await source.compareFiles(repo.id, comparePaths.right, comparePaths.left)
      expect(forward.length).toBeGreaterThan(0)
      // Git labels a hunk with a function name taken from the left file, so the label may change on a swap.
      const withoutContext = (hunks: Hunk[]) => hunks.map(({ context: _context, ...hunk }) => hunk)
      expect(withoutContext(backward)).toEqual(withoutContext(invertHunks(forward)))
    })
  })
}

function isIsoTimestamp(value: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
  return iso.test(value) && !Number.isNaN(Date.parse(value))
}

/** '\' marks git's "No newline at end of file" note, which belongs to the line before it. */
function expectDiffMatchesStatus(hunks: Hunk[], status: string, label: string): void {
  const lines = hunks.flatMap((hunk) => hunk.lines)
  for (const line of lines) expect(['+', '-', ' ', '\\'], `${label}: ${line}`).toContain(line[0])
  if (status === 'A') {
    expect(lines.every((line) => line.startsWith('+') || line.startsWith('\\')), label).toBe(true)
    expect(hunks.every((hunk) => hunk.oldStart === 0), label).toBe(true)
  }
  if (status === 'D') {
    expect(lines.every((line) => line.startsWith('-') || line.startsWith('\\')), label).toBe(true)
    expect(hunks.every((hunk) => hunk.newStart === 0), label).toBe(true)
  }
}
