package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.model.DeviceType

/**
 * The paired Mac as the phone's screens show it — **one** projection of the v2 link, read by the
 * Devices overview and by Mac settings alike. Defect 145.
 *
 * ### Why this exists
 *
 * The Devices screen took its Mac state from `Device.isConnected`, which `DeviceRepository` fills
 * from `ConnectionManager.connectedDevices` — the **v1** Android-to-Android transport. The Mac never
 * connects over v1; it connects to [LinkServer]. So with the link up and Mac settings reading
 * *Connected*, Devices said *Offline*, *waiting for it to connect* and *Not connected* (measured on
 * the SM-S938B, 2026-09-23). A true reading of the wrong one of two transports.
 *
 * `ConnectionManager` is left alone: Sync's Android-to-Android paths read it, and putting the Mac
 * into it would make a v1 set claim a connection it does not carry.
 *
 * ### What each field is, and where it comes from
 *
 * - [connected] — [LinkState.isConnected]: a control session is up. A session exists only for a
 *   pinned peer (an unpaired Mac is refused before one is made), so this is the paired Mac.
 * - [name] — the live session's peer name, else the trusted row's.
 * - [address] — the trusted row's last address, which is what Mac settings shows too.
 * - [canSendFiles] — **false, whatever the link says.** Sending from the phone runs through
 *   `TransferManager.send`, which needs a v1 connection the Mac never has; a phone-initiated
 *   transfer to the Mac is Feature A, blocked on a protocol decision. Lighting the button on the v2
 *   link would put it in front of a sure failure, so the gate is the fact that decides whether it
 *   can work — see [SEND_FILES_REASON].
 */
data class MacLinkView(
    val paired: Boolean,
    val connected: Boolean,
    val name: String?,
    val address: String?,
) {
    val canSendFiles: Boolean get() = false

    companion object {
        /** Shown under the disabled Send files, because a greyed control needs its reason. */
        const val SEND_FILES_REASON =
            "Sending files from this phone to your Mac isn't available yet — send them from the " +
                "Files pane on your Mac instead."

        fun of(link: LinkState, trusted: List<TrustedDeviceEntity>): MacLinkView {
            val mac = trusted.firstOrNull { it.type == DeviceType.DESKTOP }
            return MacLinkView(
                paired = mac != null || link.isConnected,
                connected = link.isConnected,
                name = link.clients.firstOrNull() ?: mac?.name,
                address = mac?.lastAddress,
            )
        }
    }
}
