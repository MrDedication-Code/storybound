import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto'

const MAGIC = Buffer.from('SBVAULT\0', 'ascii')
const VERSION = 1
const CIPHER_AES_256_GCM = 1
const KDF_SCRYPT = 1

const FIXED_HEADER_LENGTH = 36
const SALT_LENGTH = 16
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const HEADER_LENGTH = FIXED_HEADER_LENGTH + SALT_LENGTH + IV_LENGTH

const SCRYPT_COST = 32_768
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024

const MIN_PASSPHRASE_CHARACTERS = 10
const MAX_PASSPHRASE_CHARACTERS = 1_024
export const MAX_ENCRYPTED_PAYLOAD_BYTES = 500 * 1024 * 1024
export const MAX_ENCRYPTED_ARCHIVE_BYTES =
  HEADER_LENGTH + MAX_ENCRYPTED_PAYLOAD_BYTES + AUTH_TAG_LENGTH

export type EncryptedVaultErrorCode =
  'INVALID_PASSPHRASE' | 'PAYLOAD_TOO_LARGE' | 'INVALID_ARCHIVE' | 'ENCRYPTION_FAILED'

/** A human-safe error from Storybound's encrypted archive envelope. */
export class EncryptedVaultError extends Error {
  readonly code: EncryptedVaultErrorCode

  constructor(code: EncryptedVaultErrorCode, message: string) {
    super(message)
    this.name = 'EncryptedVaultError'
    this.code = code
  }
}

function countPassphraseCharacters(passphrase: string): number {
  let count = 0
  for (let index = 0; index < passphrase.length; index += 1) {
    const codeUnit = passphrase.charCodeAt(index)
    if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < passphrase.length &&
      passphrase.charCodeAt(index + 1) >= 0xdc00 &&
      passphrase.charCodeAt(index + 1) <= 0xdfff
    ) {
      index += 1
    }
    count += 1
    if (count > MAX_PASSPHRASE_CHARACTERS) return count
  }
  return count
}

function validatePassphrase(passphrase: string): void {
  const characterCount = typeof passphrase === 'string' ? countPassphraseCharacters(passphrase) : 0
  if (characterCount < MIN_PASSPHRASE_CHARACTERS || characterCount > MAX_PASSPHRASE_CHARACTERS) {
    throw new EncryptedVaultError(
      'INVALID_PASSPHRASE',
      `Passphrase must contain between ${MIN_PASSPHRASE_CHARACTERS} and ${MAX_PASSPHRASE_CHARACTERS} characters.`
    )
  }
}

function assertPayloadSize(payloadLength: number): void {
  if (payloadLength > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new EncryptedVaultError('PAYLOAD_TOO_LARGE', 'Encrypted archives are limited to 500 MB.')
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY
  })
}

function invalidArchive(): EncryptedVaultError {
  return new EncryptedVaultError(
    'INVALID_ARCHIVE',
    'This encrypted archive is damaged or the passphrase is incorrect.'
  )
}

interface ParsedEnvelope {
  header: Buffer
  salt: Buffer
  iv: Buffer
  ciphertext: Buffer
  authTag: Buffer
  payloadLength: number
}

function parseEnvelope(envelope: Buffer): ParsedEnvelope {
  if (!Buffer.isBuffer(envelope) || envelope.length < FIXED_HEADER_LENGTH) {
    throw invalidArchive()
  }

  const magic = envelope.subarray(0, MAGIC.length)
  if (magic.length !== MAGIC.length || !timingSafeEqual(magic, MAGIC)) {
    throw invalidArchive()
  }

  const version = envelope.readUInt8(8)
  const cipher = envelope.readUInt8(9)
  const kdf = envelope.readUInt8(10)
  const flags = envelope.readUInt8(11)
  const headerLength = envelope.readUInt32BE(12)
  const payloadLength = envelope.readUInt32BE(16)
  const scryptCost = envelope.readUInt32BE(20)
  const scryptBlockSize = envelope.readUInt32BE(24)
  const scryptParallelization = envelope.readUInt32BE(28)
  const saltLength = envelope.readUInt8(32)
  const ivLength = envelope.readUInt8(33)
  const authTagLength = envelope.readUInt8(34)
  const reserved = envelope.readUInt8(35)

  if (
    version !== VERSION ||
    cipher !== CIPHER_AES_256_GCM ||
    kdf !== KDF_SCRYPT ||
    flags !== 0 ||
    reserved !== 0 ||
    headerLength !== HEADER_LENGTH ||
    scryptCost !== SCRYPT_COST ||
    scryptBlockSize !== SCRYPT_BLOCK_SIZE ||
    scryptParallelization !== SCRYPT_PARALLELIZATION ||
    saltLength !== SALT_LENGTH ||
    ivLength !== IV_LENGTH ||
    authTagLength !== AUTH_TAG_LENGTH
  ) {
    throw invalidArchive()
  }

  assertPayloadSize(payloadLength)
  const expectedLength = headerLength + payloadLength + authTagLength
  if (envelope.length !== expectedLength) throw invalidArchive()

  const saltStart = FIXED_HEADER_LENGTH
  const ivStart = saltStart + saltLength
  const ciphertextStart = headerLength
  const tagStart = ciphertextStart + payloadLength

  return {
    header: envelope.subarray(0, headerLength),
    salt: envelope.subarray(saltStart, ivStart),
    iv: envelope.subarray(ivStart, headerLength),
    ciphertext: envelope.subarray(ciphertextStart, tagStart),
    authTag: envelope.subarray(tagStart),
    payloadLength
  }
}

