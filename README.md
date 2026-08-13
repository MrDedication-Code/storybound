# Storybound

Storybound is a calm, local-first desktop library for collecting, organising, writing, and reading AI-generated fiction. It works without an account or internet connection. An optional writing assistant can contact OpenAI only for a single request the user explicitly approves.

## Highlights

- Create multiple libraries and organise books with status, series order, tags, collections, saved filters, and batch actions.
- Paste plain text, Markdown, or chat transcripts while preserving matching rich-text paragraph and dialogue boundaries, with a reviewable chapter-import flow for larger sources.
- Write in a large, resizable Markdown workspace with edit, split, preview, and focus modes.
- Autosave changes, retain recovery drafts, keep chapter revisions, and support chapter trash, duplicate, reorder, split, merge, and heading detection.
- Search titles, blurbs, chapters, tags, collections, and Story Bible entries with local FTS5 search.
- Track characters, locations, lore, timeline events, chapter links, and relationships in a Story Bible.
- Set daily, weekly, or monthly writing goals and review local writing statistics.
- Read with themes, typography and column controls, progress restoration, bookmarks, highlights, notes, and operating-system text-to-speech.
- Use generated local cover palettes or a custom image with adjustable focal positioning.
- Export Markdown, EPUB 3, print-ready PDF, a self-contained offline companion reader, or a portable Storybound package.
- Protect the full library with verified manual or scheduled backups and optional passphrase-encrypted transfer vaults.

See [INSTALLATION.md](INSTALLATION.md) for installation guidance and [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) before moving or restoring a library.

## Requirements

- Node.js 22.12 or newer
- npm, included with Node.js
- macOS, Windows, or a mainstream 64-bit Linux distribution
- Native build tools may be needed if a prebuilt `better-sqlite3` binary is unavailable for the current platform.

No server, hosted database, account, API key, or Vercel project is required. The optional AI writing assistant requires the user's own OpenAI API key only while its dialog is open.

## Install dependencies

From the repository root:

```bash
npm ci
```

Use `npm install` only when intentionally updating `package-lock.json`.

## Development

Start Electron with renderer hot reload:

```bash
npm run dev
```

Build and launch the production-mode app:

```bash
npm run build
npm start
```

Normal development data is stored in Electron's user-data directory. Automated Electron tests override it with an isolated temporary profile.

## Tests and checks

```bash
npm test
npm run test:e2e
npm run check
```

- `npm test` runs the Vitest unit and component suite.
- `npm run test:e2e` builds the app and runs the real-Electron acceptance suite.
- `npm run check` checks formatting, lint, Node/Web types, Vitest, and a production build.

Individual checks are available as `npm run format:check`, `npm run lint`, and `npm run typecheck`.

## Production builds and installers

```bash
npm run build
npm run package:dir
npm run package
```

Target-specific commands are `npm run package:mac`, `npm run package:win`, and `npm run package:linux`. Electron Builder writes artifacts to `dist/`. Build and smoke-test on each target OS because the app contains a native SQLite module.

Local artifacts are unsigned and unnotarised. Public distribution should add platform signing and, on macOS, notarisation. If `build/icon.svg` changes, regenerate checked-in platform icons with `npm run icons`.

## Architecture and trust boundaries

1. The React renderer owns the interface but has no Node.js or unrestricted filesystem access.
2. A sandboxed, context-isolated preload exposes a narrow typed API.
3. Electron's main process validates IPC input with Zod and coordinates SQLite, dialogs, managed media, exports, and network boundaries.
4. SQLite migrations store libraries, books, chapters, revisions, organisation data, Story Bible records, reading data, annotations, goals, settings, and recovery drafts. FTS5 performs local full-text search.
5. Managed cover images are copied into Storybound's data directory; the database never depends permanently on the original file path.
6. Versioned book packages and full backups are staged and validated before import or replacement. Full restore keeps a safety copy of the previous live library.
7. Optional OpenAI assistance is one-shot, explicitly consented, uses `store: false`, and keeps the API key only in renderer memory for the open dialog.
8. Story Markdown renders without raw HTML. Story links remain inert, and the offline companion has a restrictive content-security policy with no network access.

Multi-step storage changes use transactions. Books and chapters use recoverable Trash flows before permanent deletion.

