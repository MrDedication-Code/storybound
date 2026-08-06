import { describe, expect, it } from 'vitest'
import {
  decryptStoryboundArchive,
  encryptStoryboundArchive,
  EncryptedVaultError
} from '../../src/main/encryptedVault'

const passphrase = 'quiet-river-lantern'

function expectInvalidArchive(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining({
      name: 'EncryptedVaultError',
      code: 'INVALID_ARCHIVE',
      message: 'This encrypted archive is damaged or the passphrase is incorrect.'
    })
  )
}

describe('encrypted Storybound archives', () => {
  it('round-trips arbitrary binary data in a versioned binary envelope', () => {
    const archive = Buffer.from([0, 1, 2, 3, 127, 128, 254, 255, 0, 42])
    const encrypted = encryptStoryboundArchive(archive, passphrase)

    expect(encrypted.subarray(0, 8)).toEqual(Buffer.from('SBVAULT\0', 'ascii'))
    expect(encrypted.readUInt8(8)).toBe(1)
    expect(encrypted.readUInt8(9)).toBe(1)
    expect(encrypted.readUInt8(10)).toBe(1)
    expect(encrypted.readUInt32BE(16)).toBe(archive.length)
    expect(encrypted.equals(archive)).toBe(false)
    expect(decryptStoryboundArchive(encrypted, passphrase)).toEqual(archive)
  })

  it('uses fresh salt and IV values for every encryption', () => {
    const archive = Buffer.from('The same private story archive')
    const first = encryptStoryboundArchive(archive, passphrase)
    const second = encryptStoryboundArchive(archive, passphrase)

    expect(first.equals(second)).toBe(false)
    expect(first.subarray(36, 64).equals(second.subarray(36, 64))).toBe(false)
    expect(decryptStoryboundArchive(first, passphrase)).toEqual(archive)
    expect(decryptStoryboundArchive(second, passphrase)).toEqual(archive)
  })

  it('accepts passphrases from 10 through 1024 Unicode characters', () => {
    const archive = Buffer.from('private')
    const minimum = '🔐'.repeat(10)
    const maximum = 'a'.repeat(1_024)

    expect(decryptStoryboundArchive(encryptStoryboundArchive(archive, minimum), minimum)).toEqual(
      archive
    )
    expect(decryptStoryboundArchive(encryptStoryboundArchive(archive, maximum), maximum)).toEqual(
      archive
    )
  })

  it('rejects short and overlong passphrases before encryption or decryption', () => {
    for (const invalid of ['ninechars', 'a'.repeat(1_025)]) {
      expect(() => encryptStoryboundArchive(Buffer.from('private'), invalid)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PASSPHRASE' })
      )
      expect(() => decryptStoryboundArchive(Buffer.alloc(0), invalid)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PASSPHRASE' })
      )
    }
  })

  it('uses the same safe failure for a wrong passphrase and tampered metadata, payload, or tag', () => {
    const encrypted = encryptStoryboundArchive(Buffer.from('A private chapter'), passphrase)
    expectInvalidArchive(() => decryptStoryboundArchive(encrypted, 'different-passphrase'))

    for (const offset of [11, 36, 63, 64, encrypted.length - 1]) {
      const tampered = Buffer.from(encrypted)
      tampered[offset] ^= 0x01
      expectInvalidArchive(() => decryptStoryboundArchive(tampered, passphrase))
    }
  })

  it('rejects truncation, trailing data, malformed magic, and unsupported versions', () => {
    const encrypted = encryptStoryboundArchive(Buffer.from('A private chapter'), passphrase)
    const malformedMagic = Buffer.from(encrypted)
    malformedMagic[0] ^= 0x01
    const unsupportedVersion = Buffer.from(encrypted)
    unsupportedVersion[8] = 2

    for (const malformed of [
      Buffer.alloc(0),
      encrypted.subarray(0, 35),
      encrypted.subarray(0, encrypted.length - 1),
      Buffer.concat([encrypted, Buffer.from([0])]),
      malformedMagic,
      unsupportedVersion
    ]) {
      expectInvalidArchive(() => decryptStoryboundArchive(malformed, passphrase))
    }
  })

  it('rejects a declared payload over 500 MB before attempting decryption', () => {
    const encrypted = encryptStoryboundArchive(Buffer.from('small archive'), passphrase)
    const oversizedDeclaration = Buffer.from(encrypted)
    oversizedDeclaration.writeUInt32BE(500 * 1024 * 1024 + 1, 16)

    expect(() => decryptStoryboundArchive(oversizedDeclaration, passphrase)).toThrowError(
      expect.objectContaining({
        name: 'EncryptedVaultError',
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Encrypted archives are limited to 500 MB.'
      })
    )
  })

  it('exposes a dedicated error type without leaking cryptographic details', () => {
    try {
      decryptStoryboundArchive(Buffer.from('not an archive'), passphrase)
      throw new Error('Expected decryption to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(EncryptedVaultError)
      expect(String(error)).not.toMatch(/aes|gcm|scrypt|auth tag|bad decrypt/i)
    }
  })
})
