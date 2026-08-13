import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { SyncCiphertext, SyncRuntimeStatus, SyncRunResult } from '@storybound/contracts'
import {
  createRecoveryCode,
  createVaultKey,
  decryptSyncPayload,
  encryptSyncPayload,
  recoveryVerifier,
  unwrapVaultKeyFromRecovery,
  wrapVaultKeyForRecovery,
  type SyncAssociatedData
} from '@storybound/sync'
import { getRandomBytes, randomUUID } from 'expo-crypto'
import type {
  DecryptedRemoteChange,
  PendingSyncChange,
  SQLiteSyncStore
} from '../data/sqlite/sqliteSyncStore'
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  isUuid
} from './encoding'
import {
  PAYLOAD_ENCODING,
  PAYLOAD_SCHEMA_VERSION,
  SYNC_PAGE_SIZE,
  parseBootstrap,
  parsePullResult,
  parsePushResults,
  parseRecoveryEnvelope,
  type RpcEncryptedPayload,
  type RpcPushMutation,
  type RpcBootstrap
} from './rpcContract'
import { ChunkedSecureStorage } from './secureStore'
import { connectionPhase } from './state'
import type { MobileSyncController, VaultCredentials } from './types'

const VAULT_CREDENTIAL_KEY = 'storybound.vault.v1'
const DEFAULT_DEVICE_NAME = 'Storybound mobile'
const MAX_SYNC_PAGES = 100

interface ControllerDependencies {
  client: SupabaseClient | null
  credentialStorage?: ChunkedSecureStorage | null
  configurationError?: string | null
  now?: () => Date
  createId?: () => string
  createDeviceToken?: () => string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function validDeviceName(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_DEVICE_NAME
  if (trimmed.length > 120) throw new Error('The device name must be 120 characters or fewer.')
  return trimmed
}

function cursorValue(cursor: string | null): string {
  const value = cursor ?? '0'
  if (!/^\d+$/u.test(value)) throw new Error('The local sync cursor is invalid.')
  return value
}

function vaultCredentialKey(userId: string): string {
  return `${VAULT_CREDENTIAL_KEY}.${userId}`
}

function isCanonicalDeviceToken(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false
  const bytes = base64UrlToBytes(value)
  return bytes.length === 32 && bytesToBase64Url(bytes) === value
}

export function parseVaultCredentials(raw: string): VaultCredentials | null {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The local encrypted-sync credentials are invalid.')
  }
  const record = parsed as Record<string, unknown>
  if (record.version === 1) return null
  const value = record as Partial<VaultCredentials>
  const vaultKey = typeof value.vaultKey === 'string' ? base64ToBytes(value.vaultKey) : null
  if (
    value.version !== 2 ||
    typeof value.userId !== 'string' ||
    !isUuid(value.userId) ||
    typeof value.vaultId !== 'string' ||
    !isUuid(value.vaultId) ||
    typeof value.deviceId !== 'string' ||
    !isUuid(value.deviceId) ||
    !isCanonicalDeviceToken(value.deviceToken) ||
    typeof value.keyEpoch !== 'number' ||
    !Number.isSafeInteger(value.keyEpoch) ||
    value.keyEpoch < 1 ||
    typeof value.vaultKey !== 'string' ||
    vaultKey?.length !== 32 ||
    bytesToBase64(vaultKey) !== value.vaultKey
  ) {
    throw new Error('The local encrypted-sync credentials are invalid.')
  }
  return value as VaultCredentials
}

function associatedData(
  vaultId: string,
  mutationId: string,
  entityType: PendingSyncChange['entityType'],
  entityId: string,
  operation: PendingSyncChange['operation'],
  schemaVersion = PAYLOAD_SCHEMA_VERSION
): SyncAssociatedData {
  return {
    protocolVersion: 1,
    schemaVersion,
    vaultId,
    mutationId,
    entityType,
    entityId,
    operation
  }
}

function asCiphertext(payload: RpcEncryptedPayload): SyncCiphertext {
  return {
    algorithm: 'AES-256-GCM',
    keyEpoch: payload.keyVersion,
    nonce: payload.nonce,
    ciphertext: payload.ciphertext,
    hash: payload.hash
  }
}

