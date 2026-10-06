# Release audit — 2026-10-06 (release blockers, security, policy, UI/UX)

> **Status since this was written (same day): read `docs/release-tracker.md` first.** S2, S6, S3 and
> U1/U2 are fixed in source (defects 178–181) and nothing is installed; S1, S4, S5, S7, S8, S9 and P3 are
> open (182–189) with proposals in `docs/pairing-v2-proposal.md` and
> `docs/phase-2-hardening-proposals.md`. The findings below are kept as found.

> **What this is.** An audit and plan, not a release verdict and not a fix. **Nothing in the product
> was changed.** No live app was launched, attached to or relaunched; no profile was read or
> migrated; no phone, ADB, install, call, SMS, permission, Bluetooth, signing, purchase, push or
> publish. Every finding below comes from reading source, docs and manifests, or from an **isolated
> synthetic run on this Mac**: a script against one repository module with fictional numbers, and a
> throwaway Electron instance with its own temp profile. Both are in
> `docs/evidence/release-audit-2026-10-06/`. The UI screenshots there are from the 2026-10-06
> overnight harness (invented data, no link), copied here.
>
> **Not legal advice and not a policy approval.** §C compares the app against Google's and Apple's
> current published policies, read 2026-10-06. Only Google Play review or Apple notarization can
> approve anything.
>
> Inputs read: `docs/release-readiness-2026-10-06.md`, `docs/overnight-2026-10-06.md`,
> `docs/RESUME.md` (top entries), `PRODUCT.md`, `docs/protocol.md` (handshake, session tokens,
> pairing), `docs/permissions.md`, `docs/defects.md` (17, 30, 38, 100, 122, 137, 177),
> `docs/phase-9-distribution-audit.md` (D4), every source `AndroidManifest.xml`,
> `app/build.gradle.kts`, `desktop/electron-builder.yml`, `desktop/build/*`, and the Mac and phone
> code cited by path:line below.

---

## 0. Summary

**Not releasable today**, for reasons that predate this audit (no signed build of either app,
nothing tonight installed) and for **four new findings the earlier documents do not mention**:

1. **The Mac pins whichever phone answers first while a pairing QR is showing** (S1). Nothing proves
   the answering phone scanned the code. The QR authenticates the Mac to the phone; nothing
   authenticates the phone to the Mac.
2. **The Mac's file-transfer and mirror-video sockets do not check the phone's certificate** (S2).
   Only the control and camera sockets do, so "TLS 1.3, pinned" is true of two of the Mac's four
   socket kinds.
3. **The phone's own screens promise "No cloud, no account, nothing leaves your network"**
   (`ConnectMacScreen.kt:247`), **while the QR scanner uses ML Kit**, whose terms say it sends usage
   metrics to Google (P3). This is a disclosure problem before it is a privacy one.
4. **Settings → Connection breaks below about 1,300 px of window width, including at View → Zoom
   In.** At the minimum window size (1100×700) and at 1.2× zoom, the label column wraps to one word
   per line and **Retry now** is drawn on top of the "Nothing leaves your network" card (U1). The
   overnight harness reported "0 overlapping controls" because it compared controls with controls,
   not controls with text.

Two corrections to the overnight documents: **blocker 6 (D4, "no application icon") is stale** —
`desktop/build/icon.icns` was committed on 2026-09-19 (`d5d11de`) and `electron-builder.yml` points
at it. And **defect 100's register row still reads open**, although `docs/testing.md` (about line
17391) records it as background restriction rather than a code defect, with frames measured.

---

## 1. The 22-row feature matrix, verified

**Method.** Each row of `docs/release-readiness-2026-10-06.md` was checked against the code that
gates it. Release gates were read from source, not from prose: `desktop/src/shared/extensions.ts:32`
(`FS_BLOCKS_RELEASE = false`), `desktop/src/main/shareActivation.ts:98,104` (`SHARE_V3_RELEASE`,
`SHARE_WAIT_RELEASE = false`), `core/.../link/Extensions.kt:60,79,95` (`MULTI_FILE_RELEASE`,
`FS_BLOCKS_RELEASE`, `WEBCAM_RELEASE = false`), `app/src/main/res/values/bools.xml`
(`share_many_enabled = false`), `desktop/src/main/main.ts:223` (`callBannerEnabled =
!app.isPackaged && …`), and `camera-module/.../CameraFeature.kt:52` (Camera v1 not installed unless
the build is debuggable).

**Two meanings, kept apart.** *Enabled in release code* means a release APK and a packaged `.dmg`,
built from this tree, would offer the feature. *Publicly shipped* means a stranger can get it. **No
row is publicly shipped**: no signed build of either app exists, and nothing has been distributed.

