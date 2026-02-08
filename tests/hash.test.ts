import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { md5, md5String } from '../src/helpers/hash'

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => Readable.from(['hello'])),
}))

describe('helpers/hash', () => {
  it('md5String hashes a string', () => {
    expect(md5String('test')).toBe('098f6bcd4621d373cade4e832627b4f6')
  })

  it('md5 hashes stream content', async () => {
    await expect(md5('ignored.txt')).resolves.toBe('5d41402abc4b2a76b9719d911017c592')
  })
})
