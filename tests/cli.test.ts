import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const runOrganizeMedia = vi.fn(() => Promise.resolve())

vi.mock('../src/index', () => ({
  runOrganizeMedia,
}))

describe('cli', () => {
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.resetModules()
    runOrganizeMedia.mockClear()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    vi.restoreAllMocks()
  })

  it('shows help and exits when no args are provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.argv = ['node', 'cli']
    process.exit = ((code?: number) => {
      throw new Error(`exit ${code}`)
    }) as typeof process.exit

    await expect(import('../src/cli')).rejects.toThrow('exit 0')
    expect(logSpy).toHaveBeenCalled()
  })

  it('fails when arguments are missing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'cli', 'only-one']
    process.exit = ((code?: number) => {
      throw new Error(`exit ${code}`)
    }) as typeof process.exit

    await expect(import('../src/cli')).rejects.toThrow('exit 1')
    expect(errSpy).toHaveBeenCalled()
  })

  it('invokes runOrganizeMedia with parsed args', async () => {
    process.argv = ['node', 'cli', 'C:\\src', 'D:\\dest', '--recover-date']

    await import('../src/cli')

    expect(runOrganizeMedia).toHaveBeenCalledWith({
      sourceDir: 'C:\\src',
      targetDir: 'D:\\dest',
      recoverDate: true,
    })
  })
})
