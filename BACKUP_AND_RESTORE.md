# Backing Up and Restoring Storybound

Storybound keeps its working database and managed covers on this computer. Use backups to protect against device failure, accidental replacement, and storage damage.

## Choose the right file

- **Book package (`.storybound-book`)** — one editable book with book metadata, chapters, cover, bookmarks, and reading state. Importing adds a separate copy when IDs conflict. Library tags/collections, Story Bible entries, annotations, revisions, and goals require a full backup.
- **Library backup (`.storybound-backup`)** — a verified disaster-recovery snapshot of the complete Storybound library. It is not encrypted.
- **Encrypted vault (`.storybound-vault`)** — a complete library backup protected by a passphrase using authenticated encryption. Use it for manual transfer or storage where an ordinary backup would expose the writing.
- **Markdown, EPUB, PDF, and offline companion** — reading or publishing copies, not complete restore sources.

Portable backup/vault payloads are limited to 500 MB. If the limit is reached, reduce oversized cover images or archive books separately.

## Create a manual full backup

1. Let any visible **Saving…** indicator finish.
2. Open **Settings → Data**.
3. Choose **Export backup**.
4. Save outside Storybound's live data directory.
5. Wait for the success message and confirm the file has a non-zero size.
6. Copy the dated result to a second device or trusted encrypted storage.

## Configure scheduled local backups

1. Open **Settings → Data → Automatic local backups**.
2. Choose daily, weekly, or monthly cadence and a retention count.
3. Choose a destination folder outside the live Storybound data directory.
4. Use **Run now** once and verify that a dated `.storybound-backup` appears.
5. Leave the plan enabled. Due backups run only while Storybound is open.

Retention removes older files created by that backup plan; removing or pausing a plan keeps existing backup files. Scheduled files are plaintext, so select an encrypted drive or protected destination when needed.

## Export an encrypted vault

1. Open **Settings → Data → Encrypted transfer vault** and choose **Export vault**.
2. Enter and confirm a passphrase of at least 10 characters.
3. Choose the destination and wait for success.
4. Store the vault and passphrase separately.

Storybound never saves the passphrase and cannot recover or reset it. A strong unique multi-word passphrase is preferable. Losing it makes the vault unusable.

## Restore a full backup or encrypted vault

Restore replaces the current library after the selected file passes validation.

1. Export a fresh backup or vault of the current library under a different name.
2. Let saves finish, then open **Settings → Data**.
3. Choose **Restore backup** for `.storybound-backup`, or **Restore vault** for `.storybound-vault`.
4. For a vault, enter its exact passphrase before selecting the file.
5. Confirm the replacement warning and keep Storybound open through validation and reload.
6. Check several books, chapter order, Story Bible entries, goals, custom covers, annotations, bookmarks, and reader positions.
7. Run **Database integrity check**.
8. Keep both the pre-restore copy and source backup until verification is complete.

A malformed, incompatible, incomplete, oversized, or incorrectly decrypted archive is rejected before the live library is changed. After a successful restore, Storybound retains an automatic safety copy of the replaced library in its local `Backups` folder.

## Export or import one book

From Book Details choose **Export book**, then select a Storybound package for a round-trip copy. From Library or Settings choose **Import package** to add one.

The import does not silently overwrite an existing book. Human-readable exports are useful outside Storybound but do not retain the complete editable data model and cannot be used as a full restore.

## Move to another computer

The safest manual transfer is:

1. Export an encrypted vault on the old computer.
2. Copy the completed `.storybound-vault` to the new computer.
3. Install the same or a newer compatible Storybound version.
4. Restore the vault and verify the library.
5. Keep the old installation and vault until checks pass.

An ordinary `.storybound-backup` can be used instead when the transfer medium is already trusted and encrypted. Do not copy or live-sync an open SQLite directory.

## Emergency manual backup

Use this only when the app cannot export:

1. Quit Storybound completely.
2. Resolve the exact path previously shown by **Open data folder**.
3. Copy the entire directory, including SQLite journal files and managed media, to a new location.
4. Keep the original untouched and record the Storybound and OS versions.

A live copy can be inconsistent. Do not use file sync as a live database transport; sync completed backup or vault files instead.

## A practical routine

For valuable libraries, keep:

- The live library on a full-disk-encrypted computer
- A scheduled backup on a separate local device
- A recent encrypted vault or independently encrypted backup off-site

Use dated filenames rather than overwriting the only known-good file. Periodically verify a restore with an isolated profile or another computer.

If restore fails, preserve the archive and current data directory, record the exact error, and follow [DATA_RECOVERY.md](DATA_RECOVERY.md).
