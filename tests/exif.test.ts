import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { resolveDate, runExifToolBatch } from '../src/helpers/exif'

const progressMocks = vi.hoisted(() => {
  const increment = vi.fn()
  const stop = vi.fn()
  const createProgressBar = vi.fn(() => ({ increment, stop }))
  return { increment, stop, createProgressBar }
})

vi.mock('../src/helpers/progress', () => ({
  createProgressBar: progressMocks.createProgressBar,
}))

const childProcessMocks = vi.hoisted(() => {
  const spawn = vi.fn((_cmd: string, _args: string[]) => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: (d: string) => void, end: () => void }
    }

    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    let stdinData = ''

    proc.stdout = stdout
    proc.stderr = stderr
    proc.stdin = {
      write: (d: string) => {
        stdinData += d
      },
      end: () => {
        const files = stdinData
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)

        const out = JSON.stringify(files.map(SourceFile => ({ SourceFile })))
        stdout.emit('data', out)
        setImmediate(() => proc.emit('close', 0))
      },
    }

    return proc
  })

  return { spawn }
})

vi.mock('node:child_process', () => ({
  spawn: childProcessMocks.spawn,
}))

describe('helpers/exif resolveDate', () => {
  it('uses high-confidence dates', () => {
    const row = { SourceFile: 'a.jpg', DateTimeOriginal: '2024:01:02 03:04:05' }
    const res = resolveDate(row, false)
    expect(res.approx).toBe(false)
    expect(res.date).toEqual(new Date(2024, 0, 2, 3, 4, 5))
  })

  it('prefers DateTimeOriginal over other high-confidence fields', () => {
    const row = {
      SourceFile: 'a.jpg',
      DateTimeOriginal: '2024:01:02 03:04:05',
      CreateDate: '2023:12:31 23:59:59',
      MediaCreateDate: '2022:01:01 00:00:00',
    }
    const res = resolveDate(row, false)
    expect(res).toEqual({ date: new Date(2024, 0, 2, 3, 4, 5), approx: false })
  })

  it('falls back through high-confidence fields in order', () => {
    const row = {
      SourceFile: 'a.jpg',
      DateTimeOriginal: undefined,
      SubSecDateTimeOriginal: undefined,
      CreateDate: '2024:02:03 04:05:06',
      SubSecCreateDate: '2024:02:03 04:05:07',
    }
    const res = resolveDate(row, false)
    expect(res).toEqual({ date: new Date(2024, 1, 3, 4, 5, 6), approx: false })
  })

  it('skips medium-confidence dates when recovery is disabled', () => {
    const row = { SourceFile: 'a.jpg', CreationDate: '2024:01:02 03:04:05' }
    const res = resolveDate(row, false)
    expect(res).toEqual({ date: null, approx: false })
  })

  it('uses first available medium-confidence date when recovery is enabled', () => {
    const row = {
      SourceFile: 'a.jpg',
      TrackCreateDate: undefined,
      CreationDate: '2024:01:02 03:04:05',
      MetadataDate: '2024:01:02 03:04:06',
    }
    const res = resolveDate(row, true)
    expect(res).toEqual({ date: new Date(2024, 0, 2, 3, 4, 5), approx: true })
  })

  it('uses medium-confidence dates when recovery is enabled', () => {
    const row = { SourceFile: 'a.jpg', CreationDate: '2024:01:02 03:04:05' }
    const res = resolveDate(row, true)
    expect(res.approx).toBe(true)
    expect(res.date).toEqual(new Date(2024, 0, 2, 3, 4, 5))
  })
})

describe('helpers/exif runExifToolBatch', () => {
  it('processes files in batches and tracks progress', async () => {
    const files = Array.from({ length: 101 }, (_, i) => `file-${i}.jpg`)

    const res = await runExifToolBatch(files)

    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2)
    expect(progressMocks.createProgressBar).toHaveBeenCalledWith(101, '📸 Reading metadata')
    expect(progressMocks.increment).toHaveBeenCalledTimes(101)
    expect(progressMocks.stop).toHaveBeenCalledTimes(1)
    expect(res.length).toBe(101)
    expect(res[0].SourceFile).toBe('file-0.jpg')
    expect(res[100].SourceFile).toBe('file-100.jpg')
  })
})
