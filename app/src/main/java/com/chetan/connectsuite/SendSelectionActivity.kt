package com.chetan.connectsuite

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.core.content.IntentCompat
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

        // A re-creation (the platform restoring this activity) carries the same intent as the start that
        // already sent it. One tap is one send; a restored instance finishes without sending again.
        if (savedInstanceState != null) {
            LinkLog.i("clip", "selection route: restored instance finished without sending — the first start already ran")
            finish()
            return
        }

        // Both extras as `CharSequence`: a sender that keeps formatting puts a `Spanned` in `EXTRA_TEXT`,
        // and `getStringExtra` answers that with null — see `SelectionIntent`.
        val processText = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
        val sendText = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)

        // A text **file** (My Files `.txt`, `.csv`…) carries a stream: it is a file share, and goes to
        // the file sheet with its read grant passed on. Only text without a stream is a selection.
        val stream = intent?.let { IntentCompat.getParcelableExtra(it, Intent.EXTRA_STREAM, Uri::class.java) }
        val hasText = SelectionIntent.hasText(processText, sendText)
        if (ShareTextRoute.of(intent?.action, stream != null, hasText) == ShareTextRoute.Route.FILE) {
            LinkLog.i("share", "text-typed SEND carries a stream (type=${intent?.type}); handed to the file sheet")
            startActivity(
                Intent(intent)
                    .setClass(this, ShareToMacActivity::class.java)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            )
            finish()
            return
        }

        // Each action reads only its own extra; the route is named on every line below, because a send
        // that worked through the share sheet is no evidence that the toolbar route works.
        val read = SelectionIntent.read(intent?.action, processText, sendText)

        // `EXTRA_PROCESS_TEXT_READONLY` is the platform asking whether we intend to *replace* the
        // selection. We never do — the result is not set and nothing is returned — so the flag is
        // read only to say so in the log, where a future reader would otherwise wonder.
        val readOnly = intent?.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false) ?: false

        // `referrer` is the platform's answer to "who sent this", and it is the platform's rather
        // than the sender's — a package name in an extra would be the sender's word for it. It goes to
        // the Mac's label and **never into the log**: which app a person selected in is theirs.
        val fromPackage = referrer?.host

        val outcome = when (read) {
            is SelectionIntent.Read.Text -> ClipFeature.sendSelectedText(applicationContext, read.text, fromPackage)
            is SelectionIntent.Read.NoText, is SelectionIntent.Read.UnsupportedAction -> {
                ClipFeature.selectionCarriedNoText(read.route.logName, read is SelectionIntent.Read.UnsupportedAction)
                SelectionSend.Outcome.Empty
            }
        }

        LinkLog.i(
            "clip",
            "selection route: ${read.route.logName} (${read.javaClass.simpleName}) referrer=${if (fromPackage != null) "present" else "absent"} " +
                "chars=${(read as? SelectionIntent.Read.Text)?.text?.length ?: 0} readOnly=$readOnly → ${outcome.javaClass.simpleName}",
        )

        // The sentences live in `SelectionSend` beside the decision, so the test runs the strings
        // the user sees rather than a second copy of them.
        Toast.makeText(applicationContext, SelectionSend.message(outcome), Toast.LENGTH_SHORT).show()
        finish()
    }

}
