import type { Plugin } from 'vite'

// The page's Content-Security-Policy, delivered as a <meta> tag: the desktop app loads from
// file://, where there are no response headers to carry it. Both hosts get it.

type Policy = Record<string, string[]>

/** Built app: everything comes from the app's own files; no inline code, no eval, no outside hosts. */
export const BUILD_POLICY: Policy = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'img-src': ["'self'"],
  'connect-src': ["'self'"],
  // These two don't fall back to default-src.
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
}

/** Dev server: Vite injects imported CSS as <style> tags. Scripts stay as strict as the build. */
export const DEV_POLICY: Policy = {
  ...BUILD_POLICY,
  'style-src': ["'self'", "'unsafe-inline'"],
}

export function serializePolicy(policy: Policy): string {
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ')
}

export function contentSecurityPolicy(): Plugin {
  return {
    name: 'git-manager:content-security-policy',
    transformIndexHtml(_html, context) {
      const policy = context.server ? DEV_POLICY : BUILD_POLICY
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: serializePolicy(policy) },
          // First in <head>, so it governs every script and stylesheet after it.
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}
