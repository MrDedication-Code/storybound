# Storybound Mobile

An Expo SDK 58 reader-first app for iOS and Android. The library is always stored in Expo SQLite and remains fully usable without an account or network connection. Builds can optionally enable end-to-end encrypted Supabase sync.

## Run locally

Use Node.js 22 or newer, then install dependencies inside this directory:

```sh
cd apps/mobile
npm install
npm run ios
# or: npm run android
```

Run the verification suite with:

```sh
npm run check
npx expo-doctor --verbose
```

## Optional encrypted sync

Copy `.env.example` to `.env.local` in this directory (Expo does not read the repository root's env files) and provide the Storybound Supabase project values:

```sh
EXPO_PUBLIC_STORYBOUND_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_STORYBOUND_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only use a publishable/anon client key. Never put a Supabase secret key or service-role key in an `EXPO_PUBLIC_` variable; Expo embeds those variables in the application bundle. If either variable is absent or invalid, Storybound starts normally in local-only mode and reports the configuration issue on the Sync screen.

The Sync screen supports account creation and sign-in, creation of a new encrypted vault, recovery of an existing vault, local-scope sign-out, and an explicit Sync now action. Auth sessions and account-scoped vault credentials are stored through Expo SecureStore. Each registered device gets a 32-byte random token encoded as unpadded base64url; the raw token stays in secure credentials while the server stores only its SHA-256 hash. Legacy credentials without a device token remain locked until the user recovers the vault. Large Supabase session values are split into bounded chunks before secure storage.

The mobile client implements the live Storybound RPC contract:

- `get_storybound_bootstrap`
- `create_storybound_vault`
- `register_storybound_device`
- `pull_storybound_changes`
- `push_storybound_mutations`

Library, book, chapter, reading-state, annotation, bookmark, and book-cover payloads use the same canonical AES-256-GCM protocol and recovery-code verifier as desktop. The vault key never leaves the device unencrypted. Covers are stored in the `book_covers` table and shown as an inline image; a book without one keeps its generated cover. Server revisions and cursors remain decimal strings so PostgreSQL `bigint` values are never truncated by JavaScript numbers.

## Included flow

- Library search and continue-reading state
- Book details and chapter navigation
- Reader themes, text sizing, progress, and resume position
- Bookmarks: save your place from the reader footer with an optional name, note, and colour; the book's list jumps back to it
- Highlights and notes: long-press a paragraph, narrow it to sentences, pick a colour, and add a note; tap a highlight to edit or remove it; the book's list jumps to each one
- Reader mode and Editor mode; Reader mode hides every writing control

## Editor mode

- **Books:** create a book (choosing its library when there are several), edit its title, subtitle, author, description, status, and series, move it to Trash, and restore it from the library's Trash.
- **Chapters:** add, rename, duplicate, reorder (Arrange mode with large arrows), merge with the next chapter, and move to Trash with Undo; restore from the book's Chapter Trash. Holding a chapter opens a petal menu that blooms around the finger with every chapter action.
- **Writing:** a full-height editor that saves after a short pause and whenever the app goes to the background. A quill button in the thumb's corner opens the writing-tools wheel: press, slide to a tool, and let go, or tap it open and tap tools. The near ring holds Undo, Redo, Italic, and Bold; the far ring holds Heading, Dialogue quotes, Em dash, Scene break, and More. Petals tick under the thumb (haptics) and a caption names the one touched.
- **More tools** unfold as a card from the same corner: Find & replace (match case, replace one or all), split the chapter at the cursor (titled from its opening heading when it has one), earlier versions, focus mode, smart punctuation (curly quotes, `--` to an em dash, `...` to an ellipsis, as typed), read this chapter, and previous or next chapter.
- **Versions** are kept on the phone: while writing (at most every ten minutes), before a split, merge, move to Trash, or restored version, and before another device's edit replaces the text. The newest 50 per chapter are kept; they do not sync.
- Durable on-device books, chapters, reading state, and coalesced change ledger
- Optional encrypted account sync with recovery-code onboarding and conflict counts

## Storage architecture

- `src/data/sqlite/migrations.ts` owns the schema version, migration transaction, connection PRAGMAs, and first-run sample.
- `src/data/sqlite/sqliteRepository.ts` implements the `MobileRepository` contract with bound queries and serialized write transactions.
- `src/data/sqlite/sqliteSyncStore.ts` maps the four core entities to the encrypted RPC protocol, coalesces local changes, persists cursors, and applies pull pages transactionally.
- `src/data/sqlite/openRepository.ts` opens `storybound.db`, migrates it before rendering the library, shares one write coordinator with sync, and closes its dedicated connection on teardown.

Schema versioning uses SQLite's `PRAGMA user_version`. Add future migrations as ordered `currentVersion < N` blocks and update `DATABASE_VERSION` only with the last migration. Never copy or upload the live database file.

Vitest runs the production SQL and repository code against Node's built-in SQLite driver. iOS and Android export checks additionally verify that Expo's native SQLite, SecureStore, and Crypto modules resolve and bundle; an emulator/device smoke test is still required before release.
