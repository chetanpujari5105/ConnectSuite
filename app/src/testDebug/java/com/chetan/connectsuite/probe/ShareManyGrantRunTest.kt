package com.chetan.connectsuite.probe

import com.chetan.connectsuite.probe.ShareManyGrantRun.Admit
import com.chetan.connectsuite.probe.ShareManyGrantRun.Intake
import com.chetan.connectsuite.probe.ShareManyGrantRun.Item
import com.chetan.connectsuite.probe.ShareManyGrantRun.Phase
import com.chetan.connectsuite.probe.ShareManyGrantRun.Read
import com.chetan.connectsuite.probe.ShareManyGrantRun.State
import com.chetan.connectsuite.probe.ShareManyGrantRun.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The §11 `SEND_MULTIPLE` grant measurement's rules. Synthetic instants and outcomes only: this proves the
 * **instrument** — what counts as a reading, how each phase is timed, what a line can carry — and nothing
 * about any sending app or device.
 */
class ShareManyGrantRunTest {

    private val send = ShareManyGrantRun.SEND_MULTIPLE
    private fun intake(media: Boolean = false, action: String = send) = Intake(
        action = action, type = "image/png", extraStreams = 2, clipItems = 2, clipUris = 2,
        streamsAllInClip = true, grantReadFlag = true, mediaPermissionHeld = media,
    )
    private fun items(n: Int = 2, authority: String = "com.sec.android.app.myfiles") = List(n) { Item(it, "content", authority, inClipData = true) }
    private val ok = Read(true, 100_718, "d5cf", null)
    private val refused = Read(false, 0, null, "java.lang.SecurityException")
    private val capped = Read(false, ShareManyGrantRun.READ_CAP_BYTES + 1, null, null, capped = true)

    private fun controlled(s: State = State(intake(), items()), r: Read = ok): State =
        s.items.indices.fold(s) { acc, i -> acc.afterControl(i, r) }

    private fun readAll(s0: State, phase: Phase, origin: Long, result: (Long) -> Read, fg: Boolean = true): State {
        var s = s0
        for (off in ShareManyGrantRun.offsets(phase)) for (i in s.items.indices) {
            if ((off to i) in s.owed(phase)) s = s.afterReading(phase, off, origin + off, i, result(off), fg)
        }
        return s
    }

    // ---- admission -----------------------------------------------------------------------------------

    @Test fun `only a SEND_MULTIPLE of 1 to 10 content items is taken, whole`() {
        assertTrue(ShareManyGrantRun.admit(intake(), items(1)) is Admit.Go)
        assertTrue(ShareManyGrantRun.admit(intake(), items(10)) is Admit.Go)
        assertTrue(ShareManyGrantRun.admit(intake(), items(11)) is Admit.Refuse)
        assertTrue(ShareManyGrantRun.admit(intake(), emptyList()) is Admit.Refuse)
        assertTrue(ShareManyGrantRun.admit(intake(action = "android.intent.action.SEND"), items(2)) is Admit.Refuse)
        val mixed = items(3).toMutableList().also { it[1] = Item(1, "file", "none", false) }
        assertEquals(Admit.Refuse("item 2 is not a content: URI — nothing read"), ShareManyGrantRun.admit(intake(), mixed))
        val missing = items(2).toMutableList().also { it[0] = Item(0, null, "none", false) }
        assertTrue("a missing stream is refused, never skipped", ShareManyGrantRun.admit(intake(), missing) is Admit.Refuse)
    }

    // ---- the control gates -----------------------------------------------------------------------------

    @Test fun `nothing is owed before every control, and an item whose control failed is never read again`() {
        val s0 = State(intake(), items())
        assertEquals("a stop before the controls is not the stopped state", s0, s0.afterStopped(10))
        val s = s0.afterControl(0, ok).afterControl(1, refused).afterStopped(1_000)
        assertEquals(listOf(1_000L to 0, 30_000L to 0), s.owed(Phase.STOPPED))
        assertEquals(Verdict.NO_READING, s.verdict(Phase.STOPPED, 1))
        assertEquals(Verdict.NO_READING, s.verdict(Phase.CONTROL, 1))
        assertEquals(Verdict.READABLE, s.verdict(Phase.CONTROL, 0))
    }

