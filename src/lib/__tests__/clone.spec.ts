import { describe, expect, it } from 'vitest'
import { cloneFailureMessage, cloneProgressLabel, cloneUrlProblem, folderNameProblem, latestCloneProgress, repositoryNameFromUrl } from '../clone'

describe('repositoryNameFromUrl', () => {
  it('takes the last part of the URL, without .git', () => {
    expect(repositoryNameFromUrl('https://github.com/rlaprelle/GitManager.git')).toBe('GitManager')
    expect(repositoryNameFromUrl('git@github.com:rlaprelle/GitManager.git')).toBe('GitManager')
    expect(repositoryNameFromUrl('ssh://git@host:2222/team/api')).toBe('api')
    expect(repositoryNameFromUrl('file:///C:/repos/tools.git/')).toBe('tools')
  })

  it('is empty when the URL has no name in it yet', () => {
    expect(repositoryNameFromUrl('')).toBe('')
    expect(repositoryNameFromUrl('https://')).toBe('')
    expect(repositoryNameFromUrl('  ')).toBe('')
  })
})

describe('cloneUrlProblem', () => {
  it('accepts https, http, ssh, git and file URLs, and scp-like addresses', () => {
    for (const url of [
      'https://github.com/rlaprelle/GitManager.git',
      'http://intranet/repo.git',
      'ssh://git@host:2222/team/api.git',
      'git://host/repo.git',
      'file:///C:/repos/tools.git',
      'git@github.com:rlaprelle/GitManager.git',
      'host.example:team/repo',
    ]) {
      expect(cloneUrlProblem(url), url).toBeNull()
    }
  })

  it('refuses what git could read as an option, or run as a command', () => {
    expect(cloneUrlProblem('--upload-pack=calc.exe')).toMatch(/isn’t a repository URL/)
    expect(cloneUrlProblem('ext::sh -c touch% /tmp/pwned')).toMatch(/isn’t a repository URL/)
    expect(cloneUrlProblem('fd::17')).toMatch(/isn’t a repository URL/)
  })

  it('refuses other schemes, local paths, spaces and empty input', () => {
    expect(cloneUrlProblem('')).toBe('Enter the repository’s URL')
    expect(cloneUrlProblem('ftp://host/repo')).toMatch(/isn’t a repository URL/)
    expect(cloneUrlProblem('C:\\repos\\tools')).toMatch(/isn’t a repository URL/)
    expect(cloneUrlProblem('https://host/my repo')).toMatch(/isn’t a repository URL/)
  })
})

describe('folderNameProblem', () => {
  it('accepts ordinary folder names', () => {
    expect(folderNameProblem('GitManager')).toBeNull()
    expect(folderNameProblem('my.repo-2')).toBeNull()
  })

  it('refuses names Windows can’t use for a folder, or that leave the parent folder', () => {
    expect(folderNameProblem('')).toBe('Enter a folder name')
    for (const name of ['a/b', 'a\\b', '..', '.', 'what?', 'name.', 'name ', 'CON', 'com1', 'lpt9.txt', 'a:b']) {
      expect(folderNameProblem(name), name).toMatch(/can’t be a folder name/)
    }
  })
})

describe('latestCloneProgress', () => {
  it('reads the phase and percentage from the last progress line git wrote', () => {
    const stderr = 'Cloning into \'tools\'...\nremote: Counting objects: 100% (12/12), done.\nReceiving objects:  42% (420/1000), 1.2 MiB | 1.0 MiB/s\r'
    expect(latestCloneProgress(stderr)).toEqual({ phase: 'Receiving objects', percent: 42 })
  })

  it('follows carriage-return updates to the newest one', () => {
    expect(latestCloneProgress('Resolving deltas:  10% (1/10)\rResolving deltas:  70% (7/10)\r')).toEqual({
      phase: 'Resolving deltas',
      percent: 70,
    })
  })

  it('drops git’s "remote: " prefix', () => {
    expect(latestCloneProgress('remote: Compressing objects:  50% (5/10)\r')).toEqual({
      phase: 'Compressing objects',
      percent: 50,
    })
  })

  it('is null when there is no progress line', () => {
    expect(latestCloneProgress("Cloning into 'tools'...\n")).toBeNull()
    expect(latestCloneProgress('')).toBeNull()
  })
})

describe('cloneProgressLabel', () => {
  it('says what is being cloned and how far it has got', () => {
    expect(cloneProgressLabel('tools', null)).toBe('Cloning tools…')
    expect(cloneProgressLabel('tools', { phase: 'Receiving objects', percent: 42 })).toBe(
      'Cloning tools… Receiving objects 42%',
    )
  })
})

describe('cloneFailureMessage', () => {
  it('finds git’s reason among the progress lines', () => {
    const stderr = "Cloning into 'tools'...\nremote: Repository not found.\nfatal: repository 'https://host/tools.git/' not found\n"
    expect(cloneFailureMessage(stderr)).toBe("repository 'https://host/tools.git/' not found")
  })

  it('is empty when git gave no reason', () => {
    expect(cloneFailureMessage("Cloning into 'tools'...\n")).toBe('')
  })
})
