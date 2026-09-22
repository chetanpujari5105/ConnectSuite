package com.chetan.connectsuite.sync.ui.folders

import com.chetan.connectsuite.sync.v2.FsPaths

/**
 * The quick picks — one tap that opens the picker **already inside** a likely folder.
 *
 * ### These were refused once, and what changed is a reading rather than a preference
 *
 * `docs/phase-5-files-onboarding-proposal.md` §5 rejected chips outright, and it was right at the
 * time: *"a chip is a promise about where the picker opens, and this app cannot make that
 * promise."* With `EXTRA_INITIAL_URI` unset the picker **chooses** — observed four times on this
 * handset, three of them restoring its last location inside `DCIM` and the fourth landing at the
 * root of internal storage with the confirm button disabled. A chip labelled `Camera` would have
 * been right by coincidence and wrong by default.
 *
 * §8.3 named the reading that would settle it and it has now been taken —
 * `docs/testing.md` → Slice 9. Aimed at `Download/ConnectSuite` the picker opened **inside** that
 * folder with `USE THIS FOLDER` `enabled="true"`; aimed at `DCIM/Screenshots` it opened inside
 * `Screenshots`; unaimed, in the same session, it opened in `DCIM`. The extra is honoured, so the
 * promise can be kept, so the chips ship.
 *
 * ### The one constraint, and it comes from the third reading rather than from caution
 *
 * The phone **cannot check whether a folder exists** before aiming at it: that would need
 * `READ_EXTERNAL_STORAGE`, which is the permission this project has decided twice not to ask for,
 * and a `DocumentsProvider` query on an ungranted tree throws. So every chip is a guess about a
 * folder that may not be there, and what matters is how a wrong guess fails.
 *
 * Measured: aimed at `DCIM/NoSuchFolderXYZ`, which does not exist, the picker opened in **`DCIM`** —
 * the parent — with `USE THIS FOLDER` `enabled="true"`. A bad aim degrades to the parent, and a
 * grantable parent is a fine place to land.
 *
 * **Which makes exactly one thing forbidden: a chip may not point inside `Download`.** Its parent is
 * the one directory DocumentsUI refuses, so a missing `Download/Foo` would degrade precisely into
 * the wall §3.5 exists to keep users away from. That is not a style rule and it is enforced by
 * [isSafeTarget] with a test that shows it failing.
 *
 * ### There is deliberately no `Received files` chip
 *
 * §8.1 planned one, labelled *Received files* and shown once `Download/ConnectSuite` existed. It is
 * not here for two reasons, and the second is the disqualifying one: that folder is now a **root of
 * its own** (`downloads:connectsuite`) that needs no grant at all, so a tree grant over it would buy
 * nothing — and it is inside `Download`, which the rule above forbids.
 */
object FolderQuickPicks {

    /** The authority every one of these document ids belongs to. */
    const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    /** The directory DocumentsUI refuses, and therefore the one no chip may sit under. */
    const val FORBIDDEN_PARENT = "Download"

    /**
     * One chip: what it says, and where it aims.
     *
     * [documentId] is an `ACTION_OPEN_DOCUMENT_TREE` **document** id — `primary:DCIM/Camera` — not a
     * tree id and not a path. It is turned into a URI at the call site because that needs `Uri`,
     * which would drag Android into this object and out of a unit test's reach.
     */
    data class Pick(val label: String, val documentId: String) {
        /**
         * The `saf:` root id this pick would produce, so a chip already granted can be hidden.
         *
         * Through `FsPaths.rootIdForTree` — **the same function the wire uses**, not a second
         * encoder that happens to agree today. A tree granted through `ACTION_OPEN_DOCUMENT_TREE`
         * has [documentId] as its tree document id, so this is the id `fs.list` will report. Two
         * encoders that drift would produce a chip that never hides itself after being granted,
         * which reads as the chip not working.
         */
        val rootIdIfGranted: String get() = FsPaths.rootIdForTree(documentId)
    }

    /**
     * The chips, in the order they are drawn.
     *
     * Short, and staying short. Every chip is a guess about one person's phone, and a rail of ten
     * guesses is a worse experience than three good ones plus **Browse…**, which is always there and
     * is the only thing that can be right for everybody.
     */
    val ALL: List<Pick> = listOf(
        Pick("Camera", "primary:DCIM/Camera"),
        Pick("Screenshots", "primary:DCIM/Screenshots"),
        // Documents ("primary:Documents") and Pictures ("primary:Pictures") were here and were
        // removed by an explicit product decision on 2026-09-22, **not because they stopped
        // working**: both are safe targets and `EXTRA_INITIAL_URI` was measured honouring them on
        // this handset. The Folders screen shows Camera, Screenshots and Add folder. Restoring the
        // other two is putting those two lines back, and nothing else has to change.
    )

    /**
     * Whether a chip may aim at [documentId].
     *
     * False for `Download` and anything inside it, because a folder that turns out not to exist
     * degrades to its parent and that parent cannot be confirmed. Also false for the volume root
     * itself, which DocumentsUI refuses for the same reason.
     */
    fun isSafeTarget(documentId: String): Boolean {
        val path = documentId.substringAfter(':', missingDelimiterValue = "")
        if (path.isEmpty()) return false
        val head = path.substringBefore('/')
        return !head.equals(FORBIDDEN_PARENT, ignoreCase = true)
    }

    /** The chips that may be drawn: safe targets that are not already granted. */
    fun offered(grantedRootIds: Set<String>): List<Pick> =
        ALL.filter { isSafeTarget(it.documentId) && it.rootIdIfGranted !in grantedRootIds }

}
