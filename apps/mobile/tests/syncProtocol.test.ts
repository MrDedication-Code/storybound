import { describe, expect, it } from 'vitest'
import {
  createRecoveryCode,
  createVaultKey,
  decryptSyncPayload,
  encryptSyncPayload,
  recoveryVerifier,
  unwrapVaultKeyFromRecovery,
  wrapVaultKeyForRecovery
} from '@storybound/sync'
import { parseMobileCloudConfig } from '../src/sync/config'
import { coverToneFromStyle, normalizeRemoteEntity } from '../src/sync/entityMapping'
import { parseBootstrap, parsePullResult, parsePushResults } from '../src/sync/rpcContract'
import { connectionPhase } from '../src/sync/state'

const vaultId = '11111111-1111-4111-8111-111111111111'
const deviceId = '22222222-2222-4222-8222-222222222222'
const mutationId = '33333333-3333-4333-8333-333333333333'

describe('mobile cloud configuration', () => {
  it('keeps a build local-only when both values are absent', () => {
    expect(parseMobileCloudConfig({})).toBeNull()
  })

  it('accepts HTTPS and local HTTP while rejecting incomplete configuration', () => {
    expect(
      parseMobileCloudConfig({
        url: 'https://storybound.supabase.co/',
        publishableKey: 'sb_publishable_1234567890'
      })
    ).toEqual({
      url: 'https://storybound.supabase.co',
      publishableKey: 'sb_publishable_1234567890'
    })
    expect(
      parseMobileCloudConfig({
        url: 'http://localhost:54321',
        publishableKey: 'local_publishable_key_1234'
      })
    ).not.toBeNull()
    expect(() => parseMobileCloudConfig({ url: 'https://storybound.supabase.co' })).toThrow(
      'requires both'
    )
    expect(() =>
      parseMobileCloudConfig({
        url: 'http://example.com',
        publishableKey: 'sb_publishable_1234567890'
      })
    ).toThrow('requires HTTPS')
  })
})

describe('connection state', () => {
  it('derives local, auth, vault, sync, and error phases deterministically', () => {
    expect(
      connectionPhase({
        configured: false,
        signedIn: false,
        unlocked: false,
        syncing: false,
        hasError: true
      })
    ).toBe('local-only')
    expect(
      connectionPhase({
        configured: true,
        signedIn: false,
        unlocked: false,
        syncing: false,
        hasError: false
      })
    ).toBe('signed-out')
    expect(
      connectionPhase({
        configured: true,
        signedIn: true,
        unlocked: false,
        syncing: false,
        hasError: true
      })
    ).toBe('locked')
    expect(
      connectionPhase({
        configured: true,
        signedIn: true,
        unlocked: true,
        syncing: true,
        hasError: true
      })
    ).toBe('syncing')
    expect(
      connectionPhase({
        configured: true,
        signedIn: true,
        unlocked: true,
        syncing: false,
        hasError: true
      })
    ).toBe('error')
  })
})

describe('shared recovery and payload encryption', () => {
  it('round-trips a recovery envelope and binds payloads to their exact AAD', () => {
    const recoveryCode = createRecoveryCode()
    const key = createVaultKey()
    const envelope = wrapVaultKeyForRecovery(key, recoveryCode, vaultId, 1)
    expect(unwrapVaultKeyFromRecovery(envelope, recoveryCode)).toEqual(key)
    expect(recoveryVerifier(recoveryCode, vaultId)).not.toBe(
      recoveryVerifier(recoveryCode, deviceId)
    )

    const aad = {
      protocolVersion: 1,
      schemaVersion: 1,
      vaultId,
      mutationId,
      entityType: 'chapter' as const,
      entityId: 'chapter-1',
      operation: 'upsert' as const
    }
    const encrypted = encryptSyncPayload(key, { title: 'Arrival' }, aad, 1)
    expect(decryptSyncPayload(key, encrypted, aad)).toEqual({ title: 'Arrival' })
    expect(() =>
      decryptSyncPayload(key, encrypted, { ...aad, entityId: 'another-chapter' })
    ).toThrow()
  })
})

describe('live RPC validation', () => {
  const encryptedPayload = {
    ciphertext: 'Y2lwaGVydGV4dA==',
    nonce: 'bm9uY2U=',
    encoding: 'aes-256-gcm-v1',
    keyVersion: 1,
    schemaVersion: 1,
    hash: 'aGFzaA=='
  }

  it('preserves decimal bigint cursors and revisions as strings', () => {
    const parsed = parsePullResult({
      changes: [
        {
          mutationId,
          deviceId,
          entityType: 'chapter',
          entityId: 'chapter-1',
          operation: 'upsert',
          remoteRevision: '9223372036854775806',
          changedAt: '2026-08-06T12:00:00.000Z',
          payload: encryptedPayload
        }
      ],
      nextCursor: '9223372036854775807',
      hasMore: false
    })
    expect(parsed.nextCursor).toBe('9223372036854775807')
    expect(parsed.changes[0].remoteRevision).toBe('9223372036854775806')
  })

  it('validates bootstrap and push responses instead of trusting RPC JSON', () => {
    expect(
      parseBootstrap({
        vaultId,
        keyEpoch: 1,
        devices: [
          {
            id: deviceId,
            displayName: 'Phone',
            state: 'active',
            createdAt: '2026-08-06T12:00:00.000Z',
            lastSeenAt: null,
            revokedAt: null
          }
        ]
      })
    ).toMatchObject({ vaultId, keyEpoch: 1 })
    expect(
      parsePushResults([
        { mutationId, status: 'accepted', remoteRevision: '9007199254740993', duplicate: false }
      ])
    ).toEqual([
      { mutationId, status: 'accepted', remoteRevision: '9007199254740993', duplicate: false }
    ])
    expect(() =>
      parsePullResult({ changes: [], nextCursor: 9_007_199_254_740_992, hasMore: false })
    ).toThrow('cursor')
  })
})

describe('desktop-compatible entity mapping', () => {
  it('normalizes the full book payload and derives the mobile cover tone', () => {
    const normalized = normalizeRemoteEntity('book', 'book-1', {
      id: 'book-1',
      title: 'The Long Way Home',
      blurb: '',
      status: 'ongoing',
      created_at: '2026-08-01T12:00:00.000Z',
      updated_at: '2026-08-06T12:00:00.000Z',
      last_opened_at: null,
      completed_at: null,
      total_word_count: 1200,
      is_archived: 0,
      deleted_at: null,
      row_version: 3,
      subtitle: '',
      author_name: 'A. Writer',
      language_code: 'en',
      source_label: '',
      source_url: '',
      personal_notes: '',
      rating: 4,
      favourited_at: null,
      pinned_at: null,
      series_name: '',
      series_position: null,
      cover_style: 'ocean',
      cover_position_x: 40,
      cover_position_y: 60
    })
    expect(normalized.rowVersion).toBe(3)
    expect(normalized.values).toMatchObject({ cover_style: 'ocean', cover_tone: 'forest' })
    expect(coverToneFromStyle('ember')).toBe('ember')
  })

  it('rejects a payload whose identifier differs from its encrypted envelope', () => {
    expect(() =>
      normalizeRemoteEntity('library', 'expected', {
        id: 'unexpected',
        name: 'Library',
        description: '',
        created_at: '2026-08-01T12:00:00.000Z',
        updated_at: '2026-08-01T12:00:00.000Z',
        deleted_at: null,
        row_version: 1
      })
    ).toThrow('identifier')
  })
})
