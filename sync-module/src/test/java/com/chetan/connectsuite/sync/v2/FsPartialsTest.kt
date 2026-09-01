package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's half of the partial convention.
 *
 * The rules are the contract in `docs/protocol.md`, and the Mac implements the same ones in
 * `desktop/src/shared/transferFiles.ts`. These call [FsPartials.resumeFrom] rather than restating
 * it — a test that writes the rule out a second time passes over a deleted implementation, which is
 * `MediaPayloadsTest`'s lesson and the reason the decision has one home.
 */
class FsPartialsTest {

    @Test
    fun `a partial we have no record of is another app's file and is not resumed`() {
        // The rule that matters most on this side. A granted tree is DCIM or Documents, shared with
        // every downloader on the device — resuming an unrecorded `.part` means appending our bytes
        // to a stranger's download and then renaming the result over their file.
        val decision = FsPartials.resumeFrom(partBytes = 4_096, recordedBytes = null, totalBytes = 8_192)
        assertTrue(decision is FsPartials.Resume.FromZero)
        assertTrue(
            "the refusal must say why: ${(decision as FsPartials.Resume.FromZero).why}",
            decision.why.contains("another app"),
        )
    }

    @Test
    fun `a partial longer than our record is refused rather than appended to`() {
        // Either it is not ours or our record is wrong. Appending would produce a file whose digest
        // can never match, and the mismatch would then delete bytes that were fine.
        val decision = FsPartials.resumeFrom(partBytes = 9_000, recordedBytes = 4_096, totalBytes = 20_000)
        assertTrue(decision is FsPartials.Resume.FromZero)
    }

    @Test
    fun `a matching partial resumes from its own length`() {
        assertEquals(
            FsPartials.Resume.FromOffset(4_096),
            FsPartials.resumeFrom(partBytes = 4_096, recordedBytes = 4_096, totalBytes = 20_000),
        )
    }

    @Test
    fun `a partial shorter than the record resumes from the file, not the record`() {
        // The file is what the digest will actually cover. A record claiming more bytes than exist
        // is how a resumed digest silently omits a hole.
        assertEquals(
            FsPartials.Resume.FromOffset(3_000),
            FsPartials.resumeFrom(partBytes = 3_000, recordedBytes = 4_096, totalBytes = 20_000),
        )
    }

    @Test
    fun `a partial already the full length is not resumed`() {
        val decision = FsPartials.resumeFrom(partBytes = 20_000, recordedBytes = 20_000, totalBytes = 20_000)
        assertTrue(decision is FsPartials.Resume.FromZero)
    }

    @Test
    fun `an empty partial and a missing one both start at zero, for different stated reasons`() {
        val empty = FsPartials.resumeFrom(0, 0, 20_000) as FsPartials.Resume.FromZero
        val missing = FsPartials.resumeFrom(null, null, 20_000) as FsPartials.Resume.FromZero
        assertTrue(empty.why.contains("empty"))
        assertTrue(missing.why.contains("no partial"))
        // Same outcome, different cause. The log line is the only place they can be told apart, so
        // the reasons must not collapse into one string.
        assertTrue(empty.why != missing.why)
    }

    @Test
    fun `the suffixes are spelled in exactly one file on this side`() {
        // The same guard shape as the Mac's `transferFiles.test.ts`, and as FsRootsSingleSourceTest.
        // A literal ".part" built inline wherever a name is needed is how two spellings of one rule
        // start to disagree.
        val files = SourceTree.kotlinFiles()
        assertTrue("the scan saw no sources", files.size > 20)
        val spellings = files.filter { file ->
            val body = file.readText()
                .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
                .lines().joinToString("\n") { line ->
                    var at = line.indexOf("//")
                    while (at > 0 && line[at - 1] == ':') at = line.indexOf("//", at + 1)
                    if (at < 0) line else line.substring(0, at)
                }
            body.contains("\".part\"") || body.contains("\".failed\"")
        }.map { it.name }.sorted()
        assertEquals(
            "the partial suffixes must be spelled once — found $spellings",
            listOf("FsPartials.kt"),
            spellings,
        )
    }

    @Test
    fun `overwrite is refused unless the Mac said exactly true`() {
        // The two mistakes cost different amounts. Reading a missing field as "yes" destroys a file
        // the user never offered up; reading a malformed one as "no" costs a refusal the Mac can
        // answer. So only the exact string is a yes.
        assertTrue(FsPartials.overwriteRequested("true"))
        listOf(null, "false", "null", "1", "yes", "TRUE", "", "maybe").forEach {
            assertTrue("overwriteRequested($it) must be false", !FsPartials.overwriteRequested(it))
        }
    }

    @Test
    fun `the sidecar carries the fact and not the bytes`() {
        val text = FsPartials.sidecarText(
            name = "holiday.mov",
            whenIso = "2026-09-01T03:30:00+05:30",
            bytes = 1234,
            expected = "aaaa",
            actual = "bbbb",
        )
        assertTrue(text.contains("holiday.mov"))
        assertTrue(text.contains("aaaa") && text.contains("bbbb"))
        // A person opening the folder must be able to tell this note from their data.
        assertTrue(text.contains("not your data"))
    }
}
