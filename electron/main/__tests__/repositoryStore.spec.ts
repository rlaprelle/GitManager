// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RepositoryStore } from '../repositoryStore'

let folder: string
let file: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'git-manager-store-'))
  file = join(folder, 'repositories.json')
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('RepositoryStore', () => {
  it('starts empty when there is no file yet', async () => {
    expect(await new RepositoryStore(file).list()).toEqual([])
  })

  it('saves added repositories, so a new store (the next launch) sees them in order', async () => {
    const store = new RepositoryStore(file)
    const first = await store.add('C:\\dev\\api')
    const second = await store.add('C:\\dev\\web')
    expect(await new RepositoryStore(file).list()).toEqual([first, second])
    expect(first.id).not.toBe(second.id)
  })

  it('returns the existing entry when the same folder is added again, ignoring case and trailing slashes', async () => {
    const store = new RepositoryStore(file)
    const first = await store.add('C:\\dev\\api')
    expect(await store.add('c:\\DEV\\api\\')).toEqual(first)
    expect(await store.list()).toHaveLength(1)
  })

  it('removes a repository by id and keeps the rest', async () => {
    const store = new RepositoryStore(file)
    const api = await store.add('C:\\dev\\api')
    const web = await store.add('C:\\dev\\web')
    await store.remove(api.id)
    expect(await new RepositoryStore(file).list()).toEqual([web])
  })

  it('refuses to start over a file it cannot read, rather than overwrite the user’s list', async () => {
    await writeFile(file, '{ not json')
    const store = new RepositoryStore(file)
    await expect(store.list()).rejects.toThrow('repositories.json')
    await expect(store.add('C:\\dev\\api')).rejects.toThrow('repositories.json')
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })
})
