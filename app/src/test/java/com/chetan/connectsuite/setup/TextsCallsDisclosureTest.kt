package com.chetan.connectsuite.setup

import android.Manifest
import com.chetan.connectsuite.core.permissions.PermissionGroup
import com.chetan.connectsuite.onboarding.OnboardingCopy
import com.chetan.connectsuite.setup.SetupPlan.Route
import com.chetan.connectsuite.setup.SetupPlan.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The texts/calls/contacts disclosure's copy, held as facts about one sentence each — never as a
 * likeness between sentences (CLAUDE.md, the fourth test variety) — and the route that puts it in
 * front of Android's prompt. The gate across files is `TextsCallsGateTest`.
 */
class TextsCallsDisclosureTest {

    private fun lower(s: String) = s.lowercase()

    // ---- what it reads: one required phrase per permission the three groups actually request ----

    /**
     * Each permission the disclosed groups request, and the words that disclose it. Driven from
     * [PermissionGroup], so adding a permission to a group without disclosing it fails here.
     */
    private val discloses: Map<String, String> = mapOf(
        Manifest.permission.READ_SMS to "text messages",
        Manifest.permission.RECEIVE_SMS to "new ones as they arrive",
        Manifest.permission.SEND_SMS to "texts you send",
        Manifest.permission.READ_CALL_LOG to "call log",
        Manifest.permission.READ_PHONE_STATE to "phone state",
        Manifest.permission.CALL_PHONE to "dial",
        Manifest.permission.ANSWER_PHONE_CALLS to "answer or decline",
        Manifest.permission.READ_CONTACTS to "contacts' names, numbers, email addresses and photos",
    )

    @Test
    fun `every permission behind the disclosure is named in it`() {
        val asked = listOf(PermissionGroup.SMS, PermissionGroup.CALLS, PermissionGroup.CONTACTS)
            .flatMap { it.permissions }
        assertTrue("the groups must request something: $asked", asked.size >= 8)
        val text = lower(TextsCallsDisclosure.body.joinToString(" "))
        asked.forEach { permission ->
            val phrase = discloses[permission]
                ?: error("$permission is requested behind the disclosure but this test has no phrase for it")
            assertTrue("$permission is not disclosed — expected \"$phrase\"", text.contains(lower(phrase)))
        }
    }

    @Test
    fun `it says why — to show and answer texts and calls on the Mac`() {
        val why = lower(TextsCallsDisclosure.WHY)
        assertTrue(why.contains("mac you paired"))
        assertTrue(why.contains("reply to texts"))
        assertTrue(why.contains("calls"))
    }

    @Test
    fun `it says where it goes — the paired Mac only, encrypted, local, no server`() {
        val where = lower(TextsCallsDisclosure.WHERE)
        assertTrue(where.contains("only to your paired mac"))
        assertTrue(where.contains("encrypted"))
        assertTrue(where.contains("local network"))
        assertTrue(where.contains("not sent to a server") || where.contains("none of it is sent to a server"))
    }

    @Test
    fun `it says what is kept on each device, and that text and numbers are never kept`() {
        val kept = lower(TextsCallsDisclosure.KEPT)
        assertTrue("phone side", kept.contains("this phone keeps no copy"))
        assertTrue("Mac side", kept.contains("in memory") && kept.contains("disconnects"))
        // desktop activity.jsonl: R10 records direction and thread only; R11 records a name or
        // "Unknown number". The sentence must say both halves of that rule.
        assertTrue("Activity", kept.contains("activity"))
        assertTrue(kept.contains("never message text or phone numbers"))
        assertFalse("must not claim nothing is kept anywhere", kept.contains("nothing is kept"))
    }

    @Test
    fun `it says how to turn it off`() {
        assertTrue(lower(TextsCallsDisclosure.OFF).contains("turn these off"))
    }

    @Test
    fun `consent is an explicit choice between two different buttons`() {
        assertEquals("Agree", TextsCallsDisclosure.AGREE)
        assertEquals("Not now", TextsCallsDisclosure.NOT_NOW)
        assertNotEquals(TextsCallsDisclosure.AGREE, TextsCallsDisclosure.NOT_NOW)
    }

    @Test
    fun `it is about texts, calls and contacts and not bundled with the accessibility disclosure`() {
        TextsCallsDisclosure.allText.forEach { line ->
            assertFalse("'$line' mentions accessibility", lower(line).contains("accessibility"))
        }
    }

    @Test
    fun `the copy passes onboarding's forbidden-mechanism guard`() {
        assertEquals(emptyList<OnboardingCopy.Violation>(), OnboardingCopy.violations(TextsCallsDisclosure.allText))
    }

    @Test
    fun `every line is present`() {
        assertEquals(9, TextsCallsDisclosure.allText.size)
        TextsCallsDisclosure.allText.forEach { assertTrue("blank line in the disclosure", it.isNotBlank()) }
    }

    // ---- the route --------------------------------------------------------------------------------

    private fun item(id: String) = SetupPlan.items.single { it.id == id }

    @Test
    fun `texts, calls and contacts go to the disclosure first, in every state that has a button`() {
        assertEquals(setOf(SetupPlan.TEXTS, SetupPlan.CALLS, SetupPlan.CONTACTS), SetupPlan.DISCLOSED)
        SetupPlan.DISCLOSED.forEach { id ->
            Status.entries.forEach { status ->
                assertEquals("$id in $status", Route.Disclose, SetupPlan.route(item(id), status))
            }
        }
    }

    @Test
    fun `after Agree they reach Android's prompt, or App info once Android stopped offering it`() {
        SetupPlan.DISCLOSED.forEach { id ->
            assertEquals(Route.Request, SetupPlan.route(item(id), Status.Off, agreed = true))
            assertEquals(Route.Request, SetupPlan.route(item(id), Status.NotNow, agreed = true))
            assertEquals(Route.AppSettings, SetupPlan.route(item(id), Status.NeedsSettings, agreed = true))
        }
    }

    @Test
    fun `no other row is held behind it`() {
        SetupPlan.items.filter { it.id !in SetupPlan.DISCLOSED }.forEach { item ->
            Status.entries.forEach { status ->
                assertNotEquals("${item.id} in $status", Route.Disclose, SetupPlan.route(item, status))
            }
        }
    }
}
