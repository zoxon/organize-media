import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyboardListener } from '../src/helpers/keyboard'

function makeFakeStdin(isTTY = true) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isTTY,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  }) as unknown as NodeJS.ReadStream
}

function makeFakeStdout(isTTY = true) {
  return {
    isTTY,
    write: vi.fn(),
  } as unknown as NodeJS.WriteStream
}

function pressKey(stdin: NodeJS.ReadStream, name: string, ctrl = false) {
  stdin.emit('keypress', name, { name, ctrl })
}

describe('createKeyboardListener', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns no-op listener when not interactive', () => {
    const stdin = makeFakeStdin(false)
    const stdout = makeFakeStdout(false)
    const kb = createKeyboardListener(stdin, stdout)
    expect(kb.paused).toBe(false)
    expect(kb.stopping).toBe(false)
    kb.dispose()
    expect(stdin.setRawMode).not.toHaveBeenCalled()
  })

  it('starts unpaused and not stopping', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)
    expect(kb.paused).toBe(false)
    expect(kb.stopping).toBe(false)
    kb.dispose()
  })

  it('pauses with P and resumes with R', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'p')
    expect(kb.paused).toBe(true)

    pressKey(stdin, 'r')
    expect(kb.paused).toBe(false)
    kb.dispose()
  })

  it('keeps paused when P is pressed repeatedly', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'p')
    expect(kb.paused).toBe(true)

    pressKey(stdin, 'p')
    expect(kb.paused).toBe(true)
    kb.dispose()
  })

  it('resolves waitForResume when R is pressed', async () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'p')
    expect(kb.paused).toBe(true)

    const resumePromise = kb.waitForResume()
    pressKey(stdin, 'r')

    await expect(resumePromise).resolves.toBeUndefined()
    kb.dispose()
  })

  it('does not write pause footer directly to stdout', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'p')

    expect(stdout.write).not.toHaveBeenCalled()
    kb.dispose()
  })

  it('calls setRawMode(true) on TTY stdin', () => {
    const stdin = makeFakeStdin(true)
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)
    expect(stdin.setRawMode).toHaveBeenCalledWith(true)
    expect(stdin.resume).toHaveBeenCalled()
    kb.dispose()
  })

  it('calls setRawMode(false), removes keypress listener, and pauses stdin on dispose', () => {
    const stdin = makeFakeStdin(true)
    const stdout = makeFakeStdout()
    const kb = createKeyboardListener(stdin, stdout)
    kb.dispose()
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(stdin.listenerCount('keypress')).toBe(0)
    expect(stdin.pause).toHaveBeenCalled()
  })

  it('sets stopping=true on first Ctrl+C and does not exit', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'c', true)

    expect(kb.stopping).toBe(true)
    expect(kb.paused).toBe(false)
    expect(exitSpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    kb.dispose()
  })

  it('calls process.exit(0) on second Ctrl+C', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'c', true)
    pressKey(stdin, 'c', true)

    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
    kb.dispose()
  })

  it('calls process.exit(0) on q key', () => {
    const stdin = makeFakeStdin()
    const stdout = makeFakeStdout()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never)
    const kb = createKeyboardListener(stdin, stdout)

    pressKey(stdin, 'q')

    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
    kb.dispose()
  })
})
