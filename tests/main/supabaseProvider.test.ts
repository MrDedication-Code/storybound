import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { SupabaseSyncProvider } from '../../src/main/cloud/supabaseProvider'

const VAULT_ID = '10000000-0000-4000-8000-000000000001'
const DEVICE_ID = '20000000-0000-4000-8000-000000000001'
const MUTATION_ID = '30000000-0000-4000-8000-000000000001'
const DEVICE_TOKEN = 'device-token-with-at-least-thirty-two-characters'

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}

describe('SupabaseSyncProvider', () => {
  it('converts binary encrypted mutations to the bounded RPC transport contract', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          mutationId: MUTATION_ID,
          status: 'accepted',
          remoteRevision: '7',
          duplicate: false
        }
      ],
      error: null
    }))
    const provider = new SupabaseSyncProvider(clientWithRpc(rpc), DEVICE_TOKEN)

    await expect(
      provider.push({
        remoteLibraryId: VAULT_ID,
        deviceId: DEVICE_ID,
        mutations: [
          {
            mutationId: MUTATION_ID,
            entityType: 'chapter',
            entityId: 'chapter-a',
            operation: 'upsert',
            baseRemoteRevision: null,
            changeSetId: null,
            rowVersion: 1,
            changedAt: '2026-08-06T20:00:00.000Z',
            payload: {
              ciphertext: Buffer.from('encrypted-only'),
              nonce: Buffer.from('0123456789ab'),
              encoding: 'aes-256-gcm-v1',
              keyVersion: 1,
              schemaVersion: 1,
              hash: 'ciphertext-hash'
            }
          }
        ]
      })
    ).resolves.toEqual({
      results: [
        {
          mutationId: MUTATION_ID,
          status: 'accepted',
          remoteRevision: '7',
          duplicate: false
        }
      ]
    })

    expect(rpc).toHaveBeenCalledWith('push_storybound_mutations', {
      p_vault_id: VAULT_ID,
      p_device_id: DEVICE_ID,
      p_device_token: DEVICE_TOKEN,
      p_mutations: [
        expect.objectContaining({
          mutationId: MUTATION_ID,
          entityType: 'chapter',
          ciphertext: Buffer.from('encrypted-only').toString('base64'),
          nonce: Buffer.from('0123456789ab').toString('base64')
        })
      ]
    })
  })

  it('validates pull results and reconstructs binary payloads', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        changes: [
          {
            mutationId: MUTATION_ID,
            deviceId: DEVICE_ID,
            entityType: 'chapter',
            entityId: 'chapter-a',
            operation: 'upsert',
            remoteRevision: '8',
            changedAt: '2026-08-06T20:00:00.000Z',
            payload: {
              ciphertext: Buffer.from('cipher').toString('base64'),
              nonce: Buffer.from('0123456789ab').toString('base64'),
              encoding: 'aes-256-gcm-v1',
              keyVersion: 1,
              schemaVersion: 1,
              hash: 'ciphertext-hash'
            }
          }
        ],
        nextCursor: '8',
        hasMore: false
      },
      error: null
    }))
    const provider = new SupabaseSyncProvider(clientWithRpc(rpc), DEVICE_TOKEN)

    const result = await provider.pull({
      remoteLibraryId: VAULT_ID,
      deviceId: DEVICE_ID,
      cursor: '7',
      limit: 100
    })

    expect(Buffer.from(result.changes[0].payload.ciphertext).toString()).toBe('cipher')
    expect(rpc).toHaveBeenCalledWith('pull_storybound_changes', {
      p_vault_id: VAULT_ID,
      p_device_id: DEVICE_ID,
      p_device_token: DEVICE_TOKEN,
      p_cursor: '7',
      p_limit: 100
    })
  })

  it('fails closed when the server returns malformed routing metadata', async () => {
    const provider = new SupabaseSyncProvider(
      clientWithRpc(vi.fn(async () => ({ data: { changes: [] }, error: null }))),
      DEVICE_TOKEN
    )

    await expect(
      provider.pull({ remoteLibraryId: VAULT_ID, deviceId: DEVICE_ID, cursor: null, limit: 100 })
    ).rejects.toThrow('invalid pull result')
  })
})
