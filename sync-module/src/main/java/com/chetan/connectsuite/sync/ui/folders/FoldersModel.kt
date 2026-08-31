package com.chetan.connectsuite.sync.ui.folders

/**
 * What the Folders screen can be showing, and — the part worth reading — what it deliberately cannot.
 *
 * ### There are four states here and six on the Mac, on purpose
 *
 * This screen reads `contentResolver.persistedUriPermissions`. That is in-process and synchronous:
 * no IPC that can time out, no network, no provider that can answer a bound argument with an empty
 * cursor. **It cannot fail to load**, so there is no `Loading` and no `Failed` in this type, and
 * adding either would be the decoration `CLAUDE.md` warns about — an unreachable state drawn beside
 * a reachable one, which is worse than no state at all because the two then look alike to everyone
 * reading the code.
 *
 * The Mac's Files pane has the opposite problem and gets six states, four of which this screen has
 * no use for. That asymmetry is a decision, not an oversight —
 * `docs/phase-5-files-onboarding-proposal.md` §3.1.
 *
 * The four states are: [NoFolders]; [Folders] with rows; a row inside [Folders] whose grant no
 * longer resolves ([FolderRow.resolves]); and a pick that returned nothing, which is **not a state
 * of this screen at all** — see `FoldersViewModel.onPicked`.
 */
sealed interface FoldersUiState {

    /**
     * The user has added nothing. A fact about what they have done, never about what could be read —
     * the copy says *"No folders yet"* and not *"Couldn't load folders"*, because the second is a
     * sentence this screen is structurally incapable of meaning.
     */
    data object NoFolders : FoldersUiState

    /** One row per persisted tree grant, in the order the platform hands them back. */
    data class Folders(val rows: List<FolderRow>) : FoldersUiState
}

/**
 * One granted folder, as a person reads it.
 *
 * [label] is the breadcrumb from `FsPaths.labelForTreeDocumentId` — `DCIM › Camera`, never the tree
 * URI. The URI is the machine handle; this is the sentence. Same rule as a package id, same reason.
 */
data class FolderRow(
    val rootId: String,
    val label: String,
    val writable: Boolean,
    /**
     * False when the grant outlived the folder — deleted, or an OS that dropped the tree.
     *
     * The row is **kept and drawn as gone**, never filtered out. A grant the user cannot see is one
     * they cannot remove, and this row is the only place they can. `FsRoots.all` keeps it for the
     * same reason on the wire side.
     */
    val resolves: Boolean,
) {
    /** What the row's supporting line says about access, once it is known to resolve. */
    val access: String get() = if (writable) "read and write" else "read only"
}

/**
 * The whole of the screen's state derivation, in one expression so a test can evaluate the same one
 * the screen renders rather than a copy of it.
 */
fun foldersStateOf(rows: List<FolderRow>): FoldersUiState =
    if (rows.isEmpty()) FoldersUiState.NoFolders else FoldersUiState.Folders(rows)

/**
 * What to say after the picker returns — and the whole point is that a cancelled pick says nothing.
 *
 * Pure, and separate from the view model, so the rule has an enforcement point rather than a
 * comment. `CLAUDE.md`: a rule that matters enough to write down needs something that catches its
 * violation, or it is broken again by someone who never doubted it.
 *
 * @param rootId the persisted root id, or null when the pick returned nothing **or** the grant did
 *   not persist — [persisted] separates those two.
 * @param persisted false only when a folder was actually picked and the grant then failed to take.
 */
fun pickMessage(rootId: String?, label: String?, persisted: Boolean): String? = when {
    // A refusal and a cancellation arrive as the same null. One result, two intents, nothing to
    // report — see FoldersViewModel.onPicked.
    rootId == null && persisted -> null
    rootId == null -> "That folder was picked but the phone could not keep access to it"
    label != null -> "$label is now shared with the Mac"
    else -> "Folder added"
}
