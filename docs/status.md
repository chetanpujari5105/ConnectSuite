# ConnectSuite feature status

Audit date: 2026-08-25. Read-only inventory — no behaviour was changed to produce this file.

> ## ⚠️ Stale as of 2026-08-27. Read this box before trusting anything below.
>
> Phases 2, 3 and the phone half of 4 have landed since the audit, and this file has **not** been
> re-run. It is kept as the record of what 2026-08-25 looked like, not as a description of today.
> The specific things it now gets wrong:
>
> - **Its headline is false.** *"`LinkServer.register` … is **never called anywhere in the
>   codebase**"* — called "the one fact that drives most of this table" — is no longer true.
>   It is called by `MirrorFeature`, `InputFeature`, and the five Phase 4 features in
>   `sync-module/.../v2/`.
> - **Mirror v2 and input are not ABSENT.** Both shipped and passed on hardware (2026-08-26 and
>   2026-08-27); see `docs/testing.md`.
> - **The v1 ADB mirror rows describe deleted code.** Removed 2026-08-26.
> - **Notifications, SMS, calls, contacts and the media remote are built on the phone** as of
>   2026-08-27 and have no Mac counterpart yet. The Android column for those five is wrong in one
>   direction and the desktop column is still right.
> - **Bug 3 is fixed.** `SEND_SMS` is declared, and so are `CALL_PHONE` and `ANSWER_PHONE_CALLS`,
>   which `calls` also needs — see `docs/permissions.md`. `RECORD_AUDIO` and `READ_MEDIA_IMAGES`
>   are still undeclared, so `mic` and `photos` can still never be true; those belong to later
>   phases.
> - **The Phase column follows a numbering `CLAUDE.md` does not use.** It puts contacts, clipboard
>   and app launching in Phase 4; the roadmap table in `CLAUDE.md` — which is the numbering, by its
>   own statement — puts clipboard and contacts in 5 and app launching in 7. Contacts was moved
>   into Phase 4 deliberately on 2026-08-27 because SMS threads and call logs are columns of phone
>   numbers without it.
> - **The "known exception, not yet fixed" about `media.*` is fixed**, along with four more like it
>   nobody had noticed. See `FeatureOf` and the namespace rule in `docs/protocol.md`.
>
> Anything not listed here may also have moved. Re-run the audit before relying on this file.

State values: **DONE** (works end to end, usable today) · **PARTIAL** (real code, named piece
missing) · **STUB** (UI or function exists, does nothing real) · **ABSENT** (no code).

"Desktop state" always means *the Mac client in `desktop/`*. Several Android features are complete
against the **v1 Android-to-Android** transport and have no Mac counterpart at all; those read
`DONE (v1 peers only)` on the Android side and `ABSENT` on the desktop side. That gap is the single
most misleading thing in this repo and is why the table splits the two columns.

---

## The one fact that drives most of this table

`LinkServer.register(type, handler)` exists (`core/.../link/LinkServer.kt:253`) and is **never
called anywhere in the codebase**. Verified by grep across all modules:

```
core/.../link/LinkServer.kt:253:    fun register(type: String, handler: MessageHandler) {
```
— definition only, zero call sites.

Therefore, on the v2 link the phone answers exactly three message types — `hello`
(`ControlSession.kt:114`), `ping` (`ControlSession.kt:115`), and the protocol-version check
(`ControlSession.kt:103`). **Every other type in `docs/protocol.md` falls through to the
`handlerFor() == null` branch at `ControlSession.kt:126-135` and is answered with
`FEATURE_UNAVAILABLE`.** That is correct, honest behaviour — it is not a silent drop — but it means
no feature message is wired on the phone.

---

## Table 1 — Features

