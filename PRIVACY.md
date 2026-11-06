# Storybound Privacy

Storybound is a private, local-first personal library. Its core features do not require an account, and it includes no analytics, advertising, behavioural tracking, or hidden story upload. All core features work offline. Optional encrypted sync requires an account only when the user chooses to enable it.

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

## Optional encrypted device sync

An unconfigured build makes no sync requests. After the user signs in and explicitly creates or unlocks a sync vault, Storybound sends encrypted entity payloads to the configured Supabase project. Story titles, chapter prose, notes, and reading data are encrypted with AES-256-GCM on the device before transport.

Supabase necessarily processes the account email, authentication/session data, vault and device identifiers, entity type and opaque entity ID, revision/timing information, payload sizes, and ciphertext. It does not receive the vault key or recovery code and cannot decrypt payload contents. Session tokens, the local vault key, and a random per-device possession token are stored using the operating system's protected credential facility on desktop and SecureStore on mobile; Supabase stores only the possession token's SHA-256 hash.

A new device can join either with the recovery code or by approval from a device that is already unlocked. When linking by approval, the new device and the approving device each publish a one-time public key; both screens show six words derived from the vault, the request, and both keys, and the user confirms on both devices that they match. The approving device then seals the vault key for the new device's key, so Supabase relays only public keys and a sealed envelope. Link requests expire after ten minutes, at most three can be pending, and a device must hold its possession token to list or approve them.

The recovery code is shown when the first vault is created. Losing every unlocked device and that code makes the synced ciphertext unrecoverable. Revoking a device stops later RPC access but cannot erase data that device already downloaded. Signing out or disabling sync does not delete local books.

## Optional OpenAI writing assistant

No story text is sent to an AI provider during normal library, writing, reading, search, export, or backup use. (The separate Claude connection described below never makes a request from Storybound; Claude reads and writes through it only when the user is chatting with Claude.)

A network request occurs only when the user:

1. Opens **Optional AI writing assistant** in the editor.
2. Enters their own OpenAI API key.
3. Reviews and checks the consent disclosure.
4. Presses **Send one request**.

That request contains the current chapter, limited book title/blurb context, and the selected instruction. Storybound bounds the submitted text, sends a one-shot Responses API request with `store: false`, and returns an editable suggestion. The user must choose to apply and later save it. API usage may incur charges and remains subject to OpenAI's terms and privacy policy.

Closing the assistant discards the API key from renderer state. Storybound does not retain the key for the next request. Network metadata may still be processed by the operating system, internet provider, and OpenAI as required to deliver the explicitly requested call; `store: false` is not a promise that no service-side security or legal processing can occur.

## Sending a book to someone

Nothing is sent unless the user chooses **Send to someone** on a book. It needs sync to be on.

Each account has a Storybound address, which is a fingerprint of public keys derived from its vault key. Publishing those public keys lets other people send to that address. The server finds an address only by exact match, so nobody can browse or search for who has an account, and no email address is ever shown to anyone.

A parcel is encrypted on the sender's device for the recipient and signed by the sender. It holds the book's title, details, cover and chapters, and its story bible if the sender includes it. It never holds highlights, notes, bookmarks, reading position, revision history, ratings or personal notes. The server stores only the sealed parcel, the recipient's address, the sender's account identifier, and dates. It cannot read the sender's name, the title or the text. A parcel is deleted when it is accepted or declined, or after 30 days.

A read-only book cannot be changed or exported through Storybound or Claude, but the text is on the recipient's device, so this is a lock rather than a guarantee that the words can never be copied. Sending a book gives someone a copy that cannot be recalled. **Stop sending updates** ends future updates only.

## The Bookstore

The Bookstore is optional and needs an account. Nothing in a library is published unless the user chooses **Publish to the Bookstore** on a book they wrote.

**A published book is not encrypted.** Its text, cover, pen name, blurb, genre, content warnings and AI statement are stored on Storybound's Supabase project, where review, browsing and reading all need them. Anyone with an account can read it once it is approved. Its story bible is never sent. This is separate from sync: synced books stay end-to-end encrypted, and the words "nobody else can read your books" apply to sync only.

