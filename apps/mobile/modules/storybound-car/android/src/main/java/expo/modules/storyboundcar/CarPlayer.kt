package expo.modules.storyboundcar

import android.content.Context
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The car's view of the phone's listening: it shows what is being read and passes the car's
 * buttons on. The sound itself comes from the app's own player, so this plays nothing.
 */
@UnstableApi
class CarPlayer(private val context: Context) : SimpleBasePlayer(Looper.getMainLooper()) {
  private val commands = Player.Commands.Builder()
    .addAll(
      Player.COMMAND_PLAY_PAUSE,
      Player.COMMAND_PREPARE,
      Player.COMMAND_STOP,
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      Player.COMMAND_SET_MEDIA_ITEM,
      Player.COMMAND_CHANGE_MEDIA_ITEMS,
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
      Player.COMMAND_GET_TIMELINE,
      Player.COMMAND_GET_METADATA
    )
    .build()

  fun refresh() = invalidateState()

  override fun getState(): State {
    val now = CarBridge.nowPlaying
    val builder = State.Builder()
      .setAvailableCommands(commands)
      .setPlayWhenReady(now.playing || now.loading, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
    val bookId = now.bookId ?: return builder.setPlaybackState(Player.STATE_IDLE).build()
    val metadata = MediaMetadata.Builder()
      .setTitle(now.title)
      .setDisplayTitle(now.title)
      .setArtist(now.artist)
      .setSubtitle(now.artist)
      .setAlbumTitle(now.album)
      .setIsPlayable(true)
      .setIsBrowsable(false)
      .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
      .apply { now.artwork?.let { setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) } }
      .build()
    val item = MediaItemData.Builder("now:$bookId:${now.title}")
      .setMediaItem(MediaItem.Builder().setMediaId("book:$bookId").setMediaMetadata(metadata).build())
      .setMediaMetadata(metadata)
      .setDurationUs(C.TIME_UNSET)
      .build()
    return builder
      .setPlaylist(listOf(item))
      .setPlaybackState(if (now.loading) Player.STATE_BUFFERING else Player.STATE_READY)
      .build()
  }

  private fun send(type: String, extra: Map<String, Any?> = emptyMap()): ListenableFuture<*> {
    CarBridge.command(context, mapOf("type" to type) + extra)
    return Futures.immediateVoidFuture()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    // Show the change at once, so the car's button does not flicker back while the phone acts.
    val now = CarBridge.nowPlaying
    if (now.bookId != null) CarBridge.updateNowPlaying(now.copy(playing = playWhenReady, loading = false))
    return send(if (playWhenReady) "play" else "pause")
  }

  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleStop(): ListenableFuture<*> = send("pause")

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> =
    when (seekCommand) {
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> send("next")
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> send("previous")
      else -> Futures.immediateVoidFuture()
    }

  override fun handleSetMediaItems(
    mediaItems: MutableList<MediaItem>,
    startIndex: Int,
    startPositionMs: Long
  ): ListenableFuture<*> {
    val item = mediaItems.getOrNull(maxOf(0, startIndex)) ?: mediaItems.firstOrNull()
    val bookId = item?.mediaId?.removePrefix("book:")
    return if (bookId.isNullOrEmpty()) Futures.immediateVoidFuture() else send("playBook", mapOf("bookId" to bookId))
  }

  override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()
}
