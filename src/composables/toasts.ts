import { type Ref, ref } from 'vue'

/** A notice is something to know; a warning is something that won't go the way the user expects. */
export type ToastKind = 'notice' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

/** No more than this many on screen at once: the oldest gives way to a new one. */
export const MAX_TOASTS = 4

export interface Toasts {
  toasts: Ref<Toast[]>
  showToast(message: string, kind?: ToastKind): void
  dismissToast(id: number): void
}

/**
 * What the user must not miss. The status bar is a running commentary along the bottom of the
 * window and easy to overlook, so anything important is said here: a toast sits over the corner of
 * the window and stays until it is dismissed.
 */
export function useToasts(): Toasts {
  const toasts = ref<Toast[]>([])
  let nextId = 1

  /** Shows a toast, unless one saying the same thing is already on screen. */
  function showToast(message: string, kind: ToastKind = 'notice'): void {
    if (toasts.value.some((toast) => toast.message === message)) return
    toasts.value = [...toasts.value, { id: nextId++, kind, message }].slice(-MAX_TOASTS)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  return { toasts, showToast, dismissToast }
}
