import { type Page, expect, test } from '@playwright/test'
import {
  contentSecurityPolicy,
  foreignResourceUrls,
  injectionAttempts,
  policyViolationsOnReload,
  primaryFontsLoaded,
} from './support/pageChecks'

// Acceptance pass: drives each capability of the main window through the UI.

const status = (page: Page) => page.locator('footer [role="status"]')
const header = (page: Page) => page.locator('header')
const diffViewer = (page: Page) => page.getByRole('region', { name: 'Diff viewer' })
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Repositories and branches' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(header(page)).toBeVisible()
})

test('opens on the first repository, its newest commit and first file', async ({ page }) => {
  await expect(header(page).getByTestId('header-repo')).toHaveText('inventory-service')
  await expect(header(page).getByTestId('header-branch')).toHaveText('feature/stock-reservations')
  await expect(header(page)).toContainText('↑2 vs origin')
  await expect(diffViewer(page)).toContainText('Changes in 9f3a1c2 · Add reservation expiry job')
  await expect(status(page)).toHaveText('Ready')
})

test('switching repository reloads branches and history', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: /^storefront-web/ }).click()

  await expect(header(page).getByTestId('header-repo')).toHaveText('storefront-web')
  await expect(page.getByText('3 commits · all branches')).toBeVisible()
  await expect(sidebar(page).getByRole('button', { name: 'origin/develop' })).toBeVisible()
  await expect(status(page)).toHaveText('Opened storefront-web')
})

test('selecting a branch jumps to its tip, and Checkout moves HEAD', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'main', exact: true }).click()
  await expect(diffViewer(page)).toContainText("Changes in c81f5a3 · Merge branch 'bugfix/sku-null-check'")

  await sidebar(page).getByRole('button', { name: 'Checkout' }).click()
  await expect(header(page).getByTestId('header-branch')).toHaveText('main')
  await expect(status(page)).toHaveText('Switched to main; 3 uncommitted changes came along')
  await expect(page.getByRole('button', { name: /HEAD → main/ })).toBeVisible()
})

test('Checkout on a remote branch creates its local branch and switches to it', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'origin/main', exact: true }).click()
  // origin/main already has a local branch, so it offers no Checkout.
  await expect(sidebar(page).getByRole('button', { name: 'Checkout' })).toHaveCount(0)

  await sidebar(page).getByRole('button', { name: 'origin/release/2.4', exact: true }).click()
  await sidebar(page).getByRole('button', { name: 'Checkout' }).click()
  await expect(status(page)).toHaveText(
    'Switched to a new branch release/2.4, tracking origin/release/2.4; 3 uncommitted changes came along',
  )
  await expect(header(page).getByTestId('header-branch')).toHaveText('release/2.4')
  await expect(sidebar(page).getByRole('button', { name: /^release\/2\.4\s*HEAD/ })).toBeVisible()
})

test('selecting a commit and a file shows that file’s git diff', async ({ page }) => {
  await page.getByRole('button', { name: /Guard against null SKU in lookup/ }).click()
  await diffViewer(page).getByRole('button', { name: /SkuLookupTest\.java/ }).click()

  const diff = page.getByTestId('unified-diff')
  await expect(diff.locator('[data-kind="hunk"]')).toHaveText('@@ -41,3 +41,9 @@ class SkuLookupTest {')
  await expect(diff).toContainText('void returnsEmptyForNullOrBlankSku()')
})

test('the simple diff shows the change side by side', async ({ page }) => {
  await page.getByRole('button', { name: /Bump Spring Boot to 3\.3\.4/ }).click()
  await diffViewer(page).getByRole('button', { name: 'Simple diff' }).click()

  const diff = page.getByTestId('side-by-side-diff')
  await expect(diff.getByTestId('left-label')).toHaveText('pom.xml @ 6b2f0e1^')
  await expect(diff.locator('[data-side="left"][data-cell="del"]')).toContainText('<version>3.3.2</version>')
  await expect(diff.locator('[data-side="right"][data-cell="add"]')).toContainText('<version>3.3.4</version>')
})

test('compare two files: simple diff only, swap reverses, back returns', async ({ page }) => {
  await diffViewer(page).getByRole('button', { name: 'Compare two files…' }).click()

  await expect(page.getByLabel('Left file', { exact: true })).toHaveValue(/application\.yml$/)
  await expect(page.getByLabel('Right file', { exact: true })).toHaveValue(/application-prod\.yml$/)
  await expect(diffViewer(page).getByRole('button', { name: 'Git diff' })).toBeDisabled()
  await expect(page.getByTestId('left-label')).toHaveText('application.yml')

  await page.getByRole('button', { name: 'Swap left and right files' }).click()
  await expect(page.getByTestId('left-label')).toHaveText('application-prod.yml')
  await expect(page.locator('[data-side="left"][data-cell="del"]').first()).toContainText('db.internal')

  await diffViewer(page).getByRole('button', { name: 'Back to 9f3a1c2' }).click()
  await expect(page.getByTestId('unified-diff')).toBeVisible()
  await expect(status(page)).toHaveText('Viewing commit 9f3a1c2')
})

