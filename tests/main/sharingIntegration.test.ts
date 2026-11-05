import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createVaultKey, deriveSharingIdentity } from '@storybound/sync'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { StoryboundSharingController } from '../../src/main/cloud/sharingController'
import { StoryboundStore } from '../../src/main/store'

/**
 * Two real accounts and two real libraries against a local Supabase. Run with
 * STORYBOUND_TEST_SUPABASE_URL and STORYBOUND_TEST_SUPABASE_KEY set; it is skipped otherwise.
 */
const url = process.env.STORYBOUND_TEST_SUPABASE_URL
const key = process.env.STORYBOUND_TEST_SUPABASE_KEY

interface Person {
  client: SupabaseClient
  store: StoryboundStore
  sharing: StoryboundSharingController
  address: () => Promise<string>
}

const cleanups: Array<() => void> = []

async function person(name: string): Promise<Person> {
  const client = createClient(url!, key!, { auth: { persistSession: false } })
  const signedUp = await client.auth.signUp({
    email: `${name}-${randomUUID()}@example.test`,
    password: `Storybound-${randomUUID()}!`
  })
  if (signedUp.error || !signedUp.data.session) throw signedUp.error ?? new Error('No session')
  const vaultId = randomUUID()
  const deviceId = randomUUID()
  const deviceToken = Buffer.from(randomUUID()).toString('base64url')
  const vault = await client.rpc('create_storybound_vault', {
    p_vault_id: vaultId,
    p_device_id: deviceId,
    p_device_name: name,
    p_device_token: deviceToken,
    p_key_epoch: 1,
    p_recovery_verifier: Buffer.from(randomUUID()).toString('base64'),
    p_recovery_nonce: 'AAAAAAAAAAAAAAAA',
    p_recovery_ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBB'
  })
  if (vault.error) throw vault.error
  const directory = mkdtempSync(join(tmpdir(), `storybound-${name}-`))
  const store = await StoryboundStore.open(directory)
  cleanups.push(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const identity = deriveSharingIdentity(createVaultKey(), vaultId)
  const sharing = new StoryboundSharingController(
    store,
    {
      sharingAccess: async () => ({ client, deviceId, deviceToken, identity }),
      syncNow: async () => ({}) as never
    },
    () => ({ mimeType: 'image/jpeg', data: Buffer.from('unused') })
  )
  return {
    client,
    store,
    sharing,
    address: async () => (await sharing.status()).address!
  }
}

afterAll(() => cleanups.forEach((cleanup) => cleanup()))

describe.skipIf(!url || !key)('sending a book between two accounts', () => {
  it('goes from Jack to Adam, keeps updating, and stays locked', async () => {
    const jack = await person('jack')
    const adam = await person('adam')
    const adamAddress = await adam.address()
    const book = jack.store.createBook({
      title: 'Zero Balance',
      blurb: 'The blurb.',
      initialChapterTitle: 'Chapter 1',
      initialChapterContent: 'One.'
    })

    const share = await jack.sharing.shareBook({
      bookId: book.id,
      address: adamAddress.toLowerCase(),
      name: 'Adam',
      senderName: 'Jack',
      mode: 'read-only',
      includeBible: false
    })
    expect(share).toMatchObject({ sequence: 1, newChapters: 0, mode: 'read-only' })

    const [parcel] = await adam.sharing.listParcels()
    expect(parcel).toMatchObject({
      kind: 'book',
      senderName: 'Jack',
      title: 'Zero Balance',
      chapterCount: 1
    })

    const preview = await adam.sharing.openParcel(parcel.id)
    expect(preview).toMatchObject({ blurb: 'The blurb.', hasBible: false, wordCount: 1 })
    const accepted = await adam.sharing.acceptParcel(parcel.id)
    expect(accepted.added).toBe(1)
    expect(await adam.sharing.listParcels()).toEqual([])
    expect(adam.store.getBook(accepted.bookId).share?.senderName).toBe('Jack')

    jack.store.createChapter({ bookId: book.id, title: 'Chapter 2', content: 'Two.' })
    expect(jack.sharing.listShares(book.id)[0].newChapters).toBe(1)
    jack.store.createChapter({ bookId: book.id, title: 'Chapter 3', content: 'Three.' })
    await jack.sharing.sendUpdate({ shareId: share.id })
    jack.store.createChapter({ bookId: book.id, title: 'Chapter 4', content: 'Four.' })
    await jack.sharing.sendUpdate({ shareId: share.id })
    expect(jack.sharing.listShares(book.id)[0].newChapters).toBe(0)

    // Two updates arrived while Adam was away; only the newest is offered.
    const parcels = await adam.sharing.listParcels()
    expect(parcels).toHaveLength(1)
    expect(parcels[0]).toMatchObject({ kind: 'update', newChapterCount: 1, chapterCount: 4 })
    const updated = await adam.sharing.acceptParcel(parcels[0].id)
    expect(updated).toMatchObject({ added: 3, stale: false })
    expect(adam.store.getBook(accepted.bookId).chapters).toHaveLength(4)
    expect(() =>
      adam.store.updateChapter({
        id: adam.store.getBook(accepted.bookId).chapters[0].id,
        content: 'x'
      })
    ).toThrow('read-only')
  })

  it('gives clear answers for a wrong address, your own, and declining', async () => {
    const jack = await person('jack')
    const adam = await person('adam')
    const book = jack.store.createBook({ title: 'A Book' })
    const input = {
      bookId: book.id,
      name: 'Adam',
      senderName: 'Jack',
      mode: 'editable' as const,
      includeBible: true
    }

    await expect(jack.sharing.shareBook({ ...input, address: 'nonsense' })).rejects.toThrow(
      'does not look like'
    )
    await expect(
      jack.sharing.shareBook({ ...input, address: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })
    ).rejects.toThrow('Nobody has that address')
    await expect(
      jack.sharing.shareBook({ ...input, address: await jack.address() })
    ).rejects.toThrow('your own address')

    await jack.sharing.shareBook({ ...input, address: await adam.address() })
    const [parcel] = await adam.sharing.listParcels()
    await adam.sharing.declineParcel(parcel.id)
    expect(await adam.sharing.listParcels()).toEqual([])
    expect(adam.store.listBooks()).toHaveLength(0)
  })

  it('never shows a parcel forged in someone else’s name', async () => {
    const jack = await person('jack')
    const adam = await person('adam')
    const address = (await adam.address()).replaceAll('-', '')
    const access = await (
      jack.sharing as unknown as {
        sync: { sharingAccess(): Promise<{ deviceId: string; deviceToken: string }> }
      }
    ).sync.sharingAccess()
    await jack.sharing.status()

    const sent = await jack.client.rpc('send_storybound_parcel', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_parcel_id: randomUUID(),
      p_recipient_address: address,
      p_label: '{"ephemeralPublicKey":"AAAA","nonce":"AAAA","ciphertext":"AAAA"}',
      p_body: 'not a real parcel at all'
    })
    expect(sent.error).toBeNull()

    expect(await adam.sharing.listParcels()).toEqual([])
  })
})
