import { describe, expect, it } from 'vitest'
import { errorMessage } from '../errorMessage'

describe('errorMessage', () => {
  it('is an Error’s own message, without its name', () => {
    expect(errorMessage(new TypeError('no branch is checked out'))).toBe('no branch is checked out')
  })

  it('turns anything else that was thrown into text', () => {
    expect(errorMessage('offline')).toBe('offline')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})
