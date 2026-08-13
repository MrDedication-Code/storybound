import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SupportedStorage } from '@supabase/supabase-js'

const MAX_CREDENTIAL_FILE_BYTES = 2 * 1024 * 1024
const STORAGE_VERSION = 1

export interface CredentialProtector {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Promise<Buffer>
  decryptString(value: Buffer): Promise<CredentialDecryption>
}

export interface CredentialDecryption {
  value: string
  shouldReEncrypt: boolean
}

interface StoredCredentials {
  version: typeof STORAGE_VERSION
  values: Record<string, string>
}

export class SecureCredentialStorage implements SupportedStorage {
  private operation: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly protector: CredentialProtector
  ) {}

  async getItem(key: string): Promise<string | null> {
    await this.operation
    const stored = await this.read()
    return stored.values[key] ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    this.validateEntry(key, value)
    await this.queue(async () => {
      const stored = await this.read()
      stored.values[key] = value
      await this.write(stored)
    })
  }

  async removeItem(key: string): Promise<void> {
    this.validateKey(key)
    await this.queue(async () => {
      const stored = await this.read()
      if (!(key in stored.values)) return
      delete stored.values[key]
      if (Object.keys(stored.values).length === 0) {
        await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        return
      }
      await this.write(stored)
    })
  }

  private async queue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation, operation)
    this.operation = next.catch(() => undefined)
    await next
  }

  private async read(): Promise<StoredCredentials> {
    this.assertAvailable()
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: STORAGE_VERSION, values: {} }
      }
      throw error
    }
    if (encrypted.length > MAX_CREDENTIAL_FILE_BYTES) {
      throw new Error('The local cloud credential store is unexpectedly large.')
    }

    const decrypted = await this.protector.decryptString(encrypted)
    const parsed = JSON.parse(decrypted.value) as unknown
    if (!isStoredCredentials(parsed)) {
      throw new Error('The local cloud credential store is invalid.')
    }
    if (decrypted.shouldReEncrypt) await this.write(parsed)
    return parsed
  }

  private async write(stored: StoredCredentials): Promise<void> {
    this.assertAvailable()
    const plaintext = JSON.stringify(stored)
    const encrypted = await this.protector.encryptString(plaintext)
    if (encrypted.length > MAX_CREDENTIAL_FILE_BYTES) {
      throw new Error('The local cloud credential store is unexpectedly large.')
    }

    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.path}.tmp`
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: 'w' })
    await rename(temporaryPath, this.path)
  }

  private validateEntry(key: string, value: string): void {
    this.validateKey(key)
    if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_FILE_BYTES) {
      throw new TypeError('Credential values must be bounded strings.')
    }
  }

  private validateKey(key: string): void {
    if (!/^[A-Za-z0-9._:-]{1,240}$/.test(key)) {
      throw new TypeError('Credential keys contain unsupported characters.')
    }
  }

  private assertAvailable(): void {
    if (!this.protector.isEncryptionAvailable()) {
      throw new Error('Secure operating-system credential storage is unavailable.')
    }
  }
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredCredentials>
  if (candidate.version !== STORAGE_VERSION || !candidate.values) return false
  return Object.entries(candidate.values).every(
    ([key, item]) => /^[A-Za-z0-9._:-]{1,240}$/.test(key) && typeof item === 'string'
  )
}
