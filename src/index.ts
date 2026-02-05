import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'path'
import process from 'process'
import { ProgressBar } from './helpers'

/* ---------- CONFIG ---------- */

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
const RECOVER_DATE = process.argv.includes('--recover-date')

const SOURCE_DIR = process.argv[2]
const TARGET_DIR = process.argv[3]

if (!SOURCE_DIR || !TARGET_DIR) {
  console.error('Usage: npm start -- <sourceDir> <targetDir> [--recover-date]')
  process.exit(1)
}

/* ---------- TYPES ---------- */

type ExifRow = {
  SourceFile: string

  // High confidence (real capture time)
  DateTimeOriginal?: string
  CreateDate?: string
  MediaCreateDate?: string

  // Medium confidence (messengers / containers)
  MetadataDate?: string
  TrackCreateDate?: string
  CreationDate?: string

  // Low confidence (filesystem)
  FileCreateDate?: string
  FileModifyDate?: string

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

const STATE_PATH = path.join(TARGET_DIR, 'organize-state.json')
const LOG_PATH = path.join(TARGET_DIR, 'organize-log.json')
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
function resolveDate(row: ExifRow): { date: Date | null; approx: boolean } {
  // High confidence (photos)
  const exact =
    parseExifDate(row.DateTimeOriginal) ||
    parseExifDate(row.CreateDate) ||
    parseExifDate(row.MediaCreateDate)

  if (exact) {
    return { date: exact, approx: false }
  }

  if (!RECOVER_DATE) {
    return { date: null, approx: false }
  }

  // Medium confidence (messenger / container)
  const medium =
    parseExifDate(row.MetadataDate) ||
    parseExifDate(row.TrackCreateDate) ||
    parseExifDate(row.CreationDate)

  if (medium) {
    return { date: medium, approx: true }
  }

  // Low confidence (filesystem)
  const low =
    parseExifDate(row.FileCreateDate) ||
    parseExifDate(row.FileModifyDate)

  if (low) {
    return { date: low, approx: true }
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

      // High confidence
      '-DateTimeOriginal',
      '-CreateDate',
      '-MediaCreateDate',

      // Medium
      '-MetadataDate',
      '-TrackCreateDate',
      '-CreationDate',

      // Low
      '-FileCreateDate',
      '-FileModifyDate',

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
  const bar = new ProgressBar(files.length, `📸 Reading metadata `)

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const rows = await runExifTool(files.slice(i, i + BATCH_SIZE))
    for (const r of rows) {
      bar.tick(path.basename(r.SourceFile))
      results.push(r)
    }
  }

  bar.finish()
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

function isPhoto(ext: string) {
  return ['.heic', '.jpg', '.jpeg', '.png'].includes(ext)
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

/* ---------- MAIN ---------- */

async function main() {
  await ensureDir(TARGET_DIR)

  console.log('🔍 Scanning source...')
  const allFiles = await walk(SOURCE_DIR)
  const mediaFiles = allFiles.filter(isMediaFile)

  console.log(`📂 Found ${mediaFiles.length} files`)

  const meta = await runExifToolBatch(mediaFiles)
  const bar = new ProgressBar(meta.length, `📦 Copying files     `)

  for (const row of meta) {
    const { date, approx } = resolveDate(row)
    const hash = await md5(row.SourceFile)

    let baseDir: string
    let baseName: string

    if (!date) {
      baseDir = path.join(TARGET_DIR, 'no-photo-taken-date')
      baseName = hash
    } else {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const hh = String(date.getHours()).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      const ss = String(date.getSeconds()).padStart(2, '0')

      baseDir = path.join(TARGET_DIR, String(y), m, d)
      baseName = `${y}.${m}.${d}_${hh}.${mm}.${ss}-${hash}${approx ? '-approx' : ''}`
    }

    await ensureDir(baseDir)

    const ext = path.extname(row.SourceFile).toLowerCase()
    const target = path.join(baseDir, `${baseName}${ext}`)
    await fs.copyFile(row.SourceFile, target)

    bar.tick(path.basename(row.SourceFile))
  }

  bar.finish()
  console.log('🎉 Done')
}

main().catch((err) => {
  console.error('❌ Fatal:', err)
  process.exit(1)
})
