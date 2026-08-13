import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import type { Chapter, MobileRepository } from '../domain/contracts'
import { formatCompactNumber } from '../domain/reading'
import { storyboundColors, storyboundRadii } from '../theme'

export function EditorScreen({
  bookId,
  chapterId,
  repository,
  onBack,
  onRead,
  registerBackHandler
}: {
  bookId: string
  chapterId: string
  repository: MobileRepository
  onBack: () => void
  onRead: (chapterId: string) => void
  registerBackHandler: (handler: (() => void) | null) => void
}): React.JSX.Element {
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved')
  const [error, setError] = useState('')
  const editVersionRef = useRef(0)

  useEffect(() => {
    let active = true
    void repository
      .getChapter(chapterId)
      .then((next) => {
        if (!active) return
        if (next.bookId !== bookId) throw new Error('That chapter does not belong to this book.')
        setChapter(next)
        setTitle(next.title)
        setContent(next.content)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'The chapter could not be opened.')
      })
    return () => {
      active = false
    }
  }, [bookId, chapterId, repository])

  const save = useCallback(async (): Promise<Chapter | null> => {
    if (!chapter) return null
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Every chapter needs a title before it can be saved.')
      setSaveState('failed')
      return null
    }
    const version = editVersionRef.current
    setSaveState('saving')
    setError('')
    try {
      const updated = await repository.updateChapter({ id: chapter.id, title: cleanTitle, content })
      setChapter(updated)
      if (editVersionRef.current === version) {
        setTitle(updated.title)
        setContent(updated.content)
        setDirty(false)
        setSaveState('saved')
      }
      return updated
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The chapter could not be saved.')
      setSaveState('failed')
      return null
    }
  }, [chapter, content, repository, title])

  useEffect(() => {
    if (!dirty || !chapter) return
    const timer = setTimeout(() => void save(), 1200)
    return () => clearTimeout(timer)
  }, [chapter, content, dirty, save, title])

  const markDirty = (): void => {
    editVersionRef.current += 1
    setDirty(true)
    setSaveState('saved')
  }

  const requestBack = useCallback((): void => {
    if (!dirty) {
      onBack()
      return
    }
    Alert.alert('Save this chapter?', 'Your latest changes are still in this mobile preview.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: onBack
      },
      {
        text: 'Save',
        onPress: () => {
          void save().then((saved) => {
            if (saved) onBack()
          })
        }
      }
    ])
  }, [dirty, onBack, save])

  useEffect(() => {
    registerBackHandler(requestBack)
    return () => registerBackHandler(null)
  }, [registerBackHandler, requestBack])

  if (error && !chapter) return <ErrorScreen message={error} onBack={onBack} />
  if (!chapter) return <LoadingScreen label="Opening the editor…" />

  const wordCount = content.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      style={styles.screen}
    >
      <AppHeader
        actionLabel={saveState === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        title="Chapter editor"
        onAction={() => void save()}
        onBack={requestBack}
      />
      <View style={styles.editor}>
        <TextInput
          accessibilityLabel="Chapter title"
          maxLength={240}
          placeholder="Chapter title"
          placeholderTextColor={storyboundColors.muted}
          style={styles.titleInput}
          value={title}
          onChangeText={(value) => {
            setTitle(value)
            markDirty()
          }}
        />
        <View style={styles.rule} />
        <TextInput
          accessibilityLabel="Chapter text"
          multiline
          placeholder="Begin your chapter…"
          placeholderTextColor={storyboundColors.muted}
          scrollEnabled
          style={styles.contentInput}
          textAlignVertical="top"
          value={content}
          onChangeText={(value) => {
            setContent(value)
            markDirty()
          }}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.footer}>
        <Text accessibilityLiveRegion="polite" style={styles.wordCount}>
          {formatCompactNumber(wordCount)} {wordCount === 1 ? 'word' : 'words'}
        </Text>
        <PrimaryButton
          label="Preview in reader"
          variant="quiet"
          onPress={() => {
            void (dirty ? save() : Promise.resolve(chapter)).then((saved) => {
              if (saved) onRead(saved.id)
            })
          }}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  editor: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 18
  },
  titleInput: {
    minHeight: 62,
    padding: 0,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 27,
    fontWeight: '700'
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 14,
    backgroundColor: storyboundColors.line
  },
  contentInput: {
    flex: 1,
    padding: 0,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 30
  },
  error: {
    marginHorizontal: 18,
    marginBottom: 8,
    padding: 11,
    overflow: 'hidden',
    borderRadius: storyboundRadii.small,
    color: storyboundColors.danger,
    backgroundColor: '#f0d7d1',
    fontSize: 12,
    textAlign: 'center'
  },
  footer: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderTopColor: storyboundColors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: storyboundColors.paperRaised
  },
  wordCount: {
    color: storyboundColors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums']
  }
})
