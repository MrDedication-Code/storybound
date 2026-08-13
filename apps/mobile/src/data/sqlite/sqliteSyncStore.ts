import type { SyncRuntimeStatus } from '@storybound/contracts'
import type { SqlDatabasePort, SqlWriteCoordinator } from './databasePort'
import { normalizeRemoteEntity } from '../../sync/entityMapping'
import type { RpcPushResult, RpcRemoteChange } from '../../sync/rpcContract'
import type { CoreSyncEntityType, CoreSyncOperation } from '../../sync/types'

export interface MobileSyncProfile {
  vaultId: string
  deviceId: string
  localLibraryId: string
  lastPullCursor: string | null
  lastSyncAt: string | null
  lastError: string | null
}

export interface PendingSyncChange {
  mutationId: string
  entityType: CoreSyncEntityType
  entityId: string
  operation: CoreSyncOperation
  baseRemoteRevision: string | null
  rowVersion: number
  changedAt: string
  value: unknown
}

export interface DecryptedRemoteChange extends RpcRemoteChange {
  value: unknown
}

interface ChangeRow {
  entity_type: CoreSyncEntityType
  entity_id: string
  operation: CoreSyncOperation
  changed_at: string
  row_version: number
  base_remote_revision: string | null
  mutation_id: string | null
}

interface ProfileRow {
  vault_id: string
  device_id: string
  local_library_id: string
  last_pull_cursor: string | null
  last_sync_at: string | null
  last_error: string | null
}

function profileFromRow(row: ProfileRow): MobileSyncProfile {
  return {
    vaultId: row.vault_id,
    deviceId: row.device_id,
    localLibraryId: row.local_library_id,
    lastPullCursor: row.last_pull_cursor,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error
  }
}

function requiredValue(
  values: Record<string, string | number | null>,
  key: string
): string | number {
  const value = values[key]
  if (value === null || value === undefined) throw new Error(`The synced ${key} is missing.`)
  return value
}

function deletionValue(value: unknown): { deletedAt: string; rowVersion: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The decrypted deletion record is invalid.')
  }
  const row = value as Record<string, unknown>
  if (typeof row.deletedAt !== 'string' || !row.deletedAt) {
    throw new Error('The synced deletion date is invalid.')
  }
  if (
    typeof row.rowVersion !== 'number' ||
    !Number.isInteger(row.rowVersion) ||
    row.rowVersion < 1
  ) {
    throw new Error('The synced deletion version is invalid.')
  }
  return { deletedAt: row.deletedAt, rowVersion: row.rowVersion }
}

export class SQLiteSyncStore {
  constructor(
    private readonly database: SqlDatabasePort,
    private readonly writes: SqlWriteCoordinator,
    private readonly now: () => Date = () => new Date()
  ) {}

  async profile(): Promise<MobileSyncProfile | null> {
    const row = await this.database.getFirstAsync<ProfileRow>(
      `SELECT vault_id, device_id, local_library_id, last_pull_cursor, last_sync_at, last_error
       FROM mobile_sync_profiles WHERE id = 1`
    )
    return row ? profileFromRow(row) : null
  }

