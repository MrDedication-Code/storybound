import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { decryptSyncPayload, encryptSyncPayload, type SyncAssociatedData } from '@storybound/sync'
import type { SyncCiphertext, SyncEntityType } from '@storybound/contracts'
import { StoryboundError } from '../errors'
import { applyLocalSyncEntity, listLocalSyncEntities } from './entities'
import type {
  EncryptedSyncPayload,
  PushMutationResult,
  RemoteSyncChange,
  SyncProvider
} from './provider'
import { SyncRepository, type QueuedSyncMutation } from './repository'

const PAYLOAD_ENCODING = 'aes-256-gcm-v1'
const PAYLOAD_SCHEMA_VERSION = 1
const PAGE_SIZE = 100

interface EngineProfile {
  id: string
  library_id: string
  remote_library_id: string
  last_pull_cursor: string | null
}

interface EntityStateRow {
  local_row_version: number | null
  remote_revision: string | null
  dirty: number
  conflict_state: 'none' | 'open'
}

interface StoredConflictEnvelope {
  mutationId: string
  deviceId: string
  operation: 'upsert' | 'delete'
  payload: {
    ciphertext: string
    nonce: string
    encoding: string
    keyVersion: number
    schemaVersion: number
    hash: string
  }
}

export interface SyncEngineSummary {
  pulled: number
  pushed: number
  conflicts: number
  pending: number
  syncedAt: string
}

function asCiphertext(payload: EncryptedSyncPayload): SyncCiphertext {
  return {
    algorithm: 'AES-256-GCM',
    keyEpoch: payload.keyVersion,
    nonce: Buffer.from(payload.nonce).toString('base64'),
    ciphertext: Buffer.from(payload.ciphertext).toString('base64'),
    hash: payload.hash
  }
}

function asStoredPayload(payload: SyncCiphertext): EncryptedSyncPayload {
  return {
    ciphertext: Buffer.from(payload.ciphertext, 'base64'),
    nonce: Buffer.from(payload.nonce, 'base64'),
    encoding: PAYLOAD_ENCODING,
    keyVersion: payload.keyEpoch,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    hash: payload.hash
  }
}

function associatedData(
  vaultId: string,
  mutationId: string,
  entityType: string,
  entityId: string,
  operation: 'upsert' | 'delete',
  schemaVersion = PAYLOAD_SCHEMA_VERSION
): SyncAssociatedData {
  return {
    protocolVersion: 1,
    schemaVersion,
    vaultId,
    mutationId,
    entityType: entityType as SyncEntityType,
    entityId,
    operation
  }
}

export class DesktopSyncEngine {
  private activeRun: Promise<SyncEngineSummary> | null = null
  private readonly repository: SyncRepository

  constructor(
    private readonly database: Database.Database,
    private readonly provider: SyncProvider,
    private readonly profileId: string,
    private readonly deviceId: string,
    private readonly vaultKey: Uint8Array,
    private readonly keyEpoch: number
  ) {
    if (vaultKey.length !== 32) throw new TypeError('Sync vault keys must contain 32 bytes.')
    this.repository = new SyncRepository(database)
  }

