import type { SyncKeyEnvelope } from '@storybound/contracts'
import { isUuid } from './encoding'
import type { CoreSyncEntityType, CoreSyncOperation } from './types'

export const PAYLOAD_ENCODING = 'aes-256-gcm-v1'
export const PAYLOAD_SCHEMA_VERSION = 1
export const SYNC_PAGE_SIZE = 100

export interface RpcEncryptedPayload {
  ciphertext: string
  nonce: string
  encoding: typeof PAYLOAD_ENCODING
  keyVersion: number
  schemaVersion: number
  hash: string
}

export interface RpcPushMutation {
  mutationId: string
  entityType: CoreSyncEntityType
  entityId: string
  operation: CoreSyncOperation
  baseRemoteRevision: string | null
  protocolVersion: 1
  rowVersion: number
  changeSetId: null
  changedAt: string
  ciphertext: string
  nonce: string
  encoding: typeof PAYLOAD_ENCODING
  keyVersion: number
  schemaVersion: number
  hash: string
}

export type RpcPushResult =
  | {
      mutationId: string
      status: 'accepted'
      remoteRevision: string
      duplicate: boolean
    }
  | {
      mutationId: string
      status: 'conflict'
      remoteRevision: string
      remoteMutationId: string
      remoteDeviceId: string
      remoteOperation: CoreSyncOperation
      remotePayload: RpcEncryptedPayload
    }

export interface RpcRemoteChange {
  mutationId: string
  deviceId: string
  entityType: CoreSyncEntityType
  entityId: string
  operation: CoreSyncOperation
  remoteRevision: string
  changedAt: string
  payload: RpcEncryptedPayload
}

export interface RpcPullResult {
  changes: RpcRemoteChange[]
  nextCursor: string
  hasMore: boolean
}

export interface RpcBootstrap {
  vaultId: string
  keyEpoch: number
  devices: Array<{
    id: string
    displayName: string
    state: 'active' | 'revoked'
    createdAt: string
    lastSeenAt: string | null
    revokedAt: string | null
  }>
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireString(
  value: unknown,
  message: string,
  minimum = 1,
  maximum = 8 * 1024 * 1024
): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new Error(message)
  }
  return value
}

function requireUuid(value: unknown, message: string): string {
  const parsed = requireString(value, message, 36, 36)
  if (!isUuid(parsed)) throw new Error(message)
  return parsed
}

function requirePositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(message)
  }
  return value
}

function requireRevision(value: unknown, message: string): string {
  const parsed = requireString(value, message, 1, 30)
  if (!/^\d+$/u.test(parsed)) throw new Error(message)
  return parsed
}

function requireDate(value: unknown, message: string): string {
  const parsed = requireString(value, message, 1, 80)
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(message)
  return parsed
}

function nullableDate(value: unknown, message: string): string | null {
  return value === null ? null : requireDate(value, message)
}

function requireEntityType(value: unknown): CoreSyncEntityType {
  if (value === 'library' || value === 'book' || value === 'chapter' || value === 'reading-state') {
    return value
  }
  throw new Error('The sync server returned an unsupported entity type.')
}

function requireOperation(value: unknown): CoreSyncOperation {
  if (value === 'upsert' || value === 'delete') return value
  throw new Error('The sync server returned an invalid operation.')
}

function requireBase64(value: unknown, message: string, maximum: number): string {
  const parsed = requireString(value, message, 1, maximum)
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(parsed)) throw new Error(message)
  return parsed
}

export function parseEncryptedPayload(value: unknown): RpcEncryptedPayload {
  const row = asObject(value, 'The sync server returned an invalid encrypted payload.')
  if (row.encoding !== PAYLOAD_ENCODING) {
    throw new Error('The sync server returned an unsupported payload encoding.')
  }
  return {
    ciphertext: requireBase64(
      row.ciphertext,
      'The sync server returned invalid ciphertext.',
      8 * 1024 * 1024
    ),
    nonce: requireBase64(row.nonce, 'The sync server returned an invalid nonce.', 128),
    encoding: PAYLOAD_ENCODING,
    keyVersion: requirePositiveInteger(row.keyVersion, 'The sync key version is invalid.'),
    schemaVersion: requirePositiveInteger(row.schemaVersion, 'The sync schema version is invalid.'),
    hash: requireBase64(row.hash, 'The sync ciphertext hash is invalid.', 256)
  }
}

