import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Annotation } from '../domain/contracts'
import { highlightColor, storyboundColors, storyboundRadii } from '../theme'
import { PrimaryButton } from './PrimaryButton'

/** Every highlight and note in a book, in reading order. Tapping one jumps to it. */
export function AnnotationList({
  annotations,
  onClose,
  onOpen,
  onEdit
}: {
  annotations: Annotation[]
  onClose: () => void
  onOpen: (annotation: Annotation) => void
  onEdit: (annotation: Annotation) => void
}): React.JSX.Element {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.dismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Highlights & notes</Text>
            <PrimaryButton label="Done" variant="quiet" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {annotations.length === 0 ? (
              <Text style={styles.empty}>
                Nothing yet. Long-press a paragraph while reading to highlight it or add a note.
              </Text>
            ) : (
              annotations.map((annotation, index) => (
                <View key={annotation.id}>
                  {index === 0 || annotations[index - 1].chapterId !== annotation.chapterId ? (
                    <Text style={styles.chapter}>{annotation.chapterTitle}</Text>
                  ) : null}
                  <View style={styles.item}>
                    <Pressable
                      accessibilityHint="Opens this place in the chapter"
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.itemBody, pressed && styles.pressed]}
                      onPress={() => onOpen(annotation)}
                    >
                      <View
                        style={[
                          styles.bar,
                          { backgroundColor: highlightColor(annotation.color).swatch }
                        ]}
                      />
                      <View style={styles.copy}>
                        {annotation.quote.trim() ? (
                          <Text numberOfLines={4} style={styles.quote}>
                            {annotation.quote.trim()}
                          </Text>
                        ) : null}
                        {annotation.body.trim() ? (
                          <Text style={styles.body}>{annotation.body.trim()}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Edit"
                      accessibilityRole="button"
                      hitSlop={8}
                      style={styles.edit}
                      onPress={() => onEdit(annotation)}
                    >
                      <Text style={styles.editLabel}>Edit</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
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
    maxHeight: '86%',
    paddingTop: 12,
    paddingBottom: 28,
    borderTopLeftRadius: storyboundRadii.large,
    borderTopRightRadius: storyboundRadii.large,
    backgroundColor: storyboundColors.paperRaised
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8
  },
  title: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '700'
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 12
  },
  empty: {
    marginTop: 18,
    color: storyboundColors.muted,
    fontSize: 15,
    lineHeight: 22
  },
  chapter: {
    marginTop: 18,
    marginBottom: 6,
    color: storyboundColors.brass,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: storyboundColors.line
  },
  itemBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12
  },
  pressed: {
    opacity: 0.6
  },
  bar: {
    width: 4,
    borderRadius: 2
  },
  copy: {
    flex: 1,
    gap: 6
  },
  quote: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 16,
    fontStyle: 'italic',
    lineHeight: 23
  },
  body: {
    color: storyboundColors.text,
    fontSize: 14,
    lineHeight: 20
  },
  edit: {
    paddingVertical: 14,
    paddingLeft: 14
  },
  editLabel: {
    color: storyboundColors.brass,
    fontSize: 13,
    fontWeight: '700'
  }
})
