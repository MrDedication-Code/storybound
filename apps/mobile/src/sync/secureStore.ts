import * as SecureStore from 'expo-secure-store'
import type { SupportedStorage } from '@supabase/supabase-js'

const STORAGE_VERSION = 1
const CHUNK_CHARACTERS = 1600
const MAX_VALUE_CHARACTERS = 128 * 1024
const MAX_CHUNKS = Math.ceil(MAX_VALUE_CHARACTERS / CHUNK_CHARACTERS)

export interface SecureStoreBackend {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

interface StorageManifest {
  version: typeof STORAGE_VERSION
  generation: string
  chunks: number
}

function safeKey(value: string): string {
  if (value.length < 1 || value.length > 512) throw new TypeError('Secure-store keys are invalid.')
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

function parseManifest(raw: string | null): StorageManifest | null {
  if (!raw) return null
  const parsed = JSON.parse(raw) as Partial<StorageManifest>
  if (
    parsed.version !== STORAGE_VERSION ||
    typeof parsed.generation !== 'string' ||
    !/^[A-Za-z0-9-]{1,80}$/u.test(parsed.generation) ||
    !Number.isInteger(parsed.chunks) ||
    (parsed.chunks ?? 0) < 1 ||
    (parsed.chunks ?? 0) > MAX_CHUNKS
  ) {
    throw new Error('Secure credential metadata is invalid.')
  }
  return parsed as StorageManifest
}

export class ChunkedSecureStorage implements SupportedStorage {
  private operation: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(
    private readonly namespace: string,
    private readonly backend: SecureStoreBackend = SecureStore
  ) {}

  async getItem(key: string): Promise<string | null> {
    await this.operation
    const base = this.baseKey(key)
    const manifest = parseManifest(await this.backend.getItemAsync(`${base}.manifest`))
    if (!manifest) return null
    const chunks = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        this.backend.getItemAsync(`${base}.${manifest.generation}.${index}`)
      )
    )
    if (chunks.some((chunk) => chunk === null)) {
      throw new Error('Secure credentials are incomplete.')
    }
    return chunks.join('')
  }

  async setItem(key: string, value: string): Promise<void> {
    if (value.length > MAX_VALUE_CHARACTERS) {
      throw new Error('Secure credentials are unexpectedly large.')
    }
    await this.queue(async () => {
      const base = this.baseKey(key)
      const manifestKey = `${base}.manifest`
      const previous = parseManifest(await this.backend.getItemAsync(manifestKey))
      const generation = `${Date.now().toString(36)}-${(this.generation += 1).toString(36)}`
      const chunks = value.match(new RegExp(`.{1,${CHUNK_CHARACTERS}}`, 'gsu')) ?? ['']
      const next: StorageManifest = { version: STORAGE_VERSION, generation, chunks: chunks.length }

      try {
        await Promise.all(
          chunks.map((chunk, index) =>
            this.backend.setItemAsync(`${base}.${generation}.${index}`, chunk)
          )
        )
        await this.backend.setItemAsync(manifestKey, JSON.stringify(next))
      } catch (error) {
        await Promise.all(
          chunks.map((_chunk, index) =>
            this.backend.deleteItemAsync(`${base}.${generation}.${index}`).catch(() => undefined)
          )
        )
        throw error
      }
      if (previous) await this.deleteChunks(base, previous)
    })
  }

  async removeItem(key: string): Promise<void> {
    await this.queue(async () => {
      const base = this.baseKey(key)
      const manifestKey = `${base}.manifest`
      const manifest = parseManifest(await this.backend.getItemAsync(manifestKey))
      await this.backend.deleteItemAsync(manifestKey)
      if (manifest) await this.deleteChunks(base, manifest)
    })
  }

  private baseKey(key: string): string {
    return `storybound.${safeKey(this.namespace)}.${safeKey(key)}`
  }

  private async deleteChunks(base: string, manifest: StorageManifest): Promise<void> {
    await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        this.backend
          .deleteItemAsync(`${base}.${manifest.generation}.${index}`)
          .catch(() => undefined)
      )
    )
  }

  private async queue(task: () => Promise<void>): Promise<void> {
    const next = this.operation.then(task, task)
    this.operation = next.catch(() => undefined)
    await next
  }
}