export class StoryboundMobileSyncController implements MobileSyncController {
  private readonly client: SupabaseClient | null
  private readonly storage: ChunkedSecureStorage | null
  private readonly configurationError: string | null
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly createDeviceToken: () => string
  private lastRuntimeError: string | null = null
  private activeRun: Promise<SyncRunResult> | null = null

  constructor(
    private readonly store: SQLiteSyncStore,
    dependencies: ControllerDependencies
  ) {
    this.client = dependencies.client
    this.storage = dependencies.credentialStorage ?? null
    this.configurationError = dependencies.configurationError ?? null
    this.now = dependencies.now ?? (() => new Date())
    this.createId = dependencies.createId ?? randomUUID
    this.createDeviceToken =
      dependencies.createDeviceToken ?? (() => bytesToBase64Url(getRandomBytes(32)))
  }

  async status(): Promise<SyncRuntimeStatus> {
    const configured = this.client !== null && this.storage !== null
    let session: Session | null = null
    let sessionError: string | null = null
    if (this.client) {
      const result = await this.client.auth.getSession()
      session = result.data.session
      sessionError = result.error?.message ?? null
    }
    const credentials = session ? await this.readCredentials(session.user.id) : null
    const profile = await this.store.profile()
    const lastError =
      this.configurationError ?? sessionError ?? this.lastRuntimeError ?? profile?.lastError ?? null
    const unlocked = credentials !== null
    return this.store.localStatus({
      configured,
      phase: connectionPhase({
        configured,
        signedIn: session !== null,
        unlocked,
        syncing: this.activeRun !== null,
        hasError:
          sessionError !== null ||
          (unlocked && (this.lastRuntimeError !== null || profile?.lastError != null))
      }),
      accountEmail: session?.user.email ?? null,
      vaultId: credentials?.vaultId ?? profile?.vaultId ?? null,
      deviceId: credentials?.deviceId ?? null,
      lastSyncAt: profile?.lastSyncAt ?? null,
      lastError
    })
  }

