# Media Organizer

A Node.js utility for organizing photo and video files based on metadata, handling duplicates, and preserving progress state.

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
- Maintains a persistent state and log in the target directory
- Provides a CLI progress bar for scanning and copying

---

## Installation

```bash
git clone <repository_url>
cd <repository_folder>
npm install
```

Ensure `exiftool` is installed and available in your system path:

- **macOS/Linux:** `brew install exiftool` or package manager of your choice
- **Windows:** Download `exiftool.exe` and ensure it is in your PATH

---

## Usage

```bash
npm start -- <sourceDir> <targetDir>
```

- `<sourceDir>`: Directory containing your media files
- `<targetDir>`: Directory where organized files will be saved

Example:

```bash
npm start -- ~/Pictures ~/Pictures/Organized
```

---

## How It Works

1. **Scan Source:** Recursively collects all supported media files.
2. **Load State:** Loads `organize-state.json` from the target directory to track processed files and known hashes.
3. **Filter New Files:** Skips files that have already been processed.
4. **Read Metadata:** Uses `exiftool` in batches to extract:
   - `DateTimeOriginal`, `CreateDate`, `MediaCreateDate`
   - `ContentIdentifier` (for grouping Live Photos)
5. **Calculate Hashes:** Computes MD5 hashes to detect duplicates.
6. **Group Live Photos:** Uses `ContentIdentifier` or filename base to keep photo/video pairs together.
7. **Copy and Rename:** Files are copied to `targetDir/YYYY/MM/DD` with the format:
   ```
   YYYY.MM.DD_HH.MM.SS-HASH.ext
   ```
   Files without metadata dates are stored in `targetDir/no-photo-taken-date`.
8. **Update State & Log:** Saves `organize-state.json` and `organize-log.json` after each operation to ensure resumable processing.

---

## File Structure in Target Directory

```
targetDir/
├─ organize-state.json   # Tracks processed files and known hashes
├─ organize-log.json     # Detailed log of copied, skipped, and duplicate files
├─ 2026/
│  ├─ 02/
│  │  ├─ 02/
│  │  │  ├─ 2026.02.02_14.30.45-<hash>.jpg
│  │  │  ├─ ...
├─ no-photo-taken-date/
│  ├─ <hash>.mov
```

---

## Dependencies

- Node.js 18+
- `exiftool` (external binary)
- Internal helper: `ProgressBar` (console progress visualization)

---

## Error Handling

- Files that cannot be processed are logged as errors in `organize-log.json`.
- Duplicate files are skipped and logged.
- Any fatal errors terminate the script with an error message.

---

## Notes

- Live Photos (photo + video) are always grouped and handled together.
- The state file ensures the script can resume after interruptions without duplicating work.
- Supports Windows, macOS, and Linux.

---

## License

MIT
