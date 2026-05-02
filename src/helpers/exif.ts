import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { createProgressBar } from './progress'

export interface PauseControl {
  readonly paused: boolean
  readonly stopping: boolean
  waitForResume: () => Promise<void>
}

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
const BATCH_SIZE = 100
const CONCURRENCY = 4
const RE_EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})/
const RE_BACKSLASH = /\\/g

export interface ExifRow {
  SourceFile: string

  // High confidence (real capture time)
  DateTimeOriginal?: string
  SubSecDateTimeOriginal?: string
  CreateDate?: string
  SubSecCreateDate?: string
  MediaCreateDate?: string
  DateTimeCreated?: string

  // Medium confidence (messengers / containers)
  MetadataDate?: string
  TrackCreateDate?: string
  CreationDate?: string
  ModifyDate?: string
  MediaModifyDate?: string
  TrackModifyDate?: string

  ContentIdentifier?: string
  ImageDataHash?: string
}

function parseExifDate(raw?: string): Date | null {
  if (!raw)
    return null
  const fixed = raw.replace(RE_EXIF_DATE, '$1-$2-$3')
  // EXIF dates carry no timezone; new Date() parses the result as local time
  const d = new Date(fixed)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Returns date and whether it is approximate
 */
export function resolveDate(row: ExifRow, recoverDate: boolean): { date: Date | null, approx: boolean } {
  // High confidence (photos)
  const exact
    = parseExifDate(row.DateTimeOriginal)
      || parseExifDate(row.SubSecDateTimeOriginal)
      || parseExifDate(row.CreateDate)
      || parseExifDate(row.SubSecCreateDate)
      || parseExifDate(row.MediaCreateDate)
      || parseExifDate(row.DateTimeCreated)

  if (exact) {
    return { date: exact, approx: false }
  }

  if (!recoverDate) {
    return { date: null, approx: false }
  }

  // Medium confidence (messenger / container)
  const medium
    = parseExifDate(row.TrackCreateDate)
      || parseExifDate(row.CreationDate)
      || parseExifDate(row.MetadataDate)
      || parseExifDate(row.ModifyDate)
      || parseExifDate(row.MediaModifyDate)
      || parseExifDate(row.TrackModifyDate)

  if (medium) {
    return { date: medium, approx: true }
  }

  return { date: null, approx: false }
}

const EXIF_ARGS = [
  '-json',
  '-charset',
  'filename=UTF8',
  '-DateTimeOriginal',
  '-SubSecDateTimeOriginal',
  '-CreateDate',
  '-SubSecCreateDate',
  '-MediaCreateDate',
  '-DateTimeCreated',
  '-MetadataDate',
  '-TrackCreateDate',
  '-CreationDate',
  '-ModifyDate',
  '-MediaModifyDate',
  '-TrackModifyDate',
  '-ContentIdentifier',
  '-ImageDataHash',
]

// Persistent exiftool process that avoids per-batch Perl startup overhead.
// Protocol: write args + files + "-executeN\n" per batch; read stdout until "{readyN}\n".
class ExifDaemon {
  private proc: ReturnType<typeof spawn>
  private buffer = ''
  private queue: Array<(output: string) => void> = []
  private seq = 0
  private closed = false

  constructor() {
    this.proc = spawn(EXIFTOOL, ['-stay_open', 'True', '-@', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.proc.stdout!.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      this.drain()
    })
  }

  private drain(): void {
    while (true) {
      const readyStart = this.buffer.indexOf('{ready')
      if (readyStart === -1)
        break
      const lineEnd = this.buffer.indexOf('\n', readyStart)
      if (lineEnd === -1)
        break

      const output = this.buffer.slice(0, readyStart).trimEnd()
      this.buffer = this.buffer.slice(lineEnd + 1)

      const resolver = this.queue.shift()
      resolver?.(output)
    }
  }

  run(files: string[]): Promise<ExifRow[]> {
    return new Promise((resolve, reject) => {
      const seq = ++this.seq

      this.queue.push((output) => {
        let rows: ExifRow[]
        try {
          rows = JSON.parse(output || '[]')
        }
        catch {
          reject(new Error('ExifTool produced unparseable output'))
          return
        }

        // exiftool silently skips files it cannot read; fill in stub rows to preserve alignment
        const norm = (s: string) => s.replace(RE_BACKSLASH, '/').toLowerCase()
        const byPath = new Map(rows.map(r => [norm(r.SourceFile), r]))
        resolve(files.map(f => byPath.get(norm(f)) ?? { SourceFile: f }))
      })

      for (const arg of EXIF_ARGS)
        this.proc.stdin!.write(`${arg}\n`)
      for (const file of files)
        this.proc.stdin!.write(`${file}\n`)
      this.proc.stdin!.write(`-execute${seq}\n`)
    })
  }

  close(): void {
    if (this.closed)
      return
    this.closed = true
    this.proc.stdin!.write('-stay_open\nFalse\n')
    this.proc.stdin!.end()
  }
}

export async function runExifToolBatch(files: string[], pause?: PauseControl): Promise<ExifRow[]> {
  const pauseHint = pause && process.stdin.isTTY ? '  (P = pause)' : ''
  const bar = createProgressBar(files.length, `[1/2] 📸 Reading metadata${pauseHint}`)

  const chunks: string[][] = []
  for (let i = 0; i < files.length; i += BATCH_SIZE)
    chunks.push(files.slice(i, i + BATCH_SIZE))

  const numDaemons = Math.min(CONCURRENCY, chunks.length)
  const daemons = Array.from<undefined>({ length: numDaemons }).fill(undefined).map(() => new ExifDaemon())
  const results: ExifRow[][] = Array.from({ length: chunks.length })
  let next = 0
  let pausing = false
  let pauseRequestedLogged = false
  let stopRequestedLogged = false
  let savingLogged = false

  function logSavingOnce() {
    if (savingLogged)
      return
    savingLogged = true
    bar.log('💾 Saving progress — please wait…')
  }

  async function waitIfPaused(): Promise<void> {
    if (!pause?.paused)
      return

    const logMessages = !pausing
    pausing = true
    if (logMessages) {
      bar.suspend()
      bar.log('⏸  Paused — press R to resume')
    }

    await pause.waitForResume()

    if (pause.stopping) {
      logSavingOnce()
      return
    }

    if (logMessages) {
      pausing = false
      bar.resume()
      bar.log('▶  Resumed')
    }
  }

  const statusTimer = setInterval(() => {
    if (pause?.stopping && !stopRequestedLogged) {
      stopRequestedLogged = true
      bar.suspend()
      bar.log('⏹  Stopping after current metadata batch — cache will be saved')
      return
    }

    if (pause?.paused && !pauseRequestedLogged) {
      pauseRequestedLogged = true
      bar.suspend()
      bar.log('⏸  Pausing after current metadata batch — press R to resume')
    }

    if (!pause?.paused) {
      if (pauseRequestedLogged && !pausing) {
        bar.resume()
        bar.log('▶  Resumed')
      }
      pauseRequestedLogged = false
    }
  }, 100)

  async function worker(daemon: ExifDaemon) {
    while (next < chunks.length) {
      await waitIfPaused()

      if (pause?.stopping) {
        logSavingOnce()
        break
      }

      const i = next++
      const rows = await daemon.run(chunks[i])
      for (const r of rows) {
        const name = path.basename(r.SourceFile)
        bar.increment(1, { filename: name ? `→ ${name}` : '' })
      }
      results[i] = rows
      if (pause?.stopping) {
        logSavingOnce()
        break
      }
      await waitIfPaused()
    }
  }

  try {
    await Promise.all(daemons.map(d => worker(d)))
  }
  finally {
    clearInterval(statusTimer)
    for (const d of daemons) d.close()
    bar.stop()
  }

  return results.flatMap(chunk => chunk ?? [])
}