export function parseBootstrap(value: unknown): RpcBootstrap | null {
  if (value === null) return null
  const row = asObject(value, 'The sync server returned invalid account data.')
  if (!Array.isArray(row.devices) || row.devices.length > 100) {
    throw new Error('The sync server returned invalid device data.')
  }
  return {
    vaultId: requireUuid(row.vaultId, 'The sync vault identifier is invalid.'),
    keyEpoch: requirePositiveInteger(row.keyEpoch, 'The sync key epoch is invalid.'),
    devices: row.devices.map((device) => {
      const item = asObject(device, 'The sync server returned invalid device data.')
      if (item.state !== 'active' && item.state !== 'revoked') {
        throw new Error('The sync server returned an invalid device state.')
      }
      return {
        id: requireUuid(item.id, 'The sync device identifier is invalid.'),
        displayName: requireString(item.displayName, 'The sync device name is invalid.', 1, 120),
        state: item.state,
        createdAt: requireDate(item.createdAt, 'The sync device creation date is invalid.'),
        lastSeenAt: nullableDate(item.lastSeenAt, 'The sync device activity date is invalid.'),
        revokedAt: nullableDate(item.revokedAt, 'The sync device revocation date is invalid.')
      }
    })
  }
}

export function parseRecoveryEnvelope(value: unknown): SyncKeyEnvelope {
  const response = asObject(value, 'The sync server omitted the recovery envelope.')
  const row = asObject(response.recoveryEnvelope, 'The sync server omitted the recovery envelope.')
  if (row.version !== 1 || row.kind !== 'recovery') {
    throw new Error('The sync server returned an unsupported recovery envelope.')
  }
  return {
    version: 1,
    kind: 'recovery',
    vaultId: requireUuid(row.vaultId, 'The recovery vault identifier is invalid.'),
    keyEpoch: requirePositiveInteger(row.keyEpoch, 'The recovery key epoch is invalid.'),
    nonce: requireBase64(row.nonce, 'The recovery nonce is invalid.', 128),
    ciphertext: requireBase64(row.ciphertext, 'The recovery ciphertext is invalid.', 4096)
  }
}

export function parsePushResults(value: unknown): RpcPushResult[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('The sync server returned an invalid push result.')
  }
  return value.map((result) => {
    const row = asObject(result, 'The sync server returned an invalid push result.')
    const common = {
      mutationId: requireUuid(row.mutationId, 'The pushed mutation identifier is invalid.'),
      remoteRevision: requireRevision(row.remoteRevision, 'The remote revision is invalid.')
    }
    if (row.status === 'accepted') {
      return { ...common, status: 'accepted' as const, duplicate: row.duplicate === true }
    }
    if (row.status === 'conflict') {
      return {
        ...common,
        status: 'conflict' as const,
        remoteMutationId: requireUuid(
          row.remoteMutationId,
          'The conflicting mutation identifier is invalid.'
        ),
        remoteDeviceId: requireUuid(
          row.remoteDeviceId,
          'The conflicting device identifier is invalid.'
        ),
        remoteOperation: requireOperation(row.remoteOperation),
        remotePayload: parseEncryptedPayload(row.remotePayload)
      }
    }
    throw new Error('The sync server returned an unknown push status.')
  })
}

export function parsePullResult(value: unknown): RpcPullResult {
  const row = asObject(value, 'The sync server returned an invalid pull result.')
  if (!Array.isArray(row.changes) || row.changes.length > 500 || typeof row.hasMore !== 'boolean') {
    throw new Error('The sync server returned an invalid pull result.')
  }
  return {
    changes: row.changes.map((change) => {
      const item = asObject(change, 'The sync server returned an invalid remote change.')
      return {
        mutationId: requireUuid(item.mutationId, 'The remote mutation identifier is invalid.'),
        deviceId: requireUuid(item.deviceId, 'The remote device identifier is invalid.'),
        entityType: requireEntityType(item.entityType),
        entityId: requireString(item.entityId, 'The remote entity identifier is invalid.', 1, 240),
        operation: requireOperation(item.operation),
        remoteRevision: requireRevision(item.remoteRevision, 'The remote revision is invalid.'),
        changedAt: requireDate(item.changedAt, 'The remote change date is invalid.'),
        payload: parseEncryptedPayload(item.payload)
      }
    }),
    nextCursor: requireRevision(row.nextCursor, 'The next sync cursor is invalid.'),
    hasMore: row.hasMore
  }
}
