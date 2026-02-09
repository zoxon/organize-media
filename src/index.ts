import { promises as fs } from 'node:fs'
import path from 'node:path'
import { formatBaseName, formatDateDir } from './helpers/date'
import { resolveDate, runExifToolBatch } from './helpers/exif'
import { ensureDir, walk } from './helpers/fs'
import { md5, md5String } from './helpers/hash'
import { isMediaFile, isPhoto } from './helpers/media'
import { createProgressBar } from './helpers/progress'

/* ---------- TYPES ---------- */

export interface OrganizeOptions {
  sourceDir: string
  targetDir: string
  recoverDate: boolean
}

export async function runOrganizeMedia(options: OrganizeOptions) {
  const { sourceDir, targetDir, recoverDate } = options

  await ensureDir(targetDir)

  // eslint-disable-next-line no-console
  console.log('🔍 Scanning source...')
  const allFiles = await walk(sourceDir)
  const mediaFiles = allFiles.filter(isMediaFile)

  // eslint-disable-next-line no-console
  console.log(`📂 Found ${mediaFiles.length} files`)

  const meta = await runExifToolBatch(mediaFiles)
  const bar = createProgressBar(meta.length, '📦 Copying files')
  const noDateSources: string[] = []

  const resolved = meta.map((row, i) => {
    const sourceFile = mediaFiles[i] ?? row.SourceFile
    const ext = path.extname(sourceFile).toLowerCase()
    const { date, approx } = resolveDate(row, recoverDate)

    return { row, sourceFile, ext, date, approx }
  })

  // Live Photos: reuse photo date for paired video by ContentIdentifier
  const livePhotoDates = new Map<string, { date: Date, approx: boolean }>()

  const livePhotoHashes = new Map<string, string>()
  const livePhotoNameDates = new Map<string, { date: Date, approx: boolean, photoSourceFile: string, photoHash?: string }>()

  const buildNameKey = (sourceFile: string) => {
    const parsed = path.parse(sourceFile)
    const dir = parsed.dir.toLowerCase()
    const base = parsed.name.toLowerCase()
    return `${dir}|${base}`
  }

  for (const item of resolved) {
    if (item.date && isPhoto(item.ext)) {
      const nameKey = buildNameKey(item.sourceFile)
      const prev = livePhotoNameDates.get(nameKey)

      if (!prev || (prev.approx && !item.approx)) {
        livePhotoNameDates.set(nameKey, {
          date: item.date,
          approx: item.approx,
          photoSourceFile: item.sourceFile,
        })
      }
    }

    if (!item.row.ContentIdentifier || !item.date) {
      continue
    }

    if (!isPhoto(item.ext)) {
      continue
    }

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
    const nameKey = buildNameKey(sourceFile)

    if (!date && row.ContentIdentifier) {
      const fromLive = livePhotoDates.get(row.ContentIdentifier)

      if (fromLive) {
        date = fromLive.date
        approx = fromLive.approx
      }
    }

    if (!date) {
      const fromName = livePhotoNameDates.get(nameKey)

      if (fromName) {
        date = fromName.date
        approx = fromName.approx
      }
    }

    let hash: string
    if (row.ContentIdentifier) {
      hash = livePhotoHashes.get(row.ContentIdentifier) ?? md5String(row.ContentIdentifier)
    }
    else {
      const fromName = livePhotoNameDates.get(nameKey)

      if (fromName) {
        if (!fromName.photoHash) {
          fromName.photoHash = await md5(fromName.photoSourceFile)
        }
        hash = fromName.photoHash
      }
      else {
        hash = await md5(sourceFile)
      }
    }

    const baseDir = date ? formatDateDir(targetDir, date) : path.join(targetDir, 'no-photo-taken-date')
    const baseName = date ? formatBaseName(date, hash, approx) : hash

    if (!date) {
      noDateSources.push(sourceFile)
    }

    await ensureDir(baseDir)

    const ext = item.ext
    const target = path.join(baseDir, `${baseName}${ext}`)

    try {
      await fs.access(target)
      const name = path.basename(sourceFile)
      bar.increment(1, { filename: name ? `→ ${name}` : '' })
      continue
    }
    catch {
      // target doesn't exist, proceed to copy
    }

    await fs.copyFile(sourceFile, target)

    const name = path.basename(sourceFile)
    bar.increment(1, { filename: name ? `→ ${name}` : '' })
  }

  bar.stop()

  if (noDateSources.length > 0) {
    const reportPath = path.join(targetDir, 'no-date-report.txt')
    const content = `${noDateSources.join('\n')}\n`
    await fs.writeFile(reportPath, content, 'utf8')
  }

  // eslint-disable-next-line no-console
  console.log('🎉 Done')
}
