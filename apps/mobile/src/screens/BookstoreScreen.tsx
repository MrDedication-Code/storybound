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
  BOOKSTORE_GENRES,
  type BookstoreGenre,
  type BookstoreStatus,
  type StoreCard
} from '@storybound/contracts'
import type { MobileBookstore } from '../bookstore/mobileBookstore'
import { AppHeader } from '../components/AppHeader'
import { BookArtwork } from '../components/BookArtwork'
import { PrimaryButton } from '../components/PrimaryButton'
import { coverToneFromStyle } from '../sync/entityMapping'
import type { MobileSyncController } from '../sync/types'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

type Sort = 'new' | 'popular'
type AccountMode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'

const MINIMUM_PASSWORD = 10

function reason(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

function Input({
  label,
  value,
  onChangeText,
  secure = false,
  email = false
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  secure?: boolean
  email?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoComplete={email ? 'email' : undefined}
        autoCorrect={false}
        keyboardType={email ? 'email-address' : 'default'}
        secureTextEntry={secure}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  )
}

function AccountForm({
  controller,
  onDone
}: {
  controller: MobileSyncController
  onDone: () => void
}): React.JSX.Element {
  const [mode, setMode] = useState<AccountMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchTo = (next: AccountMode): void => {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'sign-in') {
        await controller.signIn(email, password)
        onDone()
      } else if (mode === 'sign-up') {
        const status = await controller.signUp(email, password)
        if (status.accountEmail) onDone()
        else {
          switchTo('sign-in')
          setNotice('Check your email to confirm the account, then sign in.')
        }
      } else if (mode === 'forgot') {
        await controller.requestPasswordReset(email)
        switchTo('reset')
        setNotice('If that email has an account, a code is on its way. Enter it below.')
      } else {
        await controller.resetPassword({ email, code, password })
        onDone()
      }
    } catch (caught) {
      setError(reason(caught, 'That could not be done. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const newPassword = mode === 'sign-up' || mode === 'reset'
  const ready =
    email.trim() &&
    (mode === 'forgot' ||
      (password &&
        (!newPassword || password.length >= MINIMUM_PASSWORD) &&
        (mode !== 'reset' || code)))

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>
        {
          {
            'sign-in': 'Sign in',
            'sign-up': 'Create an account',
            forgot: 'Reset your password',
            reset: 'Choose a new password'
          }[mode]
        }
      </Text>
      {mode === 'sign-up' ? (
        <Text style={styles.copy}>
          Your books stay on your phone. Sync is separate, and stays off until you turn it on.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.copy}>{notice}</Text> : null}
      <Input email label="Email" value={email} onChangeText={setEmail} />
      {mode === 'reset' ? (
        <Input label="Code from the email" value={code} onChangeText={setCode} />
      ) : null}
      {mode !== 'forgot' ? (
        <Input
          secure
          label={mode === 'reset' ? 'New password' : 'Password'}
          value={password}
          onChangeText={setPassword}
        />
      ) : null}
      {newPassword ? (
        <Text style={styles.hint}>At least {MINIMUM_PASSWORD} characters.</Text>
      ) : null}
      <PrimaryButton
        disabled={busy || !ready}
        label={
          busy
            ? 'One moment…'
            : mode === 'sign-up'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Email me a code'
                : mode === 'reset'
                  ? 'Save new password'
                  : 'Sign in'
        }
        onPress={() => void submit()}
      />
      {mode === 'sign-in' ? (
        <>
          <PrimaryButton
            label="Create an account"
            variant="secondary"
            onPress={() => switchTo('sign-up')}
          />
          <PrimaryButton
            label="Forgot your password?"
            variant="quiet"
            onPress={() => switchTo('forgot')}
          />
        </>
      ) : (
        <PrimaryButton
          label="Back to sign in"
          variant="quiet"
          onPress={() => switchTo('sign-in')}
        />
      )}
    </View>
  )
}

function Check({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.check}
      onPress={() => onChange(!checked)}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  )
}

function JoinStore({
  bookstore,
  termsVersion,
  onJoined
}: {
  bookstore: MobileBookstore
  termsVersion: number
  onJoined: (status: BookstoreStatus) => void
}): React.JSX.Element {
  const [adult, setAdult] = useState(false)
  const [rules, setRules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Before you come in</Text>
      <Text style={styles.copy}>
        The Bookstore is a place to share books and find new ones. It has a few simple rules.
      </Text>
      {[
        'You must be 18 or over.',
        'Only publish books you have the right to publish.',
        'No explicit sexual content, and nothing illegal or hateful.',
        'Say honestly how AI was used, and add content warnings.',
        'Every book is checked before it appears, and can be removed if it breaks these rules.'
      ].map((rule) => (
        <Text key={rule} style={styles.rule}>
          • {rule}
        </Text>
      ))}
      <Text style={styles.copy}>
        Published books are public. The books in your library stay private unless you publish them.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Check checked={adult} label="I am 18 or over" onChange={setAdult} />
      <Check checked={rules} label="I agree to the Bookstore rules" onChange={setRules} />
      <PrimaryButton
        disabled={!adult || !rules || busy}
        label={busy ? 'Joining…' : 'Enter the Bookstore'}
        onPress={() => {
          setBusy(true)
          setError('')
          bookstore
            .join(termsVersion)
            .then(onJoined)
            .catch((caught: unknown) => {
              setError(reason(caught, 'Your answer could not be saved.'))
              setBusy(false)
            })
        }}
      />
    </View>
  )
}

function Shelves({
  bookstore,
  onOpenBook
}: {
  bookstore: MobileBookstore
  onOpenBook: (listingId: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<BookstoreGenre | null>(null)
  const [sort, setSort] = useState<Sort>('new')
  const [books, setBooks] = useState<StoreCard[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(
    async (nextPage: number): Promise<void> => {
      setError('')
      try {
        const result = await bookstore.browse({ query: search, genre, sort, page: nextPage })
        setBooks((current) =>
          nextPage === 0 ? result.items : [...(current ?? []), ...result.items]
        )
        setHasMore(result.hasMore)
        setPage(nextPage)
      } catch (caught) {
        setError(reason(caught, 'The Bookstore is out of reach.'))
      }
    },
    [bookstore, genre, search, sort]
  )

  useEffect(() => {
    void Promise.resolve().then(() => load(0))
  }, [load])

  return (
    <>
      <TextInput
        accessibilityLabel="Search the Bookstore"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search by title or author"
        placeholderTextColor={storyboundColors.muted}
        returnKeyType="search"
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => setSearch(query.trim())}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {[{ id: null, label: 'All' }, ...BOOKSTORE_GENRES].map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: genre === item.id }}
            key={item.label}
            style={[styles.chip, genre === item.id && styles.chipOn]}
            onPress={() => setGenre(item.id)}
          >
            <Text style={[styles.chipLabel, genre === item.id && styles.chipLabelOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.sortRow}>
        {(['new', 'popular'] as const).map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item}
            hitSlop={8}
            onPress={() => setSort(item)}
          >
            <Text style={[styles.sort, sort === item && styles.sortOn]}>
              {item === 'new' ? 'Newest' : 'Most added'}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <View style={styles.panel}>
          <Text style={styles.error}>{error}</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void load(0)} />
        </View>
      ) : !books ? (
        <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} />
      ) : books.length ? (
        <>
          <View style={styles.grid}>
            {books.map((book) => (
              <Pressable
                accessibilityRole="button"
                key={book.id}
                style={({ pressed }) => [styles.book, pressed && styles.pressed]}
                onPress={() => onOpenBook(book.id)}
              >
                <BookArtwork
                  book={{
                    title: book.title,
                    coverTone: coverToneFromStyle(book.coverStyle),
                    coverUri: book.coverThumb
                  }}
                />
                <Text numberOfLines={2} style={styles.bookTitle}>
                  {book.title}
                </Text>
                <Text numberOfLines={1} style={styles.hint}>
                  {book.authorName}
                </Text>
              </Pressable>
            ))}
          </View>
          {hasMore ? (
            <PrimaryButton
              label="Show more"
              variant="secondary"
              onPress={() => void load(page + 1)}
            />
          ) : null}
        </>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.heading}>
            {search || genre ? 'Nothing found' : 'No books here yet'}
          </Text>
          <Text style={styles.copy}>
            {search || genre
              ? 'Try another search or genre.'
              : 'Books are published from Storybound on a computer.'}
          </Text>
        </View>
      )}
    </>
  )
}

