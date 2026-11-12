import { describe, expect, it } from 'vitest'
import { latestLoad } from '../latestLoad'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('latestLoad', () => {
  it('holds the empty value and reports loading until the load settles', async () => {
    const area = latestLoad<string[]>([])
    const pending = deferred<string[]>()
    const run = area.run(() => pending.promise, () => {})

    expect(area.loading.value).toBe(true)
    expect(area.value.value).toEqual([])
    pending.resolve(['a'])
    expect(await run).toBe(true)
    expect(area.loading.value).toBe(false)
    expect(area.value.value).toEqual(['a'])
  })

  it('drops a response that arrives after a newer load started', async () => {
    const area = latestLoad<string>('')
    const older = deferred<string>()
    const newer = deferred<string>()
    const olderRun = area.run(() => older.promise, () => {})
    const newerRun = area.run(() => newer.promise, () => {})

    newer.resolve('newer')
    older.resolve('older')
    expect(await newerRun).toBe(true)
    expect(await olderRun).toBe(false)
    expect(area.value.value).toBe('newer')
    expect(area.loading.value).toBe(false)
  })

  it('keeps loading while a newer load is still pending', async () => {
    const area = latestLoad<string>('')
    const older = deferred<string>()
    const olderRun = area.run(() => older.promise, () => {})
    area.run(() => new Promise<string>(() => {}), () => {})

    older.resolve('older')
    await olderRun
    expect(area.loading.value).toBe(true)
    expect(area.value.value).toBe('')
  })

  it('on failure, empties the value and reports the error once', async () => {
    const area = latestLoad<string>('empty')
    await area.run(async () => 'loaded', () => {})
    const errors: unknown[] = []

    const succeeded = await area.run(() => Promise.reject(new Error('boom')), (error) => errors.push(error))
    expect(succeeded).toBe(false)
    expect(area.value.value).toBe('empty')
    expect(area.loading.value).toBe(false)
    expect(errors).toEqual([new Error('boom')])
  })

  it('ignores the failure of a load that was overtaken', async () => {
    const area = latestLoad<string>('')
    const older = deferred<string>()
    const errors: unknown[] = []
    const olderRun = area.run(() => older.promise, (error) => errors.push(error))
    await area.run(async () => 'newer', () => {})

    older.reject(new Error('stale'))
    await olderRun
    expect(errors).toEqual([])
    expect(area.value.value).toBe('newer')
  })

  it('remembers that the latest load failed until another starts or the area is cleared', async () => {
    const area = latestLoad<string>('')
    await area.run(() => Promise.reject(new Error('boom')), () => {})
    expect(area.failed.value).toBe(true)

    const pending = deferred<string>()
    const run = area.run(() => pending.promise, () => {})
    expect(area.failed.value).toBe(false)
    pending.resolve('ok')
    await run

    await area.run(() => Promise.reject(new Error('again')), () => {})
    area.clear()
    expect(area.failed.value).toBe(false)
  })

  it('clear abandons a pending load and empties the value', async () => {
    const area = latestLoad<string>('')
    const pending = deferred<string>()
    const run = area.run(() => pending.promise, () => {})

    area.clear()
    pending.resolve('late')
    expect(await run).toBe(false)
    expect(area.value.value).toBe('')
    expect(area.loading.value).toBe(false)
  })
})
