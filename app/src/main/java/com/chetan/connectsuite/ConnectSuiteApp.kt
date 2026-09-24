package com.chetan.connectsuite

import android.app.Application
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels
import com.chetan.connectsuite.input.InputFeature
import com.chetan.connectsuite.mirror.v2.MirrorEngine
import com.chetan.connectsuite.mirror.v2.MirrorFeature
import com.chetan.connectsuite.sync.v2.AppsFeature
import com.chetan.connectsuite.sync.v2.CallFeature
import com.chetan.connectsuite.sync.v2.ClipFeature
import com.chetan.connectsuite.sync.v2.VitalsFeature
import com.chetan.connectsuite.sync.v2.ContactsFeature
import com.chetan.connectsuite.sync.v2.FsFeature
import com.chetan.connectsuite.sync.v2.MediaFeature
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

        // Feature A's startup sweep, synchronously and before anything that could stage: offers and
        // staged copies live in memory only, so after a process death every entry in
        // cache/share-staging/ is an orphan. It deletes only entries it can prove are Sidekick's —
        // regular files, never a symlink, named like an attempt, a finished copy only with its owner
        // marker — and leaves and counts anything else (`ShareStagingTest`).
        ShareToMacModel.startupSweep(cacheDir)

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
        // Phase 5 slice 2: three of photos' four verbs. `media.original` is slice 3, so installing
        // this does *not* turn the capability on — CapabilityContract requires all four handlers
        // and a served bulk channel, and neither is true yet. It is installed anyway so the verbs
        // exist and can be exercised; a Mac asking for one gets an answer rather than
        // FEATURE_UNAVAILABLE from an unregistered type.
        MediaFeature.install(this, link)
        // Phase 5, the transfer slice: four of `files`' six verbs. `fs.transfer.begin` and
        // `fs.transfer.cancel` are not here yet, so installing this does **not** turn the
        // capability on — CapabilityContract requires all six handlers and a served bulk channel.
        // That is the same designed inconsistency `photos` sat in through slice 2, and the fix to
        // avoid is the same one: do not loosen `containsAll` to a subset check.
        //
        // Installed anyway so the verbs exist and answer. A registered handler can say "this phone
        // has not shared that folder, add it under Sync > Folders"; an unregistered one can only
        // say "not implemented on this phone build".
        FsFeature.install(this, link)
        // Phase 5, the clipboard slice. All three verbs, and the capability turns on with them —
        // there is no permission and no special access to wait for, which is itself the finding:
        // the accessibility grant this used to be gated on guards a rule this device does not
        // implement (docs/testing.md, Slice 11).
        //
        // The asymmetry is the platform's and it is carried in the answers rather than in the
        // advertisement: Mac to phone works whenever the link is up, phone to Mac only in the
        // moment MainActivity has window focus, and `clip.request` to a backgrounded phone answers
        // PHONE_NOT_FOREGROUND rather than pretending the clipboard is empty.
        ClipFeature.install(this, link)
        // O4's Device status card. Handles nothing — it only pushes battery.state and storage.state.
        VitalsFeature.install(this, link)
        // Phase 7, the apps slice. Three verbs and no launch verb: this platform refuses a
        // background activity start *silently*, so opening an app is a notification the user taps.
        // The capability turns on with POST_NOTIFICATIONS, because that tap is the only route there
        // is — see CapabilityContract and docs/protocol.md.
        AppsFeature.install(this, link)
        // Last, because it reads NotificationRelay: the media remote is gated on the notification
        // listener rather than on a permission of its own. See RemoteFeature.
        RemoteFeature.install(this, link)
    }
}
