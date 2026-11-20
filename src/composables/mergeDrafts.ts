import type { MergeSession } from './mergeFlow'

const KEY_PREFIX = 'gm.mergeDraft.'

export const mergeDraftKey = (repoId: string) => `${KEY_PREFIX}${repoId}`

/** The part of Web Storage this needs; tests pass an in-memory one. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface MergeDrafts {
  load(repoId: string): MergeSession | null
  /** Resolves whether the merge is now saved as given. When it isn't, no older copy of it is left either. */
  save(repoId: string, session: MergeSession): boolean
  clear(repoId: string): void
}

/**
 * A merge being resolved exists only in the app until it's completed, so closing the app mustn't
 * lose the user's choices: they're kept in localStorage (the desktop app's lives in its data
 * folder), one merge per repository. Storage that is missing or full only costs the remembering:
 * the merge carries on, and `save` says it wasn't kept so that the user can be told.
 */
export function mergeDrafts(storage: DraftStorage | null = browserStorage()): MergeDrafts {
  function load(repoId: string): MergeSession | null {
    try {
      const saved = storage?.getItem(mergeDraftKey(repoId))
      return saved ? validDraft(JSON.parse(saved)) : null
    } catch {
      return null
    }
  }

  function save(repoId: string, session: MergeSession): boolean {
    const saved = storage !== null && attempt(() => storage.setItem(mergeDraftKey(repoId), JSON.stringify(session)))
    // A refused save leaves what was saved before in place: choices older than the ones on screen,
    // which a restart would bring back as if they were current. Better to have nothing saved.
    if (!saved) clear(repoId)
    return saved
  }

  function clear(repoId: string): void {
    attempt(() => storage?.removeItem(mergeDraftKey(repoId)))
  }

  return { load, save, clear }
}

/** Runs `work`, resolving whether it went through: storage refuses in private mode, and when its quota is full. */
function attempt(work: () => void): boolean {
  try {
    work()
    return true
  } catch {
    return false
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
