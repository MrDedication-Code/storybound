import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * A shared book's ids are worked out from the share and the sender's ids, so every device of the
 * recipient recognises the same chapter, and two people's copies can never collide.
 */
export function sharedEntityId(shareId: string, sourceId: string): string {
  const hash = sha256(utf8ToBytes(`storybound-share:${shareId}:${sourceId}`))
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = bytesToHex(hash.subarray(0, 16))
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The hash of a file that is text, as the server records it. */
export function textSha256(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}
