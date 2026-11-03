import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { storyboundColors } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'
import { sheetStyles } from './sheetStyles'

export interface TrashEntry {
  id: string
  title: string
  detail: string
}

/** Books or chapters in Trash, each with Restore. Nothing is deleted for good on the phone. */
export function TrashSheet({
  title,
  load,
  onRestore,
  onClose
}: {
  title: string
  load: () => Promise<TrashEntry[]>
  onRestore: (id: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void load()
      .then(setEntries)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Trash could not be opened.')
      )
  }, [load])

  const restore = async (id: string): Promise<void> => {
    setError('')
    try {
      await onRestore(id)
      setEntries((current) => current?.filter((entry) => entry.id !== id) ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be restored.')
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={sheetStyles.title}>{title}</Text>
      <Text style={sheetStyles.message}>
        Restore brings it back where it was. To delete something for good, use Trash in Storybound
        on your computer.
      </Text>
      {error ? <Text style={sheetStyles.error}>{error}</Text> : null}
      <ScrollView style={styles.list}>
        {entries?.length === 0 ? <Text style={sheetStyles.message}>Trash is empty.</Text> : null}
        {entries?.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={styles.rowTitle}>
                {entry.title}
              </Text>
              <Text style={styles.detail}>{entry.detail}</Text>
            </View>
            <PrimaryButton
              label="Restore"
              variant="secondary"
              onPress={() => void restore(entry.id)}
            />
          </View>
        ))}
      </ScrollView>
      <PrimaryButton label="Done" variant="quiet" onPress={onClose} />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 380
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: storyboundColors.line
  },
  copy: {
    flex: 1
  },
  rowTitle: {
    color: storyboundColors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  detail: {
    color: storyboundColors.muted,
    fontSize: 12
  }
})
