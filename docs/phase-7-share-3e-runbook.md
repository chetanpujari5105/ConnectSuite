# Feature A slice 3e — the synthetic live transfer: runbook (NOT EXECUTED)

> **Status: proposed, 2026-09-24. Nothing in this file has been run.** It needs the owner's approval
> before any step, and step 1 is a code change that does not exist yet. Written after `827ec99`,
> `788c8a2`, `5564469` and `f243720`. The contract is `docs/protocol.md` → Share → Version 2.

The purpose of 3e is one question: **do the two built halves of version 2 move a synthetic file from
the SM-S938B into the Mac's scratch folder, verified end to end, and refuse everything else?** It is
not a test of the card with real files, not a test of ordinary Android Send (still disabled), and it
never touches the configured receive folder or Downloads.

## 0 · Facts this runbook depends on — read-only preflight, 2026-09-24 22:59

**Every row here is a reading at one moment, not a precondition.** §4 re-takes each one at execution
time; where §4 and this table disagree, §4's fresh reading wins and this table is stale.

| Fact | How it was established |
|---|---|
| Two devices are attached: **`RZCY12330DT`** (SM-S938B, sdk 36) and `emulator-5554` | `adb devices -l`; `scripts/target-device.sh samsung` → `OK target RZCY12330DT (SM-S938B, sdk 36)` |
| The Mac's app-data folder in a development run is **`~/Library/Application Support/sidekick-desktop`** — not `…/Sidekick` | `app.setName('Sidekick')` does not move `userData`; it defaults from `package.json`'s `name`. The live log is `…/sidekick-desktop/logs/sidekick.log`; `…/Sidekick/` does not exist |
| At the preflight the Mac app was **pid 82426**, started 18:37:18 by `npm start` (so `dist/` rebuilt at 18:37:19 from `65b66a0`: the gate, the card, no notification code), **without** `--remote-debugging-port` or `--force-renderer-accessibility`, and with **no** `CONNECTSUITE_*` variable in its environment (`ps -E`, control: `HOME`/`PATH` visible) and no `DEBUG SWITCHES` line in its log | `ps`, `ps -E`, `ls -T dist/`, the log. **The pid is not a precondition** — §4.6 finds the process afresh |
| Both peers negotiated **`share.file` 1** at 22:58:15 — Mac `ext: phone advertises {"share.file":1}; negotiated {"share.file":1}`, phone `ext: Mac advertises {share.file=1}; negotiated {share.file=1}` | both logs, read only |
| The phone has **one** peer in today's logs: `Chetans-MacBook-Pro` at 10.36.14.246, 44 handshakes — i.e. it reconnects often, which is why §4's arming order matters | phone `link.log` + `link.log.1` |
| The **installed** phone app (`com.chetan.connectsuite.debug`, versionName 2.0.0, versionCode 1, `DEBUGGABLE`, lastUpdateTime 10:35:59) **predates slice 3c** — no `ShareRoot`, no `ShareDevGate`, no `ShareDevV2Activity` | the installed APK pulled to scratch; class descriptors counted in its dex, control `ShareOfferProbeActivity` = found |
| The **local** APK of 12:18:52 has 3c but **not the gate**. **A fresh debug build of `65b66a0` or later is required**; neither existing APK can run 3e | the same count on `app/build/outputs/apk/debug/app-debug.apk` |
| Installed and local APKs and `~/.android/debug.keystore` share one certificate, `CN=Android Debug`, SHA-256 `d3a505d22aeef38861db11683afc6b39ef37b8290c1cc188c8dc3fe5cc107d26`, so `install -r` keeps the signature and the grants | `apksigner verify --print-certs`; `keytool -list -v` |
| User 0 holds **14 of 14** runtime grants. The app is also installed for **user 95** (0 of 14) and not for user 150 — `dumpsys package` prints a block per user, so an unscoped grep mixes them | `dumpsys package`, per `User N:` block |
| Listener `…debug/…sync.notifications.NotificationMirrorService` bound; accessibility `…debug/…input.ConnectSuiteInputService` enabled; `link-up.sh` three OKs (with `ANDROID_SERIAL`) | `settings get secure …`; `scripts/link-up.sh` |
| `dev-share-receive/`, `share-temporary-files.json` and its `.tmp` **do not exist** | `ls`, read only |
| The configured receive folder is `null` → the default `~/Downloads/Sidekick` (`downloads.ts:32`). With `shareDevReceive` on, `main.ts:987-993` returns the scratch folder or a refusal and never reaches `ensureReceiveFolder()` at `:994` | `sidekick.json`; source |
| The probe's bytes are `kotlin.random.Random(seed).nextBytes(size)` (`ShareOfferProbeActivity.kt:52`), Kotlin 2.2.20 (`libs.versions.toml`) | source |
| The phone's **serve** wiring for a share pull is reached by no test; zero-byte **staging** is (`ShareStagingTest`). §5.1 is the serve path's first execution | source, tests |
| The Mac card's layout, keyboard, labels and reduced motion | §10, a synthetic harness in a separate headless Chrome — **not** the app |
| **A candidate APK was built at 23:18:47** from `65b66a0` (every file under the Android modules and `gradle/` equal to HEAD, no untracked files; the build reads no git metadata, so the commit is established by the tree, not stamped in the APK): `app/build/outputs/apk/debug/app-debug.apk`, 95,011,036 bytes, SHA-256 `0afc695fba1590032e324d9cf84de97f47d51ae1b55a9a76ff00e9da6fca11b0`; `com.chetan.connectsuite.debug` 2.0.0 (versionCode 1), debuggable, target 36; v2-signed, one signer, certificate **DER-identical** to the installed app's and to `~/.android/debug.keystore`'s (`d3a505d2…7d26`); manifest carries `probe.ShareDevV2Activity`, exported, `android.permission.DUMP`; dex carries `ShareDevGate`, `ShareDevV2Activity`, `ShareRoot` (installed app: none of the three; control `ShareOfferProbeActivity` in both). **Not installed.** Any later rebuild replaces this file, so §4.3's checks are re-run on whatever is installed, not trusted from this row | `aapt2 dump badging/xmltree`, `apksigner --print-certs(-pem)` + `openssl x509 -outform DER`, dex class descriptors |
| **The Mac's data volume was full: 217–219 MiB free (100%).** The destination check requires `size + max(256 MiB, ⌈size/10⌉)` free, so it would **decline every offer `insufficient-space`** — and it made 30 of the Mac's 1,098 tests fail, every one through that check (no Mac code changed since they last passed) | `df -m /System/Volumes/Data`; `npm test` |

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
- **`ControlSession.onHello`** (was `:292, 293, 313`) — use `Extensions.advertised(debuggable, ShareDevGate.armed)`
  in place of `PHONE`, read **once per session** at `hello` so the value negotiated and the value
  sent in `hello.ack` cannot differ within a session. `debuggable` is `FLAG_DEBUGGABLE`, which
  `ShareFeature` already reads.
