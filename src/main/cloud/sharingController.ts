import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatSharingAddress,
  normalizeSharingAddress,
  openParcelBody,
  openParcelLabel,
  sealParcel,
  sharingKeysMatchAddress,
  type ParcelLabel,
  type SharingIdentity
} from '@storybound/sync'
import { z } from 'zod'
import {
  sharedBookSchema,
  type BookShare,
  type ParcelPreview,
  type ParcelResult,
  type ParcelSummary,
  type ShareBookInput,
  type ShareContact,
  type ShareMode,
  type SharedBook,
  type SharingStatus,
  type UpdateShareInput
} from '../../shared/sharing'
import { countWords } from '../../shared/text'
import { StoryboundError } from '../errors'
import {
  sharedEntityId,
  type BookShareRow,
  type ShareContactKeys,
  type StoryboundStore
} from '../store'
import { encodeCoverForSync } from './coverEncoder'
import type { StoryboundSyncController } from './syncController'

/** The server's limit, leaving room for the sealed wrapping. */
const MAX_PARCEL_CHARACTERS = 24 * 1024 * 1024

const parcelRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    label: z.string().min(1),
    createdAt: z.string(),
    expiresAt: z.string()
  })
)

const publishedKeysSchema = z.object({
  address: z.string(),
  encryptionPublicKey: z.string(),
  signingPublicKey: z.string()
})

export interface SharingAccess {
  client: SupabaseClient
  deviceId: string
  deviceToken: string
  identity: SharingIdentity
}

interface OpenedParcel {
  label: ParcelLabel
  book: SharedBook
}

function networkError(message: string, error: unknown): StoryboundError {
  return new StoryboundError('NETWORK_ERROR', message, error)
}

/** Sends books to other accounts and takes in the ones sent here. */
export class StoryboundSharingController {
  private publishedAddress = ''
  private readonly labels = new Map<string, ParcelSummary & { label: ParcelLabel }>()
  private readonly opened = new Map<string, OpenedParcel>()

  constructor(
    private readonly store: StoryboundStore,
    private readonly sync: Pick<StoryboundSyncController, 'sharingAccess' | 'syncNow'>,
    private readonly encodeCover: typeof encodeCoverForSync = encodeCoverForSync
  ) {}

  async status(): Promise<SharingStatus> {
    const senderName = this.store.getShareSenderName()
    const access = await this.sync.sharingAccess()
    if (!access) return { available: false, address: null, senderName }
    await this.publish(access)
    return {
      available: true,
      address: formatSharingAddress(access.identity.address),
      senderName
    }
  }

  /** Copies this account's address, for handing to someone. */
  async addressForCopying(): Promise<string> {
    const { identity } = await this.requireAccess()
    return formatSharingAddress(identity.address)
  }

  listContacts(): ShareContact[] {
    return this.store.listShareContacts()
  }

  listShares(bookId: string): BookShare[] {
    return this.store.listBookShares(bookId)
  }

  stopSharing(shareId: string): void {
    this.store.removeBookShare(shareId)
  }

