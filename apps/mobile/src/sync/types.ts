import type {
  DeviceLinkState,
  SyncEnableResult,
  SyncRuntimeStatus,
  SyncRunResult
} from '@storybound/contracts'

export type CoreSyncEntityType = 'library' | 'book' | 'chapter' | 'reading-state'
/** Received but never sent from the phone: book covers arrive as `media-asset` records. */
export type RemoteSyncEntityType = CoreSyncEntityType | 'media-asset'
export const BOOK_COVER_PREFIX = 'book-cover:'
export type CoreSyncOperation = 'upsert' | 'delete'

export interface MobileSyncController {
  status(): Promise<SyncRuntimeStatus>
  signUp(email: string, password: string): Promise<SyncRuntimeStatus>
  signIn(email: string, password: string): Promise<SyncRuntimeStatus>
  signOut(): Promise<SyncRuntimeStatus>
  createVault(deviceName?: string): Promise<SyncEnableResult>
  recoverVault(recoveryCode: string, deviceName?: string): Promise<SyncRuntimeStatus>
  /** Starts linking this device by approval from an unlocked device instead of a code. */
  startDeviceLink(deviceName?: string): Promise<DeviceLinkState>
  checkDeviceLink(): Promise<DeviceLinkState | null>
  confirmDeviceLinkWords(): Promise<DeviceLinkState | null>
  cancelDeviceLink(): Promise<void>
  syncNow(): Promise<SyncRunResult>
}

export interface MobileSyncRuntime {
  controller: MobileSyncController
  dispose(): void
}

export interface VaultCredentials {
  version: 2
  userId: string
  vaultId: string
  deviceId: string
  deviceToken: string
  keyEpoch: number
  vaultKey: string
}
