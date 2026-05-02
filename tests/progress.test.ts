import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgressBar } from '../src/helpers/progress'

const progressMocks = vi.hoisted(() => {
  const increment = vi.fn()
  const stop = vi.fn()
  const start = vi.fn()
  const update = vi.fn()
  const singleBar = vi.fn().mockImplementation(() => ({ start, increment, stop, update }))
  return { start, increment, stop, update, singleBar }
})

vi.mock('cli-progress', () => ({
  default: {
    SingleBar: progressMocks.singleBar,
    Presets: { shades_classic: 'preset' },
  },
}))

describe('helpers/progress', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates and starts a progress bar', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')

    expect(progressMocks.singleBar).toHaveBeenCalledTimes(1)
    expect(progressMocks.start).toHaveBeenCalledWith(10, 0, { filename: '', speed: 0, etaStr: '...' })
    expect(bar.increment).toBeTypeOf('function')
    expect(bar.stop).toBeTypeOf('function')

    bar.stop()
    vi.useRealTimers()
  })

  it('passes computed speed and eta payload on increment', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')
    bar.increment(5, { filename: '→ a.jpg' })

    expect(progressMocks.increment).toHaveBeenCalledWith(5, expect.objectContaining({
      filename: '→ a.jpg',
      speed: expect.any(Number),
      etaStr: expect.any(String),
    }))

    bar.stop()
    vi.useRealTimers()
  })

  it('redraws on timer tick between batches', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(100, 'Label')
    bar.increment(10, { filename: '→ last.jpg' })
    progressMocks.update.mockClear()

    vi.advanceTimersByTime(250)

    expect(progressMocks.update).toHaveBeenCalledWith(10, expect.objectContaining({
      filename: '→ last.jpg',
      speed: expect.any(Number),
      etaStr: expect.any(String),
    }))

    bar.stop()
    vi.useRealTimers()
  })
})
