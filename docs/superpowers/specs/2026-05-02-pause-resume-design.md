# Pause/Resume Design

**Date**: 2026-05-02

## Overview

Two independent features:
1. **EXIF cache** — persist raw exiftool output to `targetDir/.organize-media-cache.json` so that re-runs skip the expensive scan phase
2. **Keyboard pause** — press `P` during a run to pause after the current file finishes; press again to resume

## EXIF Cache

### File

`targetDir/.organize-media-cache.json`

```json
{
  "sourceDir": "/absolute/path/to/source",
  "fileCount": 1234,
  "exifData": [ /* ExifRow[] — raw output from runExifToolBatch */ ]
}
```

### Invalidation

Cache is valid when both conditions hold on the current run:
- `sourceDir` matches the value stored in the cache
- `fileCount` (number of media files found after `walk` + `filter`) matches

If either differs, the cache is ignored, exiftool runs normally, and the cache file is overwritten with the new results.

### Flow

```
walk(sourceDir) → mediaFiles
  ↓
loadExifCache(targetDir, sourceDir, mediaFiles.length)
  ├─ valid  → use cached exifData, skip runExifToolBatch
  └─ stale  → runExifToolBatch(mediaFiles)
                → saveExifCache(targetDir, sourceDir, mediaFiles.length, exifData)
  ↓
existing processing (resolve dates, group Live Photos, hash, copy)
```

### New file: `src/helpers/exif-cache.ts`

Exports:

- `loadExifCache(targetDir, sourceDir, fileCount): Promise<ExifRow[] | null>` — returns rows if cache is valid, null otherwise
- `saveExifCache(targetDir, sourceDir, fileCount, rows): Promise<void>`

## Keyboard Pause

### New file: `src/helpers/keyboard.ts`

Exports a factory function `createKeyboardListener()` that returns:

```ts
interface KeyboardListener {
  paused: boolean
  waitForResume(): Promise<void>  // resolves when paused flips to false
  dispose(): void                  // restores stdin to normal mode
}
```

Implementation:
- `process.stdin.setRawMode(true)` + `process.stdin.resume()`
- Listens for `data` events on stdin
- `P`/`p` → toggles `paused`
- `\x03` (Ctrl+C) → calls `process.exit(0)` so the user can still abort
- `waitForResume()` — polls every 100 ms until `paused === false`
- `dispose()` — `process.stdin.setRawMode(false)`, removes listener

### Integration in `src/index.ts`

After each file's `bar.increment(...)` call in the copy loop:

```ts
if (keyboard.paused) {
  bar.log('⏸  Paused — press P to resume')
  await keyboard.waitForResume()
  bar.log('▶  Resumed')
}
```

`keyboard.dispose()` is called alongside `bar.stop()` at the end of the run.

The keyboard listener is only active when stdin is a TTY (`process.stdin.isTTY`). In non-interactive environments (piped stdin, CI) it is skipped silently.

## Files Changed

| File | Change |
|------|--------|
| `src/helpers/exif-cache.ts` | New — cache load/save logic |
| `src/helpers/keyboard.ts` | New — keyboard listener |
| `src/index.ts` | Wire up cache loading before exiftool; add pause check in copy loop |
| `src/cli.ts` | No changes |

## Testing

- `tests/exif-cache.test.ts` — unit tests for load/save, invalidation on sourceDir mismatch, invalidation on fileCount mismatch, returns null when file absent
- `tests/keyboard.test.ts` — unit tests for toggle behaviour, `waitForResume` resolves after unpause, Ctrl+C handling
- Existing `tests/index.test.ts` — extend mocks for `exif-cache` and `keyboard` modules; verify exiftool is not called when cache is valid
