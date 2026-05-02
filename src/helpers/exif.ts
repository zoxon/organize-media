import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { createProgressBar } from './progress'

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
const BATCH_SIZE = 100

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
  const fixed = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
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

function runExifTool(files: string[]): Promise<ExifRow[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-json',
      '-charset',
      'filename=UTF8',

      // High confidence
      '-DateTimeOriginal',
      '-SubSecDateTimeOriginal',
      '-CreateDate',
      '-SubSecCreateDate',
      '-MediaCreateDate',
      '-DateTimeCreated',

      // Medium
      '-MetadataDate',
      '-TrackCreateDate',
      '-CreationDate',
      '-ModifyDate',
      '-MediaModifyDate',
      '-TrackModifyDate',

      '-ContentIdentifier',
      '-ImageDataHash',
      '-@',
      '-',
    ]

    const p = spawn(EXIFTOOL, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let out = ''
    let err = ''

    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))

    for (const f of files) {
      p.stdin.write(`${f}\n`)
    }
    p.stdin.end()

    p.on('close', (code) => {
      if (code !== 0 && !out.trim()) {
        reject(new Error(`ExifTool exited with code ${code}`))
        return
      }

      let rows: ExifRow[]
      try {
        rows = JSON.parse(out || '[]')
      }
      catch {
        reject(new Error(`ExifTool produced unparseable output (exit code ${code})`))
        return
      }

      // exiftool silently skips files it cannot read; fill in stub rows to preserve alignment
      const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
      const byPath = new Map(rows.map(r => [norm(r.SourceFile), r]))
      resolve(files.map(f => byPath.get(norm(f)) ?? { SourceFile: f }))
    })
  })
}

export async function runExifToolBatch(files: string[]): Promise<ExifRow[]> {
  const results: ExifRow[] = []
  const bar = createProgressBar(files.length, '📸 Reading metadata')

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const rows = await runExifTool(files.slice(i, i + BATCH_SIZE))

    for (const r of rows) {
      const name = path.basename(r.SourceFile)
      bar.increment(1, { filename: name ? `→ ${name}` : '' })
      results.push(r)
    }
  }

  bar.stop()
  return results
}
