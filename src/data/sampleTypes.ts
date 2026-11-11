import type { Branches, Commit, FileChange, Hunk, Repository } from '@/types/git'

// The sample data is stored whole, the way a design mock-up reads; MockGitDataSource
// serves it piece by piece through the GitDataSource contract.

export interface SampleFileChange extends FileChange {
  hunks: Hunk[]
}

export interface SampleCommit extends Commit {
  files: SampleFileChange[]
}

export interface SampleRepository extends Repository {
  localBranches: Branches['local']
  remoteBranches: Branches['remote']
  /** Newest first. */
  commits: SampleCommit[]
}
