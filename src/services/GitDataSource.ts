import type { Hunk, OperationResult, Repository } from '@/types/git'

/**
 * Everything the UI needs from git. The app ships with a mock; a real backend
 * (local service, Tauri/Electron bridge) implements this same contract.
 */
export interface GitDataSource {
  listRepositories(): Promise<Repository[]>
  compareFiles(leftPath: string, rightPath: string): Promise<Hunk[]>
  checkout(repoId: string, branch: string): Promise<OperationResult>
  fetch(repoId: string): Promise<OperationResult>
  pull(repoId: string, branch: string): Promise<OperationResult>
  push(repoId: string, branch: string): Promise<OperationResult>
}
