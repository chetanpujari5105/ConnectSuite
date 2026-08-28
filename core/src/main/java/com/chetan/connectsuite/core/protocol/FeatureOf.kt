package com.chetan.connectsuite.core.protocol

/**
 * Which capability a message type belongs to.
 *
 * An `error` names the feature it belongs to, and the Mac uses that name to grey out one pane.
 * That name has to be a **capability name**, because that is what `hello.ack` advertises and what
 * the Mac's UI is keyed on — an error naming anything else greys out nothing, silently, and the
 * user is left with a pane that looks fine and does not work.
 *
 * It used to be `envelope.type.substringBefore('.')`, which is the same thing only when the prefix
 * and the capability happen to be spelled identically. They do for `mirror` and `input`, which is
 * why nothing has gone wrong yet, and they do not for **five** of the eleven remaining features:
 *
 * | Prefix | Capability | Same? |
 * |---|---|---|
 * | `notif` | `notifications` | no |
 * | `call` | `calls` | no |
 * | `clip` | `clipboard` | no |
 * | `fs` | `files` | no |
 * | `media` | `photos` | no |
 * | `mirror`, `input`, `sms`, `contacts`, `remote`, `apps` | same | yes |
 *
 * docs/protocol.md has carried this as a known unfixed bug against the photo browser since the
 * audit, with the note that it needs "an explicit prefix→capability table before its handlers
 * land". This is that table, and it is written before Phase 4's handlers rather than after,
 * because Phase 4 is where the first mismatches actually ship.
 *
 * Worth recording how the list got to five: it was written with three entries, from reading the
 * message-type list by eye, and `ProtocolNamespaceTest` immediately found `clip` and `fs`. Two of
 * five missed by inspection is the argument for the test being exhaustive over `MessageType`
 * rather than a list of the cases someone thought of.
 *
 * The [Capability] name is returned rather than the prefix, so a caller never has to know which of
 * the two it is holding.
 */
object FeatureOf {

    /**
     * Message prefix to capability, for the prefixes where they differ.
     *
     * Only the exceptions are listed. A prefix that already spells its capability needs no entry,
     * and adding one would be a second place to keep in sync for no gain — but a *new* prefix that
     * matches no capability is a mistake, which is what [ProtocolNamespaceTest] checks.
     */
    private val exceptions: Map<String, String> = mapOf(
        "notif" to Capability.NOTIFICATIONS,
        "call" to Capability.CALLS,
        "clip" to Capability.CLIPBOARD,
        "fs" to Capability.FILES,
        "media" to Capability.PHOTOS,
    )

    /**
     * The capability [type] belongs to, or null when it belongs to none.
     *
     * Null is the honest answer for `hello`, `ping`, `error` and the rest of the system messages:
     * they are not a feature, and naming one would grey out a pane because the heartbeat hiccuped.
     */
    fun of(type: String): String? {
        val prefix = type.substringBefore('.')
        // A type with no dot is a system message — `hello`, `ping`, `ack`. substringBefore returns
        // the whole string for those, which must not be matched against a capability by accident.
        if (!type.contains('.')) return null
        exceptions[prefix]?.let { return it }
        return if (prefix in Capability.all) prefix else null
    }
}
