package com.chetan.connectsuite.sync.ui.folders

import android.app.Application
import android.net.Uri
import android.provider.DocumentsContract
import androidx.lifecycle.AndroidViewModel
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.FsRoots
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The Folders screen's state, read straight from the platform every time it is asked for.
 *
 * Nothing is cached. The grants can change without this app running — the OS can drop one, the user
 * can clear app data — so a cache here would be a second copy of a fact `FsRoots` exists to keep in
 * one place, free to disagree with it exactly when it matters.
 */
class FoldersViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow<FoldersUiState>(FoldersUiState.NoFolders)
    val uiState: StateFlow<FoldersUiState> = _uiState.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        refresh()
    }

    /**
     * Re-reads the grants. Called on every resume, because the picker is another activity and a
     * revoke can happen in Settings while this screen is in the background.
     */
    fun refresh() {
        val folders = FsRoots.grantedFolders(getApplication())
        _uiState.value = foldersStateOf(
            folders.map {
                FolderRow(
                    rootId = it.rootId,
                    label = it.label,
                    writable = it.writable,
                    resolves = it.resolves,
                )
            },
        )
        val gone = folders.count { !it.resolves }
        LinkLog.i(
            "fs",
            "Folders screen: ${folders.size} folder(s) shared, ${folders.size - gone} resolving, " +
                "$gone gone",
        )
    }

    /**
     * The picker intent, optionally **aimed**.
     *
     * Unaimed for **Browse…**, which is the only thing that can be right for everybody: with no
     * initial URI the picker restores its own last location, which is a guess but an honest one
     * because nothing on the button promised otherwise.
     *
     * Aimed for a quick pick, which *is* a promise about where it opens — and one this app could not
     * make until `EXTRA_INITIAL_URI` was measured on hardware. It is honoured on this handset, and
     * a bad aim degrades to the parent rather than to the refusal. [FolderQuickPicks] carries the
     * readings and the one constraint that falls out of them.
     */
    fun pickerIntent(pick: FolderQuickPicks.Pick? = null) = FsRoots.pickerIntent(
        pick?.let {
            DocumentsContract.buildDocumentUri(
                FolderQuickPicks.EXTERNAL_STORAGE_AUTHORITY,
                it.documentId,
            )
        },
    )

    /**
     * The chips to draw: safe targets the user has not already granted.
     *
     * Derived from the live grant list rather than remembered, for the same reason nothing else on
     * this screen is cached — a chip for a folder already shared is an offer that does nothing, and
     * the grants can change while this screen is in the background.
     */
    fun quickPicks(): List<FolderQuickPicks.Pick> {
        val granted = (uiState.value as? FoldersUiState.Folders)?.rows?.map { it.rootId }?.toSet()
            ?: emptySet()
        return FolderQuickPicks.offered(granted)
    }

    /**
     * The picker's result.
     *
     * ### A `null` here carries no information, and nothing may be said about it
     *
     * Android refuses a folder by **disabling the confirm button inside the picker**, not by
     * returning an error: the storage root and `Download` itself list normally and cannot be
     * confirmed. A user who met that wall and a user who simply changed their mind both back out,
     * and both arrive here as `null`. There is no extra, no result code and no way to ask afterwards
     * — one result for two intents.
     *
     * So this branch is silent, and it must stay silent. *"That folder can't be added"* would be a
     * confident wrong answer half the time, which is the failure this project keeps recording.
     * **The wall is stated as permanent copy on the screen instead, because there is no afterwards
     * to put it in.** `docs/phase-5-files-onboarding-proposal.md` §3.5.
     */
    fun onPicked(treeUri: Uri?) {
        if (treeUri == null) {
            LinkLog.i("fs", "folder pick returned nothing — cancelled or refused, indistinguishable")
            _message.value = pickMessage(rootId = null, label = null, persisted = true)
            return
        }
        val rootId = FsRoots.persist(getApplication(), treeUri)
        refresh()
        val label = (uiState.value as? FoldersUiState.Folders)
            ?.rows?.firstOrNull { it.rootId == rootId }?.label
        // The wording lives in `pickMessage`, which a test can reach. A pick that succeeded and then
        // failed to persist is a real failure with a real cause, unlike a null result, so it does
        // get a sentence — `persisted = false` is what distinguishes the two.
        _message.value = pickMessage(rootId, label, persisted = rootId != null)
    }

    /** Gives a folder back. Removes the Mac's access; deletes nothing. */
    fun remove(rootId: String) {
        val folder = FsRoots.grantedFolders(getApplication()).firstOrNull { it.rootId == rootId }
        if (folder == null) {
            refresh()
            return
        }
        FsRoots.release(getApplication(), folder.treeUri)
        refresh()
        _message.value = "${folder.label} is no longer shared"
    }

    fun consumeMessage() {
        _message.value = null
    }
}
