// IPC channel names, shared by the main process (handlers) and the preload (callers)
// so the two can't disagree. Every handler answers with an IpcResult.
export const IpcChannel = {
  GetAppVersion: 'app:get-version',
  GetGitStatus: 'app:get-git-status',
  ListRepositories: 'git:list-repositories',
  GetBranches: 'git:get-branches',
  GetHistory: 'git:get-history',
  GetCommitFiles: 'git:get-commit-files',
  GetFileDiff: 'git:get-file-diff',
  CompareFiles: 'git:compare-files',
  AddRepository: 'repositories:add',
  RemoveRepository: 'repositories:remove',
  Checkout: 'git:checkout',
  Fetch: 'git:fetch',
  Pull: 'git:pull',
  Push: 'git:push',
} as const
