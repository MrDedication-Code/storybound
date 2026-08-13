export type SyncOperation = 'upsert' | 'delete'

export interface EncryptedSyncPayload {
  ciphertext: Uint8Array
  nonce: Uint8Array
  encoding: string
  keyVersion: number
  schemaVersion: number
  hash: string
}

export interface SyncMutationEnvelope {
  mutationId: string
  entityType: string
  entityId: string
  operation: SyncOperation
  baseRemoteRevision: string | null
  changeSetId: string | null
  rowVersion: number
  changedAt: string
  payload: EncryptedSyncPayload
}

export interface PushSyncRequest {
  remoteLibraryId: string
  deviceId: string
  mutations: readonly SyncMutationEnvelope[]
}

export type PushMutationResult =
  | {
      mutationId: string
      status: 'accepted'
      remoteRevision: string
      remoteEtag?: string
    }
  | {
      mutationId: string
      status: 'conflict'
      remoteRevision: string
      remoteEtag?: string
      remoteMutationId: string
      remoteDeviceId: string
      remoteOperation: SyncOperation
      remotePayload: EncryptedSyncPayload
    }

export interface PushSyncResponse {
  results: readonly PushMutationResult[]
}

export interface PullSyncRequest {
  remoteLibraryId: string
  deviceId: string
  cursor: string | null
  limit: number
}

export interface RemoteSyncChange {
  mutationId: string
  deviceId: string
  entityType: string
  entityId: string
  operation: SyncOperation
  remoteRevision: string
  remoteEtag?: string
  changedAt: string
  payload: EncryptedSyncPayload
}

export interface PullSyncResponse {
  changes: readonly RemoteSyncChange[]
  nextCursor: string
  hasMore: boolean
}

/**
 * A transport boundary only. Implementations may use HTTPS, a local test server, or another
 * provider, but they must preserve opaque cursors, server revisions, and mutation idempotency.
 */
export interface SyncProvider {
  push(request: PushSyncRequest): Promise<PushSyncResponse>
  pull(request: PullSyncRequest): Promise<PullSyncResponse>
}
