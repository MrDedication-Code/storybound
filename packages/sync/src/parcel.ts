import { gcm } from '@noble/ciphers/aes.js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { canonicalJson } from './canonical'
import { base64ToBytes, bytesToBase64, encodeBase32, equalBytes } from './crypto'

const KEY_BYTES = 32
const NONCE_BYTES = 12
/** 80 bits: a fingerprint that stays safe for as long as the address is in use. */
const ADDRESS_BYTES = 10
const ADDRESS_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/
const PARCEL_VERSION = 1

/** An account's sharing keys. Any device holding the vault key derives the same ones. */
export interface SharingIdentity {
  address: string
  encryptionPublicKey: string
  signingPublicKey: string
  encryptionPrivateKey: Uint8Array
  signingPrivateKey: Uint8Array
}

/** What a sender needs to know about a recipient, as published on the server. */
export interface SharingRecipient {
  address: string
  encryptionPublicKey: string
  signingPublicKey: string
}

/** The small, separately sealed part of a parcel, enough to say who it is from and what it is. */
export interface ParcelLabelDetails {
  senderName: string
  shareId: string
  sequence: number
  kind: 'book' | 'update'
  mode: 'read-only' | 'editable'
  title: string
  authorName: string
  chapterCount: number
  newChapterCount: number
  sentAt: string
}

export interface ParcelLabel extends ParcelLabelDetails {
  version: typeof PARCEL_VERSION
  senderAddress: string
  senderEncryptionPublicKey: string
  senderSigningPublicKey: string
  bodyHash: string
}

export interface SealedParcel {
  label: string
  body: string
}

interface SealedPart {
  ephemeralPublicKey: string
  nonce: string
  ciphertext: string
}

function deriveKey(vaultKey: Uint8Array, vaultId: string, purpose: string): Uint8Array {
  return hkdf(sha256, vaultKey, utf8ToBytes(vaultId), utf8ToBytes(purpose), KEY_BYTES)
}

function addressFromKeys(encryptionPublicKey: Uint8Array, signingPublicKey: Uint8Array): string {
  const digest = sha256(
    new Uint8Array([
      ...utf8ToBytes('storybound-address-v1'),
      ...encryptionPublicKey,
      ...signingPublicKey
    ])
  )
  return encodeBase32(digest.slice(0, ADDRESS_BYTES))
}

/** Reads an address however it was typed or pasted. Null when it cannot be one. */
export function normalizeSharingAddress(value: string): string | null {
  const address = value.replace(/[\s-]/g, '').toUpperCase()
  return ADDRESS_PATTERN.test(address) ? address : null
}

/** An address as people see it: K7QM-2XPD-9RTA-HF4W. */
export function formatSharingAddress(address: string): string {
  return address.match(/.{1,4}/g)?.join('-') ?? address
}

export function deriveSharingIdentity(vaultKey: Uint8Array, vaultId: string): SharingIdentity {
  if (vaultKey.length !== KEY_BYTES) throw new TypeError('Vault keys must contain 32 bytes')
  const encryptionPrivateKey = deriveKey(vaultKey, vaultId, 'storybound-sharing-encryption-v1')
  const signingPrivateKey = deriveKey(vaultKey, vaultId, 'storybound-sharing-signing-v1')
  const encryptionPublicKey = x25519.getPublicKey(encryptionPrivateKey)
  const signingPublicKey = ed25519.getPublicKey(signingPrivateKey)
  return {
    address: addressFromKeys(encryptionPublicKey, signingPublicKey),
    encryptionPublicKey: bytesToBase64(encryptionPublicKey),
    signingPublicKey: bytesToBase64(signingPublicKey),
    encryptionPrivateKey,
    signingPrivateKey
  }
}

/** True when these keys really belong to this address, whatever the server said. */
export function sharingKeysMatchAddress(
  address: string,
  encryptionPublicKey: string,
  signingPublicKey: string
): boolean {
  try {
    const encryption = base64ToBytes(encryptionPublicKey)
    const signing = base64ToBytes(signingPublicKey)
    if (encryption.length !== KEY_BYTES || signing.length !== KEY_BYTES) return false
    return addressFromKeys(encryption, signing) === address
  } catch {
    return false
  }
}

function partKey(sharedSecret: Uint8Array, parcelId: string, part: string): Uint8Array {
  return hkdf(
    sha256,
    sharedSecret,
    utf8ToBytes(parcelId),
    utf8ToBytes(`storybound-parcel-${part}-v1`),
    KEY_BYTES
  )
}

function partContext(parcelId: string, address: string, part: string): Uint8Array {
  return utf8ToBytes(
    canonicalJson({ version: PARCEL_VERSION, parcelId, recipientAddress: address, part })
  )
}

