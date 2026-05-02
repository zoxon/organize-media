# AGENTS.md

Project guidance for coding agents working in this repository. Keep this file self-contained; do not rely on `@` imports.

## Shell

- Use `rtk` for shell commands by default. It compresses command output and saves context, which matters in long coding sessions.
- Write commands as `rtk <command>`, for example `rtk git status`, `rtk pnpm test`, or `rtk pnpm exec vitest run tests/exif.test.ts`.
- Use the underlying command directly only if `rtk` is unavailable or breaks the current tool runner.
- Prefer `rg` for searching files and text.

## Commands

```bash
pnpm run build                  # Compile TypeScript to dist/
pnpm dev                        # Run CLI via ts-node
pnpm test                       # Run all tests once
pnpm run test:watch             # Run tests in watch mode
pnpm lint                       # Run ESLint
pnpm find-media-without-date    # Scan source and report files missing date metadata
pnpm exec vitest run tests/exif.test.ts
```

Run the built CLI:

```bash
node dist/cli.js <sourceDir> <targetDir> [--recover-date]
```

## Project Overview

This is a Node.js/TypeScript CLI that organizes photo and video files by metadata. It scans a source directory, reads EXIF metadata with the external `exiftool` binary, resolves a capture date, groups Live Photos, hashes files, and copies media into:

```text
targetDir/YYYY/MM/DD/YYYY.MM.DD_HH.MM.SS-HASH[-approx].ext
```

Files without a resolved date go to `targetDir/no-photo-taken-date`, and a `no-date-report.txt` file is written when needed.

## Architecture

- `src/cli.ts` parses positional args and flags with Node `parseArgs()`, then calls `runOrganizeMedia()`.
- `src/index.ts` orchestrates scanning, cache loading, metadata reading, date resolution, Live Photo grouping, hashing, copying, pause/resume, and reports.
- `src/helpers/exif.ts` owns EXIF date resolution and batched metadata reads. Metadata reading uses persistent `exiftool -stay_open` daemons, chunks of 100 files, and a small daemon pool.
- `src/helpers/exif-cache.ts` stores `.organize-media-cache.json` in the target directory. A complete clean cache skips metadata reads; a partial cache can resume interrupted metadata reads.
- `src/helpers/keyboard.ts` handles interactive controls: `P` pauses, `R` resumes, `Q` quits, first `Ctrl+C` requests graceful stop and cache save, second `Ctrl+C` exits.
- `src/helpers/progress.ts` wraps `cli-progress`. It supports `log()`, `suspend()`, and `resume()` so pause/stop messages are not overwritten by progress redraws.

## Metadata And Dates

- High-confidence dates include `DateTimeOriginal`, `SubSecDateTimeOriginal`, `CreateDate`, `SubSecCreateDate`, `MediaCreateDate`, and `DateTimeCreated`.
- Medium-confidence dates include `TrackCreateDate`, `CreationDate`, `MetadataDate`, `ModifyDate`, `MediaModifyDate`, and `TrackModifyDate`.
- Medium-confidence dates are only used when `--recover-date` / `-r` is passed; generated filenames then include `-approx`.

## Live Photos

- Primary pairing uses Apple `ContentIdentifier`.
- Fallback pairing uses matching filename stems for photo/video pairs when `ContentIdentifier` is missing.
- A paired video inherits the selected photo date.
- Live Photo pairs share a stable hash derived from `ContentIdentifier` when available.

## Testing

- Tests live in `tests/` and use Vitest.
- Helper modules generally have matching test files.
- `tests/index.test.ts` covers orchestration with mocks for filesystem, EXIF, progress, cache, keyboard, and hashing.
- `tests/exif.test.ts` mocks the `exiftool -stay_open` daemon protocol; do not require real `exiftool` for unit tests.
- When changing pause/resume, cover both visual progress behavior and control-flow behavior. Important cases: pause before a batch, pause during a batch, resume before the batch finishes, graceful `Ctrl+C`, and cache write on stop.

## Coding Notes

- Keep changes aligned with the existing helper boundaries instead of adding new frameworks or global state.
- Preserve Windows path behavior. Existing code normalizes backslashes when cache keys need stable comparison.
- Do not commit generated `dist/`, local `.claude/` settings, or personal files unless explicitly requested.
- `exiftool` is an external runtime dependency and must be installed separately by users.
