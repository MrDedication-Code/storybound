import type { SupabaseClient } from '@supabase/supabase-js'
import { hostname } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  createRecoveryCode,
  createVaultKey,
  recoveryVerifier,
  unwrapVaultKeyFromRecovery,
  wrapVaultKeyForRecovery
} from '@storybound/sync'
import type {
  SyncConflictRecord,
  SyncDeviceSummary,
  SyncEnableResult,
  SyncKeyEnvelope,
  SyncRuntimeStatus
} from '@storybound/contracts'
import type { SyncCredentialsInput } from '../../shared/types'
import type { StoryboundStore } from '../store'
import { StoryboundError } from '../errors'
import { DesktopSyncEngine, type SyncEngineSummary } from '../sync'
import { loadStoryboundCloudConfig, type StoryboundCloudConfig } from './config'
import { ElectronCredentialProtector } from './electronProtector'
import { SecureCredentialStorage } from './secureCredentials'
import { createStoryboundSupabaseClient } from './supabaseClient'
import { SupabaseSyncProvider } from './supabaseProvider'

const VAULT_CREDENTIAL_KEY = 'storybound.vault.v1'
const PROVIDER_NAME = 'supabase-e2ee-v1'

interface LocalVaultCredentials {
  version: 2
  userId: string
  profileId: string
  localLibraryId: string
  vaultId: string
  deviceId: string
  deviceToken: string
  keyEpoch: number
  vaultKey: string
}

interface BootstrapResponse {
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

export interface SyncControllerDependencies {
  config?: StoryboundCloudConfig | null
  client?: SupabaseClient
  storage?: SecureCredentialStorage
}

export class StoryboundSyncController {
  private engine: DesktopSyncEngine | null = null
  private lastRuntimeError: string | null = null
  private readonly config: StoryboundCloudConfig | null
  private readonly client: SupabaseClient | null
  private readonly storage: SecureCredentialStorage | null

  private constructor(
    private readonly store: StoryboundStore,
    dependencies: SyncControllerDependencies
  ) {
    this.config = dependencies.config ?? loadStoryboundCloudConfig()
    if (!this.config) {
      this.client = null
      this.storage = null
      return
    }
    this.storage =
      dependencies.storage ??
      new SecureCredentialStorage(
        join(store.paths.root, 'credentials', 'cloud.bin'),
        new ElectronCredentialProtector()
      )
    this.client = dependencies.client ?? createStoryboundSupabaseClient(this.config, this.storage)
  }

  static async create(
    store: StoryboundStore,
    dependencies: SyncControllerDependencies = {}
  ): Promise<StoryboundSyncController> {
    const controller = new StoryboundSyncController(store, dependencies)
    await controller.restoreEngine()
    return controller
  }

