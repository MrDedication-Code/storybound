import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { SyncKeyEnvelope } from '@storybound/contracts'
import { canonicalJson } from './canonical'

/** Six words carry 48 bits, far beyond what an attacker could match within a link's lifetime. */
export const DEVICE_LINK_WORD_COUNT = 6

export const DEVICE_LINK_WORDS: readonly string[] = [
  'acorn',
  'amber',
  'anchor',
  'apple',
  'apricot',
  'arch',
  'arrow',
  'aspen',
  'atlas',
  'autumn',
  'badge',
  'bakery',
  'bamboo',
  'banjo',
  'barley',
  'basket',
  'beacon',
  'beaver',
  'beetle',
  'bell',
  'berry',
  'birch',
  'biscuit',
  'blossom',
  'bonnet',
  'boulder',
  'bramble',
  'branch',
  'breeze',
  'brick',
  'bridge',
  'brook',
  'bucket',
  'buckle',
  'butter',
  'cabin',
  'cactus',
  'camel',
  'canary',
  'candle',
  'canoe',
  'canyon',
  'cargo',
  'carpet',
  'castle',
  'cedar',
  'cello',
  'chalk',
  'cherry',
  'chess',
  'chimney',
  'cider',
  'cinder',
  'citrus',
  'clover',
  'cobble',
  'comet',
  'compass',
  'copper',
  'coral',
  'cotton',
  'crane',
  'crayon',
  'cricket',
  'crown',
  'crystal',
  'cupboard',
  'dahlia',
  'daisy',
  'dawn',
  'delta',
  'denim',
  'desert',
  'diamond',
  'dolphin',
  'dragon',
  'drum',
  'dune',
  'eagle',
  'easel',
  'ember',
  'emerald',
  'engine',
  'falcon',
  'feather',
  'fern',
  'ferry',
  'fiddle',
  'fig',
  'flame',
  'flannel',
  'flute',
  'forest',
  'fossil',
  'fountain',
  'fox',
  'galaxy',
  'garden',
  'garnet',
  'ginger',
  'glacier',
  'glider',
  'glove',
  'goose',
  'granite',
  'grape',
  'gravel',
  'guitar',
  'hammock',
  'harbour',
  'harp',
  'hazel',
  'heather',
  'helmet',
  'heron',
  'hickory',
  'honey',
  'horizon',
  'iris',
  'island',
  'ivory',
  'jacket',
  'jade',
  'jasmine',
  'jelly',
  'juniper',
  'kayak',
  'kettle',
  'kiwi',
  'koala',
  'ladder',
  'lagoon',
  'lantern',
  'lark',
  'lemon',
  'lighthouse',
  'lily',
  'linen',
  'lobster',
  'locket',
  'lotus',
  'magnet',
  'mango',
  'maple',
  'marble',
  'meadow',
  'melon',
  'meteor',
  'mitten',
  'moon',
  'moss',
  'mountain',
  'muffin',
  'nectar',
  'needle',
  'nest',
  'nugget',
  'nutmeg',
  'oak',
  'oasis',
  'ocean',
  'olive',
  'onion',
  'orbit',
  'orchard',
  'otter',
  'owl',
  'paddle',
  'panda',
  'paper',
  'parcel',
  'parrot',
  'pebble',
  'pecan',
  'pepper',
  'piano',
  'pine',
  'planet',
  'plum',
  'pocket',
  'pond',
  'poppy',
  'prairie',
  'puffin',
  'pumpkin',
  'quartz',
  'quill',
  'rabbit',
  'radish',
  'raven',
  'reef',
  'ribbon',
  'river',
  'robin',
  'rocket',
  'rose',
  'ruby',
  'saddle',
  'saffron',
  'sail',
  'salmon',
  'sapphire',
  'satchel',
  'scarf',
  'seashell',
  'shadow',
  'sheep',
  'shore',
  'silver',
  'sketch',
  'sled',
  'slipper',
  'snail',
  'snow',
  'sparrow',
  'spindle',
  'spruce',
  'squirrel',
  'star',
  'stone',
  'storm',
  'summit',
  'sunset',
  'swan',
  'tablet',
  'teapot',
  'thimble',
  'thistle',
  'thunder',
  'tiger',
  'timber',
  'toast',
  'topaz',
  'torch',
  'tower',
  'trout',
  'tulip',
  'tunnel',
  'turtle',
  'umbrella',
  'valley',
  'velvet',
  'violin',
  'walnut',
  'walrus',
  'wander',
  'whale',
  'wheat',
  'whistle',
  'willow',
  'window',
  'winter',
  'wizard',
  'wool',
  'yarn',
  'zebra'
]

