import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test'
import { type Fixtures, createFixtures, removeFixtures } from '../electron/main/git/__tests__/fixtures'
import {
  contentSecurityPolicy,
  foreignResourceUrls,
  injectionAttempts,
  policyViolationsOnReload,
  primaryFontsLoaded,
} from '../e2e/support/pageChecks'
import type { GitManagerBridge } from '../src/types/bridge'

// Acceptance pass for the desktop app: the built app (out/) on real repositories, read with
// the installed git. Each test gets its own data folder listing the fixture repository.

const packageVersion: string = JSON.parse(await readFile('package.json', 'utf8')).version

let fixtures: Fixtures
let app: ElectronApplication | undefined
let window: Page
let userData: string

test.beforeAll(async () => {
  fixtures = await createFixtures()
})

test.afterAll(async () => {
  if (fixtures) await removeFixtures(fixtures)
})

/** Launches the built app ('.' = package.json "main", what the installer packages) with a fresh data folder. */
async function launch(environment: Record<string, string> = {}): Promise<void> {
  userData = await mkdtemp(join(tmpdir(), 'git-manager-userdata-'))
  const repositories = { version: 1, repositories: [{ id: 'sample', path: fixtures.sample }] }
  await writeFile(join(userData, 'repositories.json'), JSON.stringify(repositories))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GIT_MANAGER_USER_DATA: userData, ...environment } })
  window = await app.firstWindow()
}

test.afterEach(async () => {
  await app?.close()
  app = undefined
  if (userData) await rm(userData, { recursive: true, force: true })
})

const status = () => window.locator('footer [role="status"]')
const sidebar = () => window.getByRole('navigation', { name: 'Repositories and branches' })
const diffViewer = () => window.getByRole('region', { name: 'Diff viewer' })

test.describe('with git installed', () => {
  test.beforeEach(async () => {
    await launch()
    await expect(status()).toHaveText('Ready')
  })

  test('opens the window on the user’s repository and its newest commit', async () => {
    await expect(window).toHaveTitle('Git Manager')
    await expect(sidebar().getByRole('button', { name: /sample/ })).toBeVisible()
    await expect(window.getByTestId('header-branch')).toHaveText('main')
    await expect(diffViewer()).toContainText('Describe the sample')
  })

  test('browses a real repository: a merge, a binary file, a file’s diff and a branch', async () => {
    await window.getByRole('button', { name: /Merge branch 'feature\/search'/ }).click()
    await expect(diffViewer()).toContainText('1 file changed')
    await expect(window.getByTestId('unified-diff')).toContainText('export const search = () => []')

    await window.getByRole('button', { name: /Remove notes, add logo/ }).click()
    await expect(diffViewer()).toContainText('3 files changed')
    await diffViewer().getByRole('button', { name: /no-newline\.txt/ }).click()
    await expect(window.getByTestId('unified-diff')).toContainText('last line')

    await sidebar().getByRole('button', { name: 'feature/search', exact: true }).click()
    await expect(diffViewer()).toContainText('Add search')
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
    await expect(status()).toBeInViewport()
  })

  test('works offline: loads only from disk and renders in the bundled fonts', async () => {
    await expect
      .poll(async () => {
        const fonts = await primaryFontsLoaded(window)
        return fonts.loaded.includes(fonts.sans) && fonts.loaded.includes(fonts.mono)
      })
      .toBe(true)
    const fonts = await primaryFontsLoaded(window)
    expect(fonts.sans).toMatch(/^Inter/)
    expect(fonts.mono).toMatch(/^JetBrains Mono/)
    expect(window.url()).toMatch(/^file:/)
    expect(await foreignResourceUrls(window)).toEqual([])
  })

  test('the built app enforces the strict content security policy', async () => {
    const policy = await contentSecurityPolicy(window)
    expect(policy).toContain("default-src 'none'")
    expect(policy).toMatch(/(^|; )script-src 'self'(;|$)/)
    expect(policy).not.toContain('unsafe')
    expect(await injectionAttempts(window)).toEqual({ inlineScript: false, inlineStyle: false })
    const violations = await policyViolationsOnReload(window, () => expect(status()).toHaveText('Ready'))
    expect(violations).toEqual([])
  })
})

test('the built desktop app contains none of the browser version’s sample data', async () => {
  const assets = join('out', 'renderer', 'assets')
  const scripts = (await readdir(assets)).filter((name) => name.endsWith('.js'))
  expect(scripts.length).toBeGreaterThan(0)
  for (const name of scripts) {
    const code = await readFile(join(assets, name), 'utf8')
    expect(code, name).not.toContain('inventory-service')
    expect(code, name).not.toContain('Add reservation expiry job')
  }
})

test('without git on the PATH, the app explains it needs Git for Windows', async () => {
  // Keep everything but PATH; Windows spells it Path, and the two must not both survive.
  const withoutPath = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'))
  userData = await mkdtemp(join(tmpdir(), 'git-manager-userdata-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...withoutPath, PATH: join(tmpdir(), 'no-git-here'), GIT_MANAGER_USER_DATA: userData } as Record<string, string>,
  })
  window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'Git Manager needs Git for Windows' })).toBeVisible()
  await expect(window.getByText('Git wasn’t found on this computer.')).toBeVisible()
})
