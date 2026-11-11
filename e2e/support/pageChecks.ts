import type { Page } from '@playwright/test'

// Page checks shared by the browser suite (e2e/) and the desktop suite (e2e-electron/).

/**
 * Every resource the page has loaded whose origin differs from the page's own:
 * an http://localhost page may only load from localhost, a file:// page only from disk.
 * Reads the Resource Timing buffer, so it also sees requests made before the test attached.
 */
export function foreignResourceUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const originOf = (url: string) => {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}`
    }
    const own = originOf(location.href)
    return performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => originOf(url) !== own)
  })
}

/**
 * The first family of the sans and mono font stacks, and whether a font face with that
 * family has finished loading. A missing or misnamed font would silently fall back to a
 * system font; this makes that visible.
 */
export function primaryFontsLoaded(page: Page): Promise<{ sans: string; mono: string; loaded: string[] }> {
  return page.evaluate(async () => {
    await document.fonts.ready
    const firstFamily = (element: Element | null) =>
      element ? getComputedStyle(element).fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '') : ''
    const loaded = [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family)
    return {
      sans: firstFamily(document.body),
      mono: firstFamily(document.querySelector('.font-mono')),
      loaded: [...new Set(loaded.map((family) => family.replace(/^["']|["']$/g, '')))],
    }
  })
}
