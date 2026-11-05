import { describe, expect, it } from 'vitest'
import {
  createVaultKey,
  deriveSharingIdentity,
  formatSharingAddress,
  normalizeSharingAddress,
  openParcelBody,
  openParcelLabel,
  sealParcel,
  sharingKeysMatchAddress,
  type ParcelLabelDetails,
  type SealedParcel,
  type SharingIdentity
} from '@storybound/sync'

const VAULT = '11111111-1111-4111-8111-111111111111'
const PARCEL = '22222222-2222-4222-8222-222222222222'

const details: ParcelLabelDetails = {
  senderName: 'Jack',
  shareId: '33333333-3333-4333-8333-333333333333',
  sequence: 1,
  kind: 'book',
  mode: 'read-only',
  title: 'The Book',
  authorName: 'Jack',
  chapterCount: 3,
  newChapterCount: 3,
  sentAt: '2026-11-05T12:00:00.000Z'
}

function person(): SharingIdentity {
  return deriveSharingIdentity(createVaultKey(), VAULT)
}

function seal(sender: SharingIdentity, recipient: SharingIdentity): SealedParcel {
  return sealParcel({
    parcelId: PARCEL,
    sender,
    recipient,
    details,
    body: { chapters: ['One', 'Two'] }
  })
}

describe('sharing identity', () => {
  it('gives every device holding the vault key the same address', () => {
    const vaultKey = createVaultKey()
    const first = deriveSharingIdentity(vaultKey, VAULT)
    const second = deriveSharingIdentity(vaultKey, VAULT)
    expect(second.address).toBe(first.address)
    expect(second.signingPublicKey).toBe(first.signingPublicKey)
    expect(first.address).toMatch(/^[A-HJ-NP-Z2-9]{16}$/)
  })

  it('reads an address however it was typed', () => {
    const { address } = person()
    const shown = formatSharingAddress(address)
    expect(shown).toMatch(/^.{4}-.{4}-.{4}-.{4}$/)
    expect(normalizeSharingAddress(` ${shown.toLowerCase()} `)).toBe(address)
    expect(normalizeSharingAddress('not an address')).toBeNull()
    expect(normalizeSharingAddress('O0I1O0I1O0I1O0I1')).toBeNull()
  })

  it('catches keys that do not belong to an address', () => {
    const jack = person()
    const stranger = person()
    expect(
      sharingKeysMatchAddress(jack.address, jack.encryptionPublicKey, jack.signingPublicKey)
    ).toBe(true)
    expect(
      sharingKeysMatchAddress(jack.address, stranger.encryptionPublicKey, jack.signingPublicKey)
    ).toBe(false)
    expect(sharingKeysMatchAddress(jack.address, 'nonsense', 'nonsense')).toBe(false)
  })
})

describe('parcels', () => {
  it('can be opened by the recipient, who can see who sent it', () => {
    const jack = person()
    const adam = person()
    const parcel = seal(jack, adam)
    const label = openParcelLabel(adam, PARCEL, parcel.label)
    expect(label).toMatchObject({ senderName: 'Jack', title: 'The Book' })
    expect(label.senderAddress).toBe(jack.address)
    expect(openParcelBody(adam, PARCEL, label, parcel.body)).toEqual({ chapters: ['One', 'Two'] })
  })

  it('cannot be read by anyone else, and hides everything from the server', () => {
    const jack = person()
    const adam = person()
    const parcel = seal(jack, adam)
    expect(() => openParcelLabel(person(), PARCEL, parcel.label)).toThrow()
    expect(`${parcel.label}${parcel.body}`).not.toContain('The Book')
    expect(`${parcel.label}${parcel.body}`).not.toContain('Jack')
  })

  it('refuses to seal for keys that do not match the address', () => {
    const adam = person()
    const swapped = { ...adam, encryptionPublicKey: person().encryptionPublicKey }
    expect(() => seal(person(), swapped)).toThrow('do not belong')
  })

  it('refuses a parcel moved to another id or given different contents', () => {
    const jack = person()
    const adam = person()
    const parcel = seal(jack, adam)
    const other = sealParcel({
      parcelId: PARCEL,
      sender: jack,
      recipient: adam,
      details,
      body: { chapters: ['Swapped'] }
    })
    const label = openParcelLabel(adam, PARCEL, parcel.label)
    expect(() => openParcelBody(adam, PARCEL, label, other.body)).toThrow('do not match')
    expect(() =>
      openParcelLabel(adam, '44444444-4444-4444-8444-444444444444', parcel.label)
    ).toThrow()
  })

  it('refuses a sender pretending to hold someone else’s address', () => {
    const jack = person()
    const adam = person()
    const forger = person()
    const forged = sealParcel({
      parcelId: PARCEL,
      sender: { ...forger, address: jack.address },
      recipient: adam,
      details,
      body: {}
    })
    expect(() => openParcelLabel(adam, PARCEL, forged.label)).toThrow('does not match its address')
  })
})
