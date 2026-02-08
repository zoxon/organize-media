import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function md5(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('md5')
    const s = createReadStream(file)

    s.on('error', reject)
    s.on('data', c => h.update(c))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export function md5String(value: string): string {
  return createHash('md5').update(value).digest('hex')
}
