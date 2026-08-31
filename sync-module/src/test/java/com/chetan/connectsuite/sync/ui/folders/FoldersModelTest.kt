package com.chetan.connectsuite.sync.ui.folders

import com.chetan.connectsuite.sync.SourceTree
import com.chetan.connectsuite.sync.v2.FsPaths
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Folders screen's state derivation.
 *
 * These call [foldersStateOf] rather than restating the rule, for the reason `MediaPayloadsTest`
 * carries in its own header: a test that writes the rule out a second time passes over a deleted
 * implementation. There is one expression of "empty means empty" and both the screen and this file
 * evaluate it.
 */
class FoldersModelTest {

    private fun row(
        label: String,
        writable: Boolean = true,
        resolves: Boolean = true,
    ) = FolderRow(
        rootId = "saf:primary%3A$label",
        label = label,
        writable = writable,
        resolves = resolves,
    )

    @Test
    fun `no grants is the no-folders state, which is a fact about the user and not about a failure`() {
        assertEquals(FoldersUiState.NoFolders, foldersStateOf(emptyList()))
    }

    @Test
    fun `one grant is the folders state, not an almost-empty one`() {
        val state = foldersStateOf(listOf(row("DCIM › Camera")))
        assertTrue(state is FoldersUiState.Folders)
        assertEquals(1, (state as FoldersUiState.Folders).rows.size)
    }

    @Test
    fun `a folder whose grant no longer resolves is kept, never filtered out`() {
        // Dropping it silently is an absence the user cannot act on: this row is the only place the
        // stale grant can be removed, so a screen that hides it strands the grant forever.
        val state = foldersStateOf(listOf(row("Trip photos", resolves = false)))
        assertTrue(state is FoldersUiState.Folders)
        assertEquals(
            listOf("Trip photos"),
            (state as FoldersUiState.Folders).rows.map { it.label },
        )
        assertEquals(false, state.rows.single().resolves)
    }

    @Test
    fun `every folder being gone is still the folders state, not the empty one`() {
        // The distinction this whole screen is built around: "you have added nothing" and "what you
        // added is no longer there" are different sentences and must not collapse into one card.
        val state = foldersStateOf(
            listOf(row("Trip photos", resolves = false), row("Old backup", resolves = false)),
        )
        assertTrue(
            "all-gone must not render as NoFolders — the user has grants to remove",
            state is FoldersUiState.Folders,
        )
    }

    @Test
    fun `access reads as a sentence and only for what the grant actually carries`() {
        assertEquals("read and write", row("DCIM", writable = true).access)
        assertEquals("read only", row("DCIM", writable = false).access)
    }

    @Test
    fun `a cancelled or refused pick says nothing at all`() {
        // The finding this screen is shaped around: Android refuses a folder by disabling the
        // confirm button inside its own picker, so a refusal and a change of mind both come back as
        // null. One result for two intents means there is nothing true to say, and saying something
        // would be a coin flip rendered as a fact.
        assertEquals(null, pickMessage(rootId = null, label = null, persisted = true))
    }

    @Test
    fun `a pick that succeeded and then failed to persist does get a sentence`() {
        // The other side of the same rule: this one is not ambiguous. A folder was chosen and the
        // grant did not take, which is a real failure with a real cause.
        val message = pickMessage(rootId = null, label = null, persisted = false)
        assertTrue("a failed persist must be reported: $message", message != null)
    }

    @Test
    fun `a successful pick names the folder by its breadcrumb`() {
        assertEquals(
            "DCIM › Camera is now shared with the Mac",
            pickMessage("saf:primary%3ADCIM%2FCamera", "DCIM › Camera", persisted = true),
        )
    }

    @Test
    fun `this screen has exactly two states, and neither of them is a failure`() {
        // The asymmetry, made enforceable. `persistedUriPermissions` is read in-process and
        // synchronously: it cannot fail, so a Loading or Failed variant here would be unreachable —
        // and an unreachable state drawn beside a reachable one is the decoration `CLAUDE.md`
        // warns about. The Mac's pane has six states for the opposite reason and that is deliberate,
        // not an inconsistency. If this test fails, the question is whether the new state can
        // actually be reached, not how to make the assertion pass.
        val source = SourceTree.kotlinFiles().single { it.name == "FoldersModel.kt" }.readText()
        val variants = Regex("(?:data object|data class|object|class) (\\w+)[^\n]*: FoldersUiState")
            .findAll(source).map { it.groupValues[1] }.toList().sorted()
        assertEquals(
            "FoldersUiState gained a variant. Can it actually be reached? " +
                "persistedUriPermissions is read in-process and cannot fail.",
            listOf("Folders", "NoFolders"),
            variants,
        )
        // Control: the scan found the declaration at all, so an empty read cannot pass as two.
        assertTrue("the scan read no source", source.contains("sealed interface FoldersUiState"))
    }

    @Test
    fun `a row's label is a breadcrumb, never a tree URI`() {
        // The package-id rule applied to a different opaque identifier. `FsPathsTest` proves the
        // conversion; this proves the screen's row carries the converted form and not the raw one.
        val label = FsPaths.labelForTreeDocumentId("primary:DCIM/Camera")
        val state = foldersStateOf(listOf(row(label))) as FoldersUiState.Folders
        val shown = state.rows.single().label
        assertEquals("DCIM › Camera", shown)
        assertTrue("no percent-encoding may reach a label: $shown", !shown.contains('%'))
        assertTrue("no scheme may reach a label: $shown", !shown.contains("content://"))
    }
}
