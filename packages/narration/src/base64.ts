const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Uint8Array(128)
for (let index = 0; index < ALPHABET.length; index += 1) LOOKUP[ALPHABET.charCodeAt(index)] = index

/** Decodes base64 without relying on Node's Buffer or a browser's atob, so both apps share it. */
export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let byte = 0
  for (let index = 0; index + 1 < clean.length; index += 4) {
    const a = LOOKUP[clean.charCodeAt(index)]
    const b = LOOKUP[clean.charCodeAt(index + 1)]
    const c = LOOKUP[clean.charCodeAt(index + 2) || 65]
    const d = LOOKUP[clean.charCodeAt(index + 3) || 65]
    bytes[byte++] = (a << 2) | (b >> 4)
    if (index + 2 < clean.length) bytes[byte++] = ((b & 15) << 4) | (c >> 2)
    if (index + 3 < clean.length) bytes[byte++] = ((c & 3) << 6) | d
  }
  return bytes.subarray(0, byte)
}
