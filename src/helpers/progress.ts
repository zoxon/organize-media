import process from 'node:process'
import cliProgress from 'cli-progress'
import { bold, cyan, dim, green } from 'kleur/colors'

export interface ProgressBar {
  increment: (amount: number, payload?: Record<string, unknown>) => void
  log: (message: string) => void
  suspend: () => void
  resume: () => void
  stop: () => void
}

function formatEta(seconds: number): string {
  if (seconds <= 0)
    return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0)
    return `${h}h ${m}m`
  if (m > 0)
    return `${m}m ${s}s`
  return `${s}s`
}

const BAR_FORMAT = `[${green('{bar}')}] ${bold('{percentage}%')} ${dim('({value}/{total}) · {speed} files/s · ETA {etaStr}')}  ${cyan('{filename}')}`

export function createProgressBar(total: number, label: string): ProgressBar {
  process.stdout.write(`${label}\n`)

  const startTime = Date.now()
  let currentValue = 0
  let lastFilename = ''
  let stopped = false
  let suspended = false
  let multi: cliProgress.MultiBar | undefined
  let bar: cliProgress.SingleBar | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  function livePayload() {
    const elapsed = (Date.now() - startTime) / 1000
    const speed = elapsed > 0 ? Math.round(currentValue / elapsed) : 0
    const etaStr = speed > 0 ? formatEta(Math.round((total - currentValue) / speed)) : '...'
    return { speed, etaStr }
  }

  function start() {
    multi = new cliProgress.MultiBar(
      {
        format: BAR_FORMAT,
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic,
    )

    bar = multi.create(total, currentValue, { ...livePayload(), filename: lastFilename })
    timer = setInterval(() => {
      bar?.update(currentValue, { ...livePayload(), filename: lastFilename })
    }, 250)
  }

  function stopActiveBar() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    multi?.stop()
    multi = undefined
    bar = undefined
  }

  start()

  return {
    increment(amount, payload) {
      currentValue += amount
      if (payload?.filename)
        lastFilename = payload.filename as string
      if (!suspended && !stopped)
        bar?.increment(amount, { ...livePayload(), ...payload })
    },
    log(message) {
      if (suspended || stopped) {
        process.stdout.write(`${message}\n`)
        return
      }
      multi?.log(message)
    },
    suspend() {
      if (stopped || suspended)
        return
      suspended = true
      stopActiveBar()
    },
    resume() {
      if (stopped || !suspended)
        return
      suspended = false
      start()
    },
    stop() {
      if (stopped)
        return
      stopped = true
      stopActiveBar()
    },
  }
}
