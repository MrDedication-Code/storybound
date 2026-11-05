import type { SqlDatabasePort } from './databasePort'
import { seedLibrary } from './seedData'

export const DATABASE_NAME = 'storybound.db'
export const DATABASE_VERSION = 8

const schemaVersionOne = `
CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  blurb TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ongoing', 'completed')),
  cover_tone TEXT NOT NULL CHECK (cover_tone IN ('forest', 'moonlit', 'ember')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (book_id, position)
);

CREATE TABLE IF NOT EXISTS reading_states (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  scroll_position REAL NOT NULL DEFAULT 0 CHECK (scroll_position BETWEEN 0 AND 1),
  progress_percentage REAL NOT NULL DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  reader_theme TEXT NOT NULL DEFAULT 'sepia' CHECK (reader_theme IN ('paper', 'sepia', 'night')),
  font_size INTEGER NOT NULL DEFAULT 19 CHECK (font_size BETWEEN 12 AND 40),
  last_read_at TEXT
);

CREATE TABLE IF NOT EXISTS change_records (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('library', 'book', 'chapter', 'reading_state')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS books_library_position_idx
  ON books (library_id, position)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chapters_book_position_idx
  ON chapters (book_id, position)
  WHERE deleted_at IS NULL;
`

const schemaVersionTwo = `
ALTER TABLE libraries ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE libraries ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE books ADD COLUMN last_opened_at TEXT;
ALTER TABLE books ADD COLUMN completed_at TEXT;
ALTER TABLE books ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
ALTER TABLE books ADD COLUMN language_code TEXT;
ALTER TABLE books ADD COLUMN source_label TEXT;
ALTER TABLE books ADD COLUMN source_url TEXT;
ALTER TABLE books ADD COLUMN personal_notes TEXT;
ALTER TABLE books ADD COLUMN rating INTEGER;
ALTER TABLE books ADD COLUMN favourited_at TEXT;
ALTER TABLE books ADD COLUMN pinned_at TEXT;
ALTER TABLE books ADD COLUMN series_name TEXT;
ALTER TABLE books ADD COLUMN series_position REAL;
ALTER TABLE books ADD COLUMN cover_style TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE books ADD COLUMN cover_position_x REAL NOT NULL DEFAULT 50;
ALTER TABLE books ADD COLUMN cover_position_y REAL NOT NULL DEFAULT 50;
ALTER TABLE books ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
UPDATE books SET cover_style = cover_tone;

ALTER TABLE chapters ADD COLUMN created_at TEXT;
ALTER TABLE chapters ADD COLUMN trashed_from_position INTEGER;
ALTER TABLE chapters ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
UPDATE chapters SET created_at = updated_at WHERE created_at IS NULL;

ALTER TABLE reading_states ADD COLUMN has_finished_current_content INTEGER NOT NULL DEFAULT 0
  CHECK (has_finished_current_content IN (0, 1));
ALTER TABLE reading_states ADD COLUMN updated_at TEXT;
ALTER TABLE reading_states ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE reading_states ADD COLUMN device_id TEXT;
UPDATE reading_states SET updated_at = COALESCE(last_read_at, '${seedLibrary.updatedAt}')
WHERE updated_at IS NULL;

ALTER TABLE change_records RENAME TO change_records_v1;
CREATE TABLE change_records (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('library', 'book', 'chapter', 'reading-state')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  base_remote_revision TEXT,
  mutation_id TEXT,
  PRIMARY KEY (entity_type, entity_id)
);
INSERT INTO change_records (entity_type, entity_id, operation, changed_at)
SELECT
  CASE entity_type WHEN 'reading_state' THEN 'reading-state' ELSE entity_type END,
  entity_id,
  operation,
  changed_at
FROM change_records_v1;
DROP TABLE change_records_v1;

CREATE TABLE mobile_sync_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  local_library_id TEXT NOT NULL REFERENCES libraries(id),
  last_pull_cursor TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_entity_state (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  remote_revision TEXT,
  local_row_version INTEGER CHECK (local_row_version IS NULL OR local_row_version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE sync_conflicts (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_mutation_id TEXT,
  remote_mutation_id TEXT NOT NULL,
  remote_revision TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
`

