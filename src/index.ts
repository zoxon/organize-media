import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'path'
import process from 'process'
import { ProgressBar } from './helpers'

/* ---------- CONFIG ---------- */

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'

const SOURCE_DIR = process.argv[2]
const TARGET_DIR = process.argv[3]

if (!SOURCE_DIR || !TARGET_DIR) {
  console.error('Usage: npm start -- <sourceDir> <targetDir>')
  process.exit(1)
}

/* ---------- TYPES ---------- */

type ExifRow = {
  SourceFile: string
  DateTimeOriginal?: string
  CreateDate?: string
  MediaCreateDate?: string
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
  '.webp'
])

/* ---------- HELPERS ---------- */


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
      '-DateTimeOriginal',
      '-CreateDate',
      '-MediaCreateDate',
      '-ContentIdentifier',
      '-@', '-',
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
    const batch = files.slice(i, i + BATCH_SIZE)

    const rows = await runExifTool(batch)

    for (const r of rows) {
      bar.tick(path.basename(r.SourceFile))
      results.push(r)
    }
  }

  bar.finish()
  return results
}

function parseDate(row: ExifRow): Date | null {
  const raw = row.DateTimeOriginal || row.CreateDate || row.MediaCreateDate
  if (!raw) return null
  const fixed = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  const d = new Date(fixed)
  return isNaN(d.getTime()) ? null : d
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

async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { version: 1, processedFiles: {}, knownHashes: {} }
  }
}

async function saveState(state: State) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}


// Для переименования / копирования
async function copyFilesWithProgress(items: ExifRow[], state: State, bar: ProgressBar) {
  for (const item of items) {
    try {
      const master = item
      const hash = state.processedFiles[master.SourceFile]

      const date = parseDate(master)
      let baseDir: string
      let baseName: string

      if (!date) {
        baseDir = path.join(TARGET_DIR, 'no-photo-taken-date')
        baseName = hash
      } else {
        const y = date.getFullYear().toString()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        const hh = String(date.getHours()).padStart(2, '0')
        const mm = String(date.getMinutes()).padStart(2, '0')
        const ss = String(date.getSeconds()).padStart(2, '0')
        baseDir = path.join(TARGET_DIR, y, m, d)
        baseName = `${y}.${m}.${d}_${hh}.${mm}.${ss}-${hash}`
      }

      await ensureDir(baseDir)
      const ext = path.extname(master.SourceFile).toLowerCase()
      const target = path.join(baseDir, `${baseName}${ext}`)
      await fs.copyFile(master.SourceFile, target)

      bar.tick(path.basename(master.SourceFile))
    } catch (e: any) {
      log.push({ type: 'error', file: item.SourceFile, message: e.message ?? String(e) })
    }
  }
}


/* ---------- MAIN ---------- */

async function main() {
  await ensureDir(TARGET_DIR)

  console.log('🔍 Scanning source...')
  const allFiles = await walk(SOURCE_DIR)
  const mediaFiles = allFiles.filter(isMediaFile)

  console.log('📦 Loading state...')
  const state = await loadState()

  const newFiles = mediaFiles.filter((f) => !state.processedFiles[f])

  console.log(`📂 Found ${mediaFiles.length} files, ${newFiles.length} new`)

  if (newFiles.length === 0) {
    console.log('✅ Nothing to do')
    return
  }

  const meta = await runExifToolBatch(newFiles)

  // Сохраняем state сразу после чтения метаданных
  for (const row of meta) {
    if (!state.processedFiles[row.SourceFile]) state.processedFiles[row.SourceFile] = ''
  }
  await saveState(state)

  // Создаём общий прогрессбар на все файлы, которые будут копироваться
  const totalToCopy = meta.length
  const bar = new ProgressBar(totalToCopy, `📦 Copying files     `)

  // Группировка Live Photos
  const groups = new Map<string, ExifRow[]>()
  for (const row of meta) {
    const key = row.ContentIdentifier ?? path.basename(row.SourceFile, path.extname(row.SourceFile))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  for (const [, items] of groups) {
    try {
      const master =
        items.find((i) => isPhoto(path.extname(i.SourceFile).toLowerCase())) ?? items[0]

      if (state.processedFiles[master.SourceFile] && state.processedFiles[master.SourceFile] !== '') {
        log.push({ type: 'skipped', file: master.SourceFile, reason: 'already-processed' })
        continue
      }

      const hash = await md5(master.SourceFile)

      // Сохраняем state сразу после вычисления hash
      for (const f of items) state.processedFiles[f.SourceFile] = hash
      await saveState(state)

      if (state.knownHashes[hash]) {
        log.push({ type: 'duplicate', hash, files: items.map((i) => i.SourceFile) })
        continue
      }

      const date = parseDate(master)
      let baseDir: string
      let baseName: string

      if (!date) {
        baseDir = path.join(TARGET_DIR, 'no-photo-taken-date')
        baseName = hash
      } else {
        const y = date.getFullYear().toString()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        const hh = String(date.getHours()).padStart(2, '0')
        const mm = String(date.getMinutes()).padStart(2, '0')
        const ss = String(date.getSeconds()).padStart(2, '0')
        baseDir = path.join(TARGET_DIR, y, m, d)
        baseName = `${y}.${m}.${d}_${hh}.${mm}.${ss}-${hash}`
      }

      await ensureDir(baseDir)

      await copyFilesWithProgress(items, state, bar)

      state.knownHashes[hash] = baseName

      log.push({
        type: 'copied',
        hash,
        files: items.map((i) => i.SourceFile),
        targetDir: baseDir,
      })

      await saveState(state)
    } catch (e: any) {
      log.push({ type: 'error', file: items[0].SourceFile, message: e.message ?? String(e) })
    }
  }

  await fs.writeFile(LOG_PATH, JSON.stringify(log, null, 2), 'utf8')

  console.log(`🧾 Log: ${LOG_PATH}`)
  console.log(`📦 State: ${STATE_PATH}`)
  console.log('🎉 Done')
}

main().catch((err) => {
  console.error('❌ Fatal:', err)
  process.exit(1)
})
