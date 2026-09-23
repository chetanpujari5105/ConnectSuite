package com.chetan.connectsuite.core.link

/**
 * Everything the Mac is told about capabilities: which are on offer, and the phone's own sentence
 * for each one that is not.
 *
 * This type exists because the two halves have different lifetimes and only one of them was being
 * watched. Defect 27: revoke notification access on a live link and `notifications` correctly
 * disappears, but the *reason* attached to it read "granted in Settings, but Android has not
 * started the service — turn the switch off and on again", for a grant that had just been taken
 * away. The corrected sentence was computed 255ms later by the `ContentObserver` and never sent,
 * because the decision to send compared capability **names** and the name set had not moved.
 *
 * That is the same grant-versus-running confusion as defects 18, 21 and the gate-2 work, reached
 * from a fourth direction: a name is not the whole of what the Mac renders, so a name is not the
 * whole of what "changed" can mean.
 */
data class AdvertisedState(
    /** What is on offer. Authoritative, and still the thing every consumer gates on. */
    val names: Set<String>,
    /** Why each absent capability is absent. Same payload the wire carries as `unavailable`. */
    val reasons: Map<String, String>,
    /**
     * Advertised capabilities that work only in part, and why — the wire's `limited` (defect 139).
     * Part of the state for the same reason `reasons` is: full → selected-only photos leaves the
     * name set unchanged, and a comparison of names alone would never tell the Mac.
     */
    val limits: Map<String, String> = emptyMap(),
)

/**
 * True when anything the Mac would render has changed — **names or reasons**.
 *
 * `refresh()` calls exactly this, so a reason that changes on its own is a change. Every remaining
 * feature has grant states that move without the name set moving: a permission granted while the
 * component behind it is still down reads as the same absent capability with a different remedy,
 * and the remedy is the part the user acts on.
 */
fun advertisementChanged(previous: AdvertisedState?, current: AdvertisedState): Boolean =
    previous != current
