package com.chetan.connectsuite.sync.v2

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.BulkFraming
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * The phone's half of the bulk channel: one file, one socket, one `transferId`.
 *
 * This is the first thing in the repo to serve port 42503. Slice 1 built the frame caps and could
 * only unit-test them, because nothing put bytes on the socket — `docs/testing.md` records that debt
 * by name and this is what pays it.
 *
 * ### Pull only, and deliberately so
 *
 * Only `media.original` reaches this today, and it is phone → Mac. Push, SAF destinations,
 * `.part`/`.failed` and resume-across-process-death all belong to the transfer slice, which is
 * `fs.*`. What is built here is the smallest thing that moves real bytes over a real socket: a
 * pending transfer registered by a control request, claimed by a header frame, streamed, and
 * reported.
 *
 * ### Resume is honoured here even though nothing asks for it yet
 *
 * The header may carry an `offset` and this seeks to it, because the receiver is the side that knows
 * what it already holds. The digest, though, is computed from **byte 0 regardless** — that is the
 * rule the payload proposal spends its longest section on, and getting it wrong on a resumed
 * transfer reports `CHECKSUM_MISMATCH` on a perfectly good file and then deletes it. The sender's
 * obligation is the mirror image of the receiver's: seek to `offset` to *send* from, digest the
 * whole file.
 */
object BulkTransfers {

    /** How often progress may be reported. A chunk is 256 KB, so a fast LAN would emit hundreds. */
    private const val PROGRESS_INTERVAL_MS = 250L

    /** The chunk size this build sends, and the `chunkMax` it advertises. */
    private const val CHUNK = 256 * 1024

    /**
     * A transfer that has been agreed on the control channel and not yet claimed by a socket.
     *
     * Held by `transferId` rather than by session so a Mac may open the bulk socket whenever it is
     * ready. It is dropped when the session ends: a transfer authorised by a token whose session is
     * gone is a transfer with nobody to report to, and on a pull it would mean reading the user's
     * files for a peer that no longer exists.
     */
    data class Pending(
        val transferId: String,
        val uri: Uri,
        val name: String,
        val mime: String,
        val size: Long,
        val sessionId: String,
    )

    private val pending = ConcurrentHashMap<String, Pending>()
    private val counter = AtomicLong(0)

    private val completed = AtomicLong(0)
    private val failed = AtomicLong(0)

    private fun tally(): String = "${completed.get()} completed / ${failed.get()} failed since start"

    /**
     * Registers a `media.original` pull and returns its id, or null when the item is gone.
     *
     * The size and mime come from `MediaStore` at this moment rather than from the Mac's cached
     * `media.list` row: the file is the phone's truth, and a photo deleted between listing and
     * fetching must be a `NOT_FOUND` here rather than a transfer that streams a wrong length.
     */
    fun registerMediaPull(context: Context, id: Long, sessionId: String): Pending? {
        val uri = ContentUris.withAppendedId(
            MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL),
            id,
        )
        val row = context.contentResolver.query(
            uri,
            arrayOf(
                MediaPayloads.COL_DISPLAY_NAME,
                MediaPayloads.COL_MIME,
                MediaPayloads.COL_SIZE,
            ),
            null,
            null,
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            Triple(
                cursor.getString(0) ?: "photo-$id",
                cursor.getString(1) ?: "application/octet-stream",
                cursor.getLong(2),
            )
        } ?: return null

