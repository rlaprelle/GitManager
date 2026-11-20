import { type Locator, type Page, expect, test } from '@playwright/test'
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

test('each branch shows its tip’s short hash, which follows the branch when a push moves it', async ({ page }) => {
  const local = sidebar(page).getByRole('button', { name: /^feature\/stock-reservations\s*HEAD/ })
  const remote = sidebar(page).getByRole('button', { name: 'origin/feature/stock-reservations', exact: true })
  // The hash is shown, and described to screen readers, without becoming part of the branch's name.
  await expect(local.getByTestId('branch-hash')).toHaveText('9f3a1c2')
  await expect(local).toHaveAccessibleDescription('9f3a1c2')
  await expect(remote.getByTestId('branch-hash')).toHaveText('a07c3be')
  await expect(remote).toHaveAccessibleDescription('a07c3be')

  await header(page).getByRole('button', { name: 'Push' }).click()
  await expect(status(page)).toHaveText('Pushed 2 commits to origin/feature/stock-reservations')
  await expect(remote.getByTestId('branch-hash')).toHaveText('9f3a1c2')
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

test('fetch, pull and push report their result in the status bar, and push clears the ahead count', async ({ page }) => {
  await expect(header(page)).toContainText('↑2 vs origin')
  await header(page).getByRole('button', { name: 'Fetch' }).click()
  await expect(status(page)).toHaveText('Fetched: everything was up to date')
  await expect(page.locator('footer')).toContainText('Last fetch: just now')

  await header(page).getByRole('button', { name: 'Pull' }).click()
  await expect(status(page)).toHaveText('Already up to date with origin/feature/stock-reservations')

  await header(page).getByRole('button', { name: 'Push' }).click()
  await expect(status(page)).toHaveText('Pushed 2 commits to origin/feature/stock-reservations')
  await expect(header(page)).not.toContainText('vs origin')
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

test('compare a file on two branches, picking it from a branch’s file list, then one from another repository', async ({ page }) => {
  await diffViewer(page).getByRole('button', { name: 'Compare two files…' }).click()
  // The browser build has no file picker, so the working tree offers no Browse….
  await expect(page.getByRole('button', { name: 'Browse for the left file' })).toHaveCount(0)

  await page.getByLabel('Left file: version').selectOption('main')
  await page.getByRole('button', { name: 'Browse for the left file' }).click()
  const files = page.getByRole('dialog', { name: /^Files on main/ })
  await files.getByRole('searchbox', { name: 'Filter files' }).fill('pom')
  await files.getByRole('button', { name: 'pom.xml' }).click()
  await expect(files).toBeHidden()

  await page.getByLabel('Right file: version').selectOption('origin/release/2.4')
  await page.getByLabel('Right file', { exact: true }).fill('pom.xml')
  await page.getByLabel('Right file', { exact: true }).press('Enter')
  await expect(page.getByTestId('left-label')).toHaveText('main · pom.xml')
  await expect(page.getByTestId('right-label')).toHaveText('origin/release/2.4 · pom.xml')
  await expect(page.getByTestId('side-by-side-diff')).toBeVisible()

  await page.getByLabel('Right file: repository').selectOption({ label: 'pricing-api' })
  await expect(page.getByLabel('Right file: version')).toHaveValue('')
  await expect(page.getByTestId('right-label')).toHaveText('pricing-api · pom.xml')

  await page.getByRole('button', { name: 'Swap left and right files' }).click()
  await expect(page.getByTestId('left-label')).toHaveText('pricing-api · pom.xml')
  await expect(page.getByLabel('Left file: repository')).toHaveValue('pricing')
})

test.describe('cloning a repository', () => {
  const cloneDialog = (page: Page) => page.getByRole('dialog', { name: 'Clone a repository' })

  async function fillCloneDialog(page: Page, url: string) {
    await sidebar(page).getByRole('button', { name: 'Clone repository' }).click()
    await expect(cloneDialog(page)).toBeVisible()
    await cloneDialog(page).getByRole('button', { name: 'Browse…' }).click()
    await expect(cloneDialog(page).getByTestId('clone-folder')).toHaveText('C:\\dev')
    await cloneDialog(page).getByLabel('Repository URL').fill(url)
  }

  test('clones from a URL into the chosen folder, then lists and opens the clone', async ({ page }) => {
    await fillCloneDialog(page, 'https://github.com/rlaprelle/tools.git')
    await expect(cloneDialog(page).getByLabel('Folder name')).toHaveValue('tools')
    await expect(cloneDialog(page).getByTestId('clone-destination')).toHaveText('C:\\dev\\tools')
    await cloneDialog(page).getByRole('button', { name: 'Clone', exact: true }).click()

    await expect(cloneDialog(page).getByRole('status')).toContainText('Cloning tools…')
    await expect(cloneDialog(page)).toBeHidden()
    await expect(status(page)).toHaveText('Cloned tools')
    await expect(header(page).getByTestId('header-repo')).toHaveText('tools')
    await expect(sidebar(page).getByRole('button', { name: /^tools/ })).toBeVisible()
  })

  test('Cancel clone stops it, and nothing is added', async ({ page }) => {
    await fillCloneDialog(page, 'https://github.com/rlaprelle/tools.git')
    await cloneDialog(page).getByRole('button', { name: 'Clone', exact: true }).click()
    await cloneDialog(page).getByRole('button', { name: 'Cancel clone' }).click()
    await expect(status(page)).toHaveText('Clone cancelled')
    await expect(sidebar(page).getByRole('button', { name: /^tools/ })).toHaveCount(0)
    await cloneDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cloneDialog(page)).toBeHidden()
  })

  test('a clone that fails keeps the dialog open and says why', async ({ page }) => {
    await fillCloneDialog(page, 'https://github.com/rlaprelle/pricing-api.git')
    await cloneDialog(page).getByRole('button', { name: 'Clone', exact: true }).click()
    await expect(cloneDialog(page).getByRole('alert')).toHaveText('C:\\dev\\pricing-api already exists and isn’t empty')
    await cloneDialog(page).getByLabel('Folder name').fill('pricing-copy')
    await cloneDialog(page).getByRole('button', { name: 'Clone', exact: true }).click()
    await expect(header(page).getByTestId('header-repo')).toHaveText('pricing-copy')
  })

  test('refuses a URL git could run as a command, and Esc closes the dialog', async ({ page }) => {
    await fillCloneDialog(page, 'ext::sh -c calc')
    await cloneDialog(page).getByLabel('Folder name').click()
    await expect(cloneDialog(page)).toContainText('isn’t a repository URL')
    await expect(cloneDialog(page).getByRole('button', { name: 'Clone', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(cloneDialog(page)).toBeHidden()
  })
})

test.describe('resizing the panes', () => {
  const separator = (page: Page, label: string) => page.getByRole('separator', { name: label })
  const widthOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.width)
  const heightOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.height)

  /** Drags a divider with the mouse, from its centre, by (dx, dy). */
  async function drag(page: Page, label: string, dx: number, dy: number) {
    const box = (await separator(page, label).boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y + dy / 2)
    await page.mouse.move(x + dx, y + dy)
    await page.mouse.up()
  }

  test('dragging the sidebar’s edge widens it, the width survives a reload, and double-click resets it', async ({ page }) => {
    const before = await widthOf(sidebar(page))
    await drag(page, 'Resize the sidebar', 90, 0)
    expect(await widthOf(sidebar(page))).toBe(before + 90)
    await expect(separator(page, 'Resize the sidebar')).toHaveAttribute('aria-valuenow', String(before + 90))

    await page.reload()
    await expect(header(page)).toBeVisible()
    expect(await widthOf(sidebar(page))).toBe(before + 90)

    await separator(page, 'Resize the sidebar').dblclick()
    expect(await widthOf(sidebar(page))).toBe(before)
    await page.reload()
    await expect(header(page)).toBeVisible()
    expect(await widthOf(sidebar(page))).toBe(before)
  })

  test('the repository list, diff panel and file list resize by dragging too', async ({ page }) => {
    const repositoryList = sidebar(page).locator('section').first()
    const repositoriesBefore = await heightOf(repositoryList)
    await drag(page, 'Resize the repository list', 0, -60)
    expect(await heightOf(repositoryList)).toBe(repositoriesBefore - 60)

    expect(await heightOf(diffViewer(page))).toBe(400)
    await drag(page, 'Resize the diff panel', 0, -100)
    expect(await heightOf(diffViewer(page))).toBe(500)

    const list = separator(page, 'Resize the file list')
    const before = Number(await list.getAttribute('aria-valuenow'))
    await drag(page, 'Resize the file list', 80, 0)
    await expect(list).toHaveAttribute('aria-valuenow', String(before + 80))
  })

  test('the dividers move with the arrow keys', async ({ page }) => {
    await separator(page, 'Resize the diff panel').focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Shift+ArrowUp')
    expect(await heightOf(diffViewer(page))).toBe(400 + 16 + 64)

    const sidebarBefore = await widthOf(sidebar(page))
    await separator(page, 'Resize the sidebar').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await widthOf(sidebar(page))).toBe(sidebarBefore - 16)
  })

  test('at the smallest desktop size, dragging every divider to its limit still fits the window', async ({ page }) => {
    await page.setViewportSize(SMALLEST_DESKTOP)
    await drag(page, 'Resize the sidebar', 600, 0)
    await drag(page, 'Resize the repository list', 0, 600)
    await drag(page, 'Resize the diff panel', 0, -600)
    await drag(page, 'Resize the file list', 600, 0)

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }))
    expect(overflow).toEqual({ x: 0, y: 0 })
    // Each neighbour keeps its share: History, the branches, and the diff beside the file list.
    expect(await heightOf(page.getByRole('region', { name: 'Commit graph' }))).toBeGreaterThanOrEqual(220)
    await expect(sidebar(page).getByRole('heading', { name: 'Branches' })).toBeInViewport()
    const diff = page.getByTestId('unified-diff')
    await expect(diff).toBeInViewport()
    const listBox = (await separator(page, 'Resize the file list').boundingBox())!
    expect((await diff.boundingBox())!.y).toBeLessThan(listBox.y + listBox.height) // side by side, not wrapped below
  })

  test('a size remembered from a bigger window gives way when the window is smaller', async ({ page }) => {
    const before = await widthOf(sidebar(page))
    await drag(page, 'Resize the sidebar', 400, 0)
    expect(await widthOf(sidebar(page))).toBe(before + 400)
    await page.setViewportSize(SMALLEST_DESKTOP)
    expect(await widthOf(sidebar(page))).toBe(SMALLEST_DESKTOP.width - 720)
  })

  test('at phone width there are no dividers, and the panes stack as before', async ({ page }) => {
    await drag(page, 'Resize the sidebar', 90, 0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('separator')).toHaveCount(0)
    expect(await widthOf(sidebar(page))).toBe(390)
  })
})

