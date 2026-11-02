import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { ANNOTATION_COLORS, type Annotation } from '../domain/contracts'
import { splitSentences, type StoryBlock } from '../domain/reading'
import { highlightColor, storyboundColors, storyboundRadii } from '../theme'
import { PrimaryButton } from './PrimaryButton'

export type AnnotationSheetTarget =
  { mode: 'create'; block: StoryBlock } | { mode: 'edit'; annotation: Annotation }

export interface AnnotationDraft {
  start: number
  end: number
  body: string
  color: string
}

/**
 * Makes or edits a highlight. A new highlight covers a whole paragraph until sentences are
 * tapped: the first tap picks one sentence, later taps grow or shrink the selection from its ends.
 */
export function AnnotationSheet({
  target,
  content,
  onClose,
  onCreate,
  onUpdate,
  onRemove
}: {
  target: AnnotationSheetTarget
  /** The chapter's stored text, which the sentence offsets point into. */
  content: string
  onClose: () => void
  onCreate: (draft: AnnotationDraft) => Promise<void>
  onUpdate: (annotation: Annotation, changes: { body: string; color: string }) => Promise<void>
  onRemove: (annotation: Annotation) => Promise<void>
}): React.JSX.Element {
  const editing = target.mode === 'edit' ? target.annotation : null
  const sentences = target.mode === 'create' ? splitSentences(target.block) : []
  const [range, setRange] = useState({ from: 0, to: Math.max(0, sentences.length - 1) })
  const [narrowed, setNarrowed] = useState(false)
  const [color, setColor] = useState(editing?.color ?? 'gold')
  const [body, setBody] = useState(editing?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wash = highlightColor(color).wash

  const tapSentence = (index: number): void => {
    if (!narrowed) {
      setNarrowed(true)
      setRange({ from: index, to: index })
      return
    }
    setRange(({ from, to }) => {
      if (index < from) return { from: index, to }
      if (index > to) return { from, to: index }
      if (from === to) return { from, to }
      if (index === from) return { from: from + 1, to }
      if (index === to) return { from, to: to - 1 }
      return { from: index, to: index }
    })
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The highlight could not be saved.')
      setBusy(false)
    }
  }

  const save = (): void => {
    if (editing) {
      void run(() => onUpdate(editing, { body, color }))
      return
    }
    const first = sentences[range.from]
    const last = sentences[range.to]
    if (!first || !last) return
    void run(() => onCreate({ start: first.start, end: last.end, body, color }))
  }

  const remove = (): void => {
    if (!editing) return
    Alert.alert(
      editing.body.trim() ? 'Remove this note?' : 'Remove this highlight?',
      'It is removed from your other devices too when they next sync.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void run(() => onRemove(editing)) }
      ]
    )
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable accessibilityLabel="Close" style={styles.dismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {editing ? (editing.body.trim() ? 'Note' : 'Highlight') : 'Highlight'}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.passageScroll}>
            {editing ? (
              <Text style={[styles.passage, { backgroundColor: wash }]}>
                {editing.quote.trim() || 'A note on this chapter'}
              </Text>
            ) : (
              <Text style={styles.passage}>
                {sentences.map((sentence, index) => (
                  <Text
                    accessibilityRole="button"
                    key={sentence.start}
                    style={
                      index >= range.from && index <= range.to
                        ? { backgroundColor: wash }
                        : styles.unselected
                    }
                    onPress={() => tapSentence(index)}
                  >
                    {content.slice(sentence.start, sentence.end).replace(/\r/g, '')}
                    {index < sentences.length - 1 ? ' ' : ''}
                  </Text>
                ))}
              </Text>
            )}
          </ScrollView>
          {!editing && sentences.length > 1 ? (
            <View style={styles.hintRow}>
              <Text style={styles.hint}>Tap sentences to choose what to highlight.</Text>
              {narrowed ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setNarrowed(false)
                    setRange({ from: 0, to: sentences.length - 1 })
                  }}
                >
                  <Text style={styles.link}>Whole paragraph</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View accessibilityRole="radiogroup" style={styles.colors}>
            {ANNOTATION_COLORS.map((value) => (
              <Pressable
                accessibilityLabel={`${value} highlight`}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === value }}
                hitSlop={4}
                key={value}
                style={[
                  styles.swatch,
                  { backgroundColor: highlightColor(value).swatch },
                  color === value && styles.swatchSelected
                ]}
                onPress={() => setColor(value)}
              />
            ))}
          </View>

          <TextInput
            multiline
            accessibilityLabel="Note"
            placeholder="Add a note (optional)"
            placeholderTextColor={storyboundColors.muted}
            style={styles.note}
            value={body}
            onChangeText={setBody}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {editing ? (
              <PrimaryButton
                disabled={busy}
                label="Remove"
                style={styles.action}
                variant="quiet"
                onPress={remove}
              />
            ) : (
              <PrimaryButton
                disabled={busy}
                label="Cancel"
                style={styles.action}
                variant="quiet"
                onPress={onClose}
              />
            )}
            <PrimaryButton disabled={busy} label="Save" style={styles.action} onPress={save} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 19, 15, 0.42)'
  },
  dismiss: {
    flex: 1
  },
  sheet: {
    gap: 14,
    maxHeight: '86%',
    padding: 20,
    paddingBottom: 34,
    borderTopLeftRadius: storyboundRadii.large,
    borderTopRightRadius: storyboundRadii.large,
    backgroundColor: storyboundColors.paperRaised
  },
  title: {
    color: storyboundColors.brass,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  passageScroll: {
    maxHeight: 260
  },
  passage: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 17,
    lineHeight: 27
  },
  unselected: {
    color: storyboundColors.muted
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  hint: {
    flex: 1,
    color: storyboundColors.muted,
    fontSize: 12
  },
  link: {
    color: storyboundColors.brass,
    fontSize: 13,
    fontWeight: '700'
  },
  colors: {
    flexDirection: 'row',
    gap: 14
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent'
  },
  swatchSelected: {
    borderColor: storyboundColors.text
  },
  note: {
    minHeight: 84,
    maxHeight: 180,
    padding: 12,
    borderWidth: 1,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    color: storyboundColors.text,
    fontSize: 15,
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
