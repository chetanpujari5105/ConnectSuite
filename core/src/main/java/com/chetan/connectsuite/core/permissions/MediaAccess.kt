package com.chetan.connectsuite.core.permissions

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * How much of the phone's photos and videos this app may read — **full**, **selected only**, or
 * **none** — in one place that the Photos feature, the `photos` capability and Set up Sidekick all
 * read (defect 139).
 *
 * ### Why this exists
 *
 * Android 14 added *Allow limited access*: the person picks some photos and the app sees only those.
 * This app did not declare `READ_MEDIA_VISUAL_USER_SELECTED`, so Android ran it in **compatibility
 * mode** — measured on the emulator (SDK 37): after a limited pick, `READ_MEDIA_IMAGES` and
 * `READ_MEDIA_VIDEO` read `granted=true` with `REVOKED_COMPAT|ONE_TIME`, a grant that lasts only
 * until the app leaves the foreground. The checklist said **On**; after a restart the same row said
 * **Turned off in Settings**. The person had allowed *some* photos, and was told first *all*, then
 * *none*.
 *
 * Following Android's Selected Photos Access guidance: the app declares and requests
 * `READ_MEDIA_VISUAL_USER_SELECTED` together with the two media permissions, which turns
 * compatibility mode off, and reads access in this order — full first, then selected, else none.
 *
 * ### Full means images **and** videos
 *
 * The platform's sample treats either media permission as full access. This app's `media.list`
 * serves images and videos through one list, so an images-only grant would be a browser with every
 * video missing behind a green chip — the rule `CapabilityContract` already kept. Full stays *both*.
 *
 * ### No SDK argument, on purpose
 *
 * `READ_EXTERNAL_STORAGE` is declared with `maxSdkVersion="32"` and cannot be held above it, and
 * `READ_MEDIA_VISUAL_USER_SELECTED` does not exist below 34, so the granted set alone decides the
 * answer on every API level. [requestFor] is the one place the level matters: what to *ask* for.
 */
enum class MediaAccess {
    FULL,
    SELECTED,
    DENIED,
    ;

    companion object {
        const val READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES"
        const val READ_MEDIA_VIDEO = "android.permission.READ_MEDIA_VIDEO"
        const val READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
        const val READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

        /** Each set, held whole, is full access: both media permissions on 33+, storage below. */
        val FULL_ALTERNATIVES: Set<Set<String>> = setOf(
            setOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO),
            setOf(READ_EXTERNAL_STORAGE),
        )

        /** The grant Android 14+ gives when the person allows only the photos they picked. */
        val SELECTED_ALTERNATIVE: Set<String> = setOf(READ_MEDIA_VISUAL_USER_SELECTED)

        /** Every permission this reads. */
        val ALL: Set<String> = FULL_ALTERNATIVES.flatten().toSet() + SELECTED_ALTERNATIVE

        /**
         * The sentence the Mac and the phone show for selected-only access. Written once, so the
         * `limited` reason on the wire and the phone's own wording cannot drift apart.
         */
        const val SELECTED_REASON =
            "Some photos allowed — only the photos and videos chosen on the phone are shared. " +
                "Change the selection on the phone, in Set up Sidekick."

        fun of(granted: Set<String>): MediaAccess = when {
            FULL_ALTERNATIVES.any { granted.containsAll(it) } -> FULL
            granted.containsAll(SELECTED_ALTERNATIVE) -> SELECTED
            else -> DENIED
        }

        /**
         * What to ask for on [sdk]. On 34+ the selected-photos permission goes in the same request:
         * that is what makes Android show *Allow limited access* as a real grant rather than a
         * compatibility one, and asking again is the platform's own *change selection* flow.
         */
        fun requestFor(sdk: Int): List<String> = when {
            sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
                listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED)
            sdk >= Build.VERSION_CODES.TIRAMISU -> listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO)
            else -> listOf(READ_EXTERNAL_STORAGE)
        }

        /** The access this app holds right now, read from the OS. Never cached. */
        fun current(context: Context): MediaAccess = of(
            ALL.filterTo(mutableSetOf()) {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            },
        )
    }
}