The server records which account accepted the Bookstore terms and confirmed being 18 or over, which accounts added which books, and any reports. Reports are not shown to authors. Readers' copies are kept on their own devices, so a withdrawn book stays with people who already have it. A book removed for breaking the rules is moved to Trash the next time the app checks.

Deleting an account in **Settings** removes the account, its encrypted sync data, and its published books and files from the server. Books on the user's own devices are not touched.

Having a Bookstore book read aloud by the Google voice sends its text to Google, under the reader's own key. Authors agree to this when publishing.

## Optional Google voice for listening

Listening uses the computer's or phone's own voice unless the user chooses the Google voice in **Settings → Listening**. That requires the user's own Google API key and an explicit agreement that chapter text is sent to Google. When the Google voice is in use, each passage being listened to is sent to Google's Gemini text-to-speech service with the chosen voice and reading style, directly from the device; nothing else from the library is sent. Google processes it under the terms of the user's own Google account. On Google's paid tier Google does not use it to improve its products; on the free tier it may, so Storybound recommends a key with billing set up.

The API key is kept in the operating system's protected storage on desktop and in SecureStore on the phone. It is never stored in the library database, backups, exports, or sync, and is not sent anywhere except to Google with each request. Spoken audio is cached on the device so a passage heard again is not requested again; removing the key or clearing the app's data removes it.

## Android Auto

When the phone is connected to Android Auto, Storybound gives Android Auto the titles, authors and reading progress of the books on the phone, and the title and cover of the book being read, so they can be shown on the car's screen. This goes to Android Auto on the phone itself, which shows it in the car; Storybound sends nothing over the network for it. The list is also kept in the app's private storage so the car can show it before the app has started.

## Free offline voice (Kokoro)

The free voice is downloaded only when the user chooses **Download the free voice** in **Settings → Listening**: the Kokoro model and voices from Hugging Face (onnx-community/Kokoro-82M-v1.0-ONNX) and Kokoro's pronunciation dictionaries from GitHub (hexgrad/misaki), each from a fixed revision and checked against a fixed SHA-256 before use. The download requests carry no library content. After that the voice runs entirely on the device: chapter text is turned into speech locally and is never sent anywhere. **Remove download** deletes the files.

## Optional AI assistant connections (Claude and the inbox folder)

Both connections are off by default and are controlled in **Settings → AI assistants**.

**Connect Claude.** When switched on, Storybound runs an MCP server that listens only on this computer's loopback address (`127.0.0.1`). It requires a random access token, and refuses requests that carry a browser `Origin` header or an unexpected `Host`, so web pages cannot reach it. The token, the active port, and the on/off settings are kept in `agent-bridge.json` in the application-data folder (readable only by the current user). They are not stored in the library database, so they never appear in backups, packages, vaults, or sync. A cached tool list (`mcp-tools.json`) sits beside it and holds no story content.

Through the connection Claude can list books in the active library, read chapter text, the user's highlights and reading notes, and each book's story bible, add story bible entries and replace an entry's main text, create books, update book details, add chapters, and revise chapters. Revisions keep the previous text in the chapter's revision history. No tool can delete, trash, change settings, or reach other libraries. Storybound itself makes no network request. Whatever Claude reads or writes through these tools becomes part of the user's Claude conversation and is processed by Anthropic under the terms of that Claude product, exactly as if the user had pasted it into the chat.

Claude Desktop and Claude Code launch a small bridge script with Storybound's own executable. **Add to Claude Desktop** writes one `storybound` entry into Claude Desktop's `claude_desktop_config.json`, after saving the previous file as `claude_desktop_config.json.storybound-backup`.

**Inbox folder.** When switched on, Storybound checks the chosen folder (default `Documents/Storybound Inbox`) every few seconds while the app is open. It imports Markdown or text files into the active library and moves each one to `Imported/` or `Failed/`. Files are read locally and never uploaded.

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
