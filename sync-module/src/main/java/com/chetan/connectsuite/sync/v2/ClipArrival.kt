package com.chetan.connectsuite.sync.v2

/**
 * What to do with a clipboard entry arriving from the Mac.
 *
 * ### Why this is a function and not two `if`s at the call site
 *
 * The phone had a rule with no home: *apply when the owner asked for auto-apply*. It was written as
 * a single boolean read inside `ClipFeature.onPush`, and the notification that tells the owner it
 * happened was posted **after** the write, on a path that silently no-ops when it cannot post. So
 * the two were never connected, and the state nobody designed — **applied, unreportable** — was
 * reachable and was reached seven times on the author's own phone before anybody looked.
 *
 * ### The invariant
 *
 * **This phone does not replace a clipboard it cannot tell you it replaced.**
 *
 * That is not caution, it is the same measurement the whole namespace is shaped around and it is
 * already written into `docs/protocol.md`: the phone may not read its clipboard while unfocused, so
 * unlike the Mac it **cannot see what it would destroy, cannot keep it, and cannot put it back**.
 * The Mac can apply on arrival because it holds the displaced entry and `Restore` is a real undo.
 * The phone's auto-apply has no undo, and the notification is the entire compensation for that — it
 * is what makes an unrecoverable overwrite something the owner knows about. Remove the notification
 * and auto-apply is not a faster version of the same feature, it is a different one that nobody
 * consented to when they turned the setting on.
 *
 * So deliverability is not a nicety to be checked after the fact. It is a **precondition of the
 * write**, evaluated before it, and this type is what makes the two impossible to separate again.
 */
enum class ClipArrival {
    /** Auto-apply is on and the result can be reported. Write the clipboard, post the notification. */
    APPLY,

    /** Auto-apply is off. Offer it; the owner taps to apply. */
    OFFER,

    /**
     * Nothing can be shown to the owner, so nothing is written.
     *
     * The entry still enters the history — it is not discarded, and it is visible the moment the
     * owner opens the app. What does not happen is a silent mutation of the device.
     */
    KEEP_ONLY;

    /** True when this phone's clipboard is written without the owner having tapped anything. */
    val writesClipboard: Boolean get() = this == APPLY

    companion object {
        /**
         * [autoApply] is the owner's setting. [canNotify] is whether *this arrival* can be reported
         * at all — both the runtime grant and the Settings switch, see [NotificationDelivery].
         *
         * Note that [canNotify] gates **both** branches. An `OFFER` that cannot be posted is not a
         * gentler failure than an unreportable `APPLY`; it is an entry the owner is never told
         * about, and calling it "offered" in a log line would be the ack meaning *asked* while the
         * caller reads *shown*.
         */
        fun of(autoApply: Boolean, canNotify: Boolean): ClipArrival = when {
            !canNotify -> KEEP_ONLY
            autoApply -> APPLY
            else -> OFFER
        }
    }
}