| Feature | Android state | Desktop state | Protocol messages wired | Evidence (file:line) | Phase |
|---|---|---|---|---|---|
| QR pairing (once) | DONE | DONE | `hello.pairToken` → `hello.ack` | `link/PairingQr.kt:74` (TrustStore.trust), `link/LinkServer.kt:93` (completePairing), `link/QrScanScreen.kt:1-179`, desktop `main/main.ts:162` (QR IPC), `main/link.ts:123` (armPairing) | 1 |
| TLS 1.3 + fingerprint pinning | DONE | DONE | n/a (transport) | `link/LinkTls.kt:104-129` (`needClientAuth=true`, TLS1.3 only), `link/LinkTls.kt:84-94` (reject unpaired), desktop `main/link.ts:216-255` (pin peer cert) | 1 |
| Trust store (add / forget) | DONE | DONE | n/a | `link/PairingQr.kt:74,95` (trust/forget), `data/TrustedDevice.kt:44,51` (DAO), desktop `main/main.ts:189` (forget-device) | 1 |
| Three listening sockets (42501/2/3) | DONE | n/a (client) | n/a | `link/LinkServer.kt:128-142`, `link/LinkService.kt:47` | 1 |
| Discovery: last-known → gateway → mDNS → manual | DONE | DONE | n/a | desktop `main/discovery.ts:27-51` (ordering), `main/discovery.ts:54` (gateway via `/sbin/route`), `main/discovery.ts:66` (mDNS), phone side `link/NsdAdvertiser.kt:43-51` | 1 |
| Heartbeat (ping/pong, 3 missed = dead) | DONE | DONE | `ping`, `pong` | `link/ControlSession.kt:115` (pong echoes id), desktop `main/link.ts:426-449` (5s interval, 3 strikes) | 1 |
| Auto reconnect + backoff + wake retry | DONE | DONE | n/a | desktop `main/link.ts:451-461` (1s→30s cap), `main/main.ts:135-145` (powerMonitor resume, iface change) | 1 |
| Capability negotiation | PARTIAL — see Bug 3; `sms`/`photos`/`mic` can never be true | PARTIAL — chips render but no pane is gated on them | `hello.ack.capabilities`, `capabilities.changed` | `link/Capabilities.kt:37-65`, `link/ControlSession.kt:191-198`, desktop `renderer/renderer.ts:61-69` | 1 |
| Session tokens for side channels | DONE | ABSENT — desktop never opens a video or bulk socket | first-frame token | `link/SessionRegistry.kt:18-29`, `link/LinkServer.kt:213-239` (10s grace at `:217`) | 1 |
| **Screen mirroring (v2, MediaProjection)** | **ABSENT** | **ABSENT** | `mirror.*` defined, unhandled both ends | No `MediaProjection`/`VirtualDisplay` anywhere; `LinkServer.videoChannelSink` (`:79`) is declared and **never assigned** | 2 |
| Input injection (AccessibilityService) | ABSENT | ABSENT | `input.*` defined, unhandled | No `AccessibilityService` subclass in repo | 2 |
| Screen mirroring (v1 ADB legacy) | DONE (v1 ADB only) — **and not flag-gated on Android**, see Bug 2 | DONE behind `LEGACY_ADB_MIRROR=1` | v1 ADB protocol, not v2 | `mirror-module/.../session/MirrorSession.kt:1-330`, `mirror/ui/MirrorRoute.kt`, `desktop/entry.js:7` | 3 (removal) |
| Notification mirroring + reply | DONE (v1 peers only) | ABSENT | `notif.*` defined, unhandled both ends | `sync/notifications/NotificationMirrorService.kt:1-189` — uses `NetworkPacket`/`ConnectionManager`, not `Link` | 4 |
| SMS / MMS threads | PARTIAL (v1 peers only) — receive only; no thread list, no send | ABSENT | `sms.*` defined, unhandled | `sync/sms/SmsMirrorReceiver.kt:1-78` (inbound only). No `SEND_SMS` permission declared anywhere | 4 |
| Call events + dialing | ABSENT | ABSENT | `call.*` defined, unhandled | no telephony call code in repo | 4 |
| Contacts | ABSENT | ABSENT | `contacts.*` defined, unhandled | `READ_CONTACTS` declared (`app/AndroidManifest.xml:57`) and only ever used to compute a capability | 4 |
| File transfer both directions | DONE (v1 peers only) | ABSENT | `fs.*` defined, unhandled; bulk channel unserved | `sync/transfer/TransferManager.kt:1-718` (v1 `NetworkPacket`), `LinkServer.bulkChannelSink` (`:83`) never assigned | 5 |
| Photo / video browser + drag to Finder | ABSENT | ABSENT | `media.buckets/list/thumb/original` defined, unhandled | no MediaStore query code in repo | 5 |
| Bidirectional clipboard + history | ABSENT | ABSENT | `clip.*` defined, unhandled | no `ClipboardManager` use in repo | 4 |
| App launching | ABSENT | ABSENT | `apps.*` defined, unhandled | capability `apps` is advertised unconditionally (`Capabilities.kt:42`) with nothing behind it | 4 |
| Media remote | ABSENT | ABSENT | `remote.state/command` defined, unhandled | capability `remote` advertised on notification-listener grant (`Capabilities.kt:54`) with nothing behind it | 4 |
| Virtual webcam | ABSENT | ABSENT | none defined in protocol at all | not in `docs/protocol.md`, not in either `Messages.kt` / `protocol.ts` | later |
| Battery / net state | ABSENT | ABSENT | `battery.state`, `net.state` defined, unhandled | constants only: `Messages.kt:111-112`, `protocol.ts:44-45` | later |
| Reconnect over USB | ABSENT | ABSENT | n/a | discovery has no USB/adb-forward path (`discovery.ts:27-51`); CLAUDE.md forbids ADB in v2 — **the reference-behaviour list and the architecture rules contradict each other here** | later |
| Diagnostics screen (Android) | ABSENT | n/a | n/a | no such screen | D |
| `npm run doctor` | n/a | ABSENT | n/a | no script in `desktop/package.json:6-11` | D |
| Fake phone test server | n/a | ABSENT | n/a | `desktop/test/` does not exist | D |
| `npm test` | n/a | ABSENT | n/a | no `test` script in `desktop/package.json` | D |

