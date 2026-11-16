import { type Ref, getCurrentScope, onScopeDispose, ref } from 'vue'
import { errorMessage } from '@/lib/errorMessage'
import type { UpdateSource } from '@/types/bridge'

/**
 * Whether a downloaded update is waiting for a restart, for the status bar's notice. Only the desktop
 * app has an update source; the browser build passes none and never offers one.
 */
export function useUpdateNotice(source: UpdateSource | undefined): {
  readyVersion: Ref<string | null>
  problem: Ref<string | null>
  install: () => Promise<void>
} {
  const readyVersion = ref<string | null>(null)
  const problem = ref<string | null>(null)

  if (source) {
    const stopListening = source.onReady((version) => {
      readyVersion.value = version
    })
    if (getCurrentScope()) onScopeDispose(stopListening)
    // One that finished downloading before the window was listening.
    void source
      .readyVersion()
      .then((version) => {
        if (version && !readyVersion.value) readyVersion.value = version
      })
      .catch(() => {})
  }

  async function install(): Promise<void> {
    if (!source) return
    problem.value = null
    try {
      await source.install()
    } catch (error) {
      problem.value = errorMessage(error)
    }
  }

  return { readyVersion, problem, install }
}
