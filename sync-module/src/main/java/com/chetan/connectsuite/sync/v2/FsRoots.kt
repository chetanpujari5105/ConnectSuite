package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.chetan.connectsuite.core.link.LinkLog

/**
 * Every root `fs.*` can address, read from the only thing that actually holds them.
 *
 * ### There is no Room table of folders, on purpose
 *
 * The granted trees come from `contentResolver.persistedUriPermissions`. Android already holds that
 * list, carries it across reboots and process death, and is the only thing that can revoke it. A
 * Room mirror would be a second copy of a fact the platform owns, free to disagree with it the first
 * time a user clears app data or the OS drops a grant — and the screen would then offer a folder
 * `fs.list` cannot open. One home for the rule.
 *
 * The consequence is that `rootId` is *derived* from the tree URI rather than assigned by us, so it
 * is stable across sessions without anything storing it. `saf:primary%3ADCIM` **is** the grant.
 *
 * **Not to be confused with the transfer records**, which do live in Room. Those are our own state
 * about a copy in progress, not a fact the platform holds — and §4 of the payload spec is explicit
 * that the Room row is authoritative for resume precisely *because* the filesystem is not ours.
 */
object FsRoots {

    /**
     * The sentence sent when more could be granted. Not parsed — the same standing the capability
     * `unavailable` strings have.
     *
     * Under SAF this is almost always present, because there is always another folder that has not
     * been granted. That is the honest state of this design rather than a defect in it.
     */
    const val GRANT_HINT =
        "Add a folder in Sidekick on the phone, under Sync › Folders, to browse more of it"

    /**
     * Free bytes on the shared volume, via the app's own directory on it.
     *
     * `Environment.getExternalStorageDirectory()` is the obvious call and is deprecated at the API
     * level this app targets; `getExternalFilesDir` is on the same volume and is not.
     */
    fun sharedVolumeFreeBytes(context: Context): Long {
        val dir = context.getExternalFilesDir(null) ?: context.filesDir
        return SafTreeStore.freeBytesAt(dir.absolutePath)
    }

    /** Every persisted tree grant, read fresh. Nothing caches this; a revoke must take effect at once. */
    fun grantedTrees(context: Context): List<Uri> =
        context.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission }
            .map { it.uri }
            .filter { runCatching { DocumentsContract.getTreeDocumentId(it) }.isSuccess }

    /**
     * Every root, the two that need no grant first.
     *
     * **Two roots exist on every phone**, before anything is granted: `Received files`
     * ([DownloadsStore]) and the app's own folder ([AppFilesStore]). Anything counting roots to
     * decide whether the user has shared anything must count `kind == "tree"`, not the list length —
     * the Mac's Files pane learned that the hard way when its `Download` wall was gated on
     * `roots.length <= 1` and stopped drawing the moment a second grant-free root existed.
     *
     * A grant that no longer resolves is **kept in the list**, because dropping it silently is an
     * absence the user cannot act on — the folder row is the only place they can remove it.
     */
    fun all(context: Context): List<FsStore> = buildList {
        // Ordered by what a user is most likely to want. `Received files` is where the Mac's own
        // pushes land and needs no grant, so it leads; the app-private root is the fallback beneath
        // everything and is a poor destination by design.
        add(DownloadsStore(context))
        add(AppFilesStore(context))
        grantedTrees(context).forEach { uri ->
            val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
                ?: return@forEach
            val writable = context.contentResolver.persistedUriPermissions
                .any { it.uri == uri && it.isWritePermission }
            add(
                SafTreeStore(
                    context = context,
                    treeUri = uri,
                    label = FsPaths.labelForTreeDocumentId(documentId),
                    writable = writable,
                ),
            )
        }
    }

    /**
     * The granted folders as the Folders screen shows them: breadcrumb, access, and whether the
     * grant still resolves.
     *
     * Lives here rather than in the view model so that `persistedUriPermissions` is named in exactly
     * one file in the tree — the property `FsRootsSingleSourceTest` pins. A second reader would be a
     * second copy of a fact the platform owns, which is the thing this object exists to prevent.
     */
    fun grantedFolders(context: Context): List<GrantedFolder> =
        context.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission }
            .mapNotNull { permission ->
                val uri = permission.uri
                val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }
                    .getOrNull() ?: return@mapNotNull null
                GrantedFolder(
                    treeUri = uri,
                    rootId = FsPaths.rootIdForTree(documentId),
                    label = FsPaths.labelForTreeDocumentId(documentId),
                    writable = permission.isWritePermission,
                    resolves = treeResolves(context, uri, documentId),
                )
            }

    /** One granted tree, in the vocabulary the screen reads rather than the wire's. */
    data class GrantedFolder(
        val treeUri: Uri,
        val rootId: String,
        val label: String,
        val writable: Boolean,
        val resolves: Boolean,
    )

    /**
     * Whether the tree behind a grant still exists.
     *
     * A grant outlives its folder: `persistedUriPermissions` keeps naming a tree the user deleted,
     * and `fs.list` on it fails at the moment the Mac asks. Asking here costs one cursor per folder
     * on a screen the user opened deliberately, and it is the difference between a row that says
     * *this folder is gone* and a row that lies quietly until someone clicks it.
     *
     * **A query that throws is "gone"; a query that returns no row is also "gone".** Both are
     * checked, because a `DocumentsProvider` is free to do either and the two look identical to a
     * caller that only wraps the call in `runCatching`.
     */
    private fun treeResolves(context: Context, treeUri: Uri, documentId: String): Boolean =
        runCatching {
            val self = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
            context.contentResolver.query(
                self,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
                null,
                null,
                null,
            )?.use { it.moveToFirst() } ?: false
        }.getOrElse { false }

    /** The store for [rootId], or null when the Mac named a root this phone has not been granted. */
    fun find(context: Context, rootId: String): FsStore? =
        all(context).firstOrNull { it.rootId == rootId }

    /**
     * The picker intent for the Folders screen.
     *
     * **The storage root and `Download` itself are refused by DocumentsUI**, observed on this
     * handset through our own package — `docs/phase-5-fs-media-proposal.md` §1, with the four
     * readings and their control. The refusal is a *disabled confirm button with a sentence in the
     * picker*, not an error we can catch, so there is nothing to handle here: the user simply cannot
     * complete the pick, and the app must have said why before they tried.
     */
    fun pickerIntent(initial: Uri? = null): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
            if (initial != null) putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial)
        }

    /** Persists a grant the picker returned. Returns the new root id, or null when it did not take. */
    fun persist(context: Context, treeUri: Uri): String? = runCatching {
        context.contentResolver.takePersistableUriPermission(
            treeUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        val rootId = FsPaths.rootIdForTree(DocumentsContract.getTreeDocumentId(treeUri))
        LinkLog.i("fs", "granted tree $rootId; ${grantedTrees(context).size} folder(s) now shared")
        rootId
    }.getOrElse {
        LinkLog.w("fs", "a tree grant did not persist", it)
        null
    }

    /** Gives a folder back. Removes the Mac's access; deletes nothing. */
    fun release(context: Context, treeUri: Uri) {
        runCatching {
            context.contentResolver.releasePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            LinkLog.i("fs", "released a tree; ${grantedTrees(context).size} folder(s) still shared")
        }.onFailure { LinkLog.w("fs", "a tree could not be released", it) }
    }
}
