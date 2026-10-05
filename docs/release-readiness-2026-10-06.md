# Release readiness — 2026-10-06 (overnight, unsupervised)

> **What this is.** A matrix of the product's features against the evidence that exists for each, so
> the next supervised session can decide what a first public release contains. **It is not a release
> verdict, and Sidekick is not ready to ship** — see *Blockers*. Nothing here was run on the phone or
> in the running app; every "tonight" result is a JVM test, a `node --test` run or a synthetic renderer
> harness. Hardware evidence is cited from `docs/testing.md` and the phase close-outs, which hold the
> readings — this file only points at them.

## What is counted

A **feature** is one row of PRODUCT.md's behavioural target (*"notification mirroring with reply,
SMS and MMS threads, call events and dialling, contacts, file transfer both directions, a photo and
video browser with drag to Finder, bidirectional clipboard with history, screen mirroring with
control, app launching, and a media remote"*), plus the things a stranger meets before any of them —
pairing, reconnect, the Mac's own notifications, Activity, Settings — and the four capabilities that
exist in code behind gates (phone-to-Mac sharing, block-verified pulls, Camera v1, the webcam).
**22 rows.** A row is not a pane and not a protocol type; the counts in `docs/remaining.md` and
`docs/phase-7-state.md` count other things and are not comparable to this one.

Status words: **shipped** (built, on in a release build) · **gated** (built, off in a release build
by a flag or a build fact) · **incomplete** (built, with a known gap a user would hit) · **deferred**
(not built, decided) · **unsupported** (a platform wall; never claim it).

## The matrix

| # | Feature — what the user should get | Status | Automated evidence | Hardware evidence (one SM-S938B unless said) | Remaining blocker | First public release? |
|---|---|---|---|---|---|---|
| 1 | **Pairing** — scan one QR on the phone; TLS 1.3, fingerprints pinned both ways | shipped | `identityPair`, `pairingArm`, `pairRejection`, `pairSteps` tests | Phase 1, 2026-08-25; F2/F4/F5 2026-09-03 | Bundle id changed 2026-09-17: every existing pairing must be re-made (by design) | **Yes** |
| 2 | **Reconnect & discovery** — last address → gateway → mDNS → manual; returns after sleep, boot, update | shipped | `link*`, `session`, `linkHealth` tests; phone `BootAutoStartTest` | Phase 6, 2026-09-03: boot, Doze, crash, update (`docs/phase-6-closeout.md` §1) | One handset only; **defect 17** (one phone at a time, the second refused); other OEMs unknown (§2 of the close-out) | Yes, with "one phone" stated |
| 3 | **Notifications** — mirror, reply, actions, dismiss | shipped | `notifications`, `notificationsView`, `liveNotifications`; phone `NotificationTargetRuleTest` | Phase 4 steps; closed 2026-08-31 | Tonight's log-privacy fixes (`98f8e3d`, `840adc9`) are **not on the phone or in the running Mac app** | **Yes** |
| 4 | **Mac notifications** — native banners for phone notifications | shipped | `nativeNotify`, `notifyCooldown` | 2026-09-04 (defects 83, 84) | — | **Yes** |
| 5 | **SMS / MMS threads** — read, reply in a thread | shipped | `sms`, `smsView`, `smsThreads`; phone `SmsLogPrivacyTest` (new) | step 71, 2026-08-31; pager 32 on hardware | — | **Yes** |
| 6 | **New SMS conversation** — send to a number with no thread | incomplete | `smsView` (4 tests for the no-thread half) | explicit-address path, step 71 | **Defect 30**: the no-thread half proven with fakes only | Yes, if one supervised send passes; otherwise say "reply only" |
| 7 | **Calls** — ringing/active events, dial, answer, reject, call log | shipped | `calls`, `callsView` (+2 tonight), `callRecord`; phone `CallLogPrivacyTest` | step 70, 2026-08-31 | `559f1da` (no caller in phone logs) committed, **not installed** | **Yes** |
| 8 | **Call audio on the Mac** | **unsupported** | `callAudio` (the one approved sentence) | SCO fails from both ends, 2026-09-14 (`docs/mac-audio-routes.md`) | A wall | **No — never claim it** |
| 9 | **Incoming-call banner on the Mac** | gated (development only, forced off when packaged) | `callBanner` 22 tests; packaged-gate guard (new, `f6a2fa1`) | none | Needs one supervised ring | No |
| 10 | **Contacts** | shipped | `contacts`, `contactsView` | Phase 4 | — | **Yes** |
| 11 | **Media remote** — now playing, transport, seek, artwork | shipped | `remote`, `remoteView`, `mediaSessionRow` | step 67, 2026-08-28 | **Defect 38**: a volume change made on the phone never reaches the Mac (deferred) | Yes |
| 12 | **Files, Mac → phone** — send into `Download/ConnectSuite` and granted folders, with resume | shipped | `filesPush`, `filesResume`, `filesView` (+1 tonight); phone `FsArrivalTest` | Phase 5, 2026-09-01 | — | **Yes** |
| 13 | **Files, phone → Mac** — browse granted folders, pull, drag to Finder | **incomplete** | `filesListing`, `filesView`, `bulkBlockPull` | Phase 5, 2026-09-01; **then defect 137 (2026-09-23): every granted SAF tree lists 0 entries on this phone** | **Defect 137, open, cause unknown** (the provider answers an empty cursor); `Download/ConnectSuite` unaffected | Only `Download/ConnectSuite` can be promised until 137 is understood |
| 14 | **Block-verified pulls above 64 MiB** (`fs.blocks`) | gated (`FS_BLOCKS_RELEASE = false`) | `fsBlocks`, `bulkBlockPull`, `pullResume` | development runs | Release decision | Not in the first release unless flipped deliberately |
| 15 | **Photos & video browser** — albums, grid, preview, save original, drag to Finder | shipped | `photos`, `photosView` (+3 tonight), `photosPull` | Phase 5; limited access, defect 139 verified 2026-09-23 | — | **Yes** |
| 16 | **Clipboard** — Mac → phone automatic; phone → Mac when Sidekick is open on the phone; history | shipped | `clipboard*`, `clipEcho`, `clipWatchPolicy` | Slices 11–13, 2026-09-01/02 | Phone → Mac is **not** automatic — a platform wall; say so | **Yes**, with the wall stated |
| 17 | **Screen mirroring + control**, floating window | shipped | `mirrorSession`, `captureFit`, `float*`, `pointerGestures` | 2026-09-10 (defect 100 traced to the app being background-restricted, not a code defect; frames measured) | Every start needs a tap on the phone (wall); secure surfaces are black (wall); **defect 100's register row still reads open** — reconcile it | **Yes** |
| 18 | **Apps** — list with icons; "open on phone" asks via a phone notification | shipped | `apps`, `appsView`; `check-apps-verb` | 123/123 packages, 2026-09-03 | It is an *ask*, not a launch (measured); never call it "launch" | Yes, named honestly |
| 19 | **Phone → Mac sharing** ("Send to Mac" share sheet) | gated — a packaged build advertises `share.file 1` only (`SHARE_V3_RELEASE`, `SHARE_WAIT_RELEASE` false) | `share*` tests | development runs from 2026-09-25 | Release decision; what a packaged phone user sees is a decline | Not unless flipped deliberately |
| 20 | **Camera v1** — phone camera preview inside the Camera pane | gated (debuggable phone builds only) | `camera`, `cameraView`; phone `CameraStreamTest` (de-flaked tonight) | two supervised sessions 2026-10-02 | Most of the plan unrun (`docs/camera-v1.md`) | No |
| 21 | **Phone as Mac webcam** (`webcam.*`) | deferred — signing, extension activation | `webcam*` tests; Swift 140 tests (not run tonight) | encoder spike PASS 28/28, 2026-10-05; **defect 177 open** | Signing, notarization, Camera Extension; native and `webcam.keyframe` desktop code not matched for hardware | **No — never claim meeting-app compatibility** |
| 22 | **Activity history, Settings, light/dark, start at login** | shipped | `activity` (+5 tonight), `appearance`, `settingsControls` | 2026-09-16 (light theme) | The pending call-data rewrite of `activity.jsonl` runs at next launch — irreversible by design; reviewed tonight (`87a8b29`) | **Yes** |

