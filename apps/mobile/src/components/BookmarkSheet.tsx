import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Bookmark } from '../domain/contracts'
import { storyboundColors, storyboundRadii } from '../theme'
import { BottomSheet, ColorChoices } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'

export interface BookmarkDraft {
  label: string
  note: string
  color: string
}

/** Saves the current place in a chapter, or edits or removes a saved one. */
export function BookmarkSheet({
  bookmark,
  place,
  onClose,
  onSave,
  onRemove
}: {
  /** The bookmark being edited; omitted when adding one at the current place. */
  bookmark?: Bookmark
  /** Where the bookmark is, e.g. "Chapter 3 · 40% through". */
  place: string
  onClose: () => void
  onSave: (draft: BookmarkDraft) => Promise<void>
  onRemove: (bookmark: Bookmark) => Promise<void>
}): React.JSX.Element {
  const [label, setLabel] = useState(bookmark?.label ?? '')
  const [note, setNote] = useState(bookmark?.note ?? '')
  const [color, setColor] = useState(bookmark?.color ?? 'gold')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The bookmark could not be saved.')
      setBusy(false)
    }
  }

  const remove = (): void => {
    if (!bookmark) return
    Alert.alert(
      'Remove this bookmark?',
      'It is removed from your other devices too when they next sync.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void run(() => onRemove(bookmark)) }
      ]
    )
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.title}>{bookmark ? 'Bookmark' : 'Add a bookmark'}</Text>
      <Text style={styles.place}>{place}</Text>
      <TextInput
        accessibilityLabel="Bookmark name"
        maxLength={240}
        placeholder="Name (optional)"
        placeholderTextColor={storyboundColors.muted}
        style={styles.input}
        value={label}
        onChangeText={setLabel}
      />
      <TextInput
        multiline
        accessibilityLabel="Bookmark note"
        maxLength={10_000}
        placeholder="Note (optional)"
        placeholderTextColor={storyboundColors.muted}
        style={[styles.input, styles.note]}
        value={note}
        onChangeText={setNote}
      />
      <ColorChoices label="bookmark" value={color} onChange={setColor} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton
          disabled={busy}
          label={bookmark ? 'Remove' : 'Cancel'}
          style={styles.action}
          variant="quiet"
          onPress={bookmark ? remove : onClose}
        />
        <PrimaryButton
          disabled={busy}
          label="Save"
          style={styles.action}
          onPress={() => void run(() => onSave({ label, note, color }))}
        />
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  title: {
    color: storyboundColors.brass,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  place: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '700'
  },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    color: storyboundColors.text,
    fontSize: 15
  },
  note: {
    minHeight: 72,
    maxHeight: 160,
    textAlignVertical: 'top'
  },
  error: {
    color: storyboundColors.danger,
    fontSize: 13
  },
  actions: {
    flexDirection: 'row',
    gap: 12
  },
  action: {
    flex: 1
  }
})