export function BookstoreScreen({
  bookstore,
  controller,
  onBack,
  onOpenBook
}: {
  bookstore: MobileBookstore
  controller: MobileSyncController
  onBack: () => void
  onOpenBook: (listingId: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<BookstoreStatus | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      setStatus(await bookstore.status())
    } catch (caught) {
      setError(reason(caught, 'The Bookstore is out of reach.'))
    }
  }, [bookstore])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  return (
    <View style={styles.screen}>
      <AppHeader subtitle="Books from other readers" title="Bookstore" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.panel}>
            <Text style={styles.error}>{error}</Text>
            <PrimaryButton label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : !status ? (
          <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} />
        ) : status.phase === 'unavailable' ? (
          <Text style={styles.copy}>The Bookstore is not available in this version.</Text>
        ) : status.phase === 'signed-out' ? (
          <AccountForm controller={controller} onDone={() => void load()} />
        ) : status.suspended ? (
          <Text style={styles.error}>This account can no longer use the Bookstore.</Text>
        ) : !status.joined ? (
          <JoinStore
            bookstore={bookstore}
            termsVersion={status.termsVersion}
            onJoined={setStatus}
          />
        ) : (
          <Shelves bookstore={bookstore} onOpenBook={onOpenBook} />
        )}
      </ScrollView>
    </View>
  )
}