  run(): Promise<SyncEngineSummary> {
    if (!this.activeRun) {
      this.activeRun = this.runOnce().finally(() => {
        this.activeRun = null
      })
    }
    return this.activeRun
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'keep-local' | 'use-remote'
  ): Promise<SyncEngineSummary> {
    const profile = this.profile()
    const conflict = this.database
      .prepare(
        `SELECT id, entity_type, entity_id, remote_revision, remote_payload
         FROM sync_conflicts WHERE id = ? AND library_id = ? AND status = 'open'`
      )
      .get(conflictId, profile.library_id) as
      | {
          id: string
          entity_type: string
          entity_id: string
          remote_revision: string
          remote_payload: Buffer
        }
      | undefined
    if (!conflict) throw new StoryboundError('NOT_FOUND', 'That sync conflict is no longer open.')
    const now = new Date().toISOString()
    this.repository.transaction(() => {
      if (resolution === 'use-remote') {
        const envelope = parseConflictEnvelope(conflict.remote_payload)
        const value = decryptSyncPayload<unknown>(
          this.vaultKey,
          asCiphertext(fromStoredConflictPayload(envelope)),
          associatedData(
            profile.remote_library_id,
            envelope.mutationId,
            conflict.entity_type,
            conflict.entity_id,
            envelope.operation,
            envelope.payload.schemaVersion
          )
        )
        const localVersion = applyLocalSyncEntity(
          this.database,
          profile.library_id,
          conflict.entity_type,
          conflict.entity_id,
          envelope.operation,
          value
        )
        this.database
          .prepare(
            `UPDATE sync_entity_state SET
               base_remote_revision = ?, remote_revision = ?,
               base_payload_hash = ?, base_payload = ?, base_payload_nonce = ?,
               base_payload_encoding = ?, base_payload_key_version = ?,
               base_payload_schema_version = ?, local_row_version = ?,
               dirty = 0, conflict_state = 'none', updated_at = ?
             WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
          )
          .run(
            conflict.remote_revision,
            conflict.remote_revision,
            envelope.payload.hash,
            Buffer.from(envelope.payload.ciphertext, 'base64'),
            Buffer.from(envelope.payload.nonce, 'base64'),
            envelope.payload.encoding,
            envelope.payload.keyVersion,
            envelope.payload.schemaVersion,
            localVersion,
            now,
            profile.library_id,
            conflict.entity_type,
            conflict.entity_id
          )
        this.database
          .prepare(
            `DELETE FROM sync_outbox
             WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
          )
          .run(profile.library_id, conflict.entity_type, conflict.entity_id)
      } else {
        this.database
          .prepare(
            `DELETE FROM sync_outbox
             WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
          )
          .run(profile.library_id, conflict.entity_type, conflict.entity_id)
        this.database
          .prepare(
            `UPDATE sync_entity_state SET
               base_remote_revision = ?, remote_revision = ?, local_row_version = NULL,
               dirty = 0, conflict_state = 'none', updated_at = ?
             WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
          )
          .run(
            conflict.remote_revision,
            conflict.remote_revision,
            now,
            profile.library_id,
            conflict.entity_type,
            conflict.entity_id
          )
      }
      this.database
        .prepare(
          `UPDATE sync_conflicts SET status = 'resolved', resolution = ?,
             resolved_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(resolution === 'keep-local' ? 'keep_local' : 'use_remote', now, now, conflict.id)
    })
    return this.run()
  }

  private profile(): EngineProfile {
    const profile = this.database
      .prepare(
        `SELECT id, library_id, remote_library_id, last_pull_cursor
         FROM sync_profiles WHERE id = ? AND enabled = 1`
      )
      .get(this.profileId) as EngineProfile | undefined
    if (!profile) throw new StoryboundError('NOT_FOUND', 'Encrypted sync is not enabled.')
    return profile
  }

  private async runOnce(): Promise<SyncEngineSummary> {
    const profile = this.profile()
    const now = new Date().toISOString()
    this.repository.resetInterruptedMutations(now)
    let pulled = 0
    let pushed = 0
    let conflicts = 0
    try {
      const hasSyncHistory =
        profile.last_pull_cursor !== null ||
        Boolean(
          this.database
            .prepare(
              `SELECT 1 FROM sync_entity_state WHERE library_id = ?
               UNION ALL SELECT 1 FROM sync_outbox WHERE library_id = ? LIMIT 1`
            )
            .get(profile.library_id, profile.library_id)
        )
      if (hasSyncHistory) this.scanAndQueue(profile)
      pulled += await this.pullAll(profile)
      if (!hasSyncHistory) this.scanAndQueue(this.profile())
      const pushedResult = await this.pushAll(profile)
      pushed += pushedResult.pushed
      conflicts += pushedResult.conflicts
      pulled += await this.pullAll(this.profile())
      const syncedAt = new Date().toISOString()
      this.database
        .prepare(
          `UPDATE sync_profiles SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`
        )
        .run(syncedAt, syncedAt, profile.id)
      const pending = Number(
        this.database
          .prepare('SELECT COUNT(*) FROM sync_outbox WHERE library_id = ?')
          .pluck()
          .get(profile.library_id)
      )
      return { pulled, pushed, conflicts, pending, syncedAt }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Encrypted sync failed.'
      this.database
        .prepare('UPDATE sync_profiles SET last_error = ?, updated_at = ? WHERE id = ?')
        .run(message.slice(0, 1000), new Date().toISOString(), profile.id)
      throw error
    }
  }

  private scanAndQueue(profile: EngineProfile): void {
    const current = listLocalSyncEntities(this.database, profile.library_id)
    const currentKeys = new Set(current.map((entity) => `${entity.entityType}:${entity.entityId}`))
    const now = new Date().toISOString()

    this.repository.transaction(() => {
      for (const entity of current) {
        const state = this.entityState(profile.library_id, entity.entityType, entity.entityId)
        const alreadyQueued = Boolean(
          this.database
            .prepare(
              `SELECT 1 FROM sync_outbox
               WHERE library_id = ? AND entity_type = ? AND entity_id = ? AND row_version = ?
               LIMIT 1`
            )
            .get(profile.library_id, entity.entityType, entity.entityId, entity.rowVersion)
        )
        if (state?.local_row_version === entity.rowVersion || alreadyQueued) continue
        this.enqueueEncrypted(profile, {
          entityType: entity.entityType,
          entityId: entity.entityId,
          operation: entity.deleted ? 'delete' : 'upsert',
          rowVersion: entity.rowVersion,
          changedAt: entity.changedAt,
          baseRemoteRevision: state?.remote_revision ?? null,
          value: entity.deleted
            ? { deletedAt: entity.value.deleted_at, rowVersion: entity.rowVersion }
            : entity.value
        })
      }

      const known = this.database
        .prepare(
          `SELECT entity_type, entity_id, local_row_version, remote_revision
           FROM sync_entity_state WHERE library_id = ? AND conflict_state = 'none'`
        )
        .all(profile.library_id) as Array<{
        entity_type: string
        entity_id: string
        local_row_version: number | null
        remote_revision: string | null
      }>
      for (const state of known) {
        if (currentKeys.has(`${state.entity_type}:${state.entity_id}`)) continue
        const alreadyQueued = Boolean(
          this.database
            .prepare(
              `SELECT 1 FROM sync_outbox
               WHERE library_id = ? AND entity_type = ? AND entity_id = ? LIMIT 1`
            )
            .get(profile.library_id, state.entity_type, state.entity_id)
        )
        if (alreadyQueued) continue
        this.enqueueEncrypted(profile, {
          entityType: state.entity_type,
          entityId: state.entity_id,
          operation: 'delete',
          rowVersion: (state.local_row_version ?? 0) + 1,
          changedAt: now,
          baseRemoteRevision: state.remote_revision,
          value: { deletedAt: now, rowVersion: (state.local_row_version ?? 0) + 1 }
        })
      }
    })
  }

  private enqueueEncrypted(
    profile: EngineProfile,
    input: {
      entityType: string
      entityId: string
      operation: 'upsert' | 'delete'
      rowVersion: number
      changedAt: string
      baseRemoteRevision: string | null
      value: unknown
    }
  ): void {
    const mutationId = randomUUID()
    const encrypted = encryptSyncPayload(
      this.vaultKey,
      input.value,
      associatedData(
        profile.remote_library_id,
        mutationId,
        input.entityType,
        input.entityId,
        input.operation
      ),
      this.keyEpoch
    )
    this.repository.enqueueMutation({
      mutationId,
      libraryId: profile.library_id,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseRemoteRevision: input.baseRemoteRevision,
      rowVersion: input.rowVersion,
      payload: asStoredPayload(encrypted),
      deviceId: this.deviceId,
      changedAt: input.changedAt,
      enqueuedAt: new Date().toISOString()
    })
    this.database
      .prepare(
        `INSERT INTO sync_entity_state (
           library_id, entity_type, entity_id, remote_revision,
           local_row_version, dirty, conflict_state, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 'none', ?)
         ON CONFLICT(library_id, entity_type, entity_id) DO UPDATE SET
           local_row_version = excluded.local_row_version,
           dirty = 1, updated_at = excluded.updated_at`
      )
      .run(
        profile.library_id,
        input.entityType,
        input.entityId,
        input.baseRemoteRevision,
        input.rowVersion,
        new Date().toISOString()
      )
  }

  private async pushAll(profile: EngineProfile): Promise<{ pushed: number; conflicts: number }> {
    let pushed = 0
    let conflicts = 0
    for (let page = 0; page < 100; page += 1) {
      const claimed = this.repository.claimPushBatch({
        libraryId: profile.library_id,
        now: new Date().toISOString(),
        limit: PAGE_SIZE
      })
      if (claimed.length === 0) break
      try {
        const response = await this.provider.push({
          remoteLibraryId: profile.remote_library_id,
          deviceId: this.deviceId,
          mutations: claimed
        })
        const accepted = response.results.filter(
          (result): result is Extract<PushMutationResult, { status: 'accepted' }> =>
            result.status === 'accepted'
        )
        const rejected = response.results.filter(
          (result): result is Extract<PushMutationResult, { status: 'conflict' }> =>
            result.status === 'conflict'
        )
        this.repository.acknowledgeMutations(profile.library_id, accepted, new Date().toISOString())
        for (const conflict of rejected) {
          const local = claimed.find((mutation) => mutation.mutationId === conflict.mutationId)
          if (local) this.recordPushConflict(profile, local, conflict)
        }
        pushed += accepted.length
        conflicts += rejected.length
      } catch (error) {
        this.repository.rescheduleMutations({
          libraryId: profile.library_id,
          mutationIds: claimed.map((mutation) => mutation.mutationId),
          nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
          error: error instanceof Error ? error.message.slice(0, 1000) : 'Upload failed'
        })
        throw error
      }
    }
    return { pushed, conflicts }
  }

  private recordPushConflict(
    profile: EngineProfile,
    local: QueuedSyncMutation,
    conflict: Extract<PushMutationResult, { status: 'conflict' }>
  ): void {
    const now = new Date().toISOString()
    this.repository.transaction(() => {
      this.database.prepare('DELETE FROM sync_outbox WHERE mutation_id = ?').run(local.mutationId)
      this.database
        .prepare(
          `INSERT INTO sync_conflicts (
             id, library_id, entity_type, entity_id, conflict_kind,
             base_remote_revision, local_row_version, remote_revision,
             base_payload, local_payload, remote_payload, payload_encoding,
             status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'concurrent_edit', ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
        )
        .run(
          randomUUID(),
          profile.library_id,
          local.entityType,
          local.entityId,
          local.baseRemoteRevision,
          local.rowVersion,
          conflict.remoteRevision,
          Buffer.alloc(0),
          serializeConflictEnvelope({
            mutationId: local.mutationId,
            deviceId: this.deviceId,
            operation: local.operation,
            payload: local.payload
          }),
          serializeConflictEnvelope({
            mutationId: conflict.remoteMutationId,
            deviceId: conflict.remoteDeviceId,
            operation: conflict.remoteOperation,
            payload: conflict.remotePayload
          }),
          PAYLOAD_ENCODING,
          now,
          now
        )
      this.database
        .prepare(
          `UPDATE sync_entity_state SET conflict_state = 'open', dirty = 1, updated_at = ?
           WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
        )
        .run(now, profile.library_id, local.entityType, local.entityId)
    })
  }

  private async pullAll(initialProfile: EngineProfile): Promise<number> {
    let profile = initialProfile
    let pulled = 0
    for (let page = 0; page < 100; page += 1) {
      const response = await this.provider.pull({
        remoteLibraryId: profile.remote_library_id,
        deviceId: this.deviceId,
        cursor: profile.last_pull_cursor,
        limit: PAGE_SIZE
      })
      const syncedAt = new Date().toISOString()
      this.repository.applyPullPageTransactionally(
        {
          profileId: profile.id,
          expectedCursor: profile.last_pull_cursor,
          nextCursor: response.nextCursor,
          syncedAt,
          changes: response.changes
        },
        (database, change) => this.applyRemoteChange(database, profile, change, syncedAt)
      )
      pulled += response.changes.length
      profile = { ...profile, last_pull_cursor: response.nextCursor }
      if (!response.hasMore) break
    }
    return pulled
  }

  private applyRemoteChange(
    database: Database.Database,
    profile: EngineProfile,
    change: RemoteSyncChange,
    syncedAt: string
  ): void {
    const state = this.entityState(profile.library_id, change.entityType, change.entityId)
    if (state?.remote_revision === change.remoteRevision) return
    if (state?.dirty || state?.conflict_state === 'open') {
      if (change.deviceId === this.deviceId) return
      this.recordPullConflict(database, profile, change, syncedAt)
      return
    }
    const value = decryptSyncPayload<unknown>(
      this.vaultKey,
      asCiphertext(change.payload),
      associatedData(
        profile.remote_library_id,
        change.mutationId,
        change.entityType,
        change.entityId,
        change.operation,
        change.payload.schemaVersion
      )
    )
    const localVersion = applyLocalSyncEntity(
      database,
      profile.library_id,
      change.entityType,
      change.entityId,
      change.operation,
      value
    )
    database
      .prepare(
        `INSERT INTO sync_entity_state (
           library_id, entity_type, entity_id, base_remote_revision, remote_revision,
           remote_etag, base_payload_hash, base_payload, base_payload_nonce,
           base_payload_encoding, base_payload_key_version, base_payload_schema_version,
           local_row_version, dirty, conflict_state, last_pulled_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 'none', ?, ?)
         ON CONFLICT(library_id, entity_type, entity_id) DO UPDATE SET
           base_remote_revision = excluded.base_remote_revision,
           remote_revision = excluded.remote_revision,
           base_payload_hash = excluded.base_payload_hash,
           base_payload = excluded.base_payload,
           base_payload_nonce = excluded.base_payload_nonce,
           base_payload_encoding = excluded.base_payload_encoding,
           base_payload_key_version = excluded.base_payload_key_version,
           base_payload_schema_version = excluded.base_payload_schema_version,
           local_row_version = excluded.local_row_version,
           dirty = 0, conflict_state = 'none',
           last_pulled_at = excluded.last_pulled_at, updated_at = excluded.updated_at`
      )
      .run(
        profile.library_id,
        change.entityType,
        change.entityId,
        change.remoteRevision,
        change.remoteRevision,
        change.payload.hash,
        Buffer.from(change.payload.ciphertext),
        Buffer.from(change.payload.nonce),
        change.payload.encoding,
        change.payload.keyVersion,
        change.payload.schemaVersion,
        localVersion,
        syncedAt,
        syncedAt
      )
  }

  private recordPullConflict(
    database: Database.Database,
    profile: EngineProfile,
    change: RemoteSyncChange,
    now: string
  ): void {
    database
      .prepare(
        `INSERT INTO sync_conflicts (
           id, library_id, entity_type, entity_id, conflict_kind,
           base_remote_revision, local_row_version, remote_revision,
           base_payload, local_payload, remote_payload, payload_encoding,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'concurrent_edit', ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      )
      .run(
        randomUUID(),
        profile.library_id,
        change.entityType,
        change.entityId,
        stateValue(
          database,
          profile.library_id,
          change.entityType,
          change.entityId,
          'remote_revision'
        ),
        stateValue(
          database,
          profile.library_id,
          change.entityType,
          change.entityId,
          'local_row_version'
        ),
        change.remoteRevision,
        stateBlob(database, profile.library_id, change.entityType, change.entityId, 'base_payload'),
        localConflictPayload(
          database,
          profile.library_id,
          change.entityType,
          change.entityId,
          this.deviceId
        ),
        serializeConflictEnvelope({
          mutationId: change.mutationId,
          deviceId: change.deviceId,
          operation: change.operation,
          payload: change.payload
        }),
        change.payload.encoding,
        now,
        now
      )
    database
      .prepare(
        `UPDATE sync_entity_state SET conflict_state = 'open', updated_at = ?
         WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .run(now, profile.library_id, change.entityType, change.entityId)
    database
      .prepare(
        `DELETE FROM sync_outbox
         WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .run(profile.library_id, change.entityType, change.entityId)
  }

  private entityState(
    libraryId: string,
    entityType: string,
    entityId: string
  ): EntityStateRow | undefined {
    return this.database
      .prepare(
        `SELECT local_row_version, remote_revision, dirty, conflict_state
         FROM sync_entity_state WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .get(libraryId, entityType, entityId) as EntityStateRow | undefined
  }
}

function stateValue(
  database: Database.Database,
  libraryId: string,
  entityType: string,
  entityId: string,
  column: 'remote_revision' | 'local_row_version'
): string | number | null {
  return (
    (database
      .prepare(
        `SELECT ${column} FROM sync_entity_state
         WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .pluck()
      .get(libraryId, entityType, entityId) as string | number | null | undefined) ?? null
  )
}

function stateBlob(
  database: Database.Database,
  libraryId: string,
  entityType: string,
  entityId: string,
  column: 'base_payload'
): Buffer {
  const value = database
    .prepare(
      `SELECT ${column} FROM sync_entity_state
       WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .pluck()
    .get(libraryId, entityType, entityId) as Buffer | null | undefined
  return value ? Buffer.from(value) : Buffer.alloc(0)
}

function serializeConflictEnvelope(input: {
  mutationId: string
  deviceId: string
  operation: 'upsert' | 'delete'
  payload: EncryptedSyncPayload
}): Buffer {
  const stored: StoredConflictEnvelope = {
    mutationId: input.mutationId,
    deviceId: input.deviceId,
    operation: input.operation,
    payload: {
      ciphertext: Buffer.from(input.payload.ciphertext).toString('base64'),
      nonce: Buffer.from(input.payload.nonce).toString('base64'),
      encoding: input.payload.encoding,
      keyVersion: input.payload.keyVersion,
      schemaVersion: input.payload.schemaVersion,
      hash: input.payload.hash
    }
  }
  return Buffer.from(JSON.stringify(stored), 'utf8')
}

function parseConflictEnvelope(value: Buffer): StoredConflictEnvelope {
  try {
    const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as StoredConflictEnvelope
    if (
      !parsed ||
      typeof parsed.mutationId !== 'string' ||
      typeof parsed.deviceId !== 'string' ||
      !['upsert', 'delete'].includes(parsed.operation) ||
      typeof parsed.payload?.ciphertext !== 'string' ||
      typeof parsed.payload.nonce !== 'string'
    ) {
      throw new Error('Invalid conflict envelope')
    }
    return parsed
  } catch (error) {
    throw new StoryboundError('SECURITY_ERROR', 'The encrypted conflict record is invalid.', error)
  }
}

function fromStoredConflictPayload(envelope: StoredConflictEnvelope): EncryptedSyncPayload {
  return {
    ciphertext: Buffer.from(envelope.payload.ciphertext, 'base64'),
    nonce: Buffer.from(envelope.payload.nonce, 'base64'),
    encoding: envelope.payload.encoding,
    keyVersion: envelope.payload.keyVersion,
    schemaVersion: envelope.payload.schemaVersion,
    hash: envelope.payload.hash
  }
}

function localConflictPayload(
  database: Database.Database,
  libraryId: string,
  entityType: string,
  entityId: string,
  deviceId: string
): Buffer {
  const row = database
    .prepare(
      `SELECT mutation_id, operation, payload_ciphertext, payload_nonce, payload_encoding,
              payload_key_version, payload_schema_version, payload_hash
       FROM sync_outbox
       WHERE library_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY sequence DESC LIMIT 1`
    )
    .get(libraryId, entityType, entityId) as
    | {
        mutation_id: string
        operation: 'upsert' | 'delete'
        payload_ciphertext: Buffer
        payload_nonce: Buffer
        payload_encoding: string
        payload_key_version: number
        payload_schema_version: number
        payload_hash: string
      }
    | undefined
  if (!row) return Buffer.alloc(0)
  return serializeConflictEnvelope({
    mutationId: row.mutation_id,
    deviceId,
    operation: row.operation,
    payload: {
      ciphertext: row.payload_ciphertext,
      nonce: row.payload_nonce,
      encoding: row.payload_encoding,
      keyVersion: row.payload_key_version,
      schemaVersion: row.payload_schema_version,
      hash: row.payload_hash
    }
  })
}
