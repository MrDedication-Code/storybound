import type { SupabaseClient } from '@supabase/supabase-js'
import type { PasswordResetInput } from '@storybound/contracts'
import type {
  DeviceLinkState,
  SyncEnableResult,
  SyncRuntimeStatus,
  SyncRunResult
} from '@storybound/contracts'

export type CoreSyncEntityType =
  'library' | 'book' | 'chapter' | 'reading-state' | 'annotation' | 'bookmark'
/** Received but never sent from the phone: book covers arrive as `media-asset` records. */
export type RemoteSyncEntityType = CoreSyncEntityType | 'media-asset'
export const BOOK_COVER_PREFIX = 'book-cover:'
export type CoreSyncOperation = 'upsert' | 'delete'

export interface AccountAccess {
  client: SupabaseClient
  userId: string
  email: string | null
}

export interface MobileSyncController {
  status(): Promise<SyncRuntimeStatus>
  signUp(email: string, password: string): Promise<SyncRuntimeStatus>
  signIn(email: string, password: string): Promise<SyncRuntimeStatus>
  signOut(): Promise<SyncRuntimeStatus>
  /** Emails a code for setting a new password. */
  requestPasswordReset(email: string): Promise<void>
  resetPassword(input: PasswordResetInput): Promise<SyncRuntimeStatus>
  /** Removes the account from the server and signs out. The books on this phone stay. */
  deleteAccount(): Promise<SyncRuntimeStatus>
  /** False in a build with no server. */
  isConfigured(): boolean
  /** An account is all the Bookstore needs: sync does not have to be set up. */
  accountAccess(): Promise<AccountAccess | null>
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