- **`app/src/debug/.../probe/ShareDevV2Activity.kt`** — the only writer of `armed`: exported,
  **`android:permission="android.permission.DUMP"`** (so only `adb shell am start` reaches it, as for
  `ShareOfferProbeActivity`), in the debug source set (never merged into a release manifest). Extra
  `on=true|false`. *(Sketch. The committed line is `[share] debug share.file 2 ARMED for the next
  trusted handshake only (debuggable build: true) — reconnect the Mac for it to take effect`, or
  `… disarmed (debuggable build: <b>); the phone advertises share.file 1`.)*
- **One log line per session**, written where `ControlSession` negotiates:
  *(Sketch. The committed line, tag `[control]`, is
  `ext: phone advertises share.file <n> (debug share.file 2 armed for this handshake: <b>; debuggable build: <b>); Mac advertises share.file <n>; negotiated share.file <n>`
  — `no share.file` in place of a version when there is none.)*
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

**Writes** to the phone go only through `scripts/adb-pinned.sh samsung …`. **Reads** name the serial:
`adb -s RZCY12330DT …`, and `scripts/link-up.sh` — which calls bare `adb` — is run as
`ANDROID_SERIAL=RZCY12330DT scripts/link-up.sh` for as long as `emulator-5554` is attached (bare `adb`
refuses with two devices, and a refusal must not be read as a dead link).

Below, **P** = the phone's `link.log`, read with
`adb -s RZCY12330DT shell run-as com.chetan.connectsuite.debug cat files/logs/link.log`, and
**M** = `~/Library/Application Support/sidekick-desktop/logs/sidekick.log`.

**4.1 Target.** `scripts/target-device.sh samsung` → `OK target RZCY12330DT (SM-S938B, sdk 36)`.
Anything else: stop before any write.

**4.2 The owner is present and the phone is unlocked** (an install restarts the link service).

