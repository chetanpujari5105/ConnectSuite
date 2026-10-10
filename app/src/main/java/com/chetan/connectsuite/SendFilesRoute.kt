package com.chetan.connectsuite

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * The Devices tab's **Send files** button, 2026-10-10 (UX batch, section 3).
 *
 * It was drawn greyed, under *"Sending files from this phone to your Mac isn't available yet"*. That
 * stopped being true when phone → Mac sharing shipped (`share.file`, proven on hardware in B6/B7): a
 * share from Gallery or Files reaches the Mac today. So the button now opens Android's file picker and
 * hands what was picked to **the same two activities a share from any other app reaches** —
 * [ShareToMacActivity] for one file, [ShareManyToMacActivity] for several — as an ordinary `SEND` or
 * `SEND_MULTIPLE`. Nothing about the send itself is new: the Mac still asks Accept / Decline per file,
 * and every check those activities make is made the same way.
 */
object SendFilesRoute {
    enum class Target { NOTHING, ONE, MANY }

    /** Which share activity a pick of [count] files goes to. More than the cap is the many-sheet's to refuse. */
    fun target(count: Int): Target = when {
        count <= 0 -> Target.NOTHING
        count == 1 -> Target.ONE
        else -> Target.MANY
    }

    /** The intent for a pick, or null when nothing was picked (the person cancelled the picker). */
    fun intentFor(context: Context, picked: List<Uri>): Intent? {
        val clip = picked.firstOrNull()?.let { first ->
            ClipData.newRawUri(null, first).also { c -> picked.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
        }
        return when (target(picked.size)) {
            Target.NOTHING -> null
            Target.ONE -> Intent(context, ShareToMacActivity::class.java).apply {
                action = Intent.ACTION_SEND
                type = context.contentResolver.getType(picked[0]) ?: "application/octet-stream"
                putExtra(Intent.EXTRA_STREAM, picked[0])
                clipData = clip
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            Target.MANY -> Intent(context, ShareManyToMacActivity::class.java).apply {
                action = Intent.ACTION_SEND_MULTIPLE
                type = "*/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(picked))
                clipData = clip
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
    }
}
