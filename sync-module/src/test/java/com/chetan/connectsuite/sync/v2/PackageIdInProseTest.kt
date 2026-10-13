package com.chetan.connectsuite.sync.v2

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 33: a package id may be a machine handle, never the only thing a person reads.
 *
 * ### Why this is a source scan and not an ordinary unit test
 *
 * The bug is never in the failure class — its sentence is fine whatever it is handed. It is at the
 * **call site**, which passes `sbn.packageName` where a resolved label belongs, and no JVM test can
 * see a call site. Defect 28 found *three* copies of this when two were expected, so the rule is to
 * enumerate rather than to fix the one on screen, and enumeration over source is what that means
 * here.
 *
 * This is the same discriminator `scripts/check-apps-verb.mjs` uses: comments are stripped, so the
 * KDoc explaining the rule does not trip the guard that enforces it — a guard forbidding its own
 * explanation has broken the pair it belongs to.
 *
 * **What it does not reach:** any call assembled at runtime, and any file outside the list below.
 * It is a scan, and a scan's bound is the files it reads.
 *
 * ### Widened for defect 223
 *
 * The first version read one file, `NotificationFeature.kt`, so `InputFailure.ForegroundChanged`
 * in input-module named two packages to the Mac for weeks with this guard green — and the widening
 * found a third, `RemoteFailure.Unsupported` (defect 224). The two tests at the bottom read **every**
 * failure class in every module, found by declaration rather than by a list, from both ends: what a
 * refusal sentence interpolates, and what a call site hands it.
 */
class PackageIdInProseTest {

    /** Constructors whose argument becomes a sentence a person reads. */
    private val proseTakers = listOf("NoReplyAction")

    private val sources = listOf(
        "src/main/java/com/chetan/connectsuite/sync/v2/NotificationFeature.kt",
    )

    private fun strippedSource(path: String): String {
        val file = File(path)
        assertTrue("the scan must actually find $path — an empty scan passes vacuously", file.isFile)
        val text = file.readText()
        // Block comments first, then line comments. A guard that reads its own KDoc would forbid
        // the sentence explaining why it exists.
        return text
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""(?m)^\s*//.*$"""), "")
    }

    @Test
    fun `no prose-taking failure is handed a raw package id`() {
        val offences = mutableListOf<String>()
        sources.forEach { path ->
            val src = strippedSource(path)
            proseTakers.forEach { taker ->
                Regex("""$taker\(([^)]*)\)""").findAll(src).forEach { match ->
                    val arg = match.groupValues[1].trim()
                    // `packageName` in any form — `sbn.packageName`, `packageName`, `pkg` — is a
                    // handle. A resolved label comes through AppLabels and nowhere else.
                    if (arg.contains("packageName") && !arg.contains("AppLabels")) {
                        offences += "$path: $taker($arg)"
                    }
                }
            }
        }
        assertEquals(
            "a package id reached a sentence a person reads — route it through AppLabels.of: $offences",
            emptyList<String>(),
            offences,
        )
    }

    // ---- every failure class, every module (defects 223 and 224) -------------------------------