| # | Feature | Release gate (code) | Implementation evidence | Latest hardware evidence | Remaining work | v1 recommendation |
|---|---|---|---|---|---|---|
| 1 | Pairing (QR, TLS 1.3, pins) | none — on | `link.ts:229` (128-bit token), `LinkTls.kt:121` (`needClientAuth`), tests `identityPair`, `pairingArm` | 2026-08-25; F2/F4/F5 2026-09-03 | **S1** (the phone is not authenticated to the Mac during pairing); re-pair after the bundle-id change | **Fix S1, then include** |
| 2 | Reconnect & discovery | on | `discovery.ts`, `link*` tests, `BootAutoStartTest` | Phase 6, 2026-09-03 (one handset) | Defect 17 (one phone per Mac); other OEMs unknown | Include; state "one phone", "tested on Samsung" |
| 3 | Notifications + reply | on | `notifications*`, `NotificationTargetRuleTest` | Phase 4, 2026-08-31 | Privacy fixes `98f8e3d`/`840adc9` not installed; **S6** (the tag hash is reversible) | Include after S6 and an install |
| 4 | Mac native notifications | on | `nativeNotifier.ts`, `nativeNotify` tests | 2026-09-04 | — | Include |
| 5 | SMS/MMS threads | on | `sms*`, `SmsLogPrivacyTest` | step 71, 2026-08-31 | Play eligibility (§C, P1) | Include (direct); Play depends on P1 |
| 6 | New SMS conversation | on | `smsView` (4 tests) | explicit-address path only | **Defect 30**: the no-thread half is proven with fakes only | Include as "reply"; add "new" after one consenting send |
| 7 | Calls (events, dial, answer, reject, log) | on | `calls*`, `CallLogPrivacyTest` | step 70, 2026-08-31 | `559f1da` not installed | Include |
| 8 | Call audio on the Mac | n/a — a wall | `callAudio` sentence | SCO fails both ways, 2026-09-14 | — | **Never claim** |
| 9 | Incoming-call banner | **off** when packaged (`main.ts:223`) | `callBanner` 22 tests + `f6a2fa1` guard | none | One supervised ring | Defer |
| 10 | Contacts | on | `contacts*` | Phase 4 | — | Include |
| 11 | Media remote | on | `remote*` | step 67, 2026-08-28 | Defect 38 (volume made on the phone never reaches the Mac), deferred | Include; say volume is one-way |
| 12 | Files Mac → phone | on | `filesPush`, `filesResume`, `FsArrivalTest` | 2026-09-01 | **S2** (the push socket is unpinned) | Fix S2, then include |
| 13 | Files phone → Mac (browse granted folders) | on | `filesListing`, `bulkBlockPull` | **Defect 137**: every granted SAF tree lists 0 entries on the test phone since 2026-09-23 | Defect 137, cause unknown (the provider returns an empty cursor); S2 | Include `Download/ConnectSuite` only; **defer granted folders** |
| 14 | Block-verified pulls > 64 MiB | **off** (`FS_BLOCKS_RELEASE`, both sides) | `fsBlocks`, `pullResume` | development runs | Release decision; without it, pulls over 64 MiB carry no integrity check (S9) | Defer the flag; **say large pulls are unverified** |
| 15 | Photos & video browser | on | `photos*`, defect 139 | 2026-09-23 | Play photo policy (P5); performance at depth unmeasured on hardware | Include |
| 16 | Clipboard + history | on | `clipboard*`, `clipEcho` | Slices 11–13, 2026-09-01/02 | Phone → Mac not automatic (a wall); **S7** | Include with the wall stated; fix S7 |
| 17 | Mirroring + control | on | `mirrorSession`, `pointerGestures` | 2026-09-10 (frames measured after background restriction was lifted) | **S2** (the video socket is unpinned); defect 100's register row is stale; needs Accessibility (P2) | Fix S2, reconcile 100, include |
| 18 | Apps (list, ask to open) | on | `apps*`, `check-apps-verb` | 123/123, 2026-09-03 | — | Include, named "ask to open" |
| 19 | Phone → Mac sharing | packaged Mac advertises `share.file 1` only; phone multi-file off (`bools.xml`) | `share*` | development runs from 2026-09-25 | Release decision | Defer |
| 20 | Camera v1 (preview in pane) | **off** unless the phone build is debuggable (`CameraFeature.kt:52`) | `camera*`, `CameraStreamTest` | two supervised sessions, 2026-10-02 | Most of `docs/camera-v1.md` unrun | Defer |
| 21 | Phone as Mac webcam | **off** (`WEBCAM_RELEASE`, both sides) | `webcam*`, Swift 140 | spike PASS 28/28, 2026-10-05; defect 177 open | Signing, the Camera Extension, defect 177 | Defer; never claim |
| 22 | Activity, Settings, theme, login item | on | `activity`, `appearance`, `settingsControls` | 2026-09-16 | **U1** (Settings layout); the pending irreversible Activity rewrite | Fix U1, include |

**Feature availability, with stated denominators** (this table only; not a completion percentage):

| Measure | Numerator | Denominator | Value |
|---|---|---|---|
| Enabled in release code | 16 (rows 1–7, 10–13, 15–18, 22, excluding 8) | 22 matrix rows | **72.7 %** |
| Enabled in release code, excluding the platform wall | 16 | 21 (22 − row 8) | **76.2 %** |
| Enabled with no open gap a user would hit (excludes 6, 13) | 14 | 21 | **66.7 %** |
| Enabled, *and* every fix for it installed on the test phone | not computable — five privacy fixes and all UI fixes are in source only | — | — |
| Publicly shipped | 0 | 22 | **0 %** |

No whole-app completion percentage is given: the matrix rows are unequal in size and there is no
agreed unit of work.

---

## A. Release-blocker register (most severe first)

Severity: **B** = blocks any release to another person · **P** = blocks a Play release only ·
**S** = should be fixed before a release, workaroundable · **D** = documentation and claims.

