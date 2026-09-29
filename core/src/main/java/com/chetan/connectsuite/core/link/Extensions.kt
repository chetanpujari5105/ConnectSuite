package com.chetan.connectsuite.core.link

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * `ext` on `hello` / `hello.ack` — docs/protocol.md → Extensions, rules 1–6. Pure, and the cases
 * live in `docs/fixtures/ext-negotiation.json`, which the Mac's test reads too.
 *
 * An added optional field is what keeps this protocol major version 1: an old peer's parser reads
 * payload fields by key and never sees `ext`, and a missing `ext` here is `{}`, not an error.
 */
object Extensions {

    const val SHARE_FILE = "share.file"

    /**
     * The production promise, separate from the wire version (docs/protocol.md → Extensions → the
     * `share.ask` extension). The phone advertises it **unconditionally**: on `hello.ack` it means
     * *this phone makes an ordinary share offer only where it is negotiated*, which is a promise about
     * what the phone will not do. Whether a Mac promises it is the Mac's gate, and none does yet.
     */
    const val SHARE_ASK = "share.ask"

    /**
     * What this phone build **advertises**: `share.file` 1 — offer and decline only.
     *
     * The phone half of version 2 (the transfer) is built (slice 3c) but deliberately not advertised:
     * the Mac half does not exist yet, and advertising 2 is a promise both ends must keep. Because the
     * negotiated version is `min(mine, theirs)`, keeping this at 1 makes every version-2 path
     * unreachable in a live pairing — `accept` is refused and no pull is authorised. `ExtensionsTest`
     * pins the value. **It is not raised to reach version 2**: the routes are [advertised] — every
     * handshake when [PRODUCTION_TRANSFER] is on, or one armed debug handshake ([ShareDevGate]).
     */
    val PHONE: Map<String, Int> = mapOf(SHARE_FILE to 1, SHARE_ASK to 1)

    /**
     * **Whether this phone build offers the version-2 transfer to every trusted Mac**, not only to one
     * armed debug handshake. The phone's twin of the Mac's `SHARE_PRODUCTION_READINESS`: without it a
     * production Mac advertising `share.file` 2 and `share.ask` still negotiates `min(1, 2) = 1`, and
     * ordinary Send can never enable. **On in this build and pinned by `ShareDevGateTest`** — recorded
     * with the Mac's readiness after slice 3e passed on hardware (2026-09-25) and the §11 cleanup
     * (`5e20963`). It cannot enable Send by itself: ordinary Send also needs `share.ask` negotiated,
     * which only a production Mac advertises.
     */
    const val PRODUCTION_TRANSFER: Boolean = true

    /**
     * **Release policy: several files per share (`share.file` 3) in a release build.** `false` until the
     * owner approves shipping it together with the provisional values it would ship
     * (`docs/feature-a-v3-production-enablement.md` → the decision report). It must equal
     * `@bool/share_many_enabled` in the main manifest's resources — `ShareManyManifestTest` holds the two
     * together, so the share-sheet entry and the advertised version cannot disagree.
     */
    const val MULTI_FILE_RELEASE: Boolean = false

    /**
     * **The one rule for whether this build does several files per share**: a debuggable build always
     * (the builds the owner runs and tests), a release build only once [MULTI_FILE_RELEASE] is flipped.
     * Read by [advertised], by the multi-select screen's bind, and by the single-file sheet's concurrent
     * budget — never re-derived.
     */
    fun multiFile(debuggable: Boolean, release: Boolean = MULTI_FILE_RELEASE): Boolean = debuggable || release

    /**
     * What this phone advertises **in one handshake**:
     *
     * - `share.file` 3 when the version-2 transfer is on (below) **and** [multiFile] — unless a debuggable
     *   build was asked to hold at version 2 for this one handshake ([holdV2], `ShareDevGate.holdV2`), which
     *   is how a version-2 phone is reproduced for a skew test;
     * - `share.file` 2 when [productionTransfer] is on, or a debuggable build's version-2 arm was consumed
     *   by this handshake ([ShareDevGate.process]);
     * - [PHONE] (`share.file` 1) otherwise.
     *
     * Negotiation is `min(mine, theirs)`, so a version-2 Mac still negotiates 2 with a version-3 phone.
     */
    fun advertised(
        debuggable: Boolean, devV2Armed: Boolean, productionTransfer: Boolean = PRODUCTION_TRANSFER,
        holdV2: Boolean = false, multiFileRelease: Boolean = MULTI_FILE_RELEASE,
    ): Map<String, Int> {
        val transfer = productionTransfer || (debuggable && devV2Armed)
        return when {
            transfer && multiFile(debuggable, multiFileRelease) && !(debuggable && holdV2) -> PHONE + (SHARE_FILE to 3)
            transfer -> PHONE + (SHARE_FILE to 2)
            else -> PHONE
        }
    }

