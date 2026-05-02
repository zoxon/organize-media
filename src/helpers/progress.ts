import cliProgress from 'cli-progress'
import { bold, cyan, dim, green } from 'kleur/colors'

export interface ProgressBar {
  increment(amount: number, payload?: Record<string, unknown>): void
  stop(): void
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const BAR_FORMAT = `[${green('{bar}')}] ${bold('{percentage}%')} ${dim('({value}/{total}) · {speed} files/s · ETA {etaStr}')}  ${cyan('{filename}')}`

export function createProgressBar(total: number, label: string): ProgressBar {
  // eslint-disable-next-line no-console
  console.log(label)

  const bar = new cliProgress.SingleBar(
    {
      format: BAR_FORMAT,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  )

  const startTime = Date.now()
  let currentValue = 0
  let lastFilename = ''

  function livePayload() {
    const elapsed = (Date.now() - startTime) / 1000
    const speed = elapsed > 0 ? Math.round(currentValue / elapsed) : 0
    const etaStr = speed > 0 ? formatEta(Math.round((total - currentValue) / speed)) : '...'
    return { speed, etaStr }
  }

  bar.start(total, 0, { filename: '', speed: 0, etaStr: '...' })

  // Redraw between batches so speed/ETA don't freeze while exiftool is running
  const timer = setInterval(() => {
    bar.update(currentValue, { ...livePayload(), filename: lastFilename })
  }, 250)

  return {
    increment(amount, payload) {
      currentValue += amount
      if (payload?.filename) lastFilename = payload.filename as string
      bar.increment(amount, { ...livePayload(), ...payload })
    },
    stop() {
      clearInterval(timer)
      bar.stop()
    },
  }
}