test('fetch, pull and push report their result in the status bar', async ({ page }) => {
  await header(page).getByRole('button', { name: 'Fetch' }).click()
  await expect(status(page)).toHaveText('Fetched origin: no new commits')
  await expect(page.locator('footer')).toContainText('Last fetch: just now')

  await header(page).getByRole('button', { name: 'Pull' }).click()
  await expect(status(page)).toHaveText('Pulled origin/feature/stock-reservations: already up to date')

  await header(page).getByRole('button', { name: 'Push' }).click()
  await expect(status(page)).toHaveText('Pushed feature/stock-reservations to origin/feature/stock-reservations')
})

test('add repository explains what to choose', async ({ page }) => {
  await page.getByRole('button', { name: 'Add repository' }).click()
  await expect(status(page)).toHaveText('Add repository: choose a folder that contains a .git directory')
})

test('removing a repository takes it off the sidebar, keeping the open one', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Remove storefront-web from the list' }).click()
  await expect(sidebar(page).getByRole('button', { name: /^storefront-web/ })).toHaveCount(0)
  await expect(status(page)).toHaveText('Removed storefront-web from the list')
  await expect(header(page).getByTestId('header-repo')).toHaveText('inventory-service')
})

test('F5 refreshes the open repository without leaving the selected commit', async ({ page }) => {
  await page.getByRole('button', { name: /Bump Spring Boot to 3\.3\.4/ }).click()
  await page.keyboard.press('F5')
  await expect(status(page)).toHaveText('Refreshed inventory-service')
  await expect(diffViewer(page)).toContainText('Bump Spring Boot to 3.3.4')
})

test('at phone width the panes stack without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
  const navBox = await sidebar(page).boundingBox()
  const historyBox = await page.getByRole('region', { name: 'Commit graph' }).boundingBox()
  expect(historyBox!.y).toBeGreaterThan(navBox!.y + navBox!.height - 1)
})

// The desktop app's minimum window content size (electron/main/index.ts).
const SMALLEST_DESKTOP = { width: 1024, height: 640 }

test('at the smallest desktop size the whole window fits without page scroll', async ({ page }) => {
  await page.setViewportSize(SMALLEST_DESKTOP)
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))
  expect(overflow).toEqual({ x: 0, y: 0 })
  await expect(status(page)).toBeInViewport()
})

test('at the smallest desktop size the diff stays on screen and a long history scrolls inside its pane', async ({ page }) => {
  await page.setViewportSize(SMALLEST_DESKTOP)
  await expect(diffViewer(page)).toBeInViewport({ ratio: 1 })
  const history = page.getByRole('region', { name: 'Commit graph' }).locator('.overflow-auto')
  const scroll = await history.evaluate((pane) => ({ content: pane.scrollHeight, visible: pane.clientHeight }))
  expect(scroll.content).toBeGreaterThan(scroll.visible)
})

test('at the smallest desktop size branch labels stay inside the description column', async ({ page }) => {
  await page.setViewportSize(SMALLEST_DESKTOP)
  const overflowing = await page
    .getByTestId('commit-description')
    .evaluateAll((cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth).map((cell) => cell.textContent))
  expect(overflowing).toEqual([])
})

test('loads nothing from other hosts and renders in the bundled fonts', async ({ page }) => {
  await expect
    .poll(async () => {
      const fonts = await primaryFontsLoaded(page)
      return fonts.loaded.includes(fonts.sans) && fonts.loaded.includes(fonts.mono)
    })
    .toBe(true)
  const fonts = await primaryFontsLoaded(page)
  expect(fonts.sans).toMatch(/^Inter/)
  expect(fonts.mono).toMatch(/^JetBrains Mono/)
  expect(await foreignResourceUrls(page)).toEqual([])
})

// The dev server gets the relaxed dev policy (inline styles and the HMR socket); scripts stay locked down.
test('a content security policy blocks injected scripts without breaking the app', async ({ page }) => {
  // Exactly 'self': no inline scripts, no eval.
  expect(await contentSecurityPolicy(page)).toMatch(/(^|; )script-src 'self'(;|$)/)
  expect((await injectionAttempts(page)).inlineScript).toBe(false)
  const violations = await policyViolationsOnReload(page, () => expect(status(page)).toHaveText('Ready'))
  expect(violations).toEqual([])
})

test('the browser tab shows the app icon', async ({ page }) => {
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).toBeTruthy()
  const response = await page.request.get(new URL(href!, page.url()).href)
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('image/svg+xml')
  expect(await response.text()).toContain('<svg')
})