---

## Table 2 — Message types: defined vs handled

Source of truth is `docs/protocol.md:34-47`. "Phone handler" = a `register()`ed handler.
"Desktop sends" = an actual call site in `desktop/src/`.

| Type | In `Messages.kt` | In `protocol.ts` | Phone handler | Desktop sends | Desktop handles reply |
|---|---|---|---|---|---|
| `hello` / `hello.ack` | yes | yes | **yes** (`ControlSession.kt:114,154`) | yes (`link.ts:319`) | yes (`link.ts:375`) |
| `ping` / `pong` | yes | yes | **yes** (`ControlSession.kt:115`) | yes (`link.ts:440`) | yes (`link.ts:336`) |
| `ack` | yes | yes | n/a (phone sends) | n/a | yes (`link.ts:351`) |
| `error` | yes | yes | n/a (phone sends) | n/a | yes (`link.ts:352-368`) |
| `capabilities.changed` | yes | yes | n/a (phone pushes, `ControlSession.kt:191`) | n/a | yes (`link.ts:346`) |
| `notif.posted/removed/reply/action/dismiss` | yes | **NO** | no | no | no |
| `sms.threads/messages/send/received` | yes | **NO** | no | no | no |
| `call.incoming/ended/log/dial/answer/reject` | yes | **NO** | no | no | no |
| `contacts.list/get` | yes | **NO** | no | no | no |
| `clip.push/request/history` | yes | **NO** | no | no | no |
| `fs.list/stat/mkdir/delete/transfer.*` | yes | **NO** | no | no | no |
| `media.buckets/list/thumb/original` | yes | **NO** | no | no | no |
| `mirror.start/stop/config/keyframe/rotate` | yes | yes | no | **no call site** | no |
| `mirror.screenoff` | yes (`Messages.kt:95`) | **NO** | no | no | no |
| `input.tap/swipe/scroll/key/text/global` | yes | yes | no | **no call site** | no |
| `apps.list/launch/icon` | yes | **NO** | no | no | no |
| `remote.state/command` | yes | **NO** | no | no | no |
| `battery.state` / `net.state` | yes | yes | no | no call site | no |

### Defined but unhandled on **both** ends

Everything except `hello`, `hello.ack`, `ack`, `error`, `ping`, `pong`, `capabilities.changed`.
That is **46 of the 53 message types** in `docs/protocol.md`.

### Sync drift between the two protocol files

`desktop/src/shared/protocol.ts` declares only 18 of the 53 types. CLAUDE.md requires the two files
to stay in sync with `docs/protocol.md`. They are not. This is harmless today (nothing sends them)
but it means the desktop file cannot be trusted as a checklist.

