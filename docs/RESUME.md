# Resume here — written 2026-09-25 (overnight): Feature A, up to the live-device gate

> A state report for whoever picks this up. Evidence: `docs/testing.md` → *Feature A overnight,
> 2026-09-25*. Contract: `docs/protocol.md` → Extensions (`share.ask`) and Share. Live run:
> `docs/phase-7-share-3e-runbook.md`.

## 0 · State

**Four local commits on `clipboard-watcher-and-phase-5-close`, nothing pushed.** Code, docs and
automated tests only. No `adb`, no device or emulator touched, nothing installed, no offer sent, no
bytes moved. The running Mac app (pid 82426, started 2026-09-24 18:37) was not quit, relaunched or read.

| Commit | What |
|---|---|
| `015b210` | test-config typecheck: 7 errors → 0 (ambient renderer types; one index access) |
| `7520e8f` | **`share.ask`** — a separate ext key that tells a production Mac (asks a person) from the synthetic-only development Mac. No Mac build can advertise it |
| `0f2de7e` | the phone's Send to Mac sheet after *Ready*: Waiting → Sending → Saved only on the Mac's verified verdict, Unconfirmed, Stopped with a reason; Send enabled only by `share.ask` |
| `de9db75` | the Mac card: saved name said once, compact finished cards, newest offer on top (it was being hidden below finished cards) |

Tests: Mac **1109/1109**; both `tsc` configs clean; phone **763 / 0 failures**; all commit guards green.
Candidate APK unchanged: 95,011,036 bytes, SHA-256 `0afc695f…` (built from `65b66a0`, **not installed**).
Mac free space at the end: ~2.6 GiB.

## 1 · What is still blocked, and on what

- **Ordinary Android Send is still disabled in every live pairing**, by construction: the phone enables
  it only when `share.ask` is negotiated, and `SHARE_PRODUCTION_READINESS` pins both Mac facts false.
- **Production enablement needs two things, and only the first is a run:**
  1. **3e passed on hardware** — the runbook, needing your approval (§3 below).
  2. **Temporary-file cleanup scoped to the receive folder** (runbook §11). This is a *proposed* design
     you have not approved; it decides what may be deleted in a person's own folder, so it was **not
     built**. It needs your decision before anyone writes it.
- **A decision I took that you may want to reverse:** leaving the phone's sheet *after* an offer does
  not withdraw it (a person walking to the Mac often lets the screen switch off). The staged copy is
  still always deleted when the offer ends. Reversing it is one line in `onLeave` plus one test.
- **Unmeasured:** P3 (what the card tray covers in the real window); the Compose sheet itself; the
  `requireAsk` branch inside `ShareFeature.offerStaged` (needs a live session).
- Still open from before: defects 30 (no-thread half), 51; 17/33/38 deferred.

## 2 · For the 3e run, three things changed tonight — read before starting

- **Mac:** `npm start` (runbook §4.6) rebuilds from HEAD, so the Mac will now also log
  `share.ask not advertised — the phone's ordinary Send stays disabled: <3 blockers>`. Expected; the
  first blocker names the open development gate. **`share.ask ADVERTISED` would be a STOP.**
- **Phone:** the verified candidate APK predates tonight, so it writes **no** `ext: share.ask …` line —
  expected (runbook §4.8 note). A build from HEAD would write it, and it must say `disabled`.
- **Card:** new offers now appear on top and finished cards are shorter; §7's `onScreen` read should
  come back `visible`.

## 3 · Morning checklist — the supervised Samsung → Mac synthetic transfer (runbook 3e)

Run with you present and the phone unlocked. Every step is the runbook's; this is the order.

1. **Approve**, in words, before step 3: *"Run 3e: install the verified candidate APK on the SM-S938B,
   relaunch the Mac app with the three development switches, arm `share.file 2` once, send the 0-byte
   and 4,096-byte synthetic probes into the scratch folder, and run N1."* Also say which APK: the
   **verified candidate `0afc695f…`** (my recommendation — already checked against §4.3, and Send is
   disabled in it anyway) or a fresh build of HEAD (then §4.3 must be re-run on the new file).
2. Free space: `df -m /System/Volumes/Data` ≥ 1024 MiB (was ~2.6 GiB); `cd desktop && npm test` green.
3. §4.1 `scripts/target-device.sh samsung` → `OK target RZCY12330DT (SM-S938B, sdk 36)`.
4. §4.3 re-check the APK you chose (package, certificate `d3a505d2…7d26`, `ShareDevV2Activity` + DUMP).
5. §4.4 baseline (user-0 grant **names**, listener, accessibility, pairing, `link-up.sh` with
   `ANDROID_SERIAL=RZCY12330DT`) → §4.5 install `-r`, restart `MainActivity` by name, same readings again.
6. §4.6 quit the Mac app (⌘Q), confirm 0 sessions, relaunch with the switches and the two digests.
   Expect `ADVERTISED (development, synthetic-only, scratch folder only)`, the new `share.ask not
   advertised` line, and a first handshake negotiating **1**.
7. §4.7 inventory `~/Downloads/Sidekick` and the configured folder; no `dev-share-receive` yet.
8. §4.8 Disconnect → 0 sessions → arm once → no handshake → Connect once → both sides negotiated **2**,
   exactly one `ext: phone advertises` line since the arm.
9. §5.1 0 bytes, then §5.2 4,096 bytes — every pass line, digests `e3b0…b855` and `1506…80d6`,
   `share-temporary-files.json` = `[]`, inventory unchanged.
10. §6 N1 (100,000 bytes, unlisted) → declined `not-available`, no card, no file.
11. §7 read the card through `probe.mjs`. §8's stop table applies throughout.
12. Afterwards: disarm, quit the Mac app so the next launch is without switches. Delete nothing.

If 3e passes, flipping `syntheticRunPassed` is a separate reviewed commit that records the evidence;
it does **not** enable Send on its own — §11 still blocks it.

## 4 · Things a reader should know

- The harness for the card review is in the session scratchpad and is not committed; its readings and
  screenshots are (`docs/evidence/feature-a-card-2026-09-25/`). Two of its first readings were
  instrument faults (animation mid-flight; a 673 px headless viewport) and are recorded as such.
- `PRODUCT.md`, `skills-lock.json` and the untracked design files were not touched or committed.
