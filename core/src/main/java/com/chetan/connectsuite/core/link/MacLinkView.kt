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
 * - [canSendFiles] — **a Mac is connected.** Until 2026-10-10 this was false whatever the link said,
 *   because the only send path then was v1's `TransferManager.send`. Phone → Mac sharing has shipped
 *   since (`share.file`, proven in B6/B7), and the button now hands picked files to the same share
 *   activities a Gallery share reaches (`SendFilesRoute`). A send needs a Mac on the other end, so
 *   that is the gate, and [SEND_FILES_REASON] says so when there is none.
 */
data class MacLinkView(
    val paired: Boolean,
    val connected: Boolean,
    val name: String?,
    val address: String?,
) {
    val canSendFiles: Boolean get() = connected

    companion object {
        /** Shown under Send files while no Mac is connected, because an unavailable control needs its reason. */
        const val SEND_FILES_REASON =
            "Sending files needs your Mac connected."

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
