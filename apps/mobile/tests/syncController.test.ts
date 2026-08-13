import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  createRecoveryCode,
  createVaultKey,
  recoveryVerifier,
  wrapVaultKeyForRecovery
} from '@storybound/sync'
import { describe, expect, it, vi } from 'vitest'
import type { MobileSyncProfile, SQLiteSyncStore } from '../src/data/sqlite/sqliteSyncStore'
import {
  StoryboundMobileSyncController,
  parseVaultCredentials
} from '../src/sync/mobileSyncController'
import { bytesToBase64, bytesToBase64Url } from '../src/sync/encoding'
import { ChunkedSecureStorage, type SecureStoreBackend } from '../src/sync/secureStore'

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn(() => new Uint8Array(32).fill(7)),
  randomUUID: vi.fn(() => '33333333-3333-4333-8333-333333333333')
}))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))

const userId = '11111111-1111-4111-8111-111111111111'
const vaultId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
const mutationId = '44444444-4444-4444-8444-444444444444'
const hugeCursor = '9223372036854775807'
const deviceToken = bytesToBase64Url(new Uint8Array(32).fill(7))

class MemorySecureStore implements SecureStoreBackend {
  readonly values = new Map<string, string>()

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function fakeSession(): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-08-06T12:00:00Z',
      email: 'reader@example.com'
    }
  }
}

function fakeStore(initialCursor: string | null = null): {
  store: SQLiteSyncStore
  profile: MobileSyncProfile
  finishSync: ReturnType<typeof vi.fn>
} {
  const profile: MobileSyncProfile = {
    vaultId,
    deviceId,
    localLibraryId: 'local-library',
    lastPullCursor: initialCursor,
    lastSyncAt: null,
    lastError: null
  }
  const finishSync = vi.fn(async (syncedAt: string) => {
    profile.lastSyncAt = syncedAt
  })
  return {
    profile,
    finishSync,
    store: {
      profile: vi.fn(async () => profile),
      localStatus: vi.fn(async (base) => ({ ...base, pendingChanges: 0, openConflicts: 0 })),
      activateProfile: vi.fn(async (nextVaultId: string, nextDeviceId: string) => {
        profile.vaultId = nextVaultId
        profile.deviceId = nextDeviceId
        return profile
      }),
      queueAllLocalEntities: vi.fn(async () => undefined),
      claimPendingChanges: vi.fn(async () => []),
      applyPullPage: vi.fn(async (_expected, nextCursor: string) => {
        profile.lastPullCursor = nextCursor
        return 0
      }),
      acknowledgePush: vi.fn(async () => ({ accepted: 0, conflicts: 0 })),
      finishSync,
      recordError: vi.fn(async () => undefined)
    } as unknown as SQLiteSyncStore
  }
}