**4.2a Free space on the Mac.** `df -m /System/Volumes/Data` must show **at least 1024 MiB free**
(the destination check needs 256 MiB of headroom beyond the file; 1 GiB leaves room for logs and the
build). At the preflight it was 217 MiB, which fails this. Making room is the owner's decision — this
runbook deletes nothing. And `cd desktop && npm test` must be green **after** space is made: the
destination tests use the real disk and go red on a full one.

**4.3 A fresh debug build is required.** Neither the installed app (pre-3c) nor the 12:18 APK (no
gate) can run 3e. `./gradlew :app:assembleDebug` at `65b66a0` or later, phone suites green, and then,
on the **built** APK, before it goes anywhere:
- `aapt2 dump badging` → `package: name='com.chetan.connectsuite.debug'`;
- `apksigner verify --print-certs` → SHA-256 `d3a505d22aeef38861db11683afc6b39ef37b8290c1cc188c8dc3fe5cc107d26`,
  the installed app's certificate (re-read it from the device the same day);
- `aapt2 dump xmltree --file AndroidManifest.xml` lists `probe.ShareDevV2Activity` with
  `android.permission.DUMP`; the dex carries `Lcom/chetan/connectsuite/core/link/ShareDevGate;`,
  `…/probe/ShareDevV2Activity;` and `…/sync/v2/ShareRoot;` (control: `…/probe/ShareOfferProbeActivity;`).
**Any mismatch: stop; do not install.**

**4.4 Baseline, before the install** (so §4.5 has something to compare with):
- `ANDROID_SERIAL=RZCY12330DT scripts/link-up.sh` → three OKs;
- **user 0 only** — the grant lines inside the `User 0:` block:
  `adb -s RZCY12330DT shell dumpsys package com.chetan.connectsuite.debug | awk '/^ *User [0-9]+:/{u=$2} u=="0:" && /granted=true/'`
  — record the **names**, not just the count (14 at the preflight);
- `adb -s RZCY12330DT shell settings get secure enabled_notification_listeners` and
  `… enabled_accessibility_services` — record the `com.chetan.connectsuite.debug/…` entries;
- the Mac's pairing: `sidekick.json` has a `paired` record, and **P**'s last `Handshake complete with`
  names this Mac.

**4.5 Install, then the same four readings again.**
`scripts/adb-pinned.sh samsung install -r <the verified APK>`, then
`scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity`.
Every §4.4 reading must match its baseline — the same grant **names** on user 0, the same listener
and accessibility entries, three OKs, and a new `Handshake complete with` this Mac in **P** (the
running Mac reconnects by itself; that handshake negotiates `share.file 1` — the arm cannot exist
yet, and an install kills any arm). **Do not arm before the install**: the install restarts the
phone's process, and the arm is in memory.

**4.6 Find the Mac process afresh, then relaunch it with the switches.** Take `ps -axo pid,lstart,command
| grep 'Electron.app/Contents/MacOS/Electron \.'` now — **not** the pid in §0 — and quit that app
(⌘Q in its window). Confirm with the same `ps` that no Sidekick Electron remains, and with
`ANDROID_SERIAL=RZCY12330DT scripts/link-up.sh` that reading 3 now shows **0** sessions (the other two
still OK). Then:
```
cd desktop && CONNECTSUITE_DEBUG_SWITCHES=shareV2,shareAcceptProbe,shareDevReceive \
  CONNECTSUITE_SHARE_ACCEPT_SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855,150668349dc0526d188ecee19c207e5d58be767f6ba198c8533f91d44a4080d6 \
  npm start -- --force-renderer-accessibility --remote-debugging-port=9222
```
In **M**, after the new `Sidekick 2.0.0 starting` line, **all** of:
`DEBUG SWITCHES ON: shareAcceptProbe, shareDevReceive, shareV2 — guards are weakened, this is not a normal run`;
`shareAcceptProbe: 2 synthetic probe digest(s) may be accepted; nothing else can be`;
`share.file 2 ADVERTISED (development, synthetic-only, scratch folder only) — this is not a normal run`;
no `share.file 2 NOT advertised` and no `startup ledger sweep LEFT`. And `ps -E -p <new pid>` shows
both `CONNECTSUITE_` variables. The app connects at once (auto-connect) and, because the phone is
**not armed**, that handshake must read `negotiated {"share.file":1}` in **M** and
`… armed for this handshake: false; debuggable build: true); Mac advertises share.file 2; negotiated share.file 1`
in **P**. A `2` here means something armed the phone that this runbook did not: stop.

