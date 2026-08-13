import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStoryboundCloudConfig } from '../../src/main/cloud/config'
import {
  SecureCredentialStorage,
  type CredentialProtector
} from '../../src/main/cloud/secureCredentials'

class TestProtector implements CredentialProtector {
  constructor(private readonly available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available
  }

  async encryptString(value: string): Promise<Buffer> {
    return Buffer.from(Array.from(Buffer.from(value, 'utf8'), (byte) => byte ^ 0xa5))
  }

  async decryptString(value: Buffer): Promise<{ value: string; shouldReEncrypt: boolean }> {
    return {
      value: Buffer.from(Array.from(value, (byte) => byte ^ 0xa5)).toString('utf8'),
      shouldReEncrypt: false
    }
  }
}

describe('cloud configuration', () => {
  it('keeps cloud sync disabled when no configuration is present', () => {
    expect(loadStoryboundCloudConfig({})).toBeNull()
  })

  it('requires paired settings and secure remote URLs', () => {
    expect(() =>
      loadStoryboundCloudConfig({ STORYBOUND_SUPABASE_URL: 'https://example.supabase.co' })
    ).toThrow('requires both')
    expect(() =>
      loadStoryboundCloudConfig({
        STORYBOUND_SUPABASE_URL: 'http://example.test',
        STORYBOUND_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890'
      })
    ).toThrow('requires HTTPS')
    expect(
      loadStoryboundCloudConfig({
        STORYBOUND_SUPABASE_URL: 'http://127.0.0.1:54321/',
        STORYBOUND_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key-value'
      })
    ).toEqual({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'local-publishable-key-value'
    })
  })
})

describe('secure cloud credential storage', () => {
  it('serializes concurrent changes into an OS-protected atomic file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storybound-cloud-credentials-'))
    const path = join(directory, 'credentials.bin')
    const storage = new SecureCredentialStorage(path, new TestProtector())

    await Promise.all([
      storage.setItem('auth.session', 'first-secret'),
      storage.setItem('sync.device', 'second-secret')
    ])

    expect(await storage.getItem('auth.session')).toBe('first-secret')
    expect(await storage.getItem('sync.device')).toBe('second-secret')
    expect((await readFile(path, 'utf8')).includes('first-secret')).toBe(false)
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    await storage.removeItem('auth.session')
    expect(await storage.getItem('auth.session')).toBeNull()
    expect(await storage.getItem('sync.device')).toBe('second-secret')
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    const storage = new SecureCredentialStorage('/unused/credentials.bin', new TestProtector(false))
    await expect(storage.getItem('auth.session')).rejects.toThrow('unavailable')
  })

  it('rejects unsafe keys before touching storage', async () => {
    const storage = new SecureCredentialStorage('/unused/credentials.bin', new TestProtector())
    await expect(storage.setItem('../secret', 'value')).rejects.toThrow('unsupported')
  })
})
