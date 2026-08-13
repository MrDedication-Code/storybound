# Storybound Decisions

## Architecture

- **Electron, electron-vite, React, and TypeScript:** a mature desktop stack with a fast development loop and cross-platform packaging.
- **SQLite through `better-sqlite3`:** synchronous database access remains isolated in the main process, where transactions and snapshots are simple and reliable.
- **Validated preload bridge:** the renderer is sandboxed and context-isolated. Every request crosses a named typed API and is validated by Zod in the main process.
- **Versioned migrations:** migrations are authoritative for both normal startup and historical restore. New optional fields receive safe defaults when older packages are imported.
- **FTS5 search:** lexical full-text search runs locally without loading the library into renderer memory.
- **Application-managed media:** selected covers are copied into the data directory and served through a restricted custom protocol.
- **Safe Markdown:** `react-markdown` renders a restrained subset without raw HTML. Links in story content remain visible but inert.
- **Small hash router with lazy page chunks:** packaged `file://` navigation stays predictable while infrequently used screens do not inflate the initial renderer bundle.
- **Atomic and transactional storage:** multi-record edits use transactions; file exports use temporary files and atomic replacement.
- **Acknowledged application close:** Electron waits for the renderer to flush the newest editor revision and reading position, with an explicit user choice only if saving remains stuck.
- **Separate native mobile client:** Expo/React Native provides iOS and Android UI while sharing versioned contracts and cryptography with Electron. Each client owns a local SQLite database and remains usable offline.
- **Optional encrypted Supabase transport:** Supabase Auth, Postgres RPCs, and RLS provide account/device ownership and a durable revision log. AES-256-GCM payloads are encrypted before transport; recovery and vault keys stay in OS-protected device storage.

## Data portability

- **Separate human and round-trip exports:** Markdown, EPUB, PDF, and companion HTML are reading/publishing copies; `.storybound-book` preserves editable Storybound data.
- **Versioned ZIP contracts:** portable books and full-library backups contain validated manifests and managed media.
- **Self-restorable size contract:** successful portable exports remain below a 500 MB uncompressed payload ceiling. Completed archives are reopened and validated before replacing a chosen destination.
- **Strict full restore:** staged backups must match the schema created by migrations before the live library is swapped. The replaced library receives a local safety copy.
- **Scheduled local backups:** plans run while Storybound is open, create dated verified snapshots, and apply user-selected retention without touching files outside the selected plan output.
- **Encrypted transfer vault:** a full backup can be wrapped in a versioned AES-256-GCM authenticated envelope with a per-file salt and IV and an scrypt-derived key. Passphrases are never persisted and cannot be recovered.
- **Offline companion:** a self-contained HTML reader embeds book data and cover media, stores reading preferences locally in the browser, and uses a CSP that denies network connections.

## Product and design

- **Local-first, not local-only:** every core workflow works offline. The one optional network feature is clearly isolated and explicitly approved per request.
- **No bundled sample:** the empty-library experience immediately offers creation/import and Getting started guidance.
- **Quiet literary visual system:** dark walnut chrome, parchment surfaces, brass accents, restrained motion, and deterministic generated covers.
- **Large editor by default:** editing is the primary task, so the text workspace consumes the available height in edit mode and remains adjustable in split mode.
- **Recover before destroy:** books and chapters go to separate Trash flows; chapter revisions and recovery drafts cover common editing mistakes.
- **Writing and reading are independent:** manuscript status does not imply reading completion or restrict later edits.
- **Approximate resilient anchors:** reader positions, bookmarks, and annotations retain both structural location and textual fallback information so they can recover sensibly after edits.
- **Deterministic local covers:** generated palettes avoid external assets and remain stable by book; custom cover focal points are stored independently.

## Optional AI boundary

- The AI writing assistant is an explicit one-shot utility, not an autonomous writing system.
- The user sees the disclosure, supplies their own API key, confirms consent, and starts each request.
- Only the current chapter plus limited title/blurb context and the selected instruction are submitted.
- Requests use the Responses API with `store: false` and a bounded input. Returned text remains an editable suggestion and is never saved automatically.
- The API key remains in renderer memory only while the modal is mounted. It is not written to SQLite, settings, logs, backups, or exports.
- No other runtime feature contacts an AI provider.

## Security and privacy

- No analytics, advertising, mandatory account, hidden backup, or remote font. Encrypted sync is opt-in and can be omitted entirely from an unconfigured build.
- Navigation outside the app is denied by default; application-owned external links require an explicit safe path.
- User-facing failures avoid cryptographic and storage internals; technical diagnostics stay local.
- The live SQLite database and ordinary portable archives remain plaintext. Operating-system disk encryption or the encrypted vault export is required for at-rest confidentiality outside the app.