| ID | Sev | Blocker | Evidence | Fix or decision |
|---|---|---|---|---|
| RB1 | B | No signed build: the Mac `.dmg` is ad-hoc signed; the release APK has no signing config | D12/D13; `electron-builder.yml` (`identity: null`, `notarize: false`); `app/build.gradle.kts` (`hasReleaseKeystore`) | Apple Developer Program (Developer ID); a release keystore. Owner action |
| RB2 | B | **S1**: the Mac pins whichever phone answers during pairing | `link.ts:375`, `link.ts:595` | Proof of token knowledge without disclosing the token (§B) |
| RB3 | B | **S2**: bulk and video sockets unpinned on the Mac | `bulk.ts:99-110, 155-165, 569-580`; `video.ts:131-141` vs `camera.ts:873` | One pinned-connect helper for every side channel |
| RB4 | B | **P3**: "nothing leaves your network" while ML Kit sends usage metrics to Google | `ConnectMacScreen.kt:165, 247`; `LinkRoute.kt:549`; `OnboardingCopy.kt:91`; `app/build.gradle.kts:182` | Measure the phone's traffic while scanning; then disclose, or replace the scanner (§C) |
| RB5 | B | No privacy policy, publisher identity or contact anywhere | `copyright: © 2026 Sidekick` is the only publisher string; no policy document in `docs/` | Owner supplies the legal name, contact and policy text; not invented here |
| RB6 | B | Nothing from 2026-10-06 is installed (five privacy fixes, UI fixes) | `docs/overnight-2026-10-06.md` | Plan F, steps F2–F4 |
| RB7 | S | **Defect 137**: granted folders list 0 entries | `docs/defects.md` row 137 | Read the provider log (F7); until then ship `Download/ConnectSuite` only |
| RB8 | S | **U1**: Settings → Connection unusable at the minimum window size and at 1.2× zoom | screenshots in `docs/evidence/release-audit-2026-10-06/`; `shell.css:1757` | Let `.setting-control` wrap; stack the row below a width |
| RB9 | S | **S3/S4/S5**: Electron navigation, IPC and fuse hardening | §B | First remediation batch (§E) |
| RB10 | S | **S6**: the notification-tag hash is reversible | synthetic run, §B | Replace with an HMAC or a per-process ordinal |
| RB11 | S | **S7**: any app on the phone can write the Mac's clipboard without a prompt | `SendSelectionActivity.kt:85-90`; `clipboard.ts:141-157` | Offer rather than auto-apply for selection pushes |
| RB12 | S | Defect 30, the no-thread send | `docs/defects.md` row 30 | One consenting send (F8), or ship "reply only" |
| RB13 | P | Play declarations: SMS/Call Log, Accessibility, foreground-service types, photos, battery exemption | §C | Owner decides on Play at all; direct distribution avoids review but not the 2027 developer-verification rule |
| RB14 | D | Stale rows: D4 (an icon exists), defect 100 (open), `PRODUCT.md`'s "Camera unbuilt" and "11 covered / 2 outstanding" | `d5d11de`; `testing.md` ~17391 | Reconcile in one docs commit |
| RB15 | D | One handset; the bundle-id change forces a re-pair | `docs/single-device-audit.md` | Release notes |

### The release scope asked for

- **Two incomplete features:** row 6 (new SMS conversation, defect 30) and row 13 (browsing granted
  folders, defect 137). **Recommendation:** ship row 6 as reply-only unless F8 passes; ship row 13 as
  `Download/ConnectSuite` only and hide or label the granted-folder roots until 137 is understood.
  **Do not** re-request grants or fall back to `MediaStore`; the register names both as wrong fixes.
- **Four development-gated features:** 9 (call banner), 14 (`fs.blocks`), 19 (phone → Mac sharing),
  20 (Camera v1). Row 21 (webcam) is a fifth, deferred rather than gated. **Recommendation: leave all
  five off for v1.** The one argument for flipping 14 is integrity (S9); S2's fix covers the network
  half of that, so 14 can stay a separate decision.
- **Defect 137 and defect 30:** above. Neither is a security issue.
- **Unavailable in packaged builds — sharing and block transfer:** a packaged Mac advertises
  `share.file 1` only, so the phone's multi-file sheet and waiting offers (`share.wait`) are absent
  and the phone's "Send to Mac" for several files is disabled (`share_many_enabled = false`).
  `fs.blocks` is off on both sides, so **pulls above 64 MiB are unverified in a release build**: no
  digest is agreed above the phone's 64 MiB pre-hash ceiling (`files.ts:347-349`).

**No gate was flipped by this audit.**

---

## B. Security findings

Severity is for this product's threat model: a home or office LAN, one owner, a paired Mac and
phone. **Active LAN attacker** means someone on the same Wi-Fi who can answer on an IP or advertise
mDNS (ARP spoofing, a rogue host on a café network). **Local** means code already running as the
user on the Mac, or an app installed on the phone.

