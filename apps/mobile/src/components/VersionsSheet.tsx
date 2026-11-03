import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ChapterRevision } from '../domain/contracts'
import { formatCompactNumber } from '../domain/reading'
import { storyboundColors } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'
import { sheetStyles } from './sheetStyles'

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit'
      })
}

/** Earlier versions of a chapter kept on this phone; one can be read and brought back. */
export function VersionsSheet({
  load,
  onRestore,
  onClose
}: {
  load: () => Promise<ChapterRevision[]>
  onRestore: (revision: ChapterRevision) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [versions, setVersions] = useState<ChapterRevision[] | null>(null)
  const [open, setOpen] = useState<ChapterRevision | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void load()
      .then(setVersions)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Versions could not be loaded.')
      )
  }, [load])

  const restore = async (revision: ChapterRevision): Promise<void> => {
    setBusy(true)
    try {
      await onRestore(revision)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That version could not be restored.')
      setBusy(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={sheetStyles.title}>{open ? open.title : 'Earlier versions'}</Text>
      {open ? (
        <>
          <Text style={sheetStyles.message}>
            {open.reason} · {when(open.createdAt)} · {formatCompactNumber(open.wordCount)} words
          </Text>
          <ScrollView style={styles.preview}>
            <Text style={styles.previewText}>{open.content || 'This version was empty.'}</Text>
          </ScrollView>
          {error ? <Text style={sheetStyles.error}>{error}</Text> : null}
          <View style={sheetStyles.actions}>
            <PrimaryButton
              label="Back"
              style={sheetStyles.action}
              variant="quiet"
              onPress={() => setOpen(null)}
            />
            <PrimaryButton
              disabled={busy}
              label="Restore this"
              style={sheetStyles.action}
              onPress={() => void restore(open)}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={sheetStyles.message}>
            Kept on this phone while you write, and before splits, merges, and changes from your
            other devices. Restoring keeps the current text as a version too.
          </Text>
          {error ? <Text style={sheetStyles.error}>{error}</Text> : null}
          <ScrollView style={styles.list}>
            {versions?.length === 0 ? (
              <Text style={sheetStyles.message}>No earlier versions yet.</Text>
            ) : null}
            {versions?.map((version) => (
              <Pressable
                accessibilityRole="button"
                key={version.id}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => setOpen(version)}
              >
                <Text style={styles.rowTitle}>
                  {when(version.createdAt)} · {formatCompactNumber(version.wordCount)} words
                </Text>
                <Text style={styles.rowReason}>{version.reason}</Text>
                <Text numberOfLines={2} style={styles.rowPreview}>
                  {version.content.trim() || 'Empty'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <PrimaryButton label="Done" variant="quiet" onPress={onClose} />
        </>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 380
  },
  row: {
    gap: 3,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: storyboundColors.line
  },
  pressed: {
    opacity: 0.6
  },
  rowTitle: {
    color: storyboundColors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  rowReason: {
    color: storyboundColors.brass,
    fontSize: 12,
    fontWeight: '700'
  },
  rowPreview: {
    color: storyboundColors.muted,
    fontFamily: 'serif',
    fontSize: 14,
    lineHeight: 20
  },
  preview: {
    maxHeight: 360,
    padding: 12,
    borderRadius: 12,
    backgroundColor: storyboundColors.paper
  },
  previewText: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 15,
    lineHeight: 24
  }
})
