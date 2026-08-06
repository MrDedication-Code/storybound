import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { StoryboundError } from './errors'

export interface StoryboundPaths {
  root: string
  database: string
  media: string
  backups: string
  logs: string
}

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-library-schema',
    sql: `
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        blurb TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ongoing' CHECK(status IN ('ongoing', 'completed')),
        cover_image_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT,
        completed_at TEXT,
        total_word_count INTEGER NOT NULL DEFAULT 0 CHECK(total_word_count >= 0),
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1)),
        deleted_at TEXT
      );

      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0 CHECK(word_count >= 0),
        UNIQUE(book_id, position)
      );

      CREATE TABLE reading_states (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
        scroll_position REAL NOT NULL DEFAULT 0 CHECK(scroll_position BETWEEN 0 AND 1),
        progress_percentage REAL NOT NULL DEFAULT 0 CHECK(progress_percentage BETWEEN 0 AND 100),
        last_read_at TEXT,
        has_finished_current_content INTEGER NOT NULL DEFAULT 0 CHECK(has_finished_current_content IN (0, 1))
      );

      CREATE TABLE bookmarks (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        location REAL NOT NULL CHECK(location BETWEEN 0 AND 1),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE application_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        app_theme TEXT NOT NULL CHECK(app_theme IN ('system', 'dark', 'light')),
        reduced_motion INTEGER NOT NULL CHECK(reduced_motion IN (0, 1)),
        reader_theme TEXT NOT NULL CHECK(reader_theme IN ('light', 'sepia', 'dark')),
        reader_font TEXT NOT NULL CHECK(reader_font IN ('literary', 'classic', 'modern')),
        reader_font_size INTEGER NOT NULL CHECK(reader_font_size BETWEEN 14 AND 34),
        line_height REAL NOT NULL CHECK(line_height BETWEEN 1.3 AND 2.2),
        column_width INTEGER NOT NULL CHECK(column_width BETWEEN 480 AND 1000),
        paragraph_spacing REAL NOT NULL CHECK(paragraph_spacing BETWEEN 0 AND 2),
        paragraph_indentation INTEGER NOT NULL CHECK(paragraph_indentation IN (0, 1)),
        text_alignment TEXT NOT NULL CHECK(text_alignment IN ('left', 'justify')),
        default_library_sort TEXT NOT NULL CHECK(default_library_sort IN ('recently-opened', 'recently-updated', 'title', 'progress', 'created'))
      );

      INSERT INTO application_settings (
        id, app_theme, reduced_motion, reader_theme, reader_font, reader_font_size,
        line_height, column_width, paragraph_spacing, paragraph_indentation,
        text_alignment, default_library_sort
      ) VALUES (1, 'system', 0, 'sepia', 'literary', 19, 1.7, 720, 1, 0, 'left', 'recently-opened');

      CREATE TABLE recovery_drafts (
        chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );

      CREATE INDEX books_title_idx ON books(title COLLATE NOCASE);
      CREATE INDEX books_status_idx ON books(status);
      CREATE INDEX books_updated_idx ON books(updated_at DESC);
      CREATE INDEX books_deleted_idx ON books(deleted_at);
      CREATE INDEX chapters_book_position_idx ON chapters(book_id, position);
      CREATE INDEX bookmarks_book_idx ON bookmarks(book_id, created_at DESC);

      CREATE VIRTUAL TABLE book_search USING fts5(
        book_id UNINDEXED,
        title,
        blurb,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE VIRTUAL TABLE chapter_search USING fts5(
        chapter_id UNINDEXED,
        book_id UNINDEXED,
        title,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER books_search_insert AFTER INSERT ON books BEGIN
        INSERT INTO book_search(book_id, title, blurb) VALUES (new.id, new.title, new.blurb);
      END;
      CREATE TRIGGER books_search_update AFTER UPDATE OF title, blurb ON books BEGIN
        DELETE FROM book_search WHERE book_id = old.id;
        INSERT INTO book_search(book_id, title, blurb) VALUES (new.id, new.title, new.blurb);
      END;
      CREATE TRIGGER books_search_delete AFTER DELETE ON books BEGIN
        DELETE FROM book_search WHERE book_id = old.id;
      END;

      CREATE TRIGGER chapters_search_insert AFTER INSERT ON chapters BEGIN
        INSERT INTO chapter_search(chapter_id, book_id, title, content)
        VALUES (new.id, new.book_id, new.title, new.content);
      END;
      CREATE TRIGGER chapters_search_update AFTER UPDATE OF title, content, book_id ON chapters BEGIN
        DELETE FROM chapter_search WHERE chapter_id = old.id;
        INSERT INTO chapter_search(chapter_id, book_id, title, content)
        VALUES (new.id, new.book_id, new.title, new.content);
      END;
      CREATE TRIGGER chapters_search_delete AFTER DELETE ON chapters BEGIN
        DELETE FROM chapter_search WHERE chapter_id = old.id;
      END;
    `
  },
  {
    version: 2,
    name: 'library-scope-and-media-foundation',
    sql: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      INSERT INTO libraries (id, name, description, created_at, updated_at)
      VALUES (
        '00000000-0000-4000-8000-000000000001',
        'Storybound Library',
        '',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );

      CREATE TABLE app_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        active_library_id TEXT NOT NULL REFERENCES libraries(id),
        updated_at TEXT NOT NULL
      );

      INSERT INTO app_state (id, active_library_id, updated_at)
      VALUES (
        1,
        '00000000-0000-4000-8000-000000000001',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );

      CREATE TABLE book_libraries (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL UNIQUE REFERENCES books(id) ON DELETE CASCADE,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      INSERT INTO book_libraries (id, book_id, library_id, created_at, updated_at)
      SELECT id, id, '00000000-0000-4000-8000-000000000001', created_at, updated_at
      FROM books;

      CREATE TRIGGER books_library_insert AFTER INSERT ON books
      WHEN NOT EXISTS (SELECT 1 FROM book_libraries WHERE book_id = new.id)
      BEGIN
        INSERT INTO book_libraries (id, book_id, library_id, created_at, updated_at)
        SELECT new.id, new.id, active_library_id, new.created_at, new.updated_at
        FROM app_state WHERE id = 1;
      END;

      CREATE INDEX book_libraries_library_idx
      ON book_libraries(library_id, deleted_at, updated_at DESC);

      CREATE TABLE media_assets (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        kind TEXT NOT NULL CHECK(kind IN ('cover', 'audio', 'attachment')),
        storage_name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
        width INTEGER CHECK(width IS NULL OR width > 0),
        height INTEGER CHECK(height IS NULL OR height > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
        UNIQUE(library_id, sha256)
      );

      ALTER TABLE books ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1
        CHECK(row_version >= 1);
      ALTER TABLE books ADD COLUMN cover_asset_id TEXT REFERENCES media_assets(id);
    `
  },
  {
    version: 3,
    name: 'metadata-and-organization',
    sql: `
      ALTER TABLE books ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN author_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN language_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN source_label TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN personal_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN rating INTEGER CHECK(rating IS NULL OR rating BETWEEN 1 AND 5);
      ALTER TABLE books ADD COLUMN favourited_at TEXT;
      ALTER TABLE books ADD COLUMN pinned_at TEXT;

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        normalized_name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );
      CREATE UNIQUE INDEX tags_active_name_idx
      ON tags(library_id, normalized_name) WHERE deleted_at IS NULL;

      CREATE TABLE book_tags (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );
      CREATE UNIQUE INDEX book_tags_active_idx
      ON book_tags(book_id, tag_id) WHERE deleted_at IS NULL;

      CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT 'books',
        position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE TABLE collection_books (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );
      CREATE UNIQUE INDEX collection_books_active_idx
      ON collection_books(collection_id, book_id) WHERE deleted_at IS NULL;

      CREATE TABLE saved_filters (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        definition_version INTEGER NOT NULL DEFAULT 1,
        definition_json TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );
    `
  },
  {
    version: 4,
    name: 'chapter-safety-and-writing-history',
    sql: `
      ALTER TABLE chapters ADD COLUMN deleted_at TEXT;
      ALTER TABLE chapters ADD COLUMN trashed_from_position INTEGER;
      ALTER TABLE chapters ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1
        CHECK(row_version >= 1);

      CREATE TABLE chapter_revisions (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
        title TEXT NOT NULL,
        content_blob BLOB NOT NULL,
        encoding TEXT NOT NULL DEFAULT 'gzip-utf8',
        content_hash TEXT NOT NULL,
        word_count INTEGER NOT NULL CHECK(word_count >= 0),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        device_id TEXT,
        UNIQUE(chapter_id, revision_number),
        UNIQUE(chapter_id, content_hash)
      );

      CREATE TABLE writing_goals (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
        metric TEXT NOT NULL CHECK(metric IN ('words', 'minutes', 'chapters')),
        period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly', 'project')),
        target_value INTEGER NOT NULL CHECK(target_value > 0),
        start_on TEXT NOT NULL,
        end_on TEXT,
        timezone TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE TABLE writing_events (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
        occurred_at TEXT NOT NULL,
        local_day TEXT NOT NULL,
        timezone TEXT NOT NULL,
        words_added INTEGER NOT NULL DEFAULT 0 CHECK(words_added >= 0),
        words_removed INTEGER NOT NULL DEFAULT 0 CHECK(words_removed >= 0),
        word_count_after INTEGER NOT NULL DEFAULT 0 CHECK(word_count_after >= 0),
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );
      CREATE INDEX writing_events_library_day_idx
      ON writing_events(library_id, local_day, occurred_at);
    `
  },
  {
    version: 5,
    name: 'anchors-annotations-and-story-bible',
    sql: `
      CREATE TABLE chapter_anchors (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        start_offset INTEGER,
        end_offset INTEGER,
        fallback_location REAL NOT NULL CHECK(fallback_location BETWEEN 0 AND 1),
        quote TEXT NOT NULL DEFAULT '',
        prefix TEXT NOT NULL DEFAULT '',
        suffix TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        resolution_status TEXT NOT NULL DEFAULT 'approximate'
          CHECK(resolution_status IN ('resolved', 'approximate', 'unresolved')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      ALTER TABLE bookmarks ADD COLUMN anchor_id TEXT REFERENCES chapter_anchors(id);
      ALTER TABLE bookmarks ADD COLUMN label TEXT NOT NULL DEFAULT '';
      ALTER TABLE bookmarks ADD COLUMN color TEXT NOT NULL DEFAULT 'gold';
      ALTER TABLE bookmarks ADD COLUMN updated_at TEXT;
      ALTER TABLE bookmarks ADD COLUMN deleted_at TEXT;
      ALTER TABLE bookmarks ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1
        CHECK(row_version >= 1);

      INSERT INTO chapter_anchors (
        id, chapter_id, fallback_location, created_at, updated_at
      ) SELECT id, chapter_id, location, created_at, created_at FROM bookmarks;
      UPDATE bookmarks SET anchor_id = id, updated_at = created_at;

      CREATE TABLE annotations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        anchor_id TEXT NOT NULL REFERENCES chapter_anchors(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('highlight', 'note')),
        body TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'gold',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE TABLE story_entities (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        summary TEXT NOT NULL DEFAULT '',
        body_markdown TEXT NOT NULL DEFAULT '',
        details_version INTEGER NOT NULL DEFAULT 1,
        details_json TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE TABLE story_entity_relations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        from_entity_id TEXT NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
        to_entity_id TEXT NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE TABLE story_entity_chapters (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
      );

      CREATE VIRTUAL TABLE story_entity_search USING fts5(
        entity_id UNINDEXED,
        book_id UNINDEXED,
        title,
        summary,
        body_markdown,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER story_entities_search_insert AFTER INSERT ON story_entities BEGIN
        INSERT INTO story_entity_search(entity_id, book_id, title, summary, body_markdown)
        VALUES (new.id, new.book_id, new.title, new.summary, new.body_markdown);
      END;
      CREATE TRIGGER story_entities_search_update
      AFTER UPDATE OF title, summary, body_markdown, book_id ON story_entities BEGIN
        DELETE FROM story_entity_search WHERE entity_id = old.id;
        INSERT INTO story_entity_search(entity_id, book_id, title, summary, body_markdown)
        VALUES (new.id, new.book_id, new.title, new.summary, new.body_markdown);
      END;
      CREATE TRIGGER story_entities_search_delete AFTER DELETE ON story_entities BEGIN
        DELETE FROM story_entity_search WHERE entity_id = old.id;
      END;
    `
  },
  {
    version: 6,
    name: 'backup-and-sync-foundation',
    sql: `
      CREATE TABLE backup_plans (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        library_id TEXT REFERENCES libraries(id),
        destination_path TEXT NOT NULL,
        security_bookmark TEXT,
        cadence TEXT NOT NULL CHECK(cadence IN ('daily', 'weekly', 'monthly')),
        retention_count INTEGER NOT NULL DEFAULT 7 CHECK(retention_count BETWEEN 1 AND 100),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE backup_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES backup_plans(id) ON DELETE CASCADE,
        library_id TEXT REFERENCES libraries(id),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        output_path TEXT,
        byte_size INTEGER CHECK(byte_size IS NULL OR byte_size >= 0),
        sha256 TEXT,
        verified_at TEXT,
        app_version TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE sync_profiles (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        provider TEXT NOT NULL,
        remote_library_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        last_pull_cursor TEXT,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sync_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
        row_version INTEGER NOT NULL CHECK(row_version >= 1),
        payload_hash TEXT NOT NULL,
        device_id TEXT REFERENCES devices(id),
        changed_at TEXT NOT NULL
      );

      CREATE TABLE sync_entity_state (
        library_id TEXT NOT NULL REFERENCES libraries(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        remote_revision TEXT,
        remote_etag TEXT,
        dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0, 1)),
        conflict_state TEXT NOT NULL DEFAULT 'none',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(library_id, entity_type, entity_id)
      );

      CREATE TABLE sync_conflicts (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        base_json TEXT NOT NULL,
        local_json TEXT NOT NULL,
        remote_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'ignored')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE sync_tombstones (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        device_id TEXT REFERENCES devices(id),
        acknowledged_at TEXT
      );
    `
  },
  {
    version: 7,
    name: 'book-series-metadata',
    sql: `
      ALTER TABLE books ADD COLUMN series_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN series_position REAL
        CHECK(series_position IS NULL OR series_position > 0);
      CREATE INDEX books_series_idx
      ON books(series_name COLLATE NOCASE, series_position, title COLLATE NOCASE);
    `
  },
  {
    version: 8,
    name: 'cover-studio',
    sql: `
      ALTER TABLE books ADD COLUMN cover_style TEXT NOT NULL DEFAULT 'classic'
        CHECK(cover_style IN ('classic', 'moonlit', 'forest', 'ember', 'ocean', 'rose'));
      ALTER TABLE books ADD COLUMN cover_position_x INTEGER NOT NULL DEFAULT 50
        CHECK(cover_position_x BETWEEN 0 AND 100);
      ALTER TABLE books ADD COLUMN cover_position_y INTEGER NOT NULL DEFAULT 50
        CHECK(cover_position_y BETWEEN 0 AND 100);
    `
  },
  {
    version: 9,
    name: 'first-run-guidance',
    sql: `
      ALTER TABLE application_settings ADD COLUMN has_seen_getting_started INTEGER NOT NULL DEFAULT 0
        CHECK(has_seen_getting_started IN (0, 1));
    `
  }
]

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0

function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

function hasMigrationLedger(database: Database.Database): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .pluck()
      .get()
  )
}

function verifyMigrationLedger(database: Database.Database, currentVersion: number): void {
  const expectedMigrations = migrations.filter((migration) => migration.version <= currentVersion)
  if (!hasMigrationLedger(database)) {
    if (currentVersion >= 2) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        'The library migration history is incomplete and cannot be verified safely.'
      )
    }
    return
  }
  const rows = database
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; name: string; checksum: string }>

  if (rows.length !== expectedMigrations.length) {
    throw new StoryboundError(
      'DATABASE_ERROR',
      'The library migration history is incomplete and cannot be verified safely.'
    )
  }

  for (const [index, row] of rows.entries()) {
    const migration = expectedMigrations[index]
    if (
      !migration ||
      migration.version !== row.version ||
      migration.name !== row.name ||
      migrationChecksum(migration) !== row.checksum
    ) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        'The library migration history does not match this version of Storybound.'
      )
    }
  }
}

export function createStoryboundPaths(userDataPath: string): StoryboundPaths {
  const root = resolve(userDataPath)
  return {
    root,
    database: join(root, 'storybound.sqlite'),
    media: join(root, 'media'),
    backups: join(root, 'backups'),
    logs: join(root, 'logs')
  }
}

export function ensureStoryboundDirectories(paths: StoryboundPaths): void {
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.media, { recursive: true })
  mkdirSync(paths.backups, { recursive: true })
  mkdirSync(paths.logs, { recursive: true })
}

export function configureDatabase(database: Database.Database): void {
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = FULL')
  database.pragma('busy_timeout = 5000')
}

export async function migrateDatabase(
  database: Database.Database,
  paths: StoryboundPaths
): Promise<void> {
  const currentVersion = Number(database.pragma('user_version', { simple: true }))
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new StoryboundError(
      'DATABASE_ERROR',
      'This library was created by a newer version of Storybound and cannot be opened safely.'
    )
  }
  verifyMigrationLedger(database, currentVersion)

  const pending = migrations.filter((migration) => migration.version > currentVersion)
  if (pending.length === 0) return

  if (currentVersion > 0 && existsSync(paths.database)) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const backupPath = join(paths.backups, `before-migration-v${currentVersion}-${stamp}.sqlite`)
    try {
      await database.backup(backupPath)
    } catch (error) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        'Storybound could not create a safety copy before updating the library.',
        error
      )
    }
  }

  for (const migration of pending) {
    const apply = database.transaction(() => {
      database.exec(migration.sql)
      if (hasMigrationLedger(database)) {
        const record = database.prepare(
          `INSERT OR IGNORE INTO schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`
        )
        for (const applied of migrations.filter(
          (candidate) => candidate.version <= migration.version
        )) {
          record.run(
            applied.version,
            applied.name,
            migrationChecksum(applied),
            new Date().toISOString()
          )
        }
      }
      database.pragma(`user_version = ${migration.version}`)
    })

    try {
      apply()
    } catch (error) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        `Storybound could not update the library database (${migration.name}).`,
        error
      )
    }
  }
  verifyMigrationLedger(database, LATEST_SCHEMA_VERSION)
}

export async function openStoryboundDatabase(paths: StoryboundPaths): Promise<Database.Database> {
  ensureStoryboundDirectories(paths)
  let database: Database.Database
  try {
    database = new Database(paths.database)
    configureDatabase(database)
  } catch (error) {
    throw new StoryboundError(
      'DATABASE_ERROR',
      `Storybound could not open its local library at ${basename(paths.database)}.`,
      error
    )
  }

  try {
    await migrateDatabase(database, paths)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export function copyDatabaseSnapshot(source: string, destination: string): void {
  try {
    copyFileSync(source, destination)
  } catch (error) {
    throw new StoryboundError('FILE_ERROR', 'The database safety copy could not be created.', error)
  }
}
