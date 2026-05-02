# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build                      # Compile TypeScript to dist/
pnpm dev                        # Run CLI via ts-node (no build step)
pnpm test                       # Run all tests once
pnpm run test:watch             # Run tests in watch mode
pnpm lint                       # Run ESLint
pnpm find-media-without-date    # Scan source and report files missing date metadata
```

Run a single test file:
```bash
pnpm exec vitest run tests/exif.test.ts
```

Run the CLI (after build):
```bash
node dist/cli.js <sourceDir> <targetDir> [--recover-date]
```

## Architecture

The tool scans a source directory, reads EXIF metadata via an external `exiftool` binary, and copies files into `targetDir/YYYY/MM/DD/YYYY.MM.DD_HH.MM.SS-HASH[-approx].ext`.

**Orchestration flow** ([src/index.ts](src/index.ts)):
1. Walk source dir → filter by media extension
2. Batch EXIF read (chunks of 100 via `exiftool`) → resolve best capture date per file
3. Group Live Photos: match photo+video pairs by `ContentIdentifier`, falling back to filename stem match
4. Hash each file (MD5); use `ContentIdentifier` as hash for Live Photo pairs so they share the same hash
5. Copy files to target; skip if target path already exists
6. Write `no-date-report.txt` listing any files without a resolvable date

**Date resolution** ([src/helpers/exif.ts](src/helpers/exif.ts)):
- Two confidence tiers: *high* (`DateTimeOriginal`, `CreateDate`, `MediaCreateDate`, etc.) and *medium* (`MetadataDate`, `ModifyDate`, etc.)
- Medium-confidence fields are only used when `--recover-date` / `-r` is passed; filenames get an `-approx` suffix in that case
- `resolveDate()` walks the tier lists in order and returns the first parseable value

**Live Photo grouping** ([src/index.ts](src/index.ts) `groupLivePhotos`):
- Primary: group by `ContentIdentifier` EXIF field (Apple standard)
- Fallback: pair `.mov`/`.mp4` video with a photo sharing the same filename stem
- A video in a pair always inherits the photo's resolved date

**CLI** ([src/cli.ts](src/cli.ts)): uses Node's built-in `parseArgs()`. Positional args are `sourceDir` and `targetDir`.

**External dependency**: `exiftool` must be installed separately (e.g. `brew install exiftool` on macOS, or the Windows installer). The tool is invoked as a subprocess by `runExifTool()` with files piped via stdin.

## Testing

Tests live in `tests/` and use **Vitest**. Each helper module has a matching test file. `index.test.ts` covers the full orchestration pipeline using `vi.mock()` to stub `fs`, `exif`, `progress`, and `hash` modules — no real files or exiftool are needed.

Key mocking pattern used throughout:
```ts
vi.mock('../src/helpers/exif')
// then in each test:
vi.mocked(runExifToolBatch).mockResolvedValue([...])
```
