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

/** The policy from the page's Content-Security-Policy meta tag, or null when there is none. */
export function contentSecurityPolicy(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
  )
}

/**
 * Injects an inline <script> and an inline <style> and reports which took effect.
 * eval is deliberately not probed: Playwright evaluates through DevTools, which is exempt from
 * the policy's eval ban, so a probe would always report that eval works. Tests check the
 * script-src directive instead.
 */
export function injectionAttempts(page: Page): Promise<{ inlineScript: boolean; inlineStyle: boolean }> {
  return page.evaluate(() => {
    const probe = window as unknown as { injectedScriptRan?: boolean }
    const script = document.createElement('script')
    script.textContent = 'window.injectedScriptRan = true'
    document.head.append(script)

    const style = document.createElement('style')
    style.textContent = 'body { outline: 7px solid red }'
    document.head.append(style)
    const inlineStyle = getComputedStyle(document.body).outlineWidth === '7px'

    script.remove()
    style.remove()
    return { inlineScript: probe.injectedScriptRan === true, inlineStyle }
  })
}

/** Reloads the page and returns every Content-Security-Policy violation the console reported. */
export async function policyViolationsOnReload(page: Page, ready: () => Promise<void>): Promise<string[]> {
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  await page.reload()
  await ready()
  return violations
}