  async status(): Promise<SyncRuntimeStatus> {
    const database = this.store.syncDatabase()
    const profile = database
      .prepare(
        `SELECT library_id, remote_library_id, last_sync_at, last_error
         FROM sync_profiles WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as
      | {
          library_id: string
          remote_library_id: string
          last_sync_at: string | null
          last_error: string | null
        }
      | undefined
    const pendingChanges = profile
      ? Number(
          database
            .prepare('SELECT COUNT(*) FROM sync_outbox WHERE library_id = ?')
            .pluck()
            .get(profile.library_id)
        )
      : 0
    const openConflicts = profile
      ? Number(
          database
            .prepare("SELECT COUNT(*) FROM sync_conflicts WHERE library_id = ? AND status = 'open'")
            .pluck()
            .get(profile.library_id)
        )
      : 0
    if (!this.client || !this.config) {
      return {
        configured: false,
        phase: 'local-only',
        accountEmail: null,
        vaultId: null,
        deviceId: null,
        pendingChanges,
        openConflicts,
        lastSyncAt: profile?.last_sync_at ?? null,
        lastError: this.lastRuntimeError ?? profile?.last_error ?? null
      }
    }
    const { data } = await this.client.auth.getSession()
    const credentials = data.session ? await this.readVaultCredentials(data.session.user.id) : null
    return {
      configured: true,
      phase: !data.session
        ? 'signed-out'
        : credentials
          ? this.lastRuntimeError || profile?.last_error
            ? 'error'
            : 'idle'
          : 'locked',
      accountEmail: data.session?.user.email ?? null,
      vaultId: credentials?.vaultId ?? profile?.remote_library_id ?? null,
      deviceId: credentials?.deviceId ?? null,
      pendingChanges,
      openConflicts,
      lastSyncAt: profile?.last_sync_at ?? null,
      lastError: this.lastRuntimeError ?? profile?.last_error ?? null
    }
  }

  async signUp(input: SyncCredentialsInput): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password
    })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    if (!data.session) {
      throw new StoryboundError(
        'CONFLICT',
        'Check your email to confirm the account, then sign in to enable sync.'
      )
    }
    await this.restoreEngine()
    return this.status()
  }

  async signIn(input: SyncCredentialsInput): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    const { error } = await client.auth.signInWithPassword(input)
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    await this.restoreEngine()
    return this.status()
  }

  async signOut(): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    this.engine = null
    return this.status()
  }

  async createVault(deviceName = hostname()): Promise<SyncEnableResult> {
    const client = this.requireClient()
    const userId = await this.requireUserId()
    if (await this.bootstrap()) {
      throw new StoryboundError('CONFLICT', 'This account already has a Storybound sync vault.')
    }
    const vaultId = randomUUID()
    const deviceId = randomUUID()
    const deviceToken = createDeviceToken()
    const recoveryCode = createRecoveryCode()
    const vaultKey = createVaultKey()
    const keyEpoch = 1
    const envelope = wrapVaultKeyForRecovery(vaultKey, recoveryCode, vaultId, keyEpoch)
    const { error } = await client.rpc('create_storybound_vault', {
      p_vault_id: vaultId,
      p_device_id: deviceId,
      p_device_name: deviceName.trim() || 'Storybound desktop',
      p_device_token: deviceToken,
      p_key_epoch: keyEpoch,
      p_recovery_verifier: recoveryVerifier(recoveryCode, vaultId),
      p_recovery_nonce: envelope.nonce,
      p_recovery_ciphertext: envelope.ciphertext
    })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    await this.saveAndActivateVault({
      userId,
      vaultId,
      deviceId,
      deviceToken,
      keyEpoch,
      vaultKey
    })
    return { status: await this.status(), recoveryCode }
  }

  async rotateRecoveryCode(): Promise<SyncEnableResult> {
    const credentials = await this.readVaultCredentials(await this.requireUserId())
    if (!credentials) {
      throw new StoryboundError('SECURITY_ERROR', 'Unlock sync with the recovery code first.')
    }
    const recoveryCode = createRecoveryCode()
    const vaultKey = Buffer.from(credentials.vaultKey, 'base64')
    const envelope = wrapVaultKeyForRecovery(
      vaultKey,
      recoveryCode,
      credentials.vaultId,
      credentials.keyEpoch
    )
    const { error } = await this.requireClient().rpc('rotate_storybound_recovery_envelope', {
      p_device_id: credentials.deviceId,
      p_device_token: credentials.deviceToken,
      p_recovery_verifier: recoveryVerifier(recoveryCode, credentials.vaultId),
      p_recovery_nonce: envelope.nonce,
      p_recovery_ciphertext: envelope.ciphertext
    })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    return { status: await this.status(), recoveryCode }
  }

  async recoverVault(recoveryCode: string, deviceName = hostname()): Promise<SyncRuntimeStatus> {
    const client = this.requireClient()
    const userId = await this.requireUserId()
    const bootstrap = await this.bootstrap()
    if (!bootstrap) throw new StoryboundError('NOT_FOUND', 'This account has no sync vault.')
    const deviceId = randomUUID()
    const deviceToken = createDeviceToken()
    const { data, error } = await client.rpc('register_storybound_device', {
      p_vault_id: bootstrap.vaultId,
      p_device_id: deviceId,
      p_device_name: deviceName.trim() || 'Storybound desktop',
      p_device_token: deviceToken,
      p_recovery_verifier: recoveryVerifier(recoveryCode, bootstrap.vaultId)
    })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    const response = data as { recoveryEnvelope?: SyncKeyEnvelope }
    if (!response?.recoveryEnvelope) {
      throw new StoryboundError('NETWORK_ERROR', 'The sync server omitted the recovery envelope.')
    }
    let vaultKey: Uint8Array
    try {
      vaultKey = unwrapVaultKeyFromRecovery(response.recoveryEnvelope, recoveryCode)
    } catch (error) {
      throw new StoryboundError('SECURITY_ERROR', 'That recovery code is not valid.', error)
    }
    await this.saveAndActivateVault({
      userId,
      vaultId: bootstrap.vaultId,
      deviceId,
      deviceToken,
      keyEpoch: response.recoveryEnvelope.keyEpoch,
      vaultKey
    })
    return this.status()
  }

  async syncNow(): Promise<SyncEngineSummary> {
    await this.requireSession()
    if (!this.engine) await this.restoreEngine()
    if (!this.engine) {
      throw new StoryboundError('SECURITY_ERROR', 'Unlock sync with the recovery code first.')
    }
    return this.engine.run()
  }

  async listDevices(): Promise<SyncDeviceSummary[]> {
    const bootstrap = await this.bootstrap()
    return (bootstrap?.devices ?? []).map((device) => ({
      id: device.id,
      displayName: device.displayName,
      state: device.state,
      createdAt: device.createdAt,
      approvedAt: device.createdAt,
      revokedAt: device.revokedAt,
      lastSeenAt: device.lastSeenAt
    }))
  }

  async revokeDevice(deviceId: string): Promise<SyncRuntimeStatus> {
    const credentials = await this.readVaultCredentials(await this.requireUserId())
    if (!credentials) {
      throw new StoryboundError('SECURITY_ERROR', 'Unlock sync with the recovery code first.')
    }
    if (credentials.deviceId === deviceId) {
      throw new StoryboundError('CONFLICT', 'Sign out instead of revoking the current device.')
    }
    const { error } = await this.requireClient().rpc('revoke_storybound_device', {
      p_actor_device_id: credentials.deviceId,
      p_actor_device_token: credentials.deviceToken,
      p_target_device_id: deviceId
    })
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    return this.status()
  }

  async listConflicts(): Promise<SyncConflictRecord[]> {
    const credentials = await this.readVaultCredentials(await this.requireUserId())
    if (!credentials) return []
    const rows = this.store
      .syncDatabase()
      .prepare(
        `SELECT id, library_id, entity_type, entity_id, conflict_kind,
                remote_revision, status, created_at, resolved_at
         FROM sync_conflicts WHERE library_id = ? AND status = 'open'
         ORDER BY created_at DESC`
      )
      .all(credentials.localLibraryId) as Array<{
      id: string
      library_id: string
      entity_type: SyncConflictRecord['entityType']
      entity_id: string
      conflict_kind: string
      remote_revision: string
      status: SyncConflictRecord['status']
      created_at: string
      resolved_at: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      libraryId: row.library_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      localMutationId: null,
      remoteRevision: row.remote_revision,
      kind:
        row.conflict_kind === 'ordering'
          ? 'ordering'
          : row.conflict_kind === 'remote_delete' || row.conflict_kind === 'local_delete'
            ? 'delete-versus-edit'
            : 'concurrent-update',
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    }))
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'keep-local' | 'use-remote'
  ): Promise<SyncEngineSummary> {
    await this.requireSession()
    if (!this.engine) await this.restoreEngine()
    if (!this.engine) {
      throw new StoryboundError('SECURITY_ERROR', 'Unlock sync with the recovery code first.')
    }
    return this.engine.resolveConflict(conflictId, resolution)
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Cloud sync is not configured in this Storybound build.'
      )
    }
    return this.client
  }

  private async requireSession(): Promise<void> {
    const { data, error } = await this.requireClient().auth.getSession()
    if (error || !data.session)
      throw new StoryboundError('SECURITY_ERROR', 'Sign in to sync first.')
  }

  private async requireUserId(): Promise<string> {
    const { data, error } = await this.requireClient().auth.getSession()
    if (error || !data.session)
      throw new StoryboundError('SECURITY_ERROR', 'Sign in to sync first.')
    return data.session.user.id
  }

  private async bootstrap(): Promise<BootstrapResponse | null> {
    await this.requireSession()
    const { data, error } = await this.requireClient().rpc('get_storybound_bootstrap')
    if (error) throw new StoryboundError('NETWORK_ERROR', error.message, error)
    if (data === null) return null
    const candidate = data as BootstrapResponse
    if (!candidate || typeof candidate.vaultId !== 'string' || !Array.isArray(candidate.devices)) {
      throw new StoryboundError('NETWORK_ERROR', 'The sync server returned invalid account data.')
    }
    return candidate
  }

  private async saveAndActivateVault(input: {
    userId: string
    vaultId: string
    deviceId: string
    deviceToken: string
    keyEpoch: number
    vaultKey: Uint8Array
  }): Promise<void> {
    const database = this.store.syncDatabase()
    const localLibraryId = database
      .prepare('SELECT active_library_id FROM app_state WHERE id = 1')
      .pluck()
      .get() as string
    const credentials: LocalVaultCredentials = {
      version: 2,
      userId: input.userId,
      profileId: randomUUID(),
      localLibraryId,
      vaultId: input.vaultId,
      deviceId: input.deviceId,
      deviceToken: input.deviceToken,
      keyEpoch: input.keyEpoch,
      vaultKey: Buffer.from(input.vaultKey).toString('base64')
    }
    await this.requireStorage().setItem(
      vaultCredentialKey(input.userId),
      JSON.stringify(credentials)
    )
    const now = new Date().toISOString()
    database.transaction(() => {
      database
        .prepare(
          `INSERT INTO devices (id, display_name, created_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
        )
        .run(input.deviceId, hostname() || 'Storybound desktop', now, now)
      database.prepare('UPDATE sync_profiles SET enabled = 0, updated_at = ?').run(now)
      database
        .prepare(
          `INSERT INTO sync_profiles (
             id, library_id, provider, remote_library_id, enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(credentials.profileId, localLibraryId, PROVIDER_NAME, input.vaultId, now, now)
    })()
    this.activateEngine(credentials)
  }

  private async restoreEngine(): Promise<void> {
    this.engine = null
    if (!this.client || !this.storage) return
    try {
      const { data } = await this.client.auth.getSession()
      if (!data.session) return
      const credentials = await this.readVaultCredentials(data.session.user.id)
      if (credentials) {
        const bootstrap = await this.bootstrap()
        const device = bootstrap?.devices.find((candidate) => candidate.id === credentials.deviceId)
        if (bootstrap?.vaultId !== credentials.vaultId || device?.state !== 'active') {
          throw new StoryboundError(
            'SECURITY_ERROR',
            'This account no longer authorises the saved sync device.'
          )
        }
        this.activateEngine(credentials)
      }
    } catch (error) {
      this.lastRuntimeError = error instanceof Error ? error.message : 'Sync could not be restored.'
    }
  }

  private activateEngine(credentials: LocalVaultCredentials): void {
    const key = Buffer.from(credentials.vaultKey, 'base64')
    if (key.length !== 32)
      throw new StoryboundError('SECURITY_ERROR', 'The local sync key is invalid.')
    this.engine = new DesktopSyncEngine(
      this.store.syncDatabase(),
      new SupabaseSyncProvider(this.requireClient(), credentials.deviceToken),
      credentials.profileId,
      credentials.deviceId,
      key,
      credentials.keyEpoch
    )
    this.lastRuntimeError = null
  }

  private requireStorage(): SecureCredentialStorage {
    if (!this.storage) {
      throw new StoryboundError('SECURITY_ERROR', 'Secure credential storage is unavailable.')
    }
    return this.storage
  }

  private async readVaultCredentials(userId?: string): Promise<LocalVaultCredentials | null> {
    if (!this.storage) return null
    const activeUserId = userId ?? (await this.requireUserId())
    const raw = await this.storage.getItem(vaultCredentialKey(activeUserId))
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    // Protocol-v1 device records have no possession token. Keep the encrypted vault key in
    // place, but fail closed and require one recovery-code registration to mint a secure v2
    // device record rather than silently using the legacy server overloads.
    if (value.version === 1) return null
    if (
      value.version !== 2 ||
      value.userId !== activeUserId ||
      typeof value.profileId !== 'string' ||
      typeof value.localLibraryId !== 'string' ||
      typeof value.vaultId !== 'string' ||
      typeof value.deviceId !== 'string' ||
      typeof value.deviceToken !== 'string' ||
      value.deviceToken.length < 32 ||
      value.deviceToken.length > 256 ||
      typeof value.keyEpoch !== 'number' ||
      typeof value.vaultKey !== 'string'
    ) {
      throw new StoryboundError('SECURITY_ERROR', 'The local sync credentials are invalid.')
    }
    return value as unknown as LocalVaultCredentials
  }
}

function vaultCredentialKey(userId: string): string {
  return `${VAULT_CREDENTIAL_KEY}.${userId}`
}

function createDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}
