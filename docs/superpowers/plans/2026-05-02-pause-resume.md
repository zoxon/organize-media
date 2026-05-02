# Pause/Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an EXIF result cache (skip repeated scans on re-run) and a keyboard pause (`P`) that halts file copying after the current file finishes.

**Architecture:** Two new helper modules — `exif-cache.ts` (JSON file in targetDir) and `keyboard.ts` (raw stdin listener) — integrate into the existing `runOrganizeMedia` pipeline in `src/index.ts`. The `ProgressBar` interface gains a `log()` method used to print pause/resume messages above the progress bar. All changes are TDD: tests first, minimal implementation second.

**Tech Stack:** Node.js built-ins (`fs/promises`, `process.stdin`), TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/helpers/exif-cache.ts` | Create | Load/save `ExifRow[]` to `targetDir/.organize-media-cache.json` |
| `src/helpers/keyboard.ts` | Create | Raw-mode stdin listener; exposes `paused` flag + `waitForResume()` |
| `src/helpers/progress.ts` | Modify | Add `log(message: string): void` to `ProgressBar` interface and returned object |
| `src/index.ts` | Modify | Use cache before exiftool; import keyboard; check `keyboard.paused` after each copy |
| `tests/exif-cache.test.ts` | Create | Unit tests: save, load (valid), load (all invalidation paths) |
| `tests/keyboard.test.ts` | Create | Unit tests: toggle, `waitForResume`, TTY guard, `dispose` |
| `tests/progress.test.ts` | Modify | Add `log` to the `cli-progress` mock; add test for `bar.log()` |
| `tests/index.test.ts` | Modify | Add cache + keyboard mocks; move progress mock to `beforeEach`; add cache-hit and dispose tests |

---

### Task 1: exif-cache — save and load (happy path)

**Files:**
- Create: `src/helpers/exif-cache.ts`
- Create: `tests/exif-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/exif-cache.test.ts`:

```ts
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExifRow } from '../src/helpers/exif'
import { loadExifCache, saveExifCache } from '../src/helpers/exif-cache'

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  promises: {
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
  },
}))

const CACHE_PATH = path.join('D:\\target', '.organize-media-cache.json')

describe('saveExifCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes JSON with sourceDir, fileCount, and exifData', async () => {
    fsMocks.writeFile.mockResolvedValue(undefined)
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]

    await saveExifCache('D:\\target', 'C:\\src', 1, rows)

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      CACHE_PATH,
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 1, exifData: rows }),
      'utf8',
    )
  })
})

describe('loadExifCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rows when sourceDir and fileCount match', async () => {
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 1, exifData: rows }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm exec vitest run tests/exif-cache.test.ts
```

Expected: FAIL — "Cannot find module '../src/helpers/exif-cache'"

- [ ] **Step 3: Implement `src/helpers/exif-cache.ts`**

```ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExifRow } from './exif'

interface CacheFile {
  sourceDir: string
  fileCount: number
  exifData: ExifRow[]
}

const CACHE_FILENAME = '.organize-media-cache.json'

function cachePath(targetDir: string): string {
  return path.join(targetDir, CACHE_FILENAME)
}

export async function saveExifCache(
  targetDir: string,
  sourceDir: string,
  fileCount: number,
  rows: ExifRow[],
): Promise<void> {
  const data: CacheFile = { sourceDir, fileCount, exifData: rows }
  await fs.writeFile(cachePath(targetDir), JSON.stringify(data), 'utf8')
}

