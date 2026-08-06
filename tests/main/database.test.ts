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
        'books_series_idx'
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

  it('rejects a current database whose migration ledger is incomplete', async () => {
    const paths = createStoryboundPaths(temporaryDirectory())
    const database = track(await openStoryboundDatabase(paths))
    database.prepare('DELETE FROM schema_migrations WHERE version = ?').run(3)
    closeDatabase(database)

    await expect(openStoryboundDatabase(paths)).rejects.toThrow('migration history is incomplete')
  })
})
