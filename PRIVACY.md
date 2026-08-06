# Storybound Privacy

Storybound is a private, local-first personal library. It does not require an account and includes no analytics, advertising, behavioural tracking, automatic cloud sync, or hidden story upload. All core features work offline.

## Data stored on this computer

Storybound stores information needed for the features the user chooses, including:

- Libraries, books, series metadata, tags, collections, saved filters, and timestamps
- Chapter titles, text, ordering, word counts, revisions, Trash records, and recovery drafts
- Story Bible entities, timeline dates, relationships, and chapter links
- Writing goals and locally derived writing statistics
- Reading positions, bookmarks, highlights, reading notes, and appearance preferences
- Copies of selected cover images and cover presentation settings
- Backup schedules and their selected destination paths
- Local diagnostic information needed to investigate application errors

Structured information is held in SQLite. Managed cover files and local safety backups sit beside it in Storybound's application-data directory. **Settings → Data → Open data folder** reveals the active location.

Storybound does not store the passphrase used for an encrypted vault. It also does not store an OpenAI API key in SQLite, settings, logs, backups, or exports.

## Optional OpenAI writing assistant

No story text is sent to an AI provider during normal library, writing, reading, search, export, or backup use.

A network request occurs only when the user:

1. Opens **Optional AI writing assistant** in the editor.
2. Enters their own OpenAI API key.
3. Reviews and checks the consent disclosure.
4. Presses **Send one request**.

That request contains the current chapter, limited book title/blurb context, and the selected instruction. Storybound bounds the submitted text, sends a one-shot Responses API request with `store: false`, and returns an editable suggestion. The user must choose to apply and later save it. API usage may incur charges and remains subject to OpenAI's terms and privacy policy.

Closing the assistant discards the API key from renderer state. Storybound does not retain the key for the next request. Network metadata may still be processed by the operating system, internet provider, and OpenAI as required to deliver the explicitly requested call; `store: false` is not a promise that no service-side security or legal processing can occur.

## Imports, exports, backups, and companion files

Cover selection copies an image into an application-managed folder and leaves the original unchanged.

Imports and restores are parsed and validated locally. Exports are written only to the user-selected destination; Storybound does not upload them.

- Markdown, EPUB, PDF, companion HTML, `.storybound-book`, and ordinary `.storybound-backup` files may contain readable story text and metadata.
- A companion HTML file is self-contained and configured not to make network connections, but anyone with the file can read its book.
- A `.storybound-vault` encrypts a complete backup with authenticated encryption. Its passphrase is required to recover it and cannot be reset by Storybound.
- A scheduled backup is an ordinary plaintext `.storybound-backup` unless the destination storage supplies its own encryption.

Protect every exported file according to its sensitivity.

## Security boundary

The story-rendering process has no direct Node.js, database, or unrestricted filesystem access. A sandboxed context-isolated preload exposes a limited API, and main-process handlers validate inputs before storage, file, or optional network operations. Pasted Markdown is displayed without executing raw HTML or scripts.

These controls reduce application-level risk, but:

- The live database and ordinary archives are not encrypted by Storybound.
- Someone with access to the operating-system account may be able to read the library.
- Permanently deleted bytes may remain in filesystem snapshots, backups, SQLite free pages, or solid-state storage.
- Malware, a compromised OS account, a weak vault passphrase, and untrusted installer builds are outside Storybound's protection.

Use a password-protected account, full-disk encryption, a trusted installer source, and independent backups for sensitive writing.

## Retention and deletion

Local content remains until the user changes or removes it. Books and chapters first enter in-app Trash; permanent deletion is separately confirmed. Recovery drafts and revisions are retained according to the application's local data lifecycle.

To remove all local Storybound data, quit and uninstall the app, then remove the exact application-data directory. Existing exports, scheduled backups, vaults, OS backups, and synced copies must be removed separately.

This document describes product behavior and is not a substitute for an organisation-specific legal privacy notice.
