import path from 'node:path'

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
  '.dng',
])

export function isMediaFile(file: string): boolean {
  return MEDIA_EXT.has(path.extname(file).toLowerCase())
}

export function isPhoto(ext: string) {
  return ['.heic', '.jpg', '.jpeg', '.png'].includes(ext)
}
