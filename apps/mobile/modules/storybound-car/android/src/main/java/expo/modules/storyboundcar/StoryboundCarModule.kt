package expo.modules.storyboundcar

import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side of Storybound in Android Auto. */
/** A cover given as a data URI, scaled down to a JPEG the car can show behind its controls. */
private fun coverArtwork(cover: String?): ByteArray? {
  if (cover == null || !cover.startsWith("data:image")) return null
  return try {
    val bytes = android.util.Base64.decode(cover.substringAfter(","), android.util.Base64.DEFAULT)
    val image = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val scale = minOf(1f, 512f / maxOf(image.width, image.height))
    val scaled = android.graphics.Bitmap.createScaledBitmap(
      image,
      maxOf(1, (image.width * scale).toInt()),
      maxOf(1, (image.height * scale).toInt()),
      true
    )
    val out = java.io.ByteArrayOutputStream()
    scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)
    out.toByteArray()
  } catch (_: Exception) {
    null
  }
}

class StoryboundCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StoryboundCar")
    Events("onCommand")

    OnStartObserving("onCommand") {
      android.util.Log.i("StoryboundCar", "the app is listening to the car")
      CarBridge.emitter = { command -> sendEvent("onCommand", command) }
    }

    OnStopObserving("onCommand") {
      CarBridge.emitter = null
    }

    /**
     * The status bar's height, read when asked. React Native reads it once as its JavaScript
     * starts, and when Android Auto starts the app with no screen open, it reads 0.
     */
    Function("statusBarHeight") {
      val context = appContext.reactContext ?: return@Function 0.0
      val decor = appContext.currentActivity?.window?.decorView
      val insets = decor?.let { ViewCompat.getRootWindowInsets(it) }
      val pixels = insets?.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout())?.top
        ?: context.resources.getIdentifier("status_bar_height", "dimen", "android").let { id ->
          if (id > 0) context.resources.getDimensionPixelSize(id) else 0
        }
      pixels / context.resources.displayMetrics.density.toDouble()
    }

    /** Commands the car sent before the JavaScript was listening. */
    Function("takePendingCommands") {
      CarBridge.takePending()
    }

    Function("setNowPlaying") { playing: Boolean, loading: Boolean, title: String, artist: String, album: String, bookId: String?, cover: String? ->
      val previous = CarBridge.nowPlaying
      // The cover is only decoded when the book changes.
      val artwork = if (bookId != null && bookId == previous.bookId && previous.artwork != null) previous.artwork else coverArtwork(cover)
      CarBridge.updateNowPlaying(NowPlaying(playing, loading, title, artist, album, bookId, artwork))
    }

    Function("setLibrary") { ids: List<String>, titles: List<String>, subtitles: List<String>, inProgress: List<Boolean> ->
      val context = appContext.reactContext
      if (context == null) {
        android.util.Log.w("StoryboundCar", "library arrived with no context")
        return@Function
      }
      CarBridge.updateBooks(
        context,
        ids.indices.map { index ->
          CarBook(ids[index], titles.getOrElse(index) { "" }, subtitles.getOrElse(index) { "" }, inProgress.getOrElse(index) { false })
        }
      )
    }
  }
}
