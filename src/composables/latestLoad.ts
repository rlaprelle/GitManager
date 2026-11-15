import { type Ref, ref, shallowRef } from 'vue'

/**
 * One area of the screen that loads asynchronously (history, a commit's files, a diff).
 * Only the most recent load may change it: a response that arrives after a newer load
 * started, or after `clear`, is dropped, so a slow answer can't overwrite a newer selection.
 */
export interface LatestLoad<T> {
  /** The loaded value, or the empty value while loading, after a failure, or after `clear`. */
  value: Ref<T>
  loading: Ref<boolean>
  /** The latest load failed (so an empty value means "couldn't load", not "nothing there"). */
  failed: Ref<boolean>
  /** Resolves true if this load's result was applied. `onError` runs only for the latest load. */
  run(load: () => Promise<T>, onError: (error: unknown) => void): Promise<boolean>
  /**
   * Like `run`, but the current value stays on screen (and `loading` stays false) until the new
   * one arrives: for reloading what the user is already looking at. A failure empties it as `run` does.
   */
  refresh(load: () => Promise<T>, onError: (error: unknown) => void): Promise<boolean>
  clear(): void
}

export function latestLoad<T>(empty: T): LatestLoad<T> {
  const value = shallowRef<T>(empty) as Ref<T>
  const loading = ref(false)
  const failed = ref(false)
  let latest = 0

  async function run(load: () => Promise<T>, onError: (error: unknown) => void): Promise<boolean> {
    value.value = empty
    loading.value = true
    return settle(++latest, load, onError)
  }

  async function refresh(load: () => Promise<T>, onError: (error: unknown) => void): Promise<boolean> {
    return settle(++latest, load, onError)
  }

  async function settle(request: number, load: () => Promise<T>, onError: (error: unknown) => void): Promise<boolean> {
    failed.value = false
    try {
      const result = await load()
      if (request !== latest) return false
      value.value = result
      return true
    } catch (error) {
      if (request === latest) {
        value.value = empty
        failed.value = true
        onError(error)
      }
      return false
    } finally {
      if (request === latest) loading.value = false
    }
  }

  function clear(): void {
    latest++
    value.value = empty
    loading.value = false
    failed.value = false
  }

  return { value, loading, failed, run, refresh, clear }
}