Additionally `protocol.ts:16` sets `SERVICE_TYPE = 'connectsuite'` while `Messages.kt:36` sets
`"_connectsuite._tcp"`. **This is not a bug** — `bonjour-service` takes the bare name plus a
separate `protocol: 'tcp'` (`discovery.ts:78`) and composes the same string. Flagged only so nobody
"fixes" it into a real breakage.

---

## Table 3 — Every interactive control

### Android

| Control | Location (file:line) | Handler exists | Backend exists | Behaviour when tapped today |
|---|---|---|---|---|
| Bottom nav: Sync / Mirror / Mac | `AppNavigation.kt:81` | yes | yes | Navigates. Fine. |
| **"Connect" (Sync → Devices)** | `sync/ui/devices/DevicesScreen.kt:194` | yes → `DevicesViewModel.connect:86` | **v1 only — dials a port the Mac never opens** | 🔴 **ERRORS.** Snackbar `Connection refused` / `failed to connect`. Full diagnosis below. |
| **"Connect" (Mirror tab)** | `mirror/ui/MirrorRoute.kt:415` | yes → `MirrorViewModel.connect:106` | **v1 ADB only** | 🔴 **ERRORS.** Empty field → snackbar "Enter the target's address…". With an address → ADB connect failure. Full diagnosis below. |
| **"Connect" (Mirror → recent target)** | `mirror/ui/MirrorRoute.kt:435` | yes → `MirrorViewModel.connect(target):115` | v1 ADB only | 🔴 **ERRORS**, same path as above. |
| "Pair" (Sync → Devices) | `DevicesScreen.kt:209` | yes → `DevicesViewModel.pair:93` | v1 only | 🔴 Errors — dials first (`:97`), fails the same way as Connect. Only reachable if a v1 UDP peer appears. |
| "Send files" (Sync → Devices) | `DevicesScreen.kt:189` | yes → `SyncRoute.kt:104` | v1 only | Opens file picker; transfer then fails with no v1 connection. Only shown when `isConnected`, which the Mac never sets. |
| "Forget" (Sync → Devices) | `DevicesScreen.kt:190,197` | yes → `DevicesViewModel.forget:118` | yes | Works. **Deletes the row the v2 link's trust depends on** — see Bug 4. |
| "Join group" (Wi-Fi Direct) | `DevicesScreen.kt:205` | yes → `joinWifiDirectGroup:123` | v1 only | Wi-Fi Direct invite. Unrelated to the Mac link. |
| Channel chip | `DevicesScreen.kt:177` | `onClick = {}`, `enabled=false` | n/a | ⚪ Intentionally inert label. Acceptable. |
| "Waiting…" | `DevicesScreen.kt:201` | `onClick = {}`, `enabled=false` | n/a | ⚪ Intentionally inert. Acceptable. |
| Refresh / scan again | `DevicesScreen.kt:132` | yes → `refresh:82` → `udpDiscovery.announceNow()` | v1 only | Sends a v1 UDP broadcast. The Mac does not listen for it, so nothing appears. **Silently does nothing** from the user's point of view. |
| "Scan pairing code on Mac" | `link/LinkRoute.kt:111` | yes | yes | ✅ Works — the v2 pairing path. |
| "Start / Restart listening" | `link/LinkRoute.kt:115` | yes → `LinkService.start` | yes | ✅ Works. Note it only ever *starts*; the label says "Restart" but no stop happens first. |
| "Forget" (Mac card) | `link/LinkRoute.kt:134` | yes → `trustStore.forget` | yes | ✅ Works. |
| Sync settings toggles (7) | `sync/ui/settings/SyncSettingsScreen.kt:85,97,108,117,126,144,153,202` | yes | v1 only | Persist to `SettingsStore`/Room. Real, but only affect v1 mirroring. |
| Transfers "Cancel" | `sync/ui/transfers/TransfersScreen.kt:114` | yes | v1 only | Works for a v1 transfer; none can exist with the Mac. |
| Incoming offer Save/Decline | `TransfersScreen.kt:214,215` | yes | v1 only | Works for v1 peers. |
| Notifications "Open settings" | `sync/ui/notifications/NotificationsScreen.kt:69` | yes | yes | ✅ Opens system settings. |
| Notification dismiss | `NotificationsScreen.kt:151` | yes | v1 only | Works locally. |
| Mirror: Back/Home/Recents/Power | `MirrorRoute.kt:197,203,206,209` | yes | v1 ADB only | No-ops with no ADB session; errors with one. |
| Mirror: quality chips | `MirrorRoute.kt:400` | yes | yes | Persists a preference. Harmless. |
| Mirror: setup wizard | `MirrorRoute.kt:94,370,443`, `SetupWizard.kt:70,111` | yes | yes | Shows v1 ADB instructions — **actively misleading under the v2 architecture.** |
| Onboarding primary/secondary | `onboarding/OnboardingScreen.kt:116,119,306` | yes | yes | ✅ Works. |
| QR scan: grant camera / cancel | `link/QrScanScreen.kt:101,107` | yes | yes | ✅ Works. |

