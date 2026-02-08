import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: string[] = []

  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      result.push(...(await walk(full)))
    }
    else if (e.isFile()) {
      result.push(full)
    }
  }

  return result
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}
