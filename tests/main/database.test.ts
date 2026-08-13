import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createStoryboundPaths,
  ensureStoryboundDirectories,
  LATEST_SCHEMA_VERSION,
  migrations,
  openStoryboundDatabase
} from '../../src/main/database'

const temporaryDirectories: string[] = []
const openDatabases: Database.Database[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-database-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function track(database: Database.Database): Database.Database {
  openDatabases.push(database)
  return database
}

function closeDatabase(database: Database.Database): void {
  database.close()
  const index = openDatabases.indexOf(database)
  if (index >= 0) openDatabases.splice(index, 1)
}

function tableColumns(database: Database.Database, table: string): string[] {
  return (database.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
    (column) => column.name
  )
}

function expectedMigrationRows(): Array<{ version: number; name: string; checksum: string }> {
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: createHash('sha256').update(migration.sql).digest('hex')
  }))
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Storybound database migrations', () => {
  it('creates the current schema with a verifiable ledger and library invariant', async () => {
    const paths = createStoryboundPaths(temporaryDirectory())
    const database = track(await openStoryboundDatabase(paths))

    expect(database.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(
      database
        .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
        .all()
    ).toEqual(expectedMigrationRows())

    expect(database.prepare('SELECT id, name FROM libraries').get()).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Storybound Library'
    })
    expect(
      database.prepare('SELECT active_library_id FROM app_state WHERE id = 1').pluck().get()
    ).toBe('00000000-0000-4000-8000-000000000001')

    const tableNames = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .pluck()
      .all() as string[]
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'libraries',
        'app_state',
        'book_libraries',
        'media_assets',
        'tags',
        'book_tags',
        'collections',
        'collection_books',
        'saved_filters',
        'chapter_revisions',
        'writing_goals',
        'writing_events',
        'chapter_anchors',
        'annotations',
        'story_entities',
        'story_entity_relations',
        'story_entity_chapters',
        'story_entity_search',
        'backup_plans',
        'backup_runs',
        'devices',
        'sync_profiles',
        'sync_outbox',
        'sync_entity_state',
        'sync_conflicts',
        'sync_tombstones'
      ])
    )

    expect(tableColumns(database, 'books')).toEqual(
      expect.arrayContaining([
        'row_version',
        'cover_asset_id',
        'subtitle',
        'series_name',
        'series_position',
        'author_name',
        'language_code',
        'source_label',
        'source_url',
        'personal_notes',
        'rating',
        'favourited_at',
        'pinned_at',
        'cover_style',
        'cover_position_x',
        'cover_position_y'
      ])
    )
    expect(tableColumns(database, 'chapters')).toEqual(
      expect.arrayContaining(['deleted_at', 'trashed_from_position', 'row_version'])
    )
    expect(tableColumns(database, 'reading_states')).toEqual(
      expect.arrayContaining(['updated_at', 'row_version', 'device_id'])
    )
    expect(tableColumns(database, 'sync_outbox')).toEqual(
      expect.arrayContaining([
        'mutation_id',
        'base_remote_revision',
        'change_set_id',
        'payload_ciphertext',
        'payload_nonce',
        'payload_encoding',
        'payload_key_version',
        'payload_schema_version',
        'state',
        'attempt_count',
        'next_attempt_at',
        'sending_started_at',
        'last_error',
        'enqueued_at'
      ])
    )
    expect(tableColumns(database, 'sync_entity_state')).toEqual(
      expect.arrayContaining([
        'base_remote_revision',
        'base_payload_hash',
        'base_payload',
        'base_payload_nonce',
        'base_payload_encoding',
        'base_payload_key_version',
        'base_payload_schema_version',
        'local_row_version',
        'last_pulled_at'
      ])
    )
    expect(tableColumns(database, 'sync_conflicts')).toEqual(
      expect.arrayContaining([
        'conflict_kind',
        'base_remote_revision',
        'local_row_version',
        'remote_revision',
        'base_payload',
        'local_payload',
        'remote_payload',
        'payload_encoding',
        'resolution',
        'updated_at'
      ])
    )
    expect(tableColumns(database, 'sync_tombstones')).toEqual(
      expect.arrayContaining([
        'mutation_id',
        'row_version',
        'remote_revision',
        'payload_hash',
        'retained_until'
      ])
    )
    expect(tableColumns(database, 'bookmarks')).toEqual(
      expect.arrayContaining([
        'anchor_id',
        'label',
        'color',
        'updated_at',
        'deleted_at',
        'row_version'
      ])
    )
    expect(tableColumns(database, 'application_settings')).toContain('has_seen_getting_started')

    const indexNames = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index'")
      .pluck()
      .all() as string[]
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'book_libraries_library_idx',
        'tags_active_name_idx',
        'book_tags_active_idx',
        'collection_books_active_idx',
        'writing_events_library_day_idx',
        'books_series_idx',
        'sync_outbox_ready_idx',
        'sync_outbox_entity_idx',
        'sync_outbox_change_set_idx',
        'sync_entity_state_dirty_idx',
        'sync_conflicts_open_idx',
        'sync_tombstones_pending_idx',
        'sync_profiles_enabled_idx'
      ])
    )

    database
      .prepare(
        `INSERT INTO books (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('trigger-book', 'Trigger Book', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z')
    expect(
      database
        .prepare('SELECT book_id, library_id FROM book_libraries WHERE book_id = ?')
        .get('trigger-book')
    ).toEqual({
      book_id: 'trigger-book',
      library_id: '00000000-0000-4000-8000-000000000001'
    })
    database
      .prepare(
        `INSERT INTO chapters (id, book_id, title, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'trigger-chapter',
        'trigger-book',
        'Chapter One',
        'Text',
        0,
        '2026-08-05T10:00:00.000Z',
        '2026-08-05T10:00:00.000Z'
      )
    database
      .prepare(
        `INSERT INTO reading_states (
           book_id, chapter_id, scroll_position, progress_percentage, updated_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run('trigger-book', 'trigger-chapter', 0.2, 20, '2026-08-05T10:00:00.000Z')
    database
      .prepare(
        'UPDATE reading_states SET scroll_position = ?, progress_percentage = ? WHERE book_id = ?'
      )
      .run(0.3, 30, 'trigger-book')
    expect(
      database
        .prepare(
          'SELECT scroll_position, progress_percentage, updated_at, row_version FROM reading_states'
        )
        .get()
    ).toEqual({
      scroll_position: 0.3,
      progress_percentage: 30,
      updated_at: expect.not.stringMatching(/^2026-08-05T10:00:00.000Z$/),
      row_version: 2
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades v1, backfills relationships and anchors, and keeps a safety copy', async () => {
    const paths = createStoryboundPaths(temporaryDirectory())
    ensureStoryboundDirectories(paths)
    const legacyDatabase = new Database(paths.database)
    legacyDatabase.exec(migrations[0].sql)
    legacyDatabase.pragma('user_version = 1')
    legacyDatabase
      .prepare(
        `INSERT INTO books (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('legacy-book', 'Legacy Book', '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z')
    legacyDatabase
      .prepare(
        `INSERT INTO chapters (
           id, book_id, title, content, position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'legacy-chapter',
        'legacy-book',
        'Legacy Chapter',
        'A surviving chapter.',
        0,
        '2025-01-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z'
      )
    legacyDatabase
      .prepare(
        `INSERT INTO bookmarks (
           id, book_id, chapter_id, location, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'legacy-bookmark',
        'legacy-book',
        'legacy-chapter',
        0.4,
        'Remember this',
        '2025-01-02T00:00:00.000Z'
      )
    legacyDatabase.close()

    const database = track(await openStoryboundDatabase(paths))
    expect(database.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(
      database
        .prepare('SELECT library_id FROM book_libraries WHERE book_id = ?')
        .pluck()
        .get('legacy-book')
    ).toBe('00000000-0000-4000-8000-000000000001')
    expect(
      database
        .prepare(
          `SELECT b.anchor_id, a.chapter_id, a.fallback_location, a.quote
           FROM bookmarks b
           JOIN chapter_anchors a ON a.id = b.anchor_id
           WHERE b.id = ?`
        )
        .get('legacy-bookmark')
    ).toEqual({
      anchor_id: 'legacy-bookmark',
      chapter_id: 'legacy-chapter',
      fallback_location: 0.4,
      quote: ''
    })
    expect(
      database
        .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
        .all()
    ).toEqual(expectedMigrationRows())
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(
      readdirSync(paths.backups).filter((name) => name.startsWith('before-migration-v1-'))
    ).toHaveLength(1)
  })

  it('upgrades v9 sync bookkeeping without losing pending work or reading progress', async () => {
    const paths = createStoryboundPaths(temporaryDirectory())
    ensureStoryboundDirectories(paths)
    const legacyDatabase = new Database(paths.database)
    const legacyMigrations = migrations.filter((candidate) => candidate.version <= 9)
    for (const migration of legacyMigrations) legacyDatabase.exec(migration.sql)

    const appliedAt = '2026-08-06T12:00:00.000Z'
    const recordMigration = legacyDatabase.prepare(
      `INSERT INTO schema_migrations (version, name, checksum, applied_at)
       VALUES (?, ?, ?, ?)`
    )
    for (const migration of legacyMigrations) {
      recordMigration.run(
        migration.version,
        migration.name,
        createHash('sha256').update(migration.sql).digest('hex'),
        appliedAt
      )
    }
    legacyDatabase.pragma('user_version = 9')
    legacyDatabase
      .prepare(
        'INSERT INTO devices (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)'
      )
      .run('device-a', 'Mac', appliedAt, appliedAt)
    legacyDatabase
      .prepare('INSERT INTO books (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('book-a', 'Migrating Book', appliedAt, appliedAt)
    legacyDatabase
      .prepare(
        `INSERT INTO chapters (id, book_id, title, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('chapter-a', 'book-a', 'Chapter One', 'Text', 0, appliedAt, appliedAt)
    legacyDatabase
      .prepare(
        `INSERT INTO reading_states (
           book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
           has_finished_current_content
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('book-a', 'chapter-a', 0.4, 40, appliedAt, 0)
    legacyDatabase
      .prepare(
        `INSERT INTO sync_outbox (
           library_id, entity_type, entity_id, operation, row_version, payload_hash,
           device_id, changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '00000000-0000-4000-8000-000000000001',
        'chapter',
        'chapter-a',
        'upsert',
        2,
        'legacy-hash',
        'device-a',
        appliedAt
      )
    legacyDatabase
      .prepare(
        `INSERT INTO sync_entity_state (
           library_id, entity_type, entity_id, remote_revision, remote_etag, dirty,
           conflict_state, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '00000000-0000-4000-8000-000000000001',
        'chapter',
        'chapter-a',
        'revision-4',
        'etag-4',
        1,
        'manual-review',
        appliedAt
      )
    legacyDatabase
      .prepare(
        `INSERT INTO sync_conflicts (
           id, library_id, entity_type, entity_id, base_json, local_json, remote_json,
           status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'conflict-a',
        '00000000-0000-4000-8000-000000000001',
        'chapter',
        'chapter-a',
        '{"content":"base"}',
        '{"content":"local"}',
        '{"content":"remote"}',
        'open',
        appliedAt
      )
    const insertTombstone = legacyDatabase.prepare(
      `INSERT INTO sync_tombstones (
         id, library_id, entity_type, entity_id, deleted_at, device_id, acknowledged_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insertTombstone.run(
      'tombstone-old',
      '00000000-0000-4000-8000-000000000001',
      'bookmark',
      'bookmark-a',
      '2026-08-05T12:00:00.000Z',
      'device-a',
      null
    )
    insertTombstone.run(
      'tombstone-new',
      '00000000-0000-4000-8000-000000000001',
      'bookmark',
      'bookmark-a',
      appliedAt,
      'device-a',
      null
    )
    legacyDatabase.close()

    const database = track(await openStoryboundDatabase(paths))
    expect(database.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(
      database
        .prepare(
          `SELECT chapter_id, scroll_position, progress_percentage, updated_at, row_version,
                  device_id
           FROM reading_states WHERE book_id = ?`
        )
        .get('book-a')
    ).toEqual({
      chapter_id: 'chapter-a',
      scroll_position: 0.4,
      progress_percentage: 40,
      updated_at: appliedAt,
      row_version: 1,
      device_id: null
    })
    const pending = database
      .prepare(
        `SELECT mutation_id, base_remote_revision, change_set_id, row_version,
                CAST(payload_ciphertext AS TEXT) AS payload_ciphertext,
                CAST(payload_nonce AS TEXT) AS payload_nonce, payload_encoding, state,
                attempt_count, next_attempt_at, sending_started_at, last_error, enqueued_at
         FROM sync_outbox`
      )
      .get() as Record<string, unknown>
    expect(pending).toMatchObject({
      base_remote_revision: null,
      change_set_id: null,
      row_version: 2,
      payload_ciphertext: '',
      payload_nonce: '',
      payload_encoding: 'legacy-hash-v0',
      state: 'queued',
      attempt_count: 0,
      next_attempt_at: null,
      sending_started_at: null,
      last_error: null,
      enqueued_at: appliedAt
    })
    expect(pending.mutation_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
    expect(
      database
        .prepare(
          `SELECT base_remote_revision, remote_revision, dirty, conflict_state
           FROM sync_entity_state`
        )
        .get()
    ).toEqual({
      base_remote_revision: 'revision-4',
      remote_revision: 'revision-4',
      dirty: 1,
      conflict_state: 'open'
    })
    expect(
      database
        .prepare(
          `SELECT conflict_kind, CAST(base_payload AS TEXT) AS base_payload,
                  CAST(local_payload AS TEXT) AS local_payload,
                  CAST(remote_payload AS TEXT) AS remote_payload, payload_encoding, updated_at
           FROM sync_conflicts WHERE id = ?`
        )
        .get('conflict-a')
    ).toEqual({
      conflict_kind: 'unknown',
      base_payload: '{"content":"base"}',
      local_payload: '{"content":"local"}',
      remote_payload: '{"content":"remote"}',
      payload_encoding: 'canonical-json-v1',
      updated_at: appliedAt
    })
    expect(
      database.prepare('SELECT id, row_version, remote_revision FROM sync_tombstones').all()
    ).toEqual([{ id: 'tombstone-new', row_version: 1, remote_revision: null }])
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('rejects a current database whose migration ledger is incomplete', async () => {
    const paths = createStoryboundPaths(temporaryDirectory())
    const database = track(await openStoryboundDatabase(paths))
    database.prepare('DELETE FROM schema_migrations WHERE version = ?').run(3)
    closeDatabase(database)

    await expect(openStoryboundDatabase(paths)).rejects.toThrow('migration history is incomplete')
  })
})
