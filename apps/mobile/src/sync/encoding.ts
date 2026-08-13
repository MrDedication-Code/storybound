export function bytesToBase64(value: Uint8Array): string {
  const BufferConstructor = (globalThis as unknown as { Buffer?: unknown }).Buffer as
    { from(value: Uint8Array): { toString(encoding: 'base64'): string } } | undefined
  if (BufferConstructor) return BufferConstructor.from(value).toString('base64')

  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const BufferConstructor = (globalThis as unknown as { Buffer?: unknown }).Buffer as
    { from(value: string, encoding: 'base64'): Uint8Array } | undefined
  if (BufferConstructor) return new Uint8Array(BufferConstructor.from(value, 'base64'))

  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function bytesToBase64Url(value: Uint8Array): string {
  return bytesToBase64(value).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('The base64url value is invalid.')
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
  return base64ToBytes(`${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`)
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}
