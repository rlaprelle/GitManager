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

/** Enough to cover every sample commit while keeping real-git runs quick. */
const COMMITS_CHECKED_PER_REPOSITORY = 25
const WHOLE_HISTORY = 10_000

export function describeGitDataSourceContract(name: string, createSubject: () => Promise<ContractSubject>): void {
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
        expect(local.map((branch) => branch.name), repo.name).toContain(repo.currentBranch)
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

    it('labels commits only with branches the repository has', async () => {
      await eachRepository(async (source, repo) => {
        const { local, remote } = await source.getBranches(repo.id)
        const branchNames = new Set([...local, ...remote].map((branch) => branch.name))
        const { commits } = await source.getHistory(repo.id, WHOLE_HISTORY)
        for (const ref of commits.flatMap((commit) => commit.refs)) expect(branchNames, repo.name).toContain(ref)
      })
    })

    it('lists each commit’s changed files once, with a status of A, M or D', async () => {
      await eachCheckedCommit(async (source, repo, commit) => {
        const files = await source.getCommitFiles(repo.id, commit.hash)
        const paths = files.map((file) => file.path)
        expect(new Set(paths).size, commit.hash).toBe(paths.length)
        for (const file of files) expect(['A', 'M', 'D'], `${commit.hash} ${file.path}`).toContain(file.status)
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

    it('rejects a repository, commit or file it doesn’t know', async () => {
      const { source } = await createSubject()
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
      expect(backward).toEqual(invertHunks(forward))
    })
  })
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