    /** The repository root, resolved rather than assumed. Gradle runs this from `sync-module/`. */
    private val root: File = listOf(File(".."), File("."))
        .map { it.canonicalFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("Cannot find the repository root from ${File(".").canonicalPath}")

    private fun mainKotlin(): List<File> = root.walkTopDown()
        .onEnter { it.name != "build" && it.name != "node_modules" && !it.name.startsWith(".") }
        .filter { it.isFile && it.extension == "kt" && it.path.contains("/src/main/") }
        .toList()

    /** Every file declaring a failure class — found by declaration, so a new module is not missed. */
    private fun failureFiles(): List<File> = mainKotlin().filter {
        Regex("""sealed (class|interface) \w*Failure\b""").containsMatchIn(it.readText())
    }

    /**
     * Every name a refusal sentence interpolates, each reviewed: none of them is a package id.
     * A new interpolation fails until someone adds it here, which is the point — the review is the
     * guard. An entry nothing uses fails too, so the list cannot rot into a blanket pass.
     */
    private val reviewed = setOf(
        "detail", "verb", "verdict", "label", "why", "what", "key", "target", "title",
        "actualMtimeMs", "actualSize", "expectedMtimeMs", "expectedSize", "free", "needed",
        "mtimeMs", "name", "size", "now", "seen",
        // A resolved label from AppLabels.of — never the package itself.
        "appName",
    )

    private fun reasonInterpolations(file: File): List<String> {
        val src = file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""(?m)^\s*//.*$"""), "")
        return Regex("""\breason\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)""").findAll(src).flatMap { m ->
            Regex("""\$\{?([A-Za-z_][A-Za-z0-9_]*)""").findAll(m.groupValues[1]).map { it.groupValues[1] }
        }.toList()
    }

    @Test
    fun `the widened scan reads every module's failure classes`() {
        // Control: an empty offence list below must mean "none", never "read nothing".
        val names = failureFiles().map { it.name }
        listOf("InputFailure.kt", "RemoteFeature.kt", "NotificationFeature.kt", "MirrorFailure.kt").forEach {
            assertTrue("the scan must find $it among $names", it in names)
        }
        assertTrue("too few failure files: $names", names.size >= 9)
        assertTrue("found no interpolations at all", failureFiles().sumOf { reasonInterpolations(it).size } > 20)
    }

    @Test
    fun `no refusal sentence interpolates a value nobody reviewed`() {
        val used = mutableSetOf<String>()
        val offences = failureFiles().flatMap { file ->
            reasonInterpolations(file).also { used += it }
                .filter { it !in reviewed || Regex("(?i)package|pkg").containsMatchIn(it) }
                .map { "${file.name}: \$$it" }
        }
        assertEquals(
            "a refusal the Mac shows interpolates an unreviewed value — a package id is the usual one",
            emptyList<String>(),
            offences,
        )
        assertEquals("reviewed names nothing interpolates any more", emptySet<String>(), reviewed - used)
    }

    @Test
    fun `no failure is constructed from a package id`() {
        // The call-site half: a package handed to a failure through a reviewed parameter
        // (`detail`, say) would pass the test above.
        val handle = Regex("""packageName|foregroundPackage|aimedAt|nowInFront|\bpkg\b""")
        val offences = mainKotlin().flatMap { file ->
            val src = file.readText()
                .replace(Regex("""/\*[\s\S]*?\*/"""), "")
                .replace(Regex("""(?m)^\s*//.*$"""), "")
            Regex("""\b\w+Failure\.\w+\(""").findAll(src).mapNotNull { m ->
                var depth = 1
                var i = m.range.last + 1
                while (i < src.length && depth > 0) {
                    if (src[i] == '(') depth++ else if (src[i] == ')') depth--
                    i++
                }
                val args = src.substring(m.range.last + 1, (i - 1).coerceAtLeast(m.range.last + 1))
                if (handle.containsMatchIn(args) && !args.contains("AppLabels")) "${file.name}: ${m.value}$args)" else null
            }.toList()
        }
        assertEquals("a failure was built from a package id", emptyList<String>(), offences)
    }

    /**
     * The control: the scan can see an offence.
     *
     * Without this the test above passes identically over a file it failed to read, a regex that
     * matches nothing, and a codebase with no defect — three states this project has already
     * confused for one another.
     */
    @Test
    fun `the scan detects the defect it was written for`() {
        val offending = "NoReplyAction(sbn.packageName)"
        val arg = Regex("""NoReplyAction\(([^)]*)\)""").find(offending)!!.groupValues[1]
        assertTrue("the matcher must flag a raw package id", arg.contains("packageName"))
        assertTrue("and must not flag a resolved one", 
            !"AppLabels.of(context, sbn.packageName)".let { it.contains("packageName") && !it.contains("AppLabels") })
    }

    /** The other control: a comment mentioning the forbidden shape must not trip the guard. */
    @Test
    fun `a comment describing the defect is not itself a defect`() {
        val commented = """
            // NoReplyAction(sbn.packageName) is the shape this guard forbids.
            /** NoReplyAction(sbn.packageName) in KDoc, too. */
            val x = 1
        """.trimIndent()
        val stripped = commented
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""(?m)^\s*//.*$"""), "")
        assertTrue(
            "comments must be stripped before matching: $stripped",
            !Regex("""NoReplyAction\(""").containsMatchIn(stripped),
        )
    }
}
