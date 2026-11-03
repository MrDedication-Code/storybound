import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { BookDetailsInput, BookStatus } from '../domain/contracts'
import { storyboundColors, storyboundRadii } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'
import { sheetStyles } from './sheetStyles'

const EMPTY: BookDetailsInput = {
  title: '',
  subtitle: '',
  authorName: '',
  blurb: '',
  status: 'ongoing',
  seriesName: '',
  seriesPosition: null
}

/** The details form for a new book or an existing one. */
export function BookDetailsSheet({
  initial,
  heading,
  confirmLabel,
  libraries = [],
  initialLibraryId = null,
  onSave,
  onClose
}: {
  initial?: BookDetailsInput
  heading: string
  confirmLabel: string
  /** For a new book: the libraries it can go in. With one or none, no choice is shown. */
  libraries?: Array<{ id: string; name: string }>
  initialLibraryId?: string | null
  onSave: (details: BookDetailsInput, libraryId: string | null) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [details, setDetails] = useState<BookDetailsInput>(initial ?? EMPTY)
  const [libraryId, setLibraryId] = useState(initialLibraryId ?? libraries[0]?.id ?? null)
  const [seriesNumber, setSeriesNumber] = useState(
    initial?.seriesPosition === null || initial?.seriesPosition === undefined
      ? ''
      : String(initial.seriesPosition)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (changes: Partial<BookDetailsInput>): void =>
    setDetails((current) => ({ ...current, ...changes }))

  const save = async (): Promise<void> => {
    const number = seriesNumber.trim() ? Number(seriesNumber.replace(',', '.')) : null
    if (number !== null && !(Number.isFinite(number) && number > 0)) {
      setError('The series number must be a number above zero.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave({ ...details, seriesPosition: number }, libraryId)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The book could not be saved.')
      setBusy(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={sheetStyles.title}>{heading}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.form}>
        <Field label="Title">
          <TextInput
            autoFocus={!initial}
            accessibilityLabel="Title"
            maxLength={240}
            placeholder="The name of your story"
            placeholderTextColor={storyboundColors.muted}
            style={sheetStyles.input}
            value={details.title}
            onChangeText={(title) => change({ title })}
          />
        </Field>
        {libraries.length > 1 ? (
          <Field label="Library">
            <View accessibilityRole="radiogroup" style={styles.chips}>
              {libraries.map((library) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: library.id === libraryId }}
                  key={library.id}
                  style={[styles.chip, library.id === libraryId && styles.segmentOn]}
                  onPress={() => setLibraryId(library.id)}
                >
                  <Text
                    style={[styles.segmentLabel, library.id === libraryId && styles.segmentOnLabel]}
                  >
                    {library.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Field>
        ) : null}
        <Field label="Subtitle">
          <TextInput
            accessibilityLabel="Subtitle"
            maxLength={240}
            style={sheetStyles.input}
            value={details.subtitle}
            onChangeText={(subtitle) => change({ subtitle })}
          />
        </Field>
        <Field label="Author">
          <TextInput
            accessibilityLabel="Author"
            maxLength={240}
            style={sheetStyles.input}
            value={details.authorName}
            onChangeText={(authorName) => change({ authorName })}
          />
        </Field>
        <Field label="Description">
          <TextInput
            multiline
            accessibilityLabel="Description"
            style={[sheetStyles.input, styles.blurb]}
            textAlignVertical="top"
            value={details.blurb}
            onChangeText={(blurb) => change({ blurb })}
          />
        </Field>
        <Field label="Status">
          <View accessibilityRole="radiogroup" style={styles.segments}>
            {(['ongoing', 'completed'] as BookStatus[]).map((status) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: details.status === status }}
                key={status}
                style={[styles.segment, details.status === status && styles.segmentOn]}
                onPress={() => change({ status })}
              >
                <Text
                  style={[styles.segmentLabel, details.status === status && styles.segmentOnLabel]}
                >
                  {status === 'ongoing' ? 'Still writing' : 'Finished'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Field>
        <View style={styles.seriesRow}>
          <View style={styles.seriesName}>
            <Field label="Series">
              <TextInput
                accessibilityLabel="Series"
                maxLength={240}
                style={sheetStyles.input}
                value={details.seriesName}
                onChangeText={(seriesName) => change({ seriesName })}
              />
            </Field>
          </View>
          <View style={styles.seriesNumber}>
            <Field label="Number">
              <TextInput
                accessibilityLabel="Number in series"
                inputMode="decimal"
                style={sheetStyles.input}
                value={seriesNumber}
                onChangeText={setSeriesNumber}
              />
            </Field>
          </View>
        </View>
      </ScrollView>
      {error ? <Text style={sheetStyles.error}>{error}</Text> : null}
      <View style={sheetStyles.actions}>
        <PrimaryButton
          label="Cancel"
          style={sheetStyles.action}
          variant="quiet"
          onPress={onClose}
        />
        <PrimaryButton
          disabled={busy || !details.title.trim()}
          label={confirmLabel}
          style={sheetStyles.action}
          onPress={() => void save()}
        />
      </View>
    </BottomSheet>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  form: {
    maxHeight: 440
  },
  field: {
    gap: 6,
    marginBottom: 14
  },
  label: {
    color: storyboundColors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  blurb: {
    minHeight: 96,
    paddingTop: 12
  },
  segments: {
    flexDirection: 'row',
    gap: 8
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small
  },
  segmentOn: {
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.brass
  },
  segmentLabel: {
    color: storyboundColors.text,
    fontSize: 14,
    fontWeight: '700'
  },
  segmentOnLabel: {
    color: storyboundColors.ink
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: storyboundColors.line,
    borderRadius: 20
  },
  seriesRow: {
    flexDirection: 'row',
    gap: 10
  },
  seriesName: {
    flex: 3
  },
  seriesNumber: {
    flex: 1
  }
})