**4.7 The destination is the scratch folder — established before any offer, and how.** No log line
names the share destination before an offer: the receive folder is resolved when an offer arrives.
So the pre-offer proof is, all at once: the `ADVERTISED (…scratch folder only)` line, which is written
only when `shareActivation.ts` passed with `shareDevReceive` on; `shareDevReceive` in the process's
environment; and the code path — with `shareDevReceive` on, `main.ts:987-993` returns
`<userData>/dev-share-receive` or a refusal and cannot reach `ensureReceiveFolder()` (`:994`), the only
route to the configured folder. **Plus an inventory, taken now and compared after every transfer:**
`ls -la ~/Downloads/Sidekick` and the configured folder (`receiveFolder` in `sidekick.json`; `null`
means `~/Downloads/Sidekick`) — names, sizes and mtimes — and `ls ~/Library/Application\ Support/sidekick-desktop/`
showing **no** `dev-share-receive`. After §5.1 the scratch folder must exist holding exactly the
received file, and the inventory must be unchanged. The Mac's other features (Files, Photos) also
write to `~/Downloads/Sidekick`, so **nobody uses them during the run**, or the comparison means
nothing.

**4.8 One-shot arming — exactly this order.**
1. **Disconnect** in the Mac's window (or the menu-bar item). `LinkClient.stop` sets `running = false`;
   the wake, unlock and network-change retries all go through `retryNow`, which does nothing while
   stopped, and auto-connect runs only at launch — so nothing reconnects by itself.
2. `ANDROID_SERIAL=RZCY12330DT scripts/link-up.sh` → reading 3 shows **0** sessions. Note the time.
3. **Arm:** `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV2Activity --ez on true`.
   **P** must show `[share] debug share.file 2 ARMED for the next trusted handshake only (debuggable build: true) — reconnect the Mac for it to take effect`.
4. **Before pressing anything:** **P** must show **no** `ext: phone advertises` line after the arm.
   **If any handshake appears between the arm and step 5, the arm has been consumed by something
   other than the intended Mac handshake: STOP.** Do not re-arm to continue; that is a finding.
5. **Connect**, once, in the Mac's window.
6. **Both** peers, for that one handshake:
   - **M**: `ext: phone advertises {"share.file":2}; negotiated {"share.file":2}`
   - **P**: `ext: phone advertises share.file 2 (debug share.file 2 armed for this handshake: true; debuggable build: true); Mac advertises share.file 2; negotiated share.file 2`
   and exactly **one** `ext: phone advertises` line in **P** since the arm. Anything else: STOP.
   *(Added 2026-09-25, after the `share.ask` extension landed.)* A phone built from that commit or
   later writes a **second** line straight after it, which the counts above do not match:
   `ext: share.ask — phone advertises 1, Mac advertises none, negotiated none; ordinary Send on this session: disabled`.
   During 3e it must say **`disabled`** and `Mac advertises none` — the development Mac never promises
   `share.ask`. `enabled` here is a STOP. (The candidate APK of §0 predates this and writes no such
   line; its absence on that build is expected, not a failure.)
7. From here, **any** reconnect is back at `share.file 1` (the arm is spent). A session that drops
   before §5 finishes is a STOP, not a re-arm.

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
| **The arm consumed by the wrong handshake** | any `ext: phone advertises` line in **P** between the arm and the one Connect; more than one such line since the arm; a `2` at §4.6 before any arm | stop; do not re-arm to continue |
| **Wrong build on the phone** | §4.3's package, certificate or class checks fail on the built APK, or the installed app still lacks `ShareDevV2Activity` | stop before (or instead of) installing |
| **State changed by the install** | a §4.5 reading differs from its §4.4 baseline (a grant name, the listener, accessibility, pairing) | stop; do not repair by hand without the owner |
| **Not enough space** | §4.2a under 1024 MiB free, or any `insufficient-space` in **M** | stop before any offer |
| **Inventory changed** | anything new or changed in `~/Downloads/Sidekick` or the configured folder after a transfer | stop; quit the Mac app; delete nothing |
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

> **Built 2026-09-25** — `ParentIdentity`, `recordIntentFrom`, `SweepScope.byRecordedParent` in
> `desktop/src/main/shareLedger.ts`, adversarial tests in `shareLedgerParent.test.ts` (folder replaced,
> parent and file swapped for symlinks, inode reuse, a changed setting with a forged entry, a remounted
> device, interrupted saves, pre-§11 entries). It is wired to `share.ask` only, which stays closed until
> `receiveFolderCleanupScoped` is recorded after the owner's review.

Until that slice exists, **production version 2 must not ship**, because it would create orphans it
cannot clean. That belongs on the release checklist, not only in this file.
