import type { SupabaseClient } from '@supabase/supabase-js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createVaultKey,
  createWrappingKeyPair,
  deriveDeviceWrappingKey,
  deviceLinkWords,
  DEVICE_LINK_WORDS,
  parseDeviceLinkStatus,
  unwrapVaultKeyFromDevice,
  type SyncWrappingKeyPair
} from '@storybound/sync'
import type { SyncKeyEnvelope } from '@storybound/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SecureCredentialStorage,
  type CredentialProtector
} from '../../src/main/cloud/secureCredentials'
import { StoryboundSyncController } from '../../src/main/cloud/syncController'
import { StoryboundStore } from '../../src/main/store'

const userId = '11111111-1111-4111-8111-111111111111'
const vaultId = '22222222-2222-4222-8222-222222222222'
const macDeviceId = '33333333-3333-4333-8333-333333333333'
const requestId = '55555555-5555-4555-8555-555555555555'
const otherDeviceId = '77777777-7777-4777-8777-777777777777'
const macToken = 'mac-device-token-0123456789abcdefghijklmnop'

class TestProtector implements CredentialProtector {
  isEncryptionAvailable(): boolean {
    return true
  }
  async encryptString(value: string): Promise<Buffer> {
    return Buffer.from(value, 'utf8')
  }
  async decryptString(value: Buffer): Promise<{ value: string; shouldReEncrypt: boolean }> {
    return { value: value.toString('utf8'), shouldReEncrypt: false }
  }
}

const directories: string[] = []
const stores: StoryboundStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface Harness {
  controller: StoryboundSyncController
  vaultKey: Uint8Array
  phone: SyncWrappingKeyPair
  row: Record<string, unknown>
  rpc: ReturnType<typeof vi.fn>
  approvals: Array<Record<string, unknown>>
}

async function harness(rowOverrides: Record<string, unknown> = {}): Promise<Harness> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-device-link-'))
  directories.push(directory)
  const store = await StoryboundStore.open(directory)
  stores.push(store)
  const storage = new SecureCredentialStorage(join(directory, 'cloud.bin'), new TestProtector())
  const vaultKey = createVaultKey()
  await storage.setItem(
    `storybound.vault.v1.${userId}`,
    JSON.stringify({
      version: 2,
      userId,
      profileId: 'profile-1',
      localLibraryId: 'library-1',
      vaultId,
      deviceId: macDeviceId,
      deviceToken: macToken,
      keyEpoch: 1,
      vaultKey: Buffer.from(vaultKey).toString('base64')
    })
  )
  const phone = createWrappingKeyPair()
  const row: Record<string, unknown> = {
    requestId,
    deviceName: 'Jack’s phone',
    requesterPublicKey: Buffer.from(phone.publicKey).toString('base64'),
    approverDeviceId: null,
    approverPublicKey: null,
    createdAt: '2026-11-02T17:00:00Z',
    expiresAt: '2026-11-02T17:10:00Z',
    ...rowOverrides
  }
  const approvals: Array<Record<string, unknown>> = []
  const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    if (name === 'get_storybound_bootstrap') return { data: null, error: null }
    if (name === 'list_storybound_link_requests') return { data: [{ ...row }], error: null }
    if (name === 'acknowledge_storybound_device_link') {
      row.approverDeviceId = parameters.p_device_id
      row.approverPublicKey = parameters.p_public_key
      return { data: { requestId }, error: null }
    }
    if (name === 'approve_storybound_device_link') {
      approvals.push(parameters)
      return { data: { requestId }, error: null }
    }
    if (name === 'decline_storybound_device_link') return { data: null, error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: userId, email: 'reader@example.com' } } },
        error: null
      }))
    },
    rpc
  } as unknown as SupabaseClient
  const controller = await StoryboundSyncController.create(store, {
    config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test_key_value' },
    client,
    storage
  })
  return { controller, vaultKey, phone, row, rpc, approvals }
}

