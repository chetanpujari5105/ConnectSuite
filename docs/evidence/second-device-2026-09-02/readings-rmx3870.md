# RMX3870 (realme P1 5G) — readings, 2026-09-02

Every row is labelled with the handset. The SM-S938B was never on the USB bus this session and none
of its state was read or changed.

## Device

```
RMX3870 · realme P1 5G · brand realme · MediaTek (ccmni* interfaces)
Android 16, sdk 36, first_api_level 34 · realme UI, oplusrom V16.0.0 / display 16.0.5
patch 2026-06-01 · build BP2A.250605.015 · users: 0 (Vyanktesh) ONLY, no clone user
```

## The install

| | |
|---|---|
| reading | `Success`, 20.6 s for the 93 MB debug APK |
| **prediction that was WRONG** | I predicted moderate-to-high probability of realme UI's `INSTALL_FAILED_USER_RESTRICTED` ("Install via USB"). It did not fire. Recorded as a surprise |
| control | `pm list packages -f` shows `/data/app/~~TFW6j…/com.chetan.connectsuite.debug-…/base.apk`; `grep -c connectsuite` = 1 against 217 for `android` on the same query |

## §3.E — the clone-user control. **Settled, and the replacement is stronger**

The audit's §6.3 asks for "a device with no clone user, to re-establish the permission controls
without user 95". **This is that device**: `pm list users` returns user 0 only.

The control that replaces it is a pre/post pair on user 0, and it is cleaner than the Samsung's:

| | granted=true | of listed |
|---|---|---|
| immediately after install, before any tap | **0** | 14 |
| after the user granted by hand | **14** | 14 |

Both readings from the same query on the same user. The Samsung's control ("user 95 reads false")
was a *different user* standing in for a *different time*; this is the same user at two times, which
is the thing actually being claimed. **Recommendation: this becomes the standard control, and the
user-95 form is retired to a footnote about why the Samsung's readings still stand.**

## Phase 6 — the highest-value block, and it produced an unexpected result

`docs/phase-6-brief.md` §0 says the SM-S938B is *already exempt from battery optimisation*, so the
obvious experiment measures the wrong path — the instrument's own state contaminating the reading.

**The same thing happened here, within minutes of install, and the product did it.**

```
$ adb shell dumpsys deviceidle whitelist | grep -i connectsuite
user,com.chetan.connectsuite.debug,10445
```

