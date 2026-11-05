package expo.modules.storyboundcar

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.core.content.IntentCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

private const val ROOT = "root"
private const val CONTINUE = "continue"
private const val LIBRARY = "library"
private const val RECENT = "recent"

/** Long enough for the phone's own player, which can hear the same press, to act first. */
private const val BUTTON_WAIT_MS = 450L

/**
 * Storybound in Android Auto: a "Continue listening" tab with the books being read, a "Library"
 * tab with every book, and a now-playing screen whose buttons control the phone's listening.
 */
@UnstableApi
class StoryboundCarService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private var player: CarPlayer? = null
  private val main = Handler(Looper.getMainLooper())

  override fun onCreate() {
    super.onCreate()
    val created = CarPlayer(applicationContext)
    player = created
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = MediaLibrarySession.Builder(this, created, Callback()).setId("storybound-car")
    if (open != null) builder.setSessionActivity(open)
    val library = builder.build()
    session = library
    CarBridge.onChanged = { created.refresh() }
    CarBridge.onLibraryChanged = {
      library.notifyChildrenChanged(ROOT, 2, null)
      library.notifyChildrenChanged(CONTINUE, CarBridge.books(this).count { it.inProgress }, null)
      library.notifyChildrenChanged(LIBRARY, CarBridge.books(this).size, null)
    }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  // The phone's own player already shows the notification; this one would duplicate it.
  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) = Unit

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    CarBridge.onChanged = null
    CarBridge.onLibraryChanged = null
    session?.release()
    player?.release()
    session = null
    player = null
    super.onDestroy()
  }

  private fun folder(id: String, title: String): MediaItem =
    MediaItem.Builder()
      .setMediaId(id)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(title)
          .setIsBrowsable(true)
          .setIsPlayable(false)
          .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS)
          .build()
      )
      .build()

  private fun bookItem(book: CarBook): MediaItem =
    MediaItem.Builder()
      .setMediaId("book:${book.id}")
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(book.title)
          .setSubtitle(book.subtitle)
          .setIsBrowsable(false)
          .setIsPlayable(true)
          .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK)
          .build()
      )
      .build()

  private fun find(mediaId: String): MediaItem? {
    val id = mediaId.removePrefix("book:")
    return CarBridge.books(this).firstOrNull { it.id == id }?.let(::bookItem)
  }

  /** A spoken request ("play Zero Balance on Storybound") matched to a book, else the latest one. */
  private fun bookForSearch(query: String?): MediaItem? {
    val books = CarBridge.books(this)
    val words = query?.lowercase()?.trim().orEmpty()
    val match = books.firstOrNull { words.isNotEmpty() && it.title.lowercase() in words }
      ?: books.firstOrNull { words.isNotEmpty() && words in it.title.lowercase() }
      ?: books.firstOrNull { it.inProgress }
      ?: books.firstOrNull()
    return match?.let(::bookItem)
  }

  private inner class Callback : MediaLibrarySession.Callback {
    /**
     * A steering-wheel press can reach both this session and the session of the phone's own
     * player. Left alone, a play/pause press would pause and then resume straight away, and a
     * skip would move twice, so the app is asked to act only if the player has not already.
     */
    override fun onMediaButtonEvent(
      session: MediaSession,
      controllerInfo: MediaSession.ControllerInfo,
      intent: Intent
    ): Boolean {
      val key = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        ?: return false
      val button = when (key.keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "toggle"
        KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
        else -> return false
      }
      // With nothing loaded there is only this session; it resumes the latest book.
      if (CarBridge.nowPlaying.bookId == null) return false
      if (key.action == KeyEvent.ACTION_DOWN && key.repeatCount == 0) {
        main.postDelayed({
          CarBridge.command(this@StoryboundCarService, mapOf("type" to "button", "button" to button))
        }, BUTTON_WAIT_MS)
      }
      return true
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<MediaItem>> =
      Futures.immediateFuture(
        LibraryResult.ofItem(
          // The system's "resume" card asks for just the book to carry on with.
          if (params?.isRecent == true) folder(RECENT, "Storybound") else folder(ROOT, "Storybound"),
          params
        )
      )

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val books = CarBridge.books(this@StoryboundCarService)
      // Asking the app for the latest list also starts it, so playing is quick.
      CarBridge.command(this@StoryboundCarService, mapOf("type" to "refresh"))
      val items = when (parentId) {
        ROOT -> listOf(folder(CONTINUE, "Continue listening"), folder(LIBRARY, "Library"))
        CONTINUE -> books.filter { it.inProgress }.map(::bookItem)
        LIBRARY -> books.map(::bookItem)
        RECENT -> listOfNotNull(CarBridge.nowPlaying.bookId?.let { find(it) } ?: bookForSearch(null))
        else -> emptyList()
      }
      val from = (page * pageSize).coerceAtMost(items.size)
      val to = (from + pageSize).coerceAtMost(items.size)
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(items.subList(from, to)), params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val item = find(mediaId) ?: return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
      return Futures.immediateFuture(LibraryResult.ofItem(item, null))
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>
    ): ListenableFuture<MutableList<MediaItem>> {
      val resolved = mediaItems.mapNotNull { item ->
        val query = item.requestMetadata.searchQuery
        if (query != null || item.mediaId.isEmpty()) bookForSearch(query) else find(item.mediaId) ?: item
      }
      return Futures.immediateFuture(resolved.toMutableList())
    }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val current = CarBridge.nowPlaying.bookId?.let { find(it) } ?: bookForSearch(null)
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(listOfNotNull(current), 0, 0)
      )
    }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<Void>> {
      val words = query.lowercase()
      val count = CarBridge.books(this@StoryboundCarService).count { words in it.title.lowercase() }
      session.notifySearchResultChanged(browser, query, count, params)
      return Futures.immediateFuture(LibraryResult.ofVoid())
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val words = query.lowercase()
      val items = CarBridge.books(this@StoryboundCarService)
        .filter { words in it.title.lowercase() }
        .map(::bookItem)
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
    }
  }
}
