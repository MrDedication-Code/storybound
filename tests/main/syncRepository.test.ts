import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStoryboundPaths, openStoryboundDatabase } from '../../src/main/database'
import type { EnqueueSyncMutationInput } from '../../src/main/sync'
import { SyncRepository } from '../../src/main/sync'

const LIBRARY_ID = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-08-06T12:00:00.000Z'

let database: Database.Database
let repository: SyncRepository
let temporaryDirectory: string

function mutation(
  mutationId: string,
  overrides: Partial<EnqueueSyncMutationInput> = {}
): EnqueueSyncMutationInput {
  return {
    mutationId,
    libraryId: LIBRARY_ID,
    entityType: 'chapter',
    entityId: 'chapter-a',
    operation: 'upsert',
    baseRemoteRevision: 'revision-1',
    rowVersion: 2,
    payload: {
      ciphertext: Buffer.from(`ciphertext:${mutationId}`),
      nonce: Buffer.from('0123456789ab'),
      encoding: 'aes-256-gcm-v1',
      keyVersion: 1,
      schemaVersion: 1,
      hash: `hash:${mutationId}`
    },
    changedAt: NOW,
    enqueuedAt: NOW,
    ...overrides
  }
}

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'storybound-sync-repository-test-'))
  database = await openStoryboundDatabase(createStoryboundPaths(temporaryDirectory))
  repository = new SyncRepository(database)
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('SyncRepository durable outbox', () => {
  it('can atomically pair a local entity write with its durable mutation', () => {
    expect(() =>
      repository.transaction(() => {
        database
          .prepare('UPDATE libraries SET description = ? WHERE id = ?')
          .run('local edit', LIBRARY_ID)
        repository.enqueueMutation(mutation('mutation-a'))
        throw new Error('entity write failed')
      })
    ).toThrow('entity write failed')

    expect(
      database.prepare('SELECT description FROM libraries WHERE id = ?').pluck().get(LIBRARY_ID)
    ).toBe('')
    expect(database.prepare('SELECT COUNT(*) FROM sync_outbox').pluck().get()).toBe(0)
  })

  it('stores immutable encrypted envelopes and safely retries interrupted sends', () => {
    repository.enqueueMutation(mutation('mutation-a'))

    const firstClaim = repository.claimPushBatch({ libraryId: LIBRARY_ID, now: NOW, limit: 10 })
    expect(firstClaim).toHaveLength(1)
    expect(firstClaim[0]).toMatchObject({
      mutationId: 'mutation-a',
      state: 'sending',
      attemptCount: 1,
      sendingStartedAt: NOW,
      payload: {
        encoding: 'aes-256-gcm-v1',
        keyVersion: 1,
        schemaVersion: 1,
        hash: 'hash:mutation-a'
      }
    })
    expect(Buffer.from(firstClaim[0].payload.ciphertext).toString()).toBe('ciphertext:mutation-a')
    expect(Buffer.from(firstClaim[0].payload.nonce).toString()).toBe('0123456789ab')

    const restartedAt = '2026-08-06T12:01:00.000Z'
    expect(repository.resetInterruptedMutations(restartedAt)).toBe(1)
    const retry = repository.claimPushBatch({
      libraryId: LIBRARY_ID,
      now: restartedAt,
      limit: 10
    })
    expect(retry).toHaveLength(1)
    expect(retry[0]).toMatchObject({
      mutationId: 'mutation-a',
      state: 'sending',
      attemptCount: 2,
      sendingStartedAt: restartedAt
    })
    expect(Buffer.from(retry[0].payload.ciphertext).toString()).toBe('ciphertext:mutation-a')
  })

  it('does not let later mutations overtake a delayed retry', () => {
    repository.enqueueMutation(mutation('mutation-a'))
    repository.enqueueMutation(mutation('mutation-b', { entityId: 'chapter-b' }))
    expect(
      repository.claimPushBatch({ libraryId: LIBRARY_ID, now: NOW, limit: 1 })[0].mutationId
    ).toBe('mutation-a')

    const retryAt = '2026-08-06T13:00:00.000Z'
    expect(
      repository.rescheduleMutations({
        libraryId: LIBRARY_ID,
        mutationIds: ['mutation-a'],
        nextAttemptAt: retryAt,
        error: 'Network unavailable'
      })
    ).toBe(1)
    expect(
      repository.claimPushBatch({
        libraryId: LIBRARY_ID,
        now: '2026-08-06T12:30:00.000Z',
        limit: 10
      })
    ).toEqual([])
    expect(
      repository
        .claimPushBatch({ libraryId: LIBRARY_ID, now: retryAt, limit: 10 })
        .map((entry) => entry.mutationId)
    ).toEqual(['mutation-a', 'mutation-b'])
  })

  it('claims a change set atomically even when it is larger than the preferred limit', () => {
    repository.enqueueMutation(mutation('mutation-a', { changeSetId: 'split-chapter' }))
    repository.enqueueMutation(
      mutation('mutation-b', {
        entityId: 'chapter-b',
        changeSetId: 'split-chapter'
      })
    )
    repository.enqueueMutation(mutation('mutation-c', { entityId: 'chapter-c' }))

    expect(
      repository
        .claimPushBatch({ libraryId: LIBRARY_ID, now: NOW, limit: 1 })
        .map((entry) => entry.mutationId)
    ).toEqual(['mutation-a', 'mutation-b'])
    expect(
      database.prepare('SELECT mutation_id, state FROM sync_outbox ORDER BY sequence').all()
    ).toEqual([
      { mutation_id: 'mutation-a', state: 'sending' },
      { mutation_id: 'mutation-b', state: 'sending' },
      { mutation_id: 'mutation-c', state: 'queued' }
    ])
  })

  it('acknowledges idempotent mutations and leaves entities dirty until their tail is accepted', () => {
    repository.enqueueMutation(mutation('mutation-a'))
    repository.enqueueMutation(mutation('mutation-b', { rowVersion: 3 }))
    repository.claimPushBatch({ libraryId: LIBRARY_ID, now: NOW, limit: 10 })

    expect(
      repository.acknowledgeMutations(
        LIBRARY_ID,
        [{ mutationId: 'mutation-a', remoteRevision: 'revision-2' }],
        NOW
      )
    ).toBe(1)
    expect(
      database
        .prepare(
          `SELECT remote_revision, local_row_version, dirty
           FROM sync_entity_state WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
        )
        .get(LIBRARY_ID, 'chapter', 'chapter-a')
    ).toEqual({ remote_revision: 'revision-2', local_row_version: 2, dirty: 1 })

    expect(
      repository.acknowledgeMutations(
        LIBRARY_ID,
        [{ mutationId: 'mutation-b', remoteRevision: 'revision-3', remoteEtag: 'etag-3' }],
        NOW
      )
    ).toBe(1)
    expect(
      database
        .prepare(
          `SELECT remote_revision, remote_etag, base_payload_hash,
                  CAST(base_payload AS TEXT) AS base_payload,
                  CAST(base_payload_nonce AS TEXT) AS base_payload_nonce,
                  base_payload_encoding, base_payload_key_version,
                  base_payload_schema_version, local_row_version, dirty
           FROM sync_entity_state WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
        )
        .get(LIBRARY_ID, 'chapter', 'chapter-a')
    ).toEqual({
      remote_revision: 'revision-3',
      remote_etag: 'etag-3',
      base_payload_hash: 'hash:mutation-b',
      base_payload: 'ciphertext:mutation-b',
      base_payload_nonce: '0123456789ab',
      base_payload_encoding: 'aes-256-gcm-v1',
      base_payload_key_version: 1,
      base_payload_schema_version: 1,
      local_row_version: 3,
      dirty: 0
    })
    expect(
      repository.acknowledgeMutations(
        LIBRARY_ID,
        [{ mutationId: 'mutation-b', remoteRevision: 'revision-3' }],
        NOW
      )
    ).toBe(0)

    repository.enqueueMutation(mutation('mutation-c', { rowVersion: 4 }))
    repository.enqueueMutation(mutation('mutation-d', { rowVersion: 5 }))
    repository.claimPushBatch({ libraryId: LIBRARY_ID, now: NOW, limit: 10 })
    expect(
      repository.acknowledgeMutations(
        LIBRARY_ID,
        [
          { mutationId: 'mutation-d', remoteRevision: 'revision-5' },
          { mutationId: 'mutation-c', remoteRevision: 'revision-4' }
        ],
        NOW
      )
    ).toBe(2)
    expect(
      database
        .prepare(
          `SELECT remote_revision, local_row_version, dirty
           FROM sync_entity_state WHERE library_id = ? AND entity_type = ? AND entity_id = ?`
        )
        .get(LIBRARY_ID, 'chapter', 'chapter-a')
    ).toEqual({ remote_revision: 'revision-5', local_row_version: 5, dirty: 0 })
  })
})

