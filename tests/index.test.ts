import path from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { formatBaseName, formatDateDir } from '../src/helpers/date'
import { md5String } from '../src/helpers/hash'
import { runOrganizeMedia } from '../src/index'

const fsMocks = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  walk: vi.fn(),
}))

vi.mock('../src/helpers/fs', () => ({
  ensureDir: fsMocks.ensureDir,
  walk: fsMocks.walk,
}))

const exifMocks = vi.hoisted(() => ({
  runExifToolBatch: vi.fn(),
  resolveDate: vi.fn(),
}))

vi.mock('../src/helpers/exif', () => ({
  runExifToolBatch: exifMocks.runExifToolBatch,
  resolveDate: exifMocks.resolveDate,
}))

const progressMocks = vi.hoisted(() => ({
  createProgressBar: vi.fn(),
}))

vi.mock('../src/helpers/progress', () => ({
  createProgressBar: progressMocks.createProgressBar,
}))

const fsPromisesMocks = vi.hoisted(() => ({
  access: vi.fn(),
  copyFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  promises: {
    access: fsPromisesMocks.access,
    copyFile: fsPromisesMocks.copyFile,
    writeFile: fsPromisesMocks.writeFile,
  },
}))

const hashMocks = vi.hoisted(() => ({
  md5: vi.fn(),
}))

vi.mock('../src/helpers/hash', async () => {
  const actual = await vi.importActual<typeof import('../src/helpers/hash')>('../src/helpers/hash')
  return {
    ...actual,
    md5: hashMocks.md5,
  }
})

describe('runOrganizeMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies files and writes no-date report', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 0, 2, 3, 4, 5)

    fsMocks.walk.mockResolvedValue([
      'C:\\src\\a.jpg',
      'C:\\src\\b.mov',
      'C:\\src\\note.txt',
    ])

    exifMocks.runExifToolBatch.mockResolvedValue([
      { SourceFile: 'C:\\src\\a.jpg' },
      { SourceFile: 'C:\\src\\b.mov' },
    ])

    exifMocks.resolveDate.mockImplementation((row: { SourceFile: string }) => {
      if (row.SourceFile.endsWith('a.jpg'))
        return { date: null, approx: false }
      return { date, approx: false }
    })

    hashMocks.md5.mockImplementation(async (file: string) => (file.includes('a.jpg') ? 'hash-a' : 'hash-b'))
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    progressMocks.createProgressBar.mockReturnValue({ increment: vi.fn(), stop: vi.fn() })

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(fsMocks.ensureDir).toHaveBeenCalledWith(targetDir)
    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\a.jpg',
      path.join(targetDir, 'no-photo-taken-date', 'hash-a.jpg'),
    )

    const datedDir = formatDateDir(targetDir, date)
    const datedName = formatBaseName(date, 'hash-b', false)
    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\b.mov',
      path.join(datedDir, `${datedName}.mov`),
    )

    expect(fsPromisesMocks.writeFile).toHaveBeenCalledWith(
      path.join(targetDir, 'no-date-report.txt'),
      'C:\\src\\a.jpg\n',
      'utf8',
    )
  })

  it('reuses live photo date for paired video', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 0, 2, 3, 4, 5)

    fsMocks.walk.mockResolvedValue([
      'C:\\src\\photo.heic',
      'C:\\src\\video.mov',
    ])

    exifMocks.runExifToolBatch.mockResolvedValue([
      { SourceFile: 'C:\\src\\photo.heic', ContentIdentifier: 'CID' },
      { SourceFile: 'C:\\src\\video.mov', ContentIdentifier: 'CID' },
    ])

    exifMocks.resolveDate.mockImplementation((row: { SourceFile: string }) => {
      if (row.SourceFile.endsWith('photo.heic'))
        return { date, approx: true }
      return { date: null, approx: false }
    })

    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    progressMocks.createProgressBar.mockReturnValue({ increment: vi.fn(), stop: vi.fn() })

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(hashMocks.md5).not.toHaveBeenCalled()

    const datedDir = formatDateDir(targetDir, date)
    const hash = md5String('CID')
    const photoName = formatBaseName(date, hash, true)
    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\photo.heic',
      path.join(datedDir, `${photoName}.heic`),
    )

    const videoName = formatBaseName(date, hash, true)
    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\video.mov',
      path.join(datedDir, `${videoName}.mov`),
    )
  })

  it('uses the most reliable photo date when multiple live photos share ContentIdentifier', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const exactDate = new Date(2024, 0, 2, 3, 4, 5)
    const approxDate = new Date(2023, 11, 31, 23, 59, 59)

    fsMocks.walk.mockResolvedValue([
      'C:\\src\\photo-approx.heic',
      'C:\\src\\photo-exact.jpg',
      'C:\\src\\video.mov',
    ])

    exifMocks.runExifToolBatch.mockResolvedValue([
      { SourceFile: 'C:\\src\\photo-approx.heic', ContentIdentifier: 'CID' },
      { SourceFile: 'C:\\src\\photo-exact.jpg', ContentIdentifier: 'CID' },
      { SourceFile: 'C:\\src\\video.mov', ContentIdentifier: 'CID' },
    ])

    exifMocks.resolveDate.mockImplementation((row: { SourceFile: string }) => {
      if (row.SourceFile.endsWith('photo-approx.heic'))
        return { date: approxDate, approx: true }
      if (row.SourceFile.endsWith('photo-exact.jpg'))
        return { date: exactDate, approx: false }
      return { date: null, approx: false }
    })

    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    progressMocks.createProgressBar.mockReturnValue({ increment: vi.fn(), stop: vi.fn() })

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    const datedDir = formatDateDir(targetDir, exactDate)
    const hash = md5String('CID')
    const expectedName = formatBaseName(exactDate, hash, false)

    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\video.mov',
      path.join(datedDir, `${expectedName}.mov`),
    )
  })
})