test.describe('merging', () => {
  const INTO = 'feature/stock-reservations'
  const mergeDialog = (page: Page) => page.getByRole('dialog', { name: `Merge into ${INTO}` })
  const resolver = (page: Page) => page.getByTestId('merge-resolver')
  const arrow = (page: Page, name: string) => resolver(page).getByRole('button', { name, exact: true })
  const resultPane = (page: Page) => resolver(page).locator('[data-pane="result"]')
  const complete = (page: Page) => page.getByRole('button', { name: 'Complete merge' })

  async function pickBranch(page: Page, branch: string) {
    await header(page).getByRole('button', { name: 'Merge…' }).click()
    await mergeDialog(page).getByLabel('Branch to merge').selectOption(branch)
  }

  async function openResolver(page: Page) {
    await pickBranch(page, 'main')
    await mergeDialog(page).getByRole('button', { name: 'Resolve conflicts…' }).click()
    await expect(resolver(page)).toBeVisible()
  }

  async function pageOverflow(page: Page) {
    return page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }))
  }

  test('a clean merge completes from the dialog and appears in the history', async ({ page }) => {
    await pickBranch(page, 'bugfix/sku-null-check')
    await expect(mergeDialog(page).getByTestId('merge-into')).toHaveText(`HEAD → ${INTO}`)
    await expect(mergeDialog(page).getByTestId('merge-conflicts')).toHaveText('No conflicts.')
    await mergeDialog(page).getByRole('button', { name: 'Merge', exact: true }).click()

    await expect(status(page)).toHaveText(`Merged bugfix/sku-null-check into ${INTO} (1 commit)`)
    await expect(mergeDialog(page)).toBeHidden()
    await expect(page.getByRole('button', { name: new RegExp(`Merge branch 'bugfix/sku-null-check' into ${INTO}`) })).toBeVisible()
  })

  test('a branch with nothing new says so and can’t be merged; Esc closes the dialog', async ({ page }) => {
    await pickBranch(page, `origin/${INTO}`)
    await expect(mergeDialog(page).getByRole('alert')).toContainText('already has every commit')
    await expect(mergeDialog(page).getByRole('button', { name: 'Merge', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(mergeDialog(page)).toBeHidden()
  })

  test('conflicts are resolved with the arrows, by hand, and completed', async ({ page }) => {
    await pickBranch(page, 'main')
    await expect(mergeDialog(page).getByTestId('merge-conflicts')).toContainText('Conflicts in 2 files')
    await mergeDialog(page).getByRole('button', { name: 'Resolve conflicts…' }).click()

    await expect(status(page)).toHaveText('3 conflicts to resolve in 2 files · Nothing on disk has changed yet')
    await expect(sidebar(page)).toBeHidden()
    await expect(header(page).getByRole('button', { name: 'Fetch' })).toBeDisabled()
    await expect(complete(page)).toBeDisabled()
    await expect(resolver(page).getByTestId('merge-left')).toHaveText('2 conflicts left')
    await expect(resolver(page).getByTestId('merge-base').first()).toContainText('low-stock-threshold: 10')

    // Both sides of the first conflict, theirs first: the result stacks them in that order.
    await arrow(page, 'Bring in theirs for conflict 1').click()
    await arrow(page, 'Bring in ours for conflict 1').click()
    await expect(arrow(page, 'Take back theirs for conflict 1')).toHaveAttribute('aria-pressed', 'true')
    const result = await resultPane(page).allInnerTexts()
    const joined = result.join('\n')
    expect(joined.indexOf('reorder-enabled')).toBeLessThan(joined.indexOf('low-stock-threshold: 25'))
    await expect(resolver(page).getByTestId('merge-settled')).toContainText('Conflict 1: theirs then ours')

    await arrow(page, 'Bring in ours for conflict 2').click()
    await expect(resolver(page).getByTestId('merge-left')).toHaveText('All conflicts resolved')
    await resolver(page).getByRole('button', { name: 'Mark resolved' }).click()
    await expect(resolver(page).getByRole('button', { name: 'Marked resolved' })).toBeDisabled()
    await expect(resolver(page).getByRole('navigation').getByRole('button').first()).toContainText('resolved')

    // A change after marking clears the mark.
    await arrow(page, 'Take back ours for conflict 2').click()
    await expect(resolver(page).getByRole('button', { name: 'Mark resolved' })).toBeDisabled()
    await arrow(page, 'Bring in theirs for conflict 2').click()
    await expect(resolver(page).getByRole('navigation').getByRole('button').first()).toContainText('ready')

    await resolver(page).getByRole('navigation').getByRole('button', { name: /^pom\.xml/ }).click()
    await expect(resolver(page).getByTestId('merge-file')).toHaveText('pom.xml')
    await resolver(page).getByRole('button', { name: 'Edit conflict 1 by hand' }).click()
    const box = resolver(page).getByRole('textbox', { name: 'Lines for conflict 1' })
    await expect(box).toBeFocused()
    await expect(box).toHaveValue(/2\.4\.0-SNAPSHOT[\s\S]*2\.3\.1/)
    await expect(arrow(page, 'Finish editing first').first()).toBeDisabled()
    await box.fill('  <version>2.4.0</version>')
    await resolver(page).getByRole('button', { name: 'Done' }).click()
    await expect(resultPane(page).filter({ hasText: '<version>2.4.0</version>' })).toBeVisible()
    await expect(resolver(page).getByTestId('merge-settled')).toContainText('edited by hand')

    await complete(page).click()
    await expect(status(page)).toHaveText(`Merged main into ${INTO} (2 commits)`)
    await expect(resolver(page)).toBeHidden()
    await expect(sidebar(page)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`Merge branch 'main' into ${INTO}`) })).toBeVisible()
  })

  test('ribbons are drawn from each changed side to the result', async ({ page }) => {
    await openResolver(page)
    const ribbon = resolver(page).locator('[data-ribbon-side="ours"] path').first()
    await expect(ribbon).toHaveAttribute('d', /^M0,\d/)
  })

  test('the keyboard moves between conflicts and brings sides in', async ({ page }) => {
    await openResolver(page)
    await expect(resolver(page)).toContainText('Conflict 1 of 2')
    await page.keyboard.press('F7')
    await expect(resolver(page)).toContainText('Conflict 2 of 2')
    await expect(resolver(page).locator('[data-conflict="2"]')).toBeFocused()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(arrow(page, 'Take back theirs for conflict 2')).toBeVisible()
    await page.keyboard.press('Shift+F7')
    await expect(resolver(page)).toContainText('Conflict 1 of 2')
  })

  test('discarding asks once something is decided, and changes nothing', async ({ page }) => {
    await openResolver(page)
    await arrow(page, 'Bring in ours for conflict 1').click()
    await page.getByRole('button', { name: 'Discard merge' }).click()
    const confirm = page.getByRole('dialog', { name: 'Discard this merge?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(arrow(page, 'Take back ours for conflict 1')).toBeVisible()

    await page.getByRole('button', { name: 'Discard merge' }).click()
    await confirm.getByRole('button', { name: 'Discard merge' }).click()
    await expect(status(page)).toHaveText('Merge discarded; nothing changed')
    await expect(sidebar(page)).toBeVisible()
    await expect(page.getByText('10 commits · all branches')).toBeVisible()
  })

  test('a reload picks the merge back up, with its choices', async ({ page }) => {
    await openResolver(page)
    await arrow(page, 'Bring in ours for conflict 1').click()
    await page.reload()
    await expect(status(page)).toHaveText(`Continuing your merge of main into ${INTO} · Nothing on disk has changed yet`)
    await expect(arrow(page, 'Take back ours for conflict 1')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a merge saved and waiting is only replaced once you agree', async ({ page }) => {
    await openResolver(page)
    // As if another branch had been checked out outside the app: the saved merge is for one that isn't current.
    await page.evaluate(() => {
      const key = 'gm.mergeDraft.inventory'
      const saved = JSON.parse(localStorage.getItem(key)!)
      saved.into = saved.request.into = 'release/2.4'
      localStorage.setItem(key, JSON.stringify(saved))
    })
    await page.reload()
    await expect(status(page)).toHaveText('Your merge of main into release/2.4 is waiting: check out release/2.4 to continue it')

    await pickBranch(page, 'main')
    await expect(mergeDialog(page).getByTestId('merge-waiting')).toHaveText('Your merge of main into release/2.4 is saved and waiting.')
    await mergeDialog(page).getByRole('button', { name: 'Resolve conflicts…' }).click()
    const asking = page.getByRole('dialog', { name: 'Replace your saved merge?' })
    await expect(asking).toContainText('The choices you made merging main into release/2.4 will be dropped.')
    await asking.getByRole('button', { name: 'Cancel' }).click()
    await expect(asking).toBeHidden()
    await expect(mergeDialog(page)).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gm.mergeDraft.inventory')!).into)).toBe('release/2.4')

    await mergeDialog(page).getByRole('button', { name: 'Resolve conflicts…' }).click()
    await asking.getByRole('button', { name: 'Replace it' }).click()
    await expect(resolver(page)).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gm.mergeDraft.inventory')!).into)).toBe(INTO)
  })

  test('at the smallest desktop size the page itself doesn’t scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 })
    await openResolver(page)
    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 })
  })

  test('at phone width it is one column, with both sides inside each conflict', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openResolver(page)
    expect((await pageOverflow(page)).x).toBeLessThanOrEqual(0)
    await expect(resolver(page).locator('[data-pane="ours"]').first()).toBeHidden()
    await expect(resolver(page).getByRole('button', { name: 'Bring in ours for conflict 1' })).toBeHidden()

    await resolver(page).getByRole('button', { name: 'Use ours' }).first().click()
    await resolver(page).getByRole('button', { name: 'Add theirs too' }).click()
    await expect(resolver(page).getByTestId('merge-settled').first()).toContainText('Conflict 1: ours then theirs')
    await resolver(page).getByRole('button', { name: 'Use theirs' }).first().click()
    await resolver(page).getByLabel('Conflicted file', { exact: true }).selectOption('pom.xml')
    await resolver(page).getByRole('button', { name: 'Use ours' }).first().click()
    await complete(page).click()
    await expect(status(page)).toHaveText(`Merged main into ${INTO} (2 commits)`)
  })
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