describe('mobile sync controller live RPC contract', () => {
  it('proves recovery before registration and sends bigint pull cursors as strings', async () => {
    const recoveryCode = createRecoveryCode()
    const vaultKey = createVaultKey()
    const envelope = wrapVaultKeyForRecovery(vaultKey, recoveryCode, vaultId, 1)
    const rpcCalls: Array<{ name: string; parameters: Record<string, unknown> | undefined }> = []
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: fakeSession() }, error: null }))
      },
      rpc: vi.fn(async (name: string, parameters?: Record<string, unknown>) => {
        rpcCalls.push({ name, parameters })
        if (name === 'get_storybound_bootstrap') {
          return { data: { vaultId, keyEpoch: 1, devices: [] }, error: null }
        }
        if (name === 'register_storybound_device') {
          return { data: { recoveryEnvelope: envelope }, error: null }
        }
        if (name === 'pull_storybound_changes') {
          return { data: { changes: [], nextCursor: hugeCursor, hasMore: false }, error: null }
        }
        if (name === 'push_storybound_mutations') {
          return {
            data: [
              {
                mutationId,
                status: 'accepted',
                remoteRevision: '9223372036854775807',
                duplicate: false
              }
            ],
            error: null
          }
        }
        throw new Error(`Unexpected RPC: ${name}`)
      })
    } as unknown as SupabaseClient
    const backend = new MemorySecureStore()
    const storage = new ChunkedSecureStorage('vault-test', backend)
    const local = fakeStore(hugeCursor)
    vi.mocked(local.store.claimPendingChanges)
      .mockResolvedValueOnce([
        {
          mutationId,
          entityType: 'chapter',
          entityId: 'chapter-1',
          operation: 'upsert',
          baseRemoteRevision: null,
          rowVersion: 1,
          changedAt: '2026-08-06T12:30:00Z',
          value: { id: 'chapter-1', title: 'Encrypted' }
        }
      ])
      .mockResolvedValue([])
    const controller = new StoryboundMobileSyncController(local.store, {
      client,
      credentialStorage: storage,
      createId: () => deviceId,
      createDeviceToken: () => deviceToken,
      now: () => new Date('2026-08-06T13:00:00Z')
    })

    await controller.recoverVault(recoveryCode, 'My phone')
    await controller.syncNow()

    expect(rpcCalls.find((call) => call.name === 'register_storybound_device')?.parameters).toEqual(
      {
        p_vault_id: vaultId,
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_device_name: 'My phone',
        p_recovery_verifier: recoveryVerifier(recoveryCode, vaultId)
      }
    )
    const pulls = rpcCalls.filter((call) => call.name === 'pull_storybound_changes')
    expect(pulls).toHaveLength(2)
    expect(pulls[0].parameters).toMatchObject({
      p_vault_id: vaultId,
      p_device_id: deviceId,
      p_device_token: deviceToken,
      p_cursor: hugeCursor,
      p_limit: 100
    })
    expect(typeof pulls[0].parameters?.p_cursor).toBe('string')
    const pushes = rpcCalls.filter((call) => call.name === 'push_storybound_mutations')
    expect(pushes).toHaveLength(1)
    expect(pushes[0].parameters).toMatchObject({
      p_vault_id: vaultId,
      p_device_id: deviceId,
      p_device_token: deviceToken
    })

    const credentials = parseVaultCredentials(
      (await storage.getItem(`storybound.vault.v1.${userId}`)) ?? ''
    )
    expect(credentials).toMatchObject({
      version: 2,
      userId,
      vaultId,
      deviceId,
      deviceToken,
      keyEpoch: 1
    })
    expect(local.finishSync).toHaveBeenCalledWith('2026-08-06T13:00:00.000Z')
  })

  it('sends a fresh device token when creating a vault', async () => {
    const rpcCalls: Array<{ name: string; parameters: Record<string, unknown> | undefined }> = []
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: fakeSession() }, error: null }))
      },
      rpc: vi.fn(async (name: string, parameters?: Record<string, unknown>) => {
        rpcCalls.push({ name, parameters })
        if (name === 'get_storybound_bootstrap') return { data: null, error: null }
        if (name === 'create_storybound_vault') return { data: {}, error: null }
        throw new Error(`Unexpected RPC: ${name}`)
      })
    } as unknown as SupabaseClient
    const storage = new ChunkedSecureStorage('vault-test', new MemorySecureStore())
    const ids = [vaultId, deviceId]
    const controller = new StoryboundMobileSyncController(fakeStore().store, {
      client,
      credentialStorage: storage,
      createId: () => ids.shift() ?? deviceId,
      createDeviceToken: () => deviceToken
    })

    await controller.createVault('New phone')

    expect(
      rpcCalls.find((call) => call.name === 'create_storybound_vault')?.parameters
    ).toMatchObject({
      p_vault_id: vaultId,
      p_device_id: deviceId,
      p_device_token: deviceToken,
      p_device_name: 'New phone'
    })
  })

  it('treats legacy version-one credentials as locked until recovery', async () => {
    const storage = new ChunkedSecureStorage('vault-test', new MemorySecureStore())
    const legacy = JSON.stringify({
      version: 1,
      userId,
      vaultId,
      deviceId,
      keyEpoch: 1,
      vaultKey: bytesToBase64(new Uint8Array(32).fill(3))
    })
    await storage.setItem(`storybound.vault.v1.${userId}`, legacy)
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: fakeSession() }, error: null }))
      }
    } as unknown as SupabaseClient
    const controller = new StoryboundMobileSyncController(fakeStore().store, {
      client,
      credentialStorage: storage
    })

    await expect(controller.status()).resolves.toMatchObject({ phase: 'locked', deviceId: null })
    await expect(controller.syncNow()).rejects.toThrow('recovery code')
    await expect(storage.getItem(`storybound.vault.v1.${userId}`)).resolves.toBe(legacy)
  })

  it('preserves the account-scoped token across local sign-out and sign-in', async () => {
    const storage = new ChunkedSecureStorage('vault-test', new MemorySecureStore())
    await storage.setItem(
      `storybound.vault.v1.${userId}`,
      JSON.stringify({
        version: 2,
        userId,
        vaultId,
        deviceId,
        deviceToken,
        keyEpoch: 1,
        vaultKey: bytesToBase64(new Uint8Array(32).fill(3))
      })
    )
    let session: Session | null = fakeSession()
    const signOut = vi.fn(async () => {
      session = null
      return { error: null }
    })
    const signInWithPassword = vi.fn(async () => {
      session = fakeSession()
      return { error: null }
    })
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session }, error: null })),
        signOut,
        signInWithPassword
      }
    } as unknown as SupabaseClient
    const controller = new StoryboundMobileSyncController(fakeStore().store, {
      client,
      credentialStorage: storage
    })

    await expect(controller.signOut()).resolves.toMatchObject({ phase: 'signed-out' })
    await expect(controller.signIn('reader@example.com', 'password')).resolves.toMatchObject({
      phase: 'idle',
      deviceId
    })
    expect(
      parseVaultCredentials((await storage.getItem(`storybound.vault.v1.${userId}`)) ?? '')
        ?.deviceToken
    ).toBe(deviceToken)
  })

  it('uses local-scope sign-out so another device session is not revoked', async () => {
    const signOut = vi.fn(async () => ({ error: null }))
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        signOut
      }
    } as unknown as SupabaseClient
    const controller = new StoryboundMobileSyncController(fakeStore().store, {
      client,
      credentialStorage: new ChunkedSecureStorage('vault-test', new MemorySecureStore())
    })

    await controller.signOut()

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
