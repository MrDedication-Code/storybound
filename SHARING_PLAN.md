# Sharing books: the plan

Send a book to another Storybound account as a wrapped parcel. It stays private the whole way, the person unwraps a 3D hardcover, and you can keep sending them new chapters. Target: Storybound 0.5.0 for Mac and Windows, and Android 0.5.0.

## Decisions already made

- People are found by a friend code, called a Storybound address, never by email.
- The story bible is off by default for read-only books and on for editable ones.
- Updates go out when the author presses **Send update**, never automatically.
- Sending and unwrapping happen on a computer. Accepted books reach phones through sync, and Android enforces the lock.
- A parcel never includes the sender's highlights, notes, bookmarks, reading position, revision history, rating or personal notes.

## How it works

**Keys.** Each account's sharing keys are derived from its vault key, so every linked device has them with no setup. The private keys never leave the devices.

**Address.** A 16-character code such as `K7QM-2XPD-9RTA-HF4W`, which is a fingerprint of the account's public keys. The server stores address and public keys only. The sender checks the keys it gets back against the code, so the server cannot swap in someone else's keys.

**Parcel.** Encrypted for the recipient with a fresh key and signed by the sender. It has two sealed parts: a small label (sender's name and address, title, what kind of parcel, how many chapters) and the body (the whole book). The server sees only sizes, dates and which address it is for. The recipient checks the signature against the sender's address.

**Updates carry the whole book.** One parcel format, and any parcel can stand alone, so a missed update loses nothing. Each book has a share ID and a sequence number, and the app ignores anything older than what it has. An update is only accepted from the address that sent the original. Book and chapter IDs on the recipient's side are derived from the share ID and the sender's IDs, so the same chapter is matched on any device with no lookup table.

**Parcels are temporary.** Deleted when accepted or declined, and after 30 days. Size and pending-count limits protect the free server plan.

## Rules when an update arrives

| Situation                            | Read-only book             | Editable book                                                      |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| New chapter                          | Added                      | Added                                                              |
| Chapter revised, recipient untouched | Replaced, old in Revisions | Replaced, old in Revisions                                         |
| Chapter revised, recipient edited it | Cannot happen              | Theirs stays, sender's goes in Revisions                           |
| Sender removed a chapter             | Moved to Trash             | Left alone                                                         |
| Book details, cover, bible           | Replaced                   | Details and cover updated if unchanged; bible entries merged by ID |

Reading position, highlights and notes are always kept. Existing logic re-locates highlights when text changes.

## The read-only lock

A read-only book cannot be changed by the app, Claude, or Android: chapters, details, cover and bible are all locked, and it cannot be exported. Highlights, notes, bookmarks, listening, tags and collections still work, and it can be removed from the library. The lock is enforced in the store, not only by hiding buttons, so every route is covered. It is a lock, not perfect protection, because the text is on the recipient's device. The guide says so.

The lock travels with the book through sync as new optional fields. Older apps ignore them, and a record from an older app never clears them.

## Build stages

**1. Server and encryption**

- `packages/sync/src/parcel.ts`: derive keys, make and check addresses, seal, open and verify, with tests.
- New Supabase migration: addresses and parcels tables with no direct access, and functions to register, look up, send, list, fetch and delete. Includes limits, expiry and SQL tests.

**2. Desktop engine**

- Database migration 13: share fields on books, plus sent-shares tables for the sender.
- `src/main/sharing`: build a parcel from a book, apply a parcel to the library, and the rules above, with tests.
- Sync controller: publish the address when sync unlocks, send, list, open, accept, decline.
- The lock in the store. IPC and preload. Shared types.

**3. The experience**

- Settings: your address, with a copy button.
- Book page: **Share** with recipient, read-only or editable, and bible choice; status such as “Shared with Adam · 2 new chapters”; **Send update**.
- Sending: the book wraps in brown paper, tied with string, and whooshes away.
- Receiving: a parcel appears in the app with who sent it. Click to unwrap, then a Three.js hardcover with the cover on the front, title on the spine and blurb on the back, turning and zooming. **Collect** or **Decline**. **Collect** flies it to the library with a page-flick sound.
- Updates arrive as a small parcel with a one-click add.
- Sounds are generated in the app, so there are no licensing questions. Reduced-motion and no-3D fallbacks. Lazy-loaded so the app does not start slower.
- Locked books hide their editing controls and show who they are from.

**4. Android**

- Add the share fields to the local database and sync mapping.
- Enforce the lock in the editor and book screens, and show who the book is from.

**5. Proof and words**

- Unit tests for each stage and SQL tests on a local Supabase.
- A two-account test on local Supabase: send, accept, update, edit, lock, decline.
- Add sharing to the Windows packaged check, and look at the animation and 3D book on screen.
- Add a Sharing tab to the guide, and update `PRIVACY.md`, `SYNC_SETUP.md`, `DECISIONS.md`, `PROGRESS.md` and the writing guide.

**6. Release, when you say so**

- Apply the migration to the live server. It only adds things, so current apps keep working.
- Push, run the Windows job, and release desktop and Android 0.5.0.

## Known limits

- Sent-share records live on the computer that sent them, so **Send update** works from there.
- Someone with only a phone cannot accept a parcel until they open Storybound on a computer.
- Both people need sync turned on.
- A book with no cover image draws its generated cover from its id, so its colours can differ between the sender's copy and the recipient's. A chosen cover image is always the same.
- The story bible does not sync between devices, for any book, so a received bible stays on the computer that collected it.
