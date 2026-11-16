import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import windowIcon from '../../build/icon.ico?asset'
import { GitCliDataSource } from './git/GitCliDataSource'
import { checkGit } from './git/gitVersion'
import { startUpdateChecks, type UpdaterLike } from './updates'
import { registerIpcHandlers } from './ipc'
import { RepositoryStore } from './repositoryStore'
import { IpcEvent } from '../shared/channels'

// Must match appId in electron-builder.yml so taskbar pinning and the
// installer's shortcuts refer to the same app.
const APP_USER_MODEL_ID = 'com.echel.gitmanager'

// Same as --color-gm-window, so no white flash before the renderer paints.
const WINDOW_BACKGROUND = '#0e1015'

// Window sizes are the web page's, not the outer frame's (useContentSize).
const START_WIDTH = 1440
const START_HEIGHT = 900
// The smallest size the layout fits without scrolling. Change together with min-h-[640px] on the
// root of App.vue and GitRequired.vue, and both e2e suites, which check there's no page scroll here.
const MIN_WIDTH = 1024
const MIN_HEIGHT = 640

const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
const rendererHtmlPath = fileURLToPath(new URL('../renderer/desktop.html', import.meta.url))

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Git Manager',
    useContentSize: true,
    width: START_WIDTH,
    height: START_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    // The packaged exe embeds the same icon; this covers dev mode, where the exe is electron.exe.
    icon: windowIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: developerToolsAllowed(),
    },
  })
  window.once('ready-to-show', () => window.show())
  keepNavigationInside(window)
  loadRenderer(window)
  return window
}

// The window only ever shows our own UI: no in-app navigation, no pop-ups.
function keepNavigationInside(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}

function loadRenderer(window: BrowserWindow): void {
  // Set by `electron-vite dev`; never trusted in a packaged build.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(new URL('desktop.html', devServerUrl).href)
    return
  }
  void window.loadFile(rendererHtmlPath)
}

/** The native folder picker, over the app window. Tests replace dialog.showOpenDialog. */
async function chooseFolder(title: string): Promise<string | null> {
  const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
  const window = BrowserWindow.getAllWindows()[0]
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** electron-updater is CommonJS: its autoUpdater is reached through the default export under ESM. */
function autoUpdater(): UpdaterLike {
  return electronUpdater.autoUpdater
}

function tellWindowUpdateIsReady(version: string): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IpcEvent.UpdateReady, version)
}

/**
 * Dev and test runs (unpackaged) keep their own data folder, so they never touch the installed
 * app's repository list. Tests point it at a temporary folder with GIT_MANAGER_USER_DATA.
 */
function separateUnpackagedData(): void {
  if (app.isPackaged) return
  app.setPath('userData', process.env['GIT_MANAGER_USER_DATA'] ?? join(app.getPath('appData'), 'git-manager-dev'))
}

/**
 * Only unpackaged runs (dev:app) keep Electron's default menu, whose shortcuts reload the
 * window (Ctrl+R, losing the app's state mid-operation) and open DevTools (Ctrl+Shift+I, a
 * console inside the app). GIT_MANAGER_NO_DEV_TOOLS=1 gives an unpackaged run the packaged
 * behaviour, so the e2e suite can check it; it can only take the tools away, never add them.
 */
function developerToolsAllowed(): boolean {
  return !app.isPackaged && process.env['GIT_MANAGER_NO_DEV_TOOLS'] !== '1'
}

separateUnpackagedData()
app.setAppUserModelId(APP_USER_MODEL_ID)
// Before 'ready', or Electron builds the default menu first.
if (!developerToolsAllowed()) Menu.setApplicationMenu(null)

void app.whenReady().then(() => {
  const repositories = new RepositoryStore(join(app.getPath('userData'), 'repositories.json'))
  const source = new GitCliDataSource(repositories, chooseFolder)
  // Only the installed app updates itself: dev and test runs have no app-update.yml, and must never restart.
  const updates = app.isPackaged ? startUpdateChecks(autoUpdater(), tellWindowUpdateIsReady) : null
  registerIpcHandlers(ipcMain, { source, appVersion: app.getVersion(), checkGit, updates })
  createMainWindow()
})

// Windows only: closing the last window ends the app.
app.on('window-all-closed', () => app.quit())
