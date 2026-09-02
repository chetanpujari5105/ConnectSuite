# Predictions for the RMX3870 (realme P1 5G), written BEFORE any install

Written 2026-09-02, after a read-only sweep and before `adb install`. Nothing was installed and no
state on any handset was modified when this was written. The SM-S938B has not been on the USB bus at
any point this session.

**Known at time of writing (readings, not predictions):**

```
RMX3870 · ro.vendor.oplus.market.name = "realme P1 5G" · brand realme
Android 16, sdk 36, first_api_level 34 · realme UI / oplusrom V16.0.0, display 16.0.5
patch 2026-06-01 · fingerprint realme/RMX3870IN/RE5C86L1:16/BP2A.250605.015/...
users: 0 (Vyanktesh) ONLY — no clone user
SAF picker: com.google.android.documentsui, /data/app, versionName 17, versionCode 371020480,
            targetSdk 37, lastUpdate 2026-07-10  ← same version as the SM-S938B's v17
            PLUS /product/overlay/GoogleDocumentsUIOverlay.apk (an OEM overlay on that package)
            PLUS a system fallback DocumentsUIGoogle at versionName 16
MediaProvider: /apex/com.android.mediaprovider/.../MediaProviderGoogle@371020440, versionName 17
Telephony:  /system_ext/priv-app/TelephonyProvider/TelephonyProvider.apk  (no Sec/oplus prefix)
Contacts:   /system_ext/priv-app/ContactsProvider/ContactsProvider.apk
Framework:  OplusBatteryService, OplusAthenaSystemService, OplusIsolatedSystemService,
            OplusFileObserveService, OplusThumbnailService resident
Network:    wifi_on=0, wlan0 has NO inet addr; on IPv6-only cellular via ccmni1 + v4-ccmni1 CLAT
Mac:        connectsuite.json paired slot = "Samsung SM-S938B", fingerprint pinned, autoConnect true
App APK:    minSdk 29, targetSdk 36  → 29 <= 36, so no sdk barrier
```

## What I expect to break, in order

1. **The install may be refused by realme UI's "Install via USB" restriction** —
   `INSTALL_FAILED_USER_RESTRICTED`. ColorOS/realme UI gates adb installs behind a developer-options
   toggle and sometimes a per-install confirmation. **Moderate-to-high probability.** If it fires it
   needs a tap and I will stop and ask rather than tap.
2. **Even on a successful install, the app has no path to the Mac.** Wi-Fi is off, `wlan0` carries no
   address, and the phone is on IPv6-only cellular. Pairing cannot be *attempted*, let alone refused.
   Needs a tap.
3. **The notification-listener and accessibility bindings need taps**, by contract. Not a finding.
4. **Defect 17 then refuses this phone.** Confirmed live above: one slot, holding the Samsung, with a
   pinned fingerprint. Predicted symptom: the handshake is rejected before it completes and scanning
   the new QR does not help. **I will record this and stop, not work around it.**

So my order prediction is: **installer → network → grants → defect 17.** Note that on the CPH1859 I
predicted the installer would be the wall and it was; here I expect the wall to be reached at step 4
for the first time, which is the first time defect 17 becomes testable at all.

## What I predict the readings will SAY, if we get past 1–3

| Prediction | Confidence | What would make it wrong |
|---|---|---|
| **The SAF storage-root and `Download` refusals reproduce**, with `USE THIS FOLDER` disabled and the same privacy string | **High.** The picker is Google's at the *same versionName 17* as the Samsung | `GoogleDocumentsUIOverlay.apk` in `/product/overlay` is an OEM overlay on that exact package. If the refusals do NOT reproduce, **suspect the overlay before concluding anything about realme** |
| **Defect 50 does NOT reproduce** — a bound `date < ?` on `mms-sms/conversations` returns rows here | **High.** The provider is not `SecTelephonyProvider` | If it *does* reproduce, defect 50 is not Samsung's and the audit's §3.C verdict is wrong |
| **§3.E's clone-user control is settled by this device** — it has only user 0 | **Certain**, already read | — |
| **Consequence I must honour:** every permission reading here needs a different control than "user 95 reads false". I will use pre-grant/post-grant on user 0 | — | — |
| **Defect 55's `fs.list` cost: same shape, different constant** | Medium | — |
| **`am set-standby-bucket` works here where the SM-S938B refuses it**, opening Phase 6's unexempt path that `CLAUDE.md` says needs a second device | Medium | The Samsung's refusal may be an AOSP restriction rather than Samsung's |
| **This handset kills backgrounded services differently from One UI** — `com.oplus.battery`, `com.oplus.athena`, `com.oplus.securityguard`, `OplusIsolatedSystemService` | Medium-high, and this is the **highest-value** thing this device offers | — |

## A correction to my CPH1859 write-up, recorded before it propagates

I reported `am get-standby-bucket` returning `5` as "not an AOSP bucket constant (10/20/30/40/45/50)".
**That was wrong.** `STANDBY_BUCKET_EXEMPTED = 5` is a real AOSP constant, hidden rather than public.
Both realme handsets returning `5` for system packages is ordinary EXEMPTED, not a vendor remap.
