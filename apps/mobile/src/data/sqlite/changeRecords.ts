import type { SqlDatabasePort } from './databasePort'

export type LocalEntityType = 'book' | 'chapter' | 'reading_state' | 'annotation' | 'bookmark'

export { countWords } from '../../domain/reading'

/** Queues a local change for the next sync; a newer change to the same record replaces it. */
export async function recordChange(
  transaction: SqlDatabasePort,
  entityType: LocalEntityType,
  entityId: string,
  changedAt: string,
  rowVersion: number,
  operation: 'upsert' | 'delete' = 'upsert'
): Promise<void> {
  const syncEntityType = entityType === 'reading_state' ? 'reading-state' : entityType
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
    [syncEntityType, entityId, operation, changedAt, rowVersion, syncEntityType, entityId]
  )
}