    /** One handshake's two facts, decided together so `hello.ack` and negotiation cannot disagree. */
    data class Handshake(
        val advertised: Map<String, Int>,
        val negotiated: Map<String, Int>,
        val logLine: String,
        /**
         * The `share.ask` line, logged beside [logLine]. A second line rather than a longer first one:
         * the 3e runbook's pass criteria quote [logLine] byte for byte.
         */
        val askLine: String,
        /**
         * The version-3 line, logged on **every** handshake (proposal rev 4 §18): whether this build does
         * several files, the release policy, and any version-2 hold — so which version a session got, and
         * why, is in its first lines. A third line, for the same reason as [askLine].
         */
        val v3Line: String = "",
    )

    /**
     * The whole `ext` decision for one `hello`: what to advertise, what that negotiates against the
     * Mac's [macExt], and the log line saying both. The line carries version numbers and two
     * booleans only — no token, fingerprint, name or path.
     */
    fun handshake(
        debuggable: Boolean, devV2Armed: Boolean, macExt: Map<String, Int>,
        productionTransfer: Boolean = PRODUCTION_TRANSFER,
        holdV2: Boolean = false,
        multiFileRelease: Boolean = MULTI_FILE_RELEASE,
    ): Handshake {
        val mine = advertised(debuggable, devV2Armed, productionTransfer, holdV2, multiFileRelease)
        val negotiated = mine.keys.mapNotNull { name -> negotiate(mine, macExt, name)?.let { name to it } }.toMap()
        val line = "ext: phone advertises ${mine[SHARE_FILE]?.let { "share.file $it" } ?: "nothing"} " +
            "(debug share.file 2 armed for this handshake: $devV2Armed; debuggable build: $debuggable); " +
            "Mac advertises ${macExt[SHARE_FILE]?.let { "share.file $it" } ?: "no share.file"}; " +
            "negotiated ${negotiated[SHARE_FILE]?.let { "share.file $it" } ?: "no share.file"}"
        val ask = "ext: share.ask — phone advertises ${mine[SHARE_ASK] ?: "none"}, Mac advertises ${macExt[SHARE_ASK] ?: "none"}, " +
            "negotiated ${negotiated[SHARE_ASK] ?: "none"}; ordinary Send on this session: " +
            if (ordinarySend(negotiated)) "enabled (the Mac asks a person)" else "disabled"
        val v3 = "ext: share.file 3 — several files per share in this build: ${multiFile(debuggable, multiFileRelease)} " +
            "(release policy: $multiFileRelease); held at version 2 for this handshake: $holdV2; debuggable build: $debuggable; " +
            "phone advertises share.file ${mine[SHARE_FILE] ?: "none"}; negotiated share.file ${negotiated[SHARE_FILE] ?: "none"}"
        return Handshake(mine, negotiated, line, ask, v3)
    }

    /**
     * Whether an **ordinary** share offer — one a person chose in the share sheet — may be made on a
     * session with these negotiated extensions: `share.file` ≥ 2 **and** `share.ask` ≥ 1. `null` is no
     * live session. Held to `docs/fixtures/share-ordinary-send.json`, which the Mac's
     * `ordinarySendNegotiated` reads too. The debug synthetic probe does not go through this.
     */
    fun ordinarySend(negotiated: Map<String, Int>?): Boolean =
        negotiated != null && (negotiated[SHARE_FILE] ?: 0) >= 2 && (negotiated[SHARE_ASK] ?: 0) >= 1

    /** Rules 1–3: anything but an object is `{}`; a value that is not an integer ≥ 1 drops that key only. */
    fun parse(raw: JsonElement?): Map<String, Int> {
        if (raw == null || raw is JsonNull || raw !is JsonObject) return emptyMap()
        return raw.mapNotNull { (key, value) ->
            val p = value as? JsonPrimitive ?: return@mapNotNull null
            if (p.isString) return@mapNotNull null
            val n = p.longOrNull ?: return@mapNotNull null
            // `1.5` has no long form; `true` is not a number. Both land in the null branch above.
            if (n < 1 || n > Int.MAX_VALUE) null else key to n.toInt()
        }.toMap()
    }

    /** Rule 4: negotiated only when both sides advertise it, at the lower version. */
    fun negotiate(mine: Map<String, Int>, theirs: Map<String, Int>, name: String): Int? {
        val a = mine[name] ?: return null
        val b = theirs[name] ?: return null
        return minOf(a, b)
    }

    fun toJson(ext: Map<String, Int>): JsonObject = buildJsonObject { ext.forEach { (k, v) -> put(k, v) } }
}
