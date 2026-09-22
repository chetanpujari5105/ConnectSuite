package com.chetan.connectsuite.sync.ui.clipboard

import com.chetan.connectsuite.sync.v2.ClipboardPayloads

/**
 * What the phone's Clipboard screen draws, decided out of the composable so a JVM test can call it.
 *
 * The screen used to hand-assemble two cards — the newest thing sent and the newest thing
 * received — from four scalar fields on `ClipFeature.PhoneState`. That was the whole of what the
 * phone would show of a history it was already keeping in full: twenty entries, with kind, text,
 * time and source, held for the Mac's `clip.history` and summarised for its own user as an integer.
 *
 * ### Why the rule lives here rather than in the `LazyColumn`
 *
 * `CLAUDE.md`'s defect 67: a decision a test can reach and a state nothing writes in the test's
 * reach are different things, and a suite that proves the first is silent about the second. The
 * *decisions* on this screen are which entry the phone may still make a claim about and which
 * entries merely happened, and both are pure functions of the held list. They are here, with
 * [ClipHistoryRowsTest] calling this function rather than restating it; what stays out of reach is
 * the projection's call sites inside `ClipFeature`, which need a `Context` and a `LinkServer`.
 *
 * ### The one claim this screen is allowed to make
 *
 * *"On your clipboard"* is a statement about the phone's current clipboard, and the phone may not
 * read its own clipboard while unfocused (`docs/testing.md` → Slice 11). So the only entry it can
 * say that about is the newest one to arrive from the Mac, because `ClipFeature` watched itself
 * write that one. Every older entry gets [Action.NONE]: it is a record of something that happened,
 * not a thing this phone can still vouch for.
 *
 * **That is also why older entries carry no *Copy to this phone* button, and it is a hold rather
 * than an oversight.** Re-applying an older entry is the obvious next feature and is one line of
 * UI — but `ClipFeature.apply` sets `lastReceivedApplied = true`, which is a fact about *the newest
 * arrival*, so applying an old entry would make the newest row claim it is on the clipboard when
 * something else is. The fix is to replace that boolean with the text this phone last wrote, so the
 * claim attaches to a value instead of to a position; until that is done the button would ship a
 * lie two rows above itself.
 */
object ClipHistoryRows {

    /** What the right-hand side of a card offers: nothing, a claim, or an action. */
    enum class Action {
        /** A record. Either this phone sent it, or it arrived before the newest one did. */
        NONE,

        /** This phone wrote this text to its own clipboard and watched itself do it. */
        ON_CLIPBOARD,

        /** It arrived and was not applied; a tap puts it on the clipboard. */
        COPY_TO_PHONE,
    }

    /** One card. [item] is carried whole so the screen reads the entry rather than a copy of it. */
    data class Row(
        val item: ClipboardPayloads.History.Item,
        val fromMac: Boolean,
        /** The newest Mac entry — the one [ClipFeature]'s `lastReceivedApplied` is about. */
        val isLatestFromMac: Boolean,
        val action: Action,
    )

    /**
     * Projects the held entries, **newest first as held**, onto what the screen draws.
     *
     * The order is the history's and is not re-sorted here. `ClipboardPayloads.History` already
     * owns it (`addFirst`, with duplicates collapsing to the most recent occurrence), and a second
     * sort in this file would be a second expression of the same rule — the shape `CLAUDE.md` says
     * will disagree eventually with the test being the one that is wrong.
     *
     * [lastReceivedApplied] comes from the state rather than from an item, because no
     * `History.Item` records whether it reached the clipboard: the history is what crossed, and
     * applying is something that happens to an entry afterwards.
     */
    fun of(
        items: List<ClipboardPayloads.History.Item>,
        lastReceivedApplied: Boolean,
    ): List<Row> {
        var seenMac = false
        return items.map { item ->
            val fromMac = item.source == ClipboardPayloads.SOURCE_MAC
            val isLatestFromMac = fromMac && !seenMac
            if (fromMac) seenMac = true
            Row(
                item = item,
                fromMac = fromMac,
                isLatestFromMac = isLatestFromMac,
                action = when {
                    !isLatestFromMac -> Action.NONE
                    lastReceivedApplied -> Action.ON_CLIPBOARD
                    // Nothing to put on a clipboard, so no button that would do nothing — the
                    // control-with-no-effect this project keeps deleting.
                    item.text == null -> Action.NONE
                    else -> Action.COPY_TO_PHONE
                },
            )
        }
    }
}