| ID | Severity | Where | Finding | Evidence | Impact | Proposed fix |
|---|---|---|---|---|---|---|
| **S1** | **High** | `desktop/src/main/link.ts:375-380`, `:595`; `docs/protocol.md` → Pairing | **The phone is never authenticated to the Mac during pairing.** With a pairing armed and nothing stored, the Mac adopts any TLS peer on any candidate address, sends it `pairToken` in `hello`, and pins its certificate on the first `hello.ack` — with the comment *"the phone already proved it trusts us by accepting the TLS connection"*. An impostor proves nothing: it is the server, so it accepts any client. | Code read. The protocol's `pair=` mDNS hint is copyable by any host that can see it. | An active LAN attacker present during the 5-minute window becomes "the phone" **permanently**. It then receives the Mac's clipboard automatically (`watchClipboard` defaults to true), every push, the text of every SMS the user sends, and dial requests, and it can show the user fake notifications and threads. | Make pairing mutual without revealing the token: the Mac sends a nonce, the phone answers with HMAC-SHA256(token, nonce ‖ phoneFp ‖ macFp), the Mac verifies before `store.set('paired')`, then sends its own proof in place of the raw token. Better still, bind it to the connection with TLS exported keying material. **Contract change first** (`docs/protocol.md`), then both sides; a test that the Mac refuses a peer without the proof, shown red against today's code. |
| **S2** | **High** | `bulk.ts:99-110` (share pull), `:155-165` (push), `:569-580` (pull); `video.ts:131-141` (mirror) | **Side-channel sockets do not pin the phone's certificate on the Mac.** `rejectUnauthorized: false` and no fingerprint comparison, unlike the control socket (`link.ts:357-373`) and the camera socket (`camera.ts:873-878`), which do it right. The session token is written to whoever answers. | Code read; grep for `getPeerX509Certificate` finds only `link.ts` and `camera.ts`. | An active LAN attacker at the phone's address reads every Mac → phone push and the session token, can serve forged bytes for pulls over 64 MiB (unverified, S9) and for the share pull, and can feed the mirror canvas fake frames. The phone side is not exposed: it requires a trusted client certificate on every port (`LinkTls.kt:121`). | Move `camera.ts`'s check into one `pinnedTlsConnect(host, port, expectedFp)` used by all five call sites, expecting `link.sessionPeer`; refuse on a mismatch before writing the token. Test: a local TLS server with a different certificate gets no token frame — red first against the current `bulk.ts`. |
| S2b | Low | `core/.../link/LinkServer.kt:577` | The phone discards the side channel's peer fingerprint: a token is accepted from **any trusted** Mac, not only the session's own. | Code read | Only relevant with two trusted Macs; defect 17 holds one | Compare `LinkTls.handshake()`'s return with `session.peerFingerprint`. Defense in depth |
| **S3** | **Medium** | `main.ts:591-647`, `float.ts:141-169`, `shareWindow.ts:149`; renderer drop handling only in `files.ts:286-300` | **No navigation or new-window guard, and no document-level drop guard.** There is no `will-navigate`, `setWindowOpenHandler` or `web-contents-created` handler anywhere in `src/main`. Chromium's default for a file dropped outside a handler is a top-level `file://` navigation. | **Synthetic, reproduced:** `docs/evidence/release-audit-2026-10-06/electron-navigation-inherits-preload.demo.js`, a throwaway Electron 43.4.1 with this app's `webPreferences`. After a script-driven top-level `file://` navigation, the new page called the bridge (`title: "bridge-reachable"`). Control: with a `will-navigate` guard the window stayed on `page.html`. **Not reproduced with a real drag.** | A dropped or otherwise-navigated HTML file runs with the whole preload API: send SMS, dial, forget the device, read history. It needs the user to drop a malicious file on the window. | `app.on('web-contents-created')`: deny `will-navigate` away from the app's own files; `setWindowOpenHandler(() => ({ action: 'deny' }))`; document-level `dragover`/`drop` `preventDefault` outside the Files drop zone; state `sandbox: true` explicitly. Control in the test: an allowed in-app navigation still works. |
| **S4** | **Medium** | `desktop/src/preload.ts` (one preload for all windows); of 129 `ipcMain` handlers in `main.ts`, only the share-window group (`main.ts:1297-1373`) checks its sender | **One bridge for every window, and IPC trusts its caller.** The float window and the share receive window, which draws phone-supplied file names, get the same bridge as the main window (166 `ipcRenderer` uses in `preload.ts`). Only the share handlers check `event.sender`. Payloads are mostly unvalidated: `fs-drag` (`main.ts:2637`) drags **any** existing path the renderer names. | Code read | Turns any renderer bug, or S3, into full control of the link. Nothing exploitable is known today: the renderer uses `textContent` throughout and its only `innerHTML` is a constant table (`icons.ts:317`). | A per-window preload exposing only that window's calls; a `fromMain(event)` guard on every privileged handler; type checks on payloads; restrict `fs-drag` to paths this app produced (the receive folder, the preview cache). |
| **S5** | **Medium** | `electron-builder.yml` (no `electronFuses`); `build/entitlements.mac.plist` | **Electron fuses are at their defaults**: RunAsNode, NodeOptions and `--inspect` are enabled; ASAR integrity and only-load-from-ASAR are off. The entitlements also allow DYLD environment variables and disable library validation (the latter documented as temporary). Chromium's `--remote-debugging-port` is honoured by packaged builds. | Config read. Impact not demonstrated here. | Local code can start the signed app as plain Node, or with a debugging port, under its identity and permissions. This matters most once there is a Developer ID signature for it to borrow. | Flip the fuses in `afterPack` (`@electron/fuses`); drop `disable-library-validation` and, if V8 allows, `allow-dyld-environment-variables` in the same change that adds the Developer ID; verify each with a launch test. |
| **S6** | **Medium** (a privacy claim that is false) | `desktop/src/shared/notifKeyLog.ts:18-28`; `sync-module/.../NotificationKeyLog.kt:19-29` | **The 32-bit FNV notification-tag redaction is reversible.** The salt only sets FNV's starting state, and each FNV-1a step is invertible (the multiplier is odd), so one known tag gives the salt exactly. The code comment and `98f8e3d`'s message both say the log *"cannot be reversed by hashing candidate numbers"*. | **Synthetic, reproduced twice** against the real module (`fnv-salt-recovery.demo.ts`; fictional 1-555 numbers, no log read): salt recovered in **0.015–0.030 ms** from one known chat; then a hidden contact's number found in **0.9 s** over 10⁷ candidates, **1 hit, correct**. Control: a wrong known-tag guess gave **0 hits** in 10⁶ (expected 0.0002). Without any known tag, two tags from one run still match against a candidate list in linear time. `Math.random` and `kotlin.random.Random` are also not CSPRNGs. | Anyone who gets a log file (shared for support, a backup, local malware) and knows one chat partner recovers the other contacts' numbers. A run's salt lasts as long as the process — days on the phone. | Replace the hash with a **per-process ordinal** (`tag → #1, #2…`), which has nothing to reverse, or HMAC-SHA256 with a 32-byte key from `crypto.randomBytes` / `SecureRandom`, truncated to at least 64 bits. Correct the comment and the commit's claim in the register. Test: the demo's inversion must fail. |
| **S7** | **Medium** | `app/src/main/AndroidManifest.xml` (`SendSelectionActivity`, `exported="true"`, `PROCESS_TEXT`/`SEND text/*`); `SendSelectionActivity.kt:85-90`; `clipboard.ts:141-157` | **Any foreground app on the phone can write the Mac's clipboard with no prompt.** An explicit intent with `EXTRA_TEXT` sends `clip.push`, and the Mac applies it on arrival. Only a toast tells the user. Websites cannot reach it: the filters have no `BROWSABLE` category. | Code read | Clipboard substitution (a payment address, a pasted shell command). Mitigations already present: the toast, the referrer is logged, and the overwritten clipboard is kept as a `displaced` entry that Restore can put back. | Tag selection pushes (`source: selection`) and have the Mac **offer** them — a notification with Apply — rather than apply them. Keep auto-apply for the in-app path. |
| S8 | Low–Medium | Mac receive path (`bulk.ts` publish, `share.ts`) | **Received files are not quarantined**: there is no `com.apple.quarantine` and no `LSFileQuarantineEnabled`. | grep for `quarantine` in `desktop/src` and `electron-builder.yml`: 0 hits | A script or app pulled from the phone opens without a Gatekeeper check (`share-open` → `shell.openPath`, `main.ts:1353`; or a double-click in Finder). | `LSFileQuarantineEnabled: true` in `extendInfo`, or set the attribute on publish; test that a published file carries it. |
| S9 | Low (Medium until S2 is fixed) | `files.ts:347-349`; `FS_BLOCKS_RELEASE = false` | **Pulls above 64 MiB are unverified in release builds.** | Code read | Silent corruption is undetected; with S2, forgery too | Fix S2; say "unverified" in the UI for such pulls; decide row 14 separately |
| S10 | Low | `main.ts` `set-manual-address`, `set-tailscale-address` | Addresses are stored unvalidated | Code read | Only the user's own input; a typo becomes a silent failure | Validate as an IP or hostname and say why on refusal |
| S11 | Info — retention | `activity.ts` (2,000 events, 1 MiB); logs 512 KiB rotating on both sides; `mediaPreview.ts` cache 0700, cleared at start; clipboard history in memory | Retention is bounded. **Open:** file names in phone `fs` logs (owner decision); `activity.jsonl.pre-migration` and the ConnectSuite folder's `activity.jsonl` keep call numbers outside the pending rewrite (E2) | — | — | Owner decisions, recorded in §C's deletion row |

