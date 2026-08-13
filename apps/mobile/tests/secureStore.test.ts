import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))

import { ChunkedSecureStorage, type SecureStoreBackend } from '../src/sync/secureStore'

class MemorySecureStore implements SecureStoreBackend {
  readonly values = new Map<string, string>()
  failWhenValueStartsWith: string | null = null

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failWhenValueStartsWith && value.startsWith(this.failWhenValueStartsWith)) {
      throw new Error('secure-store write failed')
    }
    this.values.set(key, value)
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key)
  }
}

describe('chunked secure storage', () => {
  let backend: MemorySecureStore
  let storage: ChunkedSecureStorage

  beforeEach(() => {
    backend = new MemorySecureStore()
    storage = new ChunkedSecureStorage('test-auth', backend)
  })

  it('round-trips, replaces, and removes values larger than one platform-safe chunk', async () => {
    const first = 'a'.repeat(5000)
    await storage.setItem('session', first)
    await expect(storage.getItem('session')).resolves.toBe(first)

    await storage.setItem('session', 'replacement')
    await expect(storage.getItem('session')).resolves.toBe('replacement')
    expect([...backend.values.values()].some((value) => value === first)).toBe(false)

    await storage.removeItem('session')
    await expect(storage.getItem('session')).resolves.toBeNull()
    expect(backend.values.size).toBe(0)
  })

  it('keeps the previous manifest readable when a replacement write fails', async () => {
    await storage.setItem('session', 'previous-session')
    backend.failWhenValueStartsWith = 'blocked'

    await expect(storage.setItem('session', 'blocked'.repeat(500))).rejects.toThrow(
      'secure-store write failed'
    )
    await expect(storage.getItem('session')).resolves.toBe('previous-session')
  })

  it('rejects unexpectedly large credentials', async () => {
    await expect(storage.setItem('session', 'a'.repeat(128 * 1024 + 1))).rejects.toThrow(
      'unexpectedly large'
    )
  })
})