Read as a matched line, not a count (the `persisted=0x0` lesson): the prefix is **`user`**, one of 42
user entries beside 9 `system` and 13 `system-excidle`. The app holds
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: granted=true`. So a fresh install, taken through onboarding,
**exempts itself** — the unexempt path is not merely untested, the product removes the state you
would need in order to test it. That is a stronger statement than §0 makes.

### `am set-standby-bucket` — accepted, and does nothing

`CLAUDE.md` records that on the SM-S938B `am set-standby-bucket … 5` is **refused**, and concludes
the unexempt path "needs a second device". Here it is **accepted and ignored**:

| step | result |
|---|---|
| `am get-standby-bucket <pkg>` | `5` |
| `am set-standby-bucket <pkg> 40` | empty output (accepted) |
| `am get-standby-bucket <pkg>` | **`5`** — unchanged |
| `am set-standby-bucket <pkg> 10` | empty output (accepted) |
| `am get-standby-bucket <pkg>` | **`5`** — unchanged |

`5` is `STANDBY_BUCKET_EXEMPTED`, which is consistent with the whitelist entry above: an exempt app
cannot be moved out of EXEMPTED, and the shell command reports success regardless. **A command that
accepts an argument and changes nothing is the "decoration" failure at the tooling layer** — the exit
status is not the property; the re-read is.

**Hypothesis, NOT established, and testable on both handsets:** the Samsung's refusal and this
device's silent no-op may have the same cause — the package is whitelisted, so the bucket is pinned.
If so, Phase 6's unexempt path does **not** need a second device; it needs
`dumpsys deviceidle whitelist -<pkg>` first, then the bucket becomes settable. Untested. It changes
device state and was not run without asking.

## Provenance sweep — three handsets

| Component | SM-S938B | RMX3870 (realme P1 5G) | CPH1859 (realme 1) |
|---|---|---|---|
| SAF picker | `com.google.android.documentsui`, `/data/app`, **v17**, targetSdk 37 | `com.google.android.documentsui`, `/data/app`, **v17**, versionCode 371020480, targetSdk 37, updated 2026-07-10 — **plus** `/product/overlay/GoogleDocumentsUIOverlay.apk` and a system fallback at v16 | `MtkDocumentsUI`, `/system/priv-app`, **v9**, frozen |
| MediaStore | APEX `com.android.mediaprovider` | APEX, `MediaProviderGoogle@371020440`, versionName 17 | `/system/priv-app`, v1.50.0, no `/apex` at all |
| Telephony provider | **`SecTelephonyProvider.apk`** | `/system_ext/priv-app/TelephonyProvider/TelephonyProvider.apk` | `/system/priv-app/TelephonyProvider/TelephonyProvider.apk` |
| Contacts / call log | `com.samsung.android.providers.contacts` | `/system_ext/priv-app/ContactsProvider` | `/system/priv-app/ContactsProvider` |
| Clone user | 95 `DUAL_APP` | **none** | 999 `multiApp` |
| Framework subclassing | One UI | `OplusBatteryService`, `OplusAthenaSystemService`, `OplusIsolatedSystemService`, `OplusFileObserveService`, `OplusThumbnailService` | `OppoActivityManagerService`, `OppoAppFreezeService`, `OppoGuardElfService` |

**The picker line is the one that matters.** The RMX3870 runs the *same DocumentsUI build* as the
Samsung — Google's, `/data/app`, versionName 17. So the SAF refusal rows can be compared with the
vendor isolated, which is exactly what §6.1 asked for and did not expect to get from a realme.

## Instrument faults caught this session (all named, none written down as findings)

| Instrument | Wrong output | Cause |
|---|---|---|
| `ls -d /data/app/*/` (CPH1859) | `0` third-party packages | glob refused to the shell uid; `pm list packages -f` says 69 of 259 |
| `ls /apex \| grep -c mediaprovider` (RMX3870) | `0` | `ls /apex/` is **Permission denied** to shell; `ls -d /apex/com.android.mediaprovider` resolves fine and `pm` reports an `/apex` codePath |
| `awk '/^###? .*\b17\b/'` on `docs/defects.md` | no defect 17 | `##?` matches one or two `#`; the heading is `### 17` |
| `logcat -s SafProbe:*` | zsh "no matches found" | unquoted glob; the filter never reached adb |
| `uiautomator dump` after `am start` of the probe | our onboarding "About mirroring" page | the probe never ran (`probe run start` = 0 against an 11,692-line buffer); the user was in Settings and had focus |

## Not yet reached, and why

- **SAF probe (the headline reading).** `SafProbeActivity` did not run — the phone was in use. Needs
  a quiet moment; no taps required, the probe aims the picker with `--es initial` and the reading is
  the confirm button's `enabled` attribute in a `uiautomator dump`.
- **Pairing / defect 17.** `wifi_on=0`, `wlan0` has no address, the phone is on IPv6-only cellular
  (`ccmni1` + `v4-ccmni1` CLAT at 192.0.0.4/32). There is no path to the Mac. Needs a tap.
- **Defect 50** (bound `date < ?`). Needs the app's own client, which needs the link.

---

# Added after the RMX3870 was paired — the SAF reading, and defect 17 resolved

## Defect 17 — what actually happened, and it is not a refusal

The Mac's slot now reads `"deviceName": "Realme RMX3870"`, `pairedAt` 1788351566735, `lastAddress`
`172.30.30.252`, `lastDiscoveryVia: "gateway"`. The SM-S938B entry (`deviceId 81744ed3…`,
fingerprint `2F:97:0F:EC…`) is **gone**. `connectsuite.json` mtime moved 13:52 → 17:49.

`main.ts:1759 ipcMain.handle('forget-device')` sets `paired` to `null`; `link.ts:450` writes the new
one. So defect 17's description is **accurate** — one slot, refuses a second while occupied — and the
slot was cleared deliberately through the UI before the realme was paired. The wall was not tested;
it was stepped around by the documented route. **The Samsung must be re-paired by QR to come back.**

Only one Electron instance is running, on the default user-data dir. The second-instance workaround
was not used.

## §3.A — the SAF refusals. **Converted from `unknown, single-device` to confirmed across two vendors**

Three runs of `SafProbeActivity`, aimed with `--es initial`, read by `uiautomator dump`. **No taps.**
Probe log confirms `targetSdk=36` — the restriction is applied against our calling package at the
same target level as the Samsung.

| Run | `USE THIS FOLDER` | Refusal copy | nodes |
|---|---|---|---|
| **DCIM — the control** | **`enabled="true"`** | none | 91 |
| storage **root** | **`enabled="false"`** | *"Can't use this folder"* / *"To protect your privacy, choose another folder"* | 118 |
| **`Download`** | **`enabled="false"`** | same two strings | 121 |

`package="com.google.android.documentsui"` on all three dumps. The control returned a non-trivial
positive, so the two negatives are readings rather than lookalikes.

**This reproduces the SM-S938B exactly, on a different OEM, at the same picker build (Google's
DocumentsUI versionName 17, `/data/app`).** The audit's verdict — *AOSP/Mainline, versioned by
DocumentsUI, not Samsung's* — is now supported by comparison rather than by provenance reasoning
alone. `docs/single-device-audit.md` §3.A rows 1 and 2 can move from **unknown, single-device** to
**confirmed on two vendors at DocumentsUI v17**.

**Two caveats that must travel with it.** First, this is a comparison at *one picker version* — §6.4's
expiry-date obligation is unchanged, and the RMX3870 also carries
`/product/overlay/GoogleDocumentsUIOverlay.apk`, which did not alter the outcome here but is an OEM
overlay on the package under test. Second, the CPH1859 shows the other half of the risk: its picker
is MediaTek's, frozen at v9, so "the wall is Google's and Play-updated" is true of *these two* and
false of that one.

**`EXTRA_INITIAL_URI` is honoured here too** — all three runs opened where aimed. The Slice 9 row
gains a second device at the same picker version.

## Defect 50 — one page only, which is not a result

```
17:49:29 I [sms] sms.threads delivered (50 threads, hasMore=true) — 1 delivered / 0 refused since start
```

Page one returned rows. **By this repo's own precondition that is not evidence** — a provider pager is
recorded on *consecutive* pages, counted, on hardware. Defect 50's symptom is precisely a first page
that succeeds and a second that returns an empty cursor. **Status: not tested.** It needs the Mac to
request page two.

## `fs.list` / defect 55 — not exercisable as granted

One folder is shared (`primary:DCIM`), holding **5 entries**, snapshot in 360 ms. Too small to say
anything about the 490 s → 21 s finding. Needs a large directory granted.

## Link is live on this handset

Tag histogram over 187 log lines: `mirror` 67, `caps` 29, `clip` 20, `input` 14, `fs` 13, `media` 10,
`applabel` 6, `tls` 5, `server` 5, `sms` 3, `calls` 3, `remote` 2. Mirroring negotiated H.264 at
1080x2400/60 and ran; a clipboard push arrived and was **held for a tap** (the phone's auto-apply
default, off — correct); `fs.list` roots and DCIM both served.