### Mac

The Mac UI has **no feature panes at all** — no sidebar, no mirror view, no SMS/notification/file
panes. It is a single-column connection console (`renderer/index.html:10-74`). Section E's "Mac
sidebar panes" do not exist to be disabled.

| Control | Location (file:line) | Handler exists | Backend exists | Behaviour when clicked today |
|---|---|---|---|---|
| "Show a fresh code" | `index.html:23` → `renderer.ts:110` | yes | yes | ✅ Rotates the pairing token, redraws QR. |
| "Connect" | `index.html:37` → `renderer.ts:111` | yes | yes | ✅ `link.start()`. |
| "Disconnect" | `index.html:38` → `renderer.ts:112` | yes | yes | ✅ `link.stop()`. |
| "Retry now" | `index.html:39` → `renderer.ts:113` | yes | yes | ✅ `link.retryNow()`. ⚠️ No-ops silently when already connected (`link.ts:87`) — no feedback. |
| "Forget phone" | `index.html:40` → `renderer.ts:114` | yes | yes | ✅ Works. No confirmation dialog on a destructive action. |
| "Save" manual address | `index.html:59` → `renderer.ts:119` | yes | yes | ✅ Works. No validation, no confirmation that it was saved. |
| "Save" Tailscale address | `index.html:63` → `renderer.ts:122` | yes | yes | ✅ Stores it. ⚠️ Unlike manual, does **not** trigger a retry (`main.ts:184-187`) — inconsistent, looks dead. |
| "Refresh" logs | `index.html:70` → `renderer.ts:125` | yes | yes | ✅ Works. |
| Capability chips | `renderer.ts:61-69` | display only | n/a | ⚪ Non-interactive. Correctly greys out absent capabilities — this is the only honest "not available" signal in either UI. |
| Tray: Reconnect now / Connect / Disconnect / Quit | `main.ts:74-82` | yes | yes | ✅ Work. |

**Controls that error when tapped:** the three "Connect" buttons and "Pair" on Android. Nothing on
the Mac errors.

**Controls that silently do nothing:** Android "Scan again" (v1 UDP into the void); Mac "Retry now"
while connected; Mac "Save" Tailscale (no retry, no feedback).

---

## Bugs found during the audit

Ordered by what they will cost if left alone.

### Bug 1 — The phone dials the Mac every 15 seconds, forever (architecture violation)

`DeviceRepository.reconnectLoop()` (`core/.../repository/DeviceRepository.kt:140-153`) wakes every
15 s (`RECONNECT_INTERVAL_MS`, `:215`), reads **every** row in `trusted_devices`, and dials any row
that is not v1-connected.

The v2 QR pairing writes the Mac into that same table (`PairingQr.kt:74-90`) with
`lastPort = Link.PORT_CONTROL` (**42501**, `:88`). So from the moment the user pairs, the phone
opens a TCP connection to `<mac-ip>:42501` every 15 seconds, for the life of the process, and writes
a plaintext v1 identity line at it (`ConnectionManager.kt:163-165`).

This directly violates locked architecture decision #2: *"Android binds the listening sockets. The
Mac connects out."* Cost: constant radio wakeups and battery drain on a phone that is supposed to be
idle, plus a `Log.d` line every 15 s. It is also the root cause of Bug 2.

### Bug 2 — The Connect button (Section B). See the dedicated section below.

### Bug 3 — Three capabilities can never be true, because their permissions are not declared

