# Storybound encrypted sync setup

Storybound remains fully local unless the user explicitly signs in and enables sync. The desktop and mobile clients share the same offline-first, end-to-end encrypted protocol: story titles, prose, notes, and reading data are encrypted on the device before upload. Supabase sees account ownership, device IDs, entity routing IDs, revisions, timestamps, and ciphertext.

## Local development

1. Install and start Docker Desktop.
2. Run `npm run supabase:start`, then `npm run supabase:reset` and `npm run supabase:test`.
3. Copy `.env.example` to `.env.local` and use the URL and publishable key printed by `npm run supabase:status`. This one file configures both clients: `electron.vite.config.ts` reads the `STORYBOUND_SUPABASE_*` lines at build time for desktop, and Expo reads the `EXPO_PUBLIC_STORYBOUND_SUPABASE_*` lines for mobile.
4. Run `npm run dev` for desktop or `npm run mobile:ios` / `npm run mobile:android` for Expo.

`npm run dev`, `npm run build`, and `npm run package*` all bake the desktop values from `.env.local` into the built main process, so a packaged app carries its configured Supabase project with it. A `STORYBOUND_SUPABASE_URL`/`STORYBOUND_SUPABASE_PUBLISHABLE_KEY` exported in the shell environment is used instead whenever `.env.local` does not set them — useful for CI or for pointing an existing build at a different project without rebuilding.

If Docker Desktop has not been granted access to a workspace under macOS Documents, run the Supabase directory from a temporary path or grant Docker that folder access. This affects local development only.

## Hosted Supabase

Create a Supabase project, apply `supabase/migrations` with the Supabase CLI, and configure the four variables shown in `.env.example` for the desktop and Expo builds. Use only the public/publishable client key; never ship a secret or service-role key.

The first signed-in device creates the encrypted vault and displays a one-time recovery code. Store it in a password manager. A later device signs into the same account and uses that code to unwrap the vault key. Supabase cannot recover a lost recovery code or decrypt the library.

The hardened protocol migration `20260806224500` removes every legacy RPC overload and adds a random per-device possession token. If a development installation ran an interim protocol that already stored a recovery verifier, its legacy devices are revoked deliberately; recover the vault once on each device to register a new protected device record. A still-earlier pre-verifier development vault cannot be authenticated in place and must be reset and re-uploaded from its authoritative local library. No hosted production schema predates the hardened migration. Normal later sign-out/sign-in cycles preserve the device credential and do not require the recovery code again.

## Operational checks

- `npm run supabase:reset`
- `npm run supabase:test`
- `npx supabase db lint --local --schema public --level warning`
- `npx supabase db advisors --local`

Keep normal local backups enabled even when sync is active. Synchronisation protects availability; it is not a substitute for versioned backups.
