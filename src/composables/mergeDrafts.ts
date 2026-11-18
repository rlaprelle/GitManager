import type { MergeSession } from './mergeFlow'

const KEY_PREFIX = 'gm.mergeDraft.'

export const mergeDraftKey = (repoId: string) => `${KEY_PREFIX}${repoId}`

/** The part of Web Storage this needs; tests pass an in-memory one. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface MergeDrafts {
  load(repoId: string): MergeSession | null
  save(repoId: string, session: MergeSession): void
  clear(repoId: string): void
}

/**
 * A merge being resolved exists only in the app until it's completed, so closing the app mustn't
 * lose the user's choices: they're kept in localStorage (the desktop app's lives in its data
 * folder), one merge per repository. Storage that is missing or full only costs the remembering.
 */
export function mergeDrafts(storage: DraftStorage | null = browserStorage()): MergeDrafts {
  return {
    load(repoId) {
      try {
        const saved = storage?.getItem(mergeDraftKey(repoId))
        return saved ? validDraft(JSON.parse(saved)) : null
      } catch {
        return null
      }
    },
    save(repoId, session) {
      attempt(() => storage?.setItem(mergeDraftKey(repoId), JSON.stringify(session)))
    },
    clear(repoId) {
      attempt(() => storage?.removeItem(mergeDraftKey(repoId)))
    },
  }
}

function attempt(work: () => void): void {
  try {
    work()
  } catch {
    // Private mode or a full quota: the merge still works, it just won't survive a restart.
  }
}

function browserStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** What was saved, if it still has the shape of a session (an older version may have written it). */
function validDraft(value: unknown): MergeSession | null {
  const draft = value as Partial<MergeSession> | null
  const request = draft?.request
  const valid =
    typeof request?.branch === 'string' &&
    typeof request.into === 'string' &&
    typeof request.ours === 'string' &&
    typeof request.theirs === 'string' &&
    typeof draft?.into === 'string' &&
    typeof draft.commits === 'number' &&
    typeof draft.path === 'string' &&
    Array.isArray(draft.files) &&
    draft.files.every((file) => typeof file?.path === 'string' && Array.isArray(file.chunks))
  return valid ? (draft as MergeSession) : null
}
