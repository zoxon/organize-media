# Media Organizer

A Node.js utility for organizing photo and video files based on metadata. It groups Live Photos by `ContentIdentifier` and copies media into a date-based folder structure.

---

## Features

- Recursively scans a source directory for supported media files:
  - Images: `.jpg`, `.jpeg`, `.png`, `.heic`, `.webp`
  - Videos: `.mov`, `.mp4`, `.avi`, `.mkv`
- Reads metadata (creation dates, content identifiers) using `exiftool`
- Supports batch processing for large directories
- Automatically groups Live Photos (photo + video)
- Detects duplicates using MD5 hashes
- Organizes files by date (Year/Month/Day)
- Writes a report for files without a captured date
- Provides a CLI progress bar for reading metadata and copying
- **EXIF cache** — skips metadata re-scan on subsequent runs (cache stored in target directory)
- **Keyboard pause** — press `P` during a run to pause after the current batch or file; press `R` to resume

---

## Installation

```bash
git clone <repository_url>
cd <repository_folder>
pnpm install
```

Ensure [exiftool](https://exiftool.org/) is installed and available in your system path:

- **macOS/Linux:** `brew install exiftool` or package manager of your choice
- **Windows:** Download `exiftool.exe` and ensure it is in your PATH

---

## Usage

```bash
pnpm dlx organize-media <sourceDir> <targetDir> [--recover-date]
```

- `<sourceDir>`: Directory containing your media files
- `<targetDir>`: Directory where organized files will be saved
- `--recover-date`: Try to recover date from medium-confidence metadata

Example:

```bash
pnpm dlx organize-media ~/Pictures ~/Pictures/Organized --recover-date
```

---

## How It Works

1. **Scan Source:** Recursively collects all supported media files.
2. **Read Metadata:** Loads EXIF data from cache (`targetDir/.organize-media-cache.json`) if available and valid (same source directory and file count). Otherwise runs `exiftool` in batches and saves results to cache. Extracts:
   - `DateTimeOriginal`, `CreateDate`, `MediaCreateDate`
   - `ContentIdentifier` (for grouping Live Photos)
3. **Resolve Dates:** Picks the best available date (optionally using medium-confidence fields with `--recover-date`).
4. **Calculate Hashes:** Computes MD5 hashes to build stable filenames and detect collisions.
5. **Group Live Photos:** Uses `ContentIdentifier` (or matching filenames when missing) to keep photo/video pairs together.
6. **Copy and Rename:** Files are copied to `targetDir/YYYY/MM/DD` with the format. Press `P` to pause after the current batch or file finishes; press `R` to resume:
   ```
   YYYY.MM.DD_HH.MM.SS-HASH[-approx].ext
   ```
   Files without metadata dates are stored in `targetDir/no-photo-taken-date`.
7. **Write Report:** Saves `no-date-report.txt` in the target directory when needed.

---

## File Structure in Target Directory

```
targetDir/
├─ 2026/
│  ├─ 02/
│  │  ├─ 02/
│  │  │  ├─ 2026.02.02_14.30.45-<hash>.jpg
│  │  │  ├─ ...
├─ no-photo-taken-date/
│  ├─ <hash>.mov
├─ no-date-report.txt              # List of files without a resolved date
└─ .organize-media-cache.json      # EXIF cache (auto-managed, safe to delete)
```

---

## Dependencies

- Node.js 18+
- `exiftool` (external binary)
- Internal helper: `ProgressBar` (console progress visualization)

---

## Error Handling

- If a target filename already exists, the source file is skipped.
- Any fatal errors terminate the script with an error message.

---

## Notes

- Live Photos (photo + video) are always grouped and handled together.
- Supports Windows, macOS, and Linux.

---

## License

MIT
