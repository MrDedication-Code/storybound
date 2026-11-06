import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
  Dimensions,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions
} from 'react-native'
import { MobileBookstore } from './src/bookstore/mobileBookstore'
import { ListeningBar } from './src/components/ListeningBar'
import { ErrorScreen, LoadingScreen } from './src/components/ScreenState'
import { sharedRepository } from './src/data/sqlite/sharedRepository'
import {
  DEFAULT_PREFERENCES,
  type MobilePreferences,
  type MobileRepository,
  type MobileRoute
} from './src/domain/contracts'
import { BookDetailScreen } from './src/screens/BookDetailScreen'
import { BookstoreBookScreen } from './src/screens/BookstoreBookScreen'
import { BookstoreScreen } from './src/screens/BookstoreScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { ListeningSettingsScreen } from './src/screens/ListeningSettingsScreen'
import { ReaderScreen } from './src/screens/ReaderScreen'
import { SyncSettingsScreen } from './src/screens/SyncSettingsScreen'
import { statusBarHeight } from './src/statusBar'
import { createMobileSyncRuntime } from './src/sync/runtime'
import type { MobileSyncController, MobileSyncRuntime } from './src/sync/types'
import { storyboundColors } from './src/theme'

const CHECK_DELAY_MILLISECONDS = 15_000

/**
 * Android draws apps edge to edge, under the status bar and the gesture or button bar, and
 * SafeAreaView only pads on iOS. The bars' heights are what the screen has beyond the window.
 */
function useAndroidBarInsets(): { paddingTop: number; paddingBottom: number } | null {
  const window = useWindowDimensions()
  if (Platform.OS !== 'android') return null
  const top = statusBarHeight()
  const bottom = Dimensions.get('screen').height - window.height - top
  return { paddingTop: top, paddingBottom: Math.min(64, Math.max(0, bottom)) }
}

export default function App(): React.JSX.Element {
  const colorScheme = useColorScheme()
  const barInsets = useAndroidBarInsets()
  const [repositoryState, setRepositoryState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; repository: MobileRepository; syncController: MobileSyncController }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  const [openAttempt, setOpenAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let syncRuntime: MobileSyncRuntime | null = null

    // Shared with Android Auto and kept open for the life of the app.
    void sharedRepository()
      .then((next) => {
        if (!active) return
        syncRuntime = createMobileSyncRuntime(next.syncStore)
        setRepositoryState({
          kind: 'ready',
          repository: next.repository,
          syncController: syncRuntime.controller
        })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setRepositoryState({
          kind: 'error',
          message:
            caught instanceof Error ? caught.message : 'The local library could not be opened.'
        })
      })

    return () => {
      active = false
      syncRuntime?.dispose()
    }
  }, [openAttempt])

  const retryOpen = (): void => {
    setRepositoryState({ kind: 'loading' })
    setOpenAttempt((attempt) => attempt + 1)
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        barInsets,
        { backgroundColor: colorScheme === 'dark' ? storyboundColors.ink : storyboundColors.paper }
      ]}
    >
      {repositoryState.kind === 'loading' ? (
        <LoadingScreen label="Opening your private library…" />
      ) : repositoryState.kind === 'error' ? (
        <ErrorScreen actionLabel="Try again" message={repositoryState.message} onBack={retryOpen} />
      ) : (
        <StoryboundApp
          repository={repositoryState.repository}
          syncController={repositoryState.syncController}
        />
      )}
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  )
}