    @Test fun `a capped control is not a reading`() {
        val s = controlled(r = capped)
        assertEquals(Verdict.NO_READING, s.verdict(Phase.CONTROL, 0))
        assertTrue(s.afterStopped(5).owed(Phase.STOPPED).isEmpty())
    }

    // ---- timing -------------------------------------------------------------------------------------

    @Test fun `stopped readings are timed from the stop, and one taken early is refused`() {
        val s = controlled().afterStopped(50_000)
        try {
            s.afterReading(Phase.STOPPED, 1_000, 50_999, 0, ok, true)
            fail("a reading 999 ms after the stop was accepted as the +1 s reading")
        } catch (expected: IllegalStateException) {
        }
        val r = s.afterReading(Phase.STOPPED, 1_000, 51_000, 0, ok, true)
        assertEquals(1_000L, r.readings.single().elapsedMs)
    }

    @Test fun `finished readings are timed from the destroy, not from receipt or the stop`() {
        val s = controlled().afterStopped(1_000).afterDestroyed(90_000)
        assertTrue("no stopped reading after finish", !s.stoppedStillHolds(1_000))
        val r = s.afterReading(Phase.FINISHED, 30_000, 120_000, 1, ok, true)
        assertEquals(30_000L, r.readings.single().elapsedMs)
        try {
            s.afterReading(Phase.FINISHED, 120_000, 90_000 + 119_999, 0, ok, true)
            fail("early")
        } catch (expected: IllegalStateException) {
        }
    }

    @Test fun `only the first stop is measured`() {
        val s = controlled().afterStopped(1_000)
        assertEquals(1_000L, s.afterStopped(99_000).stoppedAtMs)
    }

    // ---- missing is not refused ---------------------------------------------------------------------

    @Test fun `the screen coming back before a stopped reading makes it missing, never a refusal`() {
        val s = controlled().afterStopped(0).afterReading(Phase.STOPPED, 1_000, 1_000, 0, refused, true)
            .afterReading(Phase.STOPPED, 1_000, 1_000, 1, refused, true)
            .afterRestarted(5_000)
        assertTrue("the +30 s reading is no longer owed", s.owed(Phase.STOPPED).isEmpty())
        assertFalse(s.stoppedStillHolds(30_000))
        assertEquals(Verdict.NO_READING, s.verdict(Phase.STOPPED, 0))
        assertTrue(ShareManyGrantRun.notTakenLine(s, 30_000, 0).contains("missing, not a refusal"))
    }

    @Test fun `a phase not begun, or not finished, has no verdict but NO_READING`() {
        val s = controlled()
        for (p in listOf(Phase.STOPPED, Phase.RECREATED, Phase.FINISHED)) assertEquals(p.name, Verdict.NO_READING, s.verdict(p, 0))
        val half = s.afterDestroyed(0).afterReading(Phase.FINISHED, 1_000, 1_000, 0, ok, true)
        assertEquals(Verdict.NO_READING, half.verdict(Phase.FINISHED, 0))
    }

    // ---- verdicts ----------------------------------------------------------------------------------

    @Test fun `all readable, all refused, and a lapse between samples are three verdicts`() {
        val done = controlled().afterDestroyed(0)
        assertEquals(Verdict.READABLE, readAll(done, Phase.FINISHED, 0, { ok }).verdict(Phase.FINISHED, 0))
        assertEquals(Verdict.REFUSED, readAll(done, Phase.FINISHED, 0, { refused }).verdict(Phase.FINISHED, 0))
        val lapse = readAll(done, Phase.FINISHED, 0, { off -> if (off < 30_000) ok else refused })
        assertEquals(Verdict.CHANGED, lapse.verdict(Phase.FINISHED, 0))
        val backAgain = readAll(done, Phase.FINISHED, 0, { off -> if (off == 30_000L) refused else ok })
        assertEquals("refused then readable again is not a lapse", Verdict.NO_READING, backAgain.verdict(Phase.FINISHED, 0))
    }