**Verified correct — the controls that make the findings above credible:**

- TLS 1.3 only on both sides (`LinkTls.kt:31`; `minVersion: 'TLSv1.3'` at every `tlsConnect`).
  Client authentication is required on every phone port (`LinkTls.kt:121`) against a trust store
  that only a QR scan populates.
- Session token: 32 bytes from `SecureRandom` (`SessionRegistry.kt:15-21`), revoked when its control
  session ends. Pair token: 128 bits (`link.ts:229`), single use, 5 minutes. TLS 1.3 without 0-RTT,
  so there is no replay surface on the wire.
- Revocation: Forget on the phone removes trust and disconnects (`LinkServer.kt:380`); Forget on the
  Mac clears `paired`. Forgetting on one side leaves the other side's pin — the asymmetry already
  recorded in `CLAUDE.md`.
- Mac identity key: wrapped by `safeStorage`, kept in memory only when that is unavailable
  (`identity.ts:55-65`).
- Electron: `contextIsolation: true` and `nodeIntegration: false` on all three windows. The preload
  imports only `electron`, so the default renderer sandbox applies. CSP `default-src 'self'` with no
  inline script on every page. `openExternal` only for http/https (`main.ts:2390`). `reveal-saved`
  only inside the receive folder (`main.ts:2758`). Every `debug-*` handler sits inside
  `if (!app.isPackaged)` (`main.ts:2799-3350`). DevTools and reload are menu items only when
  unpackaged (`appMenu.ts:152-158`).
- Android: `allowBackup="false"`. The SMS receiver is exported only behind `BROADCAST_SMS`.
  Accessibility and notification-listener services are bound by system permissions. The
  clipboard-carrying receiver is not exported. Debug probes are in the debug source set only and
  `DUMP`-gated, checked by `DebugProbeGateTest`. `FileProvider` is not exported.
- Paths: the phone rejects absolute paths, `..` and `.` (`FsPaths.kt:145-153`) and path-like push
  names (`FsFeature.kt:650`). The Mac re-sanitises every phone-supplied name — NFC, control and bidi
  characters stripped, `/` and `:` replaced, a leading dot replaced, a 255-byte cap
  (`shareNames.ts:20`) — and chooses a free name with `lstat`, which does not follow links
  (`files.ts:1005-1019`).

