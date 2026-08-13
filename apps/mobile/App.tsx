import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, SafeAreaView, StyleSheet, useColorScheme } from 'react-native'
import { ErrorScreen, LoadingScreen } from './src/components/ScreenState'
import { openMobileRepository, type OpenedMobileRepository } from './src/data/sqlite/openRepository'
import type { MobileRepository, MobileRoute } from './src/domain/contracts'
import { BookDetailScreen } from './src/screens/BookDetailScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { ReaderScreen } from './src/screens/ReaderScreen'
import { SyncSettingsScreen } from './src/screens/SyncSettingsScreen'
import { createMobileSyncRuntime } from './src/sync/runtime'
import type { MobileSyncController, MobileSyncRuntime } from './src/sync/types'
import { storyboundColors } from './src/theme'

export default function App(): React.JSX.Element {
  const colorScheme = useColorScheme()
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

  const push = useCallback((next: MobileRoute): void => {
    setRoutes((current) => [...current, next])
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

  let screen: React.JSX.Element
  switch (route.name) {
    case 'library':
      screen = (
        <LibraryScreen
          repository={repository}
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
          onEditChapter={(chapterId) => push({ name: 'editor', bookId: route.bookId, chapterId })}
          onReadChapter={(chapterId) => push({ name: 'reader', bookId: route.bookId, chapterId })}
        />
      )
      break
    case 'reader':
      screen = (
        <ReaderScreen
          bookId={route.bookId}
          initialChapterId={route.chapterId}
          repository={repository}
          onBack={back}
          onEditChapter={(chapterId) => push({ name: 'editor', bookId: route.bookId, chapterId })}
        />
      )
      break
    case 'editor':
      screen = (
        <EditorScreen
          bookId={route.bookId}
          chapterId={route.chapterId}
          repository={repository}
          onBack={back}
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
