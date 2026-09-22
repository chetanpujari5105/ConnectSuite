package com.chetan.connectsuite.sync.v2

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.BulkFraming
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.runBlocking
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
 * ### Both directions, and each one has a receiver with the same three obligations
 *
 * `media.original` and `fs.transfer.begin` pull phone → Mac; `direction: "push"` receives Mac →
 * phone into a SAF tree, the app-private folder, or `Download/ConnectSuite` through `MediaStore`.
 * The class doc used to say *pull only, and deliberately so*; that was true until slice 8.
 *
 * ### The digest covers the whole file, on both sides, always
 *
 * A header may carry an `offset` and the reader seeks to it, because the receiver is the side that
 * knows what it already holds. The digest is computed from **byte 0 regardless** — the rule the
 * payload proposal spends its longest section on, and getting it wrong on a resumed transfer reports
 * `CHECKSUM_MISMATCH` on a perfectly good file and then deletes it. Sender and receiver are mirror
 * images: seek to `offset` to *send* from, read the partial back to *digest* from zero.
 *
 * ### The length is the other half of that, and it is the half that was missing
 *
 * A digest is agreed only below a 64 MB ceiling, so on large files there is nothing to compare and
 * **the agreed length is the only witness that a stream ended early.** [receiveFrom] asks
 * [FsPartials.arrivalVerdict] rather than deciding for itself, because deciding for itself inline is
 * the shape defect 56 shipped in — a truncated push committed as the finished file.
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
        val name: String,
        val mime: String,
        val size: Long,
        val sessionId: String,
        /**
         * The digest agreed **in advance**, or null when the sender chose not to pre-hash.
         *
         * A null here is not a missing feature: `fs.transfer.done` reports `verified: false` and
         * says plainly that nothing compared the bytes against a digest agreed beforehand. That is
         * the honest answer, and it is a separate field from `ok` precisely so a success nobody
         * checked cannot look like a success that was.
         */
        val sha256: String?,
        /**
         * Opens the source. A supplier rather than a `Uri` because `fs.*` reads through an
         * [FsStore] — a SAF document or an app-private file — and `media.original` reads through
         * `MediaStore`. One streaming path, two ways of naming a source.
         */
        val open: () -> InputStream?,
    )

    private val pending = ConcurrentHashMap<String, Pending>()

    /**
     * A push the phone has agreed to receive and no socket has claimed yet.
     *
     * Separate from [pending] rather than a `direction` field on it, because the two share almost
     * nothing: a pull holds a source and streams out, a push holds a partial on disk, a resume
     * offset the phone chose, and a Room row that outlives the process. One type carrying both would
     * be half-null in either direction, and the half that is null is different each time.
     */
    data class Incoming(
        val transferId: String,
        val name: String,
        val size: Long,
        val sessionId: String,
        /** The digest the **Mac** agreed before sending, or null when it did not pre-hash. */
        val sha256: String?,
        /** Where the phone told the Mac to start. The digest must still cover byte 0 onward. */
        val offset: Long,
        val partial: FsPartial,
        /** `rootId/path` and the file name — how the Room row is found again on a later attempt. */
        val recordPath: String,
        val rootLabel: String,
        /**
         * The **application** context, for the record writes on the socket thread.
         *
         * Application rather than whatever was handed in: this map outlives any activity, and an
         * unclaimed push can sit here for the length of a session.
         */
        val context: Context,
    )

    private val incoming = ConcurrentHashMap<String, Incoming>()

    /**
     * Transfers a `fs.transfer.cancel` has asked to stop, checked once per chunk.
     *
     * Cancelling **keeps** the partial, with its record — the opposite policy from a checksum
     * mismatch, and the difference is the whole point: an interrupted partial is a resumable
     * artifact, a checksum-failed partial is corrupt. Two states that both look like half a file on
     * disk and want opposite treatment.
     */
    private val cancelled = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
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

        val transferId = nextId()
        val entry = Pending(
            transferId = transferId,
            name = row.first,
            mime = row.second,
            size = row.third,
            sessionId = sessionId,
            // Deliberately null. Hashing before sending reads the file twice, and a 4 GB video
            // would stall this ack for the length of a full read with no progress to report.
            sha256 = null,
            open = { context.contentResolver.openInputStream(uri) },
        )
        pending[transferId] = entry
        LinkLog.i(
            "bulk",
            "media.original registered $transferId → ${row.first}, ${row.third} bytes, ${row.second}; " +
                "${pending.size} pending",
        )
        return entry
    }

    private fun nextId(): String =
        "t-${counter.incrementAndGet()}-${System.currentTimeMillis() % 100000}"

    /**
     * The largest file this will digest before answering `fs.transfer.begin`.
     *
     * Pre-hashing is what makes `verified: true` possible at all — without a digest agreed in
     * advance there is nothing for the receiver to compare against, and every transfer in this
     * project so far has reported `verified: false` for exactly that reason. It is bounded because
     * the hash happens **inside the ack**, on the control channel, with nothing able to report
     * progress: a 4 GB video would hold that channel for the length of a full read, which is the
     * argument `media.original` still stands on.
     *
     * 64 MB at the ~250 MB/s this handset reads at is a few hundred milliseconds. Above it the ack
     * carries `sha256: null` and says so, which is the same honest answer `media.original` gives —
     * and the log line beside it carries the size and the elapsed time, so the threshold can be
     * moved on evidence rather than on taste.
     */
    private const val PREHASH_MAX_BYTES = 64L * 1024 * 1024

    /**
     * Registers an `fs.transfer.begin` pull, pre-hashing where the file is small enough.
     *
     * The digest is computed **here**, before the ack, over the whole file — never over the part
     * that will be sent. On a resume the sender seeks to `offset` to send from while its digest
     * still covers everything from byte 0, which is the mirror image of the receiver's obligation
     * and the failure the payload spec spends its longest section on.
     */
    fun registerFsPull(
        store: FsStore,
        entry: FsPaths.Entry,
        sessionId: String,
    ): Pending? {
        if (entry.dir) return null
        val sha = prehash(store, entry)
        val transferId = nextId()
        val pendingEntry = Pending(
            transferId = transferId,
            name = entry.name,
            mime = entry.mime,
            size = entry.size,
            sessionId = sessionId,
            sha256 = sha,
            open = { store.openStream(entry.id) },
        )
        pending[transferId] = pendingEntry
        LinkLog.i(
            "bulk",
            "fs.transfer.begin registered $transferId → ${entry.name}, ${entry.size} bytes, " +
                "sha256=${sha?.take(12)?.plus("…") ?: "null (not pre-hashed)"}; ${pending.size} pending",
        )
        return pendingEntry
    }

    /**
     * The whole-file digest, or null when the file is too big to hash inside an ack.
     *
     * Both outcomes are logged at the same volume with the size and the elapsed time beside them,
     * per the counter rule: "12 unhashed" with no hashed count and no denominator of bytes reads as
     * whichever story the reader already believes.
     */
    private fun prehash(store: FsStore, entry: FsPaths.Entry): String? {
        if (entry.size > PREHASH_MAX_BYTES) {
            LinkLog.i(
                "bulk",
                "not pre-hashing ${entry.name}: ${entry.size} bytes is over the ${PREHASH_MAX_BYTES} " +
                    "byte ceiling, so the ack carries sha256=null and the transfer will report " +
                    "verified=false",
            )
            return null
        }
        val startedAt = System.currentTimeMillis()
        val digest = MessageDigest.getInstance("SHA-256")
        val read = runCatching {
            store.openStream(entry.id)?.use { input ->
                val buffer = ByteArray(CHUNK)
                var total = 0L
                while (true) {
                    val n = input.read(buffer)
                    if (n <= 0) break
                    digest.update(buffer, 0, n)
                    total += n
                }
                total
            }
        }.getOrElse {
            LinkLog.w("bulk", "pre-hash of ${entry.name} failed; the ack will carry sha256=null", it)
            null
        } ?: return null

        val sha = digest.digest().joinToString("") { "%02x".format(it) }
        val elapsed = System.currentTimeMillis() - startedAt
        LinkLog.i(
            "bulk",
            "pre-hashed ${entry.name}: $read bytes in ${elapsed}ms (${rateOf(read, elapsed)}), " +
                "sha256=${sha.take(12)}… — this is what makes verified=true possible",
        )
        return sha
    }

    /**
     * Flips one byte of the outgoing stream at this absolute offset. **A probe hook, ships disarmed.**
     *
     * The checksum-mismatch branch has never run in this project — `media.original` acks
     * `sha256: null`, so nothing was ever compared — and it cannot be run without corruption that
     * the digest does **not** see. So the byte is flipped *after* the digest has taken the true
     * bytes, which is exactly what a corrupt link does: the sender's digest is right, the receiver's
     * is not, and the disagreement is the finding.
     *
     * It is here rather than in a standalone tool for the reason `BulkClient.interruptAfterBytes` is
     * in `bulk.ts`: a second client speaking the protocol itself would differ from the shipping one
     * somewhere, and that difference is where this class of bug lives. **The stimulus is injected;
     * the mechanism under test stays the product's.**
     *
     * Nothing in `src/main` assigns it. `app/src/debug/…/FsProbeActivity` is the only writer, AGP
     * merges that source set into debug variants only, and every arming writes an `E` line — a hook
     * that could be on without saying so is a build that reports corruption nobody caused.
     */
    @Volatile
    var debugCorruptAtByte: Long? = null

    /**
     * Stops a transfer, whether it has been claimed by a socket yet or not.
     *
     * Both states have to be handled and they are genuinely different: an unclaimed transfer is a
     * row in [pending] with no socket, and a live one is a thread inside [streamTo]. Answering
     * `stopped: true` for the first and forgetting the second would leave a cancelled transfer
     * still sending.
     */
    fun cancel(transferId: String, reason: String): Boolean {
        val wasPending = pending.remove(transferId) != null
        cancelled.add(transferId)
        LinkLog.i(
            "bulk",
            "fs.transfer.cancel $transferId (reason=$reason): " +
                (if (wasPending) "it had not been claimed by a socket yet" else "flagged for the live stream") +
                "; ${pending.size} pending",
        )
        return true
    }

    fun chunkMax(): Int = CHUNK

    /** Drops everything a dead session authorised. See [Pending]. */
    fun forgetSession(sessionId: String) {
        val dropped = pending.entries.filter { it.value.sessionId == sessionId }
        dropped.forEach { pending.remove(it.key) }
        // An unclaimed push is dropped too, and its partial is **kept**: the bytes on disk are a
        // resumable artifact and the record beside them is what a later attempt looks up. Deleting
        // here would turn every dropped session into a restart from zero.
        val abandoned = incoming.entries.filter { it.value.sessionId == sessionId }
        abandoned.forEach { incoming.remove(it.key)?.partial?.keep() }
        if (dropped.isNotEmpty() || abandoned.isNotEmpty()) {
            LinkLog.i(
                "bulk",
                "session ended: dropped ${dropped.size} unclaimed pull(s) and " +
                    "${abandoned.size} unclaimed push(es); partials kept",
            )
        }
    }

    /**
     * Serves one bulk socket, start to finish, on the thread the accept loop hands over.
     *
     * The stream from [AuthenticatedChannel] is the same one the token was read from and must not be
     * re-wrapped — the header frame is very likely already sitting in that buffer.
     */
    fun serve(channel: AuthenticatedChannel) {
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

        val arriving = transferId?.let { incoming.remove(it) }
        if (arriving != null) {
            receiveFrom(channel, framing, arriving)
            return
        }

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

        streamTo(channel, framing, entry, offset)
    }

    /**
     * Agrees a push and returns what the ack must carry, or null when the destination is unusable.
     *
     * ### The resume offset is decided here, from the record and never from the filename
     *
     * `docs/protocol.md`: *anything that decides to append to, delete or overwrite consults the
     * transfer record, not the filename.* A granted tree is `DCIM` or `Documents`, shared with every
     * downloader on the device, and all of them write `.part` files. Resuming from an unrecorded
     * partial would mean **appending our bytes to a stranger's half-finished download and then
     * renaming the result over their file** — so [FsPartials.resumeFrom] refuses without a record
     * and the refusal is logged with its reason.
     */
    fun registerFsPush(
        context: Context,
        store: FsStore,
        segments: List<String>,
        name: String,
        size: Long,
        sha256: String?,
        sessionId: String,
    ): Incoming? {
        val partial = store.openPartial(segments, name) ?: return null
        val recordPath = "${store.rootId}/${FsPaths.joinPath(segments)}"
        val recorded = runBlocking {
            runCatching {
                ConnectSuiteDatabase.get(context).transferDao().findIncomingAt(recordPath, name)
            }.getOrNull()
        }
        // Passed straight through, not `takeIf { it > 0 }`. `openPartial` always leaves a partial,
        // so an empty one is "the partial is empty" and never "there is no partial file" — two
        // reasons that exist precisely to be told apart in the log, and collapsing them once
        // already made a zero-byte resume read as a missing file.
        val decision = FsPartials.resumeFrom(
            partBytes = partial.bytesOnDisk,
            recordedBytes = recorded?.bytesTransferred,
            totalBytes = size,
        )
        val offset = when (decision) {
            is FsPartials.Resume.FromOffset -> decision.offset
            is FsPartials.Resume.FromZero -> {
                // Logged with the reason on the line, because "starting from zero" and "resuming"
                // are indistinguishable in a byte count and the reason is what tells a stranger's
                // partial from our own.
                LinkLog.i(
                    "bulk",
                    "push of $name into ${store.rootId} starts at 0: ${decision.why}",
                )
                0L
            }
        }

        val transferId = nextId()
        val now = System.currentTimeMillis()
        runBlocking {
            runCatching {
                ConnectSuiteDatabase.get(context).transferDao().upsert(
                    TransferEntity(
                        transferId = transferId,
                        jobId = sessionId,
                        peerDeviceId = sessionId,
                        direction = TransferDirection.INCOMING,
                        fileName = name,
                        relativePath = recordPath,
                        mimeType = "application/octet-stream",
                        totalBytes = size,
                        bytesTransferred = offset,
                        status = TransferStatus.PENDING,
                        checksum = sha256,
                        localUri = null,
                        startedAtMillis = now,
                        updatedAtMillis = now,
                    ),
                )
            }.onFailure {
                // A push with no row is a push that cannot resume. It is allowed to proceed — losing
                // resume is better than refusing the transfer — and the loss is said out loud rather
                // than discovered later as "resume does not work".
                LinkLog.w("bulk", "push $transferId has no record; it will not be resumable", it)
            }
        }

        val entry = Incoming(
            transferId = transferId,
            name = name,
            size = size,
            sessionId = sessionId,
            sha256 = sha256,
            offset = offset,
            partial = partial,
            recordPath = recordPath,
            rootLabel = store.label,
            context = context.applicationContext,
        )
        incoming[transferId] = entry
        return entry
    }

    /**
     * Receives one push, start to finish.
     *
     * The mirror of [streamTo], and the digest rule is the same one from the other side: **it covers
     * the whole file, not the part that moved.** On a resume the bytes already on disk are read back
     * and fed through the digest before the first arriving chunk, because the digest the Mac agreed
     * is over the whole file — a digest that started at the offset would report `CHECKSUM_MISMATCH`
     * on a byte-perfect file and then delete the partial the phone already held.
     */
    private fun receiveFrom(channel: AuthenticatedChannel, framing: BulkFraming, entry: Incoming) {
        val startedAt = System.currentTimeMillis()
        var received = 0L
        var lastReport = 0L
        var lastRecord = 0L
        val digest = MessageDigest.getInstance("SHA-256")
        val context = entry.context

        try {
            if (entry.offset > 0) {
                digestExistingPartial(entry, digest)
                LinkLog.i(
                    "bulk",
                    "${entry.transferId} resuming at ${entry.offset} of ${entry.size}; the digest " +
                        "covers the bytes already on disk",
                )
            }

            val out = entry.partial.append()
                ?: throw IllegalStateException("the partial could not be opened for append")
            out.use { sink ->
                while (true) {
                    if (entry.transferId in cancelled) {
                        cancelled.remove(entry.transferId)
                        throw java.io.InterruptedIOException(
                            "cancelled by the Mac after $received bytes",
                        )
                    }
                    val chunk = framing.readChunk() ?: break
                    if (chunk.isEmpty()) continue
                    sink.write(chunk)
                    digest.update(chunk, 0, chunk.size)
                    received += chunk.size

                    val now = System.currentTimeMillis()
                    if (now - lastReport >= PROGRESS_INTERVAL_MS) {
                        lastReport = now
                        reportIncoming(channel, entry, entry.offset + received, startedAt)
                    }
                    // The record is what a later attempt resumes from, so it is written as the bytes
                    // land rather than at the end. A row updated only on success would make every
                    // interruption — the one case resume exists for — restart from zero.
                    if (now - lastRecord >= 1_000) {
                        lastRecord = now
                        updateRecord(context, entry, entry.offset + received, TransferStatus.RUNNING)
                    }
                }
                sink.flush()
            }

            val total = entry.offset + received
            val elapsed = System.currentTimeMillis() - startedAt
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            val expected = entry.sha256

            // **Defect 56 — the most serious thing found in Phase 5, and this is the line that
            // catches it.** A stream that ended early is an interruption, not a completion, and
            // when the Mac agreed no digest there is nothing else that knows: the length agreed on
            // the control channel is the only witness. Above the 64 MB pre-hash ceiling *every*
            // push agrees no digest, so this was the ordinary large-file path, not an edge.
            //
            // The decision is [FsPartials.arrivalVerdict]'s and not this function's, because the
            // original defect was exactly this branch deciding for itself where no test could
            // reach it. `FsArrivalTest` owns the rule, including the ordering — length before
            // digest — that keeps a truncated arrival resumable instead of destroying it as
            // corrupt.
            val verdict = FsPartials.arrivalVerdict(
                received = total,
                agreed = entry.size,
                expectedSha = expected,
                actualSha = sha,
            )

            // The partial is KEPT and the record holds what arrived, which is what makes the next
            // attempt resume rather than restart.
            if (verdict is FsPartials.Arrival.Short) {
                failed.incrementAndGet()
                entry.partial.keep()
                updateRecord(context, entry, total, TransferStatus.PAUSED)
                LinkLog.w(
                    "bulk",
                    "${entry.transferId} ${entry.name} ended early: $total of ${entry.size} bytes. " +
                        "The partial is kept and the next attempt resumes from it — ${tally()}",
                )
                sendDone(channel, entry.transferId) {
                    put("ok", false)
                    put("code", ErrorCode.TRANSFER_FAILED)
                    put(
                        "message",
                        "${entry.name} stopped after $total of ${entry.size} bytes and can be " +
                            "resumed.",
                    )
                    put("bytes", total)
                    put("elapsedMs", elapsed)
                    put("verified", false)
                }
                return
            }
            if (verdict is FsPartials.Arrival.Overrun) {
                // More than was agreed. The digest would catch it when one exists, and nothing would
                // when it does not — so it is caught here, and the bytes go rather than being
                // committed at the final name.
                failed.incrementAndGet()
                entry.partial.discardAsFailed(
                    FsPartials.sidecarText(
                        name = entry.name,
                        whenIso = nowIso(),
                        bytes = total,
                        expected = "${entry.size} bytes",
                        actual = "$total bytes",
                    ),
                )
                updateRecord(context, entry, 0L, TransferStatus.FAILED)
                LinkLog.e(
                    "bulk",
                    "${entry.transferId} ${entry.name} overran: $total bytes where ${entry.size} " +
                        "were agreed. The partial was deleted — ${tally()}",
                )
                sendDone(channel, entry.transferId) {
                    put("ok", false)
                    put("code", ErrorCode.TRANSFER_FAILED)
                    put("message", "${entry.name} sent more bytes than were agreed, so it was discarded.")
                    put("bytes", total)
                    put("elapsedMs", elapsed)
                    put("verified", false)
                }
                return
            }

            if (verdict is FsPartials.Arrival.Corrupt) {
                failed.incrementAndGet()
                entry.partial.discardAsFailed(
                    FsPartials.sidecarText(
                        name = entry.name,
                        whenIso = nowIso(),
                        bytes = total,
                        expected = verdict.expected,
                        actual = verdict.actual,
                    ),
                )
                updateRecord(context, entry, 0L, TransferStatus.FAILED)
                LinkLog.e(
                    "bulk",
                    "${entry.transferId} ${entry.name} arrived corrupt: agreed " +
                        "${verdict.expected.take(12)}…, " +
                        "received ${sha.take(12)}… over $total bytes. The partial was deleted and a " +
                        "${FsPartials.failedNameFor(entry.name)} note left in its place — ${tally()}",
                )
                sendDone(channel, entry.transferId) {
                    put("ok", false)
                    put("code", ErrorCode.CHECKSUM_MISMATCH)
                    put(
                        "message",
                        "${entry.name} arrived on the phone with the wrong contents, so it was " +
                            "deleted. Sending it again starts from zero.",
                    )
                    put("bytes", total)
                    put("elapsedMs", elapsed)
                    put("verified", false)
                    put("sha256", sha)
                }
                return
            }

            val finished = entry.partial.commit()
            if (finished == null) {
                failed.incrementAndGet()
                updateRecord(context, entry, total, TransferStatus.FAILED)
                LinkLog.e(
                    "bulk",
                    "${entry.transferId} received all $total bytes and could not rename the partial " +
                        "to ${entry.name}; the partial is kept — ${tally()}",
                )
                sendDone(channel, entry.transferId) {
                    put("ok", false)
                    put("code", ErrorCode.TRANSFER_FAILED)
                    put(
                        "message",
                        "${entry.name} arrived but the phone could not put it in place. The partial " +
                            "is still there and sending again will resume.",
                    )
                    put("bytes", total)
                    put("elapsedMs", elapsed)
                    put("verified", false)
                }
                return
            }

            // Everything below is the one remaining verdict, and it is read off the verdict rather
            // than recomputed: `verified` is the difference between "the bytes were checked" and
            // "nobody looked", and deriving it a second time here is how the two answers drift.
            val verified = (verdict as FsPartials.Arrival.Complete).verified
            completed.incrementAndGet()
            updateRecord(context, entry, total, TransferStatus.COMPLETED)
            reportIncoming(channel, entry, total, startedAt)
            sendDone(channel, entry.transferId) {
                put("ok", true)
                put("bytes", total)
                put("elapsedMs", elapsed)
                put("verified", verified)
                put("sha256", sha)
            }
            LinkLog.i(
                "bulk",
                "${entry.transferId} received ${entry.name} into ${entry.rootLabel}: $total bytes " +
                    "in ${elapsed}ms (${rateOf(received, elapsed)}), sha256=${sha.take(12)}…, " +
                    "verified=$verified " +
                    (if (verified) "(agreed in advance and matched)" else "(nothing was agreed in advance)") +
                    " — ${tally()}; ${framing.tally.summary()}",
            )
            // Only here, after the Complete verdict: a stopped, short, overrun or corrupt arrival
            // is not "received", and the notification must never say it was.
            ReceivedFileNotifications.arrived(
                context = context,
                name = entry.name,
                sizeBytes = total,
                folderLabel = entry.rootLabel,
                peerName = channel.session.peerName,
                verified = verified,
            )
        } catch (e: Exception) {
            failed.incrementAndGet()
            val total = entry.offset + received
            val elapsed = System.currentTimeMillis() - startedAt
            // The partial is KEPT. An interrupted push is a resumable artifact and the record beside
            // it is what the next attempt looks up — the opposite of the checksum path above, and
            // the difference is the whole reason both exist.
            entry.partial.keep()
            updateRecord(context, entry, total, TransferStatus.PAUSED)
            LinkLog.e(
                "bulk",
                "${entry.transferId} stopped after $received bytes ($total of ${entry.size}) in " +
                    "${elapsed}ms; the partial is kept and is resumable — ${tally()}; " +
                    framing.tally.summary(),
                e,
            )
            runCatching {
                sendDone(channel, entry.transferId) {
                    put("ok", false)
                    put("code", ErrorCode.TRANSFER_FAILED)
                    put("message", "${entry.name} stopped after $total bytes and can be resumed.")
                    put("bytes", total)
                    put("elapsedMs", elapsed)
                    put("verified", false)
                }
            }
        } finally {
            channel.close()
        }
    }

    /**
     * Feeds the bytes already on disk through [digest] before the first arriving chunk.
     *
     * The receive-side twin of [digestSkipped]. It reads the partial back rather than trusting the
     * recorded length, because the digest must cover the bytes that are **actually there**.
     */
    private fun digestExistingPartial(entry: Incoming, digest: MessageDigest) {
        val stream = entry.partial.read()
            ?: throw IllegalStateException("the partial could not be read back for the digest")
        stream.use { input ->
            val buffer = ByteArray(CHUNK)
            var covered = 0L
            while (covered < entry.offset) {
                val want = minOf(CHUNK.toLong(), entry.offset - covered).toInt()
                val read = input.read(buffer, 0, want)
                if (read <= 0) break
                digest.update(buffer, 0, read)
                covered += read
            }
            if (covered != entry.offset) {
                throw IllegalStateException(
                    "the partial holds $covered bytes where the resume offset says ${entry.offset}",
                )
            }
        }
    }

    private fun nowIso(): String = java.text.SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        java.util.Locale.US,
    ).format(java.util.Date())

    private fun updateRecord(
        context: Context,
        entry: Incoming,
        bytes: Long,
        status: TransferStatus,
    ) {
        runBlocking {
            runCatching {
                val dao = ConnectSuiteDatabase.get(context).transferDao()
                dao.updateProgress(entry.transferId, bytes, System.currentTimeMillis())
                dao.updateStatus(entry.transferId, status, null, System.currentTimeMillis())
            }.onFailure { LinkLog.w("bulk", "${entry.transferId} record update failed", it) }
        }
    }

    private fun reportIncoming(
        channel: AuthenticatedChannel,
        entry: Incoming,
        bytes: Long,
        startedAt: Long,
    ) {
        val elapsed = (System.currentTimeMillis() - startedAt).coerceAtLeast(1)
        channel.session.send(
            Envelope(
                type = MessageType.FS_TRANSFER_PROGRESS,
                payload = buildJsonObject {
                    put("transferId", entry.transferId)
                    put("bytes", bytes)
                    put("total", entry.size)
                    put("bytesPerSecond", (bytes - entry.offset) * 1000 / elapsed)
                },
            ),
        )
    }

    private fun sendDone(
        channel: AuthenticatedChannel,
        transferId: String,
        body: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        channel.session.send(
            Envelope(
                type = MessageType.FS_TRANSFER_DONE,
                payload = buildJsonObject {
                    put("transferId", transferId)
                    body()
                },
            ),
        )
    }

    private fun streamTo(
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
            entry.open().use { input ->
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
                    if (entry.transferId in cancelled) {
                        cancelled.remove(entry.transferId)
                        throw java.io.InterruptedIOException(
                            "cancelled by the Mac after $sent of ${entry.size} bytes",
                        )
                    }
                    val read = input.read(buffer)
                    if (read <= 0) break
                    val chunk = if (read == buffer.size) buffer else buffer.copyOf(read)
                    // The digest takes the TRUE bytes first. Anything the probe does below is
                    // invisible to it, which is the point: a corrupt link leaves the sender's
                    // digest correct and the receiver's wrong, and that disagreement is the thing
                    // `CHECKSUM_MISMATCH` exists to report.
                    digest.update(chunk, 0, read)
                    corruptIfArmed(entry, chunk, offset + sent)
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

            // The phone's own verdict, and it is a real check rather than a formality: the digest
            // was agreed before a byte moved, and this one covers the whole file including any
            // bytes skipped by a resume. They disagree when the file changed under the read — or
            // when a resumed digest started in the wrong place, which is the failure that reports
            // corruption on a perfect file and then deletes it.
            val expected = entry.sha256
            if (expected != null && expected != sha) {
                failed.incrementAndGet()
                LinkLog.e(
                    "bulk",
                    "${entry.transferId} the file changed while it was being sent: agreed " +
                        "${expected.take(12)}…, read ${sha.take(12)}… over ${offset + sent} bytes — " +
                        "${tally()}",
                )
                channel.session.send(
                    Envelope(
                        type = MessageType.FS_TRANSFER_DONE,
                        payload = buildJsonObject {
                            put("transferId", entry.transferId)
                            put("ok", false)
                            put("code", ErrorCode.CHECKSUM_MISMATCH)
                            put(
                                "message",
                                "${entry.name} changed on the phone while it was being sent, so " +
                                    "what arrived does not match what was agreed.",
                            )
                            put("bytes", offset + sent)
                            put("elapsedMs", elapsed)
                            put("verified", false)
                            put("sha256", sha)
                        },
                    ),
                )
                return
            }
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
                        // True only when a digest was agreed **before** the transfer and the one
                        // computed while streaming matches it. `media.original` acks
                        // `sha256: null`, so it still reports false; `fs.transfer.begin` pre-hashes
                        // and is the first thing in this project that can report true.
                        //
                        // A separate field from `ok` precisely so a success nobody checked cannot
                        // look like a success that was.
                        put("verified", expected != null)
                        put("sha256", sha)
                    },
                ),
            )
            LinkLog.i(
                "bulk",
                "${entry.transferId} sent ${offset + sent} of ${entry.size} bytes in ${elapsed}ms " +
                    "(${rateOf(sent, elapsed)}), sha256=${sha.take(12)}…, " +
                    "verified=${expected != null} " +
                    (if (expected != null) "(agreed in advance and matched)" else "(nothing was agreed in advance)") +
                    " — " +
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

    /**
     * Flips one byte if the probe hook is armed for this transfer. See [debugCorruptAtByte].
     *
     * Refuses silently for no offset, and shouts when it does act — an `E` line naming the transfer
     * and the offset, so a `CHECKSUM_MISMATCH` in a log can always be traced to whether somebody
     * asked for it.
     */
    private fun corruptIfArmed(entry: Pending, chunk: ByteArray, absoluteStart: Long) {
        val at = debugCorruptAtByte ?: return
        if (at < absoluteStart || at >= absoluteStart + chunk.size) return
        val index = (at - absoluteStart).toInt()
        val was = chunk[index]
        chunk[index] = (was.toInt() xor 0xFF).toByte()
        debugCorruptAtByte = null
        LinkLog.e(
            "bulk",
            "PROBE: ${entry.transferId} byte $at deliberately flipped from $was to ${chunk[index]} " +
                "AFTER the digest took the true value. The receiver must report CHECKSUM_MISMATCH, " +
                "delete its partial and write a .failed sidecar. Nothing in a release build can " +
                "reach this line.",
        )
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
