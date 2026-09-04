package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VitalsPayloadsTest {

    @Test
    fun `an unknown battery is not a flat battery`() {
        val unknown = VitalsPayloads.battery(null, charging = false)
        assertEquals(JsonNull, unknown["level"])
        assertTrue(unknown["capacityUnknown"]!!.jsonPrimitive.boolean)

        val flat = VitalsPayloads.battery(0, charging = false)
        assertEquals(0, flat["level"]!!.jsonPrimitive.int)
        // The whole point: the Mac must be able to tell these apart without inferring from a null.
        assertFalse(flat["capacityUnknown"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `a level outside 0-100 is clamped rather than sent as-is`() {
        // A ring drawn from an unclamped value overflows its own arc, silently.
        assertEquals(100, VitalsPayloads.battery(105, charging = true)["level"]!!.jsonPrimitive.int)
        assertEquals(0, VitalsPayloads.battery(-1, charging = false)["level"]!!.jsonPrimitive.int)
    }

    @Test
    fun `a refused storage reading is null, and null is not zero`() {
        val refused = VitalsPayloads.storage(null, null)
        assertEquals(JsonNull, refused["freeBytes"])
        assertEquals(JsonNull, refused["totalBytes"])

        val full = VitalsPayloads.storage(0L, 511_000_000_000L)
        assertEquals(0L, full["freeBytes"]!!.jsonPrimitive.long)
        assertEquals(511_000_000_000L, full["totalBytes"]!!.jsonPrimitive.long)
    }

    @Test
    fun `a zero total is refused rather than sent as a denominator`() {
        // A ring is free/total. A total of 0 is not a full disk, it is a failed reading, and
        // dividing by it is how a card ends up showing NaN%.
        assertEquals(JsonNull, VitalsPayloads.storage(100L, 0L)["totalBytes"])
    }

    @Test
    fun `the first reading always sends`() {
        assertTrue(VitalsPayloads.batteryChanged(null, 50, charging = false))
    }

    @Test
    fun `an unchanged reading does not send`() {
        assertFalse(VitalsPayloads.batteryChanged(50 to false, 50, charging = false))
    }

    @Test
    fun `plugging in always sends, even at the same level`() {
        // The one change the user causes and expects to see immediately.
        assertTrue(VitalsPayloads.batteryChanged(50 to false, 50, charging = true))
    }

    @Test
    fun `a level change sends`() {
        assertTrue(VitalsPayloads.batteryChanged(50 to false, 49, charging = false))
    }

    @Test
    fun `becoming unknown sends — it is a state change like any other`() {
        assertTrue(VitalsPayloads.batteryChanged(50 to false, null, charging = false))
    }
}
