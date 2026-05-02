import { describe, expect, it } from 'vitest'
import { isMediaFile, isPhoto } from '../src/helpers/media'

describe('helpers/media', () => {
  it('isMediaFile detects supported extensions case-insensitively', () => {
    expect(isMediaFile('C:\\x\\a.JPG')).toBe(true)
    expect(isMediaFile('C:\\x\\a.txt')).toBe(false)
  })

  it('isPhoto detects image extensions only', () => {
    expect(isPhoto('.heic')).toBe(true)
    expect(isPhoto('.jpg')).toBe(true)
    expect(isPhoto('.mov')).toBe(false)
  })
})
