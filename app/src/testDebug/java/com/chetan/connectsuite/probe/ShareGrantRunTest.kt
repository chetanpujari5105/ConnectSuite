package com.chetan.connectsuite.probe

import com.chetan.connectsuite.probe.ShareGrantRun.Case
import com.chetan.connectsuite.probe.ShareGrantRun.Control
import com.chetan.connectsuite.probe.ShareGrantRun.Reading
import com.chetan.connectsuite.probe.ShareGrantRun.State
import com.chetan.connectsuite.probe.ShareGrantRun.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The lifetime rules of the §4 grant probe, reached through the same transitions the probe calls —
 * the state is never built by hand past its constructor, so a wrong write in a transition is in
 * reach (the defect-67 rule).
 */
class ShareGrantRunTest {

    private val ok = Control(ok = true, bytes = 4096, sha256 = "ab", exceptionClass = null)
    private val refused = Control(ok = false, bytes = 0, sha256 = null, exceptionClass = "java.lang.SecurityException")
    private val t0 = 10_000L

    private fun fresh(case: Case = Case.FILE) = State(authority = "com.android.externalstorage.documents", case = case)

    private fun reading(ok: Boolean, foreground: Boolean = true) = Reading(
        offsetMs = 0, elapsedMs = 0, ok = ok, bytes = if (ok) 4096 else 0, sha256 = if (ok) "ab" else null,
        exceptionClass = if (ok) null else "java.lang.SecurityException", linkServiceForeground = foreground,
    )

    private fun readAll(state: State, ok: (Long) -> Boolean = { true }, foreground: Boolean = true): State =
        ShareGrantRun.READING_OFFSETS_MS.fold(state) { s, offset ->
            s.afterReading(offset, t0 + offset, reading(ok(offset), foreground))
        }

    @Test fun `the three offsets are the ones section 4 names`() {
        assertEquals(listOf(1_000L, 30_000L, 120_000L), ShareGrantRun.READING_OFFSETS_MS)
    }

    @Test fun `image and video are the media case, everything else the file case`() {
        assertEquals(Case.MEDIA, ShareGrantRun.caseOf("image/png"))
        assertEquals(Case.MEDIA, ShareGrantRun.caseOf("video/mp4"))
        assertEquals(Case.FILE, ShareGrantRun.caseOf("application/octet-stream"))
        assertEquals(Case.FILE, ShareGrantRun.caseOf(null))
    }

    @Test fun `nothing is owed before the control, or before destruction`() {
        assertTrue(fresh().owedOffsets().isEmpty())
        assertTrue(fresh().afterControl(ok).owedOffsets().isEmpty())
        assertEquals(ShareGrantRun.READING_OFFSETS_MS, fresh().afterControl(ok).afterDestroyed(t0).owedOffsets())
    }

    @Test fun `a failed control owes no readings and the run holds no reading`() {
        val s = fresh().afterControl(refused).afterDestroyed(t0)
        assertTrue(s.owedOffsets().isEmpty())
        assertEquals(Verdict.NO_READING, s.verdict())
        assertThrows(IllegalStateException::class.java) { s.afterReading(1_000, t0 + 1_000, reading(true)) }
    }

    @Test fun `a reading is refused before destruction, early, twice, or at an unnamed offset`() {
        val ready = fresh().afterControl(ok).afterDestroyed(t0)
        assertThrows(IllegalStateException::class.java) {
            fresh().afterControl(ok).afterReading(1_000, t0 + 1_000, reading(true))
        }
        assertThrows(IllegalStateException::class.java) { ready.afterReading(30_000, t0 + 29_999, reading(true)) }
        assertThrows(IllegalStateException::class.java) { ready.afterReading(5_000, t0 + 5_000, reading(true)) }
        val once = ready.afterReading(1_000, t0 + 1_000, reading(true))
        assertThrows(IllegalStateException::class.java) { once.afterReading(1_000, t0 + 2_000, reading(true)) }
    }

    @Test fun `elapsed is measured from destruction, not supplied by the caller`() {
        val s = fresh().afterControl(ok).afterDestroyed(t0).afterReading(30_000, t0 + 30_250, reading(true))
        assertEquals(30_250L, s.readings.single().elapsedMs)
        assertEquals(30_000L, s.readings.single().offsetMs)
    }

    @Test fun `the control is read once and before destruction`() {
        assertThrows(IllegalStateException::class.java) { fresh().afterControl(ok).afterControl(ok) }
        assertThrows(IllegalStateException::class.java) { fresh().afterDestroyed(t0).afterControl(ok) }
    }

    @Test fun `PASS needs every interval open under a foreground LinkService`() {
        assertEquals(Verdict.PASS, readAll(fresh().afterControl(ok).afterDestroyed(t0)).verdict())
    }

    @Test fun `one refused interval is FAIL`() {
        val s = readAll(fresh().afterControl(ok).afterDestroyed(t0), ok = { it != 120_000L })
        assertEquals(Verdict.FAIL, s.verdict())
    }

    @Test fun `a missing interval is NO_READING, never PASS or FAIL`() {
        val s = fresh().afterControl(ok).afterDestroyed(t0)
            .afterReading(1_000, t0 + 1_000, reading(true))
            .afterReading(30_000, t0 + 30_000, reading(true))
        assertEquals(Verdict.NO_READING, s.verdict())
    }

    @Test fun `a pass without the foreground service answers a different question`() {
        val s = readAll(fresh().afterControl(ok).afterDestroyed(t0), foreground = false)
        assertEquals(Verdict.NO_READING, s.verdict())
    }

    @Test fun `log lines carry the authority and never a URI, path or content`() {
        val s = readAll(fresh(Case.MEDIA).afterControl(ok).afterDestroyed(t0), ok = { it != 30_000L })
        val lines = listOf(ShareGrantRun.controlLine(s), ShareGrantRun.verdictLine(s)) +
            s.readings.map { ShareGrantRun.readingLine(s, it) }
        lines.forEach { line ->
            assertFalse(line, line.contains("content://"))
            assertFalse(line, line.contains("/"))
        }
        assertTrue(lines.all { it.contains("authority=com.android.externalstorage.documents") })
        assertTrue(lines.any { it.contains("ok=false exception=java.lang.SecurityException") })
    }
}
