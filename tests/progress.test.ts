import { describe, expect, it, vi } from 'vitest'
import { createProgressBar } from '../src/helpers/progress'

const progressMocks = vi.hoisted(() => {
  const start = vi.fn()
  const singleBar = vi.fn().mockImplementation(() => ({ start }))
  return { start, singleBar }
})

vi.mock('cli-progress', () => ({
  default: {
    SingleBar: progressMocks.singleBar,
    Presets: { shades_classic: 'preset' },
  },
}))

describe('helpers/progress', () => {
  it('creates and starts a progress bar', () => {
    const bar = createProgressBar(10, 'Label')

    expect(progressMocks.singleBar).toHaveBeenCalledTimes(1)
    expect(progressMocks.start).toHaveBeenCalledWith(10, 0, { filename: '' })
    expect(bar).toEqual({ start: progressMocks.start })
  })
})
