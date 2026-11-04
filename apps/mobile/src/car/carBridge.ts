import { StoryboundCar, type CarCommand } from '../../modules/storybound-car'
import { sharedRepository } from '../data/sqlite/sharedRepository'
import type { MobileRepository } from '../domain/contracts'
import { listeningSession } from '../narration'
import { createListeningVoice } from '../narration/googleVoice'
import type { ListeningSnapshot } from '../narration/listeningSession'

/**
 * Storybound in Android Auto. The car's library and buttons arrive here as commands; what is being
 * read goes back to the car's screen. This runs as soon as the app's JavaScript starts, which the
 * car can do without opening any screen.
 */
export function startCarBridge(): void {
  const native = StoryboundCar
  if (!native) return
  native.addListener('onCommand', (command) => void handle(command))
  for (const command of native.takePendingCommands()) void handle(command)

  let last = ''
  const publish = (snapshot: ListeningSnapshot): void => {
    const active = snapshot.status !== 'idle' && snapshot.bookId !== null
    const playing = snapshot.status === 'playing'
    const loading = snapshot.status === 'loading'
    const title = active ? snapshot.chapterTitle || snapshot.bookTitle : ''
    const artist = active ? snapshot.bookTitle : ''
    const key = [active, playing, loading, title, artist, snapshot.bookId].join('\n')
    if (key === last) return
    last = key
    native.setNowPlaying(
      playing,
      loading,
      title,
      artist,
      'Storybound',
      active ? snapshot.bookId : null,
      active && snapshot.bookId ? (covers.get(snapshot.bookId) ?? null) : null
    )
  }
  listeningSession().subscribe(publish)
  publish(listeningSession().current)
  // Covers arrive with the library; show the playing book's cover once they have.
  republish = () => {
    last = ''
    publish(listeningSession().current)
  }
  void publishLibrary()
}

async function repository(): Promise<MobileRepository> {
  return (await sharedRepository()).repository
}

/** Synced covers by book, for the car's now-playing screen. */
const covers = new Map<string, string>()
let republish: (() => void) | null = null

/** The car's two lists: books being read, most recent first, then every book. */
async function publishLibrary(): Promise<void> {
  const native = StoryboundCar
  if (!native) return
  try {
    const books = await (await repository()).listBooks()
    covers.clear()
    for (const book of books) if (book.coverUri) covers.set(book.id, book.coverUri)
    republish?.()
    const ordered = [...books].sort((left, right) =>
      (right.lastReadAt ?? '').localeCompare(left.lastReadAt ?? '')
    )
    native.setLibrary(
      ordered.map((book) => book.id),
      ordered.map((book) => book.title),
      ordered.map((book) =>
        book.lastReadAt
          ? `${Math.round(book.progressPercentage)}% · ${book.authorName || 'Storybound'}`
          : book.authorName || `${book.chapterCount} chapters`
      ),
      ordered.map((book) => Boolean(book.lastReadAt) && book.progressPercentage < 99.5)
    )
  } catch {
    // The car keeps the lists it had.
  }
}

/** Starts a book where it was left; with no book given, the one read most recently. */
async function startBook(bookId?: string): Promise<void> {
  const library = await repository()
  let id = bookId
  if (!id) {
    const books = await library.listBooks()
    id = [...books]
      .filter((book) => book.lastReadAt)
      .sort((left, right) => (right.lastReadAt ?? '').localeCompare(left.lastReadAt ?? ''))[0]?.id
    id ??= books[0]?.id
  }
  if (!id) return
  const session = listeningSession()
  // Already reading this book: carry on rather than start again.
  if (session.current.bookId === id && session.current.status !== 'idle') {
    session.play()
    return
  }
  const [reading, book] = await Promise.all([library.getReadingState(id), library.getBook(id)])
  const chapterId = reading.chapterId ?? book.chapters[0]?.id
  if (!chapterId) return
  const { voice, settings } = await createListeningVoice()
  await session.start({
    repository: library,
    voice,
    bookId: id,
    chapterId,
    progress: reading.chapterId === chapterId ? reading.scrollPosition : 0,
    speed: settings.speed
  })
}

async function handle(command: CarCommand): Promise<void> {
  const session = listeningSession()
  try {
    switch (command.type) {
      case 'play':
        if (session.current.bookId && session.current.status !== 'idle') session.play()
        else await startBook()
        return
      case 'pause':
        session.pause()
        return
      case 'next':
        session.next()
        return
      case 'previous':
        session.previous()
        return
      case 'playBook':
        await startBook(command.bookId)
        return
      case 'refresh':
        await publishLibrary()
        return
    }
  } catch {
    // Listening is not set up yet (no key, or the free voice not downloaded): nothing to play.
  }
}