describe('SyncRepository pull transactions', () => {
  it('commits applied changes and the opaque cursor together, and rolls both back on failure', () => {
    database
      .prepare(
        `INSERT INTO sync_profiles (
           id, library_id, provider, remote_library_id, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('profile-a', LIBRARY_ID, 'test', 'remote-library-a', 1, NOW, NOW)
    const change = {
      mutationId: 'remote-mutation-a',
      deviceId: 'remote-device-a',
      entityType: 'library',
      entityId: LIBRARY_ID,
      operation: 'upsert' as const,
      remoteRevision: 'revision-2',
      changedAt: NOW,
      payload: mutation('payload').payload
    }

    expect(() =>
      repository.applyPullPageTransactionally(
        {
          profileId: 'profile-a',
          expectedCursor: null,
          nextCursor: 'cursor-1',
          syncedAt: NOW,
          changes: [change]
        },
        (transactionDatabase) => {
          transactionDatabase
            .prepare('UPDATE libraries SET description = ? WHERE id = ?')
            .run('should roll back', LIBRARY_ID)
          throw new Error('invalid remote payload')
        }
      )
    ).toThrow('invalid remote payload')
    expect(
      database.prepare('SELECT description FROM libraries WHERE id = ?').pluck().get(LIBRARY_ID)
    ).toBe('')
    expect(
      database
        .prepare('SELECT last_pull_cursor FROM sync_profiles WHERE id = ?')
        .pluck()
        .get('profile-a')
    ).toBeNull()

    repository.applyPullPageTransactionally(
      {
        profileId: 'profile-a',
        expectedCursor: null,
        nextCursor: 'cursor-1',
        syncedAt: NOW,
        changes: [change]
      },
      (transactionDatabase) => {
        transactionDatabase
          .prepare('UPDATE libraries SET description = ? WHERE id = ?')
          .run('remote description', LIBRARY_ID)
      }
    )
    expect(
      database.prepare('SELECT description FROM libraries WHERE id = ?').pluck().get(LIBRARY_ID)
    ).toBe('remote description')
    expect(
      database
        .prepare('SELECT last_pull_cursor, last_sync_at FROM sync_profiles WHERE id = ?')
        .get('profile-a')
    ).toEqual({ last_pull_cursor: 'cursor-1', last_sync_at: NOW })

    expect(() =>
      repository.applyPullPageTransactionally(
        {
          profileId: 'profile-a',
          expectedCursor: null,
          nextCursor: 'cursor-2',
          syncedAt: NOW,
          changes: []
        },
        () => undefined
      )
    ).toThrow('cursor changed')
  })
})
