import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/* ---------- CONFIG ---------- */

const EXIFTOOL = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'

const SOURCE_DIR = process.argv[2]
const OUTPUT_CSV = process.argv[3] ?? 'files-without-date.csv'

if (!SOURCE_DIR) {
  console.error('Usage: ts-node find-media-without-date.ts <sourceDir> [output.csv]')
  process.exit(1)
}

/* ---------- TYPES ---------- */

interface ExifRow {
  SourceFile: string
  DateTimeOriginal?: string
  SubSecDateTimeOriginal?: string
  CreateDate?: string
  SubSecCreateDate?: string
  MediaCreateDate?: string
  DateTimeCreated?: string
  MetadataDate?: string
  TrackCreateDate?: string
  CreationDate?: string
  ModifyDate?: string
  MediaModifyDate?: string
  TrackModifyDate?: string
}

/* ---------- HELPERS ---------- */

const MEDIA_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.mov',
  '.mp4',
  '.avi',
  '.mkv',
  '.webp',
])

function isMediaFile(file: string): boolean {
  return MEDIA_EXT.has(path.extname(file).toLowerCase())
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: string[] = []

  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory())
      result.push(...(await walk(full)))
    else if (e.isFile())
      result.push(full)
  }

  return result
}

function runExifTool(files: string[]): Promise<ExifRow[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-json',
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
      if (code !== 0) {
        reject(new Error(err || `ExifTool exited with code ${code}`))
      }
      else {
        resolve(JSON.parse(out))
      }
    })
  })
}

/* ---------- MAIN ---------- */

async function main() {
  // eslint-disable-next-line no-console
  console.log('🔍 Scanning files...')
  const allFiles = await walk(SOURCE_DIR)
  const mediaFiles = allFiles.filter(isMediaFile)

  // eslint-disable-next-line no-console
  console.log(`📂 Found ${mediaFiles.length} media files`)
  // eslint-disable-next-line no-console
  console.log('📸 Reading metadata...')

  const rows = await runExifTool(mediaFiles)

  const withoutDate = rows.filter(r =>
    !r.DateTimeOriginal
    && !r.SubSecDateTimeOriginal
    && !r.CreateDate
    && !r.SubSecCreateDate
    && !r.MediaCreateDate
    && !r.DateTimeCreated
    && !r.MetadataDate
    && !r.TrackCreateDate
    && !r.CreationDate
    && !r.ModifyDate
    && !r.MediaModifyDate
    && !r.TrackModifyDate,
  )

  // eslint-disable-next-line no-console
  console.log(`⚠️ Files without date: ${withoutDate.length}`)

  const csvLines = [
    'file_path',
  ]

  for (const r of withoutDate) {
    csvLines.push(`"${r.SourceFile.replace(/"/g, '""')}"`)
  }

  await fs.writeFile(OUTPUT_CSV, csvLines.join('\n'), 'utf8')

  // eslint-disable-next-line no-console
  console.log(`🧾 CSV saved to: ${OUTPUT_CSV}`)
}

main().catch((err) => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
