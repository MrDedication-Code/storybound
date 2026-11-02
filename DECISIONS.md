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
- **The vault holds every library:** sync covers all libraries, not just the one active when sync was enabled. Each book payload names its `library_id`, and receivers file it there. The sync profile's library remains only a bookkeeping key for outbox and entity-state rows. Payloads from older versions without `library_id` fall back to that library. A book that arrives before its library is held in a placeholder library, which the library's own record overwrites. Storybound cannot move books between libraries yet; when it can, the move must bump the book's `row_version` so it syncs. The phone shows a library tab only for libraries that hold books.
- **Covers sync as their own records:** each custom cover is a `media-asset` record (`book-cover:<bookId>`) with its own `cover_version`, so editing a book's details does not re-send its image, and changing the cover does not re-send the book. The Mac re-encodes the cover as a JPEG of at most 900×1350 before encrypting it, which keeps payloads small for the phone. Receivers ignore record types they do not understand rather than failing, so an older device keeps syncing everything else.
- **A highlight syncs with its anchor:** the desktop stores a highlight or note and its place in the chapter (the anchor) as two rows, but they sync as one `annotation` record whose version is the sum of both rows' versions, so moving an anchor during a chapter split or merge also syncs. A receiving desktop stores the anchor at version 1 and the annotation at the rest, keeping the sum. The phone keeps a single row. Both apps find a highlight in edited text with the same shared `locateAnchor`. The phone has no text selection that reports offsets, so a highlight starts from a long-pressed paragraph and is narrowed by tapping sentences; its quote is saved without Markdown markers because the desktop finds highlights in the rendered page. A highlight whose chapter has not arrived is skipped instead of failing the download.
- **Device linking by approval:** a new device can join without the recovery code. Each side publishes a one-time x25519 public key, both screens show six words (48 bits) derived from the vault, the request and both keys, and the user confirms on both devices before the approver seals the vault key for the newcomer. Any key substituted in transit, including by the server, changes the words. The ephemeral approver key lives only in memory, so a request acknowledged before a restart must be started again. `tests/main/supabaseDeviceLink.test.ts` runs the RPCs on in-memory Postgres (PGlite), so they are tested without Docker.
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

## AI assistant connections

- **Claude through MCP, served by the app itself:** a local MCP server in the main process writes through the same validated, transactional store methods as the UI. It never touches the SQLite file from outside the running app, which would risk corruption.
- **Stateless, dependency-free protocol layer:** the server implements MCP's JSON-RPC over Streamable HTTP in JSON-response mode (`initialize`, `ping`, `tools/list`, `tools/call`). This keeps the trust boundary small and auditable without pulling in an SDK.
- **Loopback, token, Origin and Host checks:** binding to `127.0.0.1` keeps other machines out. The bearer token keeps other local programs out. Refusing any `Origin` and any non-loopback `Host` stops web pages and DNS rebinding.
- **Stdio bridge run by Storybound's executable:** Claude Desktop and Claude Code launch `resources/mcp-bridge.cjs` with `ELECTRON_RUN_AS_NODE`, so users need no separate Node install and no token in their Claude config. The bridge reads the live port and token from `agent-bridge.json` per message. It answers the handshake from a cached tool list and opens Storybound only when a tool is called.
- **Bridge settings outside the database:** the token never enters backups, packages, vaults, or sync.
- **Non-destructive tool set:** list, read, create, append, and revise only. Revision keeps the previous text in revision history. `add_chapter` ignores an exact retry, and `create_book` refuses duplicate titles unless asked, so a model retrying a call cannot clutter the library.
- **Annotations re-located on read, never dropped:** `get_annotations` finds each highlight in the current text. It tries the stored offsets first, then exact and Markdown-insensitive searches for the quote, using the saved surroundings to choose between repeats. A highlight whose words are gone is returned as `orphaned` with its original quote and saved context, so a note is never silently lost. Chapter edits still leave anchors untouched; `update_chapter` behaves exactly as before, but its response adds a read-only, best-effort `orphanedAnnotations` list of highlights that the rewrite newly orphaned, and notes have no resolved state yet, because adding one needs a schema migration.
- **Story bible through the same entries the app shows:** the bible is a list of entries in five fixed categories, not fixed text areas, so `get_bible`, `update_bible_section` and `create_bible_section` work on entries. An update replaces only that entry's Markdown body. Entries have no revision history, so the response returns the previous body. An optional `expectedUpdatedAt` refuses to overwrite an entry the user edited after Claude read it; the check and write run in one synchronous step in the main process, so nothing can slip in between. There is no delete tool.
- **Never overwrite unsaved typing:** an open editor reloads for an outside change only when it has no unsaved edits. Otherwise it shows a notice, and the assistant's version stays in Revisions.
- **Inbox folder for every other tool:** a polled folder with simple front matter works with any AI or text editor. Processed files move to `Imported/` or `Failed/` with an explanation, files modified in the last few seconds wait, and an identical re-drop is skipped.
- **Single-instance lock:** Claude may start Storybound while it is already open, so a second launch focuses the existing window and never opens the same database twice.

## Security and privacy

- No analytics, advertising, mandatory account, hidden backup, or remote font. Encrypted sync is opt-in and can be omitted entirely from an unconfigured build.
- Navigation outside the app is denied by default; application-owned external links require an explicit safe path.
- User-facing failures avoid cryptographic and storage internals; technical diagnostics stay local.
- The live SQLite database and ordinary portable archives remain plaintext. Operating-system disk encryption or the encrypted vault export is required for at-rest confidentiality outside the app.
