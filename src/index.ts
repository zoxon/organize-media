import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'path'
import process from 'process'
import cliProgress from 'cli-progress'

/* ---------- CONFIG ---------- */

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'

/* ---------- TYPES ---------- */

export type OrganizeOptions = {
  sourceDir: string
  targetDir: string
  recoverDate: boolean
}

type ExifRow = {
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
}

type State = {
  version: 1
  processedFiles: Record<string, string>
  knownHashes: Record<string, string>
}

type LogEntry =
  | { type: 'copied'; hash: string; files: string[]; targetDir: string }
  | { type: 'duplicate'; hash: string; files: string[] }
  | { type: 'skipped'; file: string; reason: 'already-processed' }
  | { type: 'error'; file: string; message: string }

/* ---------- GLOBALS ---------- */

const BATCH_SIZE = 100

const log: LogEntry[] = []

const MEDIA_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.heic',
  '.mov', '.mp4', '.avi', '.mkv',
  '.webp', '.dng'
])

/* ---------- HELPERS ---------- */

function parseExifDate(raw?: string): Date | null {
  if (!raw) return null
  const fixed = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  const d = new Date(fixed)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Returns date and whether it is approximate
 */
function resolveDate(row: ExifRow, recoverDate: boolean): { date: Date | null; approx: boolean } {
  // High confidence (photos)
  const exact =
    parseExifDate(row.DateTimeOriginal) ||
    parseExifDate(row.SubSecDateTimeOriginal) ||
    parseExifDate(row.CreateDate) ||
    parseExifDate(row.SubSecCreateDate) ||
    parseExifDate(row.MediaCreateDate) ||
    parseExifDate(row.DateTimeCreated)

  if (exact) {
    return { date: exact, approx: false }
  }

  if (!recoverDate) {
    return { date: null, approx: false }
  }

  // Medium confidence (messenger / container)
  const medium =
    parseExifDate(row.TrackCreateDate) ||
    parseExifDate(row.CreationDate) ||
    parseExifDate(row.MetadataDate) ||
    parseExifDate(row.ModifyDate) ||
    parseExifDate(row.MediaModifyDate) ||
    parseExifDate(row.TrackModifyDate)

  if (medium) {
    return { date: medium, approx: true }
  }

  return { date: null, approx: false }
}


function isMediaFile(file: string): boolean {
  return MEDIA_EXT.has(path.extname(file).toLowerCase())
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: string[] = []

  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) result.push(...(await walk(full)))
    else if (e.isFile()) result.push(full)
  }

  return result
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
      '-@',
      '-',
    ]

    const p = spawn(EXIFTOOL, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let out = ''
    let err = ''

    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))

    for (const f of files) {
      p.stdin.write(f + '\n')
    }
    p.stdin.end()

    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || `ExifTool exited with code ${code}`))
      } else {
        resolve(JSON.parse(out))
      }
    })
  })
}

async function runExifToolBatch(files: string[]): Promise<ExifRow[]> {
  const results: ExifRow[] = []
  const bar = new cliProgress.SingleBar(
    {
      format:
        '📸 Reading metadata [{bar}] {percentage}% ({value}/{total}) {duration_formatted} {filename}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  )
  bar.start(files.length, 0, { filename: '' })

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

async function md5(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('md5')
    const s = createReadStream(file)
    s.on('error', reject)
    s.on('data', (c) => h.update(c))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

function md5String(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function isPhoto(ext: string) {
  return ['.heic', '.jpg', '.jpeg', '.png'].includes(ext)
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

/* ---------- MAIN ---------- */

export async function runOrganizeMedia(options: OrganizeOptions) {
  const { sourceDir, targetDir, recoverDate } = options
  const statePath = path.join(targetDir, 'organize-state.json')
  const logPath = path.join(targetDir, 'organize-log.json')
  void statePath
  void logPath

  await ensureDir(targetDir)

  console.log('🔍 Scanning source...')
  const allFiles = await walk(sourceDir)
  const mediaFiles = allFiles.filter(isMediaFile)

  console.log(`📂 Found ${mediaFiles.length} files`)

  const meta = await runExifToolBatch(mediaFiles)
  const bar = new cliProgress.SingleBar(
    {
      format:
        '📦 Copying files [{bar}] {percentage}% ({value}/{total}) {duration_formatted} {filename}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  )
  bar.start(meta.length, 0, { filename: '' })
  const noDateSources: string[] = []

  const resolved = meta.map((row, i) => {
    const sourceFile = mediaFiles[i] ?? row.SourceFile
    const ext = path.extname(sourceFile).toLowerCase()
    const { date, approx } = resolveDate(row, recoverDate)
    return { row, sourceFile, ext, date, approx }
  })

  // Live Photos: reuse photo date for paired video by ContentIdentifier
  const livePhotoDates = new Map<string, { date: Date; approx: boolean }>()
  const livePhotoHashes = new Map<string, string>()
  for (const item of resolved) {
    if (!item.row.ContentIdentifier || !item.date) continue
    if (!isPhoto(item.ext)) continue
    const prev = livePhotoDates.get(item.row.ContentIdentifier)
    if (!prev || (prev.approx && !item.approx)) {
      livePhotoDates.set(item.row.ContentIdentifier, { date: item.date, approx: item.approx })
    }
    if (!livePhotoHashes.has(item.row.ContentIdentifier)) {
      livePhotoHashes.set(item.row.ContentIdentifier, md5String(item.row.ContentIdentifier))
    }
  }

  for (const item of resolved) {
    const { row, sourceFile } = item
    let date = item.date
    let approx = item.approx
    if (!date && row.ContentIdentifier) {
      const fromLive = livePhotoDates.get(row.ContentIdentifier)
      if (fromLive) {
        date = fromLive.date
        approx = fromLive.approx
      }
    }

    const hash = row.ContentIdentifier
      ? (livePhotoHashes.get(row.ContentIdentifier) ?? md5String(row.ContentIdentifier))
      : await md5(sourceFile)

    let baseDir: string
    let baseName: string

    if (!date) {
      baseDir = path.join(targetDir, 'no-photo-taken-date')
      baseName = hash
      noDateSources.push(sourceFile)
    } else {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const hh = String(date.getHours()).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      const ss = String(date.getSeconds()).padStart(2, '0')

      baseDir = path.join(targetDir, String(y), m, d)
      baseName = `${y}.${m}.${d}_${hh}.${mm}.${ss}-${hash}${approx ? '-approx' : ''}`
    }

    await ensureDir(baseDir)

    const ext = item.ext
    const target = path.join(baseDir, `${baseName}${ext}`)
    try {
      await fs.access(target)
      const name = path.basename(sourceFile)
      bar.increment(1, { filename: name ? `→ ${name}` : '' })
      continue
    } catch {
      // target doesn't exist, proceed to copy
    }

    await fs.copyFile(sourceFile, target)

    const name = path.basename(sourceFile)
    bar.increment(1, { filename: name ? `→ ${name}` : '' })
  }

  bar.stop()

  if (noDateSources.length > 0) {
    const reportPath = path.join(targetDir, 'no-date-report.txt')
    const content = noDateSources.join('\n') + '\n'
    await fs.writeFile(reportPath, content, 'utf8')
  }

  console.log('🎉 Done')
}
