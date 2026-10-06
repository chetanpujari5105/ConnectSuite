package com.chetan.connectsuite.sync.v2

import java.util.EnumMap

/**
 * The phone → Mac clipboard sync that runs when `MainActivity` gains window focus — its decision,
 * with nothing Android in it, so every branch has a **name** and a JVM test can reach it.
 *
 * ### Why this exists
 *
 * Stage D's A4 (2026-10-06 23:28) started `MainActivity` once and **no clipboard event followed** —
 * 0 phone `clip` lines, 0 Mac arrivals — and the cause could not be read from either log, because
 * `ClipFeature.onWindowFocused` had four exits that returned without a word: the feature not
 * installed, the window not focused, the clipboard empty or holding no text, and an unchanged
 * clipboard. That breaks this project's rule that a skip is logged at the volume of a success.
 *
 * This file does **not** explain A4. It makes the next occurrence explicable: every focus event now
 * ends in exactly one [Reason], logged by name with the running counts of every reason beside it,
 * and with **no clipboard text, no length that identifies it beyond a byte count, and no app name**.
 *
 * ### The order is a claim
 *
 * | # | Reason | Why here |
 * |---|---|---|
 * | 1 | [Reason.NOT_INSTALLED] | no link object at all: nothing below can be asked |
 * | 2 | [Reason.NOT_FOCUSED] | the platform refuses the read; a refusal must never be reported as empty |
 * | 3 | [Reason.EMPTY], [Reason.NON_TEXT], [Reason.SENSITIVE], [Reason.TOO_LARGE] | what the read held |
 * | 4 | [Reason.NO_LINK] | after the read, as before: the read is legal now and the line says what was held back |
 * | 5 | [Reason.ECHO], [Reason.UNCHANGED] | last: the only guards that need the link's own history |
 *
 * [echo] is a function so it is only *called* once 1–4 have passed, which a throwing test double
 * proves rather than asserts — the same technique as `SelectionSendTest`.
 */
object FocusSync {

    /** What the clipboard read produced. `REFUSED` is the platform saying no, never "empty". */
    enum class Read { REFUSED, EMPTY, NON_TEXT, SENSITIVE, TOO_LARGE, TEXT }

    /** Every way a focus event ends. Exactly one per event. */
    enum class Reason {
        NOT_INSTALLED,
        NOT_FOCUSED,
        EMPTY,
        NON_TEXT,
        SENSITIVE,
        TOO_LARGE,
        NO_LINK,
        ECHO,
        UNCHANGED,
        SENT,
    }

    fun decide(
        installed: Boolean,
        read: () -> Read,
        hasLiveSession: () -> Boolean,
        echo: () -> ClipEcho.Decision,
    ): Reason {
        if (!installed) return Reason.NOT_INSTALLED
        when (read()) {
            Read.REFUSED -> return Reason.NOT_FOCUSED
            Read.EMPTY -> return Reason.EMPTY
            Read.NON_TEXT -> return Reason.NON_TEXT
            Read.SENSITIVE -> return Reason.SENSITIVE
            Read.TOO_LARGE -> return Reason.TOO_LARGE
            Read.TEXT -> Unit
        }
        if (!hasLiveSession()) return Reason.NO_LINK
        return when (echo()) {
            ClipEcho.Decision.Echo -> Reason.ECHO
            ClipEcho.Decision.Unchanged -> Reason.UNCHANGED
            ClipEcho.Decision.Send -> Reason.SENT
        }
    }

    /**
     * One sentence per reason for the log. Each says what happened and that nothing was sent, except
     * [Reason.SENT], whose line is written by the send itself. None of them names the text or the app.
     */
    fun logSentence(reason: Reason): String = when (reason) {
        Reason.NOT_INSTALLED -> "the clipboard feature is not installed in this process; nothing read"
        Reason.NOT_FOCUSED -> "the platform did not report this window focused at the read; nothing read"
        Reason.EMPTY -> "the clipboard was empty; nothing sent"
        Reason.NON_TEXT -> "the clipboard held an item with no text (an image, a link to a file, or similar); nothing sent"
        Reason.SENSITIVE -> "the clipboard held an entry an app flagged sensitive; not read into a payload, nothing sent"
        Reason.TOO_LARGE -> "the clipboard held more than the byte cap; refused rather than truncated, nothing sent"
        Reason.NO_LINK -> "no Mac is connected; nothing sent and nothing remembered as sent"
        Reason.ECHO -> "identical to the last entry received from the Mac; nothing sent"
        Reason.UNCHANGED -> "unchanged since the last send; nothing sent"
        Reason.SENT -> "sent"
    }
}

/**
 * Counts of a closed set of reasons, rendered in declaration order with **every** reason present —
 * a zero is printed, because a reason missing from the line and a reason that never happened are
 * different facts, and only one of them is a reading.
 */
class ReasonTally<E : Enum<E>>(private val all: List<E>) {
    private val counts = EnumMap<E, Long>(all.first().declaringJavaClass)

    @Synchronized
    fun record(reason: E): Long {
        val next = (counts[reason] ?: 0L) + 1
        counts[reason] = next
        return next
    }

    @Synchronized
    fun count(reason: E): Long = counts[reason] ?: 0L

    @Synchronized
    fun total(): Long = counts.values.sum()

    @Synchronized
    fun line(): String = all.joinToString(" ", postfix = " (total ${total()})") { "$it=${counts[it] ?: 0L}" }
}
