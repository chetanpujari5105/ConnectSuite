package com.chetan.connectsuite

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.ClipFeature
import com.chetan.connectsuite.sync.v2.SelectionSend

/**
 * **Send selected text to the Mac from wherever you are** — the one cheap trigger the platform
 * permits, and it is not a way around the clipboard wall.
 *
 * ### Why this exists
 *
 * Android refuses a background clipboard read to every app. Measured on this handset in Slice 11
 * (0 of 150 background reads, with our accessibility service bound *and* disabled) and re-measured
 * in Slice 17 against three more entry points: a notification action's broadcast and a
 * quick-settings tile are both refused at `importance=125`, **silently** — `primaryClip` returns
 * null and throws nothing — while a focused activity reads 1,623 characters of the same clipboard
 * in the same four-second window.
 *
 * So the phone can only *read* its clipboard while ConnectSuite is on screen, and the honest cost
 * of the feature was: copy, then go and open the app.
 *
 * **`ACTION_PROCESS_TEXT` does not read the clipboard.** The selected text arrives in
 * `EXTRA_PROCESS_TEXT`, put there by the app the user selected it in. There is no clipboard call on
 * this path, so the rule that governs clipboard calls is not engaged — it is not circumvented and
 * there is nothing here that a future Android could tighten without also breaking every translate,
 * search and dictionary entry in the same menu. Ten shipping apps on this device use the same
 * mechanism (Slice 17), which is what says it is a normal way to do this rather than a trick.
 *
 * The gesture becomes: long-press, then tap **Send to Mac** in the same toolbar Copy is in.
 *
 * ### What it deliberately does not do
 *
 * It does **not** also write the phone's clipboard. A menu item that quietly replaced what you had
 * copied would be destroying state the user did not offer, and on this side there is no undo —
 * the phone cannot read its clipboard while unfocused, so it cannot know what it would be
 * displacing (defect 79, and the reason auto-apply is off by default here).
 *
 * ### No UI, and therefore a sentence every time
 *
 * The activity is translucent and finishes immediately, so a Toast is the only thing the user gets.
 * Every outcome produces one, including the refusals: a trigger that silently does nothing is worse
 * than an absent one, and it is precisely what a person cannot debug from the far side of a room.
 */
class SendSelectionActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = when (intent?.action) {
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        }

        // `EXTRA_PROCESS_TEXT_READONLY` is the platform asking whether we intend to *replace* the
        // selection. We never do — the result is not set and nothing is returned — so the flag is
        // read only to say so in the log, where a future reader would otherwise wonder.
        val readOnly = intent?.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false) ?: false

        // `referrer` is the platform's answer to "who sent this", and it is the platform's rather
        // than the sender's — a package name in an extra would be the sender's word for it.
        val fromPackage = referrer?.host

        val outcome = if (text == null) {
            SelectionSend.Outcome.Empty
        } else {
            ClipFeature.sendSelectedText(applicationContext, text, fromPackage)
        }

        LinkLog.i(
            "clip",
            "selection route: action=${intent?.action} from=${fromPackage ?: "unknown"} " +
                "chars=${text?.length ?: 0} readOnly=$readOnly → ${outcome.javaClass.simpleName}",
        )

        // The sentences live in `SelectionSend` beside the decision, so the test runs the strings
        // the user sees rather than a second copy of them.
        Toast.makeText(this, SelectionSend.message(outcome), Toast.LENGTH_SHORT).show()
        finish()
    }

}
