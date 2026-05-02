import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgressBar } from '../src/helpers/progress'

const progressMocks = vi.hoisted(() => {
  const increment = vi.fn()
  const stop = vi.fn()
  const update = vi.fn()
  const log = vi.fn()
  const create = vi.fn().mockReturnValue({ increment, update })
  const multiBar = vi.fn().mockImplementation(() => ({ create, log, stop }))
  return { increment, stop, update, log, create, multiBar }
})

vi.mock('cli-progress', () => ({
  default: {
    MultiBar: progressMocks.multiBar,
    Presets: { shades_classic: 'preset' },
  },
}))

describe('helpers/progress', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('creates and starts a progress bar', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')

    expect(progressMocks.multiBar).toHaveBeenCalledTimes(1)
    expect(progressMocks.create).toHaveBeenCalledWith(10, 0, { filename: '', speed: 0, etaStr: '...' })
    expect(bar.increment).toBeTypeOf('function')
    expect(bar.suspend).toBeTypeOf('function')
    expect(bar.resume).toBeTypeOf('function')
    expect(bar.stop).toBeTypeOf('function')
    expect(bar.log).toBeTypeOf('function')

    bar.stop()
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
  })

  it('delegates bar.log() to MultiBar.log()', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')
    bar.log('⏸  Paused')
    expect(progressMocks.log).toHaveBeenCalledWith('⏸  Paused')
    bar.stop()
  })

  it('stops redrawing and updating the active bar while suspended', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')
    bar.increment(1, { filename: '→ a.jpg' })
    bar.suspend()
    progressMocks.update.mockClear()
    progressMocks.increment.mockClear()

    vi.advanceTimersByTime(250)
    bar.increment(1, { filename: '→ b.jpg' })

    expect(progressMocks.stop).toHaveBeenCalledTimes(1)
    expect(progressMocks.update).not.toHaveBeenCalled()
    expect(progressMocks.increment).not.toHaveBeenCalled()
    bar.stop()
  })

  it('recreates the progress bar with current state when resumed', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')
    bar.increment(1, { filename: '→ a.jpg' })
    bar.suspend()
    bar.increment(1, { filename: '→ b.jpg' })

    bar.resume()

    expect(progressMocks.multiBar).toHaveBeenCalledTimes(2)
    expect(progressMocks.create).toHaveBeenLastCalledWith(10, 2, expect.objectContaining({
      filename: '→ b.jpg',
      speed: expect.any(Number),
      etaStr: expect.any(String),
    }))
    bar.stop()
  })
})
