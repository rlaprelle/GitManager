import { describe, expect, it } from 'vitest'
import { pluralize, splitPath, syncLabel } from './format'

describe('splitPath', () => {
  it('splits a forward-slash path into file name and directory', () => {
    expect(splitPath('src/main/App.java')).toEqual({ name: 'App.java', dir: 'src/main/' })
  })

  it('handles Windows paths and normalises the directory to forward slashes', () => {
    expect(splitPath('C:\\dev\\app\\application.yml')).toEqual({ name: 'application.yml', dir: 'C:/dev/app/' })
  })

  it('returns an empty directory for a bare file name', () => {
    expect(splitPath('pom.xml')).toEqual({ name: 'pom.xml', dir: '' })
  })
})

describe('syncLabel', () => {
  it('is empty when level with upstream', () => {
    expect(syncLabel({ ahead: 0, behind: 0 })).toBe('')
  })

  it('shows ahead and behind counts', () => {
    expect(syncLabel({ ahead: 2, behind: 1 })).toBe('↑2 ↓1')
  })
})

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'commit', 'commits')).toBe('1 commit')
    expect(pluralize(3, 'commit', 'commits')).toBe('3 commits')
  })
})
