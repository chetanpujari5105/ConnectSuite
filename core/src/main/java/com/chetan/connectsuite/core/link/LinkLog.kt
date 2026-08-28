package com.chetan.connectsuite.core.link

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Rotating file log for the link layer.
 *
 * Logcat is gone the moment the phone is unplugged, which is exactly when the interesting
 * disconnects happen, so every socket path also writes here. Two files of 512 KB is enough to
 * cover an overnight idle test without becoming something the user has to clean up.
 */
object LinkLog {

    private const val MAX_BYTES = 512 * 1024
    private const val TAG = "ConnectSuiteLink"

    private val writer = Executors.newSingleThreadExecutor { r ->
        Thread(r, "link-log").apply { isDaemon = true }
    }
    /**
     * ISO-8601 local time with an explicit offset, e.g. `2026-08-27T16:07:48.104+05:30`.
     *
     * The offset is the point. The Mac's log and this one are read side by side whenever a step
     * fails, and they used to be written in different zones with only one of them saying so — the
     * phone in bare local time, the Mac in UTC with a `Z`. Comparing a line from each meant
     * knowing the phone's zone and doing the arithmetic, which cost real time twice in one
     * afternoon and produced a wrong conclusion both times: a Mac line 4.6 seconds *older* than a
     * phone line was read as newer, and a passing step was recorded as a failure.
     *
     * Local rather than UTC because the phone's own wall clock is what a person holding it sees,
     * and the offset makes it unambiguous anyway. `desktop/src/main/logger.ts` writes the same
     * shape.
     *
     * **Only ever touched on the `link-log` writer thread.** `SimpleDateFormat` is not thread
     * safe, and this object is logged to from the control, video and bulk socket threads at once;
     * sharing one formatter across them corrupts the very field the two logs are lined up on. The
     * event time is captured as a `Date` at the call site and formatted here, so the stamp stays
     * accurate without the formatter ever being entered twice.
     */
    private val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)

    @Volatile
    private var current: File? = null

    fun init(context: Context) {
        val dir = File(context.applicationContext.filesDir, "logs").apply { mkdirs() }
        current = File(dir, "link.log")
    }

    fun i(where: String, message: String) = write("I", where, message, null)

    fun w(where: String, message: String, error: Throwable? = null) = write("W", where, message, error)

    fun e(where: String, message: String, error: Throwable? = null) = write("E", where, message, error)

    /** Newest-first tail, for the desktop's "connection health" panel and bug reports. */
    fun tail(lines: Int = 200): List<String> {
        val file = current ?: return emptyList()
        if (!file.exists()) return emptyList()
        return runCatching { file.readLines().takeLast(lines).asReversed() }.getOrDefault(emptyList())
    }

    private fun write(level: String, where: String, message: String, error: Throwable?) {
        when (level) {
            "E" -> Log.e(TAG, "[$where] $message", error)
            "W" -> Log.w(TAG, "[$where] $message", error)
            else -> Log.i(TAG, "[$where] $message")
        }
        val file = current ?: return
        // Captured here, on the calling thread, so the stamp is the moment the event happened
        // rather than the moment the writer queue got round to it. Formatting happens on the
        // writer thread; see [stamp].
        val at = Date()
        val body = buildString {
            append(level).append(' ')
            append('[').append(where).append("] ").append(message)
            if (error != null) {
                append(" :: ").append(error.javaClass.simpleName).append(": ").append(error.message)
                // The class and message alone are not enough for TLS failures, where the useful
                // information is which layer threw.
                error.stackTrace.take(4).forEach { append("\n      at ").append(it.toString()) }
                error.cause?.let { append("\n    caused by ").append(it.toString()) }
            }
        }
        writer.execute {
            runCatching {
                if (file.length() > MAX_BYTES) {
                    val previous = File(file.parentFile, "link.log.1")
                    previous.delete()
                    file.renameTo(previous)
                }
                file.appendText(stamp.format(at) + " " + body + "\n")
            }
        }
    }
}