function StoryboundApp({
  repository,
  syncController
}: {
  repository: MobileRepository
  syncController: MobileSyncController
}): React.JSX.Element {
  const [routes, setRoutes] = useState<MobileRoute[]>([{ name: 'library' }])
  const backOverrideRef = useRef<(() => void) | null>(null)
  const route = routes[routes.length - 1]
  const [preferences, setPreferences] = useState<MobilePreferences | null>(null)

  useEffect(() => {
    let active = true
    void repository
      .getPreferences()
      .then((loaded) => {
        if (active) setPreferences(loaded)
      })
      .catch(() => {
        if (active) setPreferences(DEFAULT_PREFERENCES)
      })
    return () => {
      active = false
    }
  }, [repository])

  const bookstore = useMemo(
    () => new MobileBookstore(repository, syncController),
    [repository, syncController]
  )

  // Keeps Bookstore books up to date. Being offline or signed out is no reason to interrupt.
  useEffect(() => {
    const timer = setTimeout(() => {
      void bookstore
        .checkBooks()
        .then(({ removed }) => {
          for (const book of removed) {
            Alert.alert(
              `“${book.title}” was removed`,
              `It left the Bookstore and moved to Trash. ${book.reason}`.trim()
            )
          }
        })
        .catch(() => undefined)
    }, CHECK_DELAY_MILLISECONDS)
    return () => clearTimeout(timer)
  }, [bookstore])

  const changePreferences = useCallback(
    (changes: Partial<MobilePreferences>): void => {
      setPreferences((current) => (current ? { ...current, ...changes } : current))
      // The choice applies immediately; if saving fails it simply isn't remembered next time.
      void repository.savePreferences(changes).catch(() => undefined)
    },
    [repository]
  )

  const push = useCallback((next: MobileRoute): void => {
    setRoutes((current) => [...current, next])
  }, [])

  const replace = useCallback((next: MobileRoute): void => {
    setRoutes((current) => [...current.slice(0, -1), next])
  }, [])

  const back = useCallback((): void => {
    setRoutes((current) => (current.length > 1 ? current.slice(0, -1) : current))
  }, [])

  const home = useCallback((): void => {
    setRoutes([{ name: 'library' }])
  }, [])

  const registerBackHandler = useCallback((handler: (() => void) | null): void => {
    backOverrideRef.current = handler
  }, [])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (routes.length <= 1) return false
      if (backOverrideRef.current) backOverrideRef.current()
      else back()
      return true
    })
    return () => subscription.remove()
  }, [back, routes.length])

  if (!preferences) return <LoadingScreen label="Opening your library…" />

  // Reader mode passes no edit handler, so no screen can show an edit control or reach the editor.
  const editChapter =
    preferences.mode === 'editor'
      ? (bookId: string) => (chapterId: string) => push({ name: 'editor', bookId, chapterId })
      : () => undefined

  let screen: React.JSX.Element
  switch (route.name) {
    case 'library':
      screen = (
        <LibraryScreen
          mode={preferences.mode}
          repository={repository}
          onChangeMode={(mode) => changePreferences({ mode })}
          onOpenBook={(bookId) => push({ name: 'book', bookId })}
          onOpenBookstore={() => push({ name: 'bookstore' })}
          onOpenListening={() => push({ name: 'listening-settings' })}
          onOpenSync={() => push({ name: 'sync-settings' })}
        />
      )
      break
    case 'book':
      screen = (
        <BookDetailScreen
          bookId={route.bookId}
          repository={repository}
          onBack={back}
          onEditChapter={editChapter(route.bookId)}
          onReadChapter={(chapterId) => push({ name: 'reader', bookId: route.bookId, chapterId })}
        />
      )
      break
    case 'reader':
      screen = (
        <ReaderScreen
          bookId={route.bookId}
          initialChapterId={route.chapterId}
          preferences={preferences}
          repository={repository}
          onBack={back}
          onChangePreferences={changePreferences}
          onEditChapter={editChapter(route.bookId)}
          onOpenListeningSettings={() => push({ name: 'listening-settings' })}
        />
      )
      break
    case 'editor':
      screen = (
        <EditorScreen
          bookId={route.bookId}
          chapterId={route.chapterId}
          key={route.chapterId}
          preferences={preferences}
          repository={repository}
          onBack={back}
          onChangePreferences={changePreferences}
          onOpenChapter={(chapterId) =>
            replace({ name: 'editor', bookId: route.bookId, chapterId })
          }
          onRead={(chapterId) => push({ name: 'reader', bookId: route.bookId, chapterId })}
          registerBackHandler={registerBackHandler}
        />
      )
      break
    case 'sync-settings':
      screen = <SyncSettingsScreen controller={syncController} onBack={back} onHome={home} />
      break
    case 'listening-settings':
      screen = <ListeningSettingsScreen onBack={back} />
      break
    case 'bookstore':
      screen = (
        <BookstoreScreen
          bookstore={bookstore}
          controller={syncController}
          onBack={back}
          onOpenBook={(listingId) => push({ name: 'bookstore-book', listingId })}
        />
      )
      break
    case 'bookstore-book':
      screen = (
        <BookstoreBookScreen
          bookstore={bookstore}
          listingId={route.listingId}
          onBack={back}
          onOpenBook={(bookId) => replace({ name: 'book', bookId })}
        />
      )
      break
  }

  // While a book is read aloud, a small player stays at the foot of every other screen.
  return (
    <View style={styles.container}>
      <View style={styles.container}>{screen}</View>
      {route.name === 'reader' || route.name === 'editor' ? null : (
        <ListeningBar
          onOpen={(bookId, chapterId) =>
            push({ name: 'reader', bookId, chapterId: chapterId ?? undefined })
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
