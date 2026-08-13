import type Database from 'better-sqlite3'
import { StoryboundError } from '../errors'
import type { EncryptedSyncPayload, RemoteSyncChange, SyncOperation } from './provider'

export interface EnqueueSyncMutationInput {
  mutationId: string
  libraryId: string
  entityType: string
  entityId: string
  operation: SyncOperation
  baseRemoteRevision?: string | null
  changeSetId?: string | null
  rowVersion: number
  payload: EncryptedSyncPayload
  deviceId?: string | null
  changedAt: string
  enqueuedAt: string
}

export interface QueuedSyncMutation extends EnqueueSyncMutationInput {
  sequence: number
  baseRemoteRevision: string | null
  changeSetId: string | null
  deviceId: string | null
  state: 'queued' | 'sending'
  attemptCount: number
  nextAttemptAt: string | null
  sendingStartedAt: string | null
  lastError: string | null
}

export interface ClaimPushBatchInput {
  libraryId: string
  now: string
  limit: number
}

export interface RescheduleMutationsInput {
  libraryId: string
  mutationIds: readonly string[]
  nextAttemptAt: string
  error: string
}

export interface MutationAcknowledgement {
  mutationId: string
  remoteRevision: string
  remoteEtag?: string | null
}

export interface ApplyPullPageInput {
  profileId: string
  expectedCursor: string | null
  nextCursor: string
  syncedAt: string
  changes: readonly RemoteSyncChange[]
}

export type ApplyRemoteChange = (database: Database.Database, change: RemoteSyncChange) => void

interface OutboxRow {
  sequence: number
  mutation_id: string
  library_id: string
  entity_type: string
  entity_id: string
  operation: SyncOperation
  base_remote_revision: string | null
  change_set_id: string | null
  row_version: number
  payload_ciphertext: Buffer
  payload_nonce: Buffer
  payload_encoding: string
  payload_key_version: number
  payload_schema_version: number
  payload_hash: string
  device_id: string | null
  state: 'queued' | 'sending'
  attempt_count: number
  next_attempt_at: string | null
  sending_started_at: string | null
  last_error: string | null
  changed_at: string
  enqueued_at: string
}

interface SyncProfileCursorRow {
  library_id: string
  last_pull_cursor: string | null
}

const selectOutbox = `
  SELECT sequence, mutation_id, library_id, entity_type, entity_id, operation,
         base_remote_revision, change_set_id, row_version, payload_ciphertext,
         payload_nonce, payload_encoding, payload_key_version, payload_schema_version,
         payload_hash, device_id, state, attempt_count, next_attempt_at,
         sending_started_at, last_error, changed_at, enqueued_at
  FROM sync_outbox
`

function toQueuedMutation(row: OutboxRow): QueuedSyncMutation {
  return {
    sequence: row.sequence,
    mutationId: row.mutation_id,
    libraryId: row.library_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    baseRemoteRevision: row.base_remote_revision,
    changeSetId: row.change_set_id,
    rowVersion: row.row_version,
    payload: {
      ciphertext: row.payload_ciphertext,
      nonce: row.payload_nonce,
      encoding: row.payload_encoding,
      keyVersion: row.payload_key_version,
      schemaVersion: row.payload_schema_version,
      hash: row.payload_hash
    },
    deviceId: row.device_id,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    sendingStartedAt: row.sending_started_at,
    lastError: row.last_error,
    changedAt: row.changed_at,
    enqueuedAt: row.enqueued_at
  }
}

