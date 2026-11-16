import { errorMessage } from '../../src/lib/errorMessage'

/** Checked when the app starts, then this often while it stays open. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** The part of electron-updater's autoUpdater this uses, so tests can stand in for it. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface UpdateChecks {
  /** The version downloaded and waiting for a restart, or null. */
  readyVersion(): string | null
  /** Restarts into the downloaded version. */
  install(): void
}

/**
 * Updates from GitHub Releases (the feed is the `publish` entry in electron-builder.yml, baked into
 * app-update.yml at build time). Downloads in the background and tells the window, which offers a
 * restart; an update the user never restarts for installs when the app quits. A failed check (offline,
 * GitHub unreachable) is only logged: the next one tries again.
 *
 * The installer is unsigned, so electron-builder.yml turns off the signature check
 * (`verifyUpdateCodeSignature: false`); a download is trusted by its SHA-512 in latest.yml, fetched over HTTPS.
 */
export function startUpdateChecks(
  updater: UpdaterLike,
  notify: (version: string) => void,
  log: (message: string) => void = console.warn,
): UpdateChecks {
  let ready: string | null = null
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('update-downloaded', ({ version }) => {
    ready = version
    notify(version)
  })
  updater.on('error', (error) => log(`Update check failed: ${errorMessage(error)}`))

  const check = () => {
    updater.checkForUpdates().catch((error: unknown) => log(`Update check failed: ${errorMessage(error)}`))
  }
  check()
  setInterval(check, UPDATE_CHECK_INTERVAL_MS).unref?.()

  return {
    readyVersion: () => ready,
    install: () => {
      if (ready === null) throw new Error('No update is ready to install')
      updater.quitAndInstall()
    },
  }
}
