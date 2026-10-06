package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * S7 (defect 185): every `clip.push` this phone builds says **how the text reached it**, and that is
 * decided by the code path — never by anything the sending app supplies. `docs/protocol.md` →
 * *Provenance*. The Mac applies only `origin: "clipboard"`; everything else is offered.
 *
 * A source guard because the property is *which call site passes which route*: the selection route
 * is reached from an exported activity no JVM test can start, and the focus route from
 * `MainActivity`. Each assertion names the exact call, so moving a route to the other origin turns
 * exactly this test red.
 */
class ClipOriginSourceTest {

    private fun code(name: String): String {
        val files = SourceTree.kotlinFiles()
        assertTrue("the source scan found ${files.size} files", files.size > 10)
        return files.single { it.name == name }.readText()
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            .replace(Regex("//[^\\n]*"), "")
    }

    private fun body(code: String, signature: String): String {
        val start = code.indexOf(signature)
        assertTrue("control: `$signature` was found", start >= 0)
        var depth = 0
        var i = code.indexOf('{', start)
        val open = i
        while (i < code.length) {
            if (code[i] == '{') depth++
            if (code[i] == '}' && --depth == 0) return code.substring(open, i + 1)
            i++
        }
        throw AssertionError("unbalanced braces after $signature")
    }

    @Test
    fun `the push payload carries the route's origin`() {
        val feature = code("ClipFeature.kt")
        val deliver = body(feature, "private fun deliver(")
        assertTrue("deliver() must stamp the route's origin on the payload", deliver.contains("origin = route.origin"))
    }

    @Test
    fun `the selection route is SELECTION and the focus route is FOCUS, each exactly once`() {
        val feature = code("ClipFeature.kt")
        assertEquals("two routes build a clip.push, no more", 2, Regex("\\bdeliver\\(").findAll(feature).count() - 1)
        val selection = body(feature, "fun sendSelectedText(")
        assertTrue(selection.contains("ClipRoute.SELECTION"))
        assertTrue("the exported route must never be FOCUS", !selection.contains("ClipRoute.FOCUS"))
        val focus = body(feature, "fun onWindowFocused(")
        assertTrue(focus.contains("ClipRoute.FOCUS"))
        val allFocus = SourceTree.kotlinFiles().sumOf { f ->
            Regex("ClipRoute\\.FOCUS\\b").findAll(f.readText().replace(Regex("//[^\\n]*"), "")).count()
        }
        assertEquals("ClipRoute.FOCUS is named only by the focus read", 1, allFocus)
    }

    @Test
    fun `sendSelectedText takes no parameter that could carry an origin`() {
        val feature = code("ClipFeature.kt")
        val signature = Regex("fun sendSelectedText\\(([^)]*)\\)").find(feature)?.groupValues?.get(1)
        assertEquals("context: Context, text: String, fromPackage: String?", signature?.replace(Regex("\\s+"), " ")?.trim())
    }
}

/**
 * 2026-10-07: the focus path ends every event in one logged reason, and no clipboard log line carries the
 * app a person copied from. Source guards, because `ClipFeature` needs a `Context` and `LinkLog`.
 */
class ClipFocusAndLogPrivacySourceTest {

    private fun code(name: String): String =
        SourceTree.kotlinFiles().single { it.name == name }.readText()
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            .replace(Regex("//[^\\n]*"), "")

    private fun body(code: String, signature: String): String {
        val start = code.indexOf(signature)
        assertTrue("control: `$signature` was found", start >= 0)
        var depth = 0
        var i = code.indexOf('{', start)
        val open = i
        while (i < code.length) {
            if (code[i] == '{') depth++
            if (code[i] == '}' && --depth == 0) return code.substring(open, i + 1)
            i++
        }
        throw AssertionError("unbalanced braces after $signature")
    }

    /** Red against `286e2b0`, whose focus path had four bare `return`s and no line for them. */
    @Test
    fun `the focus path has no silent exit and logs its reason with the tally`() {
        val focus = body(code("ClipFeature.kt"), "fun onWindowFocused(")
        assertTrue("a bare return in onWindowFocused is a silent exit", !Regex("\\breturn\\b").containsMatchIn(focus))
        assertTrue(focus.contains("FocusSync.decide("))
        assertTrue(focus.contains("focusTally.record(reason)"))
        assertTrue(focus.contains("focusTally.line()"))
    }

    /** Red against `286e2b0`, whose clip.push line ended "bytes from ${appName}". */
    @Test
    fun `no clipboard log line interpolates an app name or package`() {
        val feature = code("ClipFeature.kt")
        val lines = Regex("""LinkLog\.\w\(\s*"clip"[\s\S]*?\)\n""").findAll(feature).map { it.value }.toList()
        assertTrue("control: the scan found the clip log calls (${lines.size})", lines.size >= 10)
        for (line in lines) {
            assertTrue("a clip log line names the app: $line", !Regex("\\$\\{?(appName|packageName|fromPackage|label|owner)\\b").containsMatchIn(line))
            assertTrue("a clip log line carries text: $line", !Regex("\\$\\{?text\\b(?!\\))").containsMatchIn(line.replace("byteLength(text)", "")))
        }
        // The two label lookups on the clipboard paths are the quiet kind.
        assertEquals(2, Regex("AppLabels\\.of\\([^)]*quiet = true\\)").findAll(feature).count())
        assertEquals(0, Regex("AppLabels\\.of\\((?![^)]*quiet = true)[^)]*\\)").findAll(feature).count())
    }
}

/** The payload half, with nothing Android in it: what each route puts on the wire. */
class ClipOriginPayloadTest {

    @Test
    fun `the focus route stamps clipboard and the selection route stamps selection`() {
        assertEquals("clipboard", ClipboardPayloads.ClipRoute.FOCUS.origin)
        assertEquals("selection", ClipboardPayloads.ClipRoute.SELECTION.origin)
        assertEquals(ClipboardPayloads.ORIGIN_CLIPBOARD, ClipboardPayloads.ClipRoute.FOCUS.origin)
        // Exactly two routes: a third would need its own origin decided, not inherited by accident.
        assertEquals(2, ClipboardPayloads.ClipRoute.entries.size)
    }

    @Test
    fun `a push built for the selection route says selection on the wire`() {
        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_TEXT, text = "x", atMs = 1, source = ClipboardPayloads.SOURCE_PHONE,
            packageName = "com.example", appName = "Example", origin = ClipboardPayloads.ClipRoute.SELECTION.origin,
        )
        assertEquals("\"selection\"", payload["origin"].toString())
        // Control: an entry built without a route (the clip.request ack, history rows) carries no origin
        // at all — absent, never a guessed value.
        val plain = ClipboardPayloads.entry(kind = ClipboardPayloads.KIND_TEXT, text = "x", atMs = 1, source = ClipboardPayloads.SOURCE_PHONE)
        assertTrue("origin" !in plain)
    }

    @Test
    fun `the selection toast says the step that is left is on the Mac`() {
        assertEquals("Sent to your Mac — choose Copy there", SelectionSend.message(SelectionSend.Outcome.Sent(1)))
    }
}