function sealPart(
  plaintext: Uint8Array,
  recipient: SharingRecipient,
  parcelId: string,
  part: string
): string {
  const ephemeralPrivateKey = x25519.utils.randomSecretKey()
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    base64ToBytes(recipient.encryptionPublicKey)
  )
  const nonce = randomBytes(NONCE_BYTES)
  const sealed: SealedPart = {
    ephemeralPublicKey: bytesToBase64(x25519.getPublicKey(ephemeralPrivateKey)),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(
      gcm(
        partKey(sharedSecret, parcelId, part),
        nonce,
        partContext(parcelId, recipient.address, part)
      ).encrypt(plaintext)
    )
  }
  return JSON.stringify(sealed)
}

function openPart(
  value: string,
  identity: SharingIdentity,
  parcelId: string,
  part: string
): Uint8Array {
  const sealed = JSON.parse(value) as SealedPart
  const sharedSecret = x25519.getSharedSecret(
    identity.encryptionPrivateKey,
    base64ToBytes(sealed.ephemeralPublicKey)
  )
  return gcm(
    partKey(sharedSecret, parcelId, part),
    base64ToBytes(sealed.nonce),
    partContext(parcelId, identity.address, part)
  ).decrypt(base64ToBytes(sealed.ciphertext))
}

function signedLabelBytes(
  label: ParcelLabel,
  parcelId: string,
  recipientAddress: string
): Uint8Array {
  return utf8ToBytes(canonicalJson({ label, parcelId, recipientAddress }))
}

/** Seals a book for one recipient. Only they can open it, and they can prove who sent it. */
export function sealParcel(input: {
  parcelId: string
  sender: SharingIdentity
  recipient: SharingRecipient
  details: ParcelLabelDetails
  body: unknown
}): SealedParcel {
  const { parcelId, sender, recipient, details } = input
  if (
    !sharingKeysMatchAddress(
      recipient.address,
      recipient.encryptionPublicKey,
      recipient.signingPublicKey
    )
  ) {
    throw new Error('These keys do not belong to that address.')
  }
  const body = sealPart(utf8ToBytes(JSON.stringify(input.body)), recipient, parcelId, 'body')
  const label: ParcelLabel = {
    ...details,
    version: PARCEL_VERSION,
    senderAddress: sender.address,
    senderEncryptionPublicKey: sender.encryptionPublicKey,
    senderSigningPublicKey: sender.signingPublicKey,
    bodyHash: bytesToHex(sha256(utf8ToBytes(body)))
  }
  const signature = bytesToBase64(
    ed25519.sign(signedLabelBytes(label, parcelId, recipient.address), sender.signingPrivateKey)
  )
  return {
    label: sealPart(
      utf8ToBytes(JSON.stringify({ label, signature })),
      recipient,
      parcelId,
      'label'
    ),
    body
  }
}

/** Opens a parcel's label, and refuses it unless the sender really holds the address it names. */
export function openParcelLabel(
  identity: SharingIdentity,
  parcelId: string,
  sealedLabel: string
): ParcelLabel {
  const { label, signature } = JSON.parse(
    new TextDecoder().decode(openPart(sealedLabel, identity, parcelId, 'label'))
  ) as { label: ParcelLabel; signature: string }
  if (label.version !== PARCEL_VERSION) throw new Error('Unsupported parcel version')
  if (
    !sharingKeysMatchAddress(
      label.senderAddress,
      label.senderEncryptionPublicKey,
      label.senderSigningPublicKey
    )
  ) {
    throw new Error('The parcel’s sender does not match its address.')
  }
  const verified = ed25519.verify(
    base64ToBytes(signature),
    signedLabelBytes(label, parcelId, identity.address),
    base64ToBytes(label.senderSigningPublicKey)
  )
  if (!verified) throw new Error('The parcel’s signature is not valid.')
  return label
}

/** Opens a parcel's contents, which must be the exact ones its signed label names. */
export function openParcelBody<T>(
  identity: SharingIdentity,
  parcelId: string,
  label: ParcelLabel,
  sealedBody: string
): T {
  const hash = utf8ToBytes(bytesToHex(sha256(utf8ToBytes(sealedBody))))
  if (!equalBytes(hash, utf8ToBytes(label.bodyHash))) {
    throw new Error('The parcel’s contents do not match its label.')
  }
  return JSON.parse(new TextDecoder().decode(openPart(sealedBody, identity, parcelId, 'body'))) as T
}

/** A short fingerprint of a chapter's text, used to tell whether someone has changed it. */
export function sharedContentHash(content: string): string {
  return bytesToHex(sha256(utf8ToBytes(content)))
}
