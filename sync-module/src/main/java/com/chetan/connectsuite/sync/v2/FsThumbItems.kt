package com.chetan.connectsuite.sync.v2

/** One `fs.thumb` item's answer, before it is framed for the wire. */
sealed interface FsThumbItem {
    data class Made(val thumb: FsThumbs.Thumb) : FsThumbItem
    /** The file is there and has no thumbnail — the ordinary answer for most files. `NO_THUMBNAIL`. */
    data object None : FsThumbItem
    /** No such entry in this root. `NOT_FOUND`. */
    data object Gone : FsThumbItem
    /** The id cannot belong to this root; the provider was not asked. `BAD_REQUEST` (defect 208). */
    data object NotInRoot : FsThumbItem
}

/**
 * The per-item decision of `fs.thumb`, out of [FsFeature] so a JVM test can call it (`FsThumbRootTest`).
 */
object FsThumbItems {
    fun answer(
        store: FsStore,
        id: String,
        maxEdge: Int,
        onDecodeFailure: (FsPaths.Entry, Throwable) -> Unit,
    ): FsThumbItem {
        // Before the provider: an id that cannot be this root's is the caller's mistake, not a missing file.
        if (store.ownsId(id) == false) return FsThumbItem.NotInRoot
        val entry = store.statById(id) ?: return FsThumbItem.Gone
        if (entry.dir) return FsThumbItem.None
        val thumb = runCatching { store.thumbnail(id, maxEdge) }.getOrElse {
            onDecodeFailure(entry, it)
            null
        } ?: return FsThumbItem.None
        return FsThumbItem.Made(thumb)
    }
}