    @Test fun `after finish, a reading without the foreground LinkService is not a reading`() {
        val s = readAll(controlled().afterDestroyed(0), Phase.FINISHED, 0, { refused }, fg = false)
        assertEquals(Verdict.NO_READING, s.verdict(Phase.FINISHED, 0))
        val stopped = readAll(controlled().afterStopped(0), Phase.STOPPED, 0, { ok }, fg = false)
        assertEquals("the stopped screen keeps the process: no service needed", Verdict.READABLE, stopped.verdict(Phase.STOPPED, 0))
    }

    @Test fun `a capped reading is not a reading`() {
        val s = readAll(controlled().afterStopped(0), Phase.STOPPED, 0, { off -> if (off == 1_000L) capped else ok })
        assertEquals(Verdict.NO_READING, s.verdict(Phase.STOPPED, 0))
    }

    @Test fun `a recreation is read once, at offset 0, and only after the controls`() {
        assertFalse(State(intake(), items()).afterRecreated().recreated)
        val s = controlled().afterRecreated()
        assertEquals(listOf(0L to 0, 0L to 1), s.owed(Phase.RECREATED))
        val r = readAll(s, Phase.RECREATED, 7_777, { ok })
        assertEquals(Verdict.READABLE, r.verdict(Phase.RECREATED, 1))
        assertEquals(0L, r.readings.first().elapsedMs)
    }

    // ---- confounding -------------------------------------------------------------------------------

    @Test fun `a MediaStore item read with a media permission held is confounded - and only that case`() {
        val media = State(intake(media = true), items(authority = "media"))
        assertEquals(Verdict.CONFOUNDED, readAll(controlled(media).afterDestroyed(0), Phase.FINISHED, 0, { ok }).verdict(Phase.FINISHED, 0))
        assertEquals(Verdict.CONFOUNDED, controlled(media).verdict(Phase.CONTROL, 0))
        val noPermission = State(intake(media = false), items(authority = "media"))
        assertEquals(Verdict.READABLE, readAll(controlled(noPermission).afterDestroyed(0), Phase.FINISHED, 0, { ok }).verdict(Phase.FINISHED, 0))
        val myFiles = State(intake(media = true), items())
        assertEquals("My Files is not opened by a media permission", Verdict.REFUSED,
            readAll(controlled(myFiles).afterDestroyed(0), Phase.FINISHED, 0, { refused }).verdict(Phase.FINISHED, 0))
    }

    // ---- lines --------------------------------------------------------------------------------------

    @Test fun `every line is built from typed fields - no URI, path or name can reach one`() {
        val s = readAll(controlled().afterDestroyed(0), Phase.FINISHED, 0, { refused })
        val lines = listOf(
            ShareManyGrantRun.intakeLine(s.intake, s.items),
            ShareManyGrantRun.readLine(s, Phase.CONTROL, 0, 0, 0, ok, null),
            ShareManyGrantRun.readLine(s, Phase.FINISHED, 1_000, 1_000, 1, refused, true),
            ShareManyGrantRun.readLine(s, Phase.STOPPED, 1_000, 1_000, 1, capped, null),
            ShareManyGrantRun.notTakenLine(s, 30_000, 0),
            ShareManyGrantRun.verdictLine(s, Phase.FINISHED),
        )
        assertTrue("control: the lines say something", lines.all { it.length > 20 })
        for (l in lines) {
            assertFalse(l, l.contains("content://"))
            assertFalse(l, l.contains("/storage/"))
            assertFalse(l, l.contains(".png"))
        }
        assertTrue(lines[0], lines[0].contains("probe bound 10 items, 16 MiB per read"))
        assertTrue(lines[0], lines[0].contains("streamsAllInClip=true grantReadFlag=true"))
        assertTrue(lines[3], lines[3].contains("not a reading"))
        assertEquals("verdict phase=FINISHED item1=REFUSED(3/3) item2=REFUSED(3/3)", lines[5])
    }
}
