import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDate, runExifToolBatch } from '../src/helpers/exif'

const progressMocks = vi.hoisted(() => {
  const increment = vi.fn()
  const log = vi.fn()
  const suspend = vi.fn()
  const resume = vi.fn()
  const stop = vi.fn()
  const createProgressBar = vi.fn(() => ({ increment, log, suspend, resume, stop }))
  return { increment, log, suspend, resume, stop, createProgressBar }
})

vi.mock('../src/helpers/progress', () => ({
  createProgressBar: progressMocks.createProgressBar,
}))

// Simulates the exiftool -stay_open daemon protocol.
// Watches stdin for "-executeN\n" markers and responds via stdout with JSON + "{readyN}\n".
const childProcessMocks = vi.hoisted(() => {
  let responseDelayMs = 0
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
        const re = /-execute(\d+)\n/
        let match: RegExpExecArray | null = re.exec(stdinData)
        while (match !== null) {
          const seqNum = match[1]
          const block = stdinData.slice(0, match.index)
          stdinData = stdinData.slice(match.index + match[0].length)

          const lines = block.split('\n').map(s => s.trim()).filter(Boolean)
          const files = lines.filter(l => !l.startsWith('-'))

          const out = JSON.stringify(files.map(SourceFile => ({ SourceFile })))
          if (responseDelayMs > 0)
            setTimeout(() => stdout.emit('data', `${out}\n{ready${seqNum}}\n`), responseDelayMs)
          else
            setImmediate(() => stdout.emit('data', `${out}\n{ready${seqNum}}\n`))
          match = re.exec(stdinData)
        }
      },
      end: () => {},
    }

    return proc
  })

  return {
    setResponseDelayMs(value: number) {
      responseDelayMs = value
    },
    spawn,
  }
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    childProcessMocks.setResponseDelayMs(0)
  })

  it('returns stub rows for unreadable files and continues without crashing', async () => {
    childProcessMocks.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        stdin: { write: (d: string) => void, end: () => void }
      }
      const stdout = new EventEmitter()
      proc.stdout = stdout
      proc.stderr = new EventEmitter()
      let stdinData = ''
      proc.stdin = {
        write: (d: string) => {
          stdinData += d
          const re = /-execute(\d+)\n/
          const match = re.exec(stdinData)
          if (match) {
            const seqNum = match[1]
            stdinData = stdinData.slice(match.index + match[0].length)
            proc.stderr.emit('data', 'File format error - bad.avi\n')
            // Only good.jpg returned; exiftool silently skips bad.avi
            setImmediate(() => stdout.emit('data', `${JSON.stringify([{ SourceFile: 'good.jpg' }])}\n{ready${seqNum}}\n`))
          }
        },
        end: () => {},
      }
      return proc
    })

    const res = await runExifToolBatch(['good.jpg', 'bad.avi'])

    expect(res).toHaveLength(2)
    expect(res[0].SourceFile).toBe('good.jpg')
    expect(res[1].SourceFile).toBe('bad.avi')
    expect(res[1].DateTimeOriginal).toBeUndefined()
  })

  it('processes files in batches across daemon pool and tracks progress', async () => {
    const files = Array.from({ length: 101 }, (_, i) => `file-${i}.jpg`)

    const res = await runExifToolBatch(files)

    // Pool of daemons: one per worker (min(CONCURRENCY, chunks) = min(4, 2) = 2)
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2)
    expect(progressMocks.createProgressBar).toHaveBeenCalledWith(101, '[1/2] 📸 Reading metadata')
    expect(progressMocks.increment).toHaveBeenCalledTimes(101)
    expect(progressMocks.stop).toHaveBeenCalledTimes(1)
    expect(res.length).toBe(101)
    expect(res[0].SourceFile).toBe('file-0.jpg')
    expect(res[100].SourceFile).toBe('file-100.jpg')
  })

  it('does not log resumed when Ctrl+C stop releases a paused metadata read', async () => {
    let stopping = false
    const pause = {
      get paused() { return true },
      get stopping() { return stopping },
      waitForResume: vi.fn(async () => {
        stopping = true
      }),
    }

    await runExifToolBatch(['file-0.jpg'], pause)

    expect(progressMocks.log).toHaveBeenCalledWith('⏸  Paused — press R to resume')
    expect(progressMocks.log).toHaveBeenCalledWith('💾 Saving progress — please wait…')
    expect(progressMocks.log).not.toHaveBeenCalledWith('▶  Resumed')
    expect(progressMocks.suspend).toHaveBeenCalled()
    expect(progressMocks.resume).not.toHaveBeenCalled()
  })

  it('logs that metadata reading is pausing while current batch finishes', async () => {
    vi.useFakeTimers()
    childProcessMocks.setResponseDelayMs(1000)
    let paused = false
    let resume: (() => void) | undefined
    const pause = {
      get paused() { return paused },
      get stopping() { return false },
      waitForResume: vi.fn(() => new Promise<void>((resolve) => {
        resume = resolve
      })),
    }

    const run = runExifToolBatch(['file-0.jpg'], pause)
    paused = true

    await vi.advanceTimersByTimeAsync(250)

    expect(progressMocks.log).toHaveBeenCalledWith('⏸  Pausing after current metadata batch — press R to resume')
    expect(progressMocks.suspend).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    paused = false
    resume?.()
    await run
  })

  it('resumes the progress bar when pause is canceled before the current metadata batch finishes', async () => {
    vi.useFakeTimers()
    childProcessMocks.setResponseDelayMs(1000)
    let paused = false
    const pause = {
      get paused() { return paused },
      get stopping() { return false },
      waitForResume: vi.fn(),
    }

    const run = runExifToolBatch(['file-0.jpg'], pause)
    paused = true

    await vi.advanceTimersByTimeAsync(250)
    expect(progressMocks.log).toHaveBeenCalledWith('⏸  Pausing after current metadata batch — press R to resume')
    expect(progressMocks.suspend).toHaveBeenCalled()

    paused = false
    await vi.advanceTimersByTimeAsync(100)

    expect(progressMocks.resume).toHaveBeenCalled()
    expect(progressMocks.log).toHaveBeenCalledWith('▶  Resumed')

    await vi.advanceTimersByTimeAsync(1000)
    await run
  })

  it('logs that metadata reading is stopping while current batch finishes', async () => {
    vi.useFakeTimers()
    childProcessMocks.setResponseDelayMs(1000)
    let stopping = false
    const pause = {
      get paused() { return false },
      get stopping() { return stopping },
      waitForResume: vi.fn(),
    }

    const run = runExifToolBatch(['file-0.jpg'], pause)
    await vi.advanceTimersByTimeAsync(0)
    stopping = true

    await vi.advanceTimersByTimeAsync(250)

    expect(progressMocks.log).toHaveBeenCalledWith('⏹  Stopping after current metadata batch — cache will be saved')
    expect(progressMocks.suspend).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    await run
  })
})
