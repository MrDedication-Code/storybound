# Storybound Mobile

An Expo SDK 57 reader-first app for iOS and Android. The library is always stored in Expo SQLite and remains fully usable without an account or network connection. Builds can optionally enable end-to-end encrypted Supabase sync.

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

Copy `.env.example` to `.env` and provide the Storybound Supabase project values:

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

Library, book, chapter, and reading-state payloads use the same canonical AES-256-GCM protocol and recovery-code verifier as desktop. The vault key never leaves the device unencrypted. Server revisions and cursors remain decimal strings so PostgreSQL `bigint` values are never truncated by JavaScript numbers.

## Included flow

- Library search and continue-reading state
- Book details and chapter navigation
- Reader themes, text sizing, progress, and resume position
- Full-height chapter editor with autosave and reader preview
- Durable on-device books, chapters, reading state, and coalesced change ledger
- Optional encrypted account sync with recovery-code onboarding and conflict counts

## Storage architecture

- `src/data/sqlite/migrations.ts` owns the schema version, migration transaction, connection PRAGMAs, and first-run sample.
- `src/data/sqlite/sqliteRepository.ts` implements the `MobileRepository` contract with bound queries and serialized write transactions.
- `src/data/sqlite/sqliteSyncStore.ts` maps the four core entities to the encrypted RPC protocol, coalesces local changes, persists cursors, and applies pull pages transactionally.
- `src/data/sqlite/openRepository.ts` opens `storybound.db`, migrates it before rendering the library, shares one write coordinator with sync, and closes its dedicated connection on teardown.

Schema versioning uses SQLite's `PRAGMA user_version`. Add future migrations as ordered `currentVersion < N` blocks and update `DATABASE_VERSION` only with the last migration. Never copy or upload the live database file.

Vitest runs the production SQL and repository code against Node's built-in SQLite driver. iOS and Android export checks additionally verify that Expo's native SQLite, SecureStore, and Crypto modules resolve and bundle; an emulator/device smoke test is still required before release.
