import { type Ref, ref } from 'vue'

/**
 * A notice is something to know; a warning is something that won't go the way the user expects;
 * a failure is something they asked for that didn't happen.
 */
export type ToastKind = 'notice' | 'warning' | 'failure'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** What the message is about (a repository's name), shown above it; null when it needs none. */
  context: string | null
}

/** No more than this many on screen at once: the oldest gives way to a new one. */
export const MAX_TOASTS = 4

export interface Toasts {
  toasts: Ref<Toast[]>
  showToast(message: string, kind?: ToastKind, context?: string | null): void
  /** The user dismisses a toast. */
  dismissToast(id: number): void
  /** The app takes back what it said, because it no longer holds. */
  retractToast(message: string): void
}

/**
 * Toasts: messages over the corner of the window that stay until they are dismissed. One of the
 * ways the app tells the user things; code doesn't raise them itself, it reports through a
 * `Reporter` (reporter.ts), which decides what becomes a toast.
 */
export function useToasts(): Toasts {
  const toasts = ref<Toast[]>([])
  let nextId = 1

  /** Shows a toast, unless one saying the same thing about the same thing is already on screen. */
  function showToast(message: string, kind: ToastKind = 'notice', context: string | null = null): void {
    if (toasts.value.some((toast) => toast.message === message && toast.context === context)) return
    toasts.value = [...toasts.value, { id: nextId++, kind, message, context }].slice(-MAX_TOASTS)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function retractToast(message: string): void {
    toasts.value = toasts.value.filter((toast) => toast.message !== message)
  }

  return { toasts, showToast, dismissToast, retractToast }
}
