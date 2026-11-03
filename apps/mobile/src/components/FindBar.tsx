import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { findMatches, type TextMatch } from '../domain/editing'
import { storyboundColors, storyboundRadii } from '../theme'

/** Find and replace for the chapter being edited, docked under the header. */
export function FindBar({
  content,
  onShowMatch,
  onReplace,
  onReplaceAll,
  onClose
}: {
  content: string
  onShowMatch: (match: TextMatch) => void
  onReplace: (match: TextMatch, replacement: string) => void
  onReplaceAll: (query: string, replacement: string, matchCase: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [index, setIndex] = useState(0)
  const matches = findMatches(content, query, matchCase)
  const current = matches.length ? Math.min(index, matches.length - 1) : -1

  const go = (step: number): void => {
    if (!matches.length) return
    const next = (current + step + matches.length) % matches.length
    setIndex(next)
    onShowMatch(matches[next])
  }

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <TextInput
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Find"
          placeholder="Find"
          placeholderTextColor={storyboundColors.muted}
          returnKeyType="search"
          style={styles.input}
          value={query}
          onChangeText={(value) => {
            setQuery(value)
            setIndex(0)
          }}
          onSubmitEditing={() => go(current < 0 ? 0 : 1)}
        />
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {query ? (matches.length ? `${current + 1}/${matches.length}` : 'None') : ''}
        </Text>
        <BarButton label="‹" name="Previous match" onPress={() => go(-1)} />
        <BarButton label="›" name="Next match" onPress={() => go(current < 0 ? 0 : 1)} />
        <BarButton label="✕" name="Close find" onPress={onClose} />
      </View>
      <View style={styles.row}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Replace with"
          placeholder="Replace with"
          placeholderTextColor={storyboundColors.muted}
          style={styles.input}
          value={replacement}
          onChangeText={setReplacement}
        />
        <BarButton
          disabled={current < 0}
          label="Replace"
          name="Replace this match"
          onPress={() => current >= 0 && onReplace(matches[current], replacement)}
        />
        <BarButton
          disabled={!matches.length}
          label="All"
          name={`Replace all ${matches.length} matches`}
          onPress={() => onReplaceAll(query, replacement, matchCase)}
        />
        <BarButton
          active={matchCase}
          label="Aa"
          name={matchCase ? 'Matching case' : 'Ignoring case'}
          onPress={() => setMatchCase((value) => !value)}
        />
      </View>
    </View>
  )
}

function BarButton({
  label,
  name,
  active = false,
  disabled = false,
  onPress
}: {
  label: string
  name: string
  active?: boolean
  disabled?: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonLabel, active && styles.buttonLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: storyboundColors.line,
    backgroundColor: storyboundColors.parchment
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  input: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: storyboundRadii.small,
    color: storyboundColors.text,
    backgroundColor: storyboundColors.paperRaised,
    fontSize: 15
  },
  count: {
    minWidth: 40,
    color: storyboundColors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'center'
  },
  button: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: storyboundRadii.small,
    backgroundColor: storyboundColors.paperRaised
  },
  buttonActive: {
    backgroundColor: storyboundColors.brass
  },
  buttonLabel: {
    color: storyboundColors.text,
    fontSize: 14,
    fontWeight: '700'
  },
  buttonLabelActive: {
    color: storyboundColors.ink
  },
  pressed: {
    opacity: 0.6
  },
  disabled: {
    opacity: 0.35
  }
})