  async signUp(email: string, password: string): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    this.lastRuntimeError = null
    const { data, error } = await client.auth.signUp({ email: email.trim(), password })
    if (error) throw new Error(error.message)
    if (data.session) await this.restoreProfileForSession()
    return this.status()
  }

  async signIn(email: string, password: string): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    this.lastRuntimeError = null
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(error.message)
    await this.restoreProfileForSession()
    return this.status()
  }

  async signOut(): Promise<SyncRuntimeStatus> {
    const { error } = await this.requireClient().auth.signOut({ scope: 'local' })
    if (error) throw new Error(error.message)
    this.lastRuntimeError = null
    return this.status()
  }

  async createVault(
    deviceName?: string
  ): Promise<{ status: SyncRuntimeStatus; recoveryCode: string }> {
    const client = this.requireClient()
    const session = await this.requireSession()
    if (await this.bootstrap()) throw new Error('This account already has a Storybound sync vault.')

    const vaultId = this.createId()
    const deviceId = this.createId()
    const deviceToken = this.createDeviceToken()
    const recoveryCode = createRecoveryCode()
    const vaultKey = createVaultKey()
    const keyEpoch = 1
    const envelope = wrapVaultKeyForRecovery(vaultKey, recoveryCode, vaultId, keyEpoch)
    await this.saveCredentials(session.user.id, {
      vaultId,
      deviceId,
      deviceToken,
      keyEpoch,
      vaultKey
    })
    const { error } = await client.rpc('create_storybound_vault', {
      p_vault_id: vaultId,
      p_device_id: deviceId,
      p_device_token: deviceToken,
      p_device_name: validDeviceName(deviceName),
      p_key_epoch: keyEpoch,
      p_recovery_verifier: recoveryVerifier(recoveryCode, vaultId),
      p_recovery_nonce: envelope.nonce,
      p_recovery_ciphertext: envelope.ciphertext
    })
    if (error) {
      await this.requireStorage().removeItem(vaultCredentialKey(session.user.id))
      throw new Error(error.message)
    }
    try {
      await this.store.activateProfile(vaultId, deviceId)
      await this.store.queueAllLocalEntities()
      this.lastRuntimeError = null
    } catch (caught) {
      const message = errorMessage(caught, 'The local library could not be queued for sync.')
      this.lastRuntimeError = message
      await this.store.recordError(message).catch(() => undefined)
    }
    return { status: await this.status(), recoveryCode }
  }

  async recoverVault(recoveryCode: string, deviceName?: string): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    const session = await this.requireSession()
    const bootstrap = await this.bootstrap()
    if (!bootstrap) throw new Error('This account has no Storybound sync vault.')
    const deviceId = this.createId()
    const deviceToken = this.createDeviceToken()
    const { data, error } = await client.rpc('register_storybound_device', {
      p_vault_id: bootstrap.vaultId,
      p_device_id: deviceId,
      p_device_token: deviceToken,
      p_device_name: validDeviceName(deviceName),
      p_recovery_verifier: recoveryVerifier(recoveryCode.trim(), bootstrap.vaultId)
    })
    if (error) throw new Error(error.message)
    const envelope = parseRecoveryEnvelope(data)
    if (envelope.vaultId !== bootstrap.vaultId || envelope.keyEpoch !== bootstrap.keyEpoch) {
      throw new Error('The sync server returned a mismatched recovery envelope.')
    }
    let vaultKey: Uint8Array
    try {
      vaultKey = unwrapVaultKeyFromRecovery(envelope, recoveryCode.trim())
    } catch {
      throw new Error('That recovery code is not valid.')
    }
    await this.saveAndActivate(session.user.id, {
      vaultId: bootstrap.vaultId,
      deviceId,
      deviceToken,
      keyEpoch: bootstrap.keyEpoch,
      vaultKey
    })
    this.lastRuntimeError = null
    return this.status()
  }

  syncNow(): Promise<SyncRunResult> {
    if (!this.activeRun) {
      this.activeRun = this.runOnce().finally(() => {
        this.activeRun = null
      })
    }
    return this.activeRun
  }

  private async runOnce(): Promise<SyncRunResult> {
    let pulled = 0
    let pushed = 0
    let conflicts = 0
    try {
      const session = await this.requireSession()
      const credentials = await this.readCredentials(session.user.id)
      if (!credentials) throw new Error('Unlock sync with your recovery code first.')
      const profile = await this.store.activateProfile(credentials.vaultId, credentials.deviceId)
      const vaultKey = base64ToBytes(credentials.vaultKey)

      pulled += await this.pullAll(credentials, vaultKey, profile.lastPullCursor)
      for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
        const claimed = await this.store.claimPendingChanges(this.createId, SYNC_PAGE_SIZE)
        if (claimed.length === 0) break
        const mutations = claimed.map((change) =>
          this.encryptMutation(credentials, vaultKey, change)
        )
        const { data, error } = await this.requireClient().rpc('push_storybound_mutations', {
          p_vault_id: credentials.vaultId,
          p_device_id: credentials.deviceId,
          p_device_token: credentials.deviceToken,
          p_mutations: mutations
        })
        if (error) throw new Error(error.message)
        const results = parsePushResults(data)
        this.validatePushResults(
          claimed,
          results.map((result) => result.mutationId)
        )
        const acknowledged = await this.store.acknowledgePush(results, claimed)
        pushed += acknowledged.accepted
        conflicts += acknowledged.conflicts
      }
      const latestProfile = await this.store.profile()
      pulled += await this.pullAll(credentials, vaultKey, latestProfile?.lastPullCursor ?? null)
      const syncedAt = this.now().toISOString()
      await this.store.finishSync(syncedAt)
      this.lastRuntimeError = null
      const status = await this.status()
      return { pulled, pushed, conflicts, pending: status.pendingChanges, syncedAt }
    } catch (error) {
      const message = errorMessage(error, 'Encrypted sync failed.')
      this.lastRuntimeError = message
      await this.store.recordError(message).catch(() => undefined)
      throw error
    }
  }

  private async pullAll(
    credentials: VaultCredentials,
    vaultKey: Uint8Array,
    initialCursor: string | null
  ): Promise<number> {
    let cursor = initialCursor
    let pulled = 0
    for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
      const { data, error } = await this.requireClient().rpc('pull_storybound_changes', {
        p_vault_id: credentials.vaultId,
        p_device_id: credentials.deviceId,
        p_device_token: credentials.deviceToken,
        p_cursor: cursorValue(cursor),
        p_limit: SYNC_PAGE_SIZE
      })
      if (error) throw new Error(error.message)
      const response = parsePullResult(data)
      const changes = response.changes.map<DecryptedRemoteChange>((change) => {
        if (change.payload.keyVersion !== credentials.keyEpoch) {
          throw new Error('A remote change uses an unavailable sync key version.')
        }
        return {
          ...change,
          value: decryptSyncPayload<unknown>(
            vaultKey,
            asCiphertext(change.payload),
            associatedData(
              credentials.vaultId,
              change.mutationId,
              change.entityType,
              change.entityId,
              change.operation,
              change.payload.schemaVersion
            )
          )
        }
      })
      pulled += await this.store.applyPullPage(
        cursor,
        response.nextCursor,
        credentials.deviceId,
        changes
      )
      cursor = response.nextCursor
      if (!response.hasMore) return pulled
    }
    throw new Error('The sync server returned too many pages in one run.')
  }

  private encryptMutation(
    credentials: VaultCredentials,
    vaultKey: Uint8Array,
    change: PendingSyncChange
  ): RpcPushMutation {
    const encrypted = encryptSyncPayload(
      vaultKey,
      change.value,
      associatedData(
        credentials.vaultId,
        change.mutationId,
        change.entityType,
        change.entityId,
        change.operation
      ),
      credentials.keyEpoch
    )
    return {
      mutationId: change.mutationId,
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      baseRemoteRevision: change.baseRemoteRevision,
      protocolVersion: 1,
      rowVersion: change.rowVersion,
      changeSetId: null,
      changedAt: change.changedAt,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encoding: PAYLOAD_ENCODING,
      keyVersion: encrypted.keyEpoch,
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      hash: encrypted.hash
    }
  }

  private validatePushResults(changes: readonly PendingSyncChange[], mutationIds: string[]): void {
    const expected = new Set(changes.map((change) => change.mutationId))
    if (mutationIds.length !== expected.size || new Set(mutationIds).size !== mutationIds.length) {
      throw new Error('The sync server returned incomplete mutation results.')
    }
    for (const mutationId of mutationIds) {
      if (!expected.has(mutationId))
        throw new Error('The sync server returned an unknown mutation.')
    }
  }

  private async bootstrap(): Promise<RpcBootstrap | null> {
    await this.requireSession()
    const { data, error } = await this.requireClient().rpc('get_storybound_bootstrap')
    if (error) throw new Error(error.message)
    return parseBootstrap(data)
  }

  private async restoreProfileForSession(): Promise<void> {
    const session = await this.requireSession()
    const credentials = await this.readCredentials(session.user.id)
    if (credentials) await this.store.activateProfile(credentials.vaultId, credentials.deviceId)
  }

  private async saveAndActivate(
    userId: string,
    input: {
      vaultId: string
      deviceId: string
      deviceToken: string
      keyEpoch: number
      vaultKey: Uint8Array
    }
  ): Promise<void> {
    await this.saveCredentials(userId, input)
    await this.store.activateProfile(input.vaultId, input.deviceId)
  }

  private async saveCredentials(
    userId: string,
    input: {
      vaultId: string
      deviceId: string
      deviceToken: string
      keyEpoch: number
      vaultKey: Uint8Array
    }
  ): Promise<void> {
    if (!isCanonicalDeviceToken(input.deviceToken)) {
      throw new Error('The generated device token is invalid.')
    }
    const credentials: VaultCredentials = {
      version: 2,
      userId,
      vaultId: input.vaultId,
      deviceId: input.deviceId,
      deviceToken: input.deviceToken,
      keyEpoch: input.keyEpoch,
      vaultKey: bytesToBase64(input.vaultKey)
    }
    await this.requireStorage().setItem(vaultCredentialKey(userId), JSON.stringify(credentials))
  }

  private async readCredentials(userId: string): Promise<VaultCredentials | null> {
    const raw = await this.storage?.getItem(vaultCredentialKey(userId))
    if (!raw) return null
    const credentials = parseVaultCredentials(raw)
    if (!credentials) return null
    return credentials.userId === userId ? credentials : null
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Cloud sync is not configured in this Storybound build.')
    return this.client
  }

  private requireStorage(): ChunkedSecureStorage {
    if (!this.storage) throw new Error('Secure credential storage is unavailable.')
    return this.storage
  }

  private async requireSession(): Promise<Session> {
    const { data, error } = await this.requireClient().auth.getSession()
    if (error || !data.session) throw new Error(error?.message ?? 'Sign in to sync first.')
    return data.session
  }
}