function isDue(row: OutboxRow, now: string): boolean {
  return row.next_attempt_at === null || row.next_attempt_at <= now
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

/**
 * Owns sync bookkeeping on the same SQLite connection as the local Store. The Store can wrap a
 * local entity mutation and enqueueMutation in one outer better-sqlite3 transaction when sync is
 * wired into its mutation paths.
 */
export class SyncRepository {
  constructor(private readonly database: Database.Database) {}

  transaction<T>(work: () => T): T {
    return this.database.transaction(work)()
  }

  enqueueMutation(input: EnqueueSyncMutationInput): number {
    const result = this.database
      .prepare(
        `INSERT INTO sync_outbox (
           mutation_id, library_id, entity_type, entity_id, operation,
           base_remote_revision, change_set_id, row_version, payload_ciphertext,
           payload_nonce, payload_encoding, payload_key_version, payload_schema_version,
           payload_hash, device_id, changed_at, enqueued_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.mutationId,
        input.libraryId,
        input.entityType,
        input.entityId,
        input.operation,
        input.baseRemoteRevision ?? null,
        input.changeSetId ?? null,
        input.rowVersion,
        Buffer.from(input.payload.ciphertext),
        Buffer.from(input.payload.nonce),
        input.payload.encoding,
        input.payload.keyVersion,
        input.payload.schemaVersion,
        input.payload.hash,
        input.deviceId ?? null,
        input.changedAt,
        input.enqueuedAt
      )

    return Number(result.lastInsertRowid)
  }

  resetInterruptedMutations(now: string): number {
    return this.database
      .prepare(
        `UPDATE sync_outbox
         SET state = 'queued',
             next_attempt_at = ?,
             sending_started_at = NULL,
             last_error = COALESCE(last_error, 'Interrupted before acknowledgement')
         WHERE state = 'sending'`
      )
      .run(now).changes
  }

  claimPushBatch(input: ClaimPushBatchInput): QueuedSyncMutation[] {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new StoryboundError('VALIDATION_ERROR', 'Sync batch limit must be a positive integer.')
    }

    return this.transaction(() => {
      const first = this.database
        .prepare(
          `${selectOutbox} WHERE library_id = ? AND state = 'queued' ORDER BY sequence LIMIT 1`
        )
        .get(input.libraryId) as OutboxRow | undefined

      if (!first || !isDue(first, input.now)) return []

      let rows: OutboxRow[]
      if (first.change_set_id) {
        rows = this.database
          .prepare(
            `${selectOutbox}
             WHERE library_id = ? AND state = 'queued' AND change_set_id = ?
             ORDER BY sequence`
          )
          .all(input.libraryId, first.change_set_id) as OutboxRow[]
        if (rows.some((row) => !isDue(row, input.now))) return []
        const last = rows.at(-1)
        const interveningMutation = last
          ? this.database
              .prepare(
                `SELECT 1 FROM sync_outbox
                 WHERE library_id = ? AND state = 'queued'
                   AND sequence BETWEEN ? AND ?
                   AND (change_set_id IS NULL OR change_set_id <> ?)
                 LIMIT 1`
              )
              .get(input.libraryId, first.sequence, last.sequence, first.change_set_id)
          : undefined
        if (interveningMutation) {
          throw new StoryboundError(
            'CONFLICT',
            'A sync change set is not contiguous in the durable queue.'
          )
        }
      } else {
        const candidates = this.database
          .prepare(
            `${selectOutbox}
             WHERE library_id = ? AND state = 'queued' AND sequence >= ?
             ORDER BY sequence LIMIT ?`
          )
          .all(input.libraryId, first.sequence, input.limit) as OutboxRow[]
        rows = []
        for (const candidate of candidates) {
          if (candidate.change_set_id || !isDue(candidate, input.now)) break
          rows.push(candidate)
        }
      }

      if (rows.length === 0) return []
      const mutationIds = rows.map((row) => row.mutation_id)
      this.database
        .prepare(
          `UPDATE sync_outbox
           SET state = 'sending', attempt_count = attempt_count + 1,
               sending_started_at = ?, last_error = NULL
           WHERE library_id = ? AND state = 'queued'
             AND mutation_id IN (${placeholders(mutationIds)})`
        )
        .run(input.now, input.libraryId, ...mutationIds)

      return rows.map((row) =>
        toQueuedMutation({
          ...row,
          state: 'sending',
          attempt_count: row.attempt_count + 1,
          sending_started_at: input.now,
          last_error: null
        })
      )
    })
  }

  rescheduleMutations(input: RescheduleMutationsInput): number {
    if (input.mutationIds.length === 0) return 0
    return this.database
      .prepare(
        `UPDATE sync_outbox
         SET state = 'queued', next_attempt_at = ?, sending_started_at = NULL, last_error = ?
         WHERE library_id = ? AND state = 'sending'
           AND mutation_id IN (${placeholders(input.mutationIds)})`
      )
      .run(input.nextAttemptAt, input.error, input.libraryId, ...input.mutationIds).changes
  }

  acknowledgeMutations(
    libraryId: string,
    acknowledgements: readonly MutationAcknowledgement[],
    acknowledgedAt: string
  ): number {
    if (acknowledgements.length === 0) return 0
    return this.transaction(() => {
      const acknowledgementById = new Map(
        acknowledgements.map((acknowledgement) => [acknowledgement.mutationId, acknowledgement])
      )
      const mutationIds = [...acknowledgementById.keys()]
      const rows = this.database
        .prepare(
          `${selectOutbox}
           WHERE library_id = ? AND state = 'sending'
             AND mutation_id IN (${placeholders(mutationIds)})
           ORDER BY sequence`
        )
        .all(libraryId, ...mutationIds) as OutboxRow[]
      let acknowledged = 0
      for (const row of rows) {
        const acknowledgement = acknowledgementById.get(row.mutation_id)
        if (!acknowledgement) continue

        this.database.prepare('DELETE FROM sync_outbox WHERE sequence = ?').run(row.sequence)
        const stillDirty = Boolean(
          this.database
            .prepare(
              `SELECT 1 FROM sync_outbox
               WHERE library_id = ? AND entity_type = ? AND entity_id = ? LIMIT 1`
            )
            .get(libraryId, row.entity_type, row.entity_id)
        )
        this.database
          .prepare(
            `INSERT INTO sync_entity_state (
               library_id, entity_type, entity_id, base_remote_revision, remote_revision,
               remote_etag, base_payload_hash, base_payload, base_payload_nonce,
               base_payload_encoding, base_payload_key_version, base_payload_schema_version,
               local_row_version, dirty, conflict_state, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?)
             ON CONFLICT(library_id, entity_type, entity_id) DO UPDATE SET
               base_remote_revision = excluded.base_remote_revision,
               remote_revision = excluded.remote_revision,
               remote_etag = excluded.remote_etag,
               base_payload_hash = excluded.base_payload_hash,
               base_payload = excluded.base_payload,
               base_payload_nonce = excluded.base_payload_nonce,
               base_payload_encoding = excluded.base_payload_encoding,
               base_payload_key_version = excluded.base_payload_key_version,
               base_payload_schema_version = excluded.base_payload_schema_version,
               local_row_version = excluded.local_row_version,
               dirty = excluded.dirty,
               updated_at = excluded.updated_at`
          )
          .run(
            libraryId,
            row.entity_type,
            row.entity_id,
            acknowledgement.remoteRevision,
            acknowledgement.remoteRevision,
            acknowledgement.remoteEtag ?? null,
            row.payload_hash,
            row.payload_ciphertext,
            row.payload_nonce,
            row.payload_encoding,
            row.payload_key_version,
            row.payload_schema_version,
            row.row_version,
            stillDirty ? 1 : 0,
            acknowledgedAt
          )
        acknowledged += 1
      }
      return acknowledged
    })
  }

  applyPullPageTransactionally(input: ApplyPullPageInput, apply: ApplyRemoteChange): void {
    this.transaction(() => {
      const profile = this.database
        .prepare('SELECT library_id, last_pull_cursor FROM sync_profiles WHERE id = ?')
        .get(input.profileId) as SyncProfileCursorRow | undefined
      if (!profile) {
        throw new StoryboundError('NOT_FOUND', 'The sync profile could not be found.')
      }
      if (profile.last_pull_cursor !== input.expectedCursor) {
        throw new StoryboundError(
          'CONFLICT',
          'The sync cursor changed before this page could be applied.'
        )
      }

      for (const change of input.changes) apply(this.database, change)
      this.database
        .prepare(
          `UPDATE sync_profiles
           SET last_pull_cursor = ?, last_sync_at = ?, last_error = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(input.nextCursor, input.syncedAt, input.syncedAt, input.profileId)
    })
  }
}