export interface DeviceLinkWordsInput {
  vaultId: string
  requestId: string
  requesterPublicKey: string
  approverPublicKey: string
}

/**
 * Words both devices show while linking. They depend on both devices' public keys, so if
 * anything between them (including the sync server) substitutes either key, the words differ.
 */
export function deviceLinkWords(input: DeviceLinkWordsInput): string[] {
  const digest = sha256(
    utf8ToBytes(canonicalJson({ purpose: 'storybound-device-link-v1', ...input }))
  )
  return Array.from(digest.slice(0, DEVICE_LINK_WORD_COUNT), (byte) => DEVICE_LINK_WORDS[byte])
}

export interface DeviceLinkRequestRow {
  requestId: string
  deviceName: string
  requesterPublicKey: string
  approverDeviceId: string | null
  approverPublicKey: string | null
  createdAt: string
  expiresAt: string
}

export interface DeviceLinkStatusRow {
  requestId: string
  vaultId: string
  deviceId: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired'
  approverPublicKey: string | null
  keyEpoch: number | null
  envelope: SyncKeyEnvelope | null
  expiresAt: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/u
const STATUSES = new Set(['pending', 'approved', 'declined', 'cancelled', 'expired'])

function invalid(): never {
  throw new Error('The sync server returned an invalid device-link response.')
}

function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern && !pattern.test(value))) invalid()
  return value
}

function optionalText(value: unknown, pattern?: RegExp): string | null {
  return value === null || value === undefined ? null : text(value, pattern)
}

/** Validates list_storybound_link_requests output. */
export function parseDeviceLinkRequests(data: unknown): DeviceLinkRequestRow[] {
  if (!Array.isArray(data)) invalid()
  return data.map((item: Record<string, unknown>) => ({
    requestId: text(item?.requestId, UUID),
    deviceName: text(item.deviceName),
    requesterPublicKey: text(item.requesterPublicKey, PUBLIC_KEY),
    approverDeviceId: optionalText(item.approverDeviceId, UUID),
    approverPublicKey: optionalText(item.approverPublicKey, PUBLIC_KEY),
    createdAt: text(item.createdAt),
    expiresAt: text(item.expiresAt)
  }))
}

/** Validates get_storybound_device_link output. */
export function parseDeviceLinkStatus(data: unknown): DeviceLinkStatusRow {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid()
  const item = data as Record<string, unknown>
  const status = text(item.status)
  if (!STATUSES.has(status)) invalid()
  const keyEpoch = item.keyEpoch === null || item.keyEpoch === undefined ? null : item.keyEpoch
  if (keyEpoch !== null && (!Number.isSafeInteger(keyEpoch) || (keyEpoch as number) < 1)) invalid()
  let envelope: SyncKeyEnvelope | null = null
  if (item.envelope !== null && item.envelope !== undefined) {
    const raw = item.envelope as Record<string, unknown>
    if (raw.version !== 1 || raw.kind !== 'device' || !Number.isSafeInteger(raw.keyEpoch)) invalid()
    envelope = {
      version: 1,
      kind: 'device',
      vaultId: text(raw.vaultId, UUID),
      keyEpoch: raw.keyEpoch as number,
      nonce: text(raw.nonce),
      ciphertext: text(raw.ciphertext),
      recipientPublicKey: text(raw.recipientPublicKey, PUBLIC_KEY)
    }
  }
  if (status === 'approved' && !envelope) invalid()
  return {
    requestId: text(item.requestId, UUID),
    vaultId: text(item.vaultId, UUID),
    deviceId: text(item.deviceId, UUID),
    status: status as DeviceLinkStatusRow['status'],
    approverPublicKey: optionalText(item.approverPublicKey, PUBLIC_KEY),
    keyEpoch: keyEpoch as number | null,
    envelope,
    expiresAt: text(item.expiresAt)
  }
}
