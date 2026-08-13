import { describe, expect, it } from 'vitest'
import { syncPushBatchRequestSchema } from '../../packages/contracts/src/validation'
import { canonicalJson } from '../../packages/sync/src/canonical'
import {
  createRecoveryCode,
  createSigningKeyPair,
  createVaultKey,
  createWrappingKeyPair,
  decryptSyncPayload,
  deriveDeviceWrappingKey,
  encryptSyncPayload,
  keyedContentId,
  recoverySecretFromCode,
  recoveryVerifier,
  signSyncBytes,
  unwrapVaultKeyFromRecovery,
  verifySyncSignature,
  wrapVaultKeyForRecovery
} from '../../packages/sync/src/crypto'

const associatedData = {
  protocolVersion: 1,
  schemaVersion: 1,
  vaultId: 'vault-1',
  mutationId: 'mutation-1',
  entityType: 'chapter' as const,
  entityId: 'chapter-1',
  operation: 'upsert' as const
}

describe('sync foundations', () => {
  it('canonicalizes object keys and nested values deterministically', () => {
    expect(canonicalJson({ z: 2, a: { y: true, x: ['story', 1] }, omitted: undefined })).toBe(
      '{"a":{"x":["story",1],"y":true},"z":2}'
    )
  })

  it('encrypts and decrypts canonical payloads with authenticated metadata', () => {
    const key = createVaultKey()
    const payload = encryptSyncPayload(
      key,
      { title: 'A quiet chapter', content: 'Once.' },
      associatedData,
      1
    )

    expect(decryptSyncPayload(key, payload, associatedData)).toEqual({
      content: 'Once.',
      title: 'A quiet chapter'
    })
    expect(() =>
      decryptSyncPayload(key, payload, { ...associatedData, entityId: 'another-chapter' })
    ).toThrow()
  })

  it('rejects modified ciphertext before decryption', () => {
    const key = createVaultKey()
    const payload = encryptSyncPayload(key, { content: 'valuable writing' }, associatedData, 1)
    const tampered = {
      ...payload,
      ciphertext: `${payload.ciphertext.slice(0, -2)}AA`
    }

    expect(() => decryptSyncPayload(key, tampered, associatedData)).toThrow(
      'Encrypted sync payload hash mismatch'
    )
  })

  it('derives the same wrapping key for both device participants', () => {
    const first = createWrappingKeyPair()
    const second = createWrappingKeyPair()

    expect(deriveDeviceWrappingKey(first.privateKey, second.publicKey, 'vault-1')).toEqual(
      deriveDeviceWrappingKey(second.privateKey, first.publicKey, 'vault-1')
    )
  })

  it('signs device changes and creates stable keyed content identifiers', () => {
    const signing = createSigningKeyPair()
    const bytes = new TextEncoder().encode('encrypted batch hash')
    const vaultKey = createVaultKey()

    const signature = signSyncBytes(signing.privateKey, bytes)
    expect(verifySyncSignature(signing.publicKey, bytes, signature)).toBe(true)
    expect(keyedContentId(vaultKey, bytes)).toBe(keyedContentId(vaultKey, bytes))
    expect(keyedContentId(createVaultKey(), bytes)).not.toBe(keyedContentId(vaultKey, bytes))
  })

  it('round-trips the vault key through a checksummed recovery code', () => {
    const vaultKey = createVaultKey()
    const recoveryCode = createRecoveryCode()
    const envelope = wrapVaultKeyForRecovery(vaultKey, recoveryCode, 'vault-1', 1)

    expect(recoverySecretFromCode(recoveryCode.replaceAll('-', ' ').toLowerCase())).toHaveLength(20)
    expect(unwrapVaultKeyFromRecovery(envelope, recoveryCode)).toEqual(vaultKey)

    const altered = `${recoveryCode.slice(0, -1)}${recoveryCode.endsWith('A') ? 'B' : 'A'}`
    expect(() => unwrapVaultKeyFromRecovery(envelope, altered)).toThrow()
  })

  it('derives a vault-bound recovery proof without exposing the recovery code', () => {
    const code = createRecoveryCode()
    const proof = recoveryVerifier(code, 'vault-1')

    expect(proof).toBe(recoveryVerifier(code, 'vault-1'))
    expect(proof).not.toContain(code.replaceAll('-', ''))
    expect(proof).not.toBe(recoveryVerifier(code, 'vault-2'))
  })

  it('rejects malformed and oversized transport envelopes', () => {
    const valid = {
      vaultId: '44444444-4444-4444-8444-444444444444',
      deviceId: '55555555-5555-4555-8555-555555555555',
      operationId: '66666666-6666-4666-8666-666666666666',
      baseSequence: 0,
      protocolVersion: 1,
      keyEpoch: 1,
      nonce: 'MTIzNDU2Nzg5MDEy',
      ciphertext: 'ZW5jcnlwdGVk',
      ciphertextHash: 'aGFzaA=='
    }

    expect(syncPushBatchRequestSchema.safeParse(valid).success).toBe(true)
    expect(syncPushBatchRequestSchema.safeParse({ ...valid, protocolVersion: 2 }).success).toBe(
      false
    )
    expect(
      syncPushBatchRequestSchema.safeParse({ ...valid, ciphertext: 'not base64!' }).success
    ).toBe(false)
  })
})