  async shareBook(input: ShareBookInput): Promise<BookShare> {
    const access = await this.requireAccess()
    const address = normalizeSharingAddress(input.address)
    if (!address) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'That does not look like a Storybound address. It has 16 letters and numbers.'
      )
    }
    if (address === access.identity.address) {
      throw new StoryboundError('VALIDATION_ERROR', 'That is your own address.')
    }
    const contact = await this.findContact(access, address, input.name)
    this.store.saveShareContact(contact)
    this.store.setShareSenderName(input.senderName)
    return this.send(access, {
      bookId: input.bookId,
      contact,
      share: this.store.findBookShare(input.bookId, address),
      mode: input.mode,
      includeBible: input.includeBible
    })
  }

  async sendUpdate(input: UpdateShareInput): Promise<BookShare> {
    const access = await this.requireAccess()
    const share = this.store.getBookShare(input.shareId)
    const contact = this.store.getShareContact(share.contact_address)
    if (!contact) throw new StoryboundError('NOT_FOUND', 'That person could not be found.')
    return this.send(access, {
      bookId: share.book_id,
      contact,
      share,
      mode: input.mode ?? share.mode,
      includeBible: input.includeBible ?? share.include_bible === 1
    })
  }

  /** The parcels waiting for this account. Only the newest update of each book is kept. */
  async listParcels(): Promise<ParcelSummary[]> {
    const access = await this.sync.sharingAccess()
    if (!access) return []
    await this.publish(access)
    const { data, error } = await access.client.rpc('list_storybound_parcels', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken
    })
    if (error) throw networkError('Storybound could not check for parcels.', error)
    const rows = parcelRowsSchema.parse(data)

    const parcels: Array<ParcelSummary & { label: ParcelLabel }> = []
    for (const row of rows) {
      try {
        const label = openParcelLabel(access.identity, row.id, row.label)
        parcels.push(summaryOf(row.id, label, row.expiresAt))
      } catch {
        // Anyone can address a parcel, so one that cannot be proven genuine is never shown.
        await this.remove(access, row.id)
      }
    }

    const newest = new Map<string, ParcelSummary & { label: ParcelLabel }>()
    for (const parcel of parcels) {
      const current = newest.get(parcel.label.shareId)
      if (!current || parcel.label.sequence > current.label.sequence) {
        if (current) await this.remove(access, current.id)
        newest.set(parcel.label.shareId, parcel)
      } else {
        await this.remove(access, parcel.id)
      }
    }
    this.labels.clear()
    for (const parcel of newest.values()) this.labels.set(parcel.id, parcel)
    return [...newest.values()].map(publicSummary)
  }

  /** Fetches and opens a parcel, to show the book before it is collected. */
  async openParcel(parcelId: string): Promise<ParcelPreview> {
    const access = await this.requireAccess()
    const summary = this.requireLabel(parcelId)
    const { book } = await this.readParcel(access, parcelId)
    return {
      ...publicSummary(summary),
      bookId: sharedEntityId(summary.label.shareId, book.book.sourceId),
      subtitle: book.book.subtitle,
      seriesName: book.book.seriesName,
      seriesPosition: book.book.seriesPosition,
      blurb: book.book.blurb,
      coverStyle: book.book.coverStyle,
      coverDataUrl: book.cover ? `data:${book.cover.mimeType};base64,${book.cover.data}` : null,
      coverPositionX: book.book.coverPositionX,
      coverPositionY: book.book.coverPositionY,
      wordCount: book.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0),
      hasBible: book.bible !== null
    }
  }

  async acceptParcel(parcelId: string): Promise<ParcelResult> {
    const access = await this.requireAccess()
    const { label, book } = await this.readParcel(access, parcelId)
    const result = this.store.receiveSharedBook(
      {
        shareId: label.shareId,
        sequence: label.sequence,
        mode: label.mode,
        senderName: label.senderName,
        senderAddress: label.senderAddress
      },
      book
    )
    await this.remove(access, parcelId)
    this.opened.delete(parcelId)
    this.labels.delete(parcelId)
    // The book reaches this person's other devices through sync.
    void this.sync.syncNow().catch(() => undefined)
    return result
  }

  async declineParcel(parcelId: string): Promise<void> {
    const access = await this.requireAccess()
    await this.remove(access, parcelId)
    this.opened.delete(parcelId)
    this.labels.delete(parcelId)
  }

  private async send(
    access: SharingAccess,
    input: {
      bookId: string
      contact: ShareContactKeys
      share: BookShareRow | null
      mode: ShareMode
      includeBible: boolean
    }
  ): Promise<BookShare> {
    const { contact, share, mode, includeBible } = input
    const prepared = this.store.prepareSharedBook({
      bookId: input.bookId,
      shareId: share?.id ?? null,
      includeBible,
      encodeCover: this.encodeCover
    })
    const shareId = share?.id ?? randomUUID()
    const sequence = (share?.sequence ?? 0) + 1
    const parcelId = randomUUID()
    const sealed = sealParcel({
      parcelId,
      sender: access.identity,
      recipient: contact,
      details: {
        senderName: this.store.getShareSenderName() || 'A Storybound reader',
        shareId,
        sequence,
        kind: share ? 'update' : 'book',
        mode,
        title: prepared.title,
        authorName: prepared.authorName,
        chapterCount: prepared.body.chapters.length,
        newChapterCount: prepared.newChapterCount,
        sentAt: new Date().toISOString()
      },
      body: prepared.body
    })
    if (sealed.body.length > MAX_PARCEL_CHARACTERS) {
      throw new StoryboundError('VALIDATION_ERROR', 'This book is too large to send as a parcel.')
    }
    const { error } = await access.client.rpc('send_storybound_parcel', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_parcel_id: parcelId,
      p_recipient_address: contact.address,
      p_label: sealed.label,
      p_body: sealed.body
    })
    if (error) {
      throw networkError(
        error.message.includes('unopened parcels')
          ? 'They have too many unopened parcels. Ask them to open Storybound.'
          : 'The parcel could not be sent. Check your connection and try again.',
        error
      )
    }
    this.store.recordShareSent({
      shareId,
      bookId: input.bookId,
      address: contact.address,
      mode,
      includeBible,
      sequence,
      prepared
    })
    const sent = this.store.listBookShares(input.bookId).find((item) => item.id === shareId)
    if (!sent) throw new StoryboundError('DATABASE_ERROR', 'The sent parcel was not recorded.')
    return sent
  }

  private async findContact(
    access: SharingAccess,
    address: string,
    name: string
  ): Promise<ShareContactKeys> {
    const { data, error } = await access.client.rpc('find_storybound_address', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_address: address
    })
    if (error) throw networkError('Storybound could not look up that address.', error)
    if (data === null) {
      throw new StoryboundError(
        'NOT_FOUND',
        'Nobody has that address. Check it, and ask them to open Storybound with sync turned on.'
      )
    }
    const keys = publishedKeysSchema.parse(data)
    // The address is a fingerprint of the keys, so the server cannot swap in someone else's.
    if (
      keys.address !== address ||
      !sharingKeysMatchAddress(address, keys.encryptionPublicKey, keys.signingPublicKey)
    ) {
      throw new StoryboundError(
        'SECURITY_ERROR',
        'The server’s answer does not match this address, so nothing was sent.'
      )
    }
    return {
      address,
      name,
      encryptionPublicKey: keys.encryptionPublicKey,
      signingPublicKey: keys.signingPublicKey
    }
  }

  private async readParcel(access: SharingAccess, parcelId: string): Promise<OpenedParcel> {
    const opened = this.opened.get(parcelId)
    if (opened) return opened
    const { label } = this.requireLabel(parcelId)
    const { data, error } = await access.client.rpc('get_storybound_parcel', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_parcel_id: parcelId
    })
    if (error || typeof data !== 'string') {
      throw networkError('The parcel could not be fetched. Try again.', error)
    }
    const parsed = sharedBookSchema.safeParse(
      openParcelBody(access.identity, parcelId, label, data)
    )
    if (!parsed.success) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'This parcel is from a newer version of Storybound. Update the app and try again.',
        parsed.error
      )
    }
    const result = { label, book: parsed.data }
    this.opened.set(parcelId, result)
    return result
  }

  private requireLabel(parcelId: string): ParcelSummary & { label: ParcelLabel } {
    const parcel = this.labels.get(parcelId)
    if (!parcel) throw new StoryboundError('NOT_FOUND', 'That parcel is no longer waiting.')
    return parcel
  }

  private async remove(access: SharingAccess, parcelId: string): Promise<void> {
    const { error } = await access.client.rpc('delete_storybound_parcel', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_parcel_id: parcelId
    })
    if (error) throw networkError('The parcel could not be removed.', error)
  }

  private async publish(access: SharingAccess): Promise<void> {
    if (this.publishedAddress === access.identity.address) return
    const { error } = await access.client.rpc('publish_storybound_address', {
      p_device_id: access.deviceId,
      p_device_token: access.deviceToken,
      p_address: access.identity.address,
      p_encryption_public_key: access.identity.encryptionPublicKey,
      p_signing_public_key: access.identity.signingPublicKey
    })
    if (error) throw networkError('Storybound could not set up your address.', error)
    this.publishedAddress = access.identity.address
  }

  private async requireAccess(): Promise<SharingAccess> {
    const access = await this.sync.sharingAccess()
    if (!access) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Turn on sync first, in Settings → Sync & devices.'
      )
    }
    await this.publish(access)
    return access
  }
}

/** A parcel without its signed label, which stays in this process. */
function publicSummary(parcel: ParcelSummary & { label: ParcelLabel }): ParcelSummary {
  const summary: ParcelSummary & { label?: ParcelLabel } = { ...parcel }
  delete summary.label
  return summary
}

function summaryOf(
  id: string,
  label: ParcelLabel,
  expiresAt: string
): ParcelSummary & { label: ParcelLabel } {
  return {
    id,
    kind: label.kind,
    senderName: label.senderName,
    senderAddress: formatSharingAddress(label.senderAddress),
    mode: label.mode,
    title: label.title,
    authorName: label.authorName,
    chapterCount: label.chapterCount,
    newChapterCount: label.newChapterCount,
    sentAt: label.sentAt,
    expiresAt,
    label
  }
}
