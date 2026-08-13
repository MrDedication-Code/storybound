import type { SyncEnableResult, SyncRuntimeStatus, SyncRunResult } from '@storybound/contracts'

export type CoreSyncEntityType = 'library' | 'book' | 'chapter' | 'reading-state'
export type CoreSyncOperation = 'upsert' | 'delete'

export interface MobileSyncController {
  status(): Promise<SyncRuntimeStatus>
  signUp(email: string, password: string): Promise<SyncRuntimeStatus>
  signIn(email: string, password: string): Promise<SyncRuntimeStatus>
  signOut(): Promise<SyncRuntimeStatus>
  createVault(deviceName?: string): Promise<SyncEnableResult>
  recoverVault(recoveryCode: string, deviceName?: string): Promise<SyncRuntimeStatus>
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
