import { type Ref, ref } from 'vue'
import { type Toast, type ToastKind, useToasts } from './toasts'

/** What the reporter needs to know about a message beyond its words. */
export interface ReportOptions {
  /**
   * The repository the message is about. A message that stays on screen names it, because the
   * user may have opened another repository by the time they read it.
   */
  repository?: string
  /**
   * The user is already being shown this where it happened (in a dialog, or in the pane it
   * belongs to), so it needs no announcement of its own.
   */
  alreadyShown?: boolean
}

/**
 * How the app tells the user things. Code says what kind of thing it has to say, by what it
 * means; it neither knows nor decides where that appears. Where is `useReporter`'s business,
 * so it can change in one place.
 */
export interface Reporter {
  /** Running commentary: what is happening, or what just happened as asked. Nothing to act on. */
  info(message: string): void
  /** News the user didn't ask for and shouldn't miss, though nothing is wrong. */
  notice(message: string, options?: ReportOptions): void
  /** Something won't go the way the user expects, or couldn't be kept. */
  warn(message: string, options?: ReportOptions): void
  /** Something the user asked for didn't happen. */
  failure(message: string, options?: ReportOptions): void
  /** Takes back something said earlier (about the same repository, if it was about one), once it no longer holds. */
  retract(message: string, options?: ReportOptions): void
}

/** A reporter, and what it puts on screen for the components that show it. */
export interface Reporting {
  report: Reporter
  /** The latest message: the status bar's line. */
  status: Ref<string>
  /** The messages waiting to be dismissed. */
  toasts: Ref<Toast[]>
  dismissToast(id: number): void
}

/**
 * The app's reporter, and the one place that decides how each kind of message is shown:
 *
 * - Every message becomes the status bar's line, the app's running commentary.
 * - A notice, a warning and a failure are also raised as a toast, which stays until dismissed: a
 *   line along the bottom of the window is easy to miss. One the user is already being shown
 *   elsewhere is not raised again.
 */
export function useReporter(): Reporting {
  const status = ref('Ready')
  const { toasts, showToast, dismissToast, retractToast } = useToasts()

  function announce(kind: ToastKind, message: string, { repository, alreadyShown = false }: ReportOptions = {}): void {
    status.value = message
    if (!alreadyShown) showToast(message, kind, repository ?? null)
  }

  const report: Reporter = {
    info(message) {
      status.value = message
    },
    notice: (message, options) => announce('notice', message, options),
    warn: (message, options) => announce('warning', message, options),
    failure: (message, options) => announce('failure', message, options),
    retract: (message, options) => retractToast(message, options?.repository ?? null),
  }

  return { report, status, toasts, dismissToast }
}