**Dependencies.** Read locally only. `npm audit` was **not** run: it sends the dependency tree to an
external registry. Mac runtime: electron 43.4.1, node-forge 1.4.0, electron-store 8.2.0,
bonjour-service 1.4.4, qrcode 1.5.4 (electron-builder 25.1.8 is dev only). Phone: AGP 8.13.1,
Kotlin 2.2.20, Compose BOM 2025.09.00, Room 2.8.1, CameraX 1.4.2, ML Kit barcode-scanning 17.3.0.
**Unverified:** whether any of these has an open advisory. Recommended, with your approval:
`npm audit --omit=dev`, or OSV-Scanner against a locally downloaded advisory database.

---

## C. Distribution-policy checklist

Read 2026-10-06 from official pages only (sources at the end). "Status" describes this tree, not a
reviewer's verdict.

| ID | Area | What the source says | This app | Status / unresolved question |
|---|---|---|---|---|
| P1 | **SMS & Call Log** (`READ_SMS`, `SEND_SMS`, `RECEIVE_SMS`, `READ_CALL_LOG`) | Only default handlers, or approved exceptions declared in Play Console. Listed exceptions include *"Apps that enable the user to sync texts and phone calls across multiple devices (such as between phone and laptop)"* and the connected-device case. Misdeclaration risks suspension. | Declared in `app/src/main/AndroidManifest.xml:43-65` | **A candidate for the cross-device-sync exception — not approved.** Unresolved: does Play accept a companion with **no server and no account**? Is a demo video needed? Does `CALL_PHONE`/`ANSWER_PHONE_CALLS` need its own justification? |
| P2 | **AccessibilityService** (input injection for mirroring control) | Not an accessibility tool, so it needs a prominent in-app disclosure (*"describe the data being accessed"*, *"affirmative user action for consent"*), the Permission Declaration Form, and a video. "Autonomous" actions are prohibited; deterministic, human-defined automation is permitted. | `input-module` service; enabled by hand in Settings | **Unresolved:** is "a paired computer drives the phone" a permitted use? Is the existing onboarding a qualifying *prominent* disclosure (separate from the system screen)? Not established. |
| P3 | **"No cloud" claim vs ML Kit** | ML Kit terms: *"The ML Kit APIs also send metrics about the performance and utilization of the APIs in your app to Google"*, and developers must inform users. Play's Data safety counts SDK transmissions as collection. | `app/build.gradle.kts:182` (`mlkit.barcode.scanning`), used by `QrScanScreen.kt`; copy says *"No cloud, no account, nothing leaves your network"* (`ConnectMacScreen.kt:247`), *"no account, no server"* (`LinkRoute.kt:549`, `OnboardingCopy.kt:91`) | **Blocker for every channel, direct included**: the claim is contradicted by a dependency's own terms. Unmeasured on this device — F9 is a supervised traffic capture. Options: the platform/Play-services code scanner (still Google); a local ZXing-based decoder (no network); or change the copy and disclose. |
| P4 | Foreground-service types | Android 14+: declare each type in Play Console with a description, the user impact if deferred, and a video. `dataSync` is for user-initiated transfers. | `connectedDevice`, `dataSync` (`core` `LinkService`), `mediaProjection` (mirror) | Declarable. Unresolved: is a permanent `dataSync|connectedDevice` link service within "user-initiated"? The connected-device examples are wearables and vehicles, not computers. |
| P5 | Photos & video | Persistent `READ_MEDIA_IMAGES`/`_VIDEO` only where core functionality is broad access (gallery management, backup, sync), declared in Console; otherwise the photo picker. | Declared, plus `READ_MEDIA_VISUAL_USER_SELECTED` | A plausible "sync" core use — needs the declaration. Limited access already works (defect 139). |
| P6 | Battery-optimisation exemption | Play forbids `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` *"unless the core function of the app is adversely affected"*. Periodic peripheral sync is listed as not acceptable; a persistent peripheral connection as acceptable. | Declared (`app/src/main/AndroidManifest.xml:36`) | **Unresolved**, and not obviously eligible. Alternative: `CompanionDeviceManager` association with the run-in-background privilege. |
| P7 | Notification access | Not a restricted permission. User-data policy: disclose and use only for the stated feature. | `NotificationListenerService` bound by system permission | Needs disclosure in the privacy policy and Data safety. |
| P8 | Contacts, phone state, camera | Personal and sensitive user-data policy: prominent disclosure where use is not obvious; a privacy policy. | Declared; the camera is used for the QR scan | Covered by P9/P10 once they exist. |
| P9 | **Data safety form** | Collection = *"transmitting data from your app off a user's device"*, including via SDKs. Exemptions include end-to-end encryption and user-initiated transfers. **Every app must link a privacy policy.** | No form drafted. Phone → Mac transfers are TLS end-to-end between the user's own devices (a likely exemption); ML Kit metrics are not exempt | **Missing.** Draft after P3 is measured. |
| P10 | **Privacy policy, retention, deletion** | Required for Play; good practice for direct distribution. | None exists. Retention facts for it: §B S11 (log and activity caps, the in-memory clipboard, the preview cache, Forget). No deletion-on-uninstall statement exists for the Mac. | **Missing.** The owner must write it or approve a draft. Unresolved: how a user deletes Mac-side data (`~/Library/Application Support/Sidekick`) — currently undocumented. |
| P11 | **Publisher identity & contact** | Play needs a verified developer account; Android developer verification (below) needs identity for direct distribution too; Developer ID needs an Apple Developer Program account holder. | `copyright: © 2026 Sidekick`; no legal name, address, support email or website in the tree | **Missing — not invented here.** The owner supplies them. |
| P12 | **Android direct distribution (APK)** | **Android developer verification**: from **2026-09-30** in Brazil, Indonesia, Singapore and Thailand, apps from unverified developers cannot be newly installed on certified devices; **global in 2027**. Off-Play developers register in the Android Developer Console. A limited-distribution tier covers students and hobbyists *"with up to 20 devices"*. ADB installs remain possible. | Unsigned release APK (D13) | **India is not in the 2026 regions** per the page read. Direct distribution needs (a) a release keystore, (b) developer verification and package registration before 2027, (c) users enabling unknown-sources installs. No Play review — but the 2027 date makes verification unavoidable for strangers. |
| P13 | **Mac direct distribution** | Developer ID: *"Gatekeeper … checking for a Developer ID certificate from apps distributed outside the Mac App Store"*; only the program's Account Holder can create one. Notarization is described there as additional confidence. Recent macOS versions (from Sequoia, per Apple's current guidance) require going through System Settings to open un-notarized apps — **not re-verified on that page; confirm before relying on it.** | Ad-hoc signed; `hardenedRuntime: true`; notarize off | Needs the Developer Program (paid), Developer ID signing, notarization and stapling, and S5's entitlement clean-up. The Mac App Store would need the App Sandbox, which `entitlements.mac.plist` deliberately omits. Not recommended for v1. |
| P14 | Mac local-network prompt | `NSLocalNetworkUsageDescription` present | `electron-builder.yml` | OK. Its *"Nothing leaves your local network"* is true of the Mac app, as far as this audit read. |