export async function loadExifCache(
  targetDir: string,
  sourceDir: string,
  fileCount: number,
): Promise<ExifRow[] | null> {
  let raw: string
  try {
    raw = await fs.readFile(cachePath(targetDir), 'utf8')
  }
  catch {
    return null
  }

  let data: CacheFile
  try {
    data = JSON.parse(raw) as CacheFile
  }
  catch {
    return null
  }

  if (data.sourceDir !== sourceDir || data.fileCount !== fileCount)
    return null

  return data.exifData
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm exec vitest run tests/exif-cache.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```
git add src/helpers/exif-cache.ts tests/exif-cache.test.ts
git commit -m "feat: add EXIF cache helper (save + valid load)"
```

---

### Task 2: exif-cache — invalidation paths

**Files:**
- Modify: `tests/exif-cache.test.ts`

- [ ] **Step 1: Add invalidation tests inside the `loadExifCache` describe block**

Add these four `it` blocks after the existing "returns rows..." test:

```ts
  it('returns null when cache file does not exist', async () => {
    fsMocks.readFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when sourceDir does not match', async () => {
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\other', fileCount: 1, exifData: rows }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when fileCount does not match', async () => {
    const rows: ExifRow[] = [{ SourceFile: 'C:\\src\\a.jpg' }]
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({ sourceDir: 'C:\\src', fileCount: 99, exifData: rows }),
    )

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })

  it('returns null when cache JSON is malformed', async () => {
    fsMocks.readFile.mockResolvedValue('not-json{')

    const result = await loadExifCache('D:\\target', 'C:\\src', 1)

    expect(result).toBeNull()
  })
```

- [ ] **Step 2: Run tests — all should pass (implementation already handles these)**

```
pnpm exec vitest run tests/exif-cache.test.ts
```

Expected: PASS (6 tests) — the `try/catch` and guard clause in `loadExifCache` cover every case.

- [ ] **Step 3: Commit**

```
git add tests/exif-cache.test.ts
git commit -m "test: add exif-cache invalidation tests"
```

---

### Task 3: keyboard listener

**Files:**
- Create: `src/helpers/keyboard.ts`
- Create: `tests/keyboard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/keyboard.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyboardListener } from '../src/helpers/keyboard'

function makeFakeStdin(isTTY = true) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isTTY,
    setRawMode: vi.fn(),
    resume: vi.fn(),
  }) as unknown as NodeJS.ReadStream
}

describe('createKeyboardListener', () => {
  afterEach(() => vi.clearAllMocks())

  it('starts unpaused', () => {
    const stdin = makeFakeStdin()
    const kb = createKeyboardListener(stdin)
    expect(kb.paused).toBe(false)
    kb.dispose()
  })

  it('toggles paused when P is pressed', () => {
    const stdin = makeFakeStdin()
    const kb = createKeyboardListener(stdin)

    stdin.emit('data', Buffer.from('p'))
    expect(kb.paused).toBe(true)

    stdin.emit('data', Buffer.from('p'))
    expect(kb.paused).toBe(false)
    kb.dispose()
  })

  it('resolves waitForResume when unpaused', async () => {
    const stdin = makeFakeStdin()
    const kb = createKeyboardListener(stdin)

    stdin.emit('data', Buffer.from('p'))
    expect(kb.paused).toBe(true)

    const resumePromise = kb.waitForResume()
    stdin.emit('data', Buffer.from('p'))

    await expect(resumePromise).resolves.toBeUndefined()
    kb.dispose()
  })

  it('calls setRawMode(true) on TTY stdin', () => {
    const stdin = makeFakeStdin(true)
    const kb = createKeyboardListener(stdin)
    expect(stdin.setRawMode).toHaveBeenCalledWith(true)
    kb.dispose()
  })

  it('does not call setRawMode on non-TTY stdin', () => {
    const stdin = makeFakeStdin(false)
    const kb = createKeyboardListener(stdin)
    expect(stdin.setRawMode).not.toHaveBeenCalled()
    kb.dispose()
  })

  it('calls setRawMode(false) and removes data listener on dispose', () => {
    const stdin = makeFakeStdin(true)
    const kb = createKeyboardListener(stdin)
    kb.dispose()
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(stdin.listenerCount('data')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm exec vitest run tests/keyboard.test.ts
```

Expected: FAIL — "Cannot find module '../src/helpers/keyboard'"

- [ ] **Step 3: Implement `src/helpers/keyboard.ts`**

```ts
export interface KeyboardListener {
  readonly paused: boolean
  waitForResume(): Promise<void>
  dispose(): void
}

export function createKeyboardListener(
  stdin: NodeJS.ReadStream = process.stdin,
): KeyboardListener {
  const obj = { paused: false, waitForResume, dispose }
  let disposed = false

  if (stdin.isTTY) {
    stdin.setRawMode(true)
    stdin.resume()
  }

  stdin.on('data', onData)

  function onData(chunk: Buffer): void {
    const key = chunk.toString()
    if (key === '\x03')
      process.exit(0)
    if (key === 'p' || key === 'P')
      obj.paused = !obj.paused
  }

  function waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!obj.paused || disposed) {
          clearInterval(check)
          resolve()
        }
      }, 100)
    })
  }

  function dispose(): void {
    disposed = true
    stdin.removeListener('data', onData)
    if (stdin.isTTY)
      stdin.setRawMode(false)
  }

  return obj
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm exec vitest run tests/keyboard.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```
git add src/helpers/keyboard.ts tests/keyboard.test.ts
git commit -m "feat: add keyboard listener helper"
```

---

### Task 4: Add `log()` to ProgressBar

**Files:**
- Modify: `src/helpers/progress.ts`
- Modify: `tests/progress.test.ts`

- [ ] **Step 1: Add `log` to the `cli-progress` mock and write a failing test**

In `tests/progress.test.ts`, update the `singleBar` mock to include `log`:

```ts
const progressMocks = vi.hoisted(() => {
  const increment = vi.fn()
  const stop = vi.fn()
  const start = vi.fn()
  const update = vi.fn()
  const log = vi.fn()
  const singleBar = vi.fn().mockImplementation(() => ({ start, increment, stop, update, log }))
  return { start, increment, stop, update, log, singleBar }
})
```

Then add a new test at the end of the `describe` block:

```ts
  it('delegates bar.log() to the underlying SingleBar', () => {
    vi.useFakeTimers()
    const bar = createProgressBar(10, 'Label')
    bar.log('⏸  Paused')
    expect(progressMocks.log).toHaveBeenCalledWith('⏸  Paused')
    bar.stop()
    vi.useRealTimers()
  })
```

- [ ] **Step 2: Run progress tests to verify new test fails**

```
pnpm exec vitest run tests/progress.test.ts
```

Expected: FAIL — "bar.log is not a function" (the interface and implementation don't have it yet)

- [ ] **Step 3: Update `src/helpers/progress.ts`**

Add `log` to the `ProgressBar` interface:

```ts
export interface ProgressBar {
  increment(amount: number, payload?: Record<string, unknown>): void
  log(message: string): void
  stop(): void
}
```

Add `log` to the returned object (between `increment` and `stop`):

```ts
    log(message) {
      bar.log(message)
    },
```

- [ ] **Step 4: Run progress tests to verify they all pass**

```
pnpm exec vitest run tests/progress.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```
git add src/helpers/progress.ts tests/progress.test.ts
git commit -m "feat: add log() to ProgressBar interface"
```

---

### Task 5: Wire EXIF cache into `src/index.ts`

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update `tests/index.test.ts` — add mocks and restructure `beforeEach`**

After the existing `hashMocks` block (before the `describe` block), add:

```ts
const cacheMocks = vi.hoisted(() => ({
  loadExifCache: vi.fn(),
  saveExifCache: vi.fn(),
}))

vi.mock('../src/helpers/exif-cache', () => ({
  loadExifCache: cacheMocks.loadExifCache,
  saveExifCache: cacheMocks.saveExifCache,
}))

const keyboardMocks = vi.hoisted(() => ({
  createKeyboardListener: vi.fn(),
}))

vi.mock('../src/helpers/keyboard', () => ({
  createKeyboardListener: keyboardMocks.createKeyboardListener,
}))
```

Replace the `beforeEach` block with:

```ts
  beforeEach(() => {
    vi.clearAllMocks()
    progressMocks.createProgressBar.mockReturnValue({ increment: vi.fn(), stop: vi.fn(), log: vi.fn() })
    cacheMocks.loadExifCache.mockResolvedValue(null)
    cacheMocks.saveExifCache.mockResolvedValue(undefined)
    keyboardMocks.createKeyboardListener.mockReturnValue({
      paused: false,
      waitForResume: vi.fn(),
      dispose: vi.fn(),
    })
  })
```

Remove the following line from each of the five existing `it` blocks (they're now handled by `beforeEach`):

```ts
progressMocks.createProgressBar.mockReturnValue({ increment: vi.fn(), stop: vi.fn() })
```

- [ ] **Step 2: Add the cache-hit test at the end of the `describe` block**

```ts
  it('uses cached EXIF data and skips runExifToolBatch', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const date = new Date(2024, 0, 2, 3, 4, 5)
    const cachedRows = [{ SourceFile: 'C:\\src\\a.jpg' }]

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg', 'C:\\src\\note.txt'])
    cacheMocks.loadExifCache.mockResolvedValue(cachedRows)
    exifMocks.resolveDate.mockReturnValue({ date, approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(exifMocks.runExifToolBatch).not.toHaveBeenCalled()
    expect(cacheMocks.saveExifCache).not.toHaveBeenCalled()
    expect(cacheMocks.loadExifCache).toHaveBeenCalledWith(targetDir, sourceDir, 1)
  })
```

- [ ] **Step 3: Run tests to verify the new test fails, existing tests still pass**

```
pnpm exec vitest run tests/index.test.ts
```

Expected: existing 5 tests PASS, new test FAIL ("runExifToolBatch was called unexpectedly")

- [ ] **Step 4: Update `src/index.ts` to use EXIF cache**

Add this import at the top:

```ts
import { loadExifCache, saveExifCache } from './helpers/exif-cache'
```

Replace:

```ts
  const meta = await runExifToolBatch(mediaFiles)
```

With:

```ts
  let meta = await loadExifCache(targetDir, sourceDir, mediaFiles.length)
  if (!meta) {
    meta = await runExifToolBatch(mediaFiles)
    await saveExifCache(targetDir, sourceDir, mediaFiles.length, meta)
  }
```

- [ ] **Step 5: Run all tests to verify they pass**

```
pnpm exec vitest run tests/index.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire EXIF cache into runOrganizeMedia"
```

---

### Task 6: Wire keyboard pause into `src/index.ts`

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add keyboard dispose test to `tests/index.test.ts`**

Add at the end of the `describe` block:

```ts
  it('calls keyboard.dispose after copying', async () => {
    const sourceDir = 'C:\\src'
    const targetDir = 'D:\\target'
    const disposeSpy = vi.fn()

    fsMocks.walk.mockResolvedValue(['C:\\src\\a.jpg'])
    cacheMocks.loadExifCache.mockResolvedValue([{ SourceFile: 'C:\\src\\a.jpg' }])
    exifMocks.resolveDate.mockReturnValue({ date: new Date(2024, 0, 2), approx: false })
    hashMocks.md5.mockResolvedValue('hash-a')
    fsPromisesMocks.access.mockRejectedValue(new Error('missing'))
    keyboardMocks.createKeyboardListener.mockReturnValue({
      paused: false,
      waitForResume: vi.fn(),
      dispose: disposeSpy,
    })

    await runOrganizeMedia({ sourceDir, targetDir, recoverDate: false })

    expect(disposeSpy).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm exec vitest run tests/index.test.ts
```

Expected: new test FAIL — "dispose was not called"

- [ ] **Step 3: Update `src/index.ts` to import and use the keyboard listener**

Add this import at the top:

```ts
import { createKeyboardListener } from './helpers/keyboard'
```

After `const bar = createProgressBar(meta.length, '[2/2] 📦 Copying files')`, add:

```ts
  const keyboard = createKeyboardListener()
```

In the copy loop, the current `try/catch` block looks like:

```ts
    try {
      await fs.access(target)
      skipped++
      bar.increment(1, { filename: name ? `→ ${name}` : '' })
      continue
    }
    catch {
      // target doesn't exist, proceed to copy
    }

    await fs.copyFile(sourceFile, target)
    copied++
    bar.increment(1, { filename: name ? `→ ${name}` : '' })
```

Replace it with:

```ts
    try {
      await fs.access(target)
      skipped++
      bar.increment(1, { filename: name ? `→ ${name}` : '' })
      continue
    }
    catch {
      // target doesn't exist, proceed to copy
    }

    await fs.copyFile(sourceFile, target)
    copied++
    bar.increment(1, { filename: name ? `→ ${name}` : '' })

    if (keyboard.paused) {
      bar.log('⏸  Paused — press P to resume')
      await keyboard.waitForResume()
      bar.log('▶  Resumed')
    }
```

Replace `bar.stop()` with:

```ts
  bar.stop()
  keyboard.dispose()
```

- [ ] **Step 4: Run the full test suite**

```
pnpm test
```

Expected: all tests pass, no TypeScript errors

- [ ] **Step 5: Commit**

```
git add src/index.ts tests/index.test.ts
git commit -m "feat: add keyboard pause/resume to copy loop"
```
