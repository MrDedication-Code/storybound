package expo.modules.storyboundkokoro

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.security.MessageDigest

private const val STYLE_SIZE = 256
private const val SAMPLE_RATE = 24000

/**
 * Kokoro, the free voice, on the phone: downloads its files (checking each against a SHA-256)
 * and turns token numbers into speech. Pronunciation happens in JavaScript, shared with the Mac.
 */
class StoryboundKokoroModule : Module() {
  private val environment: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  private var session: OrtSession? = null
  private var sessionPath: String? = null
  private val lock = Object()

  override fun definition() = ModuleDefinition {
    Name("StoryboundKokoro")
    Events("onDownloadProgress")

    /** Downloads a file to `path`, failing (and keeping nothing) if its SHA-256 differs. */
    AsyncFunction("download") { url: String, path: String, sha256: String ->
      val target = File(path.removePrefix("file://"))
      target.parentFile?.mkdirs()
      val partial = File(target.path + ".part")
      val digest = MessageDigest.getInstance("SHA-256")
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = 30_000
      connection.readTimeout = 60_000
      connection.instanceFollowRedirects = true
      try {
        if (connection.responseCode !in 200..299) {
          throw Exception("The free voice could not be downloaded (${connection.responseCode}).")
        }
        var received = 0L
        var lastReport = 0L
        connection.inputStream.use { input ->
          FileOutputStream(partial).use { output ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              output.write(buffer, 0, count)
              digest.update(buffer, 0, count)
              received += count
              if (received - lastReport >= 1_000_000) {
                lastReport = received
                sendEvent("onDownloadProgress", mapOf("path" to path, "received" to received.toDouble()))
              }
            }
          }
        }
      } finally {
        connection.disconnect()
      }
      val hash = digest.digest().joinToString("") { "%02x".format(it) }
      if (hash != sha256) {
        partial.delete()
        throw Exception("A downloaded voice file was damaged. Try again.")
      }
      if (!partial.renameTo(target)) throw Exception("The free voice could not be saved.")
    }

    /** The SHA-256 of a file already on the phone, or null when it is missing. */
    AsyncFunction("sha256") { path: String ->
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) return@AsyncFunction null
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buffer = ByteArray(256 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          digest.update(buffer, 0, count)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Speaks pieces of token numbers in one voice and writes them as one WAV file. Returns the
     * audio's length in seconds.
     */
    AsyncFunction("synthesize") { modelPath: String, voicePath: String, pieces: List<List<Int>>, outputPath: String ->
      synchronized(lock) {
        val session = sessionFor(modelPath.removePrefix("file://"))
        val styles = readStyles(voicePath.removePrefix("file://"))
        val audio = ArrayList<FloatArray>()
        val names = session.inputNames.toList()
        for (piece in pieces) {
          val row = minOf(maxOf(piece.size - 2, 0), 509)
          val style = styles.copyOfRange(row * STYLE_SIZE, (row + 1) * STYLE_SIZE)
          val ids = LongBuffer.wrap(piece.map { it.toLong() }.toLongArray())
          OnnxTensor.createTensor(environment, ids, longArrayOf(1, piece.size.toLong())).use { tokens ->
            OnnxTensor.createTensor(environment, FloatBuffer.wrap(style), longArrayOf(1, STYLE_SIZE.toLong())).use { styleTensor ->
              OnnxTensor.createTensor(environment, FloatBuffer.wrap(floatArrayOf(1f)), longArrayOf(1)).use { speed ->
                val feeds = mapOf(names[0] to tokens, names[1] to styleTensor, names[2] to speed)
                session.run(feeds).use { result ->
                  val output = result.get(0) as OnnxTensor
                  val buffer = output.floatBuffer
                  val samples = FloatArray(buffer.remaining())
                  buffer.get(samples)
                  audio.add(samples)
                }
              }
            }
          }
        }
        writeWav(File(outputPath.removePrefix("file://")), audio)
        audio.sumOf { it.size } / SAMPLE_RATE.toDouble()
      }
    }

    /** Lets go of the model, for when the free voice is removed. */
    Function("unload") {
      synchronized(lock) {
        session?.close()
        session = null
        sessionPath = null
      }
    }
  }

  private fun sessionFor(path: String): OrtSession {
    val existing = session
    if (existing != null && sessionPath == path) return existing
    existing?.close()
    val options = OrtSession.SessionOptions().apply {
      setIntraOpNumThreads(4)
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      // KleidiAI's SME kernels crash where the processor reports SME it cannot run (the Android
      // emulator on Apple M4 Macs); the standard ARM kernels are fast enough for speech.
      addConfigEntry("mlas.disable_kleidiai", "1")
    }
    val created = environment.createSession(path, options)
    session = created
    sessionPath = path
    return created
  }

  private fun readStyles(path: String): FloatArray {
    RandomAccessFile(path, "r").use { file ->
      val bytes = ByteArray(file.length().toInt())
      file.readFully(bytes)
      val floats = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      val styles = FloatArray(floats.remaining())
      floats.get(styles)
      return styles
    }
  }

  private fun writeWav(file: File, pieces: List<FloatArray>) {
    file.parentFile?.mkdirs()
    val sampleCount = pieces.sumOf { it.size }
    val dataBytes = sampleCount * 2
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + dataBytes); put("WAVE".toByteArray())
      put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
      putInt(SAMPLE_RATE); putInt(SAMPLE_RATE * 2); putShort(2); putShort(16)
      put("data".toByteArray()); putInt(dataBytes)
    }
    FileOutputStream(file).use { output ->
      output.write(header.array())
      val pcm = ByteBuffer.allocate(dataBytes).order(ByteOrder.LITTLE_ENDIAN)
      for (piece in pieces) {
        for (sample in piece) {
          val clamped = sample.coerceIn(-1f, 1f)
          pcm.putShort((if (clamped < 0) clamped * 32768f else clamped * 32767f).toInt().toShort())
        }
      }
      output.write(pcm.array())
    }
  }
}
