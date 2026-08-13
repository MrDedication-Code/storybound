import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { StoryboundError } from '../errors'
import type {
  EncryptedSyncPayload,
  PullSyncRequest,
  PullSyncResponse,
  PushSyncRequest,
  PushSyncResponse,
  SyncProvider
} from '../sync/provider'

const encryptedPayloadSchema = z.object({
  ciphertext: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
  nonce: z.string().min(1).max(128),
  encoding: z.string().min(1).max(80),
  keyVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  hash: z.string().min(1).max(256)
})

const pushResultSchema = z.array(
  z.discriminatedUnion('status', [
    z.object({
      mutationId: z.uuid(),
      status: z.literal('accepted'),
      remoteRevision: z.string().min(1),
      duplicate: z.boolean().optional()
    }),
    z.object({
      mutationId: z.uuid(),
      status: z.literal('conflict'),
      remoteRevision: z.string().min(1),
      remoteMutationId: z.uuid(),
      remoteDeviceId: z.uuid(),
      remoteOperation: z.enum(['upsert', 'delete']),
      remotePayload: encryptedPayloadSchema
    })
  ])
)

const pullResultSchema = z.object({
  changes: z.array(
    z.object({
      mutationId: z.uuid(),
      deviceId: z.uuid(),
      entityType: z.string().min(1).max(80),
      entityId: z.string().min(1).max(240),
      operation: z.enum(['upsert', 'delete']),
      remoteRevision: z.string().min(1),
      changedAt: z.iso.datetime(),
      payload: encryptedPayloadSchema
    })
  ),
  nextCursor: z.string().regex(/^\d+$/),
  hasMore: z.boolean()
})

function toBytes(payload: z.infer<typeof encryptedPayloadSchema>): EncryptedSyncPayload {
  return {
    ciphertext: Buffer.from(payload.ciphertext, 'base64'),
    nonce: Buffer.from(payload.nonce, 'base64'),
    encoding: payload.encoding,
    keyVersion: payload.keyVersion,
    schemaVersion: payload.schemaVersion,
    hash: payload.hash
  }
}

function rpcFailure(message: string, error: unknown): StoryboundError {
  return new StoryboundError('NETWORK_ERROR', message, error)
}

export class SupabaseSyncProvider implements SyncProvider {
  constructor(
    private readonly client: SupabaseClient,
    private readonly deviceToken: string
  ) {}

  async push(request: PushSyncRequest): Promise<PushSyncResponse> {
    const mutations = request.mutations.map((mutation) => ({
      mutationId: mutation.mutationId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operation: mutation.operation,
      baseRemoteRevision: mutation.baseRemoteRevision,
      protocolVersion: 1,
      rowVersion: mutation.rowVersion,
      changeSetId: mutation.changeSetId,
      changedAt: mutation.changedAt,
      ciphertext: Buffer.from(mutation.payload.ciphertext).toString('base64'),
      nonce: Buffer.from(mutation.payload.nonce).toString('base64'),
      encoding: mutation.payload.encoding,
      keyVersion: mutation.payload.keyVersion,
      schemaVersion: mutation.payload.schemaVersion,
      hash: mutation.payload.hash
    }))
    const { data, error } = await this.client.rpc('push_storybound_mutations', {
      p_vault_id: request.remoteLibraryId,
      p_device_id: request.deviceId,
      p_device_token: this.deviceToken,
      p_mutations: mutations
    })
    if (error) throw rpcFailure('Storybound could not upload encrypted changes.', error)
    const parsed = pushResultSchema.safeParse(data)
    if (!parsed.success) {
      throw new StoryboundError('NETWORK_ERROR', 'The sync server returned an invalid push result.')
    }
    return {
      results: parsed.data.map((result) =>
        result.status === 'accepted'
          ? result
          : { ...result, remotePayload: toBytes(result.remotePayload) }
      )
    }
  }

  async pull(request: PullSyncRequest): Promise<PullSyncResponse> {
    const cursor = request.cursor ?? '0'
    if (!/^\d+$/.test(cursor)) {
      throw new StoryboundError('VALIDATION_ERROR', 'The local sync cursor is invalid.')
    }
    const { data, error } = await this.client.rpc('pull_storybound_changes', {
      p_vault_id: request.remoteLibraryId,
      p_device_id: request.deviceId,
      p_device_token: this.deviceToken,
      p_cursor: cursor,
      p_limit: request.limit
    })
    if (error) throw rpcFailure('Storybound could not download encrypted changes.', error)
    const parsed = pullResultSchema.safeParse(data)
    if (!parsed.success) {
      throw new StoryboundError('NETWORK_ERROR', 'The sync server returned an invalid pull result.')
    }
    return {
      ...parsed.data,
      changes: parsed.data.changes.map((change) => ({
        ...change,
        payload: toBytes(change.payload)
      }))
    }
  }
}
