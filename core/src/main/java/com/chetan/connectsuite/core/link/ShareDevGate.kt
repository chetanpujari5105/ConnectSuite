package com.chetan.connectsuite.core.link

import java.util.concurrent.atomic.AtomicBoolean

/**
 * The phone's development-only request to advertise `share.file: 2` — Feature A slice 3e, runbook §1
 * (`docs/phase-7-share-3e-runbook.md`). The Mac's twin is `desktop/src/main/shareActivation.ts`.
 *
 * ### How it fails closed
 *
 * - **Off by default, and off after every process start.** The flag is one field in memory. Nothing
 *   here — or anywhere — persists it: no preferences, no file, no database. A restart, a reinstall or
 *   a reboot returns the phone to `share.file: 1`.
 * - **One handshake per arm.** [consumeForHandshake] reads and clears in one step, so an arm applies
 *   to exactly the next trusted `hello` and to no reconnect after it.
 * - **A debuggable build only.** Arming changes nothing on its own: [Extensions.advertised] also
 *   requires the build to be debuggable, so the flag and the build type are two independent fences.
 * - **One writer.** [arm] is called only by the debug-manifest-only, `DUMP`-gated
 *   `ShareDevV2Activity` (`app/src/debug`), which a release build does not contain.
 *   `ShareDevGateRoutingTest` holds that true.
 *
 * `ControlSession` consumes the arm only **after** the pairing check has accepted the Mac, so a Mac
 * that is refused neither gets version 2 nor uses up the arm.
 */
class ShareDevGate {
    private val armed = AtomicBoolean(false)

    fun arm() = armed.set(true)

    fun disarm() = armed.set(false)

    fun isArmed(): Boolean = armed.get()

    /** Read-and-clear: true at most once per [arm]. */
    fun consumeForHandshake(): Boolean = armed.getAndSet(false)

    companion object {
        /** The one instance for this process. A new process is a new, unarmed instance. */
        val process = ShareDevGate()

        /**
         * **The version-3 arm** — `share.file: 3`, several pending offers (docs/protocol.md → Share →
         * Version 3, PROPOSED; proposal rev 4 §18). Development only, and failing closed exactly like
         * [process]: memory only, one handshake per arm, a debuggable build only
         * ([Extensions.advertised]), and one writer — the debug-manifest-only, `DUMP`-gated
         * `ShareDevV3Activity`. A separate instance so arming 3 never arms or consumes the version-2
         * arm, and the other way round.
         */
        val v3 = ShareDevGate()
    }
}