`Capabilities.kt` gates capabilities on permissions that appear in **no** manifest in the repo:

| Capability | Requires | Declared? |
|---|---|---|
| `sms` | `READ_SMS` **and `SEND_SMS`** (`Capabilities.kt:56`) | `READ_SMS` yes; **`SEND_SMS` no** |
| `mic` | `RECORD_AUDIO` (`Capabilities.kt:64`) | **no** |
| `photos` | `READ_MEDIA_IMAGES` on API 33+ (`Capabilities.kt:63,70-75`) | **no** — only `READ_EXTERNAL_STORAGE` with `maxSdkVersion="32"` (`app/AndroidManifest.xml:70-72`) |

An undeclared runtime permission can never be granted, so these three chips are permanently grey on
the S25 Ultra (API 35+) no matter what the user does in Settings. This will read as "the capability
system is broken" the first time someone tests it.

Recommendation: **do not** add the manifest lines now. Declaring `SEND_SMS`/`RECORD_AUDIO` with no
feature behind them invites a Play Store policy rejection. Add each one in the phase that implements
its feature, and meanwhile make the detector's intent explicit rather than silently false.

### Bug 4 — Two "Forget" buttons, one shared table, no warning

`DevicesScreen.kt:190,197` ("Forget", Sync tab) calls `PairingManager.forget(device.id)`, which
deletes from `trusted_devices` — the same table the v2 TLS trust manager reads
(`PairingQr.kt:63-70`). Forgetting the Mac from the **Sync** tab therefore silently revokes the v2
pairing, and the Mac starts failing its TLS handshake with no explanation on the phone. The Sync-tab
button gives no indication it is about to break the Mac link.

### Bug 5 — The v1 ADB Mirror tab is not behind `LEGACY_ADB_MIRROR` on Android

CLAUDE.md: *"The old ADB mirror stays behind a `LEGACY_ADB_MIRROR` flag, default off."* That flag
exists **only** on the desktop (`desktop/entry.js:7`, `package.json:10`). On Android the Mirror tab
is an unconditional top-level destination (`AppNavigation.kt:41,108`) and its setup wizard actively
instructs the user through `adb tcpip 5555`. Two of the three erroring Connect buttons live here.

### Bug 6 — `MAX_FRAME` is defined on both ends and enforced on neither side channel

`Link.MAX_FRAME` (`Messages.kt:28`) and `MAX_FRAME` (`protocol.ts:14`) are declared but never read.
The side-channel accept path caps only the token frame at 128 bytes (`LinkServer.kt:219`). Harmless
while nothing serves those channels; must be wired when Phase 2 opens the video socket.

---

## Deferred to later phases (out of scope for this session)

- Everything marked ABSENT in Table 1 above.
- Wiring `protocol.ts` up to the full 53-type list.
- `MAX_FRAME` enforcement on the video/bulk channels (Bug 6) — belongs with Phase 2.
- Declaring `SEND_SMS` / `RECORD_AUDIO` / `READ_MEDIA_IMAGES` (Bug 3) — belongs with Phase 4/5.
- Removing the Android Mirror tab / ADB package (Bug 5) — Phase 3 per CLAUDE.md.

## Phase-plan conflicts found in the repo

1. **Two incompatible phase plans exist and only the obsolete one is written down.**
   `android-connect-suite-claude-code-prompt.md` is the v1 plan: Phase 2 = Discovery & Pairing,
   Phase 3 = File Transfer, Phase 5 = Screen Mirroring, Phase 6 = Input Injection. CLAUDE.md uses
   entirely different numbering: Phase 2 = mirroring, Phase 3 = delete the ADB mirror, Phase 5 =
   transfers. The v2 plan exists nowhere as a document. "Phase 3" means two different things
   depending on which file you read.
2. **`docs/testing.md` does not match the Phase 1 test list in use.** The file has 8 tests; the
   working list has 10, in a different order, and adds force-stop/WorkManager, reboot, a 10-minute
   idle soak and battery reporting — none of which appear in `docs/testing.md`. See that file for
   how they were reconciled.
3. **"Reconnect over USB" is in the reference-behaviour list but forbidden by the architecture
   rules.** USB reconnect in this design would need `adb reverse`, and locked decision #1 bans ADB
   from the v2 path. One of the two has to give.
