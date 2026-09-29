package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareAdmission
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget
import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import com.chetan.connectsuite.sync.v2.ShareStaging
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Owner decision B (2026-09-26), Stage 1: an extra share from the **single-file sheet** that the
 * version-3 per-copy budget refuses is a **refusal with the measured limit and Try again** — never a
 * sheet left waiting for room. With no other copy held the sheet is version 2, unchanged, and nothing
 * here touches it (its own tests are not edited).
 */
class ShareToMacNoRoomTest {

    private val gib = 1024L * 1024 * 1024
    private fun failed(f: ShareSheetState.Failure) = ShareSheetState.Failed("b.jpg", f)

    @Test fun `Try again exists only after a no-room refusal - never on any other state`() {
        val others = ShareToMacCopy.everyState().filterNot { it is ShareSheetState.Failed && it.failure is ShareSheetState.Failure.NoRoomYet }
        assertTrue("control: the enumeration has the no-room states", ShareToMacCopy.everyState().any(::canTryAgain))
        assertEquals(emptyList<ShareSheetState>(), others.filter(::canTryAgain))
    }

    @Test fun `the refusal states the measured limit and this file's size, exactly as measured`() {
        val text = ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(held = 100_718, size = 230_778, limit = 89_000)))
        assertTrue(text, text.contains("only ${ShareToMacCopy.bytes(89_000)} more right now"))
        assertTrue(text, text.contains("this file is ${ShareToMacCopy.bytes(230_778)}"))
        assertTrue(text, text.contains(ShareToMacCopy.bytes(100_718)))
        assertTrue(text, text.contains(ShareToMacCopy.TRY_AGAIN_BUTTON))
        assertEquals("No room for another file yet", ShareToMacCopy.headline(failed(ShareSheetState.Failure.NoRoomYet(1, 2, 3))))
    }

    @Test fun `with no measurement it says so and states no number it does not have`() {
        val text = ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(held = 100_718, size = 230_778, limit = null)))
        assertTrue(text, text.contains("couldn’t measure"))
        assertFalse("no invented limit: $text", text.contains("only") && text.contains("more right now"))
    }

    @Test fun `an unreported size is said to be unreported, and another preparation is named`() {
        val unknown = ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(1, null, 89_000)))
        assertTrue(unknown, unknown.contains("size isn’t reported"))
        val busy = ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(1, 2, 3, anotherPreparing = true)))
        assertTrue(busy, busy.contains("being prepared on this phone right now"))
    }

    @Test fun `a no-room refusal never claims a send, a save, a wait, or anything on the Mac`() {
        for (f in listOf(
            ShareSheetState.Failure.NoRoomYet(1, 2, 3), ShareSheetState.Failure.NoRoomYet(1, null, 3),
            ShareSheetState.Failure.NoRoomYet(1, 2, null), ShareSheetState.Failure.NoRoomYet(1, 2, 3, anotherPreparing = true),
        )) {
            val s = ShareToMacCopy.headline(failed(f)) + " " + ShareToMacCopy.detail(failed(f))
            for (word in listOf("Sent", "sent to", "Saved", "saved on", "waiting for room", "Waiting for room", "queued")) {
                assertFalse("$word in: $s", s.contains(word))
            }
            assertTrue(s, s.contains("Nothing was copied or kept"))
            // Nothing staged, so leaving deletes nothing and needs no warning.
            assertEquals(SheetExit.NOTHING, onLeave(failed(f)))
        }
    }

    // ---- a copy the budget re-check stopped (BudgetStopped): the re-check's own facts, worded honestly ----

    private fun stopped(why: ShareConcurrentBudget.Refusal, held: Long, limit: Long?, written: Long = 8_388_608L) =
        ShareStaging.Outcome.BudgetStopped("s-AAAAAAAAAAAAAAAAAAAAAA", written, ShareAdmission.Stop(why, held, limit))

    @Test fun `a measured stop carries the re-check's reason, Σ and limit - and is never worded as unmeasured`() {
        for (why in listOf(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET)) {
            val f = noRoomAfterStop(stopped(why, held = 100_718, limit = 89_000), size = 230_778)
            assertEquals(ShareSheetState.Failure.NoRoomYet(100_718, 230_778, 89_000, why = why,
                at = ShareSheetState.NoRoomAt.StoppedPartway(8_388_608)), f)
            val text = ShareToMacCopy.detail(failed(f))
            assertFalse("$why: $text", text.contains("couldn’t measure"))
            assertTrue(text, text.contains("only ${ShareToMacCopy.bytes(89_000)} more right now"))
            assertTrue(text, text.contains("this file is ${ShareToMacCopy.bytes(230_778)}"))
        }
        val space = ShareToMacCopy.detail(failed(noRoomAfterStop(stopped(ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET, 1, 2), 3)))
        assertTrue(space, space.contains("free space fell while this file was being prepared"))
        val quota = ShareToMacCopy.detail(failed(noRoomAfterStop(stopped(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, 1, 2), 3)))
        assertTrue(quota, quota.contains("filled up while this one was being prepared"))
        assertFalse("the two reasons are worded apart", quota.contains("free space fell"))
    }

    @Test fun `a measured limit of zero is still a measurement`() {
        val text = ShareToMacCopy.detail(failed(noRoomAfterStop(stopped(ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET, 1, 0), 3)))
        assertFalse(text, text.contains("couldn’t measure"))
        assertTrue(text, text.contains("only ${ShareToMacCopy.bytes(0)} more right now"))
    }

    @Test fun `only a genuinely missing or stale reading says couldn't measure, and states no number`() {
        for (why in listOf(ShareConcurrentBudget.Refusal.READING_STALE, ShareConcurrentBudget.Refusal.QUOTA_UNREADABLE,
            ShareConcurrentBudget.Refusal.OWN_CACHE_UNREADABLE, ShareConcurrentBudget.Refusal.READING_FROM_THE_FUTURE)) {
            val text = ShareToMacCopy.detail(failed(noRoomAfterStop(stopped(why, 100_718, null), 230_778)))
            assertTrue("$why: $text", text.contains("couldn’t measure"))
            assertFalse("$why: no invented limit", text.contains("more right now"))
        }
    }

    @Test fun `the Σ shown is the re-check's, not a later reading - the other offer ending cannot make it 0 bytes`() {
        val f = noRoomAfterStop(stopped(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, held = 100_718, limit = 89_000), 230_778)
        assertEquals(100_718L, f.held)
        assertTrue(ShareToMacCopy.detail(failed(f)).contains("(${ShareToMacCopy.bytes(100_718)} prepared for it)"))
        // The write site: the model's stop and limit branches build their state from the outcome and the
        // admission, never from a fresh ShareFeature.stagingContext() (the model needs an Android context,
        // so its source is where the test can reach it).
        val root = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }
        val model = File(root, "app/src/main/java/com/chetan/connectsuite/ShareToMacModel.kt").readText()
        val branches = model.substring(model.indexOf("is ShareStaging.Outcome.OverLimit ->"), model.indexOf("is ShareStaging.Outcome.SourceReadFailed ->"))
        assertTrue("control: the slice holds both branches", branches.contains("BudgetStopped") && branches.contains("NoRoomYet("))
        assertFalse(branches, branches.contains("stagingContext"))
        assertTrue(branches.contains("noRoomAfterStop(outcome, expected)"))
    }

    @Test fun `a partial copy is never worded as nothing copied - it says what was prepared and that it was deleted`() {
        val partway = ShareToMacCopy.detail(failed(noRoomAfterStop(stopped(ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET, 1, 2, written = 8_388_608), 3)))
        assertFalse(partway, partway.contains("Nothing was copied"))
        assertTrue(partway, partway.contains("stopped after preparing ${ShareToMacCopy.bytes(8_388_608)} of it and deleted that part. Nothing was kept."))
        val limit = ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(1, null, 89_000, at = ShareSheetState.NoRoomAt.ReachedLimit)))
        assertFalse(limit, limit.contains("Nothing was copied"))
        assertTrue(limit, limit.contains("deleted what it had prepared. Nothing was kept."))
        // Control: refused before the copy, it is still exactly "Nothing was copied or kept".
        assertTrue(ShareToMacCopy.detail(failed(ShareSheetState.Failure.NoRoomYet(1, 2, 3))).contains("Nothing was copied or kept."))
    }

    @Test fun `every stopped state still claims no send, no save and nothing on the Mac, and leaves nothing to discard`() {
        val states = ShareToMacCopy.everyState().filterIsInstance<ShareSheetState.Failed>()
            .filter { val f = it.failure; f is ShareSheetState.Failure.NoRoomYet && f.at != ShareSheetState.NoRoomAt.BeforeCopy }
        assertTrue("control: the enumeration has stopped states", states.size >= 3)
        for (st in states) {
            val s = ShareToMacCopy.headline(st) + " " + ShareToMacCopy.detail(st)
            for (word in listOf("Sent", "sent to", "Saved", "saved on", "waiting for room", "Waiting for room", "queued")) {
                assertFalse("$word in: $s", s.contains(word))
            }
            assertTrue(s, s.contains("Nothing was kept."))
            assertEquals(SheetExit.NOTHING, onLeave(st))
            assertTrue(canTryAgain(st))
        }
    }

    @Test fun `the sheet supplies the budget only where several files are on, and Try again is a button a person taps`() {
        val root = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }
        val code = { f: File -> f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "") }
        val model = code(File(root, "app/src/main/java/com/chetan/connectsuite/ShareToMacModel.kt"))
        assertTrue(model.contains("val concurrent = if (Extensions.multiFile(debuggable())) ShareBudgetReadings.concurrent(app, dir) else null"))
        assertEquals("one place builds readings", 1, Regex("ShareBudgetReadings\\.concurrent\\(").findAll(model).count())
        assertTrue("refused, never waiting", model.contains("is ShareAdmission.Copy.OverBudget ->") && !model.contains("WaitingForRoom"))
        assertFalse("no timer retries", Regex("delay\\(|postDelayed|Timer\\(").containsMatchIn(model))
        val sheet = code(File(root, "app/src/main/java/com/chetan/connectsuite/ShareToMacActivity.kt"))
        assertTrue(sheet.contains("if (canTryAgain(state))") && sheet.contains("Button(onClick = onTryAgain)"))
        assertTrue(sheet.contains("onTryAgain = { model.tryAgain() }"))
    }

    @Test fun `a file alone is untouched - the sheet reaches the budget only through forCopy, which returns preflight for Σ = 0`() {
        // The model's only admission call is forCopy; with nothing held forCopy is ShareStaging.preflight
        // (ShareAdmissionBudgetTest proves that, including with every reading missing).
        val root = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }
        val model = File(root, "app/src/main/java/com/chetan/connectsuite/ShareToMacModel.kt").readText()
        assertEquals(1, Regex("ShareAdmission\\.forCopy\\(").findAll(model).count())
        assertFalse(model.contains("ShareConcurrentBudget.admit("))
        assertTrue("control", canSend(ShareSheetState.Ready("a.bin", "b/c", 1, Availability.Available("Mac"))))
        assertTrue(gib > 0)
    }
}
