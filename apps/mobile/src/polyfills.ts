import * as ExpoCrypto from 'expo-crypto'

interface RuntimeCrypto {
  getRandomValues?: typeof ExpoCrypto.getRandomValues
  randomUUID?(): string
}

export function installRuntimePolyfills(): void {
  const runtime = globalThis as unknown as { crypto?: RuntimeCrypto }
  if (!runtime.crypto) {
    Object.defineProperty(runtime, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: ExpoCrypto.getRandomValues,
        randomUUID: ExpoCrypto.randomUUID
      }
    })
    return
  }
  runtime.crypto.getRandomValues ??= ExpoCrypto.getRandomValues
  runtime.crypto.randomUUID ??= ExpoCrypto.randomUUID
}