        val transferId = "t-${counter.incrementAndGet()}-${System.currentTimeMillis() % 100000}"
        val entry = Pending(transferId, uri, row.first, row.second, row.third, sessionId)
        pending[transferId] = entry
        LinkLog.i(
            "bulk",
            "media.original registered $transferId → ${row.first}, ${row.third} bytes, ${row.second}; " +
                "${pending.size} pending",
        )
        return entry
    }

    fun chunkMax(): Int = CHUNK

    /** Drops everything a dead session authorised. See [Pending]. */
    fun forgetSession(sessionId: String) {
        val dropped = pending.entries.filter { it.value.sessionId == sessionId }
        dropped.forEach { pending.remove(it.key) }
        if (dropped.isNotEmpty()) {
            LinkLog.i("bulk", "session ended: dropped ${dropped.size} unclaimed transfer(s)")
        }
    }

    /**
     * Serves one bulk socket, start to finish, on the thread the accept loop hands over.
     *
     * The stream from [AuthenticatedChannel] is the same one the token was read from and must not be
     * re-wrapped — the header frame is very likely already sitting in that buffer.
     */
    fun serve(context: Context, channel: AuthenticatedChannel) {
        val framing = BulkFraming(
            input = channel.input,
            output = channel.output,
            onViolation = { message ->
                // The cap refusal closes the socket and says which cap and which length, with the
                // frames and bytes already accepted beside it — a refusal with no denominator
                // cannot tell the first frame of a broken channel from the ten-thousandth frame of
                // a transfer that has moved 2 GB.
                LinkLog.e("bulk", message)
                channel.close()
            },
        )

        val header = try {
            framing.readHeader()
        } catch (e: Exception) {
            LinkLog.w("bulk", "no usable header frame; closing", e)
            channel.close()
            return
        }
        if (header == null) {
            LinkLog.w("bulk", "bulk socket closed before sending a header")
            channel.close()
            return
        }

        val parsed = runCatching {
            kotlinx.serialization.json.Json.parseToJsonElement(String(header, Charsets.UTF_8))
        }.getOrNull()
        val obj = parsed as? kotlinx.serialization.json.JsonObject
        val transferId = obj?.get("transferId")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
        }
        val offset = obj?.get("offset")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
        } ?: 0L

        val entry = transferId?.let { pending.remove(it) }
        if (entry == null) {
            failed.incrementAndGet()
            LinkLog.w(
                "bulk",
                "bulk header names transferId=$transferId, which is not pending — refusing. ${tally()}",
            )
            channel.session.sendError(
                requestId = java.util.UUID.randomUUID().toString(),
                code = ErrorCode.NOT_FOUND,
                message = "That transfer is not waiting on this phone.",
                feature = "photos",
            )
            channel.close()
            return
        }

        streamTo(context, channel, framing, entry, offset)
    }

    private fun streamTo(
        context: Context,
        channel: AuthenticatedChannel,
        framing: BulkFraming,
        entry: Pending,
        offset: Long,
    ) {
        val startedAt = System.currentTimeMillis()
        var sent = 0L
        var lastReport = 0L
        val digest = MessageDigest.getInstance("SHA-256")

        try {
            context.contentResolver.openInputStream(entry.uri).use { input ->
                if (input == null) throw IllegalStateException("the file could not be opened")

                // The digest covers the whole file; the *send* starts at `offset`. Those are two
                // different positions and conflating them is the failure the payload proposal
                // spends its longest section on: a resumed transfer whose digest starts at the
                // offset reports CHECKSUM_MISMATCH on a byte-perfect file, and the deletion rule
                // then throws away the partial the receiver already held.
                if (offset > 0) {
                    digestSkipped(input, digest, offset)
                    LinkLog.i(
                        "bulk",
                        "${entry.transferId} resuming at $offset of ${entry.size}; the digest covers " +
                            "the skipped bytes too",
                    )
                }

                val buffer = ByteArray(CHUNK)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    val chunk = if (read == buffer.size) buffer else buffer.copyOf(read)
                    digest.update(chunk, 0, read)
                    framing.writeChunk(chunk)
                    sent += read

                    val now = System.currentTimeMillis()
                    if (now - lastReport >= PROGRESS_INTERVAL_MS) {
                        lastReport = now
                        report(channel, entry, offset + sent, startedAt)
                    }
                }
            }

            val elapsed = System.currentTimeMillis() - startedAt
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            completed.incrementAndGet()

            // The final progress event is never throttled. Most transfers on a LAN finish inside one
            // 250 ms window, so the common case is a transfer with no intermediate progress at all —
            // and a Mac that waits for a stream before believing a transfer started would show every
            // small file as stalled. `bytes == total` always arrives.
            report(channel, entry, offset + sent, startedAt)
            channel.session.send(
                Envelope(
                    type = MessageType.FS_TRANSFER_DONE,
                    payload = buildJsonObject {
                        put("transferId", entry.transferId)
                        put("ok", true)
                        put("bytes", offset + sent)
                        put("elapsedMs", elapsed)
                        // The phone computed a digest over the whole file, but nothing compared it
                        // to a digest agreed in advance — `media.original` acks `sha256: null`
                        // because hashing before sending would read the file twice. So the honest
                        // report is *sent, not verified*: `verified` is a separate field from `ok`
                        // precisely so a success nobody checked cannot look like a success that was.
                        put("verified", false)
                        put("sha256", sha)
                    },
                ),
            )
            LinkLog.i(
                "bulk",
                "${entry.transferId} sent ${offset + sent} of ${entry.size} bytes in ${elapsed}ms " +
                    "(${rateOf(sent, elapsed)}), sha256=${sha.take(12)}…, verified=false — " +
                    "${tally()}; ${framing.tally.summary()}",
            )
        } catch (e: Exception) {
            failed.incrementAndGet()
            val elapsed = System.currentTimeMillis() - startedAt
            LinkLog.e(
                "bulk",
                "${entry.transferId} failed after $sent of ${entry.size} bytes in ${elapsed}ms — " +
                    "${tally()}; ${framing.tally.summary()}",
                e,
            )
            runCatching {
                channel.session.send(
                    Envelope(
                        type = MessageType.FS_TRANSFER_DONE,
                        payload = buildJsonObject {
                            put("transferId", entry.transferId)
                            put("ok", false)
                            put("code", ErrorCode.TRANSFER_FAILED)
                            put("message", "${entry.name} stopped after $sent bytes.")
                            put("bytes", offset + sent)
                            put("elapsedMs", elapsed)
                            put("verified", false)
                        },
                    ),
                )
            }
        } finally {
            channel.close()
        }
    }

    /**
     * Feeds [count] bytes through [digest] without sending them, then leaves the stream positioned.
     *
     * `skip` is not usable here: it may skip fewer bytes than asked and, more to the point, skipping
     * would leave those bytes out of the digest — which is the bug this whole method exists to
     * prevent. v1's `TransferManager.skipBuffer` did the same thing for the same reason.
     */
    private fun digestSkipped(input: InputStream, digest: MessageDigest, count: Long) {
        val buffer = ByteArray(CHUNK)
        var remaining = count
        while (remaining > 0) {
            val want = minOf(remaining, buffer.size.toLong()).toInt()
            val read = input.read(buffer, 0, want)
            if (read <= 0) break
            digest.update(buffer, 0, read)
            remaining -= read
        }
    }

    private fun report(channel: AuthenticatedChannel, entry: Pending, bytes: Long, startedAt: Long) {
        val elapsed = maxOf(1L, System.currentTimeMillis() - startedAt)
        channel.session.send(
            Envelope(
                type = MessageType.FS_TRANSFER_PROGRESS,
                payload = buildJsonObject {
                    put("transferId", entry.transferId)
                    put("bytes", bytes)
                    put("total", entry.size)
                    put("bytesPerSecond", bytes * 1000 / elapsed)
                },
            ),
        )
    }

    private fun rateOf(bytes: Long, elapsedMs: Long): String {
        if (elapsedMs <= 0) return "instant"
        val mbps = bytes * 8.0 / elapsedMs / 1000.0
        return "%.1f Mbit/s".format(mbps)
    }

    /** Exposed for the contract test: the caps this channel writes under are the protocol's. */
    fun capsInUse(): Pair<Int, Int> = Link.MAX_BULK_HEADER_FRAME to Link.MAX_BULK_FRAME
}
