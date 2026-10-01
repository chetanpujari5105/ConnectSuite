package com.chetan.connectsuite.sync.v2

/**
 * What a source's own file says about itself, read with `fstat` from a descriptor the provider opened —
 * never from a path. [dev] and [ino] identify *which* file a descriptor reaches, so a reading handle and a
 * fresh lookup by id can be compared for identity, not only for size and time.
 */
data class SourceStamp(val size: Long, val mtimeMs: Long, val dev: Long, val ino: Long)

/**
 * Defect 166 — **a block pull's size and last-modified came from the index, and the index can be stale.**
 *
 * Measured on hardware (SM-S938B, 2026-10-01 23:15): `dd conv=notrunc` by the shell through `/sdcard`
 * changed a source's bytes and its file mtime, and MediaStore's `DATE_MODIFIED` — which
 * `DownloadsStore.statById` reads, and so the product's `fs.stat`, the pull's ack and the resume check —
 * still read the old value 140 s later. A resume of that file was accepted on metadata and stopped only
 * by the prefix re-hash.
 *
 * The rule here: **the file's own metadata, when the provider can give it, and the index only when it
 * cannot.** It is used for a block pull's ack, its resume decision and the sender's checks before the
 * first byte and after the last, so all four read one value. Nothing here touches what `statById` means
 * elsewhere: the Mac's delete guard compares the listed (indexed) value, and that is left alone.
 *
 * **What this is not.** It is a metadata check, not a guarantee that the source did not change: a write
 * that keeps the size and restores the mtime is invisible to it. The phone's re-hash of a resumed prefix
 * still catches any such change *inside* the prefix; a change *outside* it is simply fetched (the resumed
 * suffix is read from the file as it is now, so the result is the current file, whole). A provider that
 * gives no descriptor metadata — a cloud provider's pipe — falls back to its index, and [Basis.INDEXED]
 * says so, so nobody reads the check as stronger than it was.
 */
object SourceStability {

    /** Which metadata a reading came from — the strength of the check, said in the log. */
    enum class Basis { LIVE_HANDLE, LIVE_BY_ID, INDEXED }

    /**
     * One reading. [stamp] is `size to mtimeMs`, or null when the source cannot be shown to be the same
     * file it was: gone by its id, or replaced under the descriptor being read. A null stamp never equals
     * an agreed one, so the sender ends the pull as `SOURCE_CHANGED`.
     */
    data class Reading(val stamp: Pair<Long, Long>?, val basis: Basis, val why: String)

    /**
     * A fresh look at the source by its id. Three answers, kept apart on purpose: a cloud provider's
     * descriptor is a pipe with no file metadata, and calling that "gone" would refuse every pull from it.
     */
    sealed interface ById {
        data class Stamp(val stamp: SourceStamp) : ById
        /** The provider opened it but gives no file metadata (not a regular file): fall back to its index. */
        data object Unavailable : ById
        /** It does not open by its id any more. */
        data object Gone : ById
    }

    /**
     * @param indexed the provider's indexed size and last-modified (`statById`), or null when the id is gone
     * @param handle the descriptor being read, `fstat`ed; null before the read opens, or when not a regular file
     * @param byId a fresh look by id
     */
    fun read(indexed: Pair<Long, Long>?, handle: SourceStamp?, byId: ById): Reading {
        if (byId is ById.Gone) return Reading(null, Basis.LIVE_BY_ID, "the source no longer opens by its id")
        val fresh = (byId as? ById.Stamp)?.stamp
        if (handle != null && fresh != null && (handle.dev != fresh.dev || handle.ino != fresh.ino)) {
            return Reading(null, Basis.LIVE_HANDLE, "the id now reaches a different file than the one being read (replaced)")
        }
        handle?.let { return Reading(it.size to it.mtimeMs, Basis.LIVE_HANDLE, "the file's own metadata, from the descriptor being read") }
        fresh?.let { return Reading(it.size to it.mtimeMs, Basis.LIVE_BY_ID, "the file's own metadata, from a descriptor opened by id") }
        return Reading(indexed, Basis.INDEXED, "the provider's index only — a change it has not indexed is not seen by this check")
    }

    /**
     * What a block pull agrees at `fs.transfer.begin`: [indexed] with the file's own size and time when the
     * store can give them. Null entry when the source cannot be shown to be there. `FsFeature` calls this.
     */
    fun atBegin(store: FsStore, indexed: FsPaths.Entry): Pair<FsPaths.Entry?, Reading> {
        val reading = read(indexed.size to indexed.mtimeMs, handle = null, byId = store.liveStamp(indexed.id))
        return reading.stamp?.let { indexed.copy(size = it.first, mtimeMs = it.second) } to reading
    }

    /** The sender's re-check before the first byte and after the last, given the descriptor being read. */
    fun recheck(store: FsStore, id: String, handle: SourceStamp?): Pair<Long, Long>? =
        read(store.statById(id)?.let { it.size to it.mtimeMs }, handle, store.liveStamp(id)).stamp
}
