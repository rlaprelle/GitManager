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

  /** Adds a folder and returns its entry. */
  const added = async (store: RepositoryStore, path: string) => (await store.add(path)).repository

  it('saves added repositories, so a new store (the next launch) sees them in order', async () => {
    const store = new RepositoryStore(file)
    const first = await added(store, 'C:\\dev\\api')
    const second = await added(store, 'C:\\dev\\web')
    expect(await new RepositoryStore(file).list()).toEqual([first, second])
    expect(first.id).not.toBe(second.id)
  })

  it('finds the existing entry when the same folder is added again, ignoring case and trailing slashes', async () => {
    const store = new RepositoryStore(file)
    expect(await store.add('C:\\dev\\api')).toMatchObject({ added: true })
    const first = (await store.list())[0]
    expect(await store.add('c:\\DEV\\api\\')).toEqual({ repository: first, added: false })
    expect(await store.list()).toHaveLength(1)
  })

  it('removes a repository by id and keeps the rest', async () => {
    const store = new RepositoryStore(file)
    const api = await added(store, 'C:\\dev\\api')
    const web = await added(store, 'C:\\dev\\web')
    await store.remove(api.id)
    expect(await new RepositoryStore(file).list()).toEqual([web])
  })

  it('loses no change when adds and removes overlap', async () => {
    const store = new RepositoryStore(file)
    const paths = ['C:\\dev\\api', 'C:\\dev\\web', 'C:\\dev\\docs']
    const [api, web, docs] = await Promise.all(paths.map((path) => added(store, path)))
    expect(await new RepositoryStore(file).list()).toEqual([api, web, docs])
    await Promise.all([store.remove(api!.id), store.remove(docs!.id)])
    expect(await new RepositoryStore(file).list()).toEqual([web])
  })

  it('keeps the backslash of a drive root, which without it means the current folder on that drive', async () => {
    const store = new RepositoryStore(file)
    const root = await added(store, 'D:\\')
    expect(root.path).toBe('D:\\')
    expect(await store.add('d:/')).toEqual({ repository: root, added: false })
  })

  it('carries on with the next change after one fails', async () => {
    await writeFile(file, '{ not json')
    const store = new RepositoryStore(file)
    await expect(store.add('C:\\dev\\api')).rejects.toThrow('repositories.json')
    await rm(file)
    expect(await store.add('C:\\dev\\api')).toMatchObject({ added: true })
  })

  it('refuses to start over a file it cannot read, rather than overwrite the user’s list', async () => {
    await writeFile(file, '{ not json')
    const store = new RepositoryStore(file)
    await expect(store.list()).rejects.toThrow('repositories.json')
    await expect(store.add('C:\\dev\\api')).rejects.toThrow('repositories.json')
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })
})
