package com.chetan.connectsuite.sync.ui.clipboard

import com.chetan.connectsuite.sync.v2.ClipboardPayloads
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's own clipboard list.
 *
 * **What these can and cannot see, stated rather than implied.** They call
 * [ClipHistoryRows.of] — the function the composable calls — so there is no second expression of
 * the rule to drift from it. What they cannot reach is the *write*: `ClipFeature.publish` projects
 * the held entries onto `PhoneState` at five call sites, and every one of them is behind
 * `LinkLog.i` → `android.util.Log`, which is not mocked in this module. That glue is the same
 * unreached line the `pair.rejected` change carried, and it is named here rather than covered by a
 * test that would construct `PhoneState.history` by hand and prove nothing about what fills it —
 * `CLAUDE.md`, defect 67.
 *
 * Several of these build their input through the real [ClipboardPayloads.History] instead of a
 * hand-made list, for that reason: the ordering, the 20-entry cap and the refusal to store a
 * sensitive entry are its rules, and a list assembled here would be a well-formed value the product
 * may never produce.
 */
class ClipHistoryRowsTest {

    private fun item(
        text: String?,
        atMs: Long,
        fromMac: Boolean,
        kind: String = ClipboardPayloads.KIND_TEXT,
    ) = ClipboardPayloads.History.Item(
        kind = kind,
        text = text,
        atMs = atMs,
        source = if (fromMac) ClipboardPayloads.SOURCE_MAC else ClipboardPayloads.SOURCE_PHONE,
    )

    @Test
    fun `the order is the history's and is not re-sorted here`() {
        // Through the real History, so this asserts the order the product hands over rather than
        // an order this test arranged. addFirst means the last thing added is row 0.
        val history = ClipboardPayloads.History()
        history.add(item("oldest", 1_000L, fromMac = false))
        history.add(item("middle", 2_000L, fromMac = true))
        history.add(item("newest", 3_000L, fromMac = false))

        val rows = ClipHistoryRows.of(history.newestFirst(), lastReceivedApplied = false)

        assertEquals(listOf("newest", "middle", "oldest"), rows.map { it.item.text })
    }

    @Test
    fun `direction comes from the source, both ways`() {
        val rows = ClipHistoryRows.of(
            listOf(item("from the mac", 2_000L, fromMac = true), item("from here", 1_000L, fromMac = false)),
            lastReceivedApplied = false,
        )
        assertTrue(rows[0].fromMac)
        assertFalse(rows[1].fromMac)
    }

    @Test
    fun `only the newest Mac entry is the latest, even with Mac entries above and below it`() {
        val rows = ClipHistoryRows.of(
            listOf(
                item("phone, newest overall", 5_000L, fromMac = false),
                item("mac, the newest one", 4_000L, fromMac = true),
                item("mac, older", 3_000L, fromMac = true),
                item("mac, older still", 2_000L, fromMac = true),
            ),
            lastReceivedApplied = false,
        )
        assertEquals(listOf(false, true, false, false), rows.map { it.isLatestFromMac })
    }

    @Test
    fun `a list with nothing from the Mac has no latest and offers nothing`() {
        val rows = ClipHistoryRows.of(
            listOf(item("a", 2_000L, fromMac = false), item("b", 1_000L, fromMac = false)),
            // True, and it must not matter: with nothing from the Mac there is nothing the flag is
            // about. A row claiming "On your clipboard" here would be the screen asserting
            // something about an entry that never arrived.
            lastReceivedApplied = true,
        )
        assertTrue(rows.none { it.isLatestFromMac })
        assertTrue(rows.all { it.action == ClipHistoryRows.Action.NONE })
    }

    @Test
    fun `the applied flag lands on the newest Mac entry and nowhere else`() {
        val rows = ClipHistoryRows.of(
            listOf(
                item("mac, newest", 3_000L, fromMac = true),
                item("phone", 2_000L, fromMac = false),
                item("mac, older", 1_000L, fromMac = true),
            ),
            lastReceivedApplied = true,
        )
        assertEquals(ClipHistoryRows.Action.ON_CLIPBOARD, rows[0].action)
        // The older Mac entry must NOT claim it. This is the whole reason the flag is read
        // positionally rather than splashed over every Mac row: "On your clipboard" is a statement
        // about the phone's current clipboard, and only one entry can be true of it.
        assertEquals(ClipHistoryRows.Action.NONE, rows[1].action)
        assertEquals(ClipHistoryRows.Action.NONE, rows[2].action)
    }

    @Test
    fun `an unapplied newest Mac entry offers the copy action instead of the claim`() {
        val rows = ClipHistoryRows.of(
            listOf(item("waiting for a tap", 1_000L, fromMac = true)),
            lastReceivedApplied = false,
        )
        assertEquals(ClipHistoryRows.Action.COPY_TO_PHONE, rows[0].action)
    }

    @Test
    fun `nothing this phone sent offers an action`() {
        val rows = ClipHistoryRows.of(
            listOf(item("mine", 1_000L, fromMac = false)),
            lastReceivedApplied = false,
        )
        assertEquals(ClipHistoryRows.Action.NONE, rows[0].action)
    }

    @Test
    fun `an entry with no text offers no button, because the button would do nothing`() {
        val rows = ClipHistoryRows.of(
            listOf(item(null, 1_000L, fromMac = true)),
            lastReceivedApplied = false,
        )
        assertTrue(rows[0].isLatestFromMac)
        assertEquals(ClipHistoryRows.Action.NONE, rows[0].action)
    }

    @Test
    fun `a sensitive entry cannot reach the rows, because it never reaches the history`() {
        // Asserted through the real History rather than by filtering here. A guard in
        // ClipHistoryRows would be a second home for a rule ClipboardPayloads already owns, and
        // the two would eventually disagree — the shape CLAUDE.md names, with the test being the
        // one that is wrong.
        val history = ClipboardPayloads.History()
        val stored = history.add(
            item("hunter2", 2_000L, fromMac = true, kind = ClipboardPayloads.KIND_SENSITIVE),
        )
        history.add(item("ordinary", 1_000L, fromMac = true))

        assertFalse("a sensitive item must not be stored at all", stored)
        val rows = ClipHistoryRows.of(history.newestFirst(), lastReceivedApplied = false)
        assertEquals(listOf("ordinary"), rows.map { it.item.text })
    }

    @Test
    fun `an empty history draws no rows rather than one empty one`() {
        assertTrue(ClipHistoryRows.of(emptyList(), lastReceivedApplied = true).isEmpty())
    }

    @Test
    fun `every held entry is drawn — the list is not silently truncated`() {
        // The screen shows what the phone holds, which is the whole point of the change. A cap
        // applied here would make the footer's count disagree with the rows above it.
        val history = ClipboardPayloads.History()
        repeat(ClipboardPayloads.HISTORY_MAX) { i ->
            history.add(item("entry $i", i.toLong(), fromMac = i % 2 == 0))
        }
        val held = history.newestFirst()
        assertEquals(ClipboardPayloads.HISTORY_MAX, held.size)
        assertEquals(held.size, ClipHistoryRows.of(held, lastReceivedApplied = false).size)
    }
}
