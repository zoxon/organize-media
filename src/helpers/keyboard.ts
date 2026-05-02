import { EventEmitter } from 'node:events'
import process from 'node:process'
import readline from 'node:readline'

export interface KeyboardListener {
  readonly paused: boolean
  readonly stopping: boolean
  waitForResume: () => Promise<void>
  dispose: () => void
}

interface Key {
  name?: string
  ctrl?: boolean
}

export function createKeyboardListener(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): KeyboardListener {
  const emitter = new EventEmitter()

  let paused = false
  let stopping = false
  let disposed = false
  let rawModeEnabled = false
  let sigintCount = 0

  const isInteractive = stdin.isTTY && stdout.isTTY

  if (!isInteractive) {
    return {
      get paused() { return false },
      get stopping() { return false },
      waitForResume: () => Promise.resolve(),
      dispose: () => {},
    }
  }

  readline.emitKeypressEvents(stdin)

  if (typeof stdin.setRawMode === 'function') {
    try {
      stdin.setRawMode(true)
      rawModeEnabled = true
    }
    catch {
      rawModeEnabled = false
    }
  }

  stdin.resume()
  stdin.on('keypress', onKeypress)

  if (!rawModeEnabled) {
    process.on('SIGINT', onSigInt)
  }

  function onSigInt() {
    sigintCount++

    if (sigintCount >= 2) {
      cleanup()
      process.exit(0)
    }

    stopping = true
    paused = false
    emitter.emit('resume')
  }

  function onKeypress(_str: string | undefined, key: Key) {
    if (disposed)
      return

    if (rawModeEnabled && key.ctrl && key.name === 'c') {
      onSigInt()
      return
    }

    switch (key.name) {
      case 'p':
        paused = true
        break
      case 'r':
        if (paused) {
          paused = false
          emitter.emit('resume')
        }
        break
      case 'q':
        cleanup()
        process.exit(0)
    }
  }

  function waitForResume(): Promise<void> {
    if (!paused || disposed)
      return Promise.resolve()
    return new Promise(resolve => emitter.once('resume', resolve))
  }

  function cleanup() {
    if (disposed)
      return
    disposed = true
    stdin.removeListener('keypress', onKeypress)
    process.removeListener('SIGINT', onSigInt)
    if (rawModeEnabled) {
      try {
        stdin.setRawMode(false)
      }
      catch { /* ignore */ }
    }
    stdin.pause()
    stdout.write('\n')
  }

  return {
    get paused() { return paused },
    get stopping() { return stopping },
    waitForResume,
    dispose: cleanup,
  }
}
