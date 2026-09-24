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
     * What this phone build **advertises**: `share.file` 1 — offer and decline only.
     *
     * The phone half of version 2 (the transfer) is built (slice 3c) but deliberately not advertised:
     * the Mac half does not exist yet, and advertising 2 is a promise both ends must keep. Because the
     * negotiated version is `min(mine, theirs)`, keeping this at 1 makes every version-2 path
     * unreachable in a live pairing — `accept` is refused and no pull is authorised. Raise it in the
     * commit that lands the Mac half, not before. `ExtensionsTest` pins the value.
     */
    val PHONE: Map<String, Int> = mapOf(SHARE_FILE to 1)

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
