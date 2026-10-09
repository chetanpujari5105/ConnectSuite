package com.chetan.connectsuite.sync.v2

/**
 * Defect 208: whether a document id can belong to a granted tree, decided from the id's own structure,
 * before any provider is asked.
 *
 * Only `ExternalStorageProvider` has a structure this app may rely on — `<volume>:<path>`, a child's id
 * being its tree's id plus `/` and a relative path (or, for a volume root `primary:`, the root plus a
 * path). Every other provider's ids are opaque, so for them the answer is null and the provider is asked
 * exactly as before. Pure, so `FsThumbRootTest` reaches it.
 */
object FsIdScope {
    const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    fun inTree(authority: String?, treeDocumentId: String, id: String): Boolean? {
        if (authority != EXTERNAL_STORAGE_AUTHORITY) return null
        if (id == treeDocumentId) return true
        val prefix = if (treeDocumentId.endsWith(":")) treeDocumentId else "$treeDocumentId/"
        return id.startsWith(prefix) && id.length > prefix.length
    }

    /**
     * The rule as the store must apply it: on the **wire** id, which is percent-encoded
     * (`primary%3ADCIM%2Fa.jpg`), decoded with the same [FsPaths.decodeId] the store uses to reach the
     * provider. The first version compared the encoded id with the raw tree id and refused every file in
     * every granted tree — found on hardware (2026-10-09, B9), invisible to tests that built raw ids.
     */
    fun wireIdInTree(authority: String?, treeDocumentId: String, wireId: String): Boolean? =
        inTree(authority, treeDocumentId, FsPaths.decodeId(wireId))
}
