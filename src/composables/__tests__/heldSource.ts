import type { GitDataSource } from '@/services/GitDataSource'
import { MockGitDataSource } from '@/services/MockGitDataSource'

type Method = keyof GitDataSource

export interface HeldCall {
  method: Method
  args: unknown[]
  /** Lets the real answer through. */
  release(): Promise<void>
  /** Answers with this error instead. */
  fail(error: Error): Promise<void>
}

/**
 * Wraps the mock so a test can hold chosen calls back and answer them later, in any order:
 * the way a real backend's responses can arrive.
 */
export function heldSource(inner: GitDataSource = new MockGitDataSource()) {
  const held = new Set<Method>()
  const calls: HeldCall[] = []

  const source = new Proxy(inner, {
    get(target, property: string) {
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const method = property as Method
        if (!held.has(method)) return value.apply(target, args)
        return new Promise((resolve, reject) => {
          calls.push({
            method,
            args,
            release: async () => {
              resolve(await value.apply(target, args))
              await settle()
            },
            fail: async (error) => {
              reject(error)
              await settle()
            },
          })
        })
      }
    },
  }) as GitDataSource

  return {
    source,
    hold(...methods: Method[]) {
      for (const method of methods) held.add(method)
    },
    letThrough(...methods: Method[]) {
      for (const method of methods) held.delete(method)
    },
    /** Held calls of one method, oldest first. */
    callsTo(method: Method): HeldCall[] {
      return calls.filter((call) => call.method === method)
    },
  }
}

/** Lets every already-resolved promise chain run to completion. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