/** Encrypt a Storybound archive into a versioned, authenticated binary envelope. */
export function encryptStoryboundArchive(archive: Buffer, passphrase: string): Buffer {
  validatePassphrase(passphrase)
  if (!Buffer.isBuffer(archive)) {
    throw new EncryptedVaultError('ENCRYPTION_FAILED', 'The archive could not be encrypted.')
  }
  assertPayloadSize(archive.length)

  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const header = Buffer.alloc(HEADER_LENGTH)
  MAGIC.copy(header, 0)
  header.writeUInt8(VERSION, 8)
  header.writeUInt8(CIPHER_AES_256_GCM, 9)
  header.writeUInt8(KDF_SCRYPT, 10)
  header.writeUInt8(0, 11)
  header.writeUInt32BE(HEADER_LENGTH, 12)
  header.writeUInt32BE(archive.length, 16)
  header.writeUInt32BE(SCRYPT_COST, 20)
  header.writeUInt32BE(SCRYPT_BLOCK_SIZE, 24)
  header.writeUInt32BE(SCRYPT_PARALLELIZATION, 28)
  header.writeUInt8(SALT_LENGTH, 32)
  header.writeUInt8(IV_LENGTH, 33)
  header.writeUInt8(AUTH_TAG_LENGTH, 34)
  header.writeUInt8(0, 35)
  salt.copy(header, FIXED_HEADER_LENGTH)
  iv.copy(header, FIXED_HEADER_LENGTH + SALT_LENGTH)

  let key: Buffer | undefined
  try {
    key = deriveKey(passphrase, salt)
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    })
    cipher.setAAD(header)
    const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()], archive.length)
    return Buffer.concat([header, ciphertext, cipher.getAuthTag()])
  } catch (error) {
    if (error instanceof EncryptedVaultError) throw error
    throw new EncryptedVaultError('ENCRYPTION_FAILED', 'The archive could not be encrypted.')
  } finally {
    key?.fill(0)
  }
}

/** Decrypt a Storybound encrypted archive after authenticating its full envelope metadata. */
export function decryptStoryboundArchive(envelope: Buffer, passphrase: string): Buffer {
  validatePassphrase(passphrase)

  let parsed: ParsedEnvelope
  try {
    parsed = parseEnvelope(envelope)
  } catch (error) {
    if (error instanceof EncryptedVaultError && error.code === 'PAYLOAD_TOO_LARGE') {
      throw error
    }
    throw invalidArchive()
  }

  let key: Buffer | undefined
  let decryptedChunk: Buffer | undefined
  let finalChunk: Buffer | undefined
  try {
    key = deriveKey(passphrase, parsed.salt)
    const decipher = createDecipheriv('aes-256-gcm', key, parsed.iv, {
      authTagLength: AUTH_TAG_LENGTH
    })
    decipher.setAAD(parsed.header)
    decipher.setAuthTag(parsed.authTag)
    decryptedChunk = decipher.update(parsed.ciphertext)
    finalChunk = decipher.final()
    const plaintext = Buffer.concat([decryptedChunk, finalChunk], parsed.payloadLength)
    decryptedChunk.fill(0)
    finalChunk.fill(0)
    return plaintext
  } catch {
    decryptedChunk?.fill(0)
    finalChunk?.fill(0)
    throw invalidArchive()
  } finally {
    key?.fill(0)
  }
}
