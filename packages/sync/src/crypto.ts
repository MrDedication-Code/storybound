import { gcm } from '@noble/ciphers/aes.js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  SYNC_ENCRYPTION_ALGORITHM,
  type SyncCiphertext,
  type SyncEntityType,
  type SyncKeyEnvelope,
  type SyncOperation
} from '@storybound/contracts'
import { canonicalJson } from './canonical'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const RECOVERY_SECRET_BYTES = 20
const RECOVERY_CHECKSUM_BYTES = 4
const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface SyncAssociatedData {
  protocolVersion: number
  schemaVersion: number
  vaultId: string
  mutationId: string
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
}

export interface SyncSigningKeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export interface SyncWrappingKeyPair extends SyncSigningKeyPair {}

function bytesToBase64(value: Uint8Array): string {
  const BufferConstructor = (globalThis as unknown as { Buffer?: unknown }).Buffer as
    { from(value: Uint8Array): { toString(encoding: 'base64'): string } } | undefined
  if (BufferConstructor) return BufferConstructor.from(value).toString('base64')

  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const BufferConstructor = (globalThis as unknown as { Buffer?: unknown }).Buffer as
    { from(value: string, encoding: 'base64'): Uint8Array } | undefined
  if (BufferConstructor) return new Uint8Array(BufferConstructor.from(value, 'base64'))

  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function createVaultKey(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

export function createRecoveryCode(): string {
  const secret = randomBytes(RECOVERY_SECRET_BYTES)
  const checksum = sha256(secret).slice(0, RECOVERY_CHECKSUM_BYTES)
  const encoded = encodeBase32(new Uint8Array([...secret, ...checksum]))
  return encoded.match(/.{1,4}/g)?.join('-') ?? encoded
}

export function recoverySecretFromCode(code: string): Uint8Array {
  const normalized = code.replace(/[\s-]/g, '').toUpperCase()
  const decoded = decodeBase32(normalized)
  if (encodeBase32(decoded) !== normalized) {
    throw new Error('Recovery code has non-canonical trailing bits')
  }
  if (decoded.length !== RECOVERY_SECRET_BYTES + RECOVERY_CHECKSUM_BYTES) {
    throw new Error('Recovery code has an invalid length')
  }

  const secret = decoded.slice(0, RECOVERY_SECRET_BYTES)
  const checksum = decoded.slice(RECOVERY_SECRET_BYTES)
  const expected = sha256(secret).slice(0, RECOVERY_CHECKSUM_BYTES)
  if (!equalBytes(checksum, expected)) throw new Error('Recovery code checksum is invalid')
  return secret
}

export function recoveryVerifier(code: string, vaultId: string): string {
  return bytesToBase64(
    hmac(
      sha256,
      recoverySecretFromCode(code),
      utf8ToBytes(`storybound-recovery-verifier-v1:${vaultId}`)
    )
  )
}

export function createSigningKeyPair(): SyncSigningKeyPair {
  const privateKey = ed25519.utils.randomSecretKey()
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}

export function createWrappingKeyPair(): SyncWrappingKeyPair {
  const privateKey = x25519.utils.randomSecretKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}

export function deriveDeviceWrappingKey(
  privateKey: Uint8Array,
  remotePublicKey: Uint8Array,
  vaultId: string
): Uint8Array {
  const sharedSecret = x25519.getSharedSecret(privateKey, remotePublicKey)
  return hkdf(
    sha256,
    sharedSecret,
    utf8ToBytes(vaultId),
    utf8ToBytes('storybound-device-wrap-v1'),
    KEY_BYTES
  )
}

export function wrapVaultKeyForRecovery(
  vaultKey: Uint8Array,
  recoveryCode: string,
  vaultId: string,
  keyEpoch: number
): SyncKeyEnvelope {
  return wrapVaultKey(
    vaultKey,
    deriveRecoveryWrappingKey(recoveryCode, vaultId),
    vaultId,
    keyEpoch,
    'recovery'
  )
}

export function unwrapVaultKeyFromRecovery(
  envelope: SyncKeyEnvelope,
  recoveryCode: string
): Uint8Array {
  if (envelope.kind !== 'recovery') throw new Error('Expected a recovery key envelope')
  return unwrapVaultKey(envelope, deriveRecoveryWrappingKey(recoveryCode, envelope.vaultId))
}

export function wrapVaultKeyForDevice(
  vaultKey: Uint8Array,
  wrappingKey: Uint8Array,
  vaultId: string,
  keyEpoch: number,
  recipientPublicKey: Uint8Array
): SyncKeyEnvelope {
  return {
    ...wrapVaultKey(vaultKey, wrappingKey, vaultId, keyEpoch, 'device'),
    recipientPublicKey: bytesToBase64(recipientPublicKey)
  }
}

export function unwrapVaultKeyFromDevice(
  envelope: SyncKeyEnvelope,
  wrappingKey: Uint8Array
): Uint8Array {
  if (envelope.kind !== 'device') throw new Error('Expected a device key envelope')
  return unwrapVaultKey(envelope, wrappingKey)
}

export function encryptSyncPayload(
  vaultKey: Uint8Array,
  value: unknown,
  associatedData: SyncAssociatedData,
  keyEpoch: number
): SyncCiphertext {
  if (vaultKey.length !== KEY_BYTES) throw new TypeError('Vault keys must contain 32 bytes')
  if (!Number.isInteger(keyEpoch) || keyEpoch < 1) throw new TypeError('Key epoch must be positive')

  const nonce = randomBytes(NONCE_BYTES)
  const aad = utf8ToBytes(canonicalJson(associatedData))
  const plaintext = utf8ToBytes(canonicalJson(value))
  const ciphertext = gcm(vaultKey, nonce, aad).encrypt(plaintext)

  return {
    algorithm: SYNC_ENCRYPTION_ALGORITHM,
    keyEpoch,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    hash: bytesToBase64(sha256(ciphertext))
  }
}

export function decryptSyncPayload<T>(
  vaultKey: Uint8Array,
  payload: SyncCiphertext,
  associatedData: SyncAssociatedData
): T {
  if (payload.algorithm !== SYNC_ENCRYPTION_ALGORITHM) {
    throw new Error(`Unsupported sync encryption algorithm: ${payload.algorithm}`)
  }
  const nonce = base64ToBytes(payload.nonce)
  const ciphertext = base64ToBytes(payload.ciphertext)
  const expectedHash = base64ToBytes(payload.hash)
  const actualHash = sha256(ciphertext)
  if (!equalBytes(actualHash, expectedHash)) throw new Error('Encrypted sync payload hash mismatch')

  const aad = utf8ToBytes(canonicalJson(associatedData))
  const plaintext = gcm(vaultKey, nonce, aad).decrypt(ciphertext)
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

export function signSyncBytes(privateKey: Uint8Array, value: Uint8Array): Uint8Array {
  return ed25519.sign(value, privateKey)
}

export function verifySyncSignature(
  publicKey: Uint8Array,
  value: Uint8Array,
  signature: Uint8Array
): boolean {
  return ed25519.verify(signature, value, publicKey)
}

export function keyedContentId(vaultKey: Uint8Array, value: Uint8Array): string {
  return bytesToBase64(hmac(sha256, vaultKey, value))
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

function deriveRecoveryWrappingKey(recoveryCode: string, vaultId: string): Uint8Array {
  return hkdf(
    sha256,
    recoverySecretFromCode(recoveryCode),
    utf8ToBytes(vaultId),
    utf8ToBytes('storybound-recovery-wrap-v1'),
    KEY_BYTES
  )
}

function wrapVaultKey(
  vaultKey: Uint8Array,
  wrappingKey: Uint8Array,
  vaultId: string,
  keyEpoch: number,
  kind: SyncKeyEnvelope['kind']
): SyncKeyEnvelope {
  if (vaultKey.length !== KEY_BYTES || wrappingKey.length !== KEY_BYTES) {
    throw new TypeError('Vault and wrapping keys must contain 32 bytes')
  }
  const nonce = randomBytes(NONCE_BYTES)
  const aad = utf8ToBytes(canonicalJson({ version: 1, kind, vaultId, keyEpoch }))
  return {
    version: 1,
    kind,
    vaultId,
    keyEpoch,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(gcm(wrappingKey, nonce, aad).encrypt(vaultKey))
  }
}

function unwrapVaultKey(envelope: SyncKeyEnvelope, wrappingKey: Uint8Array): Uint8Array {
  if (envelope.version !== 1) throw new Error('Unsupported key envelope version')
  const aad = utf8ToBytes(
    canonicalJson({
      version: envelope.version,
      kind: envelope.kind,
      vaultId: envelope.vaultId,
      keyEpoch: envelope.keyEpoch
    })
  )
  return gcm(wrappingKey, base64ToBytes(envelope.nonce), aad).decrypt(
    base64ToBytes(envelope.ciphertext)
  )
}

function encodeBase32(value: Uint8Array): string {
  let buffer = 0
  let bits = 0
  let result = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_ALPHABET[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return result
}

function decodeBase32(value: string): Uint8Array {
  let buffer = 0
  let bits = 0
  const result: number[] = []
  for (const character of value) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('Recovery code contains invalid characters')
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      result.push((buffer >>> bits) & 0xff)
    }
  }
  return Uint8Array.from(result)
}