describe('approving a new device from this Mac', () => {
  it('acknowledges once, shows six words, and seals the vault key only for the requester', async () => {
    const { controller, vaultKey, phone, row, rpc, approvals } = await harness()

    const [first] = await controller.listLinkRequests()
    const [again] = await controller.listLinkRequests()
    const acknowledgements = rpc.mock.calls.filter(
      ([name]) => name === 'acknowledge_storybound_device_link'
    )
    expect(acknowledgements).toHaveLength(1)
    expect(first.words).toHaveLength(6)
    expect(again.words).toEqual(first.words)
    expect(first.words).toEqual(
      deviceLinkWords({
        vaultId,
        requestId,
        requesterPublicKey: row.requesterPublicKey as string,
        approverPublicKey: row.approverPublicKey as string
      })
    )

    await controller.approveLinkRequest(requestId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      p_device_id: macDeviceId,
      p_device_token: macToken,
      p_request_id: requestId,
      p_key_epoch: 1
    })
    const envelope: SyncKeyEnvelope = {
      version: 1,
      kind: 'device',
      vaultId,
      keyEpoch: 1,
      nonce: approvals[0].p_envelope_nonce as string,
      ciphertext: approvals[0].p_envelope_ciphertext as string
    }
    const opened = unwrapVaultKeyFromDevice(
      envelope,
      deriveDeviceWrappingKey(
        phone.privateKey,
        new Uint8Array(Buffer.from(row.approverPublicKey as string, 'base64')),
        vaultId
      )
    )
    expect(opened).toEqual(vaultKey)
    expect(() =>
      unwrapVaultKeyFromDevice(
        envelope,
        deriveDeviceWrappingKey(
          createWrappingKeyPair().privateKey,
          new Uint8Array(Buffer.from(row.approverPublicKey as string, 'base64')),
          vaultId
        )
      )
    ).toThrow()

    // The ephemeral key is single-use.
    await expect(controller.approveLinkRequest(requestId)).rejects.toThrow(/no longer be approved/)
  })

  it('cannot approve a request another device already acknowledged', async () => {
    const { controller } = await harness({
      approverDeviceId: otherDeviceId,
      approverPublicKey: Buffer.from(createWrappingKeyPair().publicKey).toString('base64')
    })
    const [request] = await controller.listLinkRequests()
    expect(request.words).toBeNull()
    await expect(controller.approveLinkRequest(requestId)).rejects.toThrow(/no longer be approved/)
  })

  it('stops showing words if the requester key changes after acknowledgement', async () => {
    const { controller, row } = await harness()
    await controller.listLinkRequests()
    row.requesterPublicKey = Buffer.from(createWrappingKeyPair().publicKey).toString('base64')
    const [request] = await controller.listLinkRequests()
    expect(request.words).toBeNull()
  })

  it('treats a failed acknowledgement as not approvable instead of failing the list', async () => {
    const { controller, rpc } = await harness()
    const original = rpc.getMockImplementation() as (
      name: string,
      parameters: Record<string, unknown>
    ) => Promise<unknown>
    rpc.mockImplementation(async (name: string, parameters: Record<string, unknown>) =>
      name === 'acknowledge_storybound_device_link'
        ? { data: null, error: { message: 'Link request already acknowledged' } }
        : original(name, parameters)
    )
    const [request] = await controller.listLinkRequests()
    expect(request.words).toBeNull()
  })
})

describe('device-link words and responses', () => {
  const base = {
    vaultId,
    requestId,
    requesterPublicKey: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    approverPublicKey: Buffer.from(new Uint8Array(32).fill(2)).toString('base64')
  }

  it('uses 256 distinct words and changes when any input changes', () => {
    expect(new Set(DEVICE_LINK_WORDS).size).toBe(256)
    const words = deviceLinkWords(base)
    expect(words).toHaveLength(6)
    expect(deviceLinkWords(base)).toEqual(words)
    for (const field of ['vaultId', 'requestId', 'requesterPublicKey', 'approverPublicKey']) {
      const changed = field.endsWith('PublicKey')
        ? Buffer.from(new Uint8Array(32).fill(9)).toString('base64')
        : '99999999-9999-4999-8999-999999999999'
      expect(deviceLinkWords({ ...base, [field]: changed })).not.toEqual(words)
    }
  })

  it('rejects malformed link responses', () => {
    const valid = {
      requestId,
      vaultId,
      deviceId: macDeviceId,
      status: 'pending',
      approverPublicKey: null,
      keyEpoch: null,
      envelope: null,
      expiresAt: '2026-11-02T17:10:00Z'
    }
    expect(parseDeviceLinkStatus(valid).status).toBe('pending')
    expect(() => parseDeviceLinkStatus({ ...valid, status: 'hacked' })).toThrow(/invalid/)
    expect(() => parseDeviceLinkStatus({ ...valid, status: 'approved' })).toThrow(/invalid/)
    expect(() => parseDeviceLinkStatus({ ...valid, approverPublicKey: 'short' })).toThrow(/invalid/)
  })
})