**Counts, from this table only:** shipped 14 (rows 1–5, 7, 10–12, 15–18, 22) · incomplete 2
(6, 13) · gated 4 (9, 14, 19, 20) · deferred 1 (21) · unsupported 1 (8) — 22 in all. "Shipped" means
on in a release build with hardware evidence on one phone; it does not mean verified for release.

## Release blockers, most severe first

1. **No signed, notarized build of either app.** The `.dmg`'s app is ad-hoc signed and Gatekeeper
   returns an error rather than a verdict (D12); the release APK cannot be installed without a
   signing config (D13); the configs exist with blank credentials. Needs the Apple Developer Program
   and a release keystore — both outside this session's permissions.
2. **Defect 137** — phone → Mac browsing of granted folders shows 0 entries on the only test phone.
   Until its cause is known, the Files feature can only promise `Download/ConnectSuite`.
3. **Nothing tonight is installed.** Five privacy fixes (`559f1da` from before, plus `98f8e3d`,
   `4b3159f`, `0c8a9fe`, `840adc9`) and every UI fix are in source only. The phone runs an APK that
   still logs caller numbers; the Mac runs a `dist/` that predates all of it.
4. **One handset.** Every hardware reading is one SM-S938B (two phones for some, per
   `docs/second-device-moto-g34.md`). Phase 6's reliability fixes may be One UI workarounds
   (`docs/phase-6-closeout.md` §2, three rows with no route).
5. **Defect 30's no-thread send** — one consenting send, proven absent from both providers first.
6. **D4: no application icon.** A stranger sees the default Electron icon.
7. **Rename re-pair.** Every Mac on this build mints a new identity (bundle id change); every
   already-paired phone must scan again. Fine for a first release, but it must be said in its notes.

## Exclude from public claims

Call audio on the Mac (unsupported); the phone as a webcam for meeting apps (deferred, unsigned);
automatic phone → Mac clipboard (a wall); "launch any app" (it is an ask on the phone); background
screen capture or capture without a tap on the phone (a wall); more than one phone per Mac (defect
17); anything outside the local network (no relay; Tailscale is a documented manual path); "every
Android phone" (one handset tested); any latency, throughput or fps figure not measured on the
named device — the harness numbers in `docs/overnight-2026-10-06.md` are this Mac with synthetic
data and say nothing about the link.