**Recommendation on channel.** For v1: **direct distribution on both sides**, with RB1, RB4, RB5 and
P10 resolved. Play adds five declarations (P1, P2, P4, P5, P6), at least two of which are genuinely
uncertain. Keep the Play question open rather than designing around it.

---

## D. UI/UX defects and verification matrix

**What exists.** A synthetic Mac harness (the 2026-10-06 overnight run): 13 panes × 4 viewports +
1.2× zoom, dark and light, four data states, 234 renders, invented data, no link. **Nothing** on the
Android UI or on real-device data has been verified since then.

### Defects

| ID | Sev | Defect | Reproduce | Evidence | Fix direction |
|---|---|---|---|---|---|
| **U1** | **High** | **Settings → Connection collapses below about 1,300 px wide.** The label column wraps to one word per line; Connect, Disconnect and **Retry now** overflow the card; Retry now sits on top of the "Nothing leaves your network" card text; the manual-address field overlaps its label. | Window at its minimum 1100×700, or 1280×800 with View → Zoom In (shipped in the packaged menu) → Settings → Connection | `docs/evidence/release-audit-2026-10-06/settings-1100x700-synthetic.png`, `…-1280x800-zoom1.2-synthetic.png`; control `…-1440x920-control-synthetic.png` lays out correctly. Cause: `.setting-control { flex: none }` (`desktop/src/renderer/shell.css:1757`) cannot shrink or wrap | Let the row stack (label above controls) below a container width; `flex-wrap: wrap` on `.setting-control`. **Also fix the instrument**: the harness's overlap check compares controls with controls, so text under a button scored 0. Add control-vs-text and a control fixture. |
| U2 | Medium | **Sidebar at compact heights**: the last nav row (Settings) is half under the account footer at 700 px; at 1.2× zoom both Activity and Settings are. The nav scrolls, but no affordance says so. | 1100×700, or 1280×800 at 1.2× | harness `out-sb/results.json`: at 1100×700 the hit-test at Settings' centre lands on `sidebar-footer`; scroller 502 / 468; at 1.2×, 502 / 435 and the hit lands on the avatar | A fade or shadow at the nav's scroll edge, or a compact row height under about 760 px |
| U3 | Medium | Window size and position are not remembered across launches | Resize, quit, relaunch | `store.ts` schema has no bounds; `main.ts:591` recomputes them from the design every launch | Persist bounds per display; clamp to the work area |
| U4 | Medium | The state vocabulary is still invented per pane (84 states across 19 panes) | — | `docs/empty-and-failure-states.md`; `PRODUCT.md` | The designer's one-hour decision |
| U5 | Low | Manual and Tailscale addresses accept anything and fail silently | Type `abc` → Save | `main.ts` `set-manual-address` | Validate and say why (S10) |
| U6 | Low | Truncated names carry no tooltip (`device-name`, `hero-name`, `remote-title`: `titled: false`) | Long device name | harness `results.json` `truncated[]` | `title` when clipped, as the Files crumb now does |
| U7 | Info | Whole-list rebuilds: about 40 ms at 400 notifications / 600 threads; Apps' first draw about 90 ms at 1,230 apps | Synthetic ×10 data | overnight §Harness | Append in place, as Photos now does (E12) |

### Verification matrix

| Area | Synthetic (Mac harness) | Real Mac window | Android | Real-device data |
|---|---|---|---|---|
| Minimum-size density (1100×700) | **Done — U1, U2 found** | not done | not done | n/a |
| Scaling (1.2× zoom; Larger Text) | 1.2× done (U1); Larger Text not done | not done | font scale not done | n/a |
| Saved settings across relaunch | not done (own userData each run) | not done — needs a relaunch (F3) | not done | n/a |
| Accessible names | done: 0 unnamed of the controls measured, after E9 | not done | not done | n/a |
| Keyboard traversal order | **not done** | not done | n/a | n/a |
| VoiceOver / TalkBack, actually spoken | **not done** | not done | not done | n/a |
| Increase Contrast | not done | not done | n/a | n/a |
| Onboarding, first run | Pairing pane rendered | not done | not done | needs an unpaired phone |
| Error and retry states | done at 7 s for 13 panes (E10, E11) | not done | not done | F6 |
| Performance | done, synthetic (E12, E13) | not done | not done | F6 (Photos at depth) |
| Floating mirror, share window, palette, dialogs | **not measured** | not done | n/a | n/a |
| Light theme | done | done 2026-09-16 | n/a | n/a |

