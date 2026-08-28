package com.chetan.connectsuite

import android.app.Application
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels
import com.chetan.connectsuite.input.InputFeature
import com.chetan.connectsuite.mirror.v2.MirrorEngine
import com.chetan.connectsuite.mirror.v2.MirrorFeature
import com.chetan.connectsuite.sync.v2.CallFeature
import com.chetan.connectsuite.sync.v2.ContactsFeature
import com.chetan.connectsuite.sync.v2.NotificationFeature
import com.chetan.connectsuite.sync.v2.RemoteFeature
import com.chetan.connectsuite.sync.v2.SmsFeature

class ConnectSuiteApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Before anything that logs. LinkLog drops writes until it has a file, so installing it
        // in LinkService alone meant everything logged at process start — including the mirror
        // feature announcing itself — reached logcat and never reached link.log, which is the
        // log that survives the phone being unplugged and is therefore the one worth having.
        LinkLog.init(this)

        NotificationChannels.createAll(this)

        // Whether a visible Activity exists decides how mirroring asks for consent on Android 16,
        // so the tracking has to be running before the first mirror.start can arrive.
        AppForeground.install(this)

        // Feature modules install themselves into the link here, because :core cannot depend on
        // the modules that implement its capabilities and this is the first place that can see
        // both. Installing is what completes a capability's contract — mirror only appears on the
        // Mac once MirrorFeature has registered its handlers and taken the video channel.
        val link = LinkController.get(this)
        MirrorFeature.install(this, link)
        // Installed unconditionally, exactly like the mirror, and for the same reason: registering
        // handlers is only half the capability contract. The other half is the accessibility grant,
        // which the user gives and takes away in Settings — so `input` turns itself on and off
        // there, live, without a reconnect, and a request arriving with the service off gets a
        // sentence about how to enable it instead of "not implemented".
        //
        // The lambda is the one place that can see both feature modules: input refuses a tap while
        // the mirror is being handed blank frames, because a tap the user cannot see the target of
        // is not a tap they meant.
        InputFeature.install(this, link, contentBlocked = { MirrorEngine.isContentBlocked })

        // Phase 4. Installed unconditionally like the two above, and for the same reason: a
        // registered handler can answer "here is how to turn this on", and an unregistered one can
        // only answer "not implemented on this phone build". Each capability stays un-advertised
        // until its own permission arrives — CapabilityDetector owns that half — so a well-behaved
        // Mac never sends to a feature the user has not enabled.
        //
        // Order matters in exactly one place: contacts first, because SmsStore and CallLogStore
        // both call ContactsFeature.nameFor to turn numbers into names. Nothing breaks if it is
        // absent — name resolution degrades to null and the Mac shows the number — but installing
        // it first means the very first thread list a Mac asks for already has names on it.
        ContactsFeature.install(this, link)
        NotificationFeature.install(this, link)
        SmsFeature.install(this, link)
        CallFeature.install(this, link)
        // Last, because it reads NotificationRelay: the media remote is gated on the notification
        // listener rather than on a permission of its own. See RemoteFeature.
        RemoteFeature.install(this, link)
    }
}
