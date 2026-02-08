import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { walk } from '../src/helpers/fs'

function dirent(name: string, isDir = false) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  }
}

vi.mock('node:fs', () => ({
  promises: {
    readdir: vi.fn(async (dir: string) => {
      if (dir === 'root') {
        return [dirent('a.txt'), dirent('sub', true)]
      }
      if (dir === path.join('root', 'sub')) {
        return [dirent('b.jpg')]
      }
      return []
    }),
  },
}))

describe('helpers/fs', () => {
  it('walks directories recursively', async () => {
    await expect(walk('root')).resolves.toEqual([
      path.join('root', 'a.txt'),
      path.join('root', 'sub', 'b.jpg'),
    ])
  })
})
