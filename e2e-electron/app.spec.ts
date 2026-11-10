import { readFileSync } from 'node:fs'
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test'
import type { GitManagerBridge } from '../src/types/bridge'

// Acceptance pass for the desktop shell: the built app opens the existing UI,
// the preload bridge reaches the main process, and the renderer has no Node access.

const packageVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version

let app: ElectronApplication | undefined
let window: Page

test.beforeEach(async () => {
  // '.' launches package.json "main", the same entry the installer packages.
  app = await electron.launch({ args: ['.'] })
  window = await app.firstWindow()
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

test('opens the Git Manager window on the repository list', async () => {
  await expect(window).toHaveTitle('Git Manager')
  const sidebar = window.getByRole('navigation', { name: 'Repositories and branches' })
  await expect(sidebar.getByRole('button', { name: /inventory-service/ })).toBeVisible()
  await expect(window.locator('footer [role="status"]')).toHaveText('Ready')
})

test('preload bridge returns the app version from the main process', async () => {
  const version = await window.evaluate(() =>
    (window as unknown as { gitManager: GitManagerBridge }).gitManager.getAppVersion(),
  )
  expect(version).toBe(packageVersion)
})

test('renderer has no Node.js globals', async () => {
  const globals = await window.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
  }))
  expect(globals).toEqual({ require: 'undefined', process: 'undefined' })
})

test('shrinking the window stops at a size where the whole UI fits', async () => {
  const contentSize = await app!.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]!
    mainWindow.setSize(400, 300)
    return mainWindow.getContentSize()
  })
  expect(contentSize).toEqual([1024, 640])

  await expect
    .poll(() =>
      window.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      })),
    )
    .toEqual({ x: 0, y: 0 })
  await expect(window.locator('footer [role="status"]')).toBeInViewport()
})
