package com.chetan.connectsuite.setup

/**
 * The prominent disclosure shown before Android's prompt for texts, calls or contacts.
 *
 * Google Play's Prominent Disclosure Requirement for the SMS and Call Log permission groups: in the
 * app, in the normal course of use, before the runtime prompt, saying what is accessed, how it is
 * used and where it goes, and ending in an affirmative choice. The Setup row's one line does not
 * meet that, and Android's own prompt does not count. So the Setup screen shows this first, for
 * the Texts, Calls and Contacts rows alike ([SetupPlan.DISCLOSED]) — `TextsCallsGateTest` holds
 * the gate, `TextsCallsDisclosureTest` holds the copy.
 *
 * Pure: no Android here, so the test reads the sentences the dialog draws.
 *
 * Every claim is measured against the code rather than intended:
 *  - **read:** `SmsStore` (address, body — MMS text parts only — and date), `SmsFeature`'s
 *    new-message push (`MessageType.SMS_RECEIVED`), `CallLogStore` (the call log), `CallWatcher`
 *    (`PHONE_STATE`: ringing, off-hook, the incoming number), `ContactsStore` (display name,
 *    numbers, emails, photo);
 *  - **where:** only the paired Mac, over the pinned TLS 1.3 control channel. There is no server;
 *  - **kept, phone:** none of these features writes a copy — each reads Android's provider when the
 *    Mac asks. Log lines carry counts and states;
 *  - **kept, Mac:** `desktop/src/main/sms.ts`, `calls.ts`, `contacts.ts` hold them in memory and
 *    `clear()` them on disconnect. `activity.jsonl` keeps *"Message sent/received"* with a thread
 *    number (`main.ts`, R10 — never the body) and one row per call state named by the contact or
 *    *"Unknown number"*, never the number (`shared/callRecord.ts`, R11).
 */
object TextsCallsDisclosure {

    const val TITLE = "Show your texts and calls on your Mac?"

    const val WHY = "Sidekick shows your texts and calls on the Mac you paired, so you can read " +
        "and reply to texts there and see, dial, answer or decline calls. Texts you send and calls " +
        "you start from the Mac go out through this phone."

    const val READS = "What it reads on this phone: your text messages, with their numbers and " +
        "times, including new ones as they arrive; your call log; your phone state — whether it " +
        "is ringing or in a call, and the caller's number; and, when Contacts is on, your " +
        "contacts' names, numbers, email addresses and photos."

    const val WHERE = "Where it goes: only to your paired Mac, directly over the encrypted " +
        "connection on your local network. None of it is sent to a server or to Sidekick's developer."

    const val KEPT = "What is kept: this phone keeps no copy — Sidekick reads from Android each " +
        "time your Mac asks. Your Mac keeps it in memory and drops it when it disconnects or quits. " +
        "Its Activity list keeps a line for each message (sent or received) and each call (the " +
        "contact's name or \"Unknown number\") — never message text or phone numbers."

    const val OFF = "You can turn these off at any time in Settings › Apps › Sidekick › Permissions."

    const val NEXT = "If you agree, Android asks you next."

    const val AGREE = "Agree"
    const val NOT_NOW = "Not now"

    val body: List<String> = listOf(WHY, READS, WHERE, KEPT, OFF, NEXT)

    val allText: List<String> get() = listOf(TITLE) + body + listOf(AGREE, NOT_NOW)
}