  async localStatus(
    base: Omit<SyncRuntimeStatus, 'pendingChanges' | 'openConflicts'>
  ): Promise<SyncRuntimeStatus> {
    const [pending, conflicts] = await Promise.all([
      this.database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM change_records'
      ),
      this.database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_conflicts')
    ])
    return {
      ...base,
      pendingChanges: pending?.count ?? 0,
      openConflicts: conflicts?.count ?? 0
    }
  }

  activateProfile(vaultId: string, deviceId: string): Promise<MobileSyncProfile> {
    return this.writes.run(async () => {
      let profile: MobileSyncProfile | null = null
      await this.database.transactionAsync(async (transaction) => {
        const library = await transaction.getFirstAsync<{ id: string }>(
          `SELECT id FROM libraries WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1`
        )
        if (!library) throw new Error('Create a local library before enabling sync.')
        const changedAt = this.now().toISOString()
        await transaction.runAsync(
          `INSERT INTO mobile_sync_profiles (
             id, vault_id, device_id, local_library_id, last_pull_cursor,
             last_sync_at, last_error, updated_at
           ) VALUES (1, ?, ?, ?, NULL, NULL, NULL, ?)
           ON CONFLICT (id) DO UPDATE SET
             vault_id = excluded.vault_id,
             device_id = excluded.device_id,
             local_library_id = CASE
               WHEN mobile_sync_profiles.vault_id = excluded.vault_id
               THEN mobile_sync_profiles.local_library_id
               ELSE excluded.local_library_id
             END,
             last_pull_cursor = CASE
               WHEN mobile_sync_profiles.vault_id = excluded.vault_id
               THEN mobile_sync_profiles.last_pull_cursor
               ELSE NULL
             END,
             last_sync_at = CASE
               WHEN mobile_sync_profiles.vault_id = excluded.vault_id
               THEN mobile_sync_profiles.last_sync_at
               ELSE NULL
             END,
             last_error = NULL,
             updated_at = excluded.updated_at`,
          [vaultId, deviceId, library.id, changedAt]
        )
        const row = await transaction.getFirstAsync<ProfileRow>(
          `SELECT vault_id, device_id, local_library_id, last_pull_cursor, last_sync_at, last_error
           FROM mobile_sync_profiles WHERE id = 1`
        )
        if (!row) throw new Error('The local sync profile did not save.')
        profile = profileFromRow(row)
      })
      if (!profile) throw new Error('The local sync profile did not save.')
      return profile
    })
  }

  queueAllLocalEntities(): Promise<void> {
    return this.writes.run(async () => {
      await this.database.transactionAsync(async (transaction) => {
        const profile = await this.requireProfile(transaction)
        const entities = [
          ...(await transaction.getAllAsync<{
            entity_type: CoreSyncEntityType
            entity_id: string
            row_version: number
            changed_at: string
          }>(
            `SELECT 'library' AS entity_type, id AS entity_id, row_version, updated_at AS changed_at
             FROM libraries WHERE id = ? AND deleted_at IS NULL`,
            [profile.localLibraryId]
          )),
          ...(await transaction.getAllAsync<{
            entity_type: CoreSyncEntityType
            entity_id: string
            row_version: number
            changed_at: string
          }>(
            `SELECT 'book' AS entity_type, id AS entity_id, row_version, updated_at AS changed_at
             FROM books WHERE library_id = ? AND deleted_at IS NULL`,
            [profile.localLibraryId]
          )),
          ...(await transaction.getAllAsync<{
            entity_type: CoreSyncEntityType
            entity_id: string
            row_version: number
            changed_at: string
          }>(
            `SELECT 'chapter' AS entity_type, c.id AS entity_id, c.row_version, c.updated_at AS changed_at
             FROM chapters c JOIN books b ON b.id = c.book_id
             WHERE b.library_id = ? AND c.deleted_at IS NULL`,
            [profile.localLibraryId]
          )),
          ...(await transaction.getAllAsync<{
            entity_type: CoreSyncEntityType
            entity_id: string
            row_version: number
            changed_at: string
          }>(
            `SELECT 'reading-state' AS entity_type, r.book_id AS entity_id, r.row_version,
                    r.updated_at AS changed_at
             FROM reading_states r JOIN books b ON b.id = r.book_id
             WHERE b.library_id = ?`,
            [profile.localLibraryId]
          ))
        ]
        for (const entity of entities) {
          await this.upsertPending(transaction, entity, 'upsert')
        }
      })
    })
  }

  claimPendingChanges(createMutationId: () => string, limit = 100): Promise<PendingSyncChange[]> {
    return this.writes.run(async () => {
      let claimed: PendingSyncChange[] = []
      await this.database.transactionAsync(async (transaction) => {
        const rows = await transaction.getAllAsync<ChangeRow>(
          `SELECT entity_type, entity_id, operation, changed_at, row_version,
                  base_remote_revision, mutation_id
           FROM change_records AS pending
           WHERE NOT EXISTS (
             SELECT 1 FROM sync_conflicts AS conflict
             WHERE conflict.entity_type = pending.entity_type
               AND conflict.entity_id = pending.entity_id
           )
           ORDER BY
             CASE pending.entity_type
               WHEN 'library' THEN 0
               WHEN 'book' THEN 1
               WHEN 'chapter' THEN 2
               ELSE 3
             END,
             pending.changed_at,
             pending.entity_id
           LIMIT ?`,
          [limit]
        )
        for (const row of rows) {
          if (!row.mutation_id) {
            row.mutation_id = createMutationId()
            await transaction.runAsync(
              `UPDATE change_records SET mutation_id = ?
               WHERE entity_type = ? AND entity_id = ? AND mutation_id IS NULL`,
              [row.mutation_id, row.entity_type, row.entity_id]
            )
          }
        }
        claimed = []
        for (const row of rows) {
          if (!row.mutation_id) throw new Error('A pending sync mutation has no identifier.')
          claimed.push({
            mutationId: row.mutation_id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            operation: row.operation,
            baseRemoteRevision: row.base_remote_revision,
            rowVersion: row.row_version,
            changedAt: row.changed_at,
            value:
              row.operation === 'delete'
                ? { deletedAt: row.changed_at, rowVersion: row.row_version }
                : await this.readEntity(transaction, row.entity_type, row.entity_id)
          })
        }
      })
      return claimed
    })
  }

  acknowledgePush(
    results: readonly RpcPushResult[],
    sentChanges: readonly PendingSyncChange[]
  ): Promise<{ accepted: number; conflicts: number }> {
    return this.writes.run(async () => {
      let accepted = 0
      let conflicts = 0
      await this.database.transactionAsync(async (transaction) => {
        const changedAt = this.now().toISOString()
        for (const result of results) {
          const sent = sentChanges.find((change) => change.mutationId === result.mutationId)
          if (!sent) throw new Error('The sync server returned an unknown mutation result.')
          if (result.status === 'accepted') {
            await transaction.runAsync('DELETE FROM change_records WHERE mutation_id = ?', [
              result.mutationId
            ])
            await transaction.runAsync(
              `UPDATE change_records SET base_remote_revision = ?
               WHERE entity_type = ? AND entity_id = ?`,
              [result.remoteRevision, sent.entityType, sent.entityId]
            )
            await this.saveEntityState(
              transaction,
              sent.entityType,
              sent.entityId,
              result.remoteRevision,
              sent.rowVersion,
              changedAt
            )
            await transaction.runAsync(
              `DELETE FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?`,
              [sent.entityType, sent.entityId]
            )
            accepted += 1
          } else {
            await transaction.runAsync('DELETE FROM change_records WHERE mutation_id = ?', [
              result.mutationId
            ])
            await this.recordConflict(
              transaction,
              sent.entityType,
              sent.entityId,
              sent.mutationId,
              result.remoteMutationId,
              result.remoteRevision,
              'The server has a newer version of this record.',
              changedAt
            )
            conflicts += 1
          }
        }
      })
      return { accepted, conflicts }
    })
  }

  applyPullPage(
    expectedCursor: string | null,
    nextCursor: string,
    deviceId: string,
    changes: readonly DecryptedRemoteChange[]
  ): Promise<number> {
    return this.writes.run(async () => {
      let applied = 0
      await this.database.transactionAsync(async (transaction) => {
        const profile = await this.requireProfile(transaction)
        if (profile.lastPullCursor !== expectedCursor) {
          throw new Error('The local sync cursor changed during download.')
        }
        const syncedAt = this.now().toISOString()
        const orderedChanges = [...changes].sort((left, right) => {
          const leftPriority = left.entityType === 'library' && left.operation === 'upsert' ? 0 : 1
          const rightPriority =
            right.entityType === 'library' && right.operation === 'upsert' ? 0 : 1
          return leftPriority - rightPriority
        })
        for (const change of orderedChanges) {
          const state = await transaction.getFirstAsync<{ remote_revision: string | null }>(
            `SELECT remote_revision FROM sync_entity_state
             WHERE entity_type = ? AND entity_id = ?`,
            [change.entityType, change.entityId]
          )
          if (state?.remote_revision === change.remoteRevision) continue
          const pending = await transaction.getFirstAsync<ChangeRow>(
            `SELECT entity_type, entity_id, operation, changed_at, row_version,
                    base_remote_revision, mutation_id
             FROM change_records WHERE entity_type = ? AND entity_id = ?`,
            [change.entityType, change.entityId]
          )
          if (pending) {
            if (pending.mutation_id === change.mutationId) {
              await transaction.runAsync('DELETE FROM change_records WHERE mutation_id = ?', [
                change.mutationId
              ])
            } else if (change.deviceId !== deviceId) {
              await this.recordConflict(
                transaction,
                change.entityType,
                change.entityId,
                pending.mutation_id,
                change.mutationId,
                change.remoteRevision,
                'A remote change arrived while this record has local edits.',
                syncedAt
              )
            } else {
              await transaction.runAsync(
                `UPDATE change_records SET base_remote_revision = ?
                 WHERE entity_type = ? AND entity_id = ?`,
                [change.remoteRevision, change.entityType, change.entityId]
              )
            }
          } else {
            await this.applyRemoteEntity(transaction, profile, change)
            if (change.entityType === 'library' && change.operation === 'upsert') {
              profile.localLibraryId = change.entityId
            }
            await transaction.runAsync(
              `DELETE FROM sync_conflicts WHERE entity_type = ? AND entity_id = ?`,
              [change.entityType, change.entityId]
            )
            applied += 1
          }
          await this.saveEntityState(
            transaction,
            change.entityType,
            change.entityId,
            change.remoteRevision,
            pending?.row_version ?? this.remoteRowVersion(change),
            syncedAt
          )
        }
        await transaction.runAsync(
          `UPDATE mobile_sync_profiles
           SET last_pull_cursor = ?, updated_at = ?, last_error = NULL WHERE id = 1`,
          [nextCursor, syncedAt]
        )
      })
      return applied
    })
  }

  finishSync(syncedAt: string): Promise<void> {
    return this.writes.run(async () => {
      await this.database.runAsync(
        `UPDATE mobile_sync_profiles
         SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = 1`,
        [syncedAt, syncedAt]
      )
    })
  }

  recordError(message: string): Promise<void> {
    return this.writes.run(async () => {
      await this.database.runAsync(
        `UPDATE mobile_sync_profiles SET last_error = ?, updated_at = ? WHERE id = 1`,
        [message.slice(0, 1000), this.now().toISOString()]
      )
    })
  }

  private async requireProfile(database: SqlDatabasePort): Promise<MobileSyncProfile> {
    const row = await database.getFirstAsync<ProfileRow>(
      `SELECT vault_id, device_id, local_library_id, last_pull_cursor, last_sync_at, last_error
       FROM mobile_sync_profiles WHERE id = 1`
    )
    if (!row) throw new Error('Encrypted sync has not been activated on this device.')
    return profileFromRow(row)
  }

  private async upsertPending(
    transaction: SqlDatabasePort,
    entity: {
      entity_type: CoreSyncEntityType
      entity_id: string
      row_version: number
      changed_at: string
    },
    operation: CoreSyncOperation
  ): Promise<void> {
    await transaction.runAsync(
      `INSERT INTO change_records (
         entity_type, entity_id, operation, changed_at, row_version,
         base_remote_revision, mutation_id
       ) VALUES (
         ?, ?, ?, ?, ?,
         (SELECT remote_revision FROM sync_entity_state WHERE entity_type = ? AND entity_id = ?),
         NULL
       )
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         operation = excluded.operation,
         changed_at = excluded.changed_at,
         row_version = excluded.row_version,
         mutation_id = NULL`,
      [
        entity.entity_type,
        entity.entity_id,
        operation,
        entity.changed_at,
        entity.row_version,
        entity.entity_type,
        entity.entity_id
      ]
    )
  }

  private async readEntity(
    database: SqlDatabasePort,
    entityType: CoreSyncEntityType,
    entityId: string
  ): Promise<Record<string, unknown>> {
    if (entityType === 'library') {
      const row = await database.getFirstAsync<Record<string, unknown>>(
        `SELECT id, name, description, created_at, updated_at, deleted_at, row_version
         FROM libraries WHERE id = ?`,
        [entityId]
      )
      if (row) return row
    } else if (entityType === 'book') {
      const row = await database.getFirstAsync<Record<string, unknown>>(
        `SELECT id, title, blurb, status, created_at, updated_at, last_opened_at,
                completed_at,
                (SELECT COALESCE(SUM(word_count), 0) FROM chapters
                 WHERE book_id = books.id AND deleted_at IS NULL) AS total_word_count,
                is_archived, deleted_at, row_version, subtitle, author_name,
                COALESCE(language_code, '') AS language_code,
                COALESCE(source_label, '') AS source_label,
                COALESCE(source_url, '') AS source_url,
                COALESCE(personal_notes, '') AS personal_notes,
                rating, favourited_at, pinned_at, COALESCE(series_name, '') AS series_name,
                series_position, cover_style, cover_position_x, cover_position_y
         FROM books WHERE id = ?`,
        [entityId]
      )
      if (row) return row
    } else if (entityType === 'chapter') {
      const row = await database.getFirstAsync<Record<string, unknown>>(
        `SELECT id, book_id, title, content, position, created_at, updated_at,
                word_count, deleted_at, trashed_from_position, row_version
         FROM chapters WHERE id = ?`,
        [entityId]
      )
      if (row) return row
    } else {
      const row = await database.getFirstAsync<Record<string, unknown>>(
        `SELECT book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
                has_finished_current_content, updated_at, row_version, device_id
         FROM reading_states WHERE book_id = ?`,
        [entityId]
      )
      if (row) return row
    }
    throw new Error('A pending sync record no longer exists.')
  }

  private async applyRemoteEntity(
    transaction: SqlDatabasePort,
    profile: MobileSyncProfile,
    change: DecryptedRemoteChange
  ): Promise<void> {
    if (change.operation === 'delete') {
      const deletion = deletionValue(change.value)
      if (change.entityType === 'reading-state') {
        await transaction.runAsync('DELETE FROM reading_states WHERE book_id = ?', [
          change.entityId
        ])
      } else {
        const table = { library: 'libraries', book: 'books', chapter: 'chapters' }[
          change.entityType
        ]
        await transaction.runAsync(
          `UPDATE ${table} SET deleted_at = ?, row_version = ? WHERE id = ?`,
          [deletion.deletedAt, deletion.rowVersion, change.entityId]
        )
      }
      return
    }

    const normalized = normalizeRemoteEntity(change.entityType, change.entityId, change.value)
    const value = normalized.values
    if (change.entityType === 'library') {
      await transaction.runAsync(
        `INSERT INTO libraries (
           id, name, description, created_at, updated_at, deleted_at, row_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, row_version = excluded.row_version`,
        [
          requiredValue(value, 'id'),
          requiredValue(value, 'name'),
          requiredValue(value, 'description'),
          requiredValue(value, 'created_at'),
          requiredValue(value, 'updated_at'),
          value.deleted_at,
          requiredValue(value, 'row_version')
        ]
      )
      await transaction.runAsync(
        `UPDATE mobile_sync_profiles SET local_library_id = ?, updated_at = ? WHERE id = 1`,
        [change.entityId, this.now().toISOString()]
      )
      return
    }

    if (change.entityType === 'book') {
      await transaction.runAsync(
        `INSERT INTO books (
           id, library_id, title, subtitle, author_name, blurb, status, cover_tone,
           position, created_at, updated_at, deleted_at, last_opened_at, completed_at,
           is_archived, language_code, source_label, source_url, personal_notes, rating,
           favourited_at, pinned_at, series_name, series_position, cover_style,
           cover_position_x, cover_position_y, row_version
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM books WHERE library_id = ?),
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         ON CONFLICT (id) DO UPDATE SET
           library_id = excluded.library_id, title = excluded.title, subtitle = excluded.subtitle,
           author_name = excluded.author_name, blurb = excluded.blurb, status = excluded.status,
           cover_tone = excluded.cover_tone, created_at = excluded.created_at,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
           last_opened_at = excluded.last_opened_at, completed_at = excluded.completed_at,
           is_archived = excluded.is_archived, language_code = excluded.language_code,
           source_label = excluded.source_label, source_url = excluded.source_url,
           personal_notes = excluded.personal_notes, rating = excluded.rating,
           favourited_at = excluded.favourited_at, pinned_at = excluded.pinned_at,
           series_name = excluded.series_name, series_position = excluded.series_position,
           cover_style = excluded.cover_style, cover_position_x = excluded.cover_position_x,
           cover_position_y = excluded.cover_position_y, row_version = excluded.row_version`,
        [
          change.entityId,
          profile.localLibraryId,
          requiredValue(value, 'title'),
          requiredValue(value, 'subtitle'),
          requiredValue(value, 'author_name'),
          requiredValue(value, 'blurb'),
          requiredValue(value, 'status'),
          requiredValue(value, 'cover_tone'),
          profile.localLibraryId,
          requiredValue(value, 'created_at'),
          requiredValue(value, 'updated_at'),
          value.deleted_at,
          value.last_opened_at,
          value.completed_at,
          requiredValue(value, 'is_archived'),
          requiredValue(value, 'language_code'),
          requiredValue(value, 'source_label'),
          requiredValue(value, 'source_url'),
          requiredValue(value, 'personal_notes'),
          value.rating,
          value.favourited_at,
          value.pinned_at,
          requiredValue(value, 'series_name'),
          value.series_position,
          requiredValue(value, 'cover_style'),
          requiredValue(value, 'cover_position_x'),
          requiredValue(value, 'cover_position_y'),
          requiredValue(value, 'row_version')
        ]
      )
      return
    }

    if (change.entityType === 'chapter') {
      await transaction.runAsync(
        `INSERT INTO chapters (
           id, book_id, title, content, position, word_count, created_at, updated_at,
           deleted_at, trashed_from_position, row_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           book_id = excluded.book_id, title = excluded.title, content = excluded.content,
           position = excluded.position, word_count = excluded.word_count,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           trashed_from_position = excluded.trashed_from_position,
           row_version = excluded.row_version`,
        [
          change.entityId,
          requiredValue(value, 'book_id'),
          requiredValue(value, 'title'),
          requiredValue(value, 'content'),
          requiredValue(value, 'position'),
          requiredValue(value, 'word_count'),
          requiredValue(value, 'created_at'),
          requiredValue(value, 'updated_at'),
          value.deleted_at,
          value.trashed_from_position,
          requiredValue(value, 'row_version')
        ]
      )
      return
    }

    await transaction.runAsync(
      `INSERT INTO reading_states (
         book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
         has_finished_current_content, updated_at, row_version, device_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (book_id) DO UPDATE SET
         chapter_id = excluded.chapter_id, scroll_position = excluded.scroll_position,
         progress_percentage = excluded.progress_percentage, last_read_at = excluded.last_read_at,
         has_finished_current_content = excluded.has_finished_current_content,
         updated_at = excluded.updated_at, row_version = excluded.row_version,
         device_id = excluded.device_id`,
      [
        change.entityId,
        value.chapter_id,
        requiredValue(value, 'scroll_position'),
        requiredValue(value, 'progress_percentage'),
        value.last_read_at,
        requiredValue(value, 'has_finished_current_content'),
        requiredValue(value, 'updated_at'),
        requiredValue(value, 'row_version'),
        value.device_id
      ]
    )
  }

  private remoteRowVersion(change: DecryptedRemoteChange): number {
    if (change.operation === 'delete') return deletionValue(change.value).rowVersion
    return normalizeRemoteEntity(change.entityType, change.entityId, change.value).rowVersion
  }

  private async saveEntityState(
    transaction: SqlDatabasePort,
    entityType: CoreSyncEntityType,
    entityId: string,
    remoteRevision: string,
    localRowVersion: number,
    updatedAt: string
  ): Promise<void> {
    await transaction.runAsync(
      `INSERT INTO sync_entity_state (
         entity_type, entity_id, remote_revision, local_row_version, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         remote_revision = excluded.remote_revision,
         local_row_version = excluded.local_row_version,
         updated_at = excluded.updated_at`,
      [entityType, entityId, remoteRevision, localRowVersion, updatedAt]
    )
  }

  private async recordConflict(
    transaction: SqlDatabasePort,
    entityType: CoreSyncEntityType,
    entityId: string,
    localMutationId: string | null,
    remoteMutationId: string,
    remoteRevision: string,
    message: string,
    createdAt: string
  ): Promise<void> {
    await transaction.runAsync(
      `INSERT INTO sync_conflicts (
         entity_type, entity_id, local_mutation_id, remote_mutation_id,
         remote_revision, message, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         local_mutation_id = excluded.local_mutation_id,
         remote_mutation_id = excluded.remote_mutation_id,
         remote_revision = excluded.remote_revision,
         message = excluded.message,
         created_at = excluded.created_at`,
      [entityType, entityId, localMutationId, remoteMutationId, remoteRevision, message, createdAt]
    )
  }
}
