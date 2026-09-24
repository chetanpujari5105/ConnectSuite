# Feature A slice 3e — the synthetic live transfer: runbook (NOT EXECUTED)

> **Status: proposed, 2026-09-24. Nothing in this file has been run.** It needs the owner's approval
> before any step, and step 1 is a code change that does not exist yet. Written after `827ec99`,
> `788c8a2`, `5564469` and `f243720`. The contract is `docs/protocol.md` → Share → Version 2.

The purpose of 3e is one question: **do the two built halves of version 2 move a synthetic file from
the SM-S938B into the Mac's scratch folder, verified end to end, and refuse everything else?** It is
not a test of the card with real files, not a test of ordinary Android Send (still disabled), and it
never touches the configured receive folder or Downloads.

## 0 · Facts this runbook depends on, measured on 2026-09-24

| Fact | How it was established |
|---|---|
| The Mac's app-data folder in a development run is **`~/Library/Application Support/sidekick-desktop`** — not `…/Sidekick` | `app.setName('Sidekick')` does not move `userData`; it defaults from `package.json`'s `name`. Read from disk: `…/sidekick-desktop/logs/sidekick.log` was written at 17:07 today; `…/Sidekick/` does not exist |
| **A Mac app is running now**, started 10:40 (its `DevToolsActivePort`), i.e. **before** `827ec99`. It runs pre-gate code | read only; it was not touched |
| `dev-share-receive/` and `share-temporary-files.json` **do not exist** under that folder | `ls`, read only |
| The phone advertises `share.file: 1` from `Extensions.PHONE`, used at `ControlSession.kt:292-293` (negotiation) and `:313` (`hello.ack`) | source |
| The probe's bytes are `kotlin.random.Random(seed).nextBytes(size)` (`ShareOfferProbeActivity.kt:52`) | source |
| The Mac card's layout, keyboard, labels and reduced motion | §9, from a synthetic harness in a separate headless Chrome — **not** from the app |

## 1 · The phone change 3e needs first — **built 2026-09-24, not installed**

