// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MINIMUM_GIT_VERSION, gitStatusFrom, parseGitVersion } from '../gitVersion'

describe('parseGitVersion', () => {
  it('reads the version from Git for Windows and plain git output', () => {
    expect(parseGitVersion('git version 2.46.1.windows.1\n')).toBe('2.46.1')
    expect(parseGitVersion('git version 2.30.0')).toBe('2.30.0')
  })

  it('returns null for output it does not recognise', () => {
    expect(parseGitVersion('command not found')).toBeNull()
  })
})

describe('gitStatusFrom', () => {
  it('is ready for the minimum version and anything newer', () => {
    expect(MINIMUM_GIT_VERSION).toBe('2.30')
    expect(gitStatusFrom('git version 2.30.0')).toEqual({ state: 'ready', version: '2.30.0', canMerge: false })
    expect(gitStatusFrom('git version 3.0.1')).toEqual({ state: 'ready', version: '3.0.1', canMerge: true })
  })

  it('can merge from git 2.38, which has merge-tree --write-tree', () => {
    expect(gitStatusFrom('git version 2.37.9')).toMatchObject({ state: 'ready', canMerge: false })
    expect(gitStatusFrom('git version 2.38.0.windows.1')).toMatchObject({ state: 'ready', canMerge: true })
  })

  it('is too old below the minimum, comparing numerically', () => {
    expect(gitStatusFrom('git version 2.29.2')).toEqual({ state: 'too-old', version: '2.29.2', minimum: '2.30' })
    expect(gitStatusFrom('git version 2.9.5')).toEqual({ state: 'too-old', version: '2.9.5', minimum: '2.30' })
  })

  it('is missing when git did not run or said something unexpected', () => {
    expect(gitStatusFrom(null)).toEqual({ state: 'missing', minimum: '2.30' })
    expect(gitStatusFrom('unexpected')).toEqual({ state: 'missing', minimum: '2.30' })
  })
})
