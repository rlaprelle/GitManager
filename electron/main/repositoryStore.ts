import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, normalize } from 'node:path'
import type { RepositoryCatalog, StoredRepository } from './git/GitCliDataSource'

interface StoreFile {
  version: 1
  repositories: StoredRepository[]
}

/**
 * The repositories the user added, kept in `repositories.json` in the app's data folder,
 * in the order they were added. Ids are random, and stay the same for as long as the entry
 * exists.
 */
export class RepositoryStore implements RepositoryCatalog {
  constructor(private readonly file: string) {}

  async list(): Promise<StoredRepository[]> {
    return (await this.read()).repositories
  }

  /** Adds a folder, or returns the existing entry when that folder is already in the list. */
  async add(path: string): Promise<StoredRepository> {
    const contents = await this.read()
    const existing = contents.repositories.find((repo) => sameFolder(repo.path, path))
    if (existing) return existing
    const added = { id: randomUUID(), path: withoutTrailingSlash(normalize(path)) }
    await this.write({ ...contents, repositories: [...contents.repositories, added] })
    return added
  }

  /** Forgets a repository. Never touches the folder itself. */
  async remove(id: string): Promise<void> {
    const contents = await this.read()
    await this.write({ ...contents, repositories: contents.repositories.filter((repo) => repo.id !== id) })
  }

  private async read(): Promise<StoreFile> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, repositories: [] }
      throw error
    }
    try {
      const parsed = JSON.parse(text) as StoreFile
      if (!Array.isArray(parsed.repositories)) throw new Error('no repository list')
      return parsed
    } catch {
      // Starting over would silently lose the user's list; make them look at the file instead.
      throw new Error(`Can't read ${basename(this.file)} in ${dirname(this.file)}`)
    }
  }

  /** Writes a temporary file and renames it over the old one, so a crash can't leave half a list. */
  private async write(contents: StoreFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, JSON.stringify(contents, null, 2) + '\n')
    await rename(temporary, this.file)
  }
}

/** Windows paths: case-insensitive, either slash, trailing slashes ignored. */
function sameFolder(a: string, b: string): boolean {
  const key = (path: string) => withoutTrailingSlash(normalize(path)).toLowerCase()
  return key(a) === key(b)
}

function withoutTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, '')
}
