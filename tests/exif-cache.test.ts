import type { ExifRow } from '../src/helpers/exif'

import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadExifCache, saveExifCache } from '../src/helpers/exif-cache'

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  promises: {
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
  },
}))

const CACHE_PATH = path.join('D:\\target', '.organize-media-cache.json')

describe('saveExifCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes JSON with sourceDir, fileCount, and exifData', async () => {
    fsMocks.writeFile.mockResolvedValue(undefined)
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]

    await saveExifCache('D:\\target', 'C:\\src', 1, rows)

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      CACHE_PATH,
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 1, exifData: rows }),
      'utf8',
    )
  })
})

describe('loadExifCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows when sourceDir and fileCount match', async () => {
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 1, exifData: rows }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toEqual(rows)
  })

  it('returns null when readFile throws any error', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('read failed'))

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when sourceDir does not match', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\other', fileCount: 1, exifData: [] }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when fileCount does not match', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 99, exifData: [] }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when cache JSON is malformed', async () => {
    fsMocks.readFile.mockResolvedValue('not-json{')

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when exifData is not an array', async () => {
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 1, exifData: 'bad' }),
    )
    const result = await loadExifCache('D:\\target', 'C:\\src', 1)
    expect(result).toBeNull()
  })
})
