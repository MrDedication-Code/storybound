# Storybound Data Recovery

When writing appears missing or Storybound reports a storage problem, preserve the current state before trying repairs. Repeated launches, restores, imports, or manual database edits can make diagnosis harder.

## First response

1. Stop editing and record the exact message shown by Storybound.
2. If the application still responds, open **Settings → Data → Open data folder** and note the path.
3. Quit Storybound fully.
4. Copy the entire data folder to a new, clearly named location such as `Storybound-recovery-2026-08-05`. Work only on duplicates after this point.
5. Preserve any `.storybound-book`, `.storybound-backup`, `.storybound-vault`, scheduled, or pre-upgrade backup files you already have.
6. Note the Storybound version, operating system version, and what happened immediately before the problem.

Do not open the SQLite database in a general text editor, delete journal files, or run third-party cleanup tools against the only copy.

## Finding the data directory

The in-application **Open data folder** action is authoritative. If Storybound cannot launch, common packaged-app locations are:

- macOS: `~/Library/Application Support/Storybound`
- Windows: `%APPDATA%\Storybound`
- Linux: `~/.config/Storybound`

Development builds and customised OS profiles may use a different path. Confirm folder contents and modification dates before copying or changing anything.

## Unsaved editor work after a crash

Storybound saves chapter changes shortly after typing stops and keeps local recovery drafts for editor content that has not safely reached the chapter record.

1. Reopen Storybound once.
2. Return to the affected book and chapter.
3. If a recovery prompt appears, compare its timestamp and text with the saved chapter.
4. Recover the draft when it contains newer work, then save the chapter normally.
5. Do not discard a draft until the intended text is visibly stored.

If no draft appears, inspect recent full backups and exported book packages. Storybound cannot reconstruct text that was never committed to the database or a recovery draft.

## Deleted book or chapter

A deleted book first goes to **Trash**:

1. Open **Trash**.
2. Find the book and choose **Restore**.
3. Open the book and verify its chapters.

Deleted chapters have a separate **Chapter trash** section on the book screen. Restore the chapter there before permanently deleting it. For unwanted text changes, open **Chapter versions**, compare the available revision, and restore the intended version.

Permanently removed books, chapters, and pruned revisions do not have a guaranteed in-app undo. Recover them by importing a recent `.storybound-book` package or restoring a full backup/vault. Restore a full library only after backing up the current one, because it is a replacement operation.

## Missing or broken cover

A missing managed cover should not make book text unavailable; Storybound falls back to a deterministic placeholder.

1. Open the book editor.
2. Choose **Replace cover** and select the original image or another local copy.
3. Save a new book package or library backup after repair.

Do not manually change a cover path inside SQLite. The application must copy and validate the selected image into its managed media directory.

## Database integrity warning

If Storybound can open, run **Settings → Data → Database integrity check** and record the complete result.

- If the result is healthy, create a fresh full-library backup and investigate the specific missing item rather than replacing the entire database.
- If the result is unhealthy, quit Storybound, preserve the complete data directory, and restore the newest verified `.storybound-backup` through the application.
- If every backup fails validation, keep all originals. Recovery from a damaged SQLite file is specialist work and may recover only part of the library.

Never run repair commands against the sole database copy. A SQLite database can also depend on adjacent `-wal` and `-shm` files after an interrupted session, which is why the whole closed data directory must be preserved.

## Application will not launch

1. Reboot once to clear a stuck process or locked file.
2. Try the same installed version again without moving the data directory.
3. If it still fails, preserve the data folder before reinstalling.
4. Reinstall the same or a newer compatible Storybound build. Reinstalling application files normally does not repair or remove user data.
5. If launch failure began immediately after an upgrade, preserve any migration backup in the data directory and the pre-upgrade full backup.

Do not uninstall and manually delete data as a troubleshooting step.

## Import or restore rejected

A rejected archive should leave the current library unchanged.

1. Preserve the error message and rejected file.
2. Copy the archive before any inspection.
3. Confirm that a book import uses `.storybound-book`, an ordinary full restore uses `.storybound-backup`, and an encrypted restore uses `.storybound-vault` with its exact passphrase.
4. Confirm the file copy completed; partially synced or zero-byte archives cannot be restored.
5. For an encrypted vault, verify the passphrase from its separate record. Storybound cannot reset or recover it.
6. Try another known-good backup rather than editing the manifest or encrypted envelope by hand.

Changing ZIP entries, paths, IDs, or version fields can make safety validation fail and can introduce unsafe extraction paths.

## Information to collect for technical help

Provide:

- Storybound version and operating system
- The exact on-screen error text
- Whether the app was editing, importing, restoring, upgrading, or closing
- Database integrity result, if available
- Diagnostic log files from the copied data folder
- Names, dates, and sizes of available backups

Do not send a database or archive unless you understand that it contains private story text and metadata. Redact logs if they include personal filenames or excerpts.

## After recovery

1. Open several books and verify chapter count, order, cover, Story Bible entries, goals, annotations, bookmarks, and reading position.
2. Run the database integrity check.
3. Create a new full backup under a new dated filename.
4. Keep the pre-recovery material until the new backup has been checked.
5. Review the routine in [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).
