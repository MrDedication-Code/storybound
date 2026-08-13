export const SYNC_PROTOCOL_VERSION = 1
export const SYNC_ENCRYPTION_ALGORITHM = 'AES-256-GCM' as const

export type SyncEntityType =
  | 'library'
  | 'book'
  | 'chapter'
  | 'chapter-order'
  | 'tag'
  | 'book-tag'
  | 'collection'
  | 'collection-book'
  | 'saved-filter'
  | 'bookmark'
  | 'annotation'
  | 'story-entity'
  | 'story-entity-relation'
  | 'story-entity-chapter'
  | 'writing-goal'
  | 'writing-event'
  | 'reading-state'
  | 'reader-preferences'
  | 'media-asset'

export type SyncOperation = 'upsert' | 'delete'
export type SyncConflictResolution = 'keep-local' | 'use-remote' | 'keep-both'
export type SyncConnectionPhase =
  'local-only' | 'signed-out' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncCiphertext {
  algorithm: typeof SYNC_ENCRYPTION_ALGORITHM
  keyEpoch: number
  nonce: string
  ciphertext: string
  hash: string
}

export interface SyncKeyEnvelope {
  version: 1
  kind: 'recovery' | 'device'
  vaultId: string
  keyEpoch: number
  nonce: string
  ciphertext: string
  recipientPublicKey?: string
}

export interface SyncMutationEnvelope {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  schemaVersion: number
  mutationId: string
  changeSetId: string
  vaultId: string
  deviceId: string
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
  baseRevision: number | null
  createdAt: string
  payload: SyncCiphertext
}

export interface SyncPushBatchRequest {
  vaultId: string
  deviceId: string
  operationId: string
  baseSequence: number
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  keyEpoch: number
  nonce: string
  ciphertext: string
  ciphertextHash: string
}

export interface SyncPushBatchResult {
  sequence: number
  headSequence: number
  duplicate: boolean
}

export interface SyncRemoteBatch {
  sequence: number
  operationId: string
  deviceId: string
  baseSequence: number
  protocolVersion: number
  keyEpoch: number
  nonce: string
  ciphertext: string
  ciphertextHash: string
  createdAt: string
}

export interface SyncPullResult {
  batches: SyncRemoteBatch[]
  nextCursor: number
  headSequence: number
  hasMore: boolean
}

export interface SyncDeviceSummary {
  id: string
  displayName: string
  state: 'pending' | 'active' | 'revoked'
  createdAt: string
  approvedAt: string | null
  revokedAt: string | null
  lastSeenAt: string | null
}

export interface SyncRuntimeStatus {
  configured: boolean
  phase: SyncConnectionPhase
  accountEmail: string | null
  vaultId: string | null
  deviceId: string | null
  pendingChanges: number
  openConflicts: number
  lastSyncAt: string | null
  lastError: string | null
}

export interface SyncCredentialsInput {
  email: string
  password: string
}

export interface SyncEnableResult {
  status: SyncRuntimeStatus
  recoveryCode: string
}

export interface SyncRunResult {
  pulled: number
  pushed: number
  conflicts: number
  pending: number
  syncedAt: string
}

export interface SyncRecoveryInput {
  recoveryCode: string
  deviceName?: string
}

export interface SyncConflictRecord {
  id: string
  libraryId: string
  entityType: SyncEntityType
  entityId: string
  localMutationId: string | null
  remoteRevision: string
  kind: 'concurrent-update' | 'delete-versus-edit' | 'ordering' | 'unique-key'
  status: 'open' | 'resolved' | 'ignored'
  createdAt: string
  resolvedAt: string | null
}

export interface SyncResolveConflictInput {
  id: string
  resolution: Extract<SyncConflictResolution, 'keep-local' | 'use-remote'>
}
