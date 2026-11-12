import type { Branches, Commit, FileChange, Hunk, Repository } from '@/types/git'

// The sample data is stored whole, the way a design mock-up reads; MockGitDataSource
// serves it piece by piece through the GitDataSource contract.

export interface SampleFileChange extends FileChange {
  hunks: Hunk[]
}

/** Stores parents instead of a graph row: the mock lays out the graph the way real git's source does. */
export interface SampleCommit extends Omit<Commit, 'graph'> {
  parents: string[]
  files: SampleFileChange[]
}

export interface SampleRepository extends Repository {
  localBranches: Branches['local']
  remoteBranches: Branches['remote']
  /** Newest first. */
  commits: SampleCommit[]
}
