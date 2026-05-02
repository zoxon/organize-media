import type { ExifRow } from './helpers/exif'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { formatBaseName, formatDateDir } from './helpers/date'
import { resolveDate, runExifToolBatch } from './helpers/exif'
import { loadExifCache, loadPartialExifCache, saveExifCache } from './helpers/exif-cache'
import { ensureDir, walk } from './helpers/fs'
import { md5, md5String } from './helpers/hash'
import { createKeyboardListener } from './helpers/keyboard'
import { isMediaFile, isPhoto } from './helpers/media'
import { createProgressBar } from './helpers/progress'

const RE_BACKSLASH = /\\/g

function log(message = '') {
  process.stdout.write(`${message}\n`)
}

/* ---------- TYPES ---------- */

export interface OrganizeOptions {
  sourceDir: string
  targetDir: string
  recoverDate: boolean
}

export async function runOrganizeMedia(options: OrganizeOptions) {
  const { sourceDir, targetDir, recoverDate } = options

  await ensureDir(targetDir)

  log(`Source  ${sourceDir}`)
  log(`Target  ${targetDir}`)
  log()

  log('🔍 Scanning...')
  const allFiles = await walk(sourceDir)
  const mediaFiles = allFiles.filter(isMediaFile)

  log(`📂 Found ${mediaFiles.length} files`)

  const keyboard = createKeyboardListener()

  try {
    let meta = await loadExifCache(targetDir, sourceDir, mediaFiles.length)
    if (!meta) {
      const norm = (f: string) => f.replace(RE_BACKSLASH, '/').toLowerCase()
      const partialCache = await loadPartialExifCache(targetDir, sourceDir)
      const cached: Map<string, ExifRow> = partialCache ?? new Map()

      const filesToRead = mediaFiles.filter(f => !cached.has(norm(f)))

      if (cached.size > 0) {
        log(`📋 Resuming  (${cached.size} cached, ${filesToRead.length} remaining)`)
      }

      if (filesToRead.length > 0) {
        const newRows = await runExifToolBatch(filesToRead, keyboard)
        for (const row of newRows)
          cached.set(norm(row.SourceFile), row)
      }

      log('💾 Writing metadata cache...')
      await saveExifCache(targetDir, sourceDir, mediaFiles.length, [...cached.values()])
      meta = mediaFiles.map(f => cached.get(norm(f)) ?? { SourceFile: f })
    }
    if (keyboard.stopping) {
      log('⚡ Interrupted — run again to continue from cache')
      return
    }

    const pauseHint = process.stdin.isTTY ? '  (P = pause)' : ''
    const bar = createProgressBar(meta.length, `[2/2] 📦 Copying files${pauseHint}`)
    const noDateSources: string[] = []
    let copied = 0
    let skipped = 0

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
            photoHash: item.row.ContentIdentifier ? md5String(item.row.ContentIdentifier) : item.row.ImageDataHash,
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

    try {
      for (const item of resolved) {
        if (keyboard.stopping)
          break

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
            hash = row.ImageDataHash ?? await md5(sourceFile)
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

        const name = path.basename(sourceFile)

        try {
          await fs.access(target)
          skipped++
          bar.increment(1, { filename: name ? `→ ${name}` : '' })
          continue
        }
        catch {
          // target doesn't exist, proceed to copy
        }

        await fs.copyFile(sourceFile, target)
        copied++
        bar.increment(1, { filename: name ? `→ ${name}` : '' })

        if (keyboard.paused) {
          bar.suspend()
          bar.log('⏸  Paused — press R to resume')
          await keyboard.waitForResume()
          if (keyboard.stopping) {
            bar.log('💾 Saving progress — please wait…')
          }
          else {
            bar.resume()
            bar.log('▶  Resumed')
          }
        }
      }
    }
    finally {
      bar.stop()
    }

    if (noDateSources.length > 0) {
      const reportPath = path.join(targetDir, 'no-date-report.txt')
      const content = `${noDateSources.join('\n')}\n`
      await fs.writeFile(reportPath, content, 'utf8')
    }

    const parts = [`${copied} copied`]
    if (skipped > 0)
      parts.push(`${skipped} skipped`)
    if (noDateSources.length > 0)
      parts.push(`${noDateSources.length} no date`)
    log(`🎉 Done  ${parts.join('  ·  ')}`)
  }
  finally {
    keyboard.dispose()
  }
}
