/** IPC channel names, shared so main and preload can't drift apart. */
export const IpcChannel = {
  GetAppVersion: 'app:get-version',
} as const
