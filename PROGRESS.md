# Storybound Progress

Last updated: 26 October 2026

## Completed roadmap

1. **Immediate usability** — fixed Settings wheel scrolling and scrollspy behavior, added Back to top, enforced a usable minimum window size, kept the editor workspace expanded in edit mode, and preserved authored paragraph/dialogue breaks from clipboard through Reader.
2. **Domain foundation** — evolved the SQLite schema through version 9 with multiple libraries, organisation metadata, revisions, Story Bible records, annotations, goals, backup plans, cover presentation settings, and durable first-run state.
3. **Import, export, and backup** — added reviewed text/chat import, portable package v2, Markdown, EPUB 3, PDF, offline companion, historical backup restore, scheduled backups, and authenticated encrypted vault transfer.
4. **Organisation and discovery** — added tags, collections, saved filters, series order, batch actions, scoped libraries, Story Bible search, and local full-text search.
5. **Writing workflow** — added resilient autosave/recovery, dirty-navigation protection, a large resizable editor, focus/split/preview modes, chapter trash and revisions, split/merge/detection, goals, and writing statistics.
6. **Reading workflow** — added responsive reader controls, local progress, richer bookmarks, anchored highlights/notes, and operating-system text-to-speech.
7. **Advanced local-first features** — added deterministic Cover Studio palettes and focal positioning, a no-network offline companion, and an explicitly approved one-shot OpenAI writing helper.
8. **Release quality** — added first-run help, accessibility and responsive refinements, lazy-loaded routes, security/privacy hardening, automated workflow coverage, packaging checks, and updated documentation.
9. **Cross-device foundation** — retained the Electron desktop client, added an Expo iOS/Android client with durable SQLite storage, and added optional Supabase Auth plus end-to-end encrypted, recovery-code protected offline sync for the core library/book/chapter/reading-state model.
10. **AI assistant connections** — added an optional, local-only MCP server so Claude Desktop and Claude Code can list, read, create, append, and revise books and chapters, a dependency-free stdio bridge run by Storybound's own executable, a watched inbox folder for other AI tools, live library refresh with unsaved-edit protection, a single-instance lock, and in-app setup and how-it-works guidance under **Settings → AI assistants**.

## Verification evidence

The final release audit covers:

- Formatting, ESLint, Node/Web TypeScript, Vitest, and a production build through `npm run check`.
- Six real-Electron end-to-end scenarios, including one-time first-run guidance, editor sizing, paragraph-preserving rich paste through storage and Reader, Settings wheel scrolling after section navigation, persistence across relaunch, reader progress restoration, cover focal positioning, PDF export, offline companion export, portable package round-trip, and encrypted-vault creation.
- 35 desktop/shared Vitest files with 210 passing unit and component tests, plus 31 passing mobile tests across 6 files.
- Expo Doctor 20/20 plus successful production bundle exports for both iOS (803 modules) and Android (801 modules).
- 27 passing Supabase pgTAP assertions, clean public-schema lint and database advisors, plus a live two-session encrypted-sync test covering concurrent creation, sign-out invalidation, sign-in rebinding, strict mutation idempotency, and device revocation.
- `npm audit --omit=dev` currently reports a moderate `uuid` advisory inside Expo's transitive native build-tool chain. npm's proposed automatic fix downgrades Expo across a breaking boundary, so it has not been force-applied; no finding is in Storybound's encryption or runtime sync implementation.
- `npm run package:dir`, producing `dist/mac-arm64/Storybound.app`.
- A packaged-app smoke launch with an isolated profile, sandbox enabled, context isolation enabled, Node integration disabled, a 640×560 minimum window, and visible Getting started guidance.
- PDF inspection with Poppler: valid A5 output, no JavaScript, no blank page after the title, and visually checked title/description pages.

Run the commands again after any later source or dependency change; generated artifact hashes are intentionally not recorded as stable source documentation.

## Release limitations

- Local artifacts are unsigned and unnotarised.
- The packaged smoke audit covered Apple Silicon macOS. Build and test Windows, Linux, and Intel macOS on their target systems before distribution.
- Optional OpenAI use depends on the user's API account and external service availability. All core library, editor, reader, organisation, export, and backup workflows remain local.
- Encrypted sync is optional and single-user; it does not provide collaborative editing. A hosted Supabase project still needs to be provisioned and the public endpoint/key injected into release builds.

## Next release step

Configure signing/notarisation and target-OS CI builds before distributing Storybound broadly.
