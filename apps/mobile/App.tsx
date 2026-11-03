import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackHandler,
  Dimensions,
  Platform,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  useColorScheme,
  useWindowDimensions
} from 'react-native'
import { ErrorScreen, LoadingScreen } from './src/components/ScreenState'
import { openMobileRepository, type OpenedMobileRepository } from './src/data/sqlite/openRepository'
import {
  DEFAULT_PREFERENCES,
  type MobilePreferences,
  type MobileRepository,
  type MobileRoute
} from './src/domain/contracts'
import { BookDetailScreen } from './src/screens/BookDetailScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { ReaderScreen } from './src/screens/ReaderScreen'
import { SyncSettingsScreen } from './src/screens/SyncSettingsScreen'
import { createMobileSyncRuntime } from './src/sync/runtime'
import type { MobileSyncController, MobileSyncRuntime } from './src/sync/types'
import { storyboundColors } from './src/theme'

/**
 * Android draws apps edge to edge, under the status bar and the gesture or button bar, and
 * SafeAreaView only pads on iOS. The bars' heights are what the screen has beyond the window.
 */
function useAndroidBarInsets(): { paddingTop: number; paddingBottom: number } | null {
  const window = useWindowDimensions()
  if (Platform.OS !== 'android') return null
  const top = NativeStatusBar.currentHeight ?? 0
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
    let opened: OpenedMobileRepository | null = null
    let syncRuntime: MobileSyncRuntime | null = null

    void openMobileRepository()
      .then((next) => {
        if (!active) {
          void next.close()
          return
        }
        opened = next
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
      if (opened) void opened.close()
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
  }

  return screen
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
