import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Annotation, Bookmark } from '../domain/contracts'
import { highlightColor, storyboundColors } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'

/** A book's bookmarks, then its highlights and notes, in reading order. Tapping one jumps to it. */
export function MarksList({
  bookmarks,
  annotations,
  onClose,
  onOpenBookmark,
  onEditBookmark,
  onOpenAnnotation,
  onEditAnnotation
}: {
  bookmarks: Bookmark[]
  annotations: Annotation[]
  onClose: () => void
  onOpenBookmark: (bookmark: Bookmark) => void
  onEditBookmark: (bookmark: Bookmark) => void
  onOpenAnnotation: (annotation: Annotation) => void
  onEditAnnotation: (annotation: Annotation) => void
}): React.JSX.Element {
  return (
    <BottomSheet style={styles.sheet} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>Bookmarks & notes</Text>
        <PrimaryButton label="Done" variant="quiet" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {bookmarks.length === 0 && annotations.length === 0 ? (
          <Text style={styles.empty}>
            Nothing yet. Tap Bookmark at the bottom of the reader to save your place, or long-press
            a paragraph to highlight it or add a note.
          </Text>
        ) : null}

        {bookmarks.length ? <Text style={styles.section}>Bookmarks</Text> : null}
        {bookmarks.map((bookmark) => (
          <MarkRow
            color={bookmark.color}
            key={bookmark.id}
            onEdit={() => onEditBookmark(bookmark)}
            onOpen={() => onOpenBookmark(bookmark)}
          >
            <Text style={styles.markTitle}>
              {bookmark.label.trim() || `${Math.round(bookmark.location * 100)}% through`}
            </Text>
            <Text style={styles.meta}>{bookmark.chapterTitle}</Text>
            {bookmark.note.trim() ? <Text style={styles.body}>{bookmark.note.trim()}</Text> : null}
          </MarkRow>
        ))}

        {annotations.length ? <Text style={styles.section}>Highlights & notes</Text> : null}
        {annotations.map((annotation, index) => (
          <View key={annotation.id}>
            {index === 0 || annotations[index - 1].chapterId !== annotation.chapterId ? (
              <Text style={styles.chapter}>{annotation.chapterTitle}</Text>
            ) : null}
            <MarkRow
              color={annotation.color}
              onEdit={() => onEditAnnotation(annotation)}
              onOpen={() => onOpenAnnotation(annotation)}
            >
              {annotation.quote.trim() ? (
                <Text numberOfLines={4} style={styles.quote}>
                  {annotation.quote.trim()}
                </Text>
              ) : null}
              {annotation.body.trim() ? (
                <Text style={styles.body}>{annotation.body.trim()}</Text>
              ) : null}
            </MarkRow>
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  )
}

function MarkRow({
  color,
  children,
  onOpen,
  onEdit
}: {
  color: string
  children: React.ReactNode
  onOpen: () => void
  onEdit: () => void
}): React.JSX.Element {
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityHint="Opens this place in the chapter"
        accessibilityRole="button"
        style={({ pressed }) => [styles.itemBody, pressed && styles.pressed]}
        onPress={onOpen}
      >
        <View style={[styles.bar, { backgroundColor: highlightColor(color).swatch }]} />
        <View style={styles.copy}>{children}</View>
      </Pressable>
      <Pressable
        accessibilityLabel="Edit"
        accessibilityRole="button"
        hitSlop={8}
        style={styles.edit}
        onPress={onEdit}
      >
        <Text style={styles.editLabel}>Edit</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    gap: 0,
    paddingHorizontal: 0,
    paddingTop: 12,
    paddingBottom: 28
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
  section: {
    marginTop: 22,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: '700'
  },
  chapter: {
    marginTop: 14,
    marginBottom: 2,
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
    gap: 4
  },
  markTitle: {
    color: storyboundColors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  meta: {
    color: storyboundColors.muted,
    fontSize: 12
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