---

## E. The smallest first implementation batch (awaiting approval)

Code and tests only — no install, relaunch or device. Each item red-first against the defect it is
named for, with its control, and one commit each.

1. **S2 — pin every side channel** (`bulk.ts` ×3, `video.ts`, through one helper). The smallest
   high-severity fix; no protocol change. Test: a local TLS server with a foreign certificate never
   receives the token frame; the control server with the expected certificate does.
2. **S6 — replace the FNV tag hash** with a per-process ordinal on both sides; correct the comment
   and record the false claim in `docs/defects.md`. Test: the demo's inversion no longer recovers
   anything; the same tag maps to the same ordinal within a run.
3. **S3 — navigation, new-window and drop guards**, plus explicit `sandbox: true`. Test: the
   throwaway-Electron demo's navigation is refused under the app's own handler; the control (an
   in-app route) still works.
4. **U1 — Settings row wrapping**, and the harness's control-vs-text overlap check with its fixture.
   Verified in the harness only, and labelled so.
5. **Docs reconciliation (RB14)**: D4 → closed by `d5d11de`; defect 100's row → its `testing.md`
   verdict; `PRODUCT.md` Camera and renderer-debt rows. Your uncommitted `PRODUCT.md` edits would be
   preserved — I would need your go-ahead to touch that file at all.

**Deliberately not in batch 1:** S1 (a protocol change, so `docs/protocol.md` first, then both
sides — batch 2); S4 and S5 (larger, and S5 belongs with Developer ID signing); S7 (a product
decision on offer vs apply); P3 (needs F9's measurement first).

---

## F. Install, relaunch, migration and hardware-test plan — needs separate approval per step

Every phone write goes through `scripts/adb-pinned.sh` after `scripts/target-device.sh` names the
SM-S938B. No step runs without your explicit go-ahead for that step.

| Step | What | Irreversible? | Pass criterion, with its control |
|---|---|---|---|
| F1 | Optional private backup of the Mac profile's `logs/`, outside the repo | no | File count and bytes copied match the source |
| F2 | `npm run build` in `desktop/`, quit Sidekick from its menu, relaunch with `--force-renderer-accessibility --remote-debugging-port=9222` | **yes — runs the one-time Activity call-data rewrite (E2)** | The log line `Rewrote activity.jsonl: N … / M kept`, with N and M stated against your expected row count |
| F3 | Settings persistence: change the theme, sound and receive folder; quit; relaunch | no | All three survive. Control: a value you did not change is still its default |
| F4 | Install the phone build (`adb install -r`), start `MainActivity` by name, `scripts/link-up.sh` | no (`-r` keeps grants) | Three OKs. **Not** "Listening on" (CLAUDE.md) |
| F5 | Log privacy on hardware: one WhatsApp notification, one SMS, one call | no | No 6+ digit run in either log that is not a timestamp, counter or size. Control: the same grep finds the call id |
| F6 | Refusal UI: revoke Phone/Call logs, open Calls → reason and **Try again**; re-grant → rows return. Same for SMS. Photos at 20+ pages | no (permissions restored) | As stated; times compared with E12, and labelled as the phone's |
| F7 | **Defect 137**: one debug probe run while reading `ExternalStorageProvider`'s logcat | no | A provider log line that explains the 0-row cursor, or a recorded "no reading" |
| F8 | **Defect 30**: one SMS to a consenting number with no thread, after proving the absence in both providers | sends a real SMS | The pane opens the thread the phone names |
| F9 | **P3**: capture the phone's outbound traffic during one QR scan (a Mac-side capture on the hotspot, or the phone's own Private DNS log) | no | Either Google endpoints appear (disclose or replace the scanner) or a stated null with its window. Control: a known Play Services ping appears in the same capture |
| F10 | U1/U2 in the real window over CDP (`scripts/probe.mjs`) at 1100×700 and at 1.2× zoom | no | Settings rows do not overlap text; Settings reachable in the nav |
| F11 | After batch 1: re-pair on hardware (a fresh QR), mirror for 30 s, push and pull one file each | re-pair changes stored trust | Link up; `Encoded +N frames` ticks; the push's digest verified by the phone |

---

## Sources (policy, read 2026-10-06)

- Google Play — SMS and Call Log permissions: https://support.google.com/googleplay/android-developer/answer/10208820
- Google Play — AccessibilityService API: https://support.google.com/googleplay/android-developer/answer/10964491
- Google Play — foreground service types: https://support.google.com/googleplay/android-developer/answer/13392821
- Google Play — photo and video permissions: https://support.google.com/googleplay/android-developer/answer/14115180
- Google Play — Data safety section: https://support.google.com/googleplay/android-developer/answer/10787469
- Android — Doze and the battery-optimisation exemption policy: https://developer.android.com/training/monitoring-device-state/doze-standby#exemption-cases
- Android developer verification: https://developer.android.com/developer-verification and https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html
- ML Kit terms and data: https://developers.google.com/ml-kit/terms
- Apple — Developer ID: https://developer.apple.com/developer-id/

Apple's notarization page (`developer.apple.com/documentation/security/notarizing-macos-software-before-distribution`)
returned no body to the fetch tool, so P13's statements about un-notarized apps on recent macOS are
**not** sourced here and must be confirmed before they are relied on.
