import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import {
  AI_USES,
  BOOKSTORE_GENRES,
  CONTENT_WARNINGS,
  REPORT_REASONS,
  type ReportReason,
  type StoreListing
} from '@storybound/contracts'
import type { MobileBookstore } from '../bookstore/mobileBookstore'
import { AppHeader } from '../components/AppHeader'
import { BookArtwork } from '../components/BookArtwork'
import { BottomSheet } from '../components/BottomSheet'
import { PrimaryButton } from '../components/PrimaryButton'
import { coverToneFromStyle } from '../sync/entityMapping'
import { storyboundColors } from '../theme'
import { storeStyles } from './bookstoreStyles'

function labelOf(items: readonly { id: string; label: string }[], id: string): string {
  return items.find((item) => item.id === id)?.label ?? id
}

function reason(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

function ReportSheet({
  bookstore,
  listing,
  onClose,
  onSent
}: {
  bookstore: MobileBookstore
  listing: StoreListing
  onClose: () => void
  onSent: () => void
}): React.JSX.Element {
  const [choice, setChoice] = useState<ReportReason>('other')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <BottomSheet onClose={onClose}>
      <View style={storeStyles.panel}>
        <Text style={storeStyles.heading}>Report this book</Text>
        <Text style={storeStyles.hint}>The author won’t see who sent this.</Text>
        {error ? <Text style={storeStyles.error}>{error}</Text> : null}
        {REPORT_REASONS.map((item) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: choice === item.id }}
            key={item.id}
            style={storeStyles.check}
            onPress={() => setChoice(item.id)}
          >
            <View style={[storeStyles.checkBox, choice === item.id && storeStyles.checkBoxOn]} />
            <Text style={storeStyles.checkLabel}>{item.label}</Text>
          </Pressable>
        ))}
        <TextInput
          accessibilityLabel="Anything else we should know?"
          maxLength={2000}
          multiline
          placeholder="Anything else we should know?"
          placeholderTextColor={storyboundColors.muted}
          style={[storeStyles.input, styles.detail]}
          value={detail}
          onChangeText={setDetail}
        />
        <PrimaryButton
          disabled={busy}
          label={busy ? 'Sending…' : 'Send report'}
          onPress={() => {
            setBusy(true)
            setError('')
            bookstore
              .report({ listingId: listing.id, reason: choice, detail: detail.trim() })
              .then(onSent)
              .catch((caught: unknown) => {
                setError(reason(caught, 'The report could not be sent.'))
                setBusy(false)
              })
          }}
        />
      </View>
    </BottomSheet>
  )
}

export function BookstoreBookScreen({
  bookstore,
  listingId,
  onBack,
  onOpenBook
}: {
  bookstore: MobileBookstore
  listingId: string
  onBack: () => void
  onOpenBook: (bookId: string) => void
}): React.JSX.Element {
  const [listing, setListing] = useState<StoreListing | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      setListing(await bookstore.listing(listingId))
    } catch (caught) {
      setError(reason(caught, 'That book could not be opened.'))
    }
  }, [bookstore, listingId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const add = async (): Promise<void> => {
    setAdding(true)
    setError('')
    try {
      onOpenBook(await bookstore.addBook(listingId))
    } catch (caught) {
      setError(reason(caught, 'That book could not be added.'))
      setAdding(false)
    }
  }

  return (
    <View style={storeStyles.screen}>
      <AppHeader title="Bookstore" onBack={onBack} />
      <ScrollView contentContainerStyle={storeStyles.content}>
        {error ? <Text style={storeStyles.error}>{error}</Text> : null}
        {!listing && !error ? (
          <ActivityIndicator color={storyboundColors.brass} style={storeStyles.spinner} />
        ) : null}
        {listing ? (
          <>
            <View style={styles.cover}>
              <BookArtwork
                book={{
                  title: listing.title,
                  coverTone: coverToneFromStyle(listing.coverStyle),
                  coverUri: listing.coverThumb
                }}
                size="hero"
              />
            </View>
            <Text style={storeStyles.heading}>{listing.title}</Text>
            {listing.subtitle ? <Text style={storeStyles.copy}>{listing.subtitle}</Text> : null}
            <Text style={storeStyles.copy}>by {listing.authorName}</Text>
            <Text style={storeStyles.hint}>
              {labelOf(BOOKSTORE_GENRES, listing.genre)} · {listing.chapterCount}{' '}
              {listing.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
              {listing.wordCount.toLocaleString()} words · {labelOf(AI_USES, listing.aiUse)}
            </Text>
            {listing.contentWarnings.length ? (
              <Text style={storeStyles.hint}>
                Content warnings:{' '}
                {listing.contentWarnings.map((item) => labelOf(CONTENT_WARNINGS, item)).join(', ')}
              </Text>
            ) : null}
            <Text style={storeStyles.copy}>{listing.blurb}</Text>
            {listing.libraryBookId ? (
              <PrimaryButton
                label="Open in your library"
                onPress={() => onOpenBook(listing.libraryBookId!)}
              />
            ) : listing.mine ? (
              <Text style={storeStyles.hint}>This is your book.</Text>
            ) : (
              <PrimaryButton
                disabled={adding}
                label={adding ? 'Adding…' : 'Add to library'}
                onPress={() => void add()}
              />
            )}
            {!listing.mine ? (
              <PrimaryButton
                disabled={reported}
                label={reported ? 'Thank you. The report was sent.' : 'Report'}
                variant="quiet"
                onPress={() => setReporting(true)}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {reporting && listing ? (
        <ReportSheet
          bookstore={bookstore}
          listing={listing}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false)
            setReported(true)
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center'
  },
  detail: {
    minHeight: 80,
    paddingTop: 10,
    textAlignVertical: 'top'
  }
})
