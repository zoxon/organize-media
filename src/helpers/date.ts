import path from 'node:path'

export function getDateParts(date: Date) {
  return {
    y: date.getFullYear(),
    m: String(date.getMonth() + 1).padStart(2, '0'),
    d: String(date.getDate()).padStart(2, '0'),
    hh: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  }
}

export function formatBaseName(date: Date, hash: string, approx: boolean) {
  const { y, m, d, hh, mm, ss } = getDateParts(date)
  return `${y}.${m}.${d}_${hh}.${mm}.${ss}-${hash}${approx ? '-approx' : ''}`
}

export function formatDateDir(targetDir: string, date: Date) {
  const { y, m, d } = getDateParts(date)
  return path.join(targetDir, String(y), m, d)
}
