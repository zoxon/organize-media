import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const cacheMocks = vi.hoisted(() => ({
  loadExifCache: vi.fn(),
  loadPartialExifCache: vi.fn(),
  saveExifCache: vi.fn(),
}))

vi.mock('../src/helpers/exif-cache', () => ({
  loadExifCache: cacheMocks.loadExifCache,
  loadPartialExifCache: cacheMocks.loadPartialExifCache,
  saveExifCache: cacheMocks.saveExifCache,
}))

const keyboardMocks = vi.hoisted(() => ({
  createKeyboardListener: vi.fn(),
}))

vi.mock('../src/helpers/keyboard', () => ({
  createKeyboardListener: keyboardMocks.createKeyboardListener,
}))

describe('runOrganizeMedia', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    progressMocks.createProgressBar.mockReturnValue({
      increment: vi.fn(),
      stop: vi.fn(),
      log: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
    })
    cacheMocks.loadExifCache.mockResolvedValue(null)
    cacheMocks.loadPartialExifCache.mockResolvedValue(null)
    cacheMocks.saveExifCache.mockResolvedValue(undefined)
    keyboardMocks.createKeyboardListener.mockReturnValue({
      paused: false,
      stopping: false,
      waitForResume: vi.fn(),
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs before writing the metadata cache file', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg'])
    exifMocks.runExifToolBatch.mockResolvedValue([{ SourceFile: 'C:\\src\\a.jpg' }])
    exifMocks.resolveDate.mockReturnValue({ date: new Date(2024, 0, 2), approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(stdoutWrite).toHaveBeenCalledWith('💾 Writing metadata cache...\n')
    expect(cacheMocks.saveExifCache).toHaveBeenCalledWith(
      targetDir,
      sourceDir,
      1,
      [{ SourceFile: 'C:\\src\\a.jpg' }],
    )
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

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    const datedDir = formatDateDir(targetDir, exactDate)
    const hash = md5String('CID')
    const expectedName = formatBaseName(exactDate, hash, false)

    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\video.mov',
      path.join(datedDir, `${expectedName}.mov`),
    )
  })

  it('pairs live photo video by filename when ContentIdentifier is missing', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 5, 10, 11, 12, 13)

    fsMocks.walk.mockResolvedValue([
      'C:\\src\\IMG_1234.MP4',
      'C:\\src\\IMG_1234.HEIC',
    ])

    exifMocks.runExifToolBatch.mockResolvedValue([
      { SourceFile: 'C:\\src\\IMG_1234.MP4' },
      { SourceFile: 'C:\\src\\IMG_1234.HEIC' },
    ])

    exifMocks.resolveDate.mockImplementation((row: { SourceFile: string }) => {
      if (row.SourceFile.endsWith('IMG_1234.HEIC'))
        return { date, approx: false }
      return { date: null, approx: false }
    })

    hashMocks.md5.mockImplementation(async (file: string) => (file.endsWith('IMG_1234.HEIC') ? 'hash-photo' : 'hash-video'))
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(hashMocks.md5).toHaveBeenCalledTimes(1)
    expect(hashMocks.md5).toHaveBeenCalledWith('C:\\src\\IMG_1234.HEIC')

    const datedDir = formatDateDir(targetDir, date)
    const expectedName = formatBaseName(date, 'hash-photo', false)

    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\IMG_1234.MP4',
      path.join(datedDir, `${expectedName}.mp4`),
    )

    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\IMG_1234.HEIC',
      path.join(datedDir, `${expectedName}.heic`),
    )
  })

  it('pairs live photo video by filename when only photo has ContentIdentifier', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 6, 20, 9, 8, 7)

    fsMocks.walk.mockResolvedValue([
      'C:\\src\\IMG_3091.HEIC',
      'C:\\src\\IMG_3091.MP4',
    ])

    exifMocks.runExifToolBatch.mockResolvedValue([
      { SourceFile: 'C:\\src\\IMG_3091.HEIC', ContentIdentifier: 'CID' },
      { SourceFile: 'C:\\src\\IMG_3091.MP4' },
    ])

    exifMocks.resolveDate.mockImplementation((row: { SourceFile: string }) => {
      if (row.SourceFile.endsWith('IMG_3091.HEIC'))
        return { date, approx: false }
      return { date: null, approx: false }
    })

    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    // Both files must share the CID-based hash — no file-content hashing needed
    expect(hashMocks.md5).not.toHaveBeenCalled()

    const datedDir = formatDateDir(targetDir, date)
    const hash = md5String('CID')
    const expectedName = formatBaseName(date, hash, false)

    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\IMG_3091.HEIC',
      path.join(datedDir, `${expectedName}.heic`),
    )
    expect(fsPromisesMocks.copyFile).toHaveBeenCalledWith(
      'C:\\src\\IMG_3091.MP4',
      path.join(datedDir, `${expectedName}.mp4`),
    )
  })

  it('uses cached EXIF data and skips runExifToolBatch', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 0, 2, 3, 4, 5)
    const cachedRows = [{ SourceFile: 'C:\\src\\a.jpg' }]

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg', 'C:\\src\\note.txt'])
    cacheMocks.loadExifCache.mockResolvedValue(cachedRows)
    exifMocks.resolveDate.mockReturnValue({ date, approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(exifMocks.runExifToolBatch).not.toHaveBeenCalled()
    expect(cacheMocks.saveExifCache).not.toHaveBeenCalled()
    expect(cacheMocks.loadExifCache).toHaveBeenCalledWith(targetDir, sourceDir, 1)
  })

  it('calls keyboard.dispose after copying', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const disposeSpy = vi.fn()

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg'])
    cacheMocks.loadExifCache.mockResolvedValue([{ SourceFile: 'C:\\src\\a.jpg' }])
    exifMocks.resolveDate.mockReturnValue({ date: new Date(2024, 0, 2), approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    keyboardMocks.createKeyboardListener.mockReturnValue({
      paused: false,
      stopping: false,
      waitForResume: vi.fn(),
      dispose: disposeSpy,
    })

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(disposeSpy).toHaveBeenCalledOnce()
  })

  it('calls keyboard.dispose when copying throws', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const disposeSpy = vi.fn()

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg'])
    cacheMocks.loadExifCache.mockResolvedValue([{ SourceFile: 'C:\\src\\a.jpg' }])
    exifMocks.resolveDate.mockReturnValue({ date: new Date(2024, 0, 2), approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    fsPromisesMocks.copyFile.mockRejectedValue(new Error('copy failed'))
    keyboardMocks.createKeyboardListener.mockReturnValue({
      paused: false,
      stopping: false,
      waitForResume: vi.fn(),
      dispose: disposeSpy,
    })

    await expect(runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })).rejects.toThrow('copy failed')

    expect(disposeSpy).toHaveBeenCalledOnce()
  })
})
