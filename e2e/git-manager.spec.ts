import { type Page, expect, test } from '@playwright/test'

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
  await sidebar(page).getByRole('button', { name: /storefront-web/ }).click()

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
  await expect(status(page)).toHaveText('Switched to branch main')
  await expect(page.getByRole('button', { name: /HEAD → main/ })).toBeVisible()
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

test('at phone width the panes stack without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
  const navBox = await sidebar(page).boundingBox()
  const historyBox = await page.getByRole('region', { name: 'Commit graph' }).boundingBox()
  expect(historyBox!.y).toBeGreaterThan(navBox!.y + navBox!.height - 1)
})
