# Resume here — written 2026-09-25 (13:40): receive window passed live; silent-Send fix built, not installed

> Supersedes the entries below for Feature A. Nothing pushed. Evidence: `docs/testing.md` → *the
> supervised live run* and *The silent second Send*.

1. **Built and proven:** the Mac receive window, live on the SM-S938B — a 100,718-byte synthetic image
   saved with its SHA-256 equal to the phone's, arrival without focus, nothing moved before Accept,
   collision-safe naming, one decision surface. The phone's silent-Send fix (`02d95b3`) is proven by
   tests and mutations only.
2. **Committed:** `f9e86c9` `7fdce44` `5046017` `b047f10` (window), `02d95b3` (phone fix),
   `f6e4ea2` (multi-offer proposal), and this record. Phone 776/0, Mac 1168/0, guards 0.
3. **Half-built:** nothing. **Not built:** automatic acceptance (waits on the §4.1 contract decision),
   sounds (cannot honour Focus), multi-offer (proposal only).
4. **Needs the owner:** approve installing `02d95b3` on the Samsung and a supervised re-test of the
   busy sheet; decide §4.1; decide sounds.
5. **Next:** install and test `02d95b3`, because the silent Send is the one user-visible defect found live.
6. **Left on devices:** Mac dev app running this build, connected. Receive folder: 24 entries, including
   files the owner sent and accepted during the run; two gradient copies moved to the Trash **by the
   owner**. Nothing deleted, opened or moved by me. Phone unchanged (11:44 build), staging empty.

# Resume here — written 2026-09-25 (afternoon): the Mac receive window; automatic acceptance waits on one approval

> **Supersedes the two reports below for anything about the Mac's receiving experience.** Nothing is
> pushed. Map: `docs/feature-a-receive-window.md`. Evidence: `docs/testing.md` → *Feature A receive
> window*.

1. **Built and proven (automated + a harness driving the compiled window with synthetic data):** the
   receive window (`7fdce44`) — appears without focus (Finder stayed frontmost), the one decision
   surface, closing ≠ declining; receiver-measured progress, Cancel / Give up / Try again, Open and
   Show in Finder on the re-verified publication, QuickLook thumbnails of the saved file (`5046017`).
2. **Committed:** `f9e86c9` map · `7fdce44` window · `5046017` progress/completion · plus the guard and
   docs commit after it. Mac 1168/1168, phone 766/0 (re-executed), both `tsc` clean, all guards 0.
3. **Half-built:** nothing. **Not built:** automatic acceptance (step 3) and sounds (step 5).
4. **Needs the owner:** (a) approve or reject the contract wording in the map's §4.1 — automatic
   acceptance makes `share.ask`'s promise to the phone false unless the contract is reworded; (b) a
   supervised live send from the Samsung through the new window (steps below); (c) a decision on
   sounds, which cannot respect Focus / Do Not Disturb.
5. **Next:** the live run in (b), because nothing in the new window has seen a real phone. Then step 3
   if (a) is approved.
6. **Left changed on devices:** the Mac dev app was relaunched on this build (no switches) and
   reconnected to the SM-S938B at `share.file 2` + `share.ask 1`. Nothing sent, installed or touched
   on the phone. The scratch harness is stopped.

**Demo, when approved:** unlock the phone → Gallery → share a photo → Sidekick → Send to Mac. The Mac
shows the small window top-right without taking focus → click it once to focus, then Accept → watch
the progress → *Saved on this Mac* with a thumbnail → Open / Show in Finder. Then send one more and
press Hide: the offer keeps waiting, and the main window's card has **Show**.

# Resume here — written 2026-09-25 (late morning): 3e passed; production Send waits on one approval

> **Current state, supersedes the overnight report below.** Slice 3e passed on the SM-S938B (0 B,
> 4 KiB, N1 refused) — `docs/testing.md` → *Feature A slice 3e*. §11 cleanup is built (`5e20963`) and
> the phone's production fact added closed (`9153fe1`). **Every production gate is still closed**:
> `SHARE_PRODUCTION_READINESS` both false, `Extensions.PRODUCTION_TRANSFER` false. Live state: the
> phone runs the candidate APK `0afc695f…` (disarmed); the Mac dev app runs with **no** switches;
> both sides negotiate `share.file 1`; ordinary Send disabled. The proposed flip and the
> Gallery/My Files steps are in the report of this sitting and wait for the owner.

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