> Built as a single local commit with its tests (see `docs/testing.md` → *Feature A pre-live — the
> phone's share.file 2 gate*). **Two departures from the text below, both deliberate:** the arm is
> **one-shot** (consumed by the next trusted handshake, not held until restart), and the per-session
> line is written by `Extensions.handshake` as
> `ext: phone advertises share.file <n> (debug share.file 2 armed for this handshake: <b>; debuggable build: <b>); Mac advertises …; negotiated …`
> — **§4.8's criterion must be read against that exact line**, not the sketch below.

The Mac cannot negotiate 2 alone: `min(mine, theirs)`, and the phone hard-codes 1. The minimal
change, mirroring the Mac's gate and failing closed the same way:

- **`core/.../link/Extensions.kt`** — `PHONE` stays `{share.file: 1}` (`ExtensionsTest` keeps pinning
  it). Add
  `fun advertised(debuggable: Boolean, devV2Armed: Boolean): Map<String, Int> =
  if (debuggable && devV2Armed) PHONE + (SHARE_FILE to 2) else PHONE`.
- **`core/.../link/ShareDevGate.kt`** — `object ShareDevGate { @Volatile var armed = false }`.
  **In memory only**: a process restart, a reinstall or a reboot returns the phone to 1. Nothing
  persists it.
- **`ControlSession.kt:292, 293, 313`** — use `Extensions.advertised(debuggable, ShareDevGate.armed)`
  in place of `PHONE`, read **once per session** at `hello` so the value negotiated and the value
  sent in `hello.ack` cannot differ within a session. `debuggable` is `FLAG_DEBUGGABLE`, which
  `ShareFeature` already reads.
- **`app/src/debug/.../probe/ShareDevV2Activity.kt`** — the only writer of `armed`: exported,
  **`android:permission="android.permission.DUMP"`** (so only `adb shell am start` reaches it, as for
  `ShareOfferProbeActivity`), in the debug source set (never merged into a release manifest). Extra
  `on=true|false`; it logs `[share] dev v2 armed=<b> (debuggable=<b>) — takes effect at the next hello`.
- **One log line per session**, written where `ControlSession` negotiates:
  `[link] ext: advertised {"share.file":<n>} (devV2Armed=<b>); Mac advertises <json>; negotiated <json>`.
  Today the phone logs only its build constant (`ShareFeature.kt:97`), which cannot show what a
  session actually negotiated — the reading §4.8 needs. The criterion below is written against this
  line, so it must be derived from the code that lands, not retyped from here.

**Fail-closed tests** (red-first each, as for the Mac's `shareActivation.test.ts`):
1. `advertised(false, true)`, `advertised(true, false)`, `advertised(false, false)` → `{share.file: 1}`;
   `advertised(true, true)` → `{share.file: 2}` (the control).
2. `ShareDevGate.armed` is `false` at class load.
3. `ControlSession` against a Mac advertising 1 negotiates 1 even when armed; against a Mac advertising
   2 with the gate off, negotiates 1.
4. `DebugProbeGateTest` covers the new activity (DUMP required) automatically; confirm it goes red with
   the permission removed.
5. A source scan: no file under any `src/main/` assigns `ShareDevGate.armed` (comments stripped — the
   KDoc explaining the rule names the assignment).
Mutations to show red: drop `debuggable &&`; default `armed = true`; `ControlSession` reads `PHONE`
for negotiation but `advertised()` for `hello.ack`.

**This change is a commit of its own, with the phone suite green, before any install.**

## 2 · What will be created, and where

| Where | What | Created by |
|---|---|---|
| Mac `~/Library/Application Support/sidekick-desktop/dev-share-receive/` | the folder (mode 0700), at the **first version-2 offer**, not at launch | `resolveScratchFolder(userData, true)` |
| … `/dev-share-receive/sidekick-offer-probe-0.bin` | 0 bytes | the first transfer (§5) |
| … `/dev-share-receive/sidekick-offer-probe-4096.bin` | 4,096 synthetic bytes | the second transfer |
| … `/dev-share-receive/.sidekick-link-probe-<22>` and `…-2` | empty, **deleted by the check itself**; left only if an unlink fails, then recorded in the ledger | the destination check, at offer and at Accept |
| … `/dev-share-receive/.s-<offerId>.<nonce>.sidekick-share.part` | a partial per attempt; unlinked on publish or failure | the pull |
| Mac `~/Library/Application Support/sidekick-desktop/share-temporary-files.json` | the ownership ledger (normally `[]` at rest) | the first recorded temporary file |
| Mac `…/sidekick-desktop/logs/sidekick.log` | log lines, tag `[share]` / `[bulk]` | always |
| Phone `cacheDir/share-staging/…` (app-private) | the staged synthetic copy; deleted by every end of an offer | `ShareStaging.copy` |
| Phone `files/logs/link.log` | log lines | always |

**Nothing is written to the configured receive folder, `~/Downloads`, or the phone's shared storage.**

## 3 · The allow-listed digest, obtained independently

The digest comes from **three sources that must agree**, and any disagreement stops the run (§8):

1. **Computed on the Mac before anything runs**, with Kotlin's own `Random` from the Gradle cache and
   no project code: `java -cp kotlin-stdlib-2.2.20.jar Digest.java`, which ran on 2026-09-24:

   | bytes | seed | SHA-256 |
   |---|---|---|
   | 0 | 7 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
   | 4096 | 7 | `150668349dc0526d188ecee19c207e5d58be767f6ba198c8533f91d44a4080d6` |
   | 100000 | 7 | `2253e470b36347ebb025b282338164a7d1ea13b1f98da0e1d725664fdf42a275` |

   **Control:** the 0-byte row equals `echo -n | shasum -a 256` — the well-known empty-input digest —
   so the tool hashes what it was given. **Limit, stated:** the 4096 and 100000 rows use the same
   generator the phone uses; they are independent of the phone's *staging* and *transport*, not of the
   generator. The 0-byte row is independent of everything.
2. **The phone's own log line**, `synthetic bytes=<n> seed=7 sha256=<hex> … → Offered`, must equal row 1.
3. **After the transfer**, `shasum -a 256` of the file in the scratch folder must equal both.

`CONNECTSUITE_SHARE_ACCEPT_SHA256` carries **only** the 0 and 4096 digests. 100000 is deliberately not
on it (it is the negative test's probe-shaped, unlisted offer — §6).

## 4 · Preflight — before any offer

Every write to the phone goes through `scripts/adb-pinned.sh samsung …` (the serial never passes
through a shell variable).

1. **Identity of the target.** `scripts/target-device.sh samsung` → `OK target … SM-S938B`. If it
   names anything else, stop.
2. **Owner present, phone unlocked** (an install restarts the link service; step 71's lesson).
3. **Build and test the phone change (§1)**, phone suites green; `assembleDebug` only after that.
4. **Install:** `scripts/adb-pinned.sh samsung install -r app/build/outputs/apk/debug/app-debug.apk`,
   then `scripts/adb-pinned.sh samsung shell am start -n
   com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity`.
5. **After the install, verify all of these** (reads, which may stay loose):
   - **link:** `scripts/link-up.sh` → three OKs (never a grep for `Listening on`, which is absent by
     design on a running service);
   - **runtime grants:** `adb shell dumpsys package com.chetan.connectsuite.debug | grep 'granted=true'`
     — the matched lines, compared by name with the pre-install list taken in the same way (the
     2026-08-31 reading was 11 of 11);
   - **notification listener:** `adb shell settings get secure enabled_notification_listeners` contains
     `com.chetan.connectsuite.debug/…`;
   - **accessibility:** `adb shell settings get secure enabled_accessibility_services` contains it;
   - **pairing:** the phone's Devices screen still lists this Mac, and the Mac's status reads the
     phone's name (no re-pair, no `pair.rejected`).
6. **Quit the running Mac app** (the 10:40 one — it runs pre-gate code). Then launch the development
   build with exactly:
   ```
   cd desktop && CONNECTSUITE_DEBUG_SWITCHES=shareV2,shareAcceptProbe,shareDevReceive \
     CONNECTSUITE_SHARE_ACCEPT_SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855,150668349dc0526d188ecee19c207e5d58be767f6ba198c8533f91d44a4080d6 \
     npm start -- --force-renderer-accessibility --remote-debugging-port=9222
   ```
   and read, in the Mac log, **all four**:
   `DEBUG SWITCHES ON: shareAcceptProbe, shareDevReceive, shareV2`;
   `shareAcceptProbe: 2 synthetic probe digest(s) may be accepted`;
   `share.file 2 ADVERTISED (development, synthetic-only, scratch folder only)`;
   and no `startup ledger sweep LEFT` line (the ledger does not exist yet).
7. **Arm the phone:** `scripts/adb-pinned.sh samsung shell am start -n
   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV2Activity --ez on true`,
   then force a **new session** (the gate is read at `hello`): Disconnect → Connect on the Mac.
8. **The scratch destination is active before any offer** — both of:
   - Mac log: `ext: phone advertises {"share.file":2}; negotiated {"share.file":2}`;
   - phone `link.log`: the §1 per-session line reading `advertised {"share.file":2} (devV2Armed=true)`
     and `negotiated {"share.file":2}`.
   `dev-share-receive/` **still does not exist** at this point (it is created by the first offer). If
   either line says 1, stop — nothing below is meaningful.

## 5 · The transfers, smallest first

**5.1 — zero bytes.**
`scripts/adb-pinned.sh samsung shell am start -n
com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareOfferProbeActivity --ei bytes 0 --ei seed 7 --el ttlSec 120`

Pass requires **every** line:
- phone: `synthetic bytes=0 seed=7 sha256=e3b0c442…b855 … → Offered(offerId=…`;
- Mac: `share.offer … valid: 0 bytes`, then `is an allow-listed synthetic probe; accepting it`;
- Mac: `received 0 bytes, flushed, verified, published exclusively as sidekick-offer-probe-0.bin`;
- Mac: `saved as sidekick-offer-probe-0.bin; the phone acknowledged`;
- phone `link.log`: `offer <id> is saved on the Mac as sidekick-offer-probe-0.bin`;
- on the Mac: `stat -f '%z %N' ~/Library/Application\ Support/sidekick-desktop/dev-share-receive/*`
  → exactly `0 …/sidekick-offer-probe-0.bin`, and `shasum -a 256` of it = `e3b0…b855`;
- `share-temporary-files.json` → `[]`; the phone's staging folder holds no file for this offer id.

**5.2 — 4,096 bytes**, the same command with `--ei bytes 4096`. The same pass list with
`150668349dc0…80d6`, size `4096` in `stat`, and the file `sidekick-offer-probe-4096.bin`. Only after
both pass is anything larger considered, and not in this runbook.

## 6 · Negative tests — nothing but an allow-listed probe is accepted

**Ordinary Android Send is still disabled**, so a real ordinary share cannot be produced; the
ordinary-offer path is covered by the Mac's automated tests (`synthetic-only: an ordinary offer is
declined not-available at once` in `share.test.ts`). Live, two probe-shaped offers that must be refused:

- **N1 — probe name and type, unlisted digest:** `--ei bytes 100000 --ei seed 7`. Must produce
  Mac `is not an allow-listed synthetic probe; declined not-available (synthetic-only mode)`, phone
  state `declined (not-available)`, **no card**, and **no file** — the scratch listing unchanged from
  §5, no partial.
- **Not run live, and why:** the hidden-window and expiry paths need an offer that waits for a
  person, and while the gate is open every allow-listed probe is accepted by the development switch
  and everything else is declined — so no live offer can wait. Those stay automated tests
  (`card expiry`, `card hidden window` in `share.test.ts`; the tray's Expired test). Stated rather
  than improvised.

## 7 · Card check on the real app (read-only)

While §5.2's card is on screen: `scripts/probe.mjs` reads (window `index`) of the tray's state and
headline, and `__probe.onScreen('#share-tray > .share-card')` → `visible`. The Accept path is not
exercised live (the synthetic switch accepts before a person could); what the live card shows is the
receive → saved sequence.

## 8 · Stop conditions — any one ends the run, and nothing further is sent

| Condition | Seen as | Then |
|---|---|---|
| **Wrong device** | `target-device.sh` names anything but the SM-S938B | stop before any write |
| **Wrong destination** | any file written outside `…/sidekick-desktop/dev-share-receive/`; a `receiveFolder` log naming another path; the scratch path a symlink (`resolveScratchFolder` refusal) | quit the Mac app; list what was written, delete nothing |
| **Version not as intended** | negotiated ≠ 2 at §4.8, or the Mac log lacks `ADVERTISED` | stop; nothing moved |
| **Digest disagreement** | the phone's logged `sha256` ≠ §3's table, or the received file's `shasum` ≠ both | stop; keep the file for inspection |
| **Byte-count mismatch** | `stat` size ≠ offered bytes, or `truncated` / `checksum` in the log | stop |
| **Unexpected acceptance** | anything accepted that is not an allow-listed digest; a card for N1; any file for N1 | stop at once; quit the Mac app |
| **Stale session** | a reconnect between accept and pull; `the session changed` in the log | stop; record; do not retry on the new session |
| **Unconfirmed save** | Mac `saved-unacknowledged`, or phone `sent, but the Mac did not confirm it` | stop; keep the file; record both sides' lines |
| **Anything left behind** | `share-temporary-files.json` not `[]` after a pass; a `.part` or `.sidekick-link-probe-` file present; a startup `LEFT` line | stop; report paths; delete nothing |

After any stop: disarm the phone (`ShareDevV2Activity --ez on false`, then a new session), and quit the
Mac app so the next launch is without the switches.

## 9 · What will be left afterwards — nothing is deleted without asking

- Mac: `dev-share-receive/` with `sidekick-offer-probe-0.bin` and `sidekick-offer-probe-4096.bin`;
  `share-temporary-files.json` (expected `[]`); log lines.
- Phone: the debug build with `ShareDevV2Activity` (unarmed after a restart); log lines; no staged
  copies (every end of an offer deletes it — check, do not assume).
- Nothing in the configured receive folder, Downloads, or the phone's shared storage.

## 10 · The Task C card, previewed without the app (2026-09-24)

A static page loading the real `tokens.css`, `shell.css`, `styles.css`, and the card code compiled to
a scratch folder, fed **synthetic** snapshots; decisions only recorded. Run in a separate headless
Chrome on port 9333 with a throwaway profile — no Electron, no link code, no phone, the running Mac
app untouched. Readings through `scripts/probe.mjs` (each with its control); keystrokes, media
emulation, the accessibility tree and screenshots over a second CDP socket.

| Checked | Reading |
|---|---|
| Layout, 1100×760, dark and light | cards 345 px wide at x=716, no sideways overflow, buttons 32 px. With three cards the tray **scrolls**: `onScreen` → waiting card `visible`, the others `reachable` (scroller `#share-tray`) — none stranded |
| Focus on arrival | focus stays on the unrelated button (`afterArrival: elsewhere`) |
| Tab order | Decline, then Accept; `:focus-visible` true, a 2 px solid outline |
| Escape (real key, bubbling from the focused Decline) | `decline` recorded; Escape with focus **outside** the tray: nothing; Enter on the unrelated button as a card arrives: nothing |
| A refused Accept (the hidden-window reply) | shown in the card's `role="alert"` note, Accept re-enabled |
| Accessibility tree | `region: Incoming files`, `group: IMG_2041.jpg`, `button: Decline IMG_2041.jpg from Galaxy S25 Ultra`, `button: Accept IMG_2041.jpg from Galaxy S25 Ultra and save it to ~/Downloads/Sidekick` |
| Live region | *"Galaxy S25 Ultra wants to send …, 1,048,576 bytes. Accept or decline it in the incoming file card."* |
| Reduced motion | `share-card-in 0.22s` → `share-card-in 1e-05s` under `prefers-reduced-motion: reduce` |
| Wording | *Expired · Nobody answered in time. Nothing was saved.*; *Saved on this Mac; confirmation to phone unknown* in `--warning` |

**Findings, not fixed (they are not blocking, and changing the card was outside this pass):**
- **P1 — the saved-unacknowledged card names the saved file three times** (the detail line, the
  rename line, the *Saved as* row), 370 px tall. One is enough.
- **P2 — cards are tall (242–370 px)** and finished ones stay until dismissed; with three, the tray
  scrolls. Acceptable for one live offer per session; worth a compact finished state later.
- **P3 — the tray overlays pane content** bottom-right. The harness has no panes, so what it covers in
  the real window is **unmeasured**.

**Limits of this preview:** it is not the app. The real window's panes, its `data-theme` source,
Electron's focus behaviour, VoiceOver itself (only Chromium's accessibility tree was read), and the
hidden-window path are not covered. The §7 read on the real app is the first sighting.

## 11 · Audit: a scratch-only sweep today, a user-chosen folder later

**The inconsistency is real and latent, not live.** Temporary files (partials, probe files) are only
ever created on the version-2 path, and that path is reachable only through the development gate,
whose destination is the scratch folder. So today **every temporary file this app can create lives in
the scratch folder**, and a scratch-only sweep covers all of them. A production version 2 would create
them in the person's receive folder, where this sweep would — correctly — delete nothing and report
them as `outside-scope`.

**How production cleanup should work later, without widening today's boundary:**

1. **The scope comes from the ledger's own proof, never from the setting.** Each entry would also
   record its **parent folder's identity** at creation — path, device, inode. The sweep's allowed
   folders become "the folders these entries prove they were created in, still the same folder",
   re-verified by `lstat` (not a symlink) and device + inode. It never becomes "whatever the receive
   folder is set to now": changing the setting, or a new folder mounted at the old path, widens
   nothing.
2. **Every check that exists stays.** Clean path, Sidekick name shape, file device + inode + birth
   time, size bound, the `O_NOFOLLOW` re-check, no folder listing, no delete by name.
3. **A folder that cannot be proven is kept, not guessed.** An unmounted drive, a moved folder, a
   network share: entries stay in the ledger, the files are reported, and cleanup waits for a run in
   which the folder proves itself — or the person is shown the paths.
4. **The development gate never widens.** Parent-identity scoping would be enabled only by the
   production version-2 switch, which does not exist yet. While the development gate is open the
   scope stays exactly `[scratch]`, so 3e cannot be affected by the future change.
5. **Its own slice and its own adversarial tests**: a crafted entry with a forged parent identity; the
   receive folder changed between runs; a folder replaced at the same path; a remounted volume with a
   different device; a parent swapped for a symlink — each left untouched beside a positive control.

Until that slice exists, **production version 2 must not ship**, because it would create orphans it
cannot clean. That belongs on the release checklist, not only in this file.
