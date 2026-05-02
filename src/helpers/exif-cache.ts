import type { ExifRow } from './exif'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface CacheFile {
  sourceDir: string
  fileCount: number
  exifData: ExifRow[]
}

const CACHE_FILENAME = '.organize-media-cache.json'
const RE_BACKSLASH = /\\/g

function cachePath(targetDir: string): string {
  return path.join(targetDir, CACHE_FILENAME)
}

async function readCacheFile(targetDir: string): Promise<CacheFile | null> {
  let raw: string
  try {
    raw = await fs.readFile(cachePath(targetDir), 'utf8')
  }
  catch {
    return null
  }
  try {
    return JSON.parse(raw) as CacheFile
  }
  catch {
    return null
  }
}

export async function saveExifCache(
  targetDir: string,
  sourceDir: string,
  fileCount: number,
  rows: ExifRow[],
): Promise<void> {
  const data: CacheFile = { sourceDir, fileCount, exifData: rows }
  await fs.writeFile(cachePath(targetDir), JSON.stringify(data), 'utf8')
}

/** Returns the full cache when it is complete and clean, null otherwise. */
export async function loadExifCache(
  targetDir: string,
  sourceDir: string,
  fileCount: number,
): Promise<ExifRow[] | null> {
  const data = await readCacheFile(targetDir)
  if (!data || !Array.isArray(data.exifData))
    return null
  if (data.sourceDir !== sourceDir || data.fileCount !== fileCount)
    return null
  if (data.exifData.length !== fileCount)
    return null

  const rows = data.exifData.filter((r): r is ExifRow => r !== null && r !== undefined)
  if (rows.length !== data.exifData.length)
    return null

  return rows
}

/**
 * Returns a map of SourceFile (normalised) → ExifRow for every non-null entry
 * in the cache that belongs to sourceDir.  Used to resume an interrupted run.
 * Returns null when the cache file doesn't exist or belongs to a different source.
 */
export async function loadPartialExifCache(
  targetDir: string,
  sourceDir: string,
): Promise<Map<string, ExifRow> | null> {
  const data = await readCacheFile(targetDir)
  if (!data || !Array.isArray(data.exifData))
    return null
  if (data.sourceDir !== sourceDir)
    return null

  const norm = (s: string) => s.replace(RE_BACKSLASH, '/').toLowerCase()
  const map = new Map<string, ExifRow>()
  for (const row of data.exifData) {
    if (row !== null && row !== undefined)
      map.set(norm(row.SourceFile), row)
  }
  return map.size > 0 ? map : null
}
