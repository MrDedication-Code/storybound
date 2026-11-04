package expo.modules.storyboundcar

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication
import org.json.JSONArray
import org.json.JSONObject

/** What the phone is reading aloud, as the car shows it. */
data class NowPlaying(
  val playing: Boolean = false,
  val loading: Boolean = false,
  val title: String = "",
  val artist: String = "",
  val album: String = "",
  val bookId: String? = null,
  /** The book's cover, small enough to send to the car. */
  val artwork: ByteArray? = null
)

/** A book in the car's lists. */
data class CarBook(val id: String, val title: String, val subtitle: String, val inProgress: Boolean)

/**
 * Connects the car's media library (StoryboundCarService) with the app's JavaScript, where the
 * listening session lives. Commands from the car go to JavaScript; if it is not running, they wait
 * while it starts in the background.
 */
object CarBridge {
  private const val TAG = "StoryboundCar"
  private const val PREFS = "storybound.car"
  private const val BOOKS = "books"
  private val main = Handler(Looper.getMainLooper())
  private val pending = mutableListOf<Map<String, Any?>>()

  @Volatile var nowPlaying = NowPlaying()
    private set
  @Volatile private var books: List<CarBook>? = null

  /** Sends a command to JavaScript; set while the JavaScript side is listening. */
  @Volatile var emitter: ((Map<String, Any?>) -> Unit)? = null
  /** Tells the car's player and library that something changed. */
  @Volatile var onChanged: (() -> Unit)? = null
  @Volatile var onLibraryChanged: (() -> Unit)? = null

  fun command(context: Context, command: Map<String, Any?>) {
    val send = emitter
    Log.i(TAG, "command ${command["type"]} (app ${if (send != null) "listening" else "not listening"})")
    if (send != null) {
      send(command)
      return
    }
    synchronized(pending) {
      // Only the latest of each kind matters while waiting.
      pending.removeAll { it["type"] == command["type"] }
      pending.add(command)
    }
    startJavaScript(context)
  }

  fun takePending(): List<Map<String, Any?>> = synchronized(pending) {
    val taken = pending.toList()
    pending.clear()
    taken
  }

  /** Starts the app's JavaScript without opening a screen, as a music app does for its car view. */
  private fun startJavaScript(context: Context) {
    main.post {
      try {
        val host = (context.applicationContext as? ReactApplication)?.reactHost
        Log.i(TAG, "starting the app's JavaScript: ${if (host != null) "yes" else "no React host"}")
        host?.start()
      } catch (error: Throwable) {
        Log.w(TAG, "the app's JavaScript did not start", error)
        // The car shows nothing new; opening Storybound on the phone starts it.
      }
    }
  }

  fun updateNowPlaying(next: NowPlaying) {
    nowPlaying = next
    main.post { onChanged?.invoke() }
  }

  fun books(context: Context): List<CarBook> {
    books?.let { return it }
    val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(BOOKS, null)
    val parsed = try {
      val array = JSONArray(stored ?: "[]")
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        CarBook(
          item.getString("id"),
          item.getString("title"),
          item.optString("subtitle"),
          item.optBoolean("inProgress")
        )
      }
    } catch (_: Exception) {
      emptyList()
    }
    books = parsed
    return parsed
  }

  /** Keeps the car's lists, also on disk so they show before the app has started. */
  fun updateBooks(context: Context, next: List<CarBook>) {
    Log.i(TAG, "library: ${next.size} books")
    books = next
    val array = JSONArray()
    for (book in next) {
      array.put(
        JSONObject()
          .put("id", book.id)
          .put("title", book.title)
          .put("subtitle", book.subtitle)
          .put("inProgress", book.inProgress)
      )
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(BOOKS, array.toString()).apply()
    main.post { onLibraryChanged?.invoke() }
  }
}
