/** What a caught value says, for the status bar or an IPC answer: anything can be thrown, not only Errors. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