export const storeStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 40
  },
  panel: {
    gap: 12
  },
  heading: {
    ...literaryHeading,
    color: storyboundColors.text,
    fontSize: 26
  },
  copy: {
    color: storyboundColors.text,
    fontSize: 15,
    lineHeight: 22
  },
  rule: {
    color: storyboundColors.text,
    fontSize: 15,
    lineHeight: 22
  },
  hint: {
    color: storyboundColors.muted,
    fontSize: 13
  },
  error: {
    color: storyboundColors.danger,
    fontSize: 14,
    lineHeight: 20
  },
  field: {
    gap: 6
  },
  fieldLabel: {
    ...compactCaps,
    color: storyboundColors.muted
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    borderWidth: 1,
    color: storyboundColors.text,
    backgroundColor: storyboundColors.paperRaised,
    fontSize: 16
  },
  check: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11
  },
  checkBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: storyboundColors.brass,
    borderRadius: 5,
    borderWidth: 1.5
  },
  checkBoxOn: {
    backgroundColor: storyboundColors.brass
  },
  checkMark: {
    color: storyboundColors.paperRaised,
    fontSize: 15,
    fontWeight: '700'
  },
  checkLabel: {
    flex: 1,
    color: storyboundColors.text,
    fontSize: 15
  },
  chips: {
    flexGrow: 0
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    marginRight: 8,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: 18,
    borderWidth: 1
  },
  chipOn: {
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.brass
  },
  chipLabel: {
    color: storyboundColors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  chipLabelOn: {
    color: storyboundColors.paperRaised
  },
  sortRow: {
    flexDirection: 'row',
    gap: 18
  },
  sort: {
    color: storyboundColors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  sortOn: {
    color: storyboundColors.brass
  },
  spinner: {
    marginTop: 40
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 22
  },
  book: {
    width: '47%',
    gap: 3
  },
  bookTitle: {
    marginTop: 8,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.6
  }
})

const styles = storeStyles
