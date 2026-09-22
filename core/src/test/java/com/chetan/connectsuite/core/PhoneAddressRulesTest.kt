package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.PhoneAddressRules
import com.chetan.connectsuite.core.link.PhoneAddressRules.Candidate
import com.chetan.connectsuite.core.link.PhoneAddressRules.Reach
import com.chetan.connectsuite.core.link.PhoneAddressRules.Transport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Which address the pairing screen offers a Mac.
 *
 * **The first test is the defect, reconstructed from the hardware reading**, and the ordering in it
 * is the whole point rather than incidental: on the SM-S938B the cellular interface came *first*,
 * because `NetworkInterface` enumerates by index and `rmnet_data0` is 103 against `swlan0`'s 124. A
 * version of this suite that listed Wi-Fi first would pass against the broken rule.
 *
 * What these reach: [PhoneAddressRules] is the whole decision, and it is pure, so the test calls the
 * function the product calls. What they do not reach is the gathering — `ConnectivityManager` and
 * `NetworkInterface` both need a device, so `PhoneAddress.transportsByInterface` is covered by the
 * hardware re-run recorded in `docs/testing.md` and by nothing here. Stated rather than papered
 * over with a mock that would prove only that the mock returns what it was told to.
 */
class PhoneAddressRulesTest {

    private fun cellular(name: String, address: String) =
        Candidate(name, address, PhoneAddressRules.reachOf(Transport(cellular = true)))

    private fun wifi(name: String, address: String) =
        Candidate(name, address, PhoneAddressRules.reachOf(Transport(wifi = true)))

    private fun unclaimed(name: String, address: String) =
        Candidate(name, address, PhoneAddressRules.reachOf(null))

    @Test
    fun `a cellular interface is not chosen when a wifi one is also available`() {
        // The measured SM-S938B state, with the real addresses and the real order.
        val chosen = PhoneAddressRules.choose(
            listOf(
                cellular("rmnet_data0", "100.64.25.19"),
                wifi("swlan0", "10.36.14.60"),
            ),
        )
        assertEquals("10.36.14.60", chosen?.address)
        assertEquals("swlan0", chosen?.interfaceName)
    }

    @Test
    fun `the cellular address is refused even when it is the only thing offered`() {
        // Null rather than a best effort: a Mac cannot dial a CGNAT address, so offering it buys a
        // person a number to type and a timeout with no explanation. The caller draws NoNetwork,
        // which tells them to get on Wi-Fi — the thing that would actually work.
        assertNull(PhoneAddressRules.choose(listOf(cellular("rmnet_data0", "100.64.25.19"))))
    }

    @Test
    fun `an unclaimed interface beats a cellular one`() {
        // A tether or Wi-Fi Direct interface the framework does not model is unknown, not
        // disqualified. Excluding on silence would answer "no network" on the first OEM that models
        // one differently.
        val chosen = PhoneAddressRules.choose(
            listOf(
                cellular("rmnet_data0", "100.64.25.19"),
                unclaimed("ap0", "192.168.43.1"),
            ),
        )
        assertEquals("192.168.43.1", chosen?.address)
    }

    @Test
    fun `a wifi interface beats an unclaimed one even when the unclaimed one comes first`() {
        val chosen = PhoneAddressRules.choose(
            listOf(
                unclaimed("ap0", "192.168.43.1"),
                wifi("wlan0", "192.168.1.24"),
            ),
        )
        assertEquals("192.168.1.24", chosen?.address)
    }

    @Test
    fun `among equally local addresses the caller's order wins`() {
        // Interface index is a fine tiebreak between two addresses a Mac could equally reach. It
        // was only ever wrong as a decision BETWEEN tiers, which is the bug this fixes.
        val chosen = PhoneAddressRules.choose(
            listOf(wifi("wlan0", "192.168.1.24"), wifi("eth0", "10.0.0.5")),
        )
        assertEquals("192.168.1.24", chosen?.address)
    }

    @Test
    fun `nothing at all yields nothing`() {
        assertNull(PhoneAddressRules.choose(emptyList()))
    }

    // --- reachOf ---------------------------------------------------------------------------------

    @Test
    fun `a VPN is wide-area even when it also reports wifi`() {
        // Order inside reachOf is load-bearing: a VPN's capabilities carry TRANSPORT_VPN and often
        // the underlying transport too, so checking wifi first would hand a Mac the inside of a
        // tunnel.
        assertEquals(Reach.WIDE_AREA, PhoneAddressRules.reachOf(Transport(vpn = true, wifi = true)))
    }

    @Test
    fun `wifi and ethernet and an explicit local-network capability are all local`() {
        assertEquals(Reach.LOCAL, PhoneAddressRules.reachOf(Transport(wifi = true)))
        assertEquals(Reach.LOCAL, PhoneAddressRules.reachOf(Transport(ethernet = true)))
        // swlan0 on the measured handset reports WIFI, so this is a bonus signal rather than the
        // one the fix depends on — but a network the platform calls local is local.
        assertEquals(Reach.LOCAL, PhoneAddressRules.reachOf(Transport(localNetwork = true)))
    }

    @Test
    fun `cellular is wide-area and an unknown interface is not`() {
        assertEquals(Reach.WIDE_AREA, PhoneAddressRules.reachOf(Transport(cellular = true)))
        assertEquals(Reach.UNCLAIMED, PhoneAddressRules.reachOf(null))
        // A network that claims the interface but reports no transport we know: still not a reason
        // to drop it.
        assertEquals(Reach.UNCLAIMED, PhoneAddressRules.reachOf(Transport()))
    }

    @Test
    fun `a cellular network that also carries local-network capability is treated as local`() {
        // Deliberate: the platform calling something a LAN outranks the radio underneath it, which
        // is what a cellular-backed hotspot looks like from inside.
        assertEquals(
            Reach.LOCAL,
            PhoneAddressRules.reachOf(Transport(cellular = true, localNetwork = true)),
        )
    }
}
