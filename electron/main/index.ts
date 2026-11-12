import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import windowIcon from '../../build/icon.ico?asset'
import { GitCliDataSource } from './git/GitCliDataSource'
import { checkGit } from './git/gitVersion'
import { registerIpcHandlers } from './ipc'
import { RepositoryStore } from './repositoryStore'

// Must match appId in electron-builder.yml so taskbar pinning and the
// installer's shortcuts refer to the same app.
const APP_USER_MODEL_ID = 'com.echel.gitmanager'

// Same as --color-gm-window, so no white flash before the renderer paints.
const WINDOW_BACKGROUND = '#0e1015'

const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
const rendererHtmlPath = fileURLToPath(new URL('../renderer/desktop.html', import.meta.url))

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Git Manager',
    // Sizes below are the web page's, not the outer frame's. The minimum is the
    // smallest size the layout fits without scrolling (e2e checks both modes).
    useContentSize: true,
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
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

/**
 * Dev and test runs (unpackaged) keep their own data folder, so they never touch the installed
 * app's repository list. Tests point it at a temporary folder with GIT_MANAGER_USER_DATA.
 */
function separateUnpackagedData(): void {
  if (app.isPackaged) return
  app.setPath('userData', process.env['GIT_MANAGER_USER_DATA'] ?? join(app.getPath('appData'), 'git-manager-dev'))
}

separateUnpackagedData()
app.setAppUserModelId(APP_USER_MODEL_ID)

void app.whenReady().then(() => {
  const repositories = new RepositoryStore(join(app.getPath('userData'), 'repositories.json'))
  registerIpcHandlers(ipcMain, { source: new GitCliDataSource(repositories), appVersion: app.getVersion(), checkGit })
  createMainWindow()
})

// Windows only: closing the last window ends the app.
app.on('window-all-closed', () => app.quit())