## Local data

The authoritative location is **Settings → Data → Open data folder**. Typical packaged-app paths are:

- macOS: `~/Library/Application Support/Storybound`
- Windows: `%APPDATA%\Storybound`
- Linux: `~/.config/Storybound`

Do not edit or live-sync SQLite files while Storybound is running. Use scheduled/manual backups or an encrypted vault to move data.

## Keyboard shortcuts

| Action                            | macOS                           | Windows/Linux                   |
| --------------------------------- | ------------------------------- | ------------------------------- |
| New book                          | `Command+N`                     | `Ctrl+N`                        |
| New chapter                       | `Command+Shift+N`               | `Ctrl+Shift+N`                  |
| Save current chapter              | `Command+S`                     | `Ctrl+S`                        |
| Find in the current editor        | `Command+F`                     | `Ctrl+F`                        |
| Search the library                | `Command+K`                     | `Ctrl+K`                        |
| Open Settings                     | `Command+,`                     | `Ctrl+,`                        |
| Close a dialog or reader controls | `Esc`                           | `Esc`                           |
| Previous/next reader chapter      | Arrow keys or Page Up/Page Down | Arrow keys or Page Up/Page Down |

## Privacy and safety

Storybound has no analytics, advertising, mandatory account, or hidden upload. Optional encrypted sync contacts the configured Supabase project only after the user signs in and enables a vault; prose and titles are encrypted before upload. The optional AI assistant remains a separate, explicitly initiated one-shot request. Read [PRIVACY.md](PRIVACY.md) for the exact boundaries.

For valuable writing:

1. Configure a scheduled backup to a separate drive and periodically run it manually to verify the destination.
2. Keep an additional dated `.storybound-backup` or `.storybound-vault` off the computer.
3. Run **Settings → Data → Database integrity check** after an unexpected shutdown or storage error.
4. Keep pre-restore material until the restored library has been opened and checked.

## Known limitations

- Encrypted sync is single-user and offline-first; it is not real-time collaboration. A hosted Supabase project and build-time public configuration are required before release.
- Story content uses a safe Markdown subset rather than full word-processing layout.
- Search is lexical rather than semantic.
- Reading positions, bookmarks, and annotation anchors are designed to recover approximately after major text or structural edits; review them after large rewrites or assisted multi-splits.
- Text-to-speech uses the voices and capabilities provided by the operating system.
- The optional OpenAI helper requires a compatible paid API account, may incur API charges, limits submitted text, and requires the key to be entered again after the dialog closes.
- PDF output is visually verified but is not a tagged accessibility PDF. EPUB support varies by reader.
- Portable exports and encrypted vault payloads are limited to 500 MB.
- The live SQLite database and ordinary package/backup files are not encrypted. Use full-disk encryption or the encrypted vault export where appropriate.
- The Expo iOS/Android client covers the core library, reader, editor, reading position, and encrypted-sync flow; organisation and writing-statistics screens remain desktop-first.
- The first encrypted-sync release covers libraries, book metadata, chapters, and reading position. Custom cover image files, tags, collections, annotations, Story Bible records, revisions, and writing statistics remain local/export-backed until their mobile models are added.
- Generated cover options are local colour treatments, not AI-generated illustrations.
- Installers remain unsigned and unnotarised until release credentials are configured.

## Project documents

- [INSTALLATION.md](INSTALLATION.md) — installation, upgrades, migration, and uninstall
- [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) — packages, scheduled backups, encrypted vaults, and restore
- [DATA_RECOVERY.md](DATA_RECOVERY.md) — recovery-draft, Trash, revision, cover, and database guidance
- [PRIVACY.md](PRIVACY.md) — local data, optional AI disclosure, and security boundaries
- [DECISIONS.md](DECISIONS.md) — architecture and product decisions
- [PROGRESS.md](PROGRESS.md) — implementation status and verification
- [FUTURE_IDEAS.md](FUTURE_IDEAS.md) — genuinely deferred ideas
- [SYNC_SETUP.md](SYNC_SETUP.md) — local Supabase, hosted deployment, mobile, and recovery-code setup

## Licence

No licence has been declared. Treat the source as all rights reserved until the project owner adds one.
