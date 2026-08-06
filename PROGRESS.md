# Storybound Progress

Last updated: 6 August 2026

## Completed roadmap

1. **Immediate usability** — fixed Settings wheel scrolling and scrollspy behavior, added Back to top, enforced a usable minimum window size, kept the editor workspace expanded in edit mode, and preserved authored paragraph/dialogue breaks from clipboard through Reader.
2. **Domain foundation** — evolved the SQLite schema through version 9 with multiple libraries, organisation metadata, revisions, Story Bible records, annotations, goals, backup plans, cover presentation settings, and durable first-run state.
3. **Import, export, and backup** — added reviewed text/chat import, portable package v2, Markdown, EPUB 3, PDF, offline companion, historical backup restore, scheduled backups, and authenticated encrypted vault transfer.
4. **Organisation and discovery** — added tags, collections, saved filters, series order, batch actions, scoped libraries, Story Bible search, and local full-text search.
5. **Writing workflow** — added resilient autosave/recovery, dirty-navigation protection, a large resizable editor, focus/split/preview modes, chapter trash and revisions, split/merge/detection, goals, and writing statistics.
6. **Reading workflow** — added responsive reader controls, local progress, richer bookmarks, anchored highlights/notes, and operating-system text-to-speech.
7. **Advanced local-first features** — added deterministic Cover Studio palettes and focal positioning, a no-network offline companion, and an explicitly approved one-shot OpenAI writing helper.
8. **Release quality** — added first-run help, accessibility and responsive refinements, lazy-loaded routes, security/privacy hardening, automated workflow coverage, packaging checks, and updated documentation.

## Verification evidence

The final release audit covers:

- Formatting, ESLint, Node/Web TypeScript, Vitest, and a production build through `npm run check`.
- Six real-Electron end-to-end scenarios, including one-time first-run guidance, editor sizing, paragraph-preserving rich paste through storage and Reader, Settings wheel scrolling after section navigation, persistence across relaunch, reader progress restoration, cover focal positioning, PDF export, offline companion export, portable package round-trip, and encrypted-vault creation.
- 30 Vitest files with 185 unit and component tests before the final release rerun.
- `npm audit --omit=dev` with zero production dependency vulnerabilities.
- `npm run package:dir`, producing `dist/mac-arm64/Storybound.app`.
- A packaged-app smoke launch with an isolated profile, sandbox enabled, context isolation enabled, Node integration disabled, a 640×560 minimum window, and visible Getting started guidance.
- PDF inspection with Poppler: valid A5 output, no JavaScript, no blank page after the title, and visually checked title/description pages.

Run the commands again after any later source or dependency change; generated artifact hashes are intentionally not recorded as stable source documentation.

## Release limitations

- Local artifacts are unsigned and unnotarised.
- The packaged smoke audit covered Apple Silicon macOS. Build and test Windows, Linux, and Intel macOS on their target systems before distribution.
- Optional OpenAI use depends on the user's API account and external service availability. All core library, editor, reader, organisation, export, and backup workflows remain local.
- There is no automatic cloud sync, account system, or real-time collaboration.

## Next release step

Configure signing/notarisation and target-OS CI builds before distributing Storybound broadly.
