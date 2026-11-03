import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { storyboundColors } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'
import { sheetStyles } from './sheetStyles'

/** Asks for one line of text, such as a chapter title, then runs the action. */
export function TextFieldSheet({
  title,
  message,
  label,
  initialValue,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string
  /** Optional explanation or preview above the field. */
  message?: string
  label: string
  initialValue: string
  confirmLabel: string
  onConfirm: (value: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (!value.trim()) {
      setError(`Add ${label.toLowerCase()} first.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(value.trim())
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <TextInput
        autoFocus
        accessibilityLabel={label}
        maxLength={240}
        placeholder={label}
        placeholderTextColor={storyboundColors.muted}
        returnKeyType="done"
        selectTextOnFocus
        style={styles.input}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={() => void submit()}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton label="Cancel" style={styles.action} variant="quiet" onPress={onClose} />
        <PrimaryButton
          disabled={busy}
          label={confirmLabel}
          style={styles.action}
          onPress={() => void submit()}
        />
      </View>
    </BottomSheet>
  )
}

const styles = sheetStyles