const schemaVersionThree = `
CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

// Synced cover images, stored as base64 so the reader can show them without file access.
const schemaVersionFour = `
CREATE TABLE book_covers (
  book_id TEXT PRIMARY KEY NOT NULL,
  mime_type TEXT NOT NULL,
  data TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  updated_at TEXT NOT NULL
);
`

// Highlights and notes, each with its place in the chapter folded in (on the desktop the place
// is a separate anchor record). A row is kept after deletion so the deletion can sync.
const schemaVersionFive = `
CREATE TABLE annotations (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'gold',
  start_offset INTEGER,
  end_offset INTEGER,
  fallback_location REAL NOT NULL DEFAULT 0 CHECK (fallback_location BETWEEN 0 AND 1),
  quote TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  resolution_status TEXT NOT NULL DEFAULT 'approximate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  row_version INTEGER NOT NULL CHECK (row_version >= 1)
);
CREATE INDEX annotations_book_idx ON annotations (book_id, deleted_at);

-- Rebuilt so pending changes can include highlights and notes.
ALTER TABLE change_records RENAME TO change_records_v2;
CREATE TABLE change_records (
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('library', 'book', 'chapter', 'reading-state', 'annotation')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  base_remote_revision TEXT,
  mutation_id TEXT,
  PRIMARY KEY (entity_type, entity_id)
);
INSERT INTO change_records SELECT * FROM change_records_v2;
DROP TABLE change_records_v2;
`

// Bookmarks keep their place as a position through the chapter, like the desktop, plus the
// desktop's anchor fields so they round-trip unchanged.
const schemaVersionSix = `
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  location REAL NOT NULL CHECK (location BETWEEN 0 AND 1),
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'gold',
  start_offset INTEGER,
  end_offset INTEGER,
  fallback_location REAL NOT NULL DEFAULT 0 CHECK (fallback_location BETWEEN 0 AND 1),
  quote TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  resolution_status TEXT NOT NULL DEFAULT 'approximate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  row_version INTEGER NOT NULL CHECK (row_version >= 1)
);
CREATE INDEX bookmarks_book_idx ON bookmarks (book_id, deleted_at);

-- Rebuilt so pending changes can include bookmarks.
ALTER TABLE change_records RENAME TO change_records_v3;
CREATE TABLE change_records (
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('library', 'book', 'chapter', 'reading-state', 'annotation', 'bookmark')
  ),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  base_remote_revision TEXT,
  mutation_id TEXT,
  PRIMARY KEY (entity_type, entity_id)
);
INSERT INTO change_records SELECT * FROM change_records_v3;
DROP TABLE change_records_v3;
`

// Earlier versions of chapters, kept on this phone only, so an edit, split, merge, or a change
// from another device can be undone.
const schemaVersionSeven = `
CREATE TABLE chapter_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX chapter_revisions_chapter_idx ON chapter_revisions (chapter_id, created_at);
`

async function createFirstLibrary(transaction: SqlDatabasePort): Promise<void> {
  await transaction.runAsync(
    `INSERT OR IGNORE INTO libraries (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [seedLibrary.id, seedLibrary.name, seedLibrary.createdAt, seedLibrary.updatedAt]
  )
}

/** Who a shared book came from, and whether it is locked. They arrive through sync. */
const schemaVersionEight = `
ALTER TABLE books ADD COLUMN share_sender_name TEXT;
ALTER TABLE books ADD COLUMN share_mode TEXT;
`

export async function migrateDatabase(database: SqlDatabasePort): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)

  await database.transactionAsync(async (transaction) => {
    const versionRow = await transaction.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    )
    const currentVersion = versionRow?.user_version ?? 0

    if (currentVersion > DATABASE_VERSION) {
      throw new Error(`This library was created by a newer Storybound version (${currentVersion}).`)
    }

    if (currentVersion < 1) {
      await transaction.execAsync(schemaVersionOne)
      await createFirstLibrary(transaction)
      await transaction.execAsync('PRAGMA user_version = 1')
    }

    if (currentVersion < 2) {
      await transaction.execAsync(schemaVersionTwo)
      await transaction.execAsync('PRAGMA user_version = 2')
    }

    if (currentVersion < 3) {
      await transaction.execAsync(schemaVersionThree)
      await transaction.execAsync('PRAGMA user_version = 3')
    }

    if (currentVersion < 4) {
      await transaction.execAsync(schemaVersionFour)
      await transaction.execAsync('PRAGMA user_version = 4')
    }

    if (currentVersion < 5) {
      await transaction.execAsync(schemaVersionFive)
      await transaction.execAsync('PRAGMA user_version = 5')
    }

    if (currentVersion < 6) {
      await transaction.execAsync(schemaVersionSix)
      await transaction.execAsync('PRAGMA user_version = 6')
    }

    if (currentVersion < 7) {
      await transaction.execAsync(schemaVersionSeven)
      await transaction.execAsync('PRAGMA user_version = 7')
    }

    if (currentVersion < 8) {
      await transaction.execAsync(schemaVersionEight)
      await transaction.execAsync('PRAGMA user_version = 8')
    }
  })
}
