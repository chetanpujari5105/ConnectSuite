# Defect register

Every defect found in this project, with its status, where its full record lives, and — for the
open ones — the fix direction and the wrong fix that has already been tried or already looks
tempting.

**Why this file exists.** Step 67 passed on hardware on 2026-08-28 and was never written down; the
repo held only its fallout, and defect 31 still read *awaiting step 67* while it had in fact been
verified. Ten defects and four rejected fix shapes were living in a session transcript. A finding
that is not in the repo is not a finding, it is a memory — so this is the index, and
`docs/testing.md` holds the evidence behind each row.

**How to keep it true.** `scripts/check-defects.sh` compares this table against the `### Defect NN`
headings in `docs/testing.md` and fails on a number or a status that appears in one and not the
other. It is wired as a `PreToolUse` hook on `git commit`, the same way the force-stop rule is a
hook rather than a paragraph — see the last section of `CLAUDE.md` for why "documented" is not the
same as "handled".

Status values: **open** · **fixed** (code changed, not yet proven on hardware) · **closed** (fixed
*and* verified on hardware, with the evidence recorded) · **deferred** (open, and deliberately not
this sitting's work).

---

## The register

Defects 1-16 predate the `### Defect NN` convention and are recorded inside the Phase 1 and Phase 2
sections of `docs/testing.md`; all were closed before Phase 3 opened. Everything from 17 on has its
own heading there, and its own row here.

| # | One line | Status | Verified by | Full record |
|---|---|---|---|---|
| **17** | The Mac holds one phone structurally, and refuses the second one rather than evicting it | **deferred** | — | see below |
| **18** | Every successful gesture was reported as a timeout, because success *was* the timeout value | **closed** | Phase 3 hardware run; `GestureDispatchTest` guards it | `docs/testing.md` |
| **19** | A press that straddles a rotation was dropped in silence | **closed** | 2026-08-27 | `docs/testing.md` |
| **20** | Queued input landed in whatever app was in front when it finally dispatched | **closed** | 2026-08-27 | `docs/testing.md` |
| **21** | Every scroll went the wrong way, and a test said it should | **closed** | 2026-08-27 | `docs/testing.md` |
| **22** | The phone's sentence arrived wrapped in Electron plumbing | **closed** | 2026-08-27 | `docs/testing.md` |
| **23** | The secure-surface message was erased by the black frames it was explaining | **closed** | 2026-08-27 | `docs/testing.md` |
| **24** | The capability chip explained nothing, and a comment said it did | **closed** | 2026-08-28 | `docs/testing.md` |
| **25** | The Mac kept offering a phone it was not connected to | **closed** | 2026-08-28 | `docs/testing.md` |
| **26** | A capability chip's state was a colour and nothing else | **closed** | 2026-08-28 | `docs/testing.md` |
| **27** | An unavailable capability's reason went stale the moment it was wrong | **closed** | 2026-08-28 | `docs/testing.md` |
| **28** | A notification row could be labelled with a raw package name | **closed** | 2026-08-28, three copies found | `docs/testing.md` |
| **29** | The call log read the wrong key and reported an empty log | **closed** | 2026-08-28 | `docs/testing.md` |
| **30** | The Mac cannot start a new SMS conversation | **open** — explicit-address path closed on hardware; the **no-thread half is fixed on the Mac and proven with fakes only** (2026-09-29: the ack usually names no thread, so the pane said *Sent.* and opened nothing; it now adopts the thread named by the first outbound `sms.sent` to the same number within 30 s, once — `smsView.test.ts`, 4 tests, 3 mutations red). **Still owed: one real send to a consenting number with no thread** | hardware 2026-08-31 (**step 71**): Mac → bare address `9850850263`, phone verified the recipient, pane opened the thread the *phone* named | `docs/testing.md` |
| **31** | The media card never learned about changes made on the phone | **closed** | **step 67**, 2026-08-28 | `docs/testing.md` |
| **32** | The SMS pane cannot reach a conversation older than its first page | **closed** | on hardware 2026-08-31 — 50 → 89 → 126 → 158 → 183, all distinct | see below |
| **33** | The phone names packages where it means apps, in sentences users read | **fixed** 2026-09-03 — `NoReplyAction`'s parameter is a resolved `appName`, both call sites go through `AppLabels.of`, and the wrong-conversation refusal line names the app too. Guarded by `PackageIdInProseTest`, a source scan, because the bug is never in the failure class and always at the call site, which no unit test can see. Comments are stripped so the guard does not forbid its own explanation. Red-first: 1 of 3 | — | see below |
| **34** | `sms.received` dropped by the Mac: the phone sent a shape the contract does not describe | **closed** | **step 68**, both contact states, 2026-08-28 | `docs/testing.md` |
| **35** | An outgoing call's card was labelled with nothing at all | **closed**, both halves | **step 69** (outgoing) 2026-08-28; **step 70** (35c, inbound) 2026-08-31 | `docs/testing.md` |
| **36** | A call rejected from the Mac was reported as `missed` | **closed** | **step 70** on hardware, 2026-08-31 — `ended rejected` with the platform's `type=5` as the control | `docs/testing.md` |
| **37** | A re-granted notification listener never turned its capabilities back on | **closed** | hardware, link **down**, 2026-08-29 | `docs/testing.md` |
| **38** | A volume change made on the phone never reaches the Mac | **deferred** | — | see below |
| **39** | A message sent from the Mac is missing from the thread it was sent into | **closed** | hardware 2026-08-31 (**step 71**) — 17 → 18 drawn, outbound, **without leaving the thread** | `docs/testing.md` |
| **40** | `call.reject delivered` named a disposition the disposition logic then overrode | **closed** | hardware, 2026-08-29 | `docs/testing.md` |
| **41** | The force-stop hook denies prose that merely mentions the rule | **closed** | hook fixture tests, 2026-08-29 | see below |
| **42** | An episode is labelled with the previous call's number | **closed** | outgoing hardware 2026-08-29; inbound on **step 70**, 2026-08-31 — `c7` drew its own number and contact, not `c6`'s | see below |
| **43** | A call with no number logged as `from ,` on the Mac — the string defect 35 is named for | **closed** | `calls.test.ts`, 2026-08-29 | see below |
| **44** | A message sent on the phone never reaches the Mac — no observer on outgoing rows | **closed** | hardware 2026-08-31 (**step 71**) — row 22212 pushed, Mac drew `to`, with `from` on the same thread as the control | `docs/testing.md` |
| **45** | `EXTRA_INCOMING_NUMBER` arrives too late for the card, so no inbound call had a number | **closed** by option 4 | **step 70**, 2026-08-31 — 7 of 7 episodes corrected, 16–535 ms | see below |
| **46** | The media remote puts a raw package id in a sentence — and drops it entirely in two more | **closed** | `shared/appLabel.ts` + 8 fixtures shown to fail, live in the running app, 2026-08-31 | see below |
| **47** | ~~A live call card the Mac cannot correct~~ — **WITHDRAWN.** The card was true; `c13` was a 68-minute WhatsApp video call | **withdrawn**, not a defect | `dumpsys telecom`, 2026-08-31 | see below |
| **48** | Two step-70 locks at two paths excluded nothing — each watcher took its own and both armed | **closed** | reconciled to one path; exclusion fixtures, 2026-08-30 | see below |
| **49** | The exclusion's refusal overstated its own evidence — one CDP client was counted as two | **closed** | `lsof` fixture and three controls, 2026-08-30 | see below |
| **50** | The thread cursor was never honoured — the conversations view returns nothing for a *bound* selection argument | **closed** | on hardware 2026-08-31; found while proving 32's pager actually pages | see below |
| **51** | The after-send retry reports a loss it does not suffer — an `e:` line and a `dropped` counter for messages the observer then delivers | **fixed** 2026-09-03 — the after-send miss is a *deferral*, not a loss: the observer delivers it, which is what 2 of 2 did in step 71. `SentPushTally` counts `pushed / deferred / recovered / still owed`, `w` replaces the `e` line that predicted a loss that did not happen, and only `still owed` is a real problem. Red-first: 3 of 7 | found during **step 71**, 2026-08-31 — 2 of 2 Mac-origin sends | `docs/testing.md` |
| **52** | One `dropped` counter for three different things in `VideoChannel`, and the third never reaches it | **fixed** 2026-09-03 — three reasons, three counters, and the oversize case counted at all, so the mirror's only channel-level correctness fault now reaches `droppedFrames` on the wire. `headline()` reports the worst thing that is *true* instead of asserting *the Mac is behind*, and the summary carries its denominator. Red-first: 4 of 7 | source sweep, 2026-08-31 — the counter shape 51 asked to be swept for | see below |
| **53** | Two of the Mac's four call refusals move the counter without leaving a line | **fixed** 2026-09-03 — both silent sites log with the tally. The guard is a **count equality** rather than four string checks, because four checks prove today's four sites and the equality is what a fifth has to satisfy. Red-first: 3 of 4 | source sweep, 2026-08-31 | see below |
| **54** | `photos` would have been advertised with nothing serving the bulk channel its own `media.original` runs on | **closed** | red first, 2026-08-31, before any `media.*` code existed — `CapabilityPermissionTest` | `docs/testing.md` |
| **55** | `fs.list` re-read and re-sorted the whole directory on every page — correct, and 490 seconds for one folder. **Read the rule, not the fix**: every check this project had ever asked of a pager passed while `limit` bounded the frame and never the work, so *a green pager needs a clock beside it* is now a rule in `CLAUDE.md` and outlives this row | **closed** | on hardware 2026-09-01, in the slice that introduced it; found by paging to exhaustion, not by a first page | `docs/testing.md`; the rule is in `CLAUDE.md` |
| **56** | **A truncated push was committed as the finished file.** Above the 64 MB pre-hash ceiling no digest is agreed, so nothing but the length agreed on the control channel could tell an interruption from a completion — and nothing was checking it. **The most serious defect found in Phase 5**: reachable by any interrupted push of a large file, and its symptom is a file that looks whole and is half there, which is exactly what `.part` exists to prevent, defeated on the last step | **closed** | on hardware 2026-09-01, in the slice that introduced it; the guard is `FsArrivalTest`, shown red three ways 2026-09-01 | `docs/testing.md` |
| **57** | `media.thumb` answers `NOT_FOUND` both for a photo that is gone and for one that is there and could not be rendered — one code for two facts, on the namespace whose sibling `fs.thumb` separates them deliberately | **fixed** 2026-09-03 — proven on hardware with a corrupt JPEG written to `Download/ConnectSuite`, which is why the deferral expired: a grant-free root of our own means nothing of the owner's is touched. `media.thumb` now answers `NO_THUMBNAIL` for a present-but-undecodable row, and the swallowed `FileNotFoundException: Input was incomplete` — an exception whose own name says *not found* about a file that is found — is logged. `docs/testing.md` → Phase 6 Slice 11. Was: **deferred to Phase 6** — the second option Phase 5's closing condition offers, taken deliberately. The branch has never been produced: it needs an undecodable `MediaStore` row, which means truncating a file's bytes under its own entry on somebody's real phone, and a phase of ordinary use produced none. Reporting only — the Mac already drops errored ids into a `missing` set and stops asking, which is correct for both causes | source, 2026-09-01, found by reading the handler against the contract while `media.*` was written into `docs/protocol.md` | see below |
| **58** | **The clipboard undo was reachable and not visible.** With auto-apply on, the Mac captures the clipboard it overwrites as a `displaced` entry so Restore is an undo — the condition `docs/protocol.md` set for removing the confirmation. `onClipArrived` carries the arriving entry and **not** the displaced one created beside it, so the pane's mirror learned about the new clip and never about what it replaced; the Restore row appeared only on the next `refresh()`, which a button click triggers — the click auto-apply exists to remove. **Every test was green**, because no test reads the renderer's list | **closed** | on hardware 2026-09-02, in the slice that introduced it. Found by reading the pane's rows structurally after an auto-apply and noticing the arrival at 1:21:08 had no Restore row while one from 1:17:13 did — not by any failure | `docs/testing.md` → Slice 12 §9 |
| **59** | **A watcher send was invisible in the Mac's clipboard pane.** The pane refreshed only on its own button clicks, and the watcher clicks nothing — so after copying on the Mac the list still rendered *"Nothing yet. Copy something on either machine."* over a history with entries in it. The probe step that should have caught it **had no assertion**: it sliced the first 60 characters of the list and printed them, so a list full of rows was reported under the heading *"The pane starts with an empty history and says so"* | **closed** | on hardware 2026-09-02, in the slice that introduced it; fixed with a `clip-changed` event on any history mutation, re-measured as 2 rows drawn with nothing touched | `docs/testing.md` → Slice 13 |
| **60** | **The link did not come back after a reboot.** `RECEIVE_BOOT_COMPLETED` was declared in `app/src/main/AndroidManifest.xml` from Phase 1 and **nothing received it** — the control is that the whole project declared two `<receiver>` elements, both in `sync-module`, and neither carried a `BOOT_COMPLETED` filter. `LinkBootReceiver` now takes `BOOT_COMPLETED`, Samsung's `QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED` — the last closing the *"reinstalling leaves the phone serverless"* hole `CLAUDE.md` documents, by the same route | **closed** — the receiver is proven on hardware through a real restart. **Read defect 64 before reading this as "the boot path works"**: the branch that fired is the *no-op* one | **2026-09-02, a real reboot with nothing tapped**: `[autostart] BOOT: already listening — nothing to do` at 12:41:08, and `scripts/link-up.sh` three OKs. The `MY_PACKAGE_REPLACED` half proven separately at 13:01 — 28/28 grants preserved, diff empty, listening 10 s later. Guarded by `BootAutoStartTest` (9 tests), shown red under three mutations | `docs/testing.md` → Phase 6 Slice 1 |
| **61** | **The link wake lock is never re-armed, and the comment on the field claims it is.** `acquireLocks()` guards on `wakeLock == null`, so once the 12-hour `acquire()` timeout lapses it, nothing re-acquires for the rest of the connection. Unreachable in every reading this project holds — the longest observed hold is 31 minutes — **because the link has never stayed up for twelve hours**, which is the problem Phase 6 exists to remove | **closed** | fixed 2026-09-02 and **corrected the same day**: the first fix re-acquired only on `!isHeld`, which repairs a lapse rather than preventing one — the overnight run measured a **59m49s** hold against a 60-minute timeout, i.e. a nineteen-minute gap about to open. A tick on a held lock now *extends* it.  `LinkLockPolicy` + `BootAutoStartTest`, shown red under three mutations including the 59-against-60-minute edit a naive `REARM < TIMEOUT` would pass. The re-arm path itself needs a >20-minute connection and is being sampled overnight | `docs/testing.md` → Phase 6 Slice 2 |
| **62** | **A crash leaves the phone alive, fully granted, and serverless.** After a kill whose reason is `(adj 0): crash`, `START_STICKY` did not restart `LinkService`; the process came back 10 s later for the notification-listener rebind, every capability went green, and no socket was bound. The third route to the state `CLAUDE.md` documents for `adb install -r`, and the only one that needs nothing but a crash. Silent on both sides — the Mac shows the same reconnect loop it shows for a phone in a lift | **closed** | fixed and reproduced in one run on hardware 2026-09-02: the same `Start proc … for service {…NotificationMirrorService}` signature, and 304 ms later `[autostart] LISTENER_REBIND … starting LinkService` → listening → Mac reconnected 11.4 s after the kill. Originally seen as P5b: `Killing 23016 … (adj 0): crash` → `Start proc 31828 … for service {…NotificationMirrorService}` → 0 sockets, with the control that run 1's death logged `Foreground as UNKNOWN` 0.7 s later and this one logged nothing | `docs/testing.md` → Phase 6 Slice 2 |
| **63** | **The onboarding security note describes the wrong one of two pairing flows.** Filed as *"a pairing flow this app does not have"* — that was **too generous to the code and too harsh on the sentence**. `PairingRequestDialog` and `PairingManager.acceptPairing` do exactly what it says: an 8-group fingerprint, shown on both devices, confirmed by a tap. That is the **Sync** path (v1, Android to Android) and it works. Onboarding's subject is the **Mac**, whose pairing is a QR the phone scans with no confirmation anywhere. A true sentence about the wrong path, four pages before the user meets the other one | **closed** 2026-09-02 | Fixed as a pass over all four pages — what the fix direction asked for — which found **two larger defects beside it**, see 65. `OnboardingCopyTest`, 8 tests, red under 7 mutations including the original sentence restored verbatim | `docs/testing.md` → Phase 7 Slice 4 |
| **64** | **The boot path has never started anything, and the run that "proved" it could not have.** On the 2026-09-02 restart `LinkBootReceiver` fired and took the `already listening — nothing to do` branch: the notification-listener rebind had started `LinkService` **3.9 s earlier**. `startOrLog` was never reached for `BOOT`, so `foregroundTypesFor(BOOT) = connectedDevice only` — written narrow because `FGS_BOOT_COMPLETED_RESTRICTIONS` may deny `dataSync` — is still unexercised. With the listener enabled the rebind may **always** win, making the BOOT start structurally unreachable on this handset | **closed** 2026-09-03 — a real boot with the listener grant revoked; `startOrLog` reached for BOOT (no-op branch 0), `Foreground as BOOT, types=0x10`, ports listening 77 ms later, Mac reconnected in 5.6 s with nothing tapped. The control is `LISTENER_REBIND lines since boot: 0`. `docs/testing.md` → Phase 6 Slice 6 — **still open on 2026-09-03, and the attempt to close it produced a better reading than a pass would have.** `foregroundTypesFor(BOOT)` is **reachable and correct**: on 2026-09-02 at `17:48:15` the log carries `BOOT: 1 paired device(s) … starting LinkService` **and** `Foreground as BOOT, types=0x10`. **That was not a boot.** `uptime` puts this device's last real boot at `2026-09-02T12:40:05`, so 17:48 was a synthetic `QUICKBOOT_POWERON`, and it raced `LISTENER_REBIND` in the *same millisecond* and happened to win. So the branch and the narrow type claim are proven; what stays unproven is that a **real** boot reaches them with the listener rebind also armed — on the real boot it lost. Two different claims, and `scripts/defect64-read.sh` v1 merged them into one number and printed `DEFECT 64 CLOSED` over a phone that had not rebooted (`docs/testing.md` → Phase 7 Slice 9 §4). The experiment still owes one reboot **with notification access revoked**, which removes the competing route | source + the boot log, 2026-09-02: `12:41:04.355 [autostart] LISTENER_REBIND … starting LinkService` → `12:41:08.218 [autostart] BOOT: already listening`; and `17:48:15.822 BOOT: … starting LinkService` + `17:48:15.846 Foreground as BOOT, types=0x10`, with `/proc/uptime` ruling out a boot at that time | see below |
| **65** | **Two deleted features were still being taught to new users.** Onboarding page 1 offered *"See and control another Android device's screen from here… the target needs debugging enabled once"*, and page 3 was three numbered steps walking a new user through developer options and `adb tcpip 5555`. Both describe the **v1 ADB mirror, deleted 2026-08-26**. `adb tcpip 5555` survived in exactly one place in the repository and it was a sentence shown to users, in an app whose first locked decision is *no ADB anywhere*. `README.md` carried it in three more places | **closed** 2026-09-02 | Found by reading all four pages against the implementation rather than patching the one reported. Copy moved to `OnboardingCopy.kt`; `OnboardingCopyTest` freezes the pre-fix strings as a fixture and is red whenever any returns. The `app/` module had **no test source set at all** before this | `docs/testing.md` → Phase 7 Slice 4 |
| **66** | **A shipped, logged failure had no route to the screen.** `LinkTls.checkClientTrusted` has logged `Rejected unpaired client …` since Phase 1. The Mac tab rendered *"Listening for your Mac"* for a refused handshake, for a Mac that had not dialled, and for a Mac on a different network — three situations, one sentence, forever. The user is holding the phone; it was the one screen that could say something and did not | **closed** — **all three states proven on hardware 2026-09-03** (`docs/testing.md` → Phase 7 Slice 9). This cell previously read *"F2 proven 2026-09-02; F4 and F5's own states not yet drawn"* while `docs/phase-7-pairing-flow.md` called all three unverified — the two disagreed for a day and no check covers phase or item status | `LinkWaitStatus` (pure, in `core/`) + the accept loop publishing `RefusedConnection`. `LinkWaitStatusTest`, 11 tests, red under 6 mutations. On hardware: the reordered tab renders `Connected to Chetans-MacBook-Pro` → `Pair another Mac` → the paired list → `Advanced` **collapsed**, and expands to the ports line and capability diagnostics. The `Waiting` and `Refused` branches need a stopped Mac and an unpaired one and have been seen only in tests | `docs/testing.md` → Phase 7 Slice 4 |
| **67** | **The phone's wait clock measured the server's uptime, not the wait.** F4's twenty-second network hint was judged against `listeningSinceMillis`, written once when the accept loops came up — so on any phone listening for more than twenty seconds, which is every phone after the first half minute, the hint appeared the instant its Mac went away. *"Check that your Mac is awake and on the same Wi-Fi"* two seconds after closing a lid is exactly the alarming noise the threshold exists to prevent | **closed** 2026-09-02, **proven on hardware** | Found by looking at the screen, 25 s after stopping the Mac app, on the run staged to watch F4 draw. **Eleven unit tests were green throughout and none could have caught it** — they call `LinkWaitStatus.of` and hand it the field by hand, so they test the decision at a layer the defect does not live in. Fixed by extracting `LinkState.afterSessionEnded`, now 16 tests, red under three mutations including the original bug. Re-measured on hardware: hint absent through t+21s after a drop, shown by t+27s | see below |
| **68** | **A signed release APK was one incidental failure away from being installed on someone else's phone.** `adb install` targets whatever single device is on the bus and says nothing about which. The Samsung had been swapped for an **OPPO CPH1859** and the command was issued against it; what stopped it was `INSTALL_FAILED_OLDER_SDK` (minSdk 29 against SDK 28), which is luck, not a check. **The tell had already appeared and been explained away**: `pm list packages \| grep chetan` returned nothing on a device where the debug build had been installed twenty minutes earlier, and that absence was read as a bad grep | **closed** 2026-09-02 | `scripts/target-device.sh` pins serial *and* model and refuses to guess, printing what is attached instead. All three branches exercised: refuses the wrong device, **passes** when pointed at the device that is present, and refuses a serial whose model does not match | see below |
| **69** | **"Finding your Mac" asks for a permission whose own copy is about a different feature.** Onboarding page 2 is titled for the Mac and its `NEARBY_DEVICES` card reads *"ConnectSuite needs this to find other devices over **Wi-Fi Direct**"*. Wi-Fi Direct is the **v1 Sync** path — `core/discovery/WifiDirectDiscovery.kt` is the only thing in the tree that uses `WifiP2p`. The v2 Mac link is mDNS plus a gateway probe, and the Mac dials the phone. **Defect 63's shape, and this one is mine**: I retitled the page and left the rationale describing the other path | **fixed** 2026-09-03 — **decided by the measurement its own record demanded**, not by rewording. With `NEARBY_WIFI_DEVICES` revoked on hardware the phone bound all three ports, `NsdAdvertiser` registered and the Mac established a session — so the page was asking for a permission the feature it names does not need, which the record called worse than a wrong sentence. The card is gone from the page, the page is retitled, and the shared rationale is untouched because Sync still needs it. Red-first: 3 of 11 | source + the release app's own first run, 2026-09-02 | see below |
| **70** | **The QR screen's title renders under the status bar.** `QrScanScreen` is a bare `Column` with `fillMaxSize().padding(16.dp)` and no `systemBarsPadding()` — the only screen in the app that hosts no `Scaffold` and does not inset itself. *"Pair with your Mac"* is drawn behind the clock on the single screen a new user must use | **closed** 2026-09-02 | **A `uiautomator` dump cannot see this** — the text is present, correctly bounded, and painted beneath something else. It was found in a screenshot. Fixed with `systemBarsPadding()` | see below |
| **71** | **"Sync" names two different things, and onboarding uses the wrong one.** Page 1's Sync card reads *"Your notifications, texts, calls, photos, files and clipboard, on the Mac"*. The app's **Sync tab** is the v1 Android-to-Android feature: a device list with *Pair* buttons, `Devices / Transfers / Folders / Clip / Feed`, and a `Not paired · 100.113.127.25` row for something that is not a Mac. A stranger reads the card, finishes onboarding, and lands on a screen with no relationship to it — **and lands there precisely when they chose "I'll do this later"**, which is the user who most needs guidance | **fixed** 2026-09-03 — the card is *On your Mac*, chosen to be **false of the other path** per defect 63's rule. The tab keeps its name, which is right for what the tab does. Guarded by a test that allows `Mirror` (card and tab are the same feature) and forbids `Sync` (they are not) | the release app's first run on hardware, 2026-09-02 | see below |
| **72** | **A raw BoringSSL error was rendered in the Mac's status bar.** `link.ts` assigned `this.lastError = error.message` and that reached the UI: *"1288490715584:error:10000416:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN:../../third_party/boringssl/src/ssl/tls_record.cc:489:SSL alert number 46"* — a vendored library's file path and line number, on the first screen a new user meets, 47 times in one outage | **closed** 2026-09-02 | `classifyLinkError` in `src/shared/`, keyed on the **alert number** (46 = `certificate_unknown`) rather than BoringSSL's spelling, because the number is the wire's own value and the surrounding text changes with every Electron bump. `lastErrorRaw` keeps the original for the log and the debug HUD. 12 tests, red under 5 mutations; one test asserts no message contains a path, a line number or any BoringSSL token | see below |
| **73** | **Trust is two stores and either side can drop it alone; the Mac had no state for "the phone forgot me".** After a `Forget` tap on the phone, the Mac keeps its own entry, keeps showing the phone's name, and retries **forever** against a device that will refuse every attempt. It was drawn as *"Reconnecting…"*, which promises that waiting will work | **closed** 2026-09-02 | `PairingHealth` is three states — `unpaired`, `paired`, `repudiated`. Measured, not hypothesised: 47 alerts in one outage, with `[trust] Forgot 3030c8eb…` on the phone at the moment it began. **No wire message is possible for the failing case** — the handshake fails, so there is no channel; the TLS alert is the signal and it is sufficient | see below |
| **74** | **The sidebar and the pairing screen disagreed about whether a phone was paired.** *"Samsung SM-S938B · Reconnecting"* in the sidebar while the pairing screen asked for a scan. The sidebar read the remembered device name, the router read `paired`, and nothing reconciled them — defect 27's shape on the first screen a stranger sees | **closed** 2026-09-02 | Both now read `PairingHealth`. A property test asserts the two cannot disagree for any state: `needsPairing(h)` is true exactly when `pairingLabel(h) !== 'Paired'`, over every reachable state | see below |
| **75** | **Revoking trust did not revoke access.** `TrustStore.forget` deletes the row and reloads the cache, and does nothing to the session that trust already authorised. Measured on hardware 2026-09-03: after a `Forget` tap the control session stayed `ESTABLISHED` for over a minute, with the Mac still reading notifications, texts, files and the clipboard. The refusal only bites on the *next* handshake, which may never come while the link stays up | **closed** 2026-09-03, **re-measured on hardware** | Found by doing the thing rather than reasoning about it: tapped `Forget` to demonstrate the repudiated state, and `scripts/link-up.sh` still reported `1 control session(s) ESTABLISHED`. `LinkServer.forgetAndDisconnect` now forgets **and** closes matching live sessions, logging how many it closed beside how many it left alone. **Verified end to end**: `1 session ESTABLISHED` → Forget tap → `Forgot … and closed 1 live session(s) — 0 other session(s) left alone` → `no control session on 42501`, the whole sequence inside 1.1 s, with the next reconnect refused | see below |
| **76** | **The repudiated state could not render, because the renderer restated the rule and only one branch was patched.** `shell.ts`'s `toneOf`/`toneLabel` switch on the transport **phase** first, so a repudiated pairing reconnecting forever drew *"Reconnecting"* — the exact sentence the fourth state exists to replace. The shared model was correct and 5 mutations were green over it | **closed** 2026-09-03 | **The unit tests could not see it and a screenshot could.** The precedence now lives in `shared/linkTone.ts` — script-safe in the `appLabel.ts` style so the renderer loads the *same file* rather than a copy — and a test asserts a repudiated pairing never renders as `Reconnecting` in **any** phase, with `connected` still outranking it | see below |
| **77** | **A `BOOT:` log line proves a boot-shaped *intent*, not a boot.** `LinkAutoStart.reasonFor` maps **two** actions onto one reason name — `BOOT_COMPLETED` *and* `QUICKBOOT_POWERON` — and `core/src/main/AndroidManifest.xml` already records that `QUICKBOOT_POWERON` is **not a protected broadcast on this handset**. So any app, or `am broadcast`, can produce a line indistinguishable from a real restart. Measured 2026-09-03: the log carries `BOOT:` at `02:13:02` and `02:13:05` over a kernel that had been up since the previous midday, 51 minutes after an `adb install -r` | **fixed** 2026-09-03 — `BOOT` and `QUICKBOOT` are two reasons with identical handling and different names. Red-first: folding them back fails 1 of 14. `scripts/defect64-read.sh` anchored in the same change, because `QUICKBOOT:` **contains** `BOOT:` and an unanchored grep would have moved the confusion from the log into the reader | **Fix direction:** give the two actions two names in the line — `BOOT` vs `QUICKBOOT` — so the reason column says which mechanism fired, exactly as defect 60 forced for `LISTENER_REBIND` / `BOOT` / `PACKAGE_REPLACED`. **The wrong fix is to drop `QUICKBOOT_POWERON` from the filter**: it costs nothing to listen for, One UI may genuinely send it in place of `BOOT_COMPLETED`, and removing it to make the log unambiguous would trade a real recovery path for a tidier grep. **The second wrong fix is to trust the log at all for this question** — see the verdict rule in row 78 |
| **78** | **`scripts/defect64-read.sh` bounded its counts with `awk '$1 >= bootiso'`, which admits every untimestamped line in the file.** Stack-trace continuations start with `at `, and `"at" > "2026"` lexically, so they pass the filter whatever their age. Measured on the 2026-09-03 11:16 boot: the script reported **549 lines since boot** where the true count is **64** — 485 contaminating lines, an 8.5× inflation of the control that exists to make the verdict trustworthy | **fixed** 2026-09-03 — filter anchored to a timestamp, and the script now states that uptime is the sole witness that a boot happened. Verified on the 11:53 boot: 549 became 64 | **Fix direction:** anchor the filter to a timestamp — `/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $1 >= b` — and, more importantly, **make uptime the witness for whether a boot happened and the log the witness only for what the boot did**. The gate already reads `/proc/uptime`; the verdict must never infer a boot from a line. **The wrong fix is a tighter grep for `BOOT:`** — row 77 is why that cannot work, since a synthetic `QUICKBOOT_POWERON` inside the gate's 30-minute window would satisfy any string test. **The second wrong fix is to raise the gate's window** to accommodate a slow boot; the window is what keeps a reinstall's lines out |
| **79** | **The phone replaced its own clipboard while unable to tell its owner it had.** `POST_NOTIFICATIONS` is `granted=false` on the development handset and phone-side auto-apply was on; `ClipNotifications.post` checked deliverability **after** `applyToClipboard` had run and no-opped politely. 7 occurrences on the author's own phone before anyone looked. Two rules already in this repo were broken on one path: a check that does not gate the action, and one rule with two expressions — `AppsNotifications.canPost` asked two questions where `ClipNotifications.canPost` asked one, and the weaker copy was the one writing somebody's clipboard | **fixed** 2026-09-03 — deliverability is now a precondition of the write (`ClipArrival`), `NotificationDelivery` is the single home for the two-part check, and the `clip.push` ack says what the receiver *did*. Red-first: 4 of 6 tests fail with the gate removed. Proven on hardware in both directions with the permission flipped and restored — `docs/testing.md` → Phase 6 Slice 7 | — |
| **80** | **The AccessibilityService is a start route into the process that installs every feature and binds no socket, and nothing follows it.** Seen in defect 64's closing run: with the notification listener revoked, the process was alive at 11:54:16 with all eight features installed and **no listening port**, five seconds before `BOOT` arrived behind it. `LinkAutoStart` is wired to the listener rebind and to the two boot broadcasts; it is **not** wired to the accessibility bind | **fixed 2026-09-03 — with the start half explicitly unproven** | **Why the 5 s window is not the measure of it.** At boot a broadcast follows, so the window closes. The window that does **not** close is a process the accessibility service rebinds at any other time — after a low-memory kill, after the service is toggled, after a crash `START_STICKY` did not catch (defect 62's second outcome). No broadcast follows any of those, so the app sits alive, granted, feature-complete and **serverless indefinitely**, which is defect 62's exact state reached by a path nobody specified. **Fixed by calling `LinkAutoStart.ensureRunning(context, ACCESSIBILITY_BIND)` from `ConnectSuiteInputService.onServiceConnected`, with its own reason name so the log still says which mechanism started the link. **The objection this answers:** a fourth start route means a fourth competitor in the race defect 64 had to remove one from — true, and it no longer matters, because that race was only ever a problem for *proving* the boot branch, and 64 is closed. `ensureRunning` is idempotent and its no-op branch says so. **The wrong fix is to leave it on the grounds that BOOT covers it** — BOOT covers exactly one of the four ways this process starts |
| **81** | **The degraded banner told the user to flip a switch that does not exist on their Mac.** Native notifications were refused, and the banner said *"Turn them on in System Settings → Notifications, under 'Electron'"*. There is no **Electron** row in that list — not switched off, **absent** — because macOS never registered the dev build as a notification client at all. This is the `fixHint`-pointing-at-a-nonexistent-Setting failure that `PHONE_NOT_FOCUSED` got its own error code to avoid, and it was **reported by the user against a sentence this session wrote** | **fixed** 2026-09-03 — the copy is chosen by `refusalCopy({ packaged })` in `src/shared/`, because whether a Setting exists at all is decided by whether the bundle is sealed. A packaged build is told exactly where the switch is; a dev run is told the mechanism, that everything else on the screen works, and to use a packaged build — **and is given no instruction, because there is no action**. 5 tests, one asserting the dev copy can never name an Electron switch again | user report, then measured both ways: dev run refused, packaged build posted with 0 refusals against a control of 3 in the same file | `docs/testing.md` → Phase 7 Slice 13 |
| **82** | **The packaged app could not launch at all, and had presumably never been run.** `dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework — mapping process and mapped file (non-platform) have different Team IDs`. `hardenedRuntime: true` turns on **library validation**, which requires every loaded library to carry the same Team ID as the process; an ad-hoc signature has **none** (`TeamIdentifier=not set` on both the app and the framework), and macOS does not treat two absent team IDs as a match. So D12's inside-out ad-hoc signing fixed *assessability* and produced a bundle that verifies deep, assesses as `rejected` rather than erroring, and **cannot be run** | **fixed** 2026-09-03 — `com.apple.security.cs.disable-library-validation` added to `build/entitlements.mac.plist`, $0 and no account. The entitlement is documented as **load-bearing only while ad-hoc**: with a real Developer ID every nested component shares one Team ID, validation passes on its own, and the line should be deleted in the same change that fills in `identity:` | measured 2026-09-03: launch refused before the fix, `LAUNCHED` after, then connected and posted notifications | `docs/testing.md` → Phase 7 Slice 13 |
| **83** | **A native notification could be posted and not clicked — the banner was live and its handler was gone.** Electron delivers `click` through the `Notification` instance and `post()` held it in a local `const`, so once the function returned nothing referenced it; a collected instance takes its listeners with it while its banner stays on screen. Clicked minutes after posting the click went nowhere; clicked within a second it was delivered — window to the front, routed to Notifications, from minimised. **Case 1 of three that look identical from outside**, and the click handler wrote **no log line**, so its only trace was the Dock badge — a number with four writers, two of which fired during the run that read it | **fixed and closed on hardware** 2026-09-04 — `LiveNotifications<T>` in `src/shared/` holds the unseen keys **and** their handles in one container (two containers over one lifetime is defect 67's shape), released on click, on phone-side removal and on `markAllSeen`, with a superseded banner closed rather than left unclickable. The residual is chosen: a banner still showing when its key leaves is no longer protected — releasing the reference makes the instance collectable rather than destroying it, so clicking it becomes a race with the collector, because Electron's `close` is not guaranteed on macOS and the alternative is an unbounded leak. **Seen in the field the same day, 8 s after a `markAllSeen`, and the click was delivered** — `HANDLE ALREADY RELEASED` on the line, handler ran. An earlier draft of this row said such a banner *stops* being clickable, which is a stronger claim than the code makes. The click handler now logs before it acts. 5 tests, red-first against the two-container mutation — 4 stay green, the invariant test fails | badge == posts at 10:20 and 10:23 (control: Finder `missing value` in the same run) proved the handler never ran; `already-visible` at 11:15:47.919 plus the user's sighting proved the young-banner click did. **Closed on hardware 2026-09-04 in the state the defect describes**: a banner left sitting several minutes, then clicked, routed and revealed — the pass criterion, met, and deliberately not the young-banner click that already worked with the bug in place | `docs/testing.md` → Phase 7 Slice 16 |
| **84** | **One notification produced eleven native banners.** Since the 11:51:27 launch of 2026-09-04, `com.jio.myjio` was **posted once and updated 119 times**, decided as **88 `ongoing` / 21 `update` / 11 `notify`** — eleven banners for one notification in about three and a half minutes. **The mechanism was corrected by the user on 2026-09-04 and the first write-up was wrong in a way no log could have caught.** It said a ticker was flapping its `ongoing` flag — a notification misbehaving. **It was not: Jio was playing music, and playback really was stopping and restarting.** Eleven genuine new playback sessions, each with a fresh timestamp, each correctly not `ongoing` in the gap. **The notification told the truth eleven times, and the cause was upstream of it.** `88 ongoing / 21 update / 11 notify` is byte-identical under both hypotheses, so the one on the table got written down. **The fix is unchanged and its reason is sharper**: `ONGOING` catches posts that declare themselves persistent and `UPDATE` catches re-posts whose timestamp stood still — a session that genuinely stops and restarts is **neither**, so both guards are *right* to let it through, and what must say no is a limit on how often one key may interrupt somebody. It is a **rate limit on a truthful notification, not a guard against a lying one** | **fixed 2026-09-04 — and the cooldown branch is unproven in the field, deliberately recorded as such.** A per-key cooldown whose **window is chosen by a signal the phone already sends**: a key that has ever been `ongoing` this session is status-shaped (10 min), one that never has is event-shaped (20 s). One number for every app cannot work — short enough for a chat is too short for a ticker. **The download-completion objection is survived by arming the window on a *banner* and never on a post**: progress ticks decide `ONGOING`, never banner, so the completion is that key's first banner and goes out. **The wrong fix is a package allowlist**: the right answer for this app is *sometimes* — the same key must banner for a real message and must not while ticking — and a list of important apps cannot express that, is wrong for everybody but its author, and fails silently in the direction of not telling you things. `nativeNotify.ts` already refuses an allowlist and that refusal stands | measured 2026-09-04, one launch. **Control in the same window, read as lines rather than a count**: `com.whatsapp posted=4 updated=3` against `com.jio.myjio posted=1 updated=119`. **The pane's rows went 38 → 39 across the whole burst**, which is what proves one row redrawn rather than a flood of arrivals — eleven banners and eleven messages are the same observation without it | `docs/testing.md` → Phase 7 Slices 16 and 22 |
| **85** | **The Clipboard pane cannot say why nothing arrived from the phone.** Its one live strip (`#clip-notice`) is about Mac → phone; the Android explanation is standing copy in the *other* column at `top=828` in an 865 px window — **37 of 173 px, 21% on screen** — while the list the user reads is 100% visible. So *Android refused the read*, *the link is down* and *the app crashed* draw the identical picture, and the user who filed this concluded the feature was broken. **Every existing check passed**: `clipboard-pane-probe.mjs` asserts the copy is in the DOM, and it is — nothing here measures where a sentence sits relative to what it explains | **fixed and proven at real geometry** 2026-09-04 — a phone-direction state in the LEFT column, beside `#clip-notice` and equally live, saying when the phone last sent and that it sends only while open. The number already exists; the filter tab reads `From phone 1`. Distinguish it from a broken link the four ways the Files pane separates empty from failed, both being reachable here. **The wrong fix is moving the wall copy up or enlarging it** — the defect is that the pane has no *state* for this direction, so the sentence must be permanent, and a permanent sentence is read once and then unseen. **The second wrong fix is a banner when nothing has arrived**: that is the resting state of a working feature, and a warning that is usually wrong gets ignored | measured before and after at **1440x865, unzoomed, with a populated list**: the line reads `top=360 bottom=438`, **100% on screen and above the list**, where the explanation had been `top=828`, **21%**. Left-column chrome **299 -> 492 chars**. `scripts/clipboard-silence-probe.mjs` is the proof and is a **third** instrument on purpose — the pane probe passes over the unfixed pane, and the view tests have no layout. 3 mutations red on the right tests | `docs/testing.md` → Phase 7 Slices 17 and 18 |
| **86** | **The `Send to Mac` toolbar entry is invisible until a Samsung switch nobody knows about is flipped.** Slice 18 shipped it *permitted, sighting unproven*; the user's hand test in WhatsApp, Chrome and a text field saw it **nowhere**. It was never absent — One UI ships `ACTION_PROCESS_TEXT` as a **per-app opt-in, off by default**, in a screen reachable only from **inside** the selection toolbar (long-press → ⋮ → Manage apps). Our row was present, correctly labelled, `checked=false`, **alongside ten others all `false`** — ChatGPT, Claude, Perplexity, DeepSeek, Adobe ×2, Samsung Pass, Samsung Wallet, Truecaller, Google. Switched on it appears, **in the overflow**, since the framework orders every `PROCESS_TEXT` item after Cut/Copy/Paste/Share/Select-all | **fixed** 2026-09-04, on hardware — a card on the phone's clipboard screen, with the path in walking order (*select text → ⋮ → Manage apps → Send to Mac*), and stop the Mac's `waiting` copy promising a toolbar entry that may be off. **The wrong fix is a deep link** to `SecProcessTextManageAppsFragment` — a Samsung internal fragment, not a documented action, renameable by an update nobody controls. **The second wrong fix is reading the switch's state**: no documented key carries it, and a wrong reading warns people whose feature works | measured 2026-09-04. **Control: zero of fourteen registered `PROCESS_TEXT` activities appeared** — the absence was everybody's, not ours, which is what makes it a platform finding. Then one variable: ours on, neighbours off (`Ask Claude: false`, `Send to Mac: true`, `Ask ChatGPT: false`), and the entry appeared and delivered — `from=com.android.chrome`, 28 bytes, `pbpaste` changed | `docs/testing.md` → Phase 7 Slice 19 |
| **87** | **The app window asked for a size 55px taller than the display it opens on, and only AppKit was stopping it.** `createWindow` requested a flat `1440x920` — the handoff's canvas — with no reference to any display. This Mac's **primary** panel offers a **1512 x 865** work area (982 less a 33px menu bar and an 84px Dock), so the request did not fit the default display. Nothing in the repo noticed because `constrainFrameRect:toScreen:` shrinks an oversized window to the visible frame, and the 865-tall window that appeared looked deliberate. **The report that found it — title bar sliced, right column apparently outside the frame — was not reproduced from here and is not claimed:** AppKit re-constrained on every route driven, including a move to the smaller display and a `setBounds` with an explicitly oversized height. What is established is that the app depends on a platform rescue it neither owns nor invokes, which fires when AppKit sets the frame and **not** when the work area shrinks under an open window — a Dock un-hiding, a display disconnecting, Stage Manager claiming space. **Present identically in the packaged build** (read out of `app.asar`: `width: 1440`, `height: 920`, no `workArea`, no `getDisplay*`), so D14 does not apply | **fixed 2026-09-05.** `src/shared/windowGeometry.ts`, pure arithmetic in the electron-free layer — the same seam `floatGeometry` uses, which learned this in Phase 2 (*"clamping drag alone is not enough"*) and has derived the float window's size from the available height ever since; the main window, which every pane inherits, never did. The design is a **ceiling capped per axis independently**, so a short display costs height and not width. **The wrong fix is capping the opening size alone**: `minHeight: 700` left intact on a 600pt work area hands Electron a contradiction, the minimum wins, and the defect returns by another route on exactly the small displays the change is for — so the minimums are preferences, honoured only where the display can. **The second wrong fix is trusting AppKit**, which is what the code already did | measured 2026-09-05 through Electron's own `screen` module, not `system_profiler`. **Control separating the two candidate faults**: all **3675** laid-out elements measured against the viewport — 30 sit past it and **all 30 are clipped by an `overflow:hidden` ancestor**, so **zero paint past the window edge** and it is the window, not the panes. 8 unit tests, **3 mutations red on the tests named for them** (the original bug takes 4), 523 green restored. End-to-end on the offending display via the product's own compiled `fitWindow`: `1440x841 at (36,45)`, **unchanged by AppKit**, 12px clear of menu bar and Dock. In the running app, three instruments agree — the log, CDP, and System Events both reading `1752, 95, 1440, 920` | `docs/testing.md` → Phase 7 Slice 26 |
| **88** | **The Photos grid drew every tile on top of the two below it.** `.photos-tiles` was one element carrying `display: grid` **and** `max-height: 560px; overflow-y: auto`, and the second silently destroyed the first: measured in the running app, the 24 auto rows resolved to **32px each** while every tile painted at its `aspect-ratio` height of **116px**. Row pitch 40px against a 116px tile, so each bled **79px** into its neighbours and a photo grid read as five smeared vertical columns. Of the three candidate causes named before measuring, two are ruled out by it — the tiles were **not** unconstrained (116px throughout) and the images were **not** overflowing (114px inside a 116px box with `overflow: hidden`); only the **rows** collapsed. Isolated one property at a time: `max-height: none` → **119px rows, correct**; `overflow-y: visible`, `align-content: start` and `grid-auto-rows: auto` each → still 32px | **fixed and proven at real geometry** 2026-09-05 — **structurally**, not by a property: `.photos-scroll` owns the height and the overflow, `.photos-grid` owns the columns and no height at all, which also buys the design's `Today` / `Yesterday` date grouping because a scroller holding several headed grids was impossible while the scroller *was* the grid. **The wrong fix is `align-content: start` or `grid-auto-rows`** — both were tried in the live page and both left the rows at 32px. **The second wrong fix is a property tweak of any kind**, which puts the two jobs back on one element for the next person to re-merge; `.apps-grid` is the proof, having met this same collapse once and answered it with `grid-auto-rows: max-content` | measured in the running app before and after: rows **32px → 131.25px**, worst vertical overlap between any two of 24 tiles **79px → 0px**, tiles square (131×131), 4 columns, 5 day-groups. Guarded in `stylesheets.test.ts`, which is the **only file in the repo that can see a stylesheet** — a DOM double has no layout, so the view test passed throughout and could not have caught it. Shown red by restoring the shipped rule verbatim | `docs/testing.md` → Phase 7 Slice 27 |
| **89** | **The album rail lists Samsung Gallery's trash as an ordinary album, and cannot tell four folders apart.** `MediaStore.BUCKET_DISPLAY_NAME` is the **leaf directory name only**, so distinct paths collide: this handset draws two rows reading *WhatsApp Images*, three *WhatsApp Video*, four *WhatsApp Documents*. Read off the device, the four *WhatsApp Images* buckets are `Android/media/com.whatsapp/…` (twice, different ids), the pre-scoped-storage `WhatsApp/Media/…`, and — the real finding — **`Android/.Trash/com.sec.android.gallery3d/…`**, which is the user's **deleted** photographs shown as a normal album. It is not flagged `is_trashed` either: that column returns nothing on this device, because Samsung Gallery moves files into its own `.Trash` directory rather than using `MediaStore`'s trash. **Only the path separates them, and `media.buckets` does not carry one.** The numeric album names (`1389444597`, `1650884749188`) are the same class of thing and are *correct* — real directories some app named with a Unix timestamp | **Fixed 2026-09-29; labels verified on hardware** (11 of 11 repeated-name groups distinct after `8f19af6`, which added `profileUserId` for the five same-path pairs on user 95 and *Top of storage*); **the trash clause is not observable on today's data** (the 75 `.Trash` rows are `media_type` 0/NULL, already outside the visual filter) and is proven by test only. The wire change it needed is made, additively: `media.buckets` carries optional `relativePath` (docs/protocol.md). Samsung Gallery's `Android/.Trash/**` is excluded in `MediaPayloads.listSelection` itself (a literal, `IS NULL` kept — defect 50's rule), so it leaves the album list **and** every `media.list`; the reader counts any trash row that still reaches it (0 expected). The Mac draws, **only for names that repeat**, the shortest tail of each folder path that separates them (`albumPlaces`); an older phone sends no path and the rail is unchanged. The numeric albums are left as named | `MediaPayloadsTest` (clause, prefix cases, the path on the bucket; the dropped-clause mutation is red ×3); `photos.test.ts` (shortest distinguishing tail; no guess without a path). **Owed on hardware:** the album rail with the trash album gone and the WhatsApp rows told apart — read by counts, not names | `docs/complete-app-pass-2026-09-29.md` §6 |
| **90** | **Every control the design draws shorter than 32px has been drawing at 32px, since it was written.** `button, .button { min-height: 32px }` is the app's control floor and `min-height` beats `height` in the cascade, always and silently. The base rule's own comment reasons in one direction only — *"anything that needs to be taller simply is"* — and nothing considered a control that needs to be **shorter**. Measured in the running app, each routed to its own pane: `.switch` declares 24 and drew **32**; `.calls-tab`, `.clip-tab`, `.clip-clear` and `.overview-disconnect` each declare 28 and drew **32**. The switch is the sharpest: its own comment says *"a 42×24 track, an 18px knob at 3px margin"*, its declared value is exactly that, and inside a 32px track the knob sat 3px from the top and **11px from the bottom** — off-centre, on five panes, with the correct number written directly above it. **Nothing in the repo could have caught it**: `tsc` clean, no selector collision, and a screenshot of a toggle 8px too tall looks like a toggle | **fixed and proven at real geometry** 2026-09-05 — `min-height: 0` on each of the six, and a guard in `stylesheets.test.ts` that reads the floor **out of the base rule** rather than holding `32` as a literal, since a threshold typed from memory is a pass criterion quoting a value the code does not write. **The wrong fix is removing the floor**: it is load-bearing for the tool rail's 64px tiles and the global-action row, which is exactly why it was written as `min-height` in the first place. **The second wrong fix is a substring match in the guard** — the first version flagged `.switch-knob` (a `<span>` inside the switch) and `.pill-tab.unbuilt::after` (a 5px dot), neither of which is a button; it tests the selector's trailing token now, with both as fixtures | measured through the loaded stylesheets in the running app rather than by eye. The scan that found it was **wrong twice first**: it saw **17 rules of 760** because a Chromium `CSSStyleRule` has a truthy *empty* `cssRules` (CSS Nesting) and every ordinary rule was treated as a container; and its first run measured a pane that was not routed, under a control (`document.styleSheets.length` → 3) that was true and irrelevant. Five of six then read `drawn: 0` from hidden panes and were re-measured after routing. Shown red by removing the `min-height: 0` from `.switch` | `docs/testing.md` → Phase 7 Slice 29 |
| **91** | **The app window could be scrolled out of place, permanently and invisibly.** `.app-window` carried `overflow: hidden`, which removes the scrollbars and **still makes the element a scroll port** — it can be scrolled by `scrollIntoView`, by the browser revealing a focused descendant, or by any script setting `scrollTop`. Measured in the running app at `.app-window { scrollTop: 199.5 }` with `document.scrollingElement.scrollTop` and `#page.scrollTop` both **0** and `.page-head` at **y = −199**: the app's own header and sidebar above the viewport, no scrollbar to show it, no wheel target to undo it, and every scroll offset anyone would think to read still saying zero. **Who moved it was established rather than assumed**: ordinary keyboard focus on a below-fold control scrolled `#page` by 354 and left the frame at 0 — correct, and not the cause — while `probe.mjs`'s `__probe.onScreen` called `scrollIntoView` (which scrolls **every** scrollable ancestor) and restored only the one scroller it had chosen | **fixed and proven at real geometry** 2026-09-05, in two places. The instrument records and restores **every** ancestor's scroll position, because a stimulus with an unreported side effect is the same shape as a probe reporting bytes queued as bytes delivered. And the frame is `overflow: clip`, which cuts identically — rounded corners and the ambient blobs at `inset: −10%` unaffected — and creates **no scroll container**, so nothing can scroll it by any route. **The wrong fix is resetting `scrollTop` on a scroll listener**: that leaves the frame scrollable and repairs it after the fact, which is defect 61's shape — a repair where a prevention belongs. **The second wrong fix is fixing only the probe**, since *"only our tooling can reach this"* is a statement about today | measured after: `win.scrollTop = 200` reads back **0**, `scrollIntoView` on a below-fold control leaves it at **0**, `.page-head` at **0**. It was caught because `shot.mjs`'s head-anchor precondition refused the screenshot rather than writing one that would have been read as a design difference | `docs/testing.md` → Phase 7 Slice 31 |
| **92** | **Eleven references to four custom properties that do not exist.** `var(--text-strong)` and `var(--text-muted)` (5 uses), `var(--text-secondary)` (4, all in the Apps pane) — none of them declared anywhere. An undeclared custom property makes the whole declaration **invalid at computed-value time**: the property is not skipped and it does not fall back to a default, it becomes `inherit`. So `color: var(--text-strong)` silently means *whatever my parent is*, with no error, no warning, a clean `tsc` and no selector collision. Measured in the running app before the fix, and **the mixture is what let it survive**: `.ring-value` inherited `#f4f4f7`, which is what `--text-primary` would have given it anyway — **correct by accident** — while `.ring-caption` drew `#f4f4f7` where `--text-meta` `#5b5e6e` belonged, so the caption *Charging* sat at the exact weight of the 13px/600 value directly above it and the pair had no hierarchy at all. Some of it looked right, some of it looked like a design decision, and one misspelling produced both | **fixed and proven at real geometry** 2026-09-05 — `--text-strong` → `--text-primary`, `--text-muted` and `--text-secondary` → `--text-meta` / `--text-body`, and a guard in `stylesheets.test.ts`: every `var(--x)` with no fallback must be declared somewhere. It found **six references beyond the two spotted by hand**. **The wrong fix is an allowlist**: the guard's first run flagged `--dock-tint`, which is *not* an orphan — `shell.ts` sets it per tile from `navModel.DOCK` — so it reads `setProperty('--x', …)` out of the TypeScript instead, and a property counts as declared if anything in the app declares it, wherever that is. `--disc-hue` is covered by the same clause. **The second wrong fix is trusting `var(--x, fallback)` reads**, which cannot break and are skipped deliberately | measured before and after on the one site that renders on this device: `.ring-caption` `rgb(244,244,247)` → **`rgb(91,94,110)`** against a parent of `rgb(244,244,247)`. **The four Apps sites are unmeasured and said to be**: a refusal banner, a fallback label, a toast hint and an empty state, none of which renders when 122 of 122 packages resolve their names — the defect there is established statically, by specification, not by observation. Shown red by restoring `var(--text-muted)` to `.ring-caption` | `docs/testing.md` → Phase 7 Slice 32 |
| **93** | **Every SMS conversation's preview was drawn at zero height, and had been since the feature shipped.** `sms.threads` has carried `snippet` since Phase 4 and the pane had always rendered it: measured in the running app, **50 of 50 rows carried real text and 50 of 50 measured `height: 0`** (`(no preview)` count: **0** — every one had something to say). Fifty sentences, present, correct and invisible. **The mechanism was misdiagnosed first and the correction is the point**: varying the row's own properties looked decisive (`min-height: 0` → 18px, `display: block` → text returns) and the conclusion written down was *a `<button>` does not grow to its flex content*. Reintroducing the fault to prove the new guard could see it showed **the row growing to 119px with its text intact** — the claim was wrong. Rebuilt off-screen varying the **parent**: `display: flex; flex-direction: column` + `max-height: 300px` reproduces `snippet: 0`; `display: block` with the same max-height gives 18px; flex column with no max-height gives 18px. **A column flex container with a constrained height shrinks its children** (a flex item defaults to `flex-shrink: 1`) and the deficit came out of the text. Both conditions are needed; the row's own `display: flex` was incidental, which is exactly why changing it appeared to help | **fixed and proven at real geometry** 2026-09-05 — the row is `display: grid` at the design's explicit 60px, and the scroller is not a flex container. Guarded by `scripts/zero-height-text-probe.mjs`, which sweeps every pane for elements carrying text and drawing at zero height, aimed at the **symptom** rather than the mechanism precisely because the first reading of the mechanism was wrong. **The wrong fix is `flex-shrink: 0` on the text**: it restores the sentence and leaves the row overflowing its own box, which is the symptom moved rather than removed. **The second wrong fix is a view test** — a DOM double has no layout, so `smsView.test.ts` rendered this element, asserted its text and passed for months over a line nobody had read | measured before and after: previews with text **50 / 50** both times; at zero height **50 → 0**. The probe reports `13 of 13 panes measured, 0 text nodes drawn at zero height`, and its `--self-test` plants a `height: 0` text node in a live pane and asserts the sweep reports it — a control on **the instrument**, since the original cannot be re-created in the rebuilt pane | `docs/testing.md` → Phase 7 Slice 33 |
| **94** | **A shared file loaded into the renderer as a plain `<script>` may not carry an `export`, and one had been breaking that rule for a phase without symptom.** A file with an `export` compiles to CommonJS whose first emitted statement is `Object.defineProperty(exports, …)`; there is no `exports` in a classic script, so it throws on its first line and **every declaration below it is dead** — including the `globalThis` block at the bottom that each of these files carries and that each file's own comment credits for making it work. **The reason it was invisible is the finding**: a `function` declaration is hoisted onto `globalThis` before the body executes, so `discHue.ts` shipped this way and the app was fine, its comment describing a mechanism that had never run. A `class` is not hoisted, so the same shape written for `ContactPhotos` left the symbol `undefined` in the page while `photoKey`, four lines away in the same file, was a function. Nothing in the repo could see it: `tsc` clean, `npm test` green (the tests `require` the file, where `exports` exists), and the page working | **fixed** 2026-09-05 in both files. **Guarded** by `scripts/check-renderer-scripts.mjs`, the eighth commit hook. Scope comes from `index.html`, not from the directory — `src/shared/` also holds modules the main process imports normally and those keep their exports. **The wrong fix is a lint over `src/shared/`**: it would deny the main process's own modules, which are correct. **The second wrong fix is trusting the source matcher alone** — a test also reads the built `dist/shared/*.js` for a top-level `exports` reference, which is what catches a stripper that is ever wrong in the permissive direction | the hook shown to deny with `export function discHue` reintroduced and to fall silent with it restored; 10 fixtures, both directions, including the verbatim declaration that shipped; the scan's own control fails loudly on zero files. Emitted `exports` lines across the ten renderer-loaded shared files: **0** | `docs/testing.md` → Phase 7 Slice 34 |
| **95** | **`__probe.onScreen` measured visibility against the viewport and not against the scroll port that actually clips.** `seen()` intersected the element's rect with `window.innerHeight` alone. On this app `#page` is `overflow-y: auto` and its bottom sits ~46px above the viewport because the dock is under it, so **anything ending in that band reported as fully visible while its lower part was not drawn**. Caught on the Calls pane's app-call note: viewport 841, note bottom 826, verdict `visible` with `fraction: 1` — and `#page` ending at 795, so 31px of the sentence was missing. It is defect 85's own instrument carrying defect 85's bug, and the third time in this repo an instrument has been wrong about the thing it was built for. Found by **disbelieving the instrument over a screenshot** and asking a third query — which clipping ancestors are there — rather than trusting either | **fixed** 2026-09-05: `seen()` intersects with every ancestor whose overflow is not `visible`, and reports `clipTop`/`clipBottom` so a reader can see what clipped. **The wrong fix is comparing against `#page` by name** — the scroller is found by walking, because a pane that grows its own port would be measured against the wrong box and silently pass. **Two published numbers are superseded**, Slice 29's *21 visible / 2 reachable* and Slice 30's *20 / 3*: `visible` was over-reported and `stranded` could have been under-reported, since one fraction decides both splits | 3 fixtures — the real failure (841 / 826 / 795 → `0.68`, `reachable`), a port that contains the element (`1`, `visible`), and an `overflow: visible` ancestor that must not clip however small its box. Shown red against the viewport-only expression and green with it restored. Corrected sweep: **21 cards, 12 visible, 9 reachable, 0 stranded** | `docs/testing.md` → Phase 7 Slice 35 |
| **96** | **The status island had no clock, and drew history in the live tone.** One statement: `this.setIsland(this.events[this.eventIndex]!, toneOf(this.status))` — text from a six-slot ring, tone from the live link, on a 5.2 s `setInterval`. `ActivityEvent` carries `at: Date.now()` and `islandLineFor` took `{category, kind, detail}`, so **the timestamp was dropped at the boundary** and the ring stored bare strings; it was never cleared on disconnect, reconnect or a pairing change, so a line's maximum age was the session and it came round every ~31 s. The result was a pill contradicting the connected-device strip two inches away, daily: a refusal from ten minutes ago in **green** beside `Connected · 12 ms`, `Connected · N ms` in **amber** during a reconnect, `Sent to phone · 57 bytes` in **red** during an outage. `setStatus`'s own comment claims *"one function so the four cannot disagree"* — the island was never one of the four | **fixed and proven on hardware** 2026-09-08. The rota is **deleted**, not filtered: one pure function (`shared/islandState.ts`, with no timestamp in it at all), one writer (`renderIsland`), and the connection claim derived from the same `linkToneLabel` the strip reads. The failure reason is `LinkFailure.kind`, a closed enum — never the classified sentence, whose `dropped` prose *names a connection state*. **The wrong fix is a filter over the ring**: it leaves a second writer on a one-job surface, deciding from another source on another clock. **The second wrong fix is a text filter on the error prose** — it passes until somebody writes a new sentence; a closed enum cannot express the wrong thing | 2,304-state cross-product on the rule, plus the **write** driven through the real `ShellView` on the DOM double across an 11-step session, asserted after every step and after firing every scheduled timer. Red-first against three mutations. **The decisive assertion was forced by the first of them**: a reinstated ring holding `Sent to phone · 57 bytes` *passed* a check for contradicting labels, so the test asserts the pill equals what the live state produces. `ShellView` off the renderer-view debt list, 11/2 → 12/1. On hardware: 15 samples over 30 s, 5 distinct readings, all `Connected · N ms`, strip agreeing in every one | `docs/testing.md` → Phase 7 Slice 36 |
| **97** | **`lastFailure` was assigned in four places and cleared in none**, and `status()` returned `lastFailure?.message ?? lastError`. A successful handshake cleared the *raw* field and not the classified one, so it cleared nothing any user-facing surface reads: after a single failure **every** subsequent status carried that sentence forever, `phase: 'connected'` included. Found underneath defect 96 — the island was narrating a genuinely stale field, so fixing the pill alone would have left it honest and the source lying. Sharper consequence on the same field: `status()` feeds it to `pairingHealth`, so one certificate refusal left `pairing` at `repudiated` **through a successful re-pair**, and the shell's `mustPair` then pins the user to the pairing screen while connected | **fixed** 2026-09-08, and **not by adding the missing line**. Two fields that must be cleared together, in a class with six assignment sites, is the defect; `LinkFailure` already carries `raw` beside `message` and `kind`, so there is one field now and exactly two writers — `failed(raw)` and `succeeded()`. Three of the six sites had been setting only the raw field, producing an unclassified fragment (`no pong in 15s`) with no kind beside it; all six are classified now. **The wrong fix is `this.lastFailure = null` in `onHandshake`**: it fixes the instance and the next person to add a fifth assignment site has no symptom to notice. **The second wrong fix is clearing on a retry** — that is an optimistic clear over a link that is still broken, defect 61's shape pointed the other way | **proven through a real failure → recovery cycle in one process** 2026-09-08: 13 `ECONNREFUSED` failures then a successful handshake, so `succeeded()` ran with a real failure to retire rather than as a no-op branch — and the connected status four minutes later carries `lastError`, `lastErrorRaw` and `lastFailureKind` all **null** with `pairing` recomputed to `paired`. Read from the **status object**, not from the pill: the island can no longer draw an error while `live`, so the pill would have measured the island's rule and said nothing about the field beneath it. **The repudiation half is unproven and the stimulus is named** rather than the fix claimed: it needs a `Forget` on the phone, a re-scan, and a read of `pairing.kind` on a connected status — two taps on the phone's Mac tab, which no Mac-side run can produce | `docs/testing.md` → Phase 7 Slice 36 |
| **98** | **The island drew a reason for the last attempt beside the label for the next one.** `Connecting · no answer on any known address` — dialling something while saying nothing answered. The reason describes the **last completed** attempt and the label describes the one **in flight**, and joining them presents two moments as one. **Invisible to both test layers, and that is the finding**: it contradicts nothing (the strip read `Connecting` too), so the 2,304-state invariant passed, and `assert.equal(text, islandState(status, work).text)` passed because the island was faithfully rendering what the rule said. **A rule can be self-consistent and wrong.** Found by looking at the screen during a real outage — the same way defect 67 was, and the standing argument for running the thing rather than only testing it | **fixed and proven on hardware** 2026-09-08. `DIALLING = {searching, connecting, handshaking}`: a reason accompanies a **settled** state — `Disconnected · …`, and `Reconnecting · …`, which by construction means *the last attempt failed and I am waiting to try again* — and is withheld while a socket attempt is open. **The wrong fix is dropping the reason everywhere**, which throws away the one sentence that explains an outage. **The second wrong fix is depending on `link.ts:212`'s `lastFailure ? 'reconnecting' : 'searching'` to keep `searching` reason-free** — that is the same rule living in two files, so `searching` is named here as well even though no observed case reaches it with a failure | 330 samples at 120 ms through a real `ECONNREFUSED` outage: **283× `Reconnecting · no answer on any known address`, 47× `Connecting`, 0 disagreements with the card**. Red-first by emptying `DIALLING` — *`searching` drew a reason for the previous attempt*. The test carries its control: the same failure in `reconnecting` and `disconnected` still renders its reason, so it does not pass by the reason never drawing | `docs/testing.md` → Phase 7 Slice 36, second sitting |
| **99** | **The Mirror stage asserted a 9:19.5 phone, and `pointAt` divided by the element.** One assumption in three places — the stage's `aspect-ratio` in styles.css, `RATIO` in `shared/floatGeometry.ts`, and a sentence in `pointAt`'s doc comment saying there was no letterbox to account for. The first two draw bars on **every phone measured so far**, and the SM-S938B is **exactly 19.5:9** (1440×3120), so the hard-coded box matched the reference handset perfectly and drew **no bars at all** on it in portrait — which is why one device hid it for a phase. An earlier claim here that the reference device was itself ~20:9 was inferred from a stale canvas backing store and is withdrawn. The third **moves the user's finger**: with `object-fit: contain` inside a fixed box, taps were scaled and offset by the size of the bars — ~20 capture px at the edges in portrait on a 720×1600 moto, and **427 px of 1080 in landscape**, where a tap on the top of the phone landed 40% of the way down it. Underneath both, `#mirror-canvas`'s `max-height: 60vh` (id, specificity 1,0,0) beat `.pane-mirror .mirror-stage canvas` (0,2,1) and clamped the canvas 11px short of its own stage, so the element was not even the ratio the stage asserted | **fixed** 2026-09-10, Mirror pane. The stage takes `--capture-aspect` from the geometry the phone already announces in `mirror.state` and re-announces in `mirror.rotate`; the mapping goes through `captureFit.ts`, which computes the contained picture and maps against **that** rather than the element. Landscape makes the **box** landscape. The hairline moved from `border` to an inset shadow, because `aspect-ratio` sizes the border box and a 1px border makes the content box a different ratio — measured at 1.2px of residual letterbox. **The wrong fix is sizing the stage from `canvas.width`**: the announced geometry is what the phone checks a coordinate stamp against, and an encoder may pad the coded frame to a macroblock boundary. **The second wrong fix is a default aspect inside `captureAspect`** — that is the 19.5:9 assumption returning silently, which is how it survived; no geometry returns null and the CSS carries the empty-stage fallback. **The float window's `RATIO` is the same defect in a third place and is still live** — it needs the geometry plumbing §1 adds | **Mac-side measured, hardware pending.** Four geometries driven through the real stylesheet in the packaged app: stage aspect equals stream aspect and the letterbox is **0.00px** at 1080×2408, 720×1600, 2408×1080 and 1600×720; `max-height` on the canvas reads `none`. `captureFit.test.ts` is red-first against the element mapping (2 of 6 fail). **Not yet proven on a phone**: no run has watched a real `mirror.rotate` resize the box, and the three-handset run the fix exists for has not happened | **Hardware 2026-09-12, `docs/testing.md` → Phase 7 Slice 43: landscape box 560 × 258.46 at 2.16667 with 0 letterbox, both routes agreeing, and a top-edge tap predicted (1172,21) / measured (1172,21). Verified on 1 of 3 ratios — and on this handset *portrait cannot falsify it at all*, since 19.5:9 is the ratio the pre-fix code hard-coded. The two Motorolas and the vivo are away and Slice 40 stays owed.** | `docs/testing.md` → Phase 7 Slices 37 and 43 |
| **100** | **The mirror has never survived its own start, and no log in this repo has ever shown it working.** Consent is granted (8 of 8, zero denials), the `MediaProjection` token is issued, the `VirtualDisplay` is created, the encoder reaches `RUNNING` and emits its output format — and **107 ms later** `MirrorService` loses its foreground status and Android revokes the projection: `am_foreground_service_stop [MirrorService, …, STOP_FOREGROUND, type=32]` followed by `Stopped MediaProjection due to foreground service change`, `stopReason=7`, `wasCaptureInProgress=true`. The `SecurityException: Cannot create VirtualDisplay with non-current MediaProjection` seen once is the same fault landing a few ms earlier. **The user-visible sentence for all of it is `Screen capture was stopped on the phone`**, which is one of eight reasons `MirrorEngine.stop(String)` funnels into one line — two of which differ by three words | **open, mechanism partly established** 2026-09-10. The FGS ends 106-116 ms in, recorded `STOP_FOREGROUND` with `fgsType=32`, leaving the package with **zero** foreground services (`updateNumberOfVisibleRunningPackagesLocked: 0`) — which is what the projection service reacts to. `LinkService` has lost its foreground state too, so the mirror's is the only one left to lose. **What issues the stop is not known**: nothing here calls `stopForeground`, cancels 3001 or calls `cancelAll`. A *provisional background-start allowance* explanation was recorded and is **retracted** — the stop event carries `PROC_STATE_TOP`, so the process never left the foreground. The planned instrument could not be built (`Service.stopForeground` is `final`) and its substitute read nothing (a visible Activity masks the importance signal) | **Not verified — and the control is the finding.** `Encoded +N frames`, the 2-second stats ticker that only runs while a session is live, is **0** across both surviving log files (2026-09-06 → 2026-09-10, 4,720 lines). Seven `Mirror session started` and not one frame tick. Eliminated with evidence: our session-ended hook (grep empty), `MirrorFeature.uninstall` (no caller), the accessibility toggle, `MirrorNotifications.clear` (cancels 3002, not 3001), a second projection or process (one uid, one pid, `dumpsys media_projection` null), a third-party app, a stale installed build (`MirrorService.kt` unchanged since 08-28, APK 09-04), a notification-id collision (fixed ids 1001–3202; mirrored ids `300000 + (hash & 0xFFFF)`) | `docs/testing.md` → Phase 7 Slice 38 |
| **101** | **`ConnectionService` re-posts notification 1001 twice every eight seconds, forever** — `notification_enqueue` ×2 per tick, each waking `NotificationManagerService` and taking two partial wake locks (`power_partial_wake_state` DIS/REL ×2). Nobody was looking for it: it was found because **it rotated the platform's `events` buffer past the failure under investigation**, destroying the `am_foreground_service_*` records defect 100 needed. An instrument destroyed by our own noise, and the second time in this project that the app's own output has eaten the evidence about the app | **fixed** 2026-09-10, and **the emitter is named rather than debounced**: `UdpDiscovery.ANNOUNCE_INTERVAL_MS = 8_000L`. The discovery heartbeat re-emitted the same device list, `combine` fired because either upstream had emitted, the same status string rendered, and the same notification posted. `.distinctUntilChanged()` on the mapped flow — the notification follows the **rendered text**, not the heartbeat. The 8-second announce is correct and untouched. **The wrong fix is lowering the notification's importance** — that hides the symptom in the shade and leaves the wake locks and the buffer churn exactly where they are. **The second wrong fix is a fixed-interval throttle**, which would make a genuine status change late as well as making the churn quieter | **Measured both ways, 2026-09-10.** BEFORE: `notification_enqueue [11011,8229,…,1001,…]` at 10:26:36.295 **and** .301, again at 10:26:44.301/.306, 10:26:52.307/.311, 10:27:00.305/.307, 10:27:08.315/.319 — five consecutive 8-second ticks, two enqueues each, four wake-lock transitions per tick — about **15 posts a minute**. AFTER, in a 60-second settled window with the Mac connected (`link-up.sh` 3/3 OK, rtt 7 ms): **`READING 0 of 186 lines match 'notification_enqueue.*connectsuite'`**. Positive control on the other half — the dedupe must not suppress a *real* change: the live 1001 notification was last posted **23:30:38**, ten minutes before the window, and reads `Connected to Chetans-MacBook-Pro`, having moved there from `Looking for devices…`. Identical posts suppressed, genuine changes through | `docs/testing.md` → Phase 7 Slice 38 |
| **102** | **The app cannot tell it has been background-restricted, so it fails at 116 ms with a sentence about screen capture.** On 2026-09-10 this handset reported `RUN_ANY_IN_BACKGROUND: ignore` for `com.chetan.connectsuite.debug` — the AOSP background restriction — while **6 of 8** comparable third-party apps on the same device read `allow` or unset. `SUPPORT_BG_AD_RESTRICTION_BY_AI=1` is on, which is One UI's automatic *unused apps* restriction, and the **only other** restricted app in the sample is `com.coindcx.btc`: the two apps the owner does not open daily. A user's phone can therefore put this app into a state where it cannot hold a foreground service, **on its own, with no notice**, and everything downstream — the mirror, and `LinkService` — then fails with a message about something else | **fixed 2026-09-11, read on hardware 2026-09-12.** Detection is one call: `ActivityManager.isBackgroundRestricted()`, public since API 28. It belongs beside the other capability probes in `Capabilities.kt`, surfaced the way every other unavailable feature is (*"unavailable, here is why"*), with a deep link to the app's battery settings. **The wrong fix is retrying the foreground start** — each retry buys another allowance and another withdrawal, which is exactly what seven taps bought on 2026-09-10. **The second wrong fix is asking for the battery-optimisation exemption again**: it is a different switch, and this app already holds the onboarding prompt for it (`OnboardingScreen.kt:258`) while being restricted anyway | **Detection built 2026-09-11; the reading is unproven on hardware and that is the whole of what is owed.** `ActivityManager.isBackgroundRestricted()` is read in `BackgroundRestrictionReading`, asked by `CapabilityDetector` on every refresh and again by `MirrorEngine` at the instant a projection is revoked; `Contract.needsForegroundService` says it reaches `mirror` and **nothing else** (measured: every other capability answered normally for twelve hours with the op set); the Mac gets `BackgroundRestriction.CAPABILITY_REASON` through the existing `unavailable` map with no protocol change; the phone draws a card **at rest** on the Mac screen with a deep link to App info. 23 tests, 12 mutations all red — including the original defect sentence restored. **What has not happened: the call has never once returned `true` on any device here**, because the op was restored to `allow` on the only handset that ever had it set. That is a registration-line-is-not-an-execution-line gap and it is named rather than papered over — the stimulus is one command and is written down in Slice 39 | `docs/testing.md` → Phase 7 Slices 38 and 39 |
| **103** | **`LinkService` believes it is foreground forever, so it can never re-claim it.** `private var isForeground` is declared `false` at `LinkService.kt:50`, read at `:108` as the guard `if (!isForeground) { startForegroundWithStatus(...) }`, and set `true` at `:244` — **and never set back to `false` anywhere in the file.** The moment the platform demotes the service for any reason, the service's own bookkeeping still says foreground, every later `onStartCommand` skips the re-claim, and it runs unforegrounded until the process dies. Observed: `isForeground=false types=0x00000000` on a service alive 12 hours with `startForegroundCount=1`, and `scripts/link-up.sh` check 1 failing all morning while checks 2 and 3 passed. **This is defect 97's shape on the phone** — a field assigned in one place and cleared in none — and it is the reason lifting the background restriction fixed the mirror and did **not** fix the link: `MirrorService` calls `startForeground` unconditionally on every `onStartCommand` and so recovered by itself | **fixed 2026-09-14 — the flag is gone.** `startForeground` is now called on every start command, as `MirrorService` does. What remains is `everForeground`, write-once, deciding only whether a refusal is fatal: fatal on the first claim (nothing to protect), survivable on a re-claim (live sockets, and defect 102 is a restriction that comes and goes under a running app). The old direction read: the flag has to be reset wherever the foreground state can end, and the honest version does not track it in a field at all — `onStartCommand` can call `startForeground` unconditionally, which is what `MirrorService` does and why it recovered. If a field is kept, it needs the same treatment defect 97 got: one writer for each direction, not one writer and no reader of the platform's actual state. **The wrong fix is polling the platform** for the real foreground state; there is no public API, and a proxy through process importance is masked by any visible Activity | **Static fact, verified by reading; the runtime confirmation is owed.** The intended test — deliver a start command and watch the re-claim be skipped — **did not run**: `am start-foreground-service` was refused with `Requires permission not exported from uid 11011`, so the `isForeground=false` reading after it is not evidence about the guard | `docs/testing.md` → Phase 7 Slice 38 |
| **104** | **Eight hand-written mirror stop sentences, two of them three words apart, and the platform's revoke collapsed into the pair's friendlier half.** `MirrorEngine.stop` took a free `String` and eight call sites each wrote their own. *"Stopped on the phone."* was the person tapping Stop in the Mirror tab; *"Screen capture was stopped on the phone."* was `MediaProjection.Callback.onStop` — **Android taking the projection away** — and during defect 102 it was the only thing the app said while eight consecutive sessions died at 107-116 ms. A stop the *platform* caused was worded as a stop the *phone's owner* caused, so the owner was told eight times that they had done something they had not, and the one fact that would have ended the hunt on the first attempt — that this app was background-restricted — was never on screen | **Fixed 2026-09-11.** `MirrorStopReason` is a closed set of nine, each carrying an `Actor`, a sentence and an optional fix hint; `stop()` takes one instead of a `String`. `onStop` **derives** its reason — the callback carries none at any SDK level this app compiles against (`android.jar` 36.1 is `onStop()`, and `MediaProjection.stop()` takes no argument), so the derivation reads `isBackgroundRestricted()` at that instant and nothing more is claimed than that reading supports. **There is deliberately no third member for "the user tapped Stop in the shade"**: it is indistinguishable from an unexplained revoke from inside the app, so `AndroidRevoked` names both and asserts neither — the folder-picker rule. **The wrong fix is a string-distance check over the sentences**: one was written, it passed with the original defect sentence restored, and it was replaced by the attribution rule the defect was actually about | Fixed, and the attribution rule is red-first proven — mutation M7 restores the exact defect sentence and goes red | `docs/testing.md` → Phase 7 Slice 39 |
| **105** | **The float's decoder never starts, and the code that would ask for a keyframe is below the return that drops every frame.** `H264Canvas.push` opens with `if (!decoder || decoder.state !== 'configured') return;` — and the `awaitingKeyframe` branch that calls `hooks.requestKeyframe()` sits **underneath it**. So a float with no decoder drops every access unit, IDRs included, and never asks for anything: it is unreachable from its own recovery path. A decoder only exists after a `config` frame, and a float opening mid-stream gets one only if `main.ts`'s onReady replay wins a race against the window's own listeners being registered. When the replay wins, the float works; when it loses, the window is black forever and silent | **Fixed 2026-09-13. The start contract was the fix**: the float asks for the parameter sets when its listeners are up, rather than main pushing them on a window event; main answers with the retained config or says plainly there is none; one request in flight, rate-limited. **The wrong fix is moving the keyframe request above the return** — that trades a silent black window for a request storm against a decoder that still cannot use the answer. **The second wrong fix is retrying the replay**: the race is the defect, and a retry makes losing it cheaper rather than impossible | **Fixed 2026-09-13, and the race was watched losing before and after.** `renderer/streamStart.ts`: the float asks (`stream-start`) immediately after its own listener registrations; main answers `event.sender` with the retained config or `null` plainly; one request in flight with a 1 s floor and a 5 s in-flight release. The `onReady` push is **removed**, not narrowed. `delayFloatListeners` makes the losing side deterministic — with the ask disabled the float dropped **730** access units, asked **0** times and showed the no-parameter-sets card; with the contract it dropped **1**, asked once, and was decoding 3.9 s later | `docs/testing.md` → Phase 7 Slices 44 and 45 |
| **106** | **The keyframe path logged nothing at either end, so no evidence exists that a single `mirror.keyframe` has ever produced an IDR.** Three Mac callers all ended in `.catch(() => undefined)` — the IPC handler, the float's onReady, and the float renderer — and on the phone `MirrorFeature` logged nothing, `MirrorEngine.requestKeyframe()` was `encoder.get()?.requestKeyframe()` (a null encoder swallowed the request whole), and `ScreenEncoder.requestKeyframe()` logged **only its failure**. A request, its ack and the frame that answers it were all invisible, which is why the float could fail through an entire demo without leaving a trace | **Fixed 2026-09-12.** One traced path on the Mac (`KeyframeTrace`: requested / acked / answered-by-IDR, with the answer counted only when a request was outstanding, because an idle stream's periodic IDRs are not evidence a request worked); every caller names its reason; the phone logs the request arriving, whether a codec existed, and — from `noteKeyframeEmitted` — whether a keyframe followed and how long it took. **The wrong fix is logging every dropped frame**: at 60 fps that is its own denial of service, so the no-decoder drops are counted and reported on the 1st and every 120th | **Fixed on the Mac and proven there; the phone half has never run.** 2026-09-13, on a quiet stream: request → **ack at +8 ms** → `keyframe ARRIVED after 2080 ms`, `answered by an IDR` 3 → 4, corroborated by the phone's own `last keyframe` size changing 123968B → 277290B. **The phone's three new lines are unverified**: the installed APK predates them (`lastUpdateTime=2026-09-12 13:11:14`) and a grep returns 0 over 600 lines. Proving it costs a reinstall and one consent tap | `docs/testing.md` → Phase 7 Slices 44 and 45 |
| **107** | **Two float states rendered one sentence.** *"Waiting for the phone's next keyframe…"* was shown both when the float had **no decoder** — where that frame will be dropped like every other, so the sentence is false — and when a decoder was armed and a request was genuinely outstanding, where it is exactly right. Nothing on screen or in a log could tell them apart. Defect 104's shape in a second place: a closed set of causes collapsed into the friendliest member | **Fixed 2026-09-12.** `renderer/floatWait.ts` is a closed set of four — `no-parameter-sets`, `awaiting-keyframe`, `unanswered`, `running` — each with its own sentence and a `blocking` flag saying whether the state can clear itself. **The flag is the load-bearing part, not the wording**: a sentence can be reworded and the test would still pass, so the assertion is that `no-parameter-sets` is blocking and `awaiting-keyframe` is not. The threshold for `unanswered` is on **outstanding** requests, not the request count, so a float answered twenty times out of twenty stays healthy | **Fixed, and the no-decoder state has now been seen on hardware** — 2026-09-13, with the ask disabled and the delay forced: overlay showing, the no-parameter-sets sentence drawn, `droppedWithNoDecoder: 730`, `requested: 0`. The old single sentence would have said a keyframe was on its way | `docs/testing.md` → Phase 7 Slices 44 and 45 |
| **108** | **The latency anchor pairs a capture-time stamp with an encode-time reading, so every published figure silently omits the encode stage.** `ScreenEncoder` sets `lastPtsUs = info.presentationTimeUs` (stamped at capture by the display pipeline) and `lastMonoUs = System.nanoTime()` at `dequeueOutputBuffer` — **after** encoding. The Mac's `capturedAtMacMs` then anchors *capture* to `monoUs`, so for the anchor frame it returns the instant the frame left the encoder, and every total is short by that frame's encode duration until the next anchor. Measured on hardware 2026-09-13: the encode stage is **14 ms of a 32 ms total, 44%**. Figures of 9, 11, 99 and 134 ms were all quoted against that origin. `docs/protocol.md` calls the pair *"the phone's monotonic clock reading for that same frame"* without saying **which moment** in the frame's life, which is why nothing caught it | **Fixed 2026-09-13, with no protocol change.** Both timestamps were already on the wire and were being read as one anchor pair instead of as two stage boundaries: `encodeLagUs = monoUs - ptsUs`, `capturedAtPhoneUs = ptsUs`. `renderer/latencyStages.ts` carries the rule, and every figure now publishes an `origin` of `capture` or `encoder-output` so a number can never again be quoted as the wrong one. **The wrong fix is the minimum-of-(arrival − pts) estimator** — it folds encode and wire into one minimum and could never separate the stage that was missing. **The second wrong fix is assuming the timebase**: if PTS were rebased, capture time is not knowable on the phone at all, so `timebaseVerdict` measures it and has `unclear` as a third answer | **Fixed and measured at three rates. Timebase SHARED on hardware** (`monoUs − ptsUs` = 17,696 µs and 15,377 µs). Stage medians at idle / 60 fps / 120 fps: total 32 / 25 / 25 ms, wire 14 / 7 / 6 ms, peak 174.7 / 39.6 / 38.7 ms. **The loaded reading is taken and all three smoothness suspects failed it** — 0 frames dropped on the phone across 1804 frames at 60 fps and 2885 at 120 fps | `docs/testing.md` → Phase 7 Slices 46 and 47 |
| **109** | **The chrome's three battery slots were `hidden` on a comment that had been false for a phase.** `shell.ts` set `device-battery`, `strip-battery` and `strip-divider-battery` to `hidden = true` unconditionally, under *"`battery.state` is declared in docs/protocol.md and **nothing subscribes to it**, so there is no number to show."* That was true when written and false from the day `VitalsFeature` landed: the type is specified in the contract, pushed by the phone, held and forwarded by `main.ts:979`, and drawn on Overview's O4 ring — **so the same fact was on screen forty pixels away while three slots stayed blank**. Settings → Advanced said `not subscribed on this build (battery.state is unhandled)` beside it. **Nothing in the build can compare a comment to a handler**, which is why it survived; `docs/phase-7-state.md` §2 then recorded it as *"Still correct… do not 'fix' this"*, so the register agreed with the comment | **Fixed 2026-09-15.** The decision lives in `shared/deviceVitals.ts` beside the ring that makes the same one — `batterySlot` for the chrome, `batteryDiagnostic` for Advanced — so three slots cannot invent three answers. Two decisions are load-bearing and neither is the obvious one: **a slot is removed, never dashed**, because a lone `—` between "Connected" and a divider is a glyph with no label (the original comment's argument was right and only its input was wrong); and **a percentage is withdrawn when the link is not live**, because a battery drawn while disconnected is a claim about *now* made from a reading that may be hours old — defect 96's shape on a new surface. **The wrong fix is a number in `shell.ts`**: three surfaces deciding for themselves is how they come to disagree with the ring | **On hardware 2026-09-15**: `46%` in the device card, the strip and the hero (`46% · Charging`) with the O4 ring agreeing, read through `scripts/probe.mjs`, control 12 nav rows. Advanced reads `battery: 47% · charging · received 6s ago`. 17 rule tests + 6 write tests through the **real** `ShellView` on the DOM double; the decisive one asserts the slots equal `batterySlot`'s output across 21 state × link combinations rather than asserting they are non-empty. **Red-first against three mutations**: the verbatim `hidden = true` (4 red), drawing regardless of link state (3 red), and a hard-coded `'79%'` (2 red) — the repair a *not-empty* assertion would have passed | `docs/testing.md` → Phase 7 Slice 48 |
| **110** | **`check-protocol-spec.mjs` walks `MessageType` → document and cannot see a namespace specified with nothing behind it.** Every loop in the checker is `for (const type of types)`, so a type the contract fully specifies with **no constant on either side** is not merely unreported — it is never visited. `mic.*` is the first case to exercise it: `mic.start`, `mic.stop` and `mic.state` have three `###` sections in `docs/protocol.md`, a negotiated ack, a `silenced` state with its own section, an error table and a line in the inventory, and **no `MessageType` constant anywhere** — and the checker printed `0 unaccounted for` against it. **The gap is longstanding and this instance is not**: the `mic.*` spec is uncommitted working-tree work, so it was caught the day it was written rather than a phase later, which is the direction these are meant to travel. The `media.*` gap, which is this one with the arrow reversed, took a whole phase. It is the `media.*` gap with the arrow reversed and it is worse in one respect: a type on the wire and not in the document is invisible to a reader, while a type in the document and not on the wire **reads as shipped**, so somebody building the Mac half from the contract finds nothing to call | **Fixed 2026-09-15.** `wireNamesIn` walks the other way, from two sources that must agree — the subjects map (*the document specified it*) and the inventory (*the document claims it is on the wire*) — reported as separate findings because they are separate mistakes. **The discriminator is a dot**: `subjectsIn` matches every backticked token that opens a paragraph and this contract opens paragraphs with field names constantly (94 subjects against 64 constants; `limit`, `path`, `kind`, `count`…), while every real type here carries a dot except the five that are already constants. **The wrong fix is to count every backticked subject** — it reports two dozen field names and gets switched off. `SPECIFIED_NOT_ON_THE_WIRE` carries a reason and a gate per entry and is pruned in **both** directions: an entry that acquires a constant fails, and so does one the contract no longer mentions | **Red-first against the verbatim case**: the real tree with the allowlist emptied reports exactly `mic.start`, `mic.state`, `mic.stop` and `apps.launch` — each naming the `docs/protocol.md` line — and nothing else. 28 fixtures, each with its opposite, including a control contract carrying the constants (no findings) and a fixture proving the dot discriminator returns `mic.start` alone out of `limit`/`path`/`mic.start`. **`mic.*` is recorded as debt, not implemented** — it is gated on Phase 8 signing, since the Mac half needs a hardened-runtime microphone entitlement and whether it is buildable at all is unknown until the signing test is taken | `docs/testing.md` → Phase 7 Slice 49 |
| **111** | **A quarter of every scroll was a tap, and the rest under-travelled by one touch slop.** `input.scroll` is dispatched as a two-point stroke over 100 ms, at exactly the distance the Mac asked for. Android's `View` layer eats `ViewConfiguration.getScaledTouchSlop()` of every stroke deciding whether it is a press or a drag — 30 display px on this handset — so a stroke shorter than that is a press and a release in one place, which is a **tap on whatever is underneath**. On a YouTube feed that is the thumbnail under the pointer, which is the reported symptom. **35 of 138** `input.scroll` messages in the Mac's own historical log travelled under 30 px; an isolated mouse-wheel notch (`dy = -17` capture px = 22.7 display px) is one of them, and it appears six times unprompted | **Fixed 2026-09-15, phone side, installed and measured.** `InputGeometry.withSlopHeadroom` lengthens the stroke by one slop **in front of** the requested travel, so the finger passes through the point the Mac aimed at rather than overshooting past it. Extending the end instead would scroll further than the wheel asked. Where the display has no room behind the start the end takes the balance, and what neither can take is reported as `shortfallPx` on a warning line rather than silently costing travel. The slop is asked of `ViewConfiguration`, not derived from the density: they agree here (8 dp at 600 dpi is 30) and `ViewConfiguration` is what `View` itself reads | **Proven on hardware, both arms, 2026-09-15.** One handset, one stimulus, one probe: the four sub-slop magnitudes (including `deltaY = 17`, one real mouse notch) **navigated 4 of 4** on the shipped build and **navigated 0 of 4** on the fixed one, scrolling 4 of 4 instead. The discriminator is `topResumedActivity`, and the run **refuses to sweep** until a deliberate tap has been shown to move it — an absence from a query that cannot fire is not a finding. The phone's own execution line was read **6 of 6** after and **0 of 6** before, so both counters have been seen to move. The under-travel half is a reading now too: the before arm logs *"the content will move -26px of the 3px asked for"*. 7 JVM tests, red-first against 3 mutations | `docs/testing.md` → Phase 7 Slice 53, 53a |
| **118** | **The float's phone controls were a right-edge vertical rail; the owner asked for Android's own shape — a row of buttons under the picture — and for hover tooltips on all five.** Not a fault in what 115 built, but a change to an invariant three closed defects depend on: `RAIL = 36` was a **width** taken from the side, and the picture's aspect, the height budget and defect 114's rotation arithmetic are all expressed against it | **Built 2026-09-15.** `BOTTOM_BAR = 40`, a **height** beside `TITLE`, and `RAIL` **deleted rather than zeroed** so the compiler named every call site. The axes are not symmetric: width loses its only consumer and the picture spans the whole window; height gains a second one, so every function turning available height into a width caps lower — the README's ≈401 at 920pt becomes **383**, and the transcription test asserts **both** numbers rather than redefining the document's. Tooltips draw their own rather than using `title`, because `title` never fires on keyboard focus: 450 ms on hover, **0 ms on focus**, text from the same table as the label, and the reveal control keeps defect 117's full sentence as its accessible name while showing a short form | **Red-first on 6 tests written before the formula changed, then 4 mutations** — the bar over the picture (5 red), taken off the wrong axis (6), the height budget not following (7), and **defect 114's landscape cap removed, which must still go red after the swap** (2). On hardware in **both orientations**: bar height 40, spans the window, `overlapsPicture: false` gap 0, five controls counted as elements, order read from their own rects, picture aspect agreeing with the phone's announced one (2.174/2.167 portrait, **0.461/0.462 landscape** — 114 re-proved on the new axis, unprompted). Tooltip: `pointer-events: none`, does not cover its button, 24 px over the picture **reported rather than claimed away**, immediate on focus and on dismissal. A **dead CSS rule** fell out and never shipped — `:first-of-type` matched the first *button*, so the group separator drew nothing; found by measuring `::before` on all five, not by looking | `docs/testing.md` → Phase 7 Slice 54 |
| **119** | **Three colour tokens did not match the design, and the note in `tokens.css` asserting they did had its own evidence inverted.** `--accent` `#7c6bff`, `--live` `#34d399` and `--destructive` `#ff6b81` appear **nowhere** in either design source; the design's `#8B6BFF`, `#32E58A` and `#FF5D5D` appear 42, 47 and 22 times. The block claimed it had counted the prototype's literals — *"`#7c6bff` 34 times, `rgba(124,107,255,…)` 59 times, `rgb(139,…)` zero"* — and all three figures are the reverse of the truth. It was written as the **correction** of an earlier mistake and is the most carefully argued paragraph in the file | **Fixed 2026-09-16**, on the owner's decision after the divergence was put to them with both options costed. All three restored with their alpha derivatives; the false note replaced rather than trimmed, because the note is the reason the divergence survived a phase. The ~13 "stray literals" across `shell.css`, `styles.css`, `navModel.ts` and `activity.ts` turned out to be **the design's values, orphaned** — they read as the mess and were the record | Counted with `grep -o \| wc -l` over both design files after `grep -c` undercounted by an order of magnitude — **it counts lines**, and a design file puts many literals on one line. Controls: `#22d3ee`, known present, returns **25**; `#ec3013`, the foreign design system's red, returns **0** | `docs/testing.md` → Phase 7 Slice 55 §2 |
| **120** | **The `⌘⇧M` hint on the primary action was 3.89:1 in the shipped dark build**, and had been since the shell landed on 2026-08-30. Both its tokens are correct and their pair is 5.27:1 — the failure is `opacity: 0.75` dimming the text toward the fill | **Fixed 2026-09-16.** `opacity: 0.9`. 0.85 is the first step that clears AA in both themes (4.51 dark / 4.81 light); 0.9 for margin, and it still reads as secondary beside the label | **No token audit can see an opacity**, which is why `check-contrast.mjs` reports it clean and the rendered-DOM sweep does not. Found by measuring painted pairs across 3,302 elements, not by looking at a screen. The selected filter pill was the same shape — 4.43:1 in light because its ground is `--well` rather than a card, where the same two tokens read 5.04:1 | `docs/testing.md` → Phase 7 Slice 55 §6 |
| **121** | **Theme-following text was drawn on a scrim that deliberately does not follow the theme.** `--media-scrim` stays dark in both themes because it sits over the phone's picture, and a light scrim over a light video is unreadable in the exact case a scrim exists for. `.pane-mirror .mirror-overlay` and `.float-reason` drew `--text-body` on it, which *does* invert — **1.67:1** in light, dark grey on near-black | **Fixed 2026-09-16** with `--text-on-media` and a new `--text-on-media-dim`, both now measured as explicit pairs (19.76:1 and 10.24:1 on the scrim) | **Both tokens are individually correct and their own pair is never drawn**, so a token-pair audit is structurally incapable of seeing it — the Muted pill's 2.23:1 one layer over. Caught by the rendered-DOM sweep in both windows; the float half would otherwise have shipped | `docs/testing.md` → Phase 7 Slice 55 §5 |
| **112** | **The Mac produced scroll gestures at twice the rate the phone could run them, and threw the overflow away mid-flick.** `WHEEL_WINDOW_MS = 60` summed wheel deltas for a fixed 60 ms and sent, whatever the phone was doing — up to **16.7 gestures/s**. The phone serialises `dispatchGesture` behind a `Mutex` at a measured median of **117 ms**, or **8.55/s** (181 back-to-back gestures in its own log). Production was ~2× consumption for as long as a finger kept moving, so `InputClient`'s 8-deep queue filled and its 400 ms staleness rule discarded the rest: **14 scrolls dropped after waiting 403–486 ms** in this Mac's log, each putting a sentence on the canvas. A mouse emits a few discrete notches and never fills the queue; a trackpad emits a continuous stream *plus* macOS's momentum tail and fills it every time — which is the whole of "trackpad janky, mouse smooth" | **Fixed 2026-09-15, Mac side.** `renderer/wheelPump.ts`: one `input.scroll` in flight, everything arriving meanwhile summed into the next. The clock is the phone's reply, so the two rates cannot disagree on any hardware for any device. **A longer window was rejected** — it is the 263 ms sampling window with a bigger number in it, rarer without being impossible, and unable to say whether a run behaved because the rate was right or because the flick was short. It also removes the need to recognise macOS's momentum phase, which is just as well: a DOM `WheelEvent` in Chromium exposes no `phase` or `momentumPhase`, so the report's "drop momentum events" cannot be implemented as written — under backpressure a momentum tail folds into the sum instead | **Measured on hardware with an identical stimulus.** 40 wheel events over 600 ms → **7 gestures, 0 stale drops**, median send gap **118 ms** (against the phone's measured 117). 8 pure tests, red-first against 3 mutations. **The like-for-like before arm was not taken**: restarting the Mac to build the pre-fix variant ended the mirror session, and Android will not show the capture prompt to a backgrounded app, so the run reported `stopped=deadline, reportable=false` rather than a zero. The before is the historical log — 152 delivered, 14 dropped | `docs/testing.md` → Phase 7 Slice 53 |
| **113** | **The floating window could not be dragged onto a second monitor, and snapped back under the cursor.** `WorkArea` was `{ width, height }` with no origin, while every coordinate in `floatGeometry.ts` is a **global** screen point. A second display's work area starts at x = 1512, or at x = -1920 to the left, so `clampX` measured a global x against a width as though every display began at (0,0) and pulled anything past the primary display's right edge back inside it. `moveTo` re-clamps on every pointer move, so the window did not merely refuse the second display — it snapped back once per event, which reads as being glued down. **The display was always chosen correctly** by `getDisplayMatching`; its origin was discarded one line later by a `{ width, height }` literal built from a rectangle with four fields | **Fixed 2026-09-15.** `WorkArea` carries `x` and `y`, both **required** — making them optional would have let the bug survive at every existing call site in silence, where the compiler instead named the one line that dropped them. A drag is now clamped against the display the **pointer** is over rather than the one the window is on: during a crossing the cursor has moved and the window has not, so clamping against the window's display pins it at that edge and the handover can never complete. One `areaOf()` converter, so there is one place an origin can be dropped | **4 tests, red-first.** M1 restores the origin-less clamps (3 red). Tests run on a right-hand monitor, a **left-hand** one with a negative origin (a sign error passes the first and fails the second), and the whole input space across all three areas. Verified live: `float-open` reported `bounds.x = 2144`, outside the primary display | `docs/testing.md` → Phase 7 Slice 53 |
| **114** | **The floating window never turned when the phone did.** `RATIO = 19.5 / 9` was a module constant read by four functions, so the window was permanently portrait. The main window's stage follows the phone through `--capture-aspect` on both writes of `this.capture`; the float's outer bounds followed nothing, leaving landscape content letterboxed into a portrait frame at a fifth of the area. **Keeping the width and re-deriving the height is the wrong fix and is what produces "renders tiny"**: a 300 pt portrait window is 684 tall, and holding 300 through a turn gives 300 × 157 | **Fixed 2026-09-15.** The ratio is a parameter with `PORTRAIT_RATIO` as the value to use *before the phone has said* — `ratioOfCapture` returns `null` rather than guessing, because "has not said" and "is portrait" are different facts. `FloatMirrorWindow.setCaptureGeometry` is fed from the one function that also retains the geometry (defect 116), so the stored value and the window's shape cannot be updated by one caller and not the other. `boundsForRatioChange` preserves the **picture's area** and solves for the width, which is the reading of "roughly its footprint", holds the top-left, and re-clamps through `resolveBounds` | **Proven on hardware, both directions, 2026-09-15.** A real rotation: `capture turned to 2340x1080 (screen #10) — float aspect 2.167 → 0.462, window 970x465`, then back: `1080x2340 (screen #11) — 0.462 → 2.167, window 467x968`. Picture area 431×934 = 402,554 in portrait and 934×431 = 402,554 in landscape — identical — and the return lands on the same window it left. 6 tests, red-first against 2 mutations. **It also found a live gap**: width was capped by the available *height* only, which no portrait window can ever hit and a landscape one hits at once — a 500 pt-wide area produced a 985 pt window | `docs/testing.md` → Phase 7 Slice 53 |
| **115** | **The float's Back / Home / Recents were invisible until hovered, sat on top of the picture, and landed on Android's own nav bar.** Reported as *"at the top, where other app windows can cover them"*. **Measured on the running window before anything was changed, they were at 92% of the way down** — so that half of the report does not describe this build and is recorded here rather than quietly fixed. What does describe it is the rest: `opacity: 0` at rest on the one window in this app whose purpose is to be watched while something else has focus, which is exactly when the pointer is not in it; a pill over the canvas, which `float.css` already warned would be *"a silent dead zone"* once the canvas took input — and it took input on 2026-09-14; and `bottom: 36px` on a ratio-locked window, which is where the phone's gesture bar is | **Fixed 2026-09-15. The layout is superseded by 118 — the strip is a bottom bar now; everything below is what 115 itself did and is still true of it.** A permanent strip on the right edge, and **it is real estate rather than an overlay**: `RAIL = 36` comes out of the window's width in `floatGeometry.ts` exactly as `TITLE` comes out of the height, so nothing covers a part of the phone's screen the canvas would otherwise accept a tap on. Built from `FLOAT_RAIL` in `floatRail.ts` rather than written into the HTML, so the icon names are inside an enumeration a test asserts over — an icon name that is not enumerated is an icon nobody can check, and this project has shipped two buttons as empty rings | **Measured on the running window**, no pointer in it: `opacity 1` (was `0`), 5 controls counted as elements rather than matched as text, `railWidth 36`, `overlapsPicture false`, every button fully on screen. Picture ratio **2.172** against the phone's announced **2.167** — the rail does not distort the picture. 6 tests, plus M4 (the rail back as an overlay) red on 7 | `docs/testing.md` → Phase 7 Slice 53 |
| **116** | **A float opened into a running session did not know the shape of the phone's screen, and said so on every press.** `capture` in `float.ts` was written from `mirror.rotate` alone — which the phone sends when it turns and at no other time. So a window opened mid-session held `null` until the user **physically rotated their phone**, and every press answered *"The phone has not said what shape its screen is yet, so that was not sent"* about a shape the main window had known since `mirror.state`. The sentence was true of that window and false of the system | **Fixed 2026-09-15.** Three sources, one writer: `mirror.rotate`, `mirror.state` — **which this window already received and was throwing the geometry away from**, reading only the message — and the answer to `stream-start`, where the main process now retains the last announced geometry and hands it back beside the retained parameter sets. Same door and same argument: the session began before this window existed and neither fact will be announced again. Cleared on `stopped`, so a gesture cannot be stamped with a screen the phone has left — that refusal would read as staleness for a mirror that is simply off | **Measured on hardware.** The float's own log line on open: `stream-start answered: 33B of parameter sets, sessionRunning=true, capture=1080x2340 #9 (adopted)`. The field read `{"width":1080,"height":2340,"geometryId":11}` on a window that had not seen a rotation, with the overlay hidden and a picture live | `docs/testing.md` → Phase 7 Slice 53 |
| **117** | **With the floating window open there was no way back to the main window, including clicking the Dock icon.** `app.on('activate')` was the Electron sample — `if (getAllWindows().length === 0) createWindow()` — which is correct for a one-window app and wrong the moment there are two: with the float open the count is 1, the branch never ran, and **a Dock click did nothing at all**. The main window was neither hidden nor destroyed; it was behind whatever the user had been doing, with no route forward anywhere in the product except closing floating mode, which is exactly what was reported. The tray's *Open ConnectSuite* was a third half-answer: it did not `restore()` a minimised window and did not `focus()` the one it showed. There is no application menu at all | **Fixed 2026-09-15.** `revealMainWindow(why)`: create if destroyed, `restore` if minimised, `show`, `focus` — one function, four callers (Dock, tray, the float's rail, and any future menu), each naming itself in the log, because "the main window came forward" with no reason attached is defect 80's single `UNKNOWN` one product surface over. **It does not touch the float and must not**: the session lives on the link rather than in either window, and closing the float to satisfy the request would be the workaround the user already had. The rail's control reports what actually happened — the main process's own reading of whether the float survived — rather than asserting it did | **Fired from a real press on hardware:** `main window revealed (float rail): existed, visible — float stays open`, twice. The control's accessible name is asserted by test to say *"without closing this one"*, because the one fear that stops someone pressing it is that it costs them the floating window | `docs/testing.md` → Phase 7 Slice 53 |
| **122** | **Every keyboard shortcut the shell advertises except ⌘K is decorative.** Thirteen hints are drawn — `⌘1`–`⌘9`, `⌘0`, `⌘,` on the palette's eleven screen rows, and `⌘⇧.` / `⌘⇧T` / `⌘⇧4` on its three commands — and **nothing is bound to any of them**. `shell.ts`'s only `keydown` handler matches ⌘K plus the palette's own Escape/arrows/Enter; there is no application menu at all; `globalShortcut` is used once in the whole app, for the mark diagnostic. A printed accelerator is a claim, and this is the greyed-control rule applied to a key: a promise it might one day light up, made where a person goes to learn the app. The handoff draws all of them (README §"Main region"), so the design's intent is that they work | **open** — not fixed in the 2026-09-16 Overview pass, deliberately: it is shell-wide, across twelve panes, the palette and a menu that does not exist, and that pass was scoped to one pane | — | see below |
| **123** | **The app's most advertised keyboard shortcut was bound to a log line.** `⌘⇧M` is printed in two places — the Overview hero's primary action (`Start mirroring ⌘⇧M`) and the ⌘K palette's first command row (*Mirror phone*) — and the handoff specifies it for exactly that. `main.ts:832` registered `CommandOrControl+Shift+M` as a **`globalShortcut`** for the **mark diagnostic**, a debugging aid that writes one line to the log. A global shortcut is taken before the page sees the keystroke, so pressing the key the UI advertises had never once started a mirror. **Nothing reported it**: `globalShortcut.register` returns `true` on success and the `false` branch already warns, so the only signal available said *the shortcut is working* — which it was. `CLAUDE.md`'s registration-line-read-as-an-execution-line, in the input layer | **Fixed 2026-09-16.** The mark moved to `Control+Alt+Command+M`, unadvertised; its **global** registration is kept and that half of the original argument is untouched — the mirror canvas forwards keystrokes to the phone, so a mark taken by the page would type into somebody's messages. Mirroring is bound in `shell.ts`'s existing `keydown` handler, **in the page**, for the opposite reason: taking ⌘⇧M from every other application on the machine to start a mirror is a cost this app has no right to impose. It calls `runCommand('mirror.start')` — the palette's own registration — so the hero button, the palette row and the key are three triggers for one wiring rather than defect 122's second accelerator table | The diagnostic that finds this class: *what would this line say if the feature had never once worked?* For a successful `register()` the answer is **exactly what it says now**. Found by reading `shell.ts` while checking the hero's own hint, which is also how 122 surfaced | `docs/testing.md` → Phase 7 Slice 62 |
| **124** | **The Calls pane told every user to pair their Mac with the phone over Bluetooth to hear calls — the remedy `CLAUDE.md` retracted after measuring it.** On 2026-09-14 both ends were shown to be HFP audio gateways and SCO failed from both initiators; `CLAUDE.md`'s platform-walls entry was rewritten the same day. Two sentences in `calls.ts` — the idle card and the live card — kept offering it for five days, in the one place a user would act on it. Nothing links a finding in prose to a string in the UI, so nothing noticed | **Fixed 2026-09-19.** Both sentences are named constants (`CALL_AUDIO_WALL`, `CALL_AUDIO_LIVE`) that say where the audio is and offer no remedy. **The wrong fix is rewording the sentence alone**: a third sentence is the likeliest route back, so the test also scans the source file's strings | `calls.test.ts`: each constant asserted by itself, plus the source scan. Red with the exact defect sentence restored, green without | `docs/testing.md` → Sidekick Batch 4b |

| **125** | **With no network, the pairing screen drew a real QR code of `0.0.0.0` and told the user to scan it.** `localAddress()` returned the unspecified address as its fallback; it went into the payload, was encoded, and was drawn under *"Scan this with your phone"* beside `<name> at 0.0.0.0 — valid while this code is on screen`. Every layer was truthful about a different thing, and the literal had **one** writer and **no** reader in the whole desktop tree | **Fixed 2026-09-20.** `shared/pairReach.ts` returns `{ address, reachable }`; the fact travels with the payload and the card draws the handoff's `34:12152` explanation instead of a code. **The wrong fix is testing `host === '0.0.0.0'` in the renderer** — two homes for one rule in two files, and the renderer cannot tell a Mac with no network from one whose address happens to be written that way | `pairReach.test.ts` (7, red-first against the old behaviour → 3 red), `pairCard.test.ts` (5, four mutations), `scripts/pair-nonetwork-probe.mjs` reading computed style in the browser | `docs/testing.md` → Sidekick Batch 6a |

| **126** | **The macOS menu bar named the app by its npm package and offered Force Reload and Toggle Developer Tools to users.** With no `Menu.setApplicationMenu` Electron installs its own default: the menu bar read `Electron`, About / Hide / Quit read `sidekick-desktop`, and View carried Reload, Force Reload and Toggle Developer Tools — a person exploring the menu bar of a shipped app could throw away the renderer's state or open devtools over the window. None of the app's twelve routes or shortcuts appeared anywhere | **Fixed 2026-09-20.** `main/appMenu.ts`, with the routes handed over by the renderer so `navModel.SCREENS` stays the one list behind the sidebar, the palette and the menu bar. Developer items gated on `app.isPackaged`. **The wrong fix is a route list written in the main process** — the second copy that stops matching — and **dropping the Edit menu**, without which macOS has nowhere to send ⌘C / ⌘V and copy-paste dies in every text field | `appMenu.test.ts` (9; red-first on devtools shipped, no Edit menu, an empty accelerator, the package name). Menu bar read live through `System Events` before and after; `Go → Photos` and `Go → Search…` proven to reach `shell.route` / `openPalette` | `docs/testing.md` → Sidekick Batch 6b |
| **127** | **Two panes set a `title` identical to their own visible text, and the time tooltip was a raw `Date.toString()`.** Nine Activity rows, and — found later the same day by the sweep's by-kind breakdown — **2 of 4 Overview `recent-when` rows**, where the tooltip is `activityWhen` and past an hour `activityWhen` *returns* the `activityClock` the row already shows. `.activity-detail` is `text-overflow: ellipsis`, so the intent was right and the attribute was set on every row — including the ones that fit, 9 of 9 duplicates. Beside it `activity-time` carried `Sun Sep 20 2026 17:10:22 GMT+0530 (India Standard Time)`, a runtime's debug string shown to a person | **Fixed 2026-09-20.** `renderer/overflowTitle.ts` sets a tooltip only where the layout clipped, measured after the rows are in the document; `activityExactWhen` writes the absolute time for a person. **The wrong fix is deleting the tooltip** — a clipped detail genuinely needs somewhere to reveal the rest. The DOM double had to be fixed first: `title` was a plain field beside the attribute map, so the red-first run stayed green until the two were reflected | `overflowTitle.test.ts` (9; red-first on set-unconditionally, on a tie, on never clearing, and on an untrimmed comparison) | `docs/testing.md` → Sidekick Batch 6b |
| **128** | **The New-conversation panel was a modal surface with no dialog role, no label, no Escape and no focus restore.** Read by the shell sweep as `{ role: null, modal: null, label: null }` beside the palette's full set: one app, two modal surfaces, one announced and one a div that stops being hidden. Cancelling left focus inside a `hidden` subtree, which drops it to the document | **Fixed 2026-09-20.** `role="dialog"`, `aria-modal`, `aria-labelledby`; Escape closes it and focus returns to the control that opened it. **The wrong fix is asserting the attributes in a unit test** — they are on static markup, so such a test asserts its own fixture; the sweep reads them off the real page | `smsView.test.ts` +3 (red-first: any key dismisses, focus not restored, a closed panel still acting) | `docs/testing.md` → Sidekick Batch 6b |
| **129** | **The brand lockup's fix shipped, was documented, and the browser kept the rule it replaced.** `shell.css` declared `.brand-mark` **twice**, six lines apart: a `57px` / `object-position: center` block carrying the comment that explains the stage, and the pre-existing `65px` / `left center` block immediately below it. Equal specificity, later wins, nothing errors. `getComputedStyle` returned `width: 65px` — so the artwork, 57px at `object-fit: contain`, sat pinned to the left of its box with **10px of bare stage on the right against 2px on the left**, showing the lime half of the halo through the gap. The stage's own comment specifies six and six, and records this exact gap as *already fixed*. Located in the pixels rather than derived from the CSS: the artwork spans x2→59 of the 69px stage before, x6→63 after, control 453 of 598 eye pixels matched at the best offset in both | **Fixed 2026-09-21.** One `.brand-mark` block, merging both, with the stage-era values. **The wrong fix is keeping the 65px rule for "the element outside the stage"** — the comment claimed such a case and `.brand-mark` appears exactly once in `index.html`, always inside the stage. `stylesheets.test.ts` had a guard for one selector declared twice in a sheet and it **passed**: its discriminator is **distance**, and inserting the new rule *above* the old one makes proximity the thing that hides it — the pair reads as a single commented block. It now also refuses a same-property contradiction at any distance | `stylesheets.test.ts` — *no selector sets one property to two values in one sheet*, plus its control; red against the verbatim shipped pair, naming `width` and `object-position` with both line numbers | `docs/testing.md` → Motion pass close-out |
| **130** | **The motion sweep called two product states defects, and its own output carried the disproof of one.** Two faults in one run. **(a)** The mid-FLIP exclusion covered one of the mechanism's two marks: `overview.ts` adds `is-arriving` **always** and an inline `transition: none` **only when the row moved**, clearing both in one `afterNextPaint`, and `.recent-row.is-arriving` carries `transition: none` in CSS — so a row that arrived without moving was reported as `snapping: recent-row (12)`. **(b)** `press-down` settles on `scaled` and `visible` agreeing twice and never compared how many nodes `CSS.forcePseudoState` **reached** against how many the reader **scored**; every unreached node reports its at-rest `--dur-release` 0.16s, which is indistinguishable from a button that does not shorten its press. It printed `569 of 697 at 0.1s … [forced=573]` and the finding written from it was *"128 apps tiles snap their press"* — two numbers that must be equal sitting side by side, differing, with the verdict taken from the other one | **Fixed 2026-09-21.** (a) the exclusion tests both marks and names which it found — `recent-row/inline (36), recent-row/is-arriving (12)`. (b) `forced === matched` is in the settle predicate, the line reads `[forced=721 of 721 matched; 4 mid-FLIP skipped]`, and a mismatch is a **NO READING** naming the shortfall rather than a FAIL. **The wrong fix for either is a longer wait** — a sleep makes the miss rarer without making it impossible and cannot say whether the run that passed did so because the state arrived. The sweep also prints its **theme** and **link state** now, because a dark and a light run came back byte-identical and two indistinguishable files are one reading and a claim | (a) proven at its own layer: three real `.recent-row` buttons given the class with no inline style read **3 snapped / 0 excluded** without the branch and **0 snapped / 3 excluded** with it. (b) red against the verbatim case by narrowing the force selector by `.apps-tile`: *"the force reached 593 nodes and the reader matched 721 — the 128 it did not reach report their AT-REST duration"* | `docs/testing.md` → Motion pass close-out |
| **131** | **Nineteen fixture suites under `scripts/` are run by nothing, and two of them were red on the branch.** `check-suites-run.mjs` guards Gradle and `npm test`; `orphan-tests-none.sh` says in its own header that *"scripts/\*.test.mjs are counted and reported, not checked"*. So: **(a)** `check-renderer-scripts.test.mjs` asserts the page loads `discHue.js` and the scan sees it — `discHue.ts` was deleted with its last caller, correctly, and the control that named it rotted. **The guard went on passing**, because its scope comes from `index.html` and a file no longer listed there is not in scope. **(b)** `adb-count.test.sh` exports `CONNECTSUITE_ADB` to point at a fake and `adb-pinned.sh` execed a literal `adb`, so the pin was fakeable and the command was not; its two *must READ* fixtures could only pass with an SM-S938B on the cable. Its FAIL branch then died under `set -u` on `'$want…'` — bash takes the ellipsis bytes as part of the name — so the first failure it ever reported was a crash with no diagnosis | **Fixed 2026-09-21**, with an enforcement point rather than two repairs. (a) the rotted name is replaced by a **structural** control: every name the scan returns must resolve to a real `src/shared/*.ts`, which cannot go stale on a deletion and goes red on index.html and the tree disagreeing — a 404 in the page. **The wrong fix is a second file name**, which is an allowlist of one and rots the same way. (b) `adb-pinned.sh` resolves `${CONNECTSUITE_ADB:-adb}` exactly as `target-device.sh` already did, so the pin and the command talk to one adb; braces around `${want}`. And `scripts/check-script-fixtures.mjs` + `scripts/hooks/script-fixtures-green.sh` — the **fifteenth** commit hook — runs all twenty in ~2s and refuses on a red one or on a discovery below its floor | `check-script-fixtures.test.mjs` (8, including both floors and a control that a file merely *mentioning* a test is not a suite); red-first against the historical case — restoring the `discHue` anchor denies the commit and names the assertion | `docs/testing.md` → Motion pass close-out |
| **132** | **Every drop onto the phone failed: the drop target read `file.path`, which Electron removed in v32; this app runs v43.** The Files pane's tile appeared (push served), took the drop, and answered *"… could not be read from this drop"* for every file. Read on the running renderer (43.4.1): a real Chromium drop (`Input.dispatchDragEvent` with a path) handed the page a `File` whose `path` read `undefined`, while `webUtils.getPathForFile` returned the real path in the same event | **Fixed 2026-09-23.** The preload exposes `pathForFile` over `webUtils`; a file with no path on disk (a drag out of a browser) is counted and named on the card rather than sent as zero bytes. **The wrong fix is `sandbox: false` + `nodeIntegration` to get `File.path` back** — the property is gone from Electron itself, not hidden by the sandbox | The unit double cannot see this (its `pathForFile` reads the fake's own field), so the evidence is live: `scripts/sidekick-drop-probe.mjs` — `oldPathProp: "undefined"` beside `viaWebUtils: "/…/sidekick-pass-sample.txt"`, control: the card drawn | `docs/testing.md` → Sidekick feature pass, Feature B |
| **133** | **The Mac never read the phone's verdict on a push.** `fs.transfer.progress` and `fs.transfer.done` were emitted by the phone for every push and dropped by the Mac's dispatcher, so a push was reported *"sent"* when this Mac finished **writing** — bytes queued, the number `CLAUDE.md`'s stimulus rule forbids reporting as delivered — and the phone's `verified`, `CHECKSUM_MISMATCH` and "stopped after N bytes" never reached a screen. Measured live: a 60 MB send's write resolved at 866 ms with the phone at **30%** | **Fixed 2026-09-23.** `shared/sendBatch.ts` draws every number from the phone's events: `arrived` only on `fs.transfer.done ok`, the bar only from `fs.transfer.progress`, and a Mac-side write completion is `confirming`, never arrival. The `transferId` is announced at the ack (`fs-push-agreed`) so the progress that precedes the write's resolution can be matched. **The wrong fix is a timer or the Mac's own write count on the bar** | `sendBatch.test.ts` (9; red with *write finished → arrived*: 2 tests fail), `filesView.test.ts` +6 (Stop in `confirming` red against the old `sending`-only lookup) | `docs/testing.md` → Sidekick feature pass, Feature B |
| **134** | **Four features could not be turned on from inside the app.** Onboarding asks for one permission (notifications) and says texts, calls and the rest *"are asked for from the Sync tab, when you turn them on"*. No screen does: outside onboarding and the QR scanner, **nothing in the shipped UI requests `SMS`, `CALLS`, `CONTACTS` or Photos** (every `ActivityResultContracts` use was read: two file/folder pickers, the camera, and onboarding). On the SM-S938B those three runtime groups were granted **without `USER_SET`** — by `adb` during testing, never through the app | **Fixed 2026-09-23.** *Set up Sidekick* (`app/.../setup/`) — one row per feature with real OS status re-read on every resume, runtime groups asked through the platform launcher on tap, special access by deep link and never claimed on intent, **Not now** on every feature, and *Turned off in Settings* once Android stops showing its dialog. It follows pairing in first run and is reachable from Sync settings. Onboarding's sentence now names that screen. **The wrong fix is asking for all of them on the onboarding page** — a wall of prompts before any feature is understood is how a grant is denied forever | `SetupPlanTest` (9): texts, calls, contacts and photos each have an asking row; copy passes onboarding's forbidden-mechanism guard (with a control). Emulator, clean data: `0 of 9` → Allow Texts → `1 of 9`, OS `READ_SMS granted=true, USER_SET` | `docs/testing.md` → Sidekick feature pass, Feature E |
| **135** | **Feature C cropped every rotated portrait photo from the phone.** MediaStore's `width`/`height` are the stored pixels and ignore EXIF rotation, so the SM-S938B's camera portraits are listed as **4000 × 2252** while they decode as **2252 × 4000**. C shaped the stage frame from the listing (248 × 140) and let the image size itself (203 × 360) inside a frame with `overflow: hidden`, so roughly **60% of each portrait was cut off** — `object-fit: contain` was on the element, and the element was bigger than the box. 5 of the first 6 Camera photos listed as landscape were portraits. The night's evidence missed it because the generated sample carried no EXIF rotation | **Fixed 2026-09-23 (C review).** The frame takes the best-known real shape — decoded original > the phone's 512 preview (made with rotation applied) > listing — in `stageShape`, and the image is pinned to the frame's box. Live on the same real photos: frame `2252 / 4000`, 248 × 360, the whole picture visible, letterboxed on the dark stage. **The wrong fix is `object-fit: cover`**, which fills the box by cropping — the defect, chosen on purpose | `photos.test.ts` — *the stage takes the photo's real shape* (red with the listing preferred). Live: `scripts/sidekick-photos-review-probe.mjs` | `docs/testing.md` → Feature C review |
| **136** | **The phone's `media.thumb` returns more than `maxEdge`.** Asked for `maxEdge: 512`, it answered **640 × 480** for a 1280 × 960 photo and **453 × 806** for a HEIC. `docs/protocol.md` says the phone fits inside `maxEdge`; the ack and the bytes disagree with the contract, and a batch of 32 oversized thumbnails is a larger control frame than the cap was sized for | **Fixed 2026-09-29, verified on hardware** (15:48: synthetic 1200×900 → 256×192 at 256, 512×384 at 512; 640×360 video → 256×144 / 512×288). `media.thumb` now leaves by `FsThumbs.encode(bitmap, edge)`, the rule `fs.thumb` already used: the provider’s bitmap is scaled to fit inside `maxEdge` (aspect kept, never upscaled) and the ack reports the produced size. The photo path’s own encoder is gone | `FsThumbsTest` → the two measured oversized results fitted (640×480 → 512×384, 453×806 → 288×512) + a source guard; the mutation restoring the path’s own compress is red. **Owed:** one `media.thumb` batch on hardware reading ≤ 512 on both edges | `docs/complete-app-pass-2026-09-29.md` §6 | `docs/testing.md` → Feature C review |
| **137** | **The phone lists 0 entries for every granted SAF tree.** DCIM, Documents and Pictures are persisted grants (`persisted=0x3`), yet `SafTreeStore` reads **0 entries in 2 ms** for each (`snapshot of primary:DCIM … 0 entries read`), while `media.*` reads DCIM/Camera's ~16,000 items fine. Seen since at least 2026-09-23 01:03; `docs/testing.md` recorded DCIM listing 28 entries on 2026-09-01. The Files pane therefore shows granted folders with nothing in them | **Open — boundary reached: the provider (2026-09-23, 10:06).** A debug-only probe (`SafChildrenProbeActivity` → `SafTreeStore.probeRootChildren`, the product's own URI builder, projection and resolver, tree root only, ≤ 20 rows) asked each tree once: **a cursor came back** for all three, with the five requested columns, **`cursor.count` = 0**, 0 rows examined, no extras (`EXTRA_LOADING`/`EXTRA_ERROR`/`EXTRA_INFO` absent), no exception. `entryOf` never saw a row, so **the parse is ruled out** — the count is the cursor's own. On disk the folders are not empty: `ls -A` through the shell (a different client, count only) reads DCIM 29, Documents 1, Pictures 229 — DCIM 29 and Documents 1 are exactly what the app listed before the 00:53 flip. `com.android.externalstorage` restarted at 09:05:58 and still answers 0, so it is not a stale provider process. The grants are intact (`persisted=0x3`, `persistedCreate` unchanged across the `-r` install). **This establishes what Sidekick received — a non-null, well-formed cursor with count 0 — not why `ExternalStorageProvider` returned zero to this app; that is still unknown.** Not fixed and not worked around; the granted folders are not empty | **Fix direction:** the next question is why `ExternalStorageProvider` answers an empty children cursor to this uid while the directories hold entries — read the provider's own log around a probe run, and compare a fresh process of ours against the long-lived one. Anything in Sidekick is downstream of a 0-row cursor. **The wrong fixes are re-requesting the grants** (present and persisted; a new grant would hide the cause), **falling back to `MediaStore` or a path listing** (a different client answering a different question — it would show files the tree does not serve), **and describing the folders as empty** — they are not | — | `docs/testing.md` → Feature D review; Files follow-up; Defect 137 probe |
| **138** | **At the window's 1100 px minimum the Files list's name column collapses to 0 px.** The row grid is `minmax(0, 1fr) 180px 90px`; the listing column is ~229 px there, so the computed columns are `0px 180px 90px` and file names are invisible, the table scrolling sideways (300 in 229). The same rule stands in the commit before Feature D — **pre-existing**, not a D regression | **Fixed 2026-09-23.** The listing is a size container; below 480 px of its own width the date column goes (the detail card carries *Modified*) and Name/Size share it: live at 1100 × 700, `127px 72px`, names readable, no sideways scroll; normal width unchanged (`259px 180px 90px`). The first live reading still computed `0px 180px 90px` — the override lost to the later base rule at equal specificity — and is scoped under `.files-listing` now | **Fix direction:** give the listing `container-type: inline-size` and, below ~420 px, drop the date column (`minmax(0,1fr) 72px`) — the detail card already shows the date; or give the name a floor (`minmax(120px, 1fr)`) and let the date shrink. **The wrong fix is shrinking the font** — the columns, not the type, are wrong | — | `docs/testing.md` → Feature D review |
| **139** | **Set up Sidekick's Photos row misreports Android's *limited access*.** Measured on the emulator (SDK 37): choosing *Allow limited access* and one photo made the row read **On** — from `READ_MEDIA_IMAGES`/`VIDEO` shown `granted=true` but flagged `REVOKED_COMPAT\|ONE_TIME`, a session-only compatibility grant — and after the process restarted the same row read **Turned off in Settings**, in the warning colour, while `READ_MEDIA_VISUAL_USER_SELECTED` stayed `granted=true`. The person allowed some photos; the row says first *all*, then *none*. The row reads `MediaFeature.granted` on purpose, so the Mac's `photos` capability inherits the same two answers | **Fixed 2026-09-23; verified on the SM-S938B end to end.** Selected-only → phone `[caps]` `limited: photos — …` → Mac pane *Some photos allowed* with that sentence verbatim; full → `limited: none` → no notice. A grant made in Settings reaches the Mac when Sidekick next resumes (runtime grants are not watched; a revoke restarts the process). Following Android's Selected Photos Access guidance: `READ_MEDIA_VISUAL_USER_SELECTED` is declared and requested with the two media permissions on 34+, which ends compatibility mode. One state, `MediaAccess` (full = images **and** videos, or storage ≤ 32; selected = the selected-photos grant alone; else none), is read by `MediaFeature`, the `photos` capability contract and Set up Sidekick. Selected-only keeps `photos` advertised and adds it to a new optional wire field, `limited`, with the phone's sentence; the checklist row reads *Some photos allowed* with *Change selection* (the platform request again); the Mac's Photos pane draws *Some photos allowed* and that sentence. Red-first: 6 phone mutations and 2 Mac mutations, each red on its own tests — including the missing declaration, which the existing manifest test did **not** catch. **Unreached by any test:** the detector's `refresh`, the JSON the session emits, `link.ts`'s assignment, `renderer.ts`'s hand-off, and what Android grants for each dialog choice. Emulator run blocked (Mac disk) | **Fix direction:** declare `READ_MEDIA_VISUAL_USER_SELECTED`, request it with the two media permissions, and give partial access its own state in **one** place `MediaFeature` and the checklist both read (e.g. *Some photos allowed* with *Change* re-opening the platform dialog). **The wrong fix is relabelling the Setup row alone** — the row and the Mac's capability would then disagree, which is what reading `MediaFeature.granted` exists to prevent | — | `docs/testing.md` → Feature E review |
| **140** | **After first run, Set up Sidekick is reachable only through Transfers → Manage folders → the gear (*Sync settings*) → Set up Sidekick.** Commit `0d2d038` says it is reachable from Sync settings, which is true; Sync settings itself is reachable only from the Folders drill-down's header icon (`SyncRoute` → `SectionHeaderBar(actionLabel = "Sync settings")`). Someone who said *Not now* to Texts at first run has no visible route back to the switch | **Fixed 2026-09-23; verified on the emulator and the SM-S938B** (paired: the card is above *Paired Macs*, visible at rest). The Devices gear opens Mac settings, and both of its states now carry a *Set up Sidekick* card (`SetupEntryCard`): the pairing screen at its entry stage (never over a pairing in flight) and Mac management, above the paired list. It pushes the existing `ROUTE_SETUP`, so Back and Done both pop to Mac settings; the five tabs are unchanged and the checklist is still landed on only when onboarding completes. `SetupReachabilityTest` reads that wiring — red under three mutations (gear unwired, Mac management not handed it, a second landing on launch). **The rendered route and Back were not exercised**: the emulator could not be used (Mac disk full) | **Fix direction:** one entry from a top-level surface a person opens anyway (the Devices screen, or the Transfers header beside *Manage folders*), navigating to the existing `ROUTE_SETUP`. **The wrong fix is re-showing the checklist on launch** — it would nag everyone who has finished with it | — | `docs/testing.md` → Feature E review |
| **141** | **The checklist read the grant list itself, and counted something else.** `SetupScreen` called `persistedUriPermissions` twice — every persisted grant, of any kind — where the Folders screen counts readable **tree** grants through `FsRoots`. `FsRootsSingleSourceTest` pins one reader but scans `sync-module` only, so nothing could see a second reader in `app/` | **Fixed 2026-09-23.** The row and its count read `FsRoots.grantedTrees`. `AppGrantReaderTest` holds the same rule for `app/`, with a control that the scan sees 13 sources and the `FsRoots` call; red when the old line is restored | **Fix direction:** read through `FsRoots`; extend the single-reader rule to `app/`. **The wrong fix is a second filter in the screen** — two copies of one fact | — | `docs/testing.md` → Feature E review |
| **142** | **Every checklist button was unnamed for a screen reader.** Four *Not now*, three *Open Settings* and several *Allow* on one screen, each announced by its words alone — moving button to button, nothing said which feature a button acts on | **Fixed 2026-09-23.** Each button's description is `SetupPlan.buttonDescription` — *"Allow: Texts"*, *"Not now: Calls"*. Asserted per item (the description names that item's title and the button's words); red when the title is dropped | **Fix direction:** name the feature in the description, from one pure function the test calls. **The wrong fix is a unique visible label per button** — the design's repeated words are fine for sighted reading | — | `docs/testing.md` → Feature E review |
| **143** | **The battery row's button said *Open Settings* and raised a dialog.** `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` answers with a system dialog on the checklist itself (*"Let app always run in background?" Deny / Allow*, measured on the emulator), not a Settings page | **Fixed 2026-09-23.** The row says *Allow*; once refused for good it says *Open Settings*, and the notification-access and Control rows still say *Open Settings* because they do open it. Red when the rule is removed | **Fix direction:** word the action by what happens on tap. **The wrong fix is switching to the Settings list intent** to match the old word — the dialog is the shorter route | — | `docs/testing.md` → Feature E review |
| **144** | **The force-stop hook does not see `am start -S`.** `-S` force-stops the target before launching. It ran once during the E review, on the **emulator**, and cleared `enabled_accessibility_services` (1 → 0) — the exact cost the hook's header names. `no-force-stop.sh` matches `am force-stop … com.chetan.connectsuite` only | **Fixed 2026-09-23.** A second matcher, per command segment: `am start` / `start-activity`, a short-flag token whose letters include `S` (`-S`, `-SW`, `-WS`), and our package, in either order. The `am force-stop` matcher is unchanged. `no-force-stop.test.sh`: four new deny fixtures (all four passed through the old hook) and four new pass fixtures (an ordinary `am start`, `-W` with adb's lowercase `-s`, `-S` on another package, `-S` in another command of the chain); 14 of 14 | **Fix direction:** also deny `am start` carrying `-S` (alone or in a flag cluster) with our package, with a deny fixture and a pass fixture (an `am start` without `-S`). **The wrong fix is blocking `am start` on our package** — it is how `LinkService` is restarted after `install -r` | — | `docs/testing.md` → Feature E review |
| **145** | **The Devices screen says *Offline* while the Mac is connected.** Its header pill, hero line (*Paired with … · waiting for it to connect*), *Your Mac: Not connected* and the disabled *Send files* all read `Device.isConnected`, which `DeviceRepository` fills from `ConnectionManager.connectedDevices` — the **v1** Android-to-Android transport. The Mac connects over the **v2** `LinkServer`, which Mac settings reads (*Connected*). Seen on the SM-S938B, 2026-09-23, with `link-up.sh` reading 1 session ESTABLISHED, twice, 5 s apart. Since `597cb75` (2026-09-22) at the latest | **Fixed 2026-09-23; verified on the SM-S938B.** One projection, `MacLinkView.of(LinkState, trusted)` in `core/link`, read by Devices (pill, hero line, address chip, *Your Mac*, Send files, and `mirroringAvailable`) and by Mac settings. `ConnectionManager` untouched. Connect is now a named transition (`LinkState.afterSessionReady`) so `MacLinkViewTest` drives connect → drop → reconnect through the server's own writes. **Send files stays disabled with a reason on a live link**: `TransferManager.send` needs a v1 connection the Mac never has, and a phone-initiated send is Feature A. On hardware: both screens *Connected*; the Mac quit → Devices *Offline* in 2.4 s, relaunched → *Connected* in 3.3 s, without leaving Devices | **Fix direction:** the Devices screen's Mac state reads the same v2 link state Mac settings' `ConnectStage` reads, in one place both screens call, with a test that constructs it from the link's transition rather than by hand. **The wrong fix is adding the Mac to `ConnectionManager.connectedDevices`** — it would make a v1 transport claim a connection it does not carry, and Sync's Android-to-Android paths read that set | — | `docs/testing.md` → Defect 145 |
| **146** | **The force-stop guard does not run on commands sent through `scripts/adb-pinned.sh`.** The hook is registered with `"if": "Bash(adb *)"`, so it fires only when a command *starts with* `adb`. The repo's own rule sends every device write through `scripts/adb-pinned.sh` (or a wrapper around it), which does not start with `adb` — so `am start -S` on our package went through on 2026-09-23 (on the emulator, force-stopping it). Fed the same command directly, the hook denies it: the matcher is right, the registration is not | **Fixed 2026-09-23.** The `if` is removed from the registration, so the hook runs on every Bash command and its own matcher decides (it already ignores heredocs, messages and prose). `no-force-stop.test.sh` gains six wrapper fixtures — three deny (adb-pinned.sh, the target-device.sh serial, the verbatim variable-wrapper command), three pass (an ordinary pinned `am start`, `-S` and `am force-stop` on another package) — and a registration check that fails if an `if` narrows the hook again; red with the old `if` restored. Text fixtures only; no force-stop was run on any device | **Fix direction:** widen the hook's `if` to also match commands that invoke `adb-pinned.sh` or `target-device.sh` (or drop the `if` and let the script's own matcher decide), with a fixture for `scripts/adb-pinned.sh samsung shell am start -S -n com.chetan.connectsuite.debug/…` that must deny. **The wrong fix is loosening the matcher** — it already denies the right shape; only its registration is narrow | — | `docs/testing.md` → Defect 146 |
| **147** | **`check-suites-run` blocked ordinary non-commit commands.** Its registration is `"if": "Bash(git commit *)"`, yet during Feature A slice 1 (2026-09-24) it denied a Python heredoc editing a file, a `$(…)` test run, and the very `./gradlew testDebugUnitTest` run it asks for. That is a deadlock while staged sources are stale. The same Gradle command written with no substitution and no heredoc ran. **The mechanism is not established:** the observed split is *commands containing `$(…)`, `${…}` or a heredoc were evaluated as possible commits; plain ones were not*, and that is a correlation from about six sightings, not a reading of the harness | **open** | **Fix direction:** first establish what `if` does with a command it cannot fully parse, with a fixture pair (a heredoc `python3 -` edit and a `$(date)` command must pass while a stale staged source exists; `git commit` must still be denied). Then either narrow the hook's own trigger inside `suites-were-run.sh` (read the command from the hook input and exit 0 unless it is a commit) or accept the conservative match and say so. **The wrong fix is removing the hook or its `if`**: the guard is right about commits, and a stale-green commit is the failure it exists for | — | `docs/testing.md` → Defect 147 |
| **148** | **A bulk pull is not bound to the session that began it, and its id is guessable.** `BulkTransfers.serve()` takes a pending pull by `transferId` alone; `Pending.sessionId` is read only by `forgetSession`. So a bulk socket authenticated by **any** trusted session can claim another session's pending Files or Photos pull. Transfer ids are `t-<counter>-<millis mod 100000>`, which are predictable. `fs.transfer.cancel` is keyed by `transferId` alone as well. The exposure is limited to paired, pinned Macs, but the Feature A proposal stated this rule existed (§8, corrected 2026-09-24) and it does not | **Fixed 2026-09-29, tests only — not yet exercised on hardware.** Every pull is bound: `serve()` claims through `BulkClaim.claimToken(boundSessionToken, sessionId)`, so a Files or Photos pull is bound to the session that agreed it; a push is claimed only by its own session (`BulkClaim.decidePush`), looked at before it is taken; `fs.transfer.cancel` goes through `BulkTransfers.cancelFor`, answered only for the session's own transfers (an owner map held from registration until the socket is done, so a *live* transfer is covered too); ids are `tf-` + 128 random bits (`BulkClaim.newFilesTransferId`) | `BulkSessionBindingTest` (6): the rules, 2,000 ids distinct and never routed to Share, and a source guard on both call sites. Mutations red on fresh artifacts: P1 `serve()` back to `boundSessionToken` alone; P2 the cancel handler back to the unchecked `cancel`. **Owed:** one Files pull and one push on hardware after install | `docs/complete-app-pass-2026-09-29.md` §2 | `docs/testing.md` → Defect 148 |
| **149** | **A bulk claim for an unknown transfer reports `feature: "photos"` whatever the transfer was.** `serve()` answers a header naming no pending transfer with `NOT_FOUND`, `feature: "photos"`, hard-coded, so a Files pull that lost its registration greys out or tags the Photos pane | **Fixed 2026-09-29, tests only.** The refusal for an unknown id sends no `feature` (`feature = null`); it names no transfer, so no feature can be claimed for it | `BulkSessionBindingTest` source guard (no `feature = "photos"` in `BulkTransfers.kt`) | `docs/complete-app-pass-2026-09-29.md` §2 | `docs/testing.md` → Defect 149 |
| **150** | **The Mac's Files and Photos pulls can replace a file at the final name.** `freeName` checks the name *before* the transfer, and `bulk.pull` publishes with `fs.rename(part, destination)` *after* it. On macOS `rename` replaces whatever appeared at that name in between, so a file created or downloaded there during the transfer is overwritten without a word | **Fixed 2026-09-29, tests only.** `BulkClient.pull` publishes through `publishPulled`: the share path's exclusive hard link (`publishExclusive`), EEXIST → the next free name; on a folder without hard links an `O_EXCL` copy (`COPYFILE_EXCL`), which also refuses rather than replaces, so exFAT/SMB receive folders keep working | `bulkPullPublish.test.ts`: a file created at the final name mid-transfer is kept and the pull lands as `IMG (2).jpg`; the same with links refused. Mutation M1 (`rename` restored) red on both. **Owed:** one Files and one Photos pull on hardware | `docs/complete-app-pass-2026-09-29.md` §2 | `docs/testing.md` → Defect 150 |
| **151** | **The Mac's pull deletes a `.part` it has no record of, which may be another app's download.** The partial for a destination is `<name>.part`, derived from the final name, and before a fresh pull `bulk.pull` removes an unrecorded `<name>.part` with `fs.rm`. If another app is downloading `IMG.jpg` into the receive folder, its `IMG.jpg.part` is deleted as soon as a Files or Photos pull picks the free name `IMG.jpg` | **Fixed 2026-09-29, tests only.** The pull partial is `.<name>.sidekick-pull.part` (`pullPartPathFor`) — a name only Sidekick writes — so another app's `<name>.part` is never looked at, resumed or deleted. The name is the ownership claim; a partial at it is Sidekick's own | `bulkPullPublish.test.ts` (151); mutation M2 (`<name>.part` restored) red | `docs/complete-app-pass-2026-09-29.md` §2 | `docs/testing.md` → Defect 151 |
| **152** | **The debug probes are exported with no permission, so any app on a phone running a debug build can start them.** `app/src/debug/AndroidManifest.xml` exported four adb-driven harnesses with no intent filter and no `android:permission`: `DesignPreviewActivity`, `PhoneAddressProbe`, `SafChildrenProbeActivity` and `ShareOfferProbeActivity`, which makes the phone offer data to the paired Mac. Debug-only means *not in a release build*. It does not mean *unreachable by other apps on the device it is installed on*. **Corrected 2026-09-24:** this row said `FsProbeActivity` (which can arm the transfer-corruption hook) was among them. It is declared in **no** manifest, so nothing can start it, adb included | **Fixed 2026-09-24.** The four require `android.permission.DUMP` (held by the shell user, `signature\|privileged\|development`), and the built debug APK gates exactly those four. `DebugProbeGateTest` is red against the old manifest and green now. The gate was demonstrated on the emulator with two throwaway apps: a caller without `DUMP` is refused (`Permission Denial … requires android.permission.DUMP`), the same caller starts an ungated control, and the shell starts the gated activity. **Not yet proven with Sidekick's own APK on hardware**: no install was permitted, so the adb path on the SM-S938B is owed at the next approved install | **Fix direction:** gate every exported debug activity that has no intent filter behind a permission the shell user holds and third-party apps cannot (`android.permission.DUMP`), prove the gate on a device in both directions (the shell starts it; a third-party caller is refused), and add a manifest test that fails when an exported, filter-less debug activity lacks it. **The wrong fix is `exported="false"`**: `adb shell am start` runs as the shell user and is refused, which removes the probe rather than guarding it | — | `docs/testing.md` → Defect 152 |
| **153** | **The share pull deleted, or published as Saved, whatever was at its partial's name.** `pullShareWith` identified its partial by `lstat` of the name after creating it, cleaned up on failure with `unlink(part)` by name, checked the size before publication with `stat` (which follows a link), and `publishExclusive` unlinked the partial by name after linking. So a file that replaced the partial during a transfer was **deleted** on failure (S2-A), and a same-size replacement was **published and reported Saved with the phone's digest** (S2-B) | **Fixed 2026-09-25.** Swap, race and failure paths **by synthetic tests only**; the normal path passed **one supervised live transfer** on the SM-S938B (`983a55b`, 23:16). The partial is created with `wx` and identified from **its open handle**, held to the end; a name is deleted only after `lstat` shows it is still that file; before publication the name must be that file at the offered size; after the link the saved name must be that file, or the offer ends in a new Mac state, `unexpected-file` — not Saved, Close only, no Retry, the phone told the existing `write-failed`. `publishExclusive` no longer deletes anything. **Not race-free, and not claimed to be:** a check and the delete after it are two syscalls, and the owner accepted that window against a deliberate process running as the same user, so it is **residual — detected by the file's link count, not prevented**. **Open limitation:** a write that never settles keeps the pull open, cancel or not | red-before on the verbatim defect (S2-A ×2, S2-B); 15 mutations, each red on its own test; 1188/1188 Mac tests. **Live, normal path only:** `sidekick-share-test-001.png`, 100,718 bytes, SHA-256 equal on both ends, published-name confirmation logged, phone acknowledged Saved, one link, no partial, ledger and staging empty, 25 other entries unchanged. **Localhost speed impact inconclusive**: 96.8%, **94.1% (missed the 5% criterion)** and 99.6% of HEAD's median over three passes | `docs/testing.md` → Defect 153 |
| **154** | **The destination check's probe files are deleted by name with no identity check.** `checkDestination` creates `.sidekick-link-probe-<nonce>` and its `-2` link, records their identity in the ledger, and then deletes both with `unlink` by name without comparing that identity — the same shape as 153's failure cleanup, for files that live for milliseconds | **Fixed 2026-09-29, tests only.** The first probe's identity is read (`lstat` dev/ino) right after its exclusive create; each probe name is unlinked only while `lstat` still shows that identity, and anything else is left and reported (`… now another file, left untouched`). One `lstat` → `unlink` window remains, the same residual the share pull documents | `shareDestination.test.ts` → *154: a probe name swapped…*, red first against the old code by mutation (identity check disabled) | `docs/complete-app-pass-2026-09-29.md` §2 | `docs/testing.md` → Defect 154 |
| **155** | **`ShareReceiver.decide` trusted its caller to send one decision at a time.** After an Accept's destination check (an `await`) it did not re-read the offer's state, and nothing marked an Accept as in flight. So a Decline arriving during that check was **overwritten**: the offer went on to `accepting`, was pulled, and ended **saved** — a person's Decline followed by a saved file. Two Accepts for one offer sent **two `share.respond` accepts and started two pulls**; against the fake phone, two copies were published (`same-name.png`, `same-name (2).png`). **Not reachable through the shipped window**, which disables Decline and Accept while a decision is pending (tested); reachable by any second caller of the main-process API | **fixed 2026-09-26 (`676c5f2`). In the Mac dev app running since 2026-09-26 12:53:45 (pid 93018, `dist` built from `f71285b`); the race has not been produced on hardware** (corrected 2026-09-26 — `docs/testing.md` → *Stage 0 corrections*) | red-before on both, at v2 and v3 (`Decline … wins`: *actual `saved`, expected `declined`*; `clicked twice`: never settled, two pulls); mutations M1 and M2 each red on their own test; 1245/1245 Mac tests | `docs/testing.md` → Defect 155 |
| **156** | **The running Mac app's Files pane had no Pause, Resume or Cancel for a block pull.** `renderer.ts` built the pane's bridge as an inline literal that passed `fsPull` and omitted `fsPullStop`, `fsPausedPulls` and `fsCancelPaused`. The preload exposed all three and main handled them, but the pane draws Pause/Cancel only when its bridge has `fsPullStop` and reads the paused list only through `fsPausedPulls`. Found on hardware: L1/L2 T2 (2026-09-30 13:55) reached 42.5% of a 200 MiB block pull with **0** Pause buttons on screen. Every Files-pane test was green because each gave the view its own bridge double that already had the three calls | **fixed 2026-09-30** — bridge and subscriptions moved into `filesBridgeFrom` / `wireFilesEvents` (`files.ts`), which the page calls and a test can reach; the three calls passed through. Tests only at commit; hardware is T2's retry | `filesWiring.test.ts`, 3 tests, red against the moved-verbatim literal (*"lacks … fsCancelPaused, fsPausedPulls, fsPullStop"*; *"Pause is drawn: actual 0"*); mutations M0–M7 each red on the named test; Mac 1,402/0, both typechecks 0 | `docs/testing.md` → Defect 156 |

---

## Closed this sitting, with the evidence that closed each one

### 31 — the media card never learns about changes made on the phone → **closed by step 67** · **closed**

The push half of the media remote was dead: every state the Mac had ever seen came from its own
command handler, which is why step 64 passed at 16 commands / 0 refused over a broken feature.

**Evidence.** The Mac's `[remote]` state counter climbs **466 → 591** across four playing/paused
flips while `delivered` stays frozen at **29**. `delivered` counts `remote.command`s the Mac sent,
so no Mac command caused any of them, and the flips alternate so each inverts what the Mac was
showing a second earlier. Contrast the run this step exists to prevent: **93 → 93**.

**Reconstructed, and recorded as such.** The phone's `link.log` for that window has rotated away and
no `dumpsys media_session` reading survives, so the Mac-side clauses are proven from the log and the
phone-truth comparison rests on the run's own observation at the time.

### 34 — `sms.received` is dropped by the Mac → **closed by step 68, both contact states** · **closed**

Lived between a phone that logged a successful push and a Mac that logged a silent drop; only both
logs together found it.

**Evidence.** Two runs against the self-thread, read separately because the revoke restarts the
process and resets every denominator:

| | contacts granted | `READ_CONTACTS` revoked |
|---|---|---|
| Mac log | `sms.received in thread 594 from Chetan (+919800000001)` | `… from +919800000001, no contact name` |
| drawn row | present, inbound | present, inbound |
| attribution | **Chetan** | **+919800000001** |

Neither blank. The phone said `1 pushed / 0 dropped since start` in both.

**The discriminator, which is what makes it evidence.** The row appeared at +1404 ms while the
pane's own note still read the pre-send count, and the composer's provider re-fetch is in the log
answering **10 messages** — so the row came from the push, not from a re-read. Had the re-fetch
returned 11, a working push and a lucky re-read would have looked identical.

**68a is explicitly not claimed.** Two messages, both `pushed after 1 lookup(s)`; the retry path was
**not exercised**, and the `NOT pushed … after 3 lookups` line never appeared.

### 35 (outgoing half) — the call card had no number in either direction → **closed by step 69**

**Evidence.** `Call c1 dialing from +919800000001 (Chetan) — 1 of 1 episodes with a number since
start`; Mac headline **`Chetan`**, second line **`Dialling · +919800000001`** with the ` · ` present.
The two-step confirm was read between the clicks — `Confirm — call +919800000001` with the live card
still hidden, so nothing was placed by the first click.

**35c, the inbound half, is still open** and is what step 70 is for. It cannot be proven by a
dialled call: its whole point is that the platform fills `EXTRA_INCOMING_NUMBER`, which does not
happen for an outgoing or a simulated call.

**Fix direction for 35c: none pending — the code change has shipped and what is missing is
evidence.** `CallWatcher` already watches `PHONE_STATE` for the inbound number and the phone logs
`Watching PHONE_STATE for the inbound number` at install. Do **not** write further code against
35c before step 70 runs: the failure mode here is fixing something that already works because the
only run that could show it works has not happened. If step 70 shows the headline blank, the
diagnosis starts at whether `READ_CALL_LOG` was granted, which is precondition 2 of that step and
exists precisely to separate "the fix does not work" from "the permission that feeds it is off".

### 37 — a re-granted notification listener never turns its capabilities back on → **closed** · **closed**

Two wrongs with different shapes.

1. **The stale read.** `specialAccessGranted()` read `enabled_notification_listeners` and lost a
   2 ms race with the write that had just caused the platform to bind the service. Fixed by
   `SpecialAccessReading.granted(namedInSettings, bound)`: a bound component is proof of its own
   grant, because a bind cannot happen without the grant while a settings read can be
   stale-negative. This does **not** loosen the both-halves invariant — `advertisable` still takes
   `granted intersect running`, and all seven of `RunningGateTest`'s tests pass untouched.
2. **The missing backstop.** `startWatching` was registered from `LinkServer.start()`, scoping the
   observer to the server being up — which is precisely when a user is *not* toggling grants. Moved
   to `LinkServer`'s `init`, so its lifetime is the process.

**Evidence, taken in the broken case — the grant made with the link DOWN.**

```
00:03:47.619 I [caps]  A Settings toggle changed; re-checking capabilities     <- observer, no server
00:03:51.434 I [notif] Notification listener attached to the link
00:03:51.435 I [caps]  Capabilities now: calls,contacts,input,mirror,notifications,remote,sms
```

against the defect's original, where the same millisecond produced `missing Notification access` and
never changed again. Controls: `A605/A606/A607` bound **0** throughout while the same query returned
7 other listening sockets; `grep -c "Listening on"` **0** in the window and **2** over the whole
file; the observer's own line count **0 → 3**. The revoke half was read as well as the re-grant half
— the set correctly drops to five while nothing is bound.

Re-verified on the second APK of the sitting, after defect 40's fix.

### 40 — `call.reject delivered` names a disposition it does not decide → **closed** · **closed**

**It never corrupted step 70's measurement**, and that was checked before it was fixed rather than
assumed: the sentence is a log string passed to `deliver()`, the wire ack carries only `callId`, and
the disposition comes from `CallWatcher.dispositionOf`. It was fixed because it sat inside step 70's
own instruction table telling the reader an outcome, and would answer a `grep rejected` identically
on a good build and a broken one.

**Evidence.** `call.reject delivered (rejected — the episode is flagged; call.ended decides the
disposition when the call ends, and answered outranks the flag)` followed by `Call c1 ended answered
after 4113ms` — the first line now explains the second instead of denying it.

### 43 — a call with no number logged as `from ,` on the Mac → **closed** · **closed**

Found minutes after 42, by 42. The honest blank walked into an unguarded two-branch ternary:

```
00:42:55 I [calls] call.incoming c2 (dialing) from , no contact name — 26 rang / 18 ended / …
```

`from ,` is **the exact string defect 35 is named for**, in a different file, eleven defects later.
It had never been reachable, because before 42 a phone-placed outgoing call always carried the
previous call's number. The renderer was already correct — `callWho` and `callStatus` both handle
the blank, from 35's fix — so the card was right and only the log was wrong, which is why nothing
caught it sooner.

**Fix:** `whoLine()` in `desktop/src/main/calls.ts`, four cases, the fourth being `with no number
from the platform` — the same sentence the phone uses for the same state. Test shown to fail
against the two-branch version.

**The lesson worth keeping:** a formatter branch that has never been reachable is untested code
wearing the appearance of tested code. Fixing an upstream defect is exactly when such a branch
becomes reachable, so the question to ask after any fix that makes a value newly possible is *which
formatters have never seen this value*.

### 41 — the force-stop hook denies prose that merely mentions the rule → **closed** · **closed**

Found on 2026-08-29 while writing this file: the attempt to create it was **denied by the hook**,
because the text explains the force-stop rule and the repo is called ConnectSuite.

`scripts/hooks/no-force-stop.sh` matched two substrings independently, anywhere in the command
string — `force-stop` and `connectsuite`. Any command containing both was denied, which includes
every heredoc that documents the rule, `grep -rn "force-stop" docs/`, and a commit message
explaining a fix to the hook itself.

This is worth its own number rather than a tidy-up because of what it did: **the enforcement point
CLAUDE.md holds up as its model blocked the prose it is supposed to be paired with.** CLAUDE.md says
of that pairing, "a hook can carry a sentence but not an argument — the two are a pair". A hook that
forbids writing the argument breaks its own half of the deal.

**Fix:** strip heredoc bodies and quoted file content before matching, then require the real command
form — `am` immediately followed by `force-stop`, with the package as an argument rather than merely
somewhere in the string. The deny is unchanged for every real invocation.

**Evidence:** `scripts/hooks/no-force-stop.test.sh`, six fixtures. The three that must be denied
still are, including the exact form that caused the original grant loss; the three that must pass —
this file's heredoc, a `grep` for the rule, and a commit message quoting it — were all denied before
the fix and all pass after.

---

## Open, with fix directions and the wrong fixes to avoid

### 17 — the Mac holds one phone, and refuses the second rather than evicting it · **deferred**

`desktop/src/main/store.ts` still declares `paired: PairedPhone | null` — one slot, structurally.
`link.ts` writes it only when empty and rejects any fingerprint that does not match before the
handshake, so a second phone cannot connect at all while the first is paired, and scanning the new
phone's QR does not help.

**Fix direction:** make the stored slot a list. Remembering two phones is a much smaller job than
connecting to two — `LinkClient` holds a single socket and `main.ts` constructs one — so the
eviction/selection behaviour is worth having well before any concurrent-connection work.

**Workaround today, and it is a real one:** a second Mac instance with its own data dir. Both the
paired slot and the TLS identity live under `app.getPath('userData')` and there is no
`requestSingleInstanceLock`, so they do not collide:
`cd desktop && npm start -- --user-data-dir=/tmp/connectsuite-s25`.

### 42 — an episode is labelled with the previous call's number · **closed by step 70, 2026-08-31**

**Inbound half verified on hardware.** `c7` at 13:43:01 drew `+919800000001 (Chetan)` — its own
caller — while the immediately preceding episode `c6` was a *different* call from the same number
three minutes earlier and `c5` before that was `+919700000007 (Contact G)`. The
card carried the current episode's number and contact, which is the whole of 42. The outgoing half
closed on 2026-08-29; the inbound half was unit-tested only until this ring.

**Outgoing half: fixed and verified.** `CallNumberRules.numberAtEpisodeStart` makes a `dialing`
episode refuse a number it did not obtain for itself, proven on hardware — a phone-placed call now
reports `number withheld by the platform` where the old build reported the previous call's name.

**Inbound half: reopened the same day, by a real call.** The fix deliberately let a `ringing`
episode keep whatever the field held, on the stated premise that *"the PHONE_STATE broadcast is the
source, and it fires alongside this transition"*. **That premise is false on this device** — see
defect 45 — so for inbound calls the field holds residue:

| App episode | Displayed | Platform row |
|---|---|---|
| `c1` 08:29 | *(blank)* | `MISSED +919900000002` |
| `c2` 09:40 | **`+919900000002 (Contact B)`** | `INCOMING` **`+918200000005`** |

c2 showed the user the previous caller's name and number. Timestamps and the 344 s duration confirm
the pairing.

**Fixed 2026-08-29** along these lines, and the diagnosis was corrected in the same sitting: the extra *is* delivered, just after the state callback, so on a 197 ms call it lands after `end()` and poisons the next episode. `numberAfterBroadcast` now takes `episodeLive` and refuses to write between episodes, which made the second rule simpler — `numberAtEpisodeStart` lost its `phase` parameter, because with the field empty between episodes there is only one legitimate source left. Inbound verification awaits the next real inbound call; nobody needs to be asked to ring.

**Original fix direction, kept for the record:** no exception for the inbound path. An episode begins with a number only when the
value was written *for that episode* — the provenance flag `numberFromDial` already does this for
outgoing; the broadcast needs one too — and blank otherwise. On this device that makes every inbound
card read `Unknown number`, which is correct and far better than a stranger's name.

**Do this before defect 45's mechanism work.** A blank is recoverable and a confidently wrong name
is not, and this fix needs no design decision while 45's does.

**Note the guard test still passes and is still right.** `an inbound ringing episode keeps the
number the broadcast gave it` encodes the assumption; the assumption is what broke, not the test.
It should be rewritten alongside the fix, not deleted as though it had been wrong.

### 45 — `EXTRA_INCOMING_NUMBER` arrives, but after the card is published · **closed by option 4, step 70, 2026-08-31**

**The heading's original claim — *never arrives on Android 16* — is wrong and is left visible
rather than deleted, because the correction is the finding.** The extra arrives; it arrives *after*
`begin()` has already published a blank card, which on a build that never re-published looked
identical to never arriving. Measured on hardware: **7 of 7 episodes corrected**, arrival offsets
**16 ms to 535 ms** into the ringing, spanning 2026-08-30 22:47 to 2026-08-31 13:43.

Option 4 — re-publish `call.incoming` for the same `callId` when the number changes on a live
episode — is the shipped fix and is proven on hardware by step 70. See `docs/testing.md`, "Step 70
— PASSED".

**The residual is a platform property, not an open defect.** A self-managed VoIP call (`c13`,
2026-08-30, WhatsApp) carries no `EXTRA_INCOMING_NUMBER` at all, so no correction is published and
the card honestly reads `Unknown number`. That is the green test *a still-blank number corrects
nothing* doing its job, and it is the documented degradation the option was chosen for.

Severity: **High.** It invalidates a claim written in the code and the premise of step 70's 35c
clause at the same time.

`CallWatcher.registerPhoneState` asserts the extra *"is populated whenever the pane is lit"* given
`READ_CALL_LOG`. On this device — **Android 16, SDK 36** — it is not. The extra was deprecated at
API 29 and is not delivered to an app that is neither the default dialer nor an `InCallService`;
the grant is necessary and not sufficient. Both grants were present and the receiver was registered
in-process, and c1 and c3 still arrived blank.

**Diagnosis corrected 2026-08-29:** the extra *is* delivered, just after the state callback — see
`docs/testing.md`. "Never in time", not "never at all", and the difference opens a repair option.

**The wider finding, unchanged: this mechanism has never been observed working here.** Every inbound number the
app has displayed correctly is explainable as residue — c2 is proven residue, and last night's c4
(`ringing from 8800000004 (Contact D)`) followed two episodes involving that same number and was
recorded at the time as unusable for exactly that reason. Same shape as defect 31: a plausible
output over dead wiring.

**A decision brief is written and the decision is not taken: `docs/decision-45-inbound-caller-id.md`.**
It costs the options out, answers whether this is a wall or a configuration (it is a *toll* — the
number is available to an app holding a call-handling role, so `CLAUDE.md`'s platform-walls section
must not absorb it as-is), and says which clauses of 35c and 36 survive each choice.

**Fix direction — a decision is needed before code:**

1. **`CallScreeningService`** — gives `Call.Details.getHandle()` for incoming calls, is public API,
   and does not require being the default dialer. Costs the call-screening role: another onboarding
   grant that can be revoked. Most likely answer.
2. **`InCallService`** — requires becoming the default phone app. Disproportionate for showing a
   caller's name.
3. **Accept it as a platform wall and say so**, the way call audio is documented in
   `docs/permissions.md`. Locked decision #6 requires a specific reason, not a blank — so this is
   the honest fallback if option 1 is rejected, not "do nothing".

**Wrong fix to avoid: reading the call log at ring time.** The row for a still-ringing call has not
been written, so the read returns the previous call's row — reproducing defect 42 by a second route
while looking like a fix. That is `dispositionOf`'s rejected shape, defect 36's shipped wrong fix
and defect 39's open temptation, for the fourth time in this codebase.

### 44 — a message sent on the phone never reaches the Mac · **closed**

Found by reading during Phase 5 preparation, 2026-08-29. `SmsFeature` pushes exactly one event
(`SMS_RECEIVED`, from the inbound broadcast) and `MessageType` declares four SMS types and no fifth.
Nothing observes outgoing provider rows, so a message typed on the handset is invisible to the Mac
until an unrelated refresh happens to redraw the thread.

**Numbered separately from 39 deliberately.** Same symptom — the Mac's thread is missing a message —
and a different cause. 39 is a race the Mac loses against its own provider read; 44 is a mechanism
that does not exist. A fix for 39 alone would close the visible bug and leave the phone's keyboard
diverging from the Mac forever, which is exactly why this is not a note inside 39.

**Fix direction:** the `sms.sent` event in `docs/phase-5-proposals.md` — accepted 2026-08-29 —
emitted on any new outgoing row regardless of origin, reusing defect 34's bounded retry and its
`after N lookup(s)` line. The genuinely new work is the trigger: `sms.received` rides an inbound
broadcast and there is no outgoing equivalent, so this needs a `ContentObserver` on the sent
mailbox.

**Wrong fix to avoid:** enriching `sms.send`'s ack and stopping. The ack reaches only the client that
asked, so a message typed on the phone still never arrives — and the visible half being fixed is
what makes that the tempting place to stop.

### 30 — the Mac cannot start a new SMS conversation · **open, on one half only**

The SMS pane could reply into a thread the phone already knew about and could not address a number
that had none. `SmsClient.sendNew`, the compose surface (`#sms-new`, `#sms-new-to`,
`#sms-new-body`, `#sms-new-send`) and the phone-side recipient check shipped on 2026-08-31, and
**the explicit-address path is verified on hardware** — step 71: the Mac addressed `9850850263`, the
phone answered `sms.send delivered (to 1 verified recipient(s))`, and the pane opened the thread the
*phone* named rather than one it invented.

**What is still open is the half the name describes: starting a conversation that does not exist.**
`9850850263` turned out to carry thread **593** already (`message_count=2`, one message from 2021),
so the send merged into it. That was known before the send and accepted deliberately — but it means
the run exercised *merge*, not *create*.

**Fix direction: none pending in the code — what is missing is evidence.** Do not write more code
against this. Send one message from the Mac to a number that has **no** thread on this handset,
having first proved the absence: `content query --uri content://mms-sms/conversations` **and**
`content://sms` for the address, since orphaned `sms` rows can outlive a deleted conversation and a
clean conversations view alone is the lookalike. The pass is a **new** `thread_id` appearing that
was in neither read, and the pane opening it.

**Wrong fix to avoid:** letting the Mac pass a bare address into the existing `sms.send` and having
the phone trust it — the leniency defect 29 forbids. Already avoided; `sendNew` is a distinct form
in `docs/protocol.md` and the phone verifies the recipient. Recorded so it is not undone.

**Second wrong move, and this run nearly made it:** accepting a send to a number that already has a
thread as proof of thread *creation*. It succeeds, it draws, and it looks identical to a pass.

### 32 — the SMS pane cannot reach a conversation older than its first page · **closed**

50 threads, no way forward. The self-thread was only reachable during step 58 because a message sent
from the phone moved it to position 0.

**Fix direction:** paging on the thread list, the way messages already page with `before`.

**Wrong fix to avoid:** raising the page size. It moves the wall, does not remove it, and makes the
first payload larger for every user in order to hide a problem from the few with long histories.

### 33 — the phone names packages where it means apps, in sentences users read · **fixed** 2026-09-03

`applabel` resolution exists and works (`com.techmash.playo` → `Playo`, 30 resolved / 0 fell back in
one session) but is not used everywhere a package id reaches a user-visible string.

**Fix direction:** find the remaining call sites and route them through the same resolver. Defect 28
found **three** copies of this class of bug when two were expected, so enumerate rather than fix the
one you can see.

### 38 — a volume change made on the phone never reaches the Mac · **deferred, and its test note matters**

`controllerCallback` overrides `onPlaybackStateChanged`, `onMetadataChanged` and
`onSessionDestroyed`, and not `onAudioInfoChanged`. So the Mac can *set* volume and is *told* volume,
and is never told that volume changed underneath it.

**Fix direction:** override `onAudioInfoChanged` and call `pushState`, the same one line the other
three use.

**And the caveat that makes it not a one-line fix.** `MediaController.PlaybackInfo` has two types.
For `PLAYBACK_TYPE_REMOTE` the session owns its volume and the callback fires. For
`PLAYBACK_TYPE_LOCAL` — a phone playing through its own speaker — the "volume" is the device music
stream, and changing it with the hardware keys **may not fire the session callback at all**, in
which case the override is necessary and not sufficient and the local case needs an `AudioManager`
path or a `ContentObserver` on the stream volume instead.

> **Test note, to be kept intact: whoever picks this up must check
> `controller.playbackInfo.playbackType` before claiming a fix, and must test with the phone's own
> hardware volume keys — not with `volume_set` from the Mac.** `volume_set` produces a push through
> `onCommand` and would make a still-broken build look fixed. That is defect 31's exact trap: the
> feature following the Mac's own commands perfectly while being deaf to the phone.

### 39 — a message sent from the Mac is missing from the thread it was sent into · **closed**

The open thread draws one fewer message than its own header claims, and the missing one is the
message just sent. Reproduced in both of step 68's runs. Leaving the thread and reopening it draws
all of them, so nothing is lost — it is a display gap.

**Mechanism:** the send-side twin of 34's race. `submit()` re-fetches **30 ms** after the phone
reports the send, the provider has not written the row yet, the re-read answers the old count, and
nothing appends it afterwards. The note updates later from `sms.threads` and the list does not.

**Fix direction, preferred:** have `sms.send` answer with the written row — the phone knows when its
own write landed — and have the pane append it the way it appends a pushed `sms.received`. This
removes the race rather than surviving it. The alternative, giving the send path 34's bounded-lookup
retry with the same `after N lookup(s)` line, is acceptable but strictly weaker.

**Wrong fix to avoid:** a delay before the re-fetch. Same shape as 36's shipped wrong fix and as
37's rejected re-read-on-a-timer — a plausible value, a timer instead of a fact, wrong under load.

**Does not affect step 70:** different pane, different feature, different provider. Step 70 sends no
SMS and reads no SMS surface.

### 122 — every keyboard shortcut the shell advertises except ⌘K is decorative · **open** · found 2026-09-16

**Thirteen shortcut hints are drawn and one of them works.** `shell.ts`'s only `keydown` handler
matches `(metaKey || ctrlKey) && key === 'k'` and, once the palette is open, Escape / ArrowDown /
ArrowUp / Enter. There is **no application menu at all** (defect 117 recorded the same absence from
the other side), and `globalShortcut` is used exactly once in `main.ts` — for the mark diagnostic.
So every one of these is a string with nothing behind it:

| Drawn | Where | Bound to |
|---|---|---|
| `⌘1`–`⌘9`, `⌘0`, `⌘,` | `navModel.SCREENS[].shortcut`, rendered in the ⌘K palette's result rows | **nothing** |
| `⌘⇧.` *Stop mirroring*, `⌘⇧T` *Toggle always on top*, `⌘⇧4` *Take screenshot* | `navModel.COMMANDS`, the handoff's own list | **nothing** |
| `⌘K` | toolbar button and palette | `shell.ts` — **the one that works** |

`⌘⇧M` was the fourteenth and is **not** in this defect: it is fixed under defect 123, because it was
worse than unbound — it was bound to something else.

**Why this is a defect and not a cosmetic gap.** A shortcut hint is a claim, and this project's own
rule for a greyed control applies unchanged to a printed accelerator: it is a promise it might one
day light up, made in the one place a person looks to learn the app. The handoff draws these hints
deliberately — README §"Main region" lists the palette's four commands with their keys and the
eleven screens at ⌘1–⌘9 / ⌘, — so the design's intent is that they *work*, and drawing them while
they do not is the gap. It is also the shape `CLAUDE.md` calls a registration line read as an
execution line, moved into the UI: the hint is real, the binding is not, and nothing distinguishes
them from the outside.

**Fix direction:** one owner for accelerators, not two. Build the application menu Electron is
missing (`Menu.setApplicationMenu`) and hang every advertised accelerator off it, with the label and
the key read from `navModel` so the menu, the palette and the sidebar cannot disagree about what
⌘4 does — the same single-enumeration argument that put the tool rail and the global actions into
`navModel`. `globalShortcut` is the wrong instrument for all of these: it takes the key from every
other application on the machine, which is defensible for the mark (argued at `main.ts:820`) and
indefensible for ⌘4.

**Wrong fix to avoid: a `keydown` handler in `shell.ts` that switches on `event.key`.** It is the
obvious two dozen lines and it produces a second accelerator table in a second file, which is the
two-expressions-of-one-rule trap with a macOS menu bar as the other expression — and the menu bar is
the one a user discovers by looking. It also cannot reach `⌘⇧4` or anything while the mirror canvas
has focus and is forwarding keystrokes to the phone.

**Not fixed in the 2026-09-16 Overview pass, deliberately.** It is shell-wide — twelve panes, the
palette and a menu that does not exist — and the pass it was found in was scoped to one pane. Found
by reading `shell.ts` while checking the Overview hero's own `⌘⇧M` hint, which is how the bound-to-
the-wrong-thing half (123) surfaced.

---

## The four tempting wrong fixes, collected

They are listed together because they are one mistake wearing four hats, and each was reached for by
someone who had already read the rule against it.

| Where | The tempting fix | Why it is wrong |
|---|---|---|
| **36** (shipped, then removed) | ask the call log for the disposition | `call.ended` fires from the state transition; the provider row may not be written. Looks authoritative — the platform's own value — and is a race that passes in testing and fails under load. |
| **37** (rejected) | re-read the secure setting on a delay | A timer instead of a fact. The bound service *is* the fact, and it is available at the moment of the callback. |
| **39** (open — do not) | delay the composer's re-fetch | Identical shape to both of the above, on the SMS send path. |
| **34** (rejected) | make the Mac lenient about the shape it accepts | The two sides would disagree about the contract forever while appearing to work. The phone was fixed instead. |

The family resemblance: **each substitutes a plausible value for a known one.** The test is whether
the code can name the fact it is waiting for. If it can, wait for that fact; if it cannot, the fix is
in the wrong place.

### 46 — the media remote puts a raw package id in a sentence · **closed 2026-08-31**

**Fixed by `desktop/src/shared/appLabel.ts`** — one resolver, one marking convention, one
enumeration. Live in the running app, read back over CDP:

```
Paused in com.spotify.music (app name unavailable).
com.spotify.music (app name unavailable) does not allow seeking from a remote.
com.spotify.music (app name unavailable) does not allow skipping to the next track from a remote.
…                                                                        (7 strings, all marked)
Playing in Spotify.                                                       (resolved: nothing marked)
```

**Enumerating found five occurrences where the record, written from a screenshot of two, said
three — and it changed the shape of the fix.** Four are user-visible and *all four* were wrong, in
two opposite ways:

| Site | Was | Produced |
|---|---|---|
| `renderer/remote.ts` now-playing note | `appName ?? package ?? 'an app'` | "Paused in com.spotify.music." — the handle alone |
| `main/remote.ts` refusal reason | `appName ?? package ?? 'That app'` | the same, in a sentence the pane displays |
| `renderer/remote.ts` seek title | `appName ?? 'This app'` | "This app does not allow seeking…" — the handle **thrown away** |
| `renderer/remote.ts` skip title | `appName ?? 'This app'` | the same |

The last two were counted as the *correct* convention when this defect was filed. They are not:
`appName ?? 'an app'` is one of the two wrong fixes this record already named — it makes the
sentence safe and discards the only identifying information there is, so nothing tells anyone the
resolution failed. Defect 28's lesson landed a third time: **grep for every package name reaching a
string, not the ones a screenshot showed you.**

The fifth occurrence, `main/remote.ts:100`, is a **log line** and was deliberately left as a raw
package id, with a comment saying so. The rule is that a package id may appear as a machine handle,
never as the only thing a *user* reads; a rotating log file is the machine-handle case, and the
enumeration deliberately does not cover it.

**Where it lives, and why it is not a copy.** `src/shared/` is the electron-free layer, and this
seam had to be reachable from both sides of one defect — `main/remote.ts` is a module,
`renderer/remote.ts` is a plain `<script>` with no module loader. So it is written in the renderer's
plain-script shape with a `module.exports` shim: loadable by a `<script>` tag, `require`-able from
main, `require`-able from `node --test`. One implementation, three consumers.

**`notifyLabels.ts` now delegates to it** rather than holding a second copy of the same six lines —
which the compiler insisted on, since plain scripts share one global scope and two definitions of
`appLabelOf` collide rather than merely duplicate. That closes defect 28's family at every known
site with one implementation underneath.

**Proven by fixtures, shown to fail.** `shared/appLabel.test.ts` asserts over
`remoteUserVisibleStrings` — the whole enumeration — and carries a count assertion and a
discrimination control. Reintroducing `appName ?? package ?? 'an app'` and `appName ?? 'This app'`
turns three tests red; both were put back. Mac suite 112 → **120**.

**The original record follows, kept unedited because its miscount is the finding.** It was
written from what a screenshot showed and said three sites with two wrong; there were five, four of
them user-visible and all four wrong.

---



Found by running defect 28's own rule rather than by a screenshot: *grep for every package name
reaching a string, not the ones a screenshot showed you*. Defect 28 is closed and its guard is
sound; this is the same class of bug in a pane the guard does not cover.

`RemoteState.appName` is **optional on the wire** (`src/shared/protocol.ts:407`), and two call sites
fall through to the package id before they fall through to a generic:

| Site | String | With no `appName` |
|---|---|---|
| `src/renderer/remote.ts:134` | `` `${playing ? 'Playing' : 'Paused'} in ${app}.` `` | "Paused in com.spotify.music." |
| `src/main/remote.ts:185` | `` `${app} does not allow ${what} from a remote, so nothing was sent.` `` | "com.spotify.music does not allow skipping…" |

Both read `appName ?? package ?? '…'`. The package is reached **before** the generic, so a missing
label produces an id rather than "an app".

The same file disagrees with itself, which is the tell: `renderer/remote.ts:188` and `:247` write
`appName ?? 'This app'` and skip the package entirely. Three sites, one convention, two of them
wrong — the same 2-of-3 / 3-of-3 shape defect 28 had.

**Not a wrong fallback — a missing mark.** `AppLabels.of` returning the package is correct and must
not be "repaired" by inventing a name. What is missing is the other half of the rule: when the label
*is* the package, it must not be presented as though it were a name. `notifyLabels.ts` already does
this correctly — it marks `isPackageFallback`, renders the mono face with a "package id" chip, and
puts a clause in the accessible name.

**Fix direction:** one pure resolver returning `{ label, isPackageFallback }`, in `src/shared/` —
the electron-free layer, where a testable seam belongs — with both remote call sites composing a
marking clause from it rather than interpolating a bare string. Then extend the enumeration idea:
a `userVisibleStringsOf` for the remote, so the guard covers a pane instead of a line.

**Wrong fix to avoid — two of them.**

1. **Dropping the package from the fallback chain** (`appName ?? 'an app'`). It makes the sentence
   safe and throws away the only identifying information there is, so "Paused in an app" is all a
   user gets when a label fails to resolve — and nothing then tells anyone the resolution failed.
   The handle should appear; it must not appear *alone*.
2. **Copying `notifyLabels.ts` into `remote.ts`.** It is the closest working code and the wrong
   shape to duplicate: the renderer is plain `<script>` tags and `main/` is a module, so a second
   copy is the copy that does not get the next fix. That boundary is exactly why this needs a
   `src/shared/` seam and is not a three-line edit — and why it is recorded here rather than
   patched in a measurement pass.


---

## Found on 2026-08-30, before a ring was spent — 47, 48, 49

All three were found by inspection or by running a check, not by an accident. Nothing was armed and
no call was touched to establish any of them.

### 47 — **WITHDRAWN. There was never a stale card.** · **not a defect**

Filed 2026-08-30, narrowed twice, withdrawn 2026-08-31 on `dumpsys telecom` evidence. The number is
kept, and this record with it, because the reasoning failed in a way worth being able to find again.

## What it claimed

That episode `c13` never ended, that the Mac's card therefore said *Unknown number · In progress*
about a call that was over, and that nothing could clear it.

## What actually happened

`c13` was an **incoming WhatsApp video call**, answered, that ran for **67 m 47 s**. Telecom's own
analytics for the call:

```
Call e385bde0-9d12-44b5-8057-c84b7341e582: {
    startTime: 1788097496071          → 19:14:56.071   (the moment it went ACTIVE)
    endTime:   1788101562695          → 20:22:42.695
    direction: INCOMING
    isVideoCall: true
    callTerminationReason: DisconnectCause [ Code: (LOCAL) … ]
}
SelfMgd Call e385bde0… [Aug 30, 2026 7:14:41 PM](MT - incoming)
    >>>Target PhoneAccount: ComponentInfo{com.whatsapp/com.whatsapp} (WhatsApp)
CommSess{… created=Aug 30, 2026 7:14:41 PM, callId=e385bde0…, duration=4080}
```

State transitions, in the same dump: `RINGING` at 19:14:41.86, `ACTIVE` at 19:14:56.07 with audio
routed to the speaker, `DISCONNECTED` at 20:22:42.71 via `EndCallTransaction`. The phone's own
`Call c13 ended answered after 4080849ms` and telecom's 4066.6 s of active time differ by exactly
the 14.2 s of ringing, which is the two clocks agreeing.

**So the Mac's card was correct for every one of those 67 minutes.** It said a call was in progress;
a call was in progress. There was no stale card, nothing was stranded, and the "card the Mac cannot
correct" did not exist.

## Why the number never arrived, which was the other half of the puzzle

A **self-managed** call (`PROPERTY_SELF_MANAGED`, `voip=true`, target account `com.whatsapp`) is not
a cellular call. It produces `PHONE_STATE` transitions but carries no `EXTRA_INCOMING_NUMBER`, so
`shouldCorrectCard` correctly returns false and the card honestly reads `Unknown number`. That is
option 4's documented degradation working, and it is the green test *a still-blank number corrects
nothing*.

## The reasoning failure, which is the part worth keeping

The control this record leaned on — **"the platform call log has no row for c13, and a real
67-minute call writes a row"** — was promoted to the top of the section as *"the whole difference
between a defect and a long phone call"*. **It was not discriminating.** The same dump says why:

```
SamsungCallLog.Loggable { state : UNKNOWN / okayToLog : false }
```

Self-managed calls are logged by the app that owns them, not by the platform provider. So the
absence of a row separates *cellular* from *not cellular* and says nothing at all about whether a
call was real or how long it lasted — which is exactly the distinction the record used it to make.

This is the same failure the rest of `CLAUDE.md` is about, committed while writing a defect record
that cites those rules: a query that could not tell its target from a lookalike, producing a clean,
specific, confident wrong answer. The lookalike here was *a call the platform does not log*. The
right control was available the whole time and was never asked: `dumpsys telecom`, which names the
owning app, the state transitions and the duration.

## Do not resurrect it

Three revisions, each narrower — *never ends* → *67 minutes* → *withdrawn*. A defect that keeps
shrinking under evidence is usually not a defect that needs a fourth wording. **There is no observed
failure here.** The protocol asymmetry it was heading towards is real and is recorded separately
below, on its own evidence, and is not this.

### The two structural gaps, stated independently of `c13`

Both were read in source, not observed, and neither depends on anything above. They are recorded
as a **known protocol asymmetry**, not as a defect, because no instance of either has ever been
seen:

1. **The phone cannot say "no call".** `CallFeature.replayTo`
   (`sync-module/.../v2/CallFeature.kt:117-123`) sends `call.incoming` when a call is live and
   returns silently when one is not — `val live = CallWatcher.current() ?: return` at `:120`. A
   reconnecting Mac is told what *is* happening and never told what is *not*.
2. **The Mac's refresh does not reconcile.** `ipcMain.handle('call-current', …)`
   (`desktop/src/main/main.ts:733`) resolves to `calls.currentCall()`
   (`desktop/src/main/calls.ts:81-82`), which is `return this.current` — the Mac's own cache. No
   request asks the phone what is actually happening.

Together they mean that **if** a `call.ended` were ever missed, no reconnect and no refresh would
repair the card. Whether that can happen is unknown: `call.ended` fires from the IDLE transition and
every episode observed to date has produced one. Worth a paragraph in `docs/protocol.md` when the
call namespace is next revised, and worth nothing more than that until something is seen.

### 48 — two locks at two paths excluded nothing · **closed**

Two sessions independently added a step-70 arming lock within the same hour. Both were correct in
isolation and the pair was worse than either: one took `os.tmpdir()` (on macOS a per-user
`/var/folders/…` path), the other `/tmp/connectsuite-step70-watch.lock`. **Two watchers, one per
implementation, would each take "their" lock, each find it free, and both arm.** The exclusion
excluded nothing, and `CLAUDE.md`'s *"one click on `#call-reject`. Never two"* was still enforced by
nobody while appearing to be enforced twice.

This is filed with its own number rather than as a line in the exclusion's changelog because it is
not a bug in a lock — both locks worked. It is the failure mode of two agents each doing the
correct thing without a shared claim, and the only reason it was caught is that the two edits
collided in the same file. Collision is not a control; it is luck, and it is not repeatable.

**Fixed** by reconciling to one implementation at `/tmp/connectsuite-step70-watch.lock` — chosen
because it is also the path the refusal message names, and a refusal that names a path a person
cannot find is half a refusal. `--require-correction` is kept intact and unweakened. Taken with
`O_EXCL` so the check and the claim are one operation rather than a read and a write two watchers
can interleave inside; a lock whose owner is dead is stale and taken over loudly. Proven by
disabling the lock clause and watching four fixtures in `scripts/step70-exclusion.test.mjs` go red,
including `a second watcher, with the first one still alive`, then restoring it.

**The standing lesson, since the fix does not carry it:** one enforcement point per rule, at one
path. A second implementation of a mutual-exclusion rule is not redundancy, it is a second door.

### 49 — the exclusion's refusal stated a wrong number · **closed**

The CDP client count in `scripts/step70-exclusion.mjs` counted `lsof` rows and halved them, assuming
each loopback connection appears twice. It does — but **one CDP client holds two connections**, a
keep-alive socket for `GET /json` and the WebSocket, so a single attached watcher was reported as
`2 other clients are attached`.

Filed separately from 48 because a refusal that overstates its own evidence is exactly the shape
this project files, whether or not the refusal was correct: the number was wrong, it was in a
sentence a person acts on, and a check that cannot count what it is counting cannot be trusted at
the boundary where it says *pass*. It caught its own — the count was proved against live `lsof`
output rather than read, which is the only reason the inflation was visible.

**Fixed** by counting distinct pids on `ESTABLISHED` rows, excluding the listener and the caller,
with the real captured `lsof` output as a fixture and three controls: one client holding two sockets
reads as **1**, a bare listener reads as **0**, and the caller is excluded from its own count. The
live end-to-end control reads 0 with nothing attached and 1 with one attached — a check that reports
a client when there is none, and also when there is one, is not discriminating.

### 50 — the thread cursor was never honoured, because the conversations view ignores bound arguments · **closed 2026-08-31**

**Found by refusing to accept a drawn control as a working one.** Defect 32's pager rendered, the
button appeared, the button was pressed — and the list stayed at 50. It would have been very easy to
record 32 as fixed on the strength of the button existing.

`SmsStore.threads` paged with `selection = "date < ?"` and `selectionArgs = [beforeMs]`. Against
`content://mms-sms/conversations` that returns **zero rows** — no exception, no error, an empty
cursor, so the `runCatching` in `query` had nothing to log and the phone honestly reported
`0 threads, hasMore=false`.

**The reading that separated the two candidate causes**, and it is the whole method here: every
`before` value returned 0, *including one above the newest row*, which should have returned
everything. A wrong cursor value cannot do that. That moved it from "the cursor is wrong" to "the
selection never ran".

**Why it looked like a working provider.** `adb shell content query --uri … --where 'date<…'`
returns 2990 rows, and with `--sort 'date DESC'` returns the same 2990 — so the view *does* honour
selections. It does not bind `?` arguments on this URI, and the shell tool inlines its literal.
Testing through the shell and concluding the provider was fine is the lookalike that hid this.

**Fix:** inline the value — `"date < $beforeMs"`, no args. Safe **because the type makes it safe**:
`beforeMs` is a `Long?`, so no caller can put a string near it. If it ever becomes a `String` this
has to go back to a bound argument and page some other way, and there is a comment at the site
saying so.

**Verified on hardware**, which is the only place this could be verified — no unit test can see it,
because the behaviour belongs to one OEM's content provider. 50 → 89 → 126 → 158 → 183 threads
across four pages, every entry distinct, the pager never stalling.

**Fix direction if it regresses:** do not reach for a larger page size. Read the cursor's own
behaviour first — one probe with a `before` above the newest row distinguishes a dead selection
from a wrong value in a single call.

---

## Found during step 71, 2026-08-31

### 51 — the after-send retry reports a loss it does not suffer · **fixed** 2026-09-03

`pushNewestSent` has two triggers: the bounded look after our own `sms.send`
(`PROVIDER_LOOKS = 3` at `PROVIDER_LOOK_DELAY_MS = 150`, so ~300 ms) and the `ContentObserver` on
the sent mailbox that defect 44 added. On this device the after-send trigger **has never won** —
2 of 2 Mac-origin sends in step 71 — because the provider wrote the row at 1140 ms and 699 ms. The
observer carried both, ~700 ms later, and the Mac drew both messages.

Nothing is lost. What is wrong is what the phone says about it:

```
14:46:05.298 E sms.sent NOT pushed after 3 lookups following a send — the Mac's thread will be
               missing the message it just sent — 1 pushed / 1 dropped since start
14:46:06.097 I sms.sent pushed after 1 lookup(s) (provider change, row 22215) — 2 pushed / 1 dropped
```

Two faults, both already named elsewhere in this file:

1. **The `e:` line asserts an outcome it does not decide** — the thread was *not* missing the
   message, twice, and defect 39's drawn evidence in `docs/testing.md` is that same message being
   drawn. This is **defect 40** exactly, one feature over, and at `E` rather than `I`.
2. **The `dropped` counter counts deliveries.** `3 pushed / 2 dropped` reads as a two-in-five loss
   rate over a run that lost nothing. `CLAUDE.md` requires a count to carry a denominator that gives
   it meaning; here the denominator exists and is **wrong**, which manufactures a failure instead of
   hiding one — the harder version of the same mistake.

**Fix direction:** two triggers are two questions and need two counters. "Did the after-send look
find the row in time?" is a tuning fact about one optimistic path and belongs on an `i:` line with
its own found/not-found tally, saying that the observer will carry it. "Was this row ever pushed?"
is the only question whose answer is a lost message, `lastSentId` already holds it, and the `e:`
line belongs there — raised when a row has been seen by no trigger, not when one of two was slow.

**Wrong fix to avoid:** raising `PROVIDER_LOOKS` or `PROVIDER_LOOK_DELAY_MS` until the after-send
path wins. That is the delay-before-re-read shape this project has now rejected five times (36
shipped it, 37 declined it, 39 named it, the `sms.sent` design refused it, and here it is again
wearing a retry budget). It substitutes a plausible value tuned to one device's provider latency for
a fact the code already has. **The message already arrives — the reporting is what is broken**, and
tuning the timer would make the misleading line rarer without making it true.

**Not user-visible, and it does not reopen 39 or 44**, both of which are closed on drawn evidence.
It is a defect in the evidence the next person reads.

**Swept for elsewhere, 2026-08-31 — see the section at the end of this file.** Two more instances:
**52** (`VideoChannel.dropped`, three triggers and one of them uncounted) and **53** (`calls.ts`,
two of four refusals silent). Neither is fixed and neither is this sitting's work; 51's own code is
untouched.

---

## The sweep 51 asked for, 2026-08-31 — and what it found

51 is defect 40's shape one feature over, and twice is a pattern rather than a coincidence, so
**every counter in the repo was enumerated** rather than the two already known being fixed. That is
the practical half of the rule 28 wrote: grep for all of them, not the ones a screenshot showed you.

**Method, and its control.** Every `++`, `+= 1` and `incrementAndGet()` on a field in both trees —
33 sites on the phone, 29 on the Mac. Each was read for two things: how many distinct causes reach
it, and whether every cause leaves a line that says which one it was. The control is the negative:
`AppLabels` (`resolved` / `fellBack`) and `CallWatcher` (`broadcastsWithNumber` /
`broadcastsWithoutNumber`, `episodes` / `episodesWithNumber`) already split exactly this way, so the
sweep can tell a conflated counter from a correctly split one, and returned both answers.

**Cleared, and why.** The `delivered` / `refused` pairs in `CallFeature`, `ContactsFeature`,
`RemoteFeature`, `NotificationFeature`, `SmsFeature` and `InputFeature` are each fed from more than
one site, but they answer **one** question — "was this request answered or declined" — and every
line names the request type or action, so the aggregate decomposes in the log. `sms.ts` reaches
`refused` from seven places and all seven carry a distinct sentence; `remote.ts` from three, same.
Multiple call sites are not the defect. **A cause the number cannot be separated into is.**

Two survived.

### 52 — one `dropped` counter for three different things, one of which never reaches it · **fixed** 2026-09-03

`VideoChannel` (`mirror-module/.../v2/VideoChannel.kt`) drops frames for three reasons and has one
counter:

| Trigger | Line | What it means | Counted? |
|---|---|---|---|
| A stale P-frame evicted to make room | `:58` | the Mac is briefly behind; the queue is doing its job | `dropped++` |
| The queue holds only keyframes and config, so the **newcomer** is dropped | `:64` | the Mac is badly behind and the mirror is visibly stalling | `dropped++` |
| The frame is larger than `Link.MAX_FRAME` and is refused by the writer | `:95` | the **encoder** produced something impossible — a correctness fault, not congestion | **nothing** |

The first two are the ones 51 describes: two questions sharing an answer. Evicting a P-frame is the
design working, and shedding the newest frame because nothing sheddable is left is the design out of
room; a run of 120 of the first and a run of 120 of the second are the same number and want opposite
responses.

The third is worse than conflated, it is **absent**. An over-size frame is dropped with a `w:` line
and no increment, so it appears in neither `droppedCount()` nor the `droppedFrames` field
`mirror.stats` puts on the wire (`MirrorEngine.kt:1242`) — the one place a Mac could see it. The
only channel-level correctness fault the mirror has is invisible to the mirror's own statistics.

**And the reporting line asserts a cause it does not decide, which is defect 40 exactly, third
instance.** `MirrorEngine.kt:235` fires `Dropped $dropped frames; the Mac is behind` every 60
drops — a sentence that is a fair guess for trigger 1, an understatement for trigger 2, and simply
wrong for trigger 3, where the Mac is not behind and never saw the frame. It also carries no
denominator, while the same numbers *do* get one on the wire: `mirror.stats` publishes
`encodedFrames` beside `droppedFrames`. So the rule is kept where a machine reads it and broken
where a person does, which is backwards.

**Fix direction:** three counters, named for their causes — `evicted`, `shedNewest`, `oversize` —
and `droppedCount()` returns their sum so the wire field keeps its meaning. The `MirrorEngine` line
states the split and the denominator instead of a cause: `dropped N of M encoded (E evicted, S shed,
O over-size)`. `oversize` is the one that should log at `w:` on its own, because it cannot be caused
by a slow link.

**Wrong fix to avoid:** raising `QUEUE_DEPTH` so the counter moves less. That is the retry-budget
shape 51 warns about, wearing a queue: it makes a misleading number rarer without making it true,
and it trades a brief stutter for growing latency, which the class comment already argues against at
length. Also do not "fix" trigger 3 by raising `MAX_FRAME` — a frame past 8 MB is an encoder fault
and the refusal is correct.

**Disposition: fix on the next touch of the mirror, not deferred** — set 2026-08-31, and the
distinction is deliberate. **Deferred** in this register means *open and deliberately not this
sitting's work*, which is where 17, 33 and 38 sit and where they may sit indefinitely. This one is
not that. It is not scheduled for its own sitting either, because it is a reporting fault behind a
feature that is closed and working. It is **owed by whoever next opens `mirror-module` for any
reason** — a Phase 6 reliability change, a codec change, anything — and it is small enough that
opening the file and not fixing it is the more expensive choice.

**And within it, trigger 3 is the half that matters.** Triggers 1 and 2 are conflated, which is
51's shape and is a legibility fault: the number is real and cannot be decomposed. Trigger 3 is
**absent**, which is worse and is a different fault. The mirror's only channel-level *correctness*
event — the encoder produced a frame the wire cannot carry — increments nothing, so it is missing
from `droppedCount()` and therefore from `droppedFrames` in `mirror.stats`, the one field through
which a Mac could ever see it. A fault that never reaches a counter cannot be noticed, cannot be
trended, and cannot be told from never having happened. That is the same shape as defect 18's 187
refusals with no success count and as the empty accessibility tree: a reading that looks like an
answer and is the absence of one.

So the order inside the fix is fixed too: **`oversize` gets its own counter first**, and it earns a
`w:` line of its own because it cannot be caused by a slow link. Splitting `evicted` from
`shedNewest` is the second half and can follow in the same edit, but if only one thing is done, it
is not that one.

### 53 — two of the Mac's four call refusals move the counter without leaving a line · **fixed** 2026-09-03

`desktop/src/main/calls.ts` increments `refused` from four places. Two log a sentence naming the
cause (`:174` no call is showing, `:196` refused by the phone for a live call). Two do not:

- `:217` — `dial` with an empty number. Refused locally, counter moved, nothing logged.
- `:232` — `dial` refused **by the phone**. Counter moved, nothing logged; the reason is returned to
  the caller and then only rendered.

The tally in the log therefore says `N refused` where some unknown part of `N` has no line anywhere
above it. It is the same fault as 51 read from the other end: 51's number is wrong about what it
counted, this one is silent about it. Both leave a reader unable to decompose the figure, which is
what the counter is for.

Milder than 52 — nothing here asserts a false cause, and a dial refusal does reach the user's screen
— but it is the same family and was found by the same sweep, so it is recorded rather than folded
into 52.

**Fix direction:** give both sites the `log.warn('calls', … — ${this.tally()})` line the other two
have, naming the cause: `dial refused here: no number was given` and `call.dial refused by the
phone: ${result.reason}`. No new counter is needed; the four causes are one question ("a call action
did not happen") and the lines are what decompose it.

**Wrong fix to avoid:** splitting `refused` into four counters. That is the opposite error and 52 is
the reason it is worth naming — 52's triggers are different *questions* about the mirror's health,
so they need different numbers; these four are one question with four reasons, so they need
different *lines*. The test is whether two causes want opposite responses, not whether they arrive
from different call sites.

### 57 — `media.thumb` calls a failed render a missing photo · **fixed 2026-09-03**

`MediaStoreReader.thumbs` maps every id to one of three answers: a JPEG, `BAD_REQUEST` when the id
is not a number, and `NOT_FOUND` for **everything else**. That last branch is reached by
`loadThumbnail` returning null or throwing, which it does for a row that has been deleted *and* for
a row that is still there and cannot be decoded — a truncated download, a codec the device has no
decoder for, a file whose bytes were replaced underneath its `MediaStore` entry.

The two want different sentences. "That photo is no longer on the phone" is a claim about the user's
library, and this code cannot support it: the pane is told a photograph was deleted on the strength
of a decoder failing. `fs.thumb` was specified two days later with `NO_THUMBNAIL` separate from
`NOT_FOUND` for exactly this reason, and it names it in `docs/protocol.md` — so the older namespace
is the less honest one, which is the wrong way round.

Found by reading the handler against the spec while `media.*` was migrated into the contract, not by
a failure: nothing on this device has produced an undecodable row. The consequence is bounded — the
Mac drops errored ids into a `missing` set and stops asking, which is the right behaviour for both
causes — so this is a **reporting** defect, and it is recorded rather than fixed in the same sitting
because the fix touches the phone and the phone is not attached.

**Fix direction:** on the failure path only, ask whether the row still exists — one `_ID` count
against the same collection — and answer `NOT_FOUND` when it does not, `NO_THUMBNAIL` when it does.
`NO_THUMBNAIL` needs no new code: `fs.thumb` already carries it and the Mac already renders it as a
tile with no image rather than as a deletion. Log the three outcomes on one line — `made /
no-thumbnail / gone` — because "4 failed" with no decomposition is what made this invisible in the
first place.

**Wrong fix to avoid:** two of them. Answering `NO_THUMBNAIL` for the whole branch just moves the
false claim to the other side and hides real deletions from a pane that uses this to prune. And
verifying existence on the **success** path — every thumbnail paying for a second query so that an
error message can be better — doubles the cost of the common case for the rare one; the extra query
belongs on the branch that has already failed and is already off the fast path.

---

### 60 — the link did not come back after a reboot · **fixed**, boot half unproven

`RECEIVE_BOOT_COMPLETED` was declared in `app/src/main/AndroidManifest.xml` and nothing received it.

The control, because an empty grep is not a finding: the whole project declared **two** `<receiver>`
elements, both in `sync-module/src/main/AndroidManifest.xml`, and neither carried a `BOOT_COMPLETED`
intent-filter. So the absence was enumerated rather than searched for. That enumeration is a test
now — `BootAutoStartTest` parses every `AndroidManifest.xml` in the tree and asserts, with its own
control that the walk found the receivers already known to exist.

**What was built**, 2026-09-02: `core/.../link/LinkBootReceiver.kt`, taking `BOOT_COMPLETED`,
`QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED`, gated on there being a paired device and failing open
on a trust-store read that errors or times out. `LinkService` now learns *why* it was started and
picks its foreground types from that.

**Three things the fix is careful about, and each one came from a reading rather than a habit:**

1. **A boot start claims `connectedDevice` only, never `dataSync`.**
   `FGS_BOOT_COMPLETED_RESTRICTIONS` is live for this package on this device — read from
   `dumpsys platform_compat`, with the control that the same dump prints `disabled` explicitly on
   changes that are off and prints nothing of the sort on ours. *Which* types it denies is not
   readable anywhere and `dataSync` is on the documented denial list, so the code is written so the
   unmeasured half cannot matter.
2. **`QUICKBOOT_POWERON` is not a protected broadcast on this handset** — `am broadcast` returns
   `result=0` where `BOOT_COMPLETED` returns a `SecurityException` from the same shell. That is why
   the receiver is `exported="false"`, and it is a measurement rather than the sentence the old fix
   direction told the next person to verify.
3. **The success measured on 2026-09-02 was granted under `PROC_STATE_BFGS`, not under the battery
   allowlist** (`dumpsys activity services`, `infoAllowStartForeground … code:PROC_STATE_BFGS`). The
   process was already bound-foreground because the notification listener had been rebound 200 ms
   earlier. So the run is conditional on this app holding that grant, and says nothing about a phone
   where it is off. The brief's §0 predicted the allowlist would be the contaminant; it was not, and
   only asking the platform which reason it used could tell.

**The restart happened on 2026-09-02, and it answered less than it appears to.** The receiver fired
— the genuinely unknown part, since `BOOT_COMPLETED` is protected, delivery on an FBE device waits
for first unlock, and a stopped app receives nothing — and `scripts/link-up.sh` returned three OKs
with nothing tapped. But the branch it took was `already listening — nothing to do`, because the
notification-listener rebind had started the service 3.9 seconds earlier. **The boot path has still
never started anything.** That is defect 64. This row is closed for the question it was filed for:
the receiver exists, is registered, and executes.

**Two things about the pass criterion, both worth carrying forward.** It was written in
`docs/RESUME.md` as *"a `[boot] BOOT:` line"* — the tag is `autostart`, and no such string is ever
written, so a grep for it returns zero on a perfectly healthy boot. And the first attempt to read it
ran against `com.connectsuite.app`, which is not this app's package on any device: `run-as` failed
and the grep returned `0` with nothing an eye would catch. **A pass criterion naming a string the
code does not write is a test that can only fail**, and either reading would have been recorded as
the boot path being broken. The control that caught it was the cheap one — confirm the log has *any*
lines before believing a grep that finds none.

**And one thing the fix does not claim.** On this FBE device with a secure lock screen,
`BOOT_COMPLETED` arrives after the **first unlock**, because the Room trust store the receiver reads
is credential-encrypted. The honest sentence is *"the link returns when you first unlock the phone
after a restart"*. Direct-boot awareness would mean moving the trust store out from behind the lock
screen, which is a security trade this phase is not making.

**Wrong fix avoided, recorded because it was tempting:** `START_STICKY` is not the answer and was
already set (`LinkService.kt`); it governs a killed service in a running system, not a boot.

---

### 61 — the wake lock is never re-armed · **closed** 2026-09-02

`LinkService.acquireLocks()` creates the lock behind `if (wakeLock == null)` and acquires it with a
12-hour timeout. The field's own comment says *"Re-armed on every state change"*; the code returns
early on every state change after the first, because the field is no longer null. When the platform
times the lock out, `isHeld` goes false, the field stays non-null, and nothing re-acquires it until
the next disconnect.

Currently unreachable, and the reason is the interesting part: it needs one connection held for
twelve hours, and the longest hold in this device's history buffer is 31 minutes. The defect is
hidden by the link's instability, and Phase 6 is the phase that removes the hiding place.

**Fixed as directed**, 2026-09-02 — re-acquire on `!isHeld` rather than on `== null`, driven from a timer the
service owns rather than from a state change — **and then corrected the same day, because that was
half the fix.** Re-acquiring on `!isHeld` *repairs* a lapse; it does not prevent one. The ticker's
phase is unrelated to the acquire, so a tick at T+59 that finds the lock held does nothing, the
platform drops it at T+60, and the next tick is T+79. `scripts/link-night-watch.sh` measured a
**59m49s** continuous hold — eleven seconds short of the timeout — which is that gap about to open,
and the only reason it had not is that the link drops often enough to reset the cycle first, which is
the hiding place this phase exists to remove. A tick on a held lock now calls `acquire` again, which
on a non-reference-counted lock re-arms the timeout. The assertion changed with it: `2 × interval <
timeout`, because *"do enough ticks fit"* was the repair's question and *"does a dropped tick still
land inside"* is the refresh's — a quietly healthy connection emits no state changes
for hours, which is precisely the case that breaks. Shorten the timeout so a missed release lapses in
about an hour rather than half a day. The invariant that a later tuning edit will silently break is
`re-arm interval < timeout, with margin`; that belongs in an assertion, not a comment, since a
comment is what failed here.

**Wrong fix to avoid:** dropping the timeout and holding indefinitely. The timeout is the backstop
against a missed release path, and this project has already shipped a capture session that outlived
its consumer — the same mistake with the battery attached.

---

### 62 — a crash leaves the phone alive, granted, and serverless · **closed** 2026-09-02

After a process death with kill reason `(adj 0): crash`, `START_STICKY` did not restart
`LinkService`. The process returned ten seconds later, started for `NotificationMirrorService`; every
feature installed, every capability went green, and no port was bound.

Third route to the `adb install -r` serverless state, and the cheapest: it needs only a crash.
Silent on both sides.

**Fixed as directed**, 2026-09-02 — `LinkService` starts from `onListenerConnected`, gated on a paired device the way
`LinkBootReceiver` is, with its own start reason so the route shows up in the log. What makes this
sound rather than hopeful is Slice 1's measurement: the `install -r` start was granted under
`PROC_STATE_BFGS`, which is the procstate a bound notification listener *is*, so the background
foreground-service start is permitted for a reason read off this device rather than assumed.

**Wrong fix to avoid:** a `JobScheduler`/`AlarmManager` watchdog polling for a dead service. It buys
a permanent background job and a fresh failure mode under exactly the battery restrictions this phase
is about. And the listener rebind must not be sold as a general answer — a phone with that grant off
gets nothing from it, and that limit belongs in the record rather than in a surprise.

---

### 63 — the onboarding security note describes a pairing flow this app does not have · **closed 2026-09-02**

`OnboardingScreen.kt`, third page: *"Devices are paired by confirming a key on both screens, and
every connection after that is checked against it. An unpaired device is refused without asking you
anything."*

The Mac draws a QR, the phone scans it, the fingerprint inside is pinned. There is no confirmation
step on the Mac and no key shown on the phone. The sentence describes a numeric-comparison flow —
the shape KDE Connect uses, which this project studied for its trust model and did not copy — and a
user who reads it will wait for something that never appears.

The second clause is accurate and should survive.

**Fix direction:** replace the first clause with what happens — *"Pairing is a code you scan once.
The certificate behind it is pinned, and every connection after that is checked against it — an
unpaired device is refused without asking you anything."* One string. The real risk is that the
other three onboarding pages make claims of the same kind and nobody has read them against the
implementation either, so the fix is a pass over all four rather than a patch to the one that was
found.

**Wrong fix to avoid:** deleting the card. The security model is why this app has no account and no
server and it is worth saying; the fault is that this card describes somebody else's implementation
of it.

---

### 64 — the boot path fired into a state it was not built for, and reported success · **closed** 2026-09-03

The 2026-09-02 restart, in the order it happened:

```
12:41:04.355 I [autostart] LISTENER_REBIND: 1 paired device(s), link not running — starting LinkService
12:41:04.468 I [service]   Foreground as LISTENER_REBIND, types=0x10
12:41:04.504 I [server]    Listening on 42501/42502/42503, 1 paired device(s)
12:41:08.218 I [autostart] BOOT: already listening — nothing to do
```

`LinkBootReceiver` received `BOOT_COMPLETED` and `LinkAutoStart.ensureRunning` ran — both genuinely
unknown before this reading, and both now established. It then took the early-return branch, because
`LinkController.peek()?.state?.value?.running` was already true.

**So `startOrLog` has never been reached with `LinkStartReason.BOOT`.** Everything the fix reasons
carefully about downstream of that call is untested by this run:

- `foregroundTypesFor(BOOT)` returning `connectedDevice` **only** — chosen narrow precisely because
  `FGS_BOOT_COMPLETED_RESTRICTIONS` is live for this package and the denial set is readable nowhere.
  It has never been claimed at boot.
- whether a `startForegroundService` from a boot broadcast is permitted at all here. The 2026-09-02
  success was granted under `PROC_STATE_BFGS` — a procstate the app held because the listener had
  *just* been rebound. A cold boot start may not have it.

**Why this is not simply "the other fix got there first".** The notification listener is enabled on
this device and rebinds within seconds of boot. If that ordering is reliable, the BOOT branch is
**structurally unreachable in this configuration** — not dead code (revoke the listener grant and it
becomes the only route) but code whose activation requires a state this phone is never in. A fix
that can only be observed in a configuration nobody runs is a fix nobody has verified.

**Fix direction:** do not chase the race. The reading that settles it is a boot with the
notification-listener grant revoked, which makes `LISTENER_REBIND` impossible and leaves `BOOT` as
the only route — one restart plus one grant toggle, exercising the exact path the compat change
governs. Failing that, `LinkAutoStart` can log *which reason got there first* when it declines to
act, so the ordering is visible in the log rather than inferred from timestamps.

**Wrong fix to avoid:** delaying the listener rebind, or making `BOOT` force a restart of a healthy
service, so the boot path can be seen to run. That breaks a working link to observe an unproven one,
and the early return is correct — the listener genuinely does rebind on an ordinary grant toggle
while the link is fine.

**The general form, and the reason this is a record rather than a note.** *A fix verified only at
the moment it fires is not verified against the state it was meant to prevent.* Second time in two
days on this project, and the first was sharper: defect 61's first version re-acquired the wake lock
only on `!isHeld`, which **repairs a lapse rather than preventing one**, and the overnight run caught
it at a 59m49s hold against a 60-minute timeout — eleven seconds from the gap opening. Both were
correct code. Both were exercised in a state that could not distinguish them from the broken version:

| | The state it was meant to prevent | The state it was observed in |
|---|---|---|
| defect 61, first fix | a lock that has lapsed and left a gap | a lock about to lapse, repaired in time by accident of sampling |
| defect 60, boot half | a phone that boots with nothing listening | a phone already listening when the branch ran |

So, before recording any fix as proven: **what state was the machine in when this ran, and is it the
state the defect describes?** A green reading taken in the wrong state is not weak evidence, it is
evidence about something else.

---

### 65 — two deleted features were still being taught to new users · **closed** 2026-09-02

Found by doing what defect 63's fix direction actually asked for — *"a pass over all four
[onboarding] pages rather than a patch to the one that was found"* — and the pass found more than
the report did.

**Page 1**, the Mirror feature card: *"See and control another Android device's screen from here.
No root; the target needs debugging enabled once."*

**Page 3** in its entirety, three numbered steps:

1. *"On the target device: Settings → About phone → tap Build number seven times."*
2. *"Settings → System → Developer options → turn on Wireless debugging."*
3. *"Plug it into a computer once and run `adb tcpip 5555`. You can unplug immediately afterwards."*

Both describe the **v1 ADB mirror, deleted on 2026-08-26** with its `LEGACY_ADB_MIRROR` flag and the
`:mirror-server` dex module. Mirror v2 is `MediaProjection`: it sends *this phone's* screen *to the
Mac*, and needs no permission, no developer options and no second device. The copy was not merely
stale — it walked a new user through configuring a security-sensitive setting for software that is
not in the build.

`adb tcpip 5555` survived in **exactly one place in this repository**, and it was a sentence shown to
users. The control for that claim is an enumeration rather than a grep for an absence: searching
`app/`, `core/`, `sync-module/`, `mirror-module/`, `input-module/` and `desktop/src` for `tcpip`
returns one line, in `OnboardingScreen.kt`. `README.md` carried the same instructions in three more
places — Module 2's architecture, the limitations list, and two troubleshooting rows.

**Why nothing caught it.** The `app/` module had **no test source set at all**. The project's 332
tests could not see a single string in the onboarding flow, and there was no mechanism by which this
could have been found other than a person reading the pages.

**The fix, and the shape that makes it checkable.** Copy moved to `OnboardingCopy.kt`; the screen
renders from that enumeration and holds no literals of its own. *"Is this sentence true"* is not
testable; *"does this sentence name a mechanism this app does not have"* is. `forbiddenMechanisms`
lists seven — `adb`, `tcpip`, `wireless debugging`, `developer options`, `build number`, mirroring
another device, and the key-comparison pairing of defect 63 — each carrying the decision it comes
from, because a guard that fails with *"forbidden pattern matched"* teaches the next person to
delete the pattern.

**The drift guard is the half that matters.** `OnboardingCopyTest` scans `OnboardingScreen.kt` for
prose literals and fails on any not in the copy object — otherwise the enumeration is a list the
drawing code need not use, which is the `icons.ts` failure in `CLAUDE.md` whose first guard
enumerated only the sidebar and the dock and **passed with `capture` deleted**. That scanner carries
its own control: a test asserting it finds dozens of literals in a file known to be full of them,
plus a planted stray it must flag. An empty scan must mean *no strays*, never *the scanner is
broken*.

Shown red under 7 mutations: defect 63's sentence restored verbatim, the `adb tcpip` step restored,
the mirror-another-device claim restored, a stray sentence written inline in the screen, the `adb`
pattern deleted from the rule, pairing moved off the end of the flow, and the literal scanner's own
threshold broken.

**Wrong fix to avoid:** patching the one reported sentence. It was the smallest of the three.

---

### 66 — the phone could see the refusal and never said so · **closed** 2026-09-02, not yet on hardware

`LinkTls.checkClientTrusted` has written `Rejected unpaired client …` since Phase 1. The Mac tab
rendered one sentence — *"Listening for your Mac"* — for all of:

- the Mac has not dialled yet (normal, a second or two),
- the Mac dialled and the handshake was refused,
- the Mac is on a different network and never will dial.

§3.2 of `docs/phase-7-pairing-flow.md`, and the mirror image of the Mac's J1/J2 problem — except
that this one needs **no protocol change**, because the phone can already see its own accept loop,
and that **the phone's screen is the one the user is holding.**

**What was built:** `LinkState` gained `listeningSinceMillis` and `lastRefusal`; the control accept
loop publishes a `RefusedConnection` (address plus a 23-character key prefix, matching what the log
already writes) beside the line it was already logging. The decision about what to *say* is
`LinkWaitStatus.of` — pure, in `core/`, with `nowMillis` injected so the twenty-second rule is
tested without waiting twenty seconds.

**Three things it deliberately does not claim.**

- **It cannot separate J6 from J2.** A Mac on the wrong network and a Mac still searching are both
  silence on the accept loop, and no reading on this device distinguishes them. So the copy is
  conditional — *"if it stays like this, check that your Mac is awake and on the same Wi-Fi"* — and
  the test asserts that wording, because *"your Mac is on a different network"* would be a coin flip
  rendered as a fact. That is the folder-picker rule: when the platform returns one result for two
  intents, nothing may be explained afterwards.
- **A null start time withholds the hint** rather than assuming a long wait. Not knowing how long we
  have waited is not evidence that we have waited a long time.
- **A refusal expires** after 60 s. It is an event, not a state; left standing it would accuse a
  stranger who connected once, an hour ago, of being the reason nothing is happening now.

**Why the decision is not a `when` inside the composable.** `CLAUDE.md`'s `showsState` record: the
same condition was got wrong in slice 7 and again in slice 9, in a renderer file no test could
reach, and *"four tests went red on the mutation and none of them touches the thing that broke"*.
`LinkWaitStatusTest` has 11 tests and was shown red under 6 mutations — the threshold inverted, the
refusal never expiring, the refusal checked after the clock, an unknown start time treated as a long
wait, `Connected` no longer beating `Refused`, and the hint dropping the word Wi-Fi.

**The refusal counter carries its denominator.** `LinkLog` now writes `N refused / M accepted since
start`, because 187 refusals with no success count was indistinguishable from a user misclicking
until the denominator turned out to be zero.

**Status: built, unit-tested, and not yet seen on hardware.** The device left the USB bus before the
build could be installed. The install on the phone (13:01, 2026-09-02) carries defects 63 and 65
only.

---

### 67 — the wait clock measured the server's uptime, not the wait · **closed** 2026-09-02

Found the first time F4 was put on a screen, which is the only reason it was found at all.

The Mac app was stopped and the phone's card sampled every few seconds, expecting the network hint
to be absent for twenty seconds and then appear. It was present at **t+2s**:

```
t+  2s  'Listening for your Mac'   hint=Nothing has connected yet. If it stays like this…
t+  9s  'Listening for your Mac'   hint=…
t+ 38s  'Listening for your Mac'   hint=…
```

The log said why:

```
13:29:56  [server]  Listening on 42501/42502/42503, 1 paired device(s)
13:45:04  [control] Session with Chetans-MacBook-Pro ended: peer closed the connection
```

Fifteen minutes apart. `LinkWaitStatus.of` compared `now` against `listeningSinceMillis`, which was
written **once**, when the accept loops came up, and never again. So the elapsed time it measured was
the server's uptime. On any phone that had been listening for more than twenty seconds — every phone,
after the first half minute — the `showNetworkHint = false` branch was **unreachable**, and closing a
laptop lid produced *"check that your Mac is awake and on the same Wi-Fi"* before the socket had
finished closing.

**The field name is the bug, stated in one word.** `listeningSince` is a fact about the server;
`waitingSince` is a fact about the wait. The code, the tests and the reasoning all used the first
where they meant the second, and nothing in any of the three could see the difference.

#### Eleven passing tests, none of which could have caught it

This is the part worth keeping. `LinkWaitStatusTest` had eleven tests, six mutations, and covered
both sides of the twenty-second boundary. Every one of them was green while the feature was broken in
the field, and they were not weak tests — they call the real decision function rather than restating
it, which is the failure `CLAUDE.md` warns about in `MediaPayloadsTest`.

They were green because **they supply the input the product gets wrong**:

```kotlin
private fun listening(sinceAgo: Long = 0L, …) = LinkState(
    …,
    listeningSinceMillis = t0 - sinceAgo,      // ← the test decides what this means
)
```

`of()` was correct the whole time. Given a wait that began three seconds ago it withholds the hint,
exactly as asserted. **The defect was in the transition that writes the field**, and a pure function
handed hand-made inputs cannot observe whether anything in the product ever produces them.

So this is a third variety of untestable-by-construction, alongside the two `CLAUDE.md` already
carries:

| Failure | The test's relationship to the rule |
|---|---|
| `MediaPayloadsTest`, first version | restated the rule, so deleting the real one left it green |
| `showsState` | the rule lived in a renderer no test could reach |
| **this** | **called the rule correctly, at a layer the defect was not in** |

The third is the least visible, because the test looks exemplary: it names the behaviour, it calls
the production function, it covers the boundary in both directions, and it goes red under six
mutations of the decision. None of that touches the write.

**And the first attempt at a fix reproduced the mistake.** Two tests were added asserting that a
two-second-old wait carries no hint however long the phone has been up — then the actual bug was
mutated back in, and the suite stayed **green**. Both new tests still supplied the field by hand.
That mutation run is what forced the real fix.

#### The fix: a named transition, where a test can reach it

`LinkState.afterSessionEnded(peerName, closeReason, nowMillis)` and
`LinkState.afterListeningStarted(nowMillis)` are now functions on the state, called by `LinkServer`
and callable by a JVM test. The clock restarts when the **last** client leaves — with a second Mac
still connected there is no silence to time.

Three mutations, each red on exactly one test, and each was green before the extraction:

```
the original bug: clock never restarts       RED: the disconnect transition restarts the clock
clock restarts with a Mac still connected    RED: a second Mac still connected means no wait to time
listening start no longer clears the refusal RED: starting to listen begins a fresh wait…
```

16 tests now.

#### Re-measured on hardware, which is where it was found

Mac reconnected, then dropped, sampling the card every ~6 s:

```
t+  2s  'Listening for your Mac'   hint=absent
t+  8s  'Listening for your Mac'   hint=absent
t+ 14s  'Listening for your Mac'   hint=absent
t+ 21s  'Listening for your Mac'   hint=absent
t+ 27s  'Listening for your Mac'   hint=SHOWN
```

**The instrument's own bound, reported rather than elided:** the sample interval is ~6 s, so this run
establishes the hint is absent through t+21s and present by t+27s. It does **not** establish that it
fires at exactly 20 s, and nothing here should be read as saying so.

#### The rule

**A pure decision function proves the decision. It proves nothing about whether the product ever
puts the machine into the state the decision is about.** When a defect is about *when* something
becomes true rather than *what* is said about it, the test has to reach the transition — and if the
transition lives somewhere a test cannot go, that is the thing to fix, before writing any more tests
about the decision.

The tell that this class is present: **every test constructs its input by hand.** That is normal and
usually fine, and it is exactly what makes the layer confusion invisible — the test's inputs are
always well-formed, so the question *does anything real produce these?* never comes up.

---

### 68 — the target device was never checked, and an absence had already said so · **closed** 2026-09-02

A signed release APK, built to close defect 13, was issued at a phone that was not the phone.

```
$ adb install app/build/outputs/apk/release/app-release.apk
Failure [INSTALL_FAILED_OLDER_SDK: Requires newer sdk version #29 (current version is #28)]

$ adb devices -l
N7FQS4956LFYUCMJ  device  product:CPH1859 model:CPH1859      ← an OPPO, Android 9
```

Every hardware reading in this repository is from one **Samsung SM-S938B**, serial `RZCY12330DT`
(`docs/single-device-audit.md`). That phone was not attached. `adb install` with a single device on
the bus targets it silently, so the command was correct, unambiguous, and aimed at a stranger's
handset.

**What stopped it was not a check.** `minSdk 29` against an SDK 28 device is a parse failure, and it
is the only reason nothing was written. Had the OPPO been running Android 10 the install would have
succeeded and this would read very differently.

#### The absence that had already reported it

Two commands before the install:

```
$ adb shell pm list packages | grep -i "chetan.connectsuite"
(nothing)
```

`com.chetan.connectsuite.debug` had been installed on the target twenty minutes earlier. An empty
result was **impossible** on the right phone. It was read as a bad grep pattern and moved past.

That is `CLAUDE.md`'s lookalike rule with the target swapped rather than the query — *what else
would produce this absence?* was never asked, and the answer was "you are looking at a different
machine". The rule's own worked examples are all about a query that cannot separate its target from
a lookalike; this is the case where **the query was fine and the object under it had changed**, which
no amount of care about the query catches.

The second tell, ignored in the same breath: the same command earlier in the session had returned
packages *and* a `SecurityException` about user 150, so the shape of its output was already known.

#### The fix

`scripts/target-device.sh` pins **serial and model**, refuses when the expected device is absent,
prints what is attached instead, and emits `-s <serial>` for callers so an install can never be
ambiguous. It prints the target to stderr on success too, so every transcript that writes to a
device carries the device in it.

**It was tested in all three directions**, because a guard only ever seen refusing is half a guard:

```
wrong device attached            → FAIL, and lists the OPPO
pointed at the device present    → OK    target N7FQS4956LFYUCMJ (CPH1859, sdk 28)
right serial, wrong model        → FAIL  reports model 'CPH1859', expected 'SM-S938B'
```

The middle line is the one that matters. The first version's "attached instead" list printed
**nothing**, because `adb devices -l` separates with spaces and the pattern looked for a tab — a
guard that refuses correctly while its diagnostic silently produces an empty list, which is the
empty-accessibility-query failure inside the fix for a different empty-result failure.

**Wrong fix to avoid:** setting `ANDROID_SERIAL` in a shell profile and considering it handled. It
is invisible at the call site, it does not survive a new terminal, and it produces the same silent
targeting with a different default. The check has to be *in the path of the command that writes*.

#### And the release APK is signed, which is the other half of the run

`app-release.apk` — not `-unsigned` — built from `~/.android-keystores/connectsuite.properties`,
outside the repository, with the build printing which config it used. `apksigner verify` passes with
a control that proves the verifier can fail (one flipped byte → exit 1). v1 and v2 report `false`
and that is correct rather than a fault: AGP omits them because `minSdk 29` makes v3 sufficient, so
the `enableV1Signing` comment about "API < 24 installs" now describes a case this app cannot have.

**Defect 13 is not closed by this run.** The APK is signed and verified; it has never been installed
on the device this project's claims are about.

---

### 69 — the permission page names the wrong one of two discovery paths · **fixed** 2026-09-03

Onboarding page 2 is titled **"Finding your Mac"** and its subtitle reads *"Two permissions, so this
phone can see your Mac on the network"*. The card underneath says:

> ConnectSuite needs this to find other devices over **Wi-Fi Direct**. On Android 12 and below the
> system reports nearby Wi-Fi peers through the location permission — no location is ever collected
> or sent anywhere.

**Wi-Fi Direct is not how the Mac is found.** The only consumer of `WifiP2p` in the tree is
`core/discovery/WifiDirectDiscovery.kt`, which belongs to the **v1 Sync** feature. The v2 link is
mDNS (`NsdAdvertiser`) plus the Mac's gateway and last-known-IP probes, and the *Mac dials the
phone* — locked decision #2.

**This is defect 63 wearing a different hat, and I put it there.** 63 was *a true sentence about the
wrong one of two paths*; the rationale string is unchanged and was accurate when the page was titled
"Finding your devices". Retitling it to "Finding your Mac" — part of F1 — made a correct sentence
false without touching it. **A sentence's truth depends on the heading above it**, which is exactly
the failure mode 63's own record warned about, three commits earlier.

**What is not yet known, and must be measured rather than argued:** whether the v2 link works with
`NEARBY_WIFI_DEVICES` denied. The release app currently has it `granted=false`, which makes the
experiment free — pair it and see whether the Mac connects. If it does, this page is asking a new
user for a permission the feature it names does not need, which is worse than a wrong sentence.

**Fix direction:** do not edit the string in place. `PermissionGroup.NEARBY_DEVICES.rationale` is
shared with the Sync flow, where it is correct. Either the page passes its own copy, or the
permission moves out of the Mac page entirely — which the measurement above decides.

**Wrong fix to avoid:** rewording the rationale to mention both paths. It is one string used in two
places that mean different things, and a sentence covering both is how the ambiguity becomes
permanent.

---

### 70 — the pairing screen's title is painted under the status bar · **closed** 2026-09-02

`QrScanScreen` hosts no `Scaffold` and applied no inset:

```kotlin
Column(modifier = Modifier.fillMaxSize().padding(16.dp))   // before
```

The activity draws edge to edge, so *"Pair with your Mac"* rendered behind the system clock, on the
one screen a new user cannot avoid.

**The interesting part is that no dump could have found it.** `uiautomator` reported the node present
with correct bounds and correct text — because it *is* present, correctly bounded, and merely painted
beneath something else. Every automated check in this project would call this screen fine. It was
found by looking at a screenshot.

That is the counterpart to `CLAUDE.md`'s rule about a screenshot carrying no scale: a **dump** carries
no z-order and no paint. The two instruments fail in opposite directions and neither substitutes for
the other — the tile-aspect defect needed a measurement over an eye, and this one needed an eye over
a measurement.

`OnboardingScreen` was the only file in the app already calling `systemBarsPadding()`, and it does so
for the identical reason, in a comment that says so. The knowledge existed one directory away.

---

### 71 — "Sync" means two things and onboarding uses the wrong one · **fixed** 2026-09-03

Page 1's feature card:

> **Sync** — Your notifications, texts, calls, photos, files and clipboard, on the Mac.

The app's **Sync tab**, read off the release build's own first run:

```
Devices · Transfers · Folders · Clip · Feed
This device — Samsung SM-S938B — Key DC:17:4B:6B:82:EA:2A:59
Not paired · 100.113.127.25   [Pair]
```

That is the **v1 Android-to-Android** feature: a discovery list of other phones, with its own pairing
model, its own fingerprint confirmation (defect 63's real home), and no relationship to the sentence
the user just read.

**And the flow delivers them there at the worst moment.** F1 lands a paired user on the **Mac** tab
and an unpaired one on **Sync** — so *"I'll do this later"*, chosen by exactly the person who has not
got the Mac app yet, ends on the screen least able to help them. The half of F1 that works is the
half for users who no longer need it.

**Fix direction:** the naming collision is the root and it is a product decision, not a copy edit.
Either the v2 Mac features stop being called "Sync" in onboarding, or the v1 tab is renamed. Landing
an unpaired user on the **Mac** tab is a smaller, separate change and can be made first — the tab now
leads with *Scan pairing code* and a sentence about what pairing gets you (F2), which is the right
first screen for someone who deferred.

**Wrong fix to avoid:** deleting the Sync card from page 1. The features it lists are real and are
the reason to install the app; what is wrong is that the word points at the other feature.

---

### 72 — a raw BoringSSL error in the status bar · **closed** 2026-09-02

*The three defects below share one cause; it is written once here and cross-referenced.*

A release build would not pair. The Mac's status bar read:

```
1288490715584:error:10000416:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN:
../../third_party/boringssl/src/ssl/tls_record.cc:489:SSL alert number 46
```

— while its sidebar read *"Samsung SM-S938B · Reconnecting"*. Three separate defects, and the
diagnosis nearly went to a fourth explanation that was wrong.

#### The cause, and the reading that almost hid it

The phone had **forgotten the Mac**. `[trust] Forgot 3030c8ebcddcd0fb…` at 23:30:00, the session
ended five seconds later, and all 47 subsequent connections were refused — `27 refused / 3 accepted`
on the phone's own counter, which is the denominator rule earning its place.

The hypothesis on the table was different and reasonable: *the Mac's slot still holds the debug
install's pairing, so it presents a certificate the release app never pinned*. Testing it meant
reading the phone's trust store, and the first read **agreed**:

```
$ adb shell run-as … cat databases/connectsuite.db > cs.db
$ sqlite3 cs.db 'select name, fingerprint from trusted_devices;'
Chetans-MacBook-Pro|DESKTOP|3030c8eb…            ← the Mac IS still stored
```

Room runs SQLite in **WAL mode**. The delete was in `connectsuite.db-wal`; the copied main file was
a pre-delete snapshot. With the WAL alongside: **0 rows**. That is recorded as its own rule in
`CLAUDE.md` — *the instrument fault that confirms the hypothesis is worse than the one that
contradicts it*, because a reading that agrees with you is filed rather than interrogated.

#### The raw error itself

`classifyLinkError` maps a transport error to one sentence. It keys on **`SSL alert number 46`** —
the wire's own value for `certificate_unknown` — rather than on `SSLV3_ALERT_CERTIFICATE_UNKNOWN`,
because the symbolic name is BoringSSL's spelling and everything around it is a path into a vendored
tree that moves with every Electron bump. The symbolic name is a fallback.

The fixture is the **real string from the Mac's log**, not a constructed one: a hand-written
approximation would test that the regex matches the thing the regex was written from.

An attempt to capture the error shape by building a rejecting TLS server in Node **failed twice and
is worth recording**: with `rejectUnauthorized` the handshake *succeeded*, because in **TLS 1.3 the
client's `connect` callback fires before the server has validated the client certificate** — the
rejection arrives on the next read. The second attempt then saw `ECONNRESET` rather than an alert,
because Node's server does not reproduce Conscrypt's `CertificateException` → alert path. The probe
was abandoned in favour of the log, which held the real thing all along.

---

### 73 — trust is two stores and the Mac had no state for "the phone forgot me" · **closed** 2026-09-02

Trust is two independent stores. Either side can drop it alone, and **the Mac had no way to
represent a pairing the phone no longer honours.** `paired` was a boolean over three states.

**Does the wire need a message? No, and it could not have one for the failing case.** When the phone
has forgotten this Mac the handshake fails, so there is no channel; a message announcing it would
need the connection whose absence is the announcement. Alert 46 is the signal, it arrives reliably,
and it is specific.

**A `pair.forgotten` courtesy on the live session is still worth having** — the phone had five
seconds of open channel between the `Forget` tap and the teardown — and it is **not a substitute**:
it cannot be sent when the Mac is offline at the moment of forgetting, which is exactly when this
state persists longest. The alert mapping stays load-bearing either way. Specified but not built.

---

### 74 — the sidebar and the pairing screen disagreed · **closed** 2026-09-02

The property that now holds, asserted over every reachable state rather than case by case:

```ts
assert.equal(needsPairing(h), pairingLabel(h) !== 'Paired');
```

A state where the sidebar names a phone while the shell demands pairing is unrepresentable.

**Wrong fix to avoid** for all three: showing the raw error "just in the debug HUD *and* the status
bar". The raw text has one home — `lastErrorRaw`, the log and the HUD — and prose has another. Five
mutations cover these, including the original bug re-introduced verbatim.

---

### 75 — revoking trust did not revoke access · **fixed** 2026-09-03

`TrustStore.forget(peerId)` deletes the Room row and reloads the in-memory cache. Nothing else
happens. `LinkServer.liveSessions` is untouched, so **the connection that trust authorised keeps
running**.

Measured, on hardware, while demonstrating something else:

```
00:02:32  I [trust] Forgot 3030c8ebcddcd0fb7ec2118e171ea70acc19b3971a7c63bd6d2b31cc1da5826c
00:03:3x  $ scripts/link-up.sh
          OK  3. 1 control session(s) ESTABLISHED on 42501 under uid 11011
```

Over a minute after the revoke, with full access to notifications, SMS, call log, contacts, files
and clipboard. The refusal takes effect on the **next** handshake, and while the link stays up there
may not be one — the Mac only reconnected because the app was restarted.

**This is a security defect and it reads like a UI defect**, which is why it survived. The Mac tab's
`Forget` button looks like a list operation; the row disappears, the UI is correct, and the sentence
*"an unpaired device is refused without asking you anything"* stays true about future connections
while being silent about the present one.

`LinkServer.forgetAndDisconnect` is the entry point now: it forgets **and** closes every live
session whose fingerprint matches, and `TrustStore.forget` becomes the storage half rather than the
whole operation. The log line carries both numbers — sessions closed *and* sessions left alone —
because "closed 1" says nothing about whether it closed the right one on a phone with two Macs.

**Wrong fix to avoid:** closing all sessions on any forget. A second paired Mac is not party to this
and must not be dropped; that is why the match is on the fingerprint rather than on the count.

**Still owed:** a hardware re-measurement. The fix compiles and is installed, and the sequence
*Forget → session closes → link-up reports 0 sessions* has not been run.

---

### 76 — the fourth state could not render, and only a screenshot could tell · **closed** 2026-09-03

`PairingHealth` was correct. `classifyLinkError` was correct. Twelve tests and five red mutations
covered them. And the state **never appeared on screen**, because `shell.ts` kept its own expression
of the rule:

```ts
switch (status.phase) {
  case 'reconnecting': return 'Reconnecting';      // ← wins, always
  default:
    if (status.pairing?.kind === 'repudiated') …   // ← the patch went here
}
```

A repudiated pairing is *always* in a retry phase, so the branch that was patched was the one branch
that could never run. The probe read `{"state":"Reconnecting"}` on a phone that had already forgotten
the Mac.

**This is `showsState` for the third time in this project**, and the third time the same shape: a
correct shared model, a renderer carrying a second copy of the decision, and a fix applied to the
copy's wrong half. The count matters — it is now the most repeated defect in this repository, and
each occurrence was found by eye rather than by any check.

The fix is structural rather than another patch: the precedence moved to `shared/linkTone.ts`,
written in the `appLabel.ts` style — no top-level `export`, declarations on `globalThis`, plus
`module.exports` — so the renderer loads **the same file** as the tests rather than a copy. That is
defect 46's rule, and it is the only arrangement in which the renderer and `node --test` can be
proven to agree.

The test that would have caught it asserts the property rather than a case: *a repudiated pairing
never renders as `Reconnecting`, **in any phase*** — six phases, one loop — with `connected` still
outranking it, because a live session is not a hypothesis.

**And the general lesson, which is the one worth carrying:** the shared model being right is not the
feature working. Between the model and the pixel there is a renderer, and this project has now been
bitten there three times while its unit suite was green. **A state that has never been seen on a
screen is unproven, whatever the tests say** — which is exactly what the user said when asking to
watch this one be drawn rather than take five mutations on it.


**Closed 2026-09-03.** The record above named the stimulus that would prove it — *one restart with
the notification-listener grant revoked, which removes the competing route and leaves the boot path
as the only one* — and that is exactly the run that closed it.

```
LISTENER_REBIND lines since boot: 0          ← the competitor, gone
11:54:21.023  [autostart] BOOT: 1 paired device(s), link not running — starting LinkService
11:54:21.067  [service]   Foreground as BOOT, types=0x10
11:54:21.100  [server]    Listening on 42501/42502/42503, 1 paired device(s)
11:54:26.607  [control]   Handshake complete with Chetans-MacBook-Pro
```

`startOrLog` reached with `LinkStartReason.BOOT`, no-op branch count **0**, and
`foregroundTypesFor(BOOT)` claiming `connectedDevice` **only** — every item this record listed as
untested by the 2026-09-02 run.

**What the two failed attempts established, and it is worth as much as the pass:** the rebind beat
BOOT by **3.9 s** and then **4.2 s** on two independent reboots. This record hypothesised that on a
phone with the listener enabled the rebind *may always* win, making the branch structurally
unreachable in the only configuration anybody runs. Two reboots losing the same race the same way is
that hypothesis holding. **So the branch is correct and, on a normally-configured phone, still
unreached** — the link comes back at boot either way, by whichever route wins, and this defect was
about proving the boot route *can*, not about which one does.

---

### 77 — a `BOOT:` line proves an intent, not a boot · **fixed** 2026-09-03

The 2026-09-03 sitting opened by reading defect 64's log and finding this:

```
2026-09-03T02:13:02.628 I [autostart] BOOT: 1 paired device(s), link not running — starting LinkService
2026-09-03T02:13:05.134 I [autostart] BOOT: 1 paired device(s), link not running — starting LinkService
```

The kernel had been up since `2026-09-02T12:40:06` — twenty-two hours. There was no boot at 02:13.
`lastUpdateTime` for the package is `2026-09-03 01:22:04`, fifty-one minutes earlier.

**The mechanism.** `LinkAutoStart.reasonFor` collapses two actions into one reason:

```kotlin
"android.intent.action.BOOT_COMPLETED", ACTION_QUICKBOOT_POWERON -> LinkStartReason.BOOT
```

and `core/src/main/AndroidManifest.xml` already carries the measurement that makes this exploitable
by accident: on this handset `QUICKBOOT_POWERON` is **not a protected broadcast** — `am broadcast`
from the shell returns `result=0` rather than a `SecurityException`, which is why the receiver is
`exported=false`. So a `BOOT:` line can be produced by anything that sends that action, and two of
them appear in this log with no restart under either.

**Why it is a defect and not a curiosity.** Defect 60 already established the corollary this
violates: *when two mechanisms can satisfy the same guarantee, the log must say which one did*. That
was applied to the three **reasons** — `BOOT`, `LISTENER_REBIND`, `PACKAGE_REPLACED` — and it is
exactly what made defect 64 visible at all. It was not applied one level down, to the two **actions**
that share the `BOOT` name. The rule was right and its application was one layer too shallow.

**Fix direction.** Two names, `BOOT` and `QUICKBOOT`, carried through `LinkStartReason` and into the
line. The foreground-type decision stays identical for both; this is about what the log can be asked.

**The wrong fix is to drop `QUICKBOOT_POWERON` from the intent filter.** Listening costs nothing, One
UI may genuinely send it in place of `BOOT_COMPLETED`, and a duplicate delivery is a no-op start on a
live service. Trading a real recovery path for an unambiguous grep is the wrong side of that trade.

**The second wrong fix is to keep asking the log this question at all** — see 78.

---

### 78 — the boot verdict's own window admitted lines of any age, and the fix is not a better grep · **fixed** 2026-09-03

`scripts/defect64-read.sh` bounds every count to lines written since the current boot:

```sh
SINCE=$(printf '%s\n' "$LOG" | awk -v b="$bootiso" '$1 >= b')
```

`$1` is the first whitespace-delimited field. On a timestamped line that is the ISO timestamp and the
comparison is exact — same timezone throughout, so a lexical compare is correct. **On a stack-trace
continuation it is `at`, and `"at" > "2026"`, so every untimestamped line in the file passes the
filter regardless of when it was written.**

Measured against the 2026-09-03 11:16:07 boot:

| Filter | Lines |
|---|---|
| `awk '$1 >= b'` — as shipped | **549** |
| `/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $1 >= b` | **64** |
| untimestamped lines admitted | **485** |

An 8.5× inflation, on the control line whose entire job is to tell the reader the counts below it are
bounded. The verdict counts themselves were not wrong — they match strings that only ever appear on
timestamped lines — but *the number that certifies them* was.

**The shape is worth stating apart from the fix, and it is now a rule in `CLAUDE.md`.** Every other
instrument fault in this project corrupts the **reading**: a page cap invents an ending, a stale XML
serves an older moment, a 263 ms window holds nothing at all. Each is unwelcome, and being unwelcome
is what got it looked at. **This one leaves the reading perfect and corrupts the thing that vouches
for it.** A control wrong in the *safe* direction — too big, too generous, too inclusive — is worse
than no control, because it makes a correct answer look better-evidenced than it is, and nobody
audits a control for being too generous. There is nothing in the output to notice: the verdict was
right the entire time the number certifying it was wrong by a factor of eight.

**Fix direction, and the second half matters more than the first.**

1. Anchor the filter: `/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $1 >= b`.
2. **Make uptime the witness for *whether a boot happened*, and the log the witness only for *what
   the boot did*.** These are two questions and only one of them has an honest answer in the log.
   `/proc/uptime` is the kernel's own counter; it cannot be written by an app, cannot be forged by a
   broadcast, and resets on every restart including a fast one. The log's `BOOT:` line, per 77, can
   be produced by anything on the device. The gate already reads uptime — the verdict must never
   *infer* a boot, only describe one whose occurrence uptime has already established.

**The wrong fix is a tighter grep for `BOOT:`.** Defect 77 is why: a synthetic `QUICKBOOT_POWERON`
sent inside the gate's 30-minute uptime window would land in the counted set and satisfy any string
test, however precise. No pattern over the log distinguishes it, because the log genuinely does not
carry the distinction.

**The second wrong fix is to widen the gate's window** to accommodate a slow first-unlock delivery.
The window is the only thing keeping a reinstall's lines out, and 02:13's pair is what it keeps out.


---

### 79 — the phone replaced a clipboard it could not report · **fixed** 2026-09-03

Found while reading defect 64's log for something else:

```
W [clip] Notifications are not permitted, so the arriving entry was applied to the
         clipboard without saying so; it is also in the history          × 7
```

`POST_NOTIFICATIONS` is `granted=false` on this handset, phone-side auto-apply is on, and between
them the Mac had replaced this phone's clipboard **seven times with nothing shown to its owner**.

**Why this is a defect and not a permission somebody declined.** `docs/protocol.md` builds the
clipboard namespace on one asymmetry: the Mac applies on arrival *because* it reads its own clipboard
first and keeps the displaced entry, so `Restore` is a real undo. The phone may not read its
clipboard while unfocused (Slice 11: 90/90 and 60/60), so it cannot see what it would destroy, cannot
keep it, and cannot put it back. **The notification is the entire compensation for that missing
undo.** Without it, auto-apply is a different feature from the one the setting describes.

**The code contained the opposite argument, in a comment, which is why it lasted:**

> *with auto-apply on, the clipboard **was** written and only the telling failed, which is a
> materially smaller problem than an offer nobody can reach*

That is backwards, and the correction is kept beside it in `ClipNotifications.kt` rather than
deleted. An offer nobody reaches changes nothing on the device; an unreportable apply destroys
something unrecoverable.

**Two rules this repo already had, both broken on one path.**

1. **A check that does not gate the action.** Deliverability was checked *after* `applyToClipboard`
   had run, and the check then no-opped politely.
2. **One rule, two expressions.** `AppsNotifications.canPost` asked two questions —
   `POST_NOTIFICATIONS` **and** `areNotificationsEnabled` — and its own comment said a check reading
   only the grant "would report the question deliverable to a shade that will silently drop it".
   `ClipNotifications.canPost` asked one. The weaker of the two copies was the one on the path that
   writes somebody's clipboard.

**The fix.** `ClipArrival.of(autoApply, canNotify)` decides before anything is written, `canNotify`
gates **both** branches, and `NotificationDelivery` is the single home for the two-part check. The
`clip.push` ack now reports what the receiver *did* — `applied`, `arrival`, `reason` — so the Mac,
the only screen the phone can still reach, shows the refusal on both send triggers.

**Red first:** deleting `!canNotify -> KEEP_ONLY` fails 4 of `ClipArrivalTest`'s 6 tests.

**Proven on hardware in both directions**, which is what actually closes it, because the test reaches
the decision and not the write: refused at `granted=false`, applied at `granted=true`, refused again
after restoring `granted=false`. `docs/testing.md` → Phase 6 Slice 7.

**The wrong fix, for whoever meets this next: do not gate the `clipboard` capability on
`POST_NOTIFICATIONS`.** That was considered and rejected. Phone→Mac sending is unaffected by the
permission and works fine, and the history is still populated — turning the whole capability off
would remove three working verbs to fix one branch, and would tell the Mac the phone has no clipboard
at all, which is false.
---

### 80 — the accessibility bind starts the process and nothing starts the link · **fixed** 2026-09-03, start half unproven

From defect 64's closing run, with the notification-listener grant revoked so that route could not
fire:

```
11:53:52                boot
11:54:16.148  [caps]  Capabilities now: none …
11:54:16.911  [fs]    Files feature installed with 7 of 6 verbs; 5 root(s) …
11:54:17.054  [input] Accessibility service connected
11:54:21.023  [autostart] BOOT: 1 paired device(s), link not running — starting LinkService
```

Every feature installed into a process with **no listening socket**, for five seconds. The
`AccessibilityService` is a bound service the system starts on its own schedule, and it is the third
way this process comes up — after the notification-listener rebind (defect 62) and the two boot
broadcasts (defect 60). Only the first two are wired to `LinkAutoStart`.

**The five seconds are not the finding.** At boot a broadcast follows and closes the window. The
question is what happens when one does not, and there are at least three such cases, none of them
exotic:

| How the process starts | Does a broadcast follow? |
|---|---|
| Boot | **Yes** — `BOOT_COMPLETED` after first unlock |
| `adb install -r` / app update | **Yes** — `MY_PACKAGE_REPLACED` |
| Notification-listener rebind | n/a — that path calls `ensureRunning` itself |
| ~~Accessibility rebind after a low-memory kill~~ | **Withdrawn 2026-09-03** — `START_STICKY` restarts a *started* service after a process kill, measured at `15:04:14` when it beat the accessibility bind by 16 ms. This row over-claimed |
| **Accessibility rebind after the service is toggled off and on** | **No** |
| **Accessibility rebind after a crash `START_STICKY` did not catch** (defect 62's second outcome) | **No** |

In those three the window does not close at all. The app is alive, granted, feature-complete and
**serverless for as long as nobody opens it** — which is precisely the state defect 62 describes,
reached by a route nobody specified and nothing watches.

**Fix direction.** `ConnectSuiteInputService.onServiceConnected` calls
`LinkAutoStart.ensureRunning(context, LinkStartReason.ACCESSIBILITY_BIND)`, with its own reason name
so the corollary defect 60 established still holds: when several mechanisms can satisfy one
guarantee, the log must say which one did.

**The objection, and why it no longer stands.** A fourth start route is a fourth competitor in the
race that defect 64 had to strip a competitor out of to get a reading. That was real, and it was a
problem about **provability**, not about correctness — `ensureRunning` is idempotent and logs
`already listening — nothing to do` with its reason attached. Defect 64 is closed, so the reason to
keep the route count low is spent.

**The wrong fix is to leave it on the grounds that BOOT covers it.** BOOT covers one of the ways this
process starts. The three rows above are the others, and they are the ones where nobody is watching.


**Wired 2026-09-03.** `onServiceConnected` calls
`LinkAutoStart.ensureRunning(this, LinkStartReason.ACCESSIBILITY_BIND)`, the reason has its own name
in the log, and `foregroundTypesFor` groups it with the automatic starts so it claims
`connectedDevice` only. `BootAutoStartTest`'s automatic-reason list was **derived from the enum**
rather than typed out in the same change — the hand-written list covered three of five reasons and
would have let a new one claim `dataSync` while staying green. Shown red: making
`ACCESSIBILITY_BIND` claim `dataSync` fails 1 of 12.

**The start half is not claimed.** On hardware the route was delivered to and took
`already listening — nothing to do`, 34 ms behind `LISTENER_REBIND` and `PACKAGE_REPLACED`, which
both fire on an install and neither of which exists in the three cases this defect is about. That is
defect 64's shape one route further along and the rule from 64 stands: a no-op branch is not a pass.
The stimulus that would settle it is in `docs/testing.md` → Phase 6 Slice 9, and it needs the owner's
say-so because it turns notification mirroring off for the length of the run.


**Attempted 2026-09-03, and the start half is still unproven — `docs/testing.md` → Phase 6 Slice 10.**
Three firings, three no-ops, zero starts.

**A fourth route was found by the attempt to isolate the third.** The run removed `LISTENER_REBIND`
(grant revoked) and `PACKAGE_REPLACED` (no install) and did not remove **`START_STICKY`**, which
restarts a started service with a null intent — reason `UNKNOWN`, which is why it was never counted
as a competitor. It won by 16 ms.

That also **corrects this record**: the low-memory-kill row above is withdrawn, because `START_STICKY`
covers it. The honest window is a process start where `LinkService` was *not already started* — so
there is nothing to restart — and no broadcast follows. Rarer than this entry first claimed, and
still real.

**What would settle it:** stop `LinkService` first, then kill the process with the listener revoked,
so all three of the other routes are absent. There is no user-facing way to stop the service alone,
so it needs a debug-only affordance of the `ClipProbeActivity` kind. Filed as the next step rather
than done, because adding a debug surface to reach a state is a different change from the fix itself.


**Fixed 2026-09-03.** `LinkStartReason.QUICKBOOT` exists beside `BOOT`, mapped from
`ACTION_QUICKBOOT_POWERON`, handled identically everywhere a decision is made and named differently
everywhere a line is written. Two tests: one asserting the two actions map to two reasons and
explicitly `assertNotEquals` on them, one asserting `foregroundTypesFor` is identical for both at
API 36 and API 33 — because the fix must change the name and nothing else. Folding them back fails
1 of 14.

**The reader needed the same change, and this is the part worth remembering:** `scripts/defect64-read.sh`
counted with `grep -c 'BOOT: …'`, and **`QUICKBOOT:` contains `BOOT:`**. Separating the names in the
log while leaving the grep unanchored would have moved the ambiguity from the data into the
instrument — the same defect, one layer out, in the script written to detect it. The greps are
anchored on `[autostart] BOOT:` now and the verdict prints a `QUICKBOOT lines since boot` count
beside the others.

---

### 84 — one notification, eleven banners · **fixed** 2026-09-04 · found 2026-09-04

Found while waiting for check 3 of the native-notification run, and filed before those checks were
completed: a defect found while waiting for something else is the one that gets lost when the thing
you were waiting for arrives.

Since the 11:51:27 launch, `com.jio.myjio` was **posted once and updated 119 times**:

```
com.jio.myjio    posted=1   updated=119     →  88 ongoing / 21 update / 11 notify
com.whatsapp     posted=4   updated=3       →   1 notify          (control, same window)
```

Eleven native banners for one notification in about three and a half minutes. **The pane's row count
went 38 → 39 across the whole burst** — that is the number that makes the rest mean anything, because
without it "eleven banners" and "eleven messages" are the same observation. The control was read as
lines, not as a count, for the reason the second row of `CLAUDE.md`'s table exists.

**The mechanism, and it needs both halves.**

- **The `whenMs` rule is correct for what it was measured against.** `UPDATE` suppresses only when
  `whenMs <= previous.whenMs`, and its comment states why: *"A progress bar keeps its original
  `when`; a new message advances it."* WhatsApp's second message in an unread conversation arrives
  under the same key with an advanced timestamp and **must** banner — suppressing on the key alone
  would silence exactly the notification this feature exists for. **Jio advances `when` on every
  tick**, so every tick reads as that new message.
- **The `ongoing` flag flaps on the same key.** 88 ticks carried `ongoing: true` and were suppressed
  correctly. The eleven that leaked are the frames where `ongoing` read **false** *and* the timestamp
  had advanced.

Either fact alone suppresses nothing: a key advancing `when` while staying `ongoing` is silent, and a
key flapping `ongoing` without advancing `when` is caught by `UPDATE`. It is the `REPLAY` failure — a
burst of banners about something already known — arriving through a door `REPLAY` does not cover.

**Fix direction: a per-key cooldown** — how soon one key may banner again. It is deliberately **not**
written as part of a defect fix, because it is a product judgement — the number is a statement
about what a person wants, and there is no reading that settles it.

**The wrong fix is a package allowlist.** The right answer for this app is *sometimes*: the same key
must banner when it carries a real message and must not while it ticks. A list of important apps
cannot express *sometimes*, is wrong for everybody but its author, and fails silently in the
direction of not telling you things — which is the failure the whole feature exists to remove.
`nativeNotify.ts` refuses an allowlist in its own comment and that refusal stands.

---

### 85 — the Clipboard pane cannot say why nothing arrived · **fixed** 2026-09-04 · found 2026-09-04

**Reported by the user, who was right about the symptom and refused the obvious diagnosis.** They
copied on the phone, pressed ⌘V on the Mac, got the Mac's own last clip, looked at the Clipboard
pane, saw nothing, and concluded the feature was broken. It was not: Slice 11's wall was behaving
exactly as measured, and opening ConnectSuite on the phone delivered the clip immediately. Their
filing is the useful half — *the pane gave me no way to tell "nothing has arrived because Android
won't let it" from "nothing has arrived because something is wrong"*.

**The measurement, against the packaged build on :9222.** The copy is present and it is good — it
names Android as the owner of the rule, denies being unfinished work, and gives the recipe. It is
also in the wrong column and below the fold:

| Element | top | bottom | on screen |
|---|---|---|---|
| `#clip-list` — what the user reads | 399 | 829 | **100%** |
| `#clip-wall-phone` — the explanation | 828 | 1001 | **37 px of 173, 21%** |

The wall begins one pixel before the list ends, in the right-hand `aside`, under the *Mac*-direction
wall that fills the visible part of that column. The left column's entire chrome is **299
characters** and mentions neither Android nor the limit, and its one live strip, `#clip-notice`,
said *"On this Mac's clipboard now — ⌘V to paste."* — the direction that works.

**So the pane has no state for the phone direction at all**, and *Android refused the read*, *the
link is down* and *the app has crashed* draw the identical picture. This is empty-versus-failed, in
the app that wrote a proposal revision to separate exactly that, and it is F6/P3's
nobody-scanned-versus-scanned-and-failing one pane over.

**Why every check passed over it.** `scripts/clipboard-pane-probe.mjs` asserts the copy is **in the
DOM**, and it is — all nine of its checks are green. Nothing in this repo measures *where* a
sentence sits relative to the thing it explains, and `clipboardView.test.ts` constructs the pane's
state by hand, which is defect 67's tell: the field a test supplies is never the field a layout gets
wrong. It is `showsState` a third time — a correct string in a place nobody in that state is looking.

**Fix direction.** The pane already computes what it needs: the filter tab reads `From phone 1`, so
the two directions are counted separately today. Put a phone-direction line in the **left column**,
beside `#clip-notice` and under the same liveness — when the phone last sent, and that it can only
send while open — and separate it from a broken link the four ways the Files pane separates empty
from failed, since both states are reachable here.

**The wrong fix is to move the wall copy up, or to make it bigger.** The defect is not that the
sentence is too small; it is that the pane has no *state* for this direction, which forces the
sentence to be permanent, and a permanent sentence is one a user reads once and then stops seeing.
**The second wrong fix is a banner when nothing has arrived** — nothing-has-arrived is the resting
state of a working feature, and a warning that is usually wrong is one people train themselves past.

**Not a fix for this, and worth its own decision:** `ACTION_PROCESS_TEXT` (Slice 17 route 4) is the
one measured way to make the trigger cheaper than opening the app. It is a different feature, and it
is permitted-but-unsighted until someone selects text in three real apps.

**Fixed 2026-09-04, and proven at the geometry the report came from.** `docs/testing.md` → Phase 7
Slice 18. The line reads `top=360 bottom=438`, 100% on screen and above the list, in a 1440 × 865
unzoomed window with a populated list; the left column went from 299 characters that named nothing
to 492 that name Android and both routes.

**The proof is a third instrument, and that is the part worth carrying forward.**
`clipboard-pane-probe.mjs` passes all nine of its checks over the *unfixed* pane, and the new view
tests run against a DOM double with no layout — so neither layer can see a defect about *where* a
sentence is. `scripts/clipboard-silence-probe.mjs` reads rectangles from a real window, and every
check in it asks *is it inside the viewport* rather than *is it in the document*.

**One thing shipped broken for an hour and no test could have caught it**: the state module used
`export`, which `tsc` emits as CommonJS, and the renderer loads `shared/*.js` as plain script tags —
so it threw `exports is not defined` on every draw with 484 tests green, because the tests reach it
through `tsx`, a path the renderer never takes. Found by opening the page and reading the console.

---

### 86 — the toolbar entry is invisible until a Samsung switch nobody knows about is flipped · **fixed** 2026-09-04 · found 2026-09-04

**Found by the user's hand test, which is the only instrument that could have found it.** Slice 18
shipped `Send to Mac` in the text-selection toolbar and recorded it *permitted, sighting unproven*.
The sighting failed: it appeared in WhatsApp, Chrome and a plain text field **not at all**.

**It was never absent.** One UI ships `ACTION_PROCESS_TEXT` as a **per-app opt-in that is off by
default**, in a screen (`SecProcessTextManageAppsFragment`, *"Select apps to show in the contextual
menu"*) reachable only from **inside** the selection toolbar — long-press → ⋮ → Manage apps. Our row
was there, correctly labelled, `checked=false`, alongside **ten others all `false`**: ChatGPT,
Claude, Perplexity, DeepSeek, Adobe ×2, Samsung Pass, Samsung Wallet, Truecaller, Google. Switched
on, ours appears — **in the overflow, not on the first row**, because the framework orders every
`PROCESS_TEXT` item after Cut/Copy/Paste/Share/Select-all and this phone has ten competing for the
space. `docs/testing.md` → Phase 7 Slice 19 has the end-to-end run from Chrome.

**Why this is ours and not Samsung's, despite the mechanism being Samsung's.** The app ships a
feature that cannot work until a user finds a switch that is three levels inside a menu they have no
reason to open, and says nothing about it anywhere. That is the same failure as defect 85 one
surface over: the user cannot tell *off by default* from *broken*, and this time they concluded
correctly that nothing was there.

**Fix direction: say it where the feature is claimed, and only where it is claimable.** The phone's
clipboard screen is the place — it is the one surface that already talks about this direction. State
that the toolbar entry exists, that One UI ships it switched off, and give the path in the order a
person walks it (*select text → ⋮ → Manage apps → Send to Mac*). The Mac's `waiting` copy names the
route today and must not promise a toolbar entry that is off; naming it as *set up once on the
phone* is honest and naming it flatly is not.

**The wrong fix is a deep link to the Settings screen.** `SecProcessTextManageAppsFragment` is a
Samsung internal fragment, not a documented `ACTION_*`, and an intent at it is exactly the
vendor-specific route `docs/single-device-audit.md` §4 says not to assume — it is one OEM, one skin,
and it can be renamed by an update nobody controls. A sentence with the path in it survives that; an
intent that silently fails does not.

**The second wrong fix is to check the switch's state and show a warning when it is off.** Nothing
in `Settings.Secure` is documented to carry it, reading an undocumented Samsung key would be a
single-device guess, and a wrong reading here produces a warning on phones where the feature works —
which is worse than the sentence.

**Unknown, and it is a `single-device` unknown in the exact sense of `docs/single-device-audit.md`:**
whether this switch is Samsung's alone or something AOSP has adopted. The fragment name is
`com.samsung.android.settings.*`, which says who wrote *this* screen and says nothing about a Pixel.
The copy should therefore describe the phone in front of the user rather than assert what Android
does.

**Fixed 2026-09-04.** `ClipboardCopy.kt` — a card on the phone's clipboard screen with the four
steps in walking order, rendered and read back on hardware (`docs/testing.md` → Phase 7 Slice 20).
Both refusals stand: no deep link to `SecProcessTextManageAppsFragment`, and no reading of a switch
state no documented key carries.

Three things the card had to say beyond the steps, each tested: **where it lands** (the three-dot
menu, never beside Copy — without that line the setup reads as having failed), **whose default it
is** (*your phone ships this off for every app that offers it*), and **"your phone" rather than
"Android"**, because the screen is Samsung's and one handset is not the platform.

**The Mac's copy was wrong in the same place a second time.** Its `waiting` recipe had been rewritten
the day before to lead with the toolbar route as the cheaper gesture — true when written, and a
promise of a gesture that does not exist once defect 86 was known. It now leads with the route that
always works and qualifies the other with *once it is set up on the phone*.

**Position is not ours to influence, measured and not shipped:** `android:priority="999"` is recorded
by the system as `0` (as it is for all twelve `PROCESS_TEXT` filters on this device), an activity
icon is not drawn in the overflow at all, and label length cannot matter in a text-only list. Seven
built-ins fill the first row before any app entry is considered. The attribute was reverted and the
icon deleted rather than left as config implying a lever that works.

**Fixed 2026-09-04.** `src/shared/notifyCooldown.ts` — a per-key history and two windows, with the
window chosen by whether the key has ever been `ongoing` this session. Jio's measured sequence goes
**11 banners → 1**; the control from the same run (a chat key, never `ongoing`, three messages two
minutes apart) stays at **3**. Suite 488 → 500.

**The store is in `src/shared/` because its writes are the part that goes wrong.** Two lines beside
the tally in `NativeNotifier` would have been a transition no test can reach, which is defect 67
exactly. The mutation that proves it earns its place: asking whether the **last** post was `ongoing`
rather than **ever** reds the store's session test and nothing else — and it is the plausible wrong
version, because a ticker *flaps*, so the last-post question lets every other frame through.

**Unproven in the field, stimulus named.** Ninety seconds of live traffic decided `39 replay / 10
group-summary / 7 ongoing` and **zero `notify`**, so there was no banner to hold; the zero is a
missing reading, not a pass. `com.jio.myjio` is in the shade (3 records of 55) and not currently
ticking. The stimulus is its next active period, and the suppression line names its window kind and
carries `held / posted` so the evidence will be self-announcing.

**Mechanism corrected 2026-09-04, by the user, and the correction is the part worth reading.** The
entry above originally described *a ticker flapping its `ongoing` flag*. Jio was **playing music**,
and playback genuinely stopped and restarted eleven times; every post was truthful. Nothing in the
evidence could have separated the two — `88 ongoing / 21 update / 11 notify` is identical either way
— and the hypothesis already on the table was the one that got written down. **The lookalike rule,
applied to a mechanism instead of to a query:** *what else would produce exactly this tally?*

**It changes what the fix is, not whether it is right.** A rate limit on a **truthful** notification
is a different thing to hold than a guard against a lying one, and the code comments now say so.

**The follow-on question — was ConnectSuite interrupting the playback — was investigated and the
answer is no, with limits stated.** `docs/testing.md` → Phase 7 Slice 23. Structurally: this app
links **no audio API at all** (`requestAudioFocus`, `AudioFocusRequest`, `MediaPlayer`, `AudioRecord`
and `AudioPlaybackCaptureConfiguration` appear nowhere; the only audio symbols in the codebase are
`AudioManager.ADJUST_RAISE/LOWER` inside a logged `remote.command`), and mirroring captures no audio
— **an app that never requests audio focus cannot take it.** In the window itself we sent zero media
commands and zero Jio actions, in a log proven to cover it (10 lines at `11:5x`); the only Jio action
we have ever sent is `11:56:31`, **after** the burst. **What cannot be established:** `logcat` has
rolled (0 lines matching `^09-04 11:5`), so no direct audio-focus record for that window exists or
can be recovered. The standing contrast — Jio in bucket **40 (RARE)** and not battery-exempt, ours
**5 (EXEMPTED)** and whitelisted, on the One UI handset Phase 6 exists because of — is a sufficient
alternative cause pointing away from us, offered as that rather than as the established one.

---

### 89 — the album rail lists the phone's trash as an ordinary album · **fixed 2026-09-29, tests only** · found 2026-09-05

**What is on screen.** The Photos rail draws 150 albums. Two of them read *WhatsApp Images*, three
read *WhatsApp Video*, four read *WhatsApp Documents*, and several are bare numbers —
`1389444597`, `1650884749188`, `1662119105741`.

**What they actually are**, read off the device rather than guessed at:

```
bucket_id=-1829889111  Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/
bucket_id=318896427    Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/
bucket_id=278607672    WhatsApp/Media/WhatsApp Images/          ← pre-scoped-storage
bucket_id=1432227631   Android/.Trash/com.sec.android.gallery3d/…/WhatsApp Images/
```

`MediaStore.BUCKET_DISPLAY_NAME` is the **leaf directory name only**, so two different directories
collide the moment their last segment matches. The duplicate rows are not a bug in the pane; they
are four real folders with one name between them.

**The finding is the fourth row.** `Android/.Trash/com.sec.android.gallery3d/` is Samsung Gallery's
trash, so the pane is showing somebody their **deleted photographs** as a normal album, indexed and
thumbnailed alongside the live ones. It is not flagged `is_trashed` either — that column returns
nothing at all on this device, because Samsung Gallery moves files into its own `.Trash` directory
rather than using `MediaStore`'s trash. **Only the path separates them.**

The numeric names are the same class of thing and are **correct**. They are real directories some
app created and named with a Unix timestamp, and `CLAUDE.md`'s package-id rule does not cover them:
that rule is about a package id appearing where a sentence belongs, and a folder's own name is not
that. A person can navigate to `1389444597` on their phone.

**Fix direction.** `media.buckets` carries `bucketId`, `bucketName`, `count`, `newestMs`, `coverId`
and — for app-owned buckets — `packageName`/`appName`. It carries **no path**. Add `relativePath`
(or a `trashed` boolean derived from it phone-side, which leaks less), then:

1. drop `Android/.Trash/**` from the bucket list entirely — a deleted photo is not an album; and
2. disambiguate a repeated `bucketName` with its parent segment, so *WhatsApp Images* under
   `Android/media/com.whatsapp/…` and under `WhatsApp/Media/…` read differently.

It is a wire change and `docs/protocol.md` is the contract, so it changes there first.

**Two wrong fixes, both of which were built and drawn before being removed.** Neither was caught by
a test, because in each case the assertion and the defect were the same sentence — both were found
by looking at the running app:

| tried | what appeared |
|---|---|
| append the item count as a subtitle | `Instagram / 34 / 34 items` — the count **is already the row's own second column**, so this was the same number twice, three lines deep |
| append `newestMs` as *Latest 4 Sep 2026* | **identical on both rows it was meant to separate**, and truncated to `WhatsApp · Latest Sep 4, …` in a 188px rail |

Each was a true statement that answered nothing, which is why the pane now draws neither: the counts
already differ and are already on the row, and that is the whole of what this wire supports. A third
surface-only attempt would be the same mistake again.

**A third wrong fix worth naming before someone reaches for it: renaming the numeric albums.** They
are the folders' real names. Prettifying one invents a name for a place the user can navigate to,
and then the app and the phone disagree about what it is called.

**Evidence:** `docs/testing.md` → Phase 7 Slice 27.

### 100 — the app reaches zero foreground services 110 ms into every capture, and the projection goes with them · **open, mechanism partly established** · found 2026-09-10

Consent is granted, the projection token is issued, the `VirtualDisplay` is created and the encoder
reaches `RUNNING` and emits its output format. **107 milliseconds later `MirrorService` loses its
foreground status and Android revokes the projection.** The chain is in `docs/testing.md` → Phase 7
Slice 38, in the platform's own words, from a single deliberate attempt.

**The user sees `Screen capture was stopped on the phone` for all of it** — one of eight reasons
`MirrorEngine.stop(String)` funnels into a single sentence, two of which differ by three words
(`"stopped on the phone"` is the user tapping Stop; `"screen capture was stopped on the phone"` is
the projection dying). That conflation is why eight failures produced no information.

**What is established, 2026-09-10, from the platform's event log.** In every attempt
`MirrorService`'s foreground state ends 106-116 ms after it begins, recorded as `STOP_FOREGROUND`
with `fgsType=32`, and the projection is revoked 2-3 ms later:

```
attempt 1   15.621 FGS start   15.725 *launch* REL (124ms)   15.727 FGS stop (106ms)
attempt 2   32.814 FGS start   32.926 *launch* REL (122ms)   32.930 FGS stop (116ms)
```

At that instant the package has **no foreground services at all** —
`SecFgsManagerController: updateNumberOfVisibleRunningPackagesLocked: 0` — which is why
`MediaProjectionManagerService` revokes the projection *"due to foreground service change"*.
`MirrorService` is the only one there is: `scripts/link-up.sh` check 1 fails for `LinkService` too,
with **zero** `startForeground refused` lines in the phone log, so it started foreground and lost it
as well.

**The `SecurityException: Cannot create VirtualDisplay with non-current MediaProjection` is
downstream and that is now proven by ordering**: in attempt 1 the FGS stopped at `15.727` and
`createVirtualDisplay` failed at `15.745`, 18 ms later. Nothing created a second projection; ours had
already been revoked. That reading, which looked like the sharpest lead of the morning, is a
symptom.

**What is NOT established: what issues the stop.** AOSP records `STOP_FOREGROUND` for the
`setServiceForeground(id = 0)` path, and nothing in this repo calls `stopForeground`, cancels
notification `3001`, or calls `cancelAll`.

**A "provisional background-start allowance, withdrawn when the launch transition settles" was
written here and is retracted.** The correlation is real — the stop lands 2-6 ms after the
`*launch*` wake lock is released and `MirrorConsentActivity` is destroyed, twice out of two — but
the mechanism does not survive its own evidence: `am_foreground_service_stop` carries
**`PROC_STATE_TOP`**, so the process had not left the foreground and no TOP-conditional allowance
could have lapsed. The correlation stands; the explanation was written ahead of it and is withdrawn
rather than quietly softened. **Do not build a fix on it.**

**Fix direction: none yet, and that is the honest state.** The next step is to name the caller of
`setServiceForeground(id = 0)`, which the app cannot observe from inside — `Service.stopForeground`
is `final`, and a process-importance proxy is masked by any visible Activity
(`IMPORTANCE_FOREGROUND` 100 outranks `IMPORTANCE_FOREGROUND_SERVICE` 125). Candidates not yet
tested, in cost order: the app's standby bucket and `RUN_ANY_IN_BACKGROUND` appop; whether this
handset is still exempt from battery optimisation (`docs/phase-6-brief.md` §0 says it was, and that
claim is now worth re-reading rather than assuming); and a One UI background-restriction surface.
**None of these has been read** — the commands to read them failed with the phone off the bus, and
no verdict from that run may be quoted.

**The wrong fix is re-declaring the manifest type or the per-type permission.** Both were verified
**in the installed APK** rather than in source — `foregroundServiceType=0x20` on the `<service>`,
`FOREGROUND_SERVICE_MEDIA_PROJECTION` in the permission list — and the event log carries `type=32`
at both start and stop, so the service had the right type throughout. A `ForegroundServiceTypeLoggerModule`
line reading *"does not have any types"* is the **API**-type logger (camera, microphone, location)
and says nothing about the FGS type; it was flagged unresolved rather than concluded, and acting on
it would have sent a fix at a manifest that is already correct.

**The second wrong fix is blaming the consent flow**, which is the one part of this path that
demonstrably works: 8 grants, 0 denials, 0 dismissals.

**The third wrong fix is anything that treats this as new.** The failure is present in the oldest
attempt that survives in the log (2026-09-09 20:25) and predates the accessibility toggle, the §3
fit build and the packaged relaunch, all of which happened on 2026-09-10.

### 101 — the app's own notification churn ate the evidence · **fixed 2026-09-10** · found 2026-09-10

`ConnectionService` re-posts notification `1001` **twice every eight seconds, forever**. Each
enqueue wakes `NotificationManagerService` and takes two partial wake locks, and the pair rotated
the platform's `events` buffer past the failure defect 100 needed — the `am_foreground_service_*`
records for the first six attempts were gone before they could be read.

Nobody was looking for it. It was found because **it destroyed an instrument**, which is the second
time in this project that the app's own output has eaten the evidence about the app.

**Fix direction: post only when the rendered notification actually differs, and find the emitter.**
Something upstream produces a status event every 8 seconds with unchanged content; `updateStatus`
posts on each one. The comparison belongs where the notification is built, and the 8-second emitter
is worth identifying rather than papering over — it is also two wake locks a tick on a phone that is
meant to be idle.

**The wrong fix is lowering the notification's importance.** That hides the symptom in the shade and
leaves the wake locks and the buffer churn exactly where they are.

**The second wrong fix is a fixed-interval throttle**, which makes a genuine status change late as
well as making the churn quieter — the failure is *redundant* posts, not *frequent* ones.

### 102 — the app cannot tell it has been background-restricted · **fixed 2026-09-11, read on hardware 2026-09-12** · found 2026-09-10

`RUN_ANY_IN_BACKGROUND: ignore` on this handset, against `allow` or unset for 6 of 8 comparable
third-party apps read the same minute. The op is the AOSP background restriction; One UI sets it
automatically for apps it judges unused (`SUPPORT_BG_AD_RESTRICTION_BY_AI=1`), and the only other
restricted app in the sample is the other one the owner does not open daily.

**The product consequence is the defect, not the op.** A person whose phone quietly restricts this
app gets a mirror that dies 116 ms into every attempt behind the sentence *"Screen capture was
stopped on the phone"*, which is true of the projection and says nothing about the cause. Nothing in
the app looks at the one API that would have named it.

**Fix direction: detect and say so.** `ActivityManager.isBackgroundRestricted()` has been public
since API 28. It belongs with the other probes in `Capabilities.kt` so the restriction reaches the
Mac as an `unavailable` reason like every other one, and the phone's own screens can carry the
sentence plus a deep link to App info → Battery.

**The wrong fix is retrying the foreground start.** Each retry buys another provisional allowance
and another withdrawal — seven taps on 2026-09-10 bought seven.

**The second wrong fix is prompting for the battery-optimisation exemption again.** It is a
different switch: this app already asks for that at `OnboardingScreen.kt:258`, was granted it, and
is background-restricted regardless. Conflating the two would produce a prompt that changes nothing
and a user who has already said yes.

**Relationship to defect 100:** if the appop experiment shows the foreground service surviving with
the op set to `allow`, then 100 is not a code defect at all and this is the whole of it. If it does
not, the op is a red herring and 100 stays open on its own terms.

---

**What was built on 2026-09-11, and the one thing that was not.**

The fix direction above, taken as written and no further:

| | |
|---|---|
| the reading | `BackgroundRestrictionReading.isSet` — `ActivityManager.isBackgroundRestricted()`, one home, two callers on purpose |
| the gate | `Contract.needsForegroundService`, true for `mirror` and **nothing else** |
| to the Mac | `BackgroundRestriction.CAPABILITY_REASON` through the existing `unavailable` map. **No protocol change** — this is what that map is |
| on the phone | a card at rest on the Mac screen, above Advanced, with the two taps named and a deep link to App info |
| at the stop | `MirrorStopReason.AndroidRevokedWhileRestricted` — see defect 104 |

**The restriction is not blanket, and that is a measurement rather than caution.** With the op set
on this handset for twelve hours, `sms`, `contacts`, `notifications` and the rest went on answering
normally; the one thing that failed was the one thing that needs a foreground service. Withholding
everything would have drawn a wall where there is none, and `BackgroundRestrictionTest` asserts the
**whole** reached set rather than mirror's membership of it, so widening has to be deliberate.

**Two callers for one reading, on purpose.** `CapabilityDetector` asks on every refresh, which
decides whether `mirror` is advertised; `MirrorEngine` asks again when a projection is revoked,
which decides what the stop sentence says. One UI can set the op while the app is backgrounded —
the exact window no refresh covers — so the second reading is not redundant. There is no watcher
because there is no public `OPSTR_` constant for `android:run_any_in_background`, and hardcoding an
undocumented string to depend on it firing is worse than re-reading.

**Taken on hardware 2026-09-12 — `docs/testing.md` → Phase 7 Slice 42.** Card absent → present →
absent, with the dump at **18,248 → 20,798 → 18,248 bytes**, identical byte-for-byte either side;
`mirror` left the advertised set and returned while the other nine capabilities did not move; and
the Mac's chip carried `CAPABILITY_REASON` verbatim on both of its routes. **The restore is the
reading that mattered** — a card that appears and never leaves is a different defect, and the third
row is what excludes it.

~~**The part that is not done, stated as a gap rather than a caveat: this call has never once returned
`true` on any device in this project.**~~ **Struck 2026-09-12** — it has now, and the paragraph below
is kept because the stimulus it names is the one that was run. The op was restored to `allow` on the S25 at the owner's
instruction, and it is unset on both Motorolas and the vivo. So what is proven is the rule — 23
tests, 12 mutations, every one red, including the original defect sentence restored — and what is
unproven is the *write*, which is precisely the `LinkWaitStatus` split: eleven green tests over a
decision, and a feature that had never worked. The stimulus is one command and costs a minute:

```
scripts/adb-pinned.sh samsung shell cmd appops set com.chetan.connectsuite.debug RUN_ANY_IN_BACKGROUND ignore
# expect: the phone's Mac screen draws the card; `mirror` leaves the advertised set;
#         the Mac's Mirror pane greys with CAPABILITY_REASON
scripts/adb-pinned.sh samsung shell cmd appops set com.chetan.connectsuite.debug RUN_ANY_IN_BACKGROUND allow
```

Its control is the second command: the card must **go away**, and `mirror` must come back. A card
that draws in both states is a card that is not reading anything.

### 103 — `LinkService` believes it is foreground forever · **fixed 2026-09-14** · found 2026-09-10

```
LinkService.kt:50    private var isForeground = false
LinkService.kt:108   if (!isForeground) { … startForegroundWithStatus(…) … }
LinkService.kt:244   isForeground = true
```

Three sites. No fourth. Once the flag is `true` it is `true` for the life of the process, so a
service the platform has demoted will never ask to be foreground again.

**How it showed:** lifting the background restriction (defect 102) fixed the mirror within one tap
and did nothing for the link. `MirrorService` calls `startForeground` unconditionally in
`onStartCommand` and so re-claimed the state by itself; `LinkService` guards that call behind the
flag and stayed demoted — `isForeground=false types=0x00000000` on a ServiceRecord alive 12 hours
with `startForegroundCount=1`.

**Fix direction: stop tracking it.** `MirrorService` is the worked example in the same codebase —
call `startForeground` unconditionally on every start command and let the platform be the source of
truth. If a field is kept for logging, it gets defect 97's treatment: one writer per direction, and
never a reader standing in for the platform's actual state.

**The wrong fix is polling for the real state.** There is no public API for "is my service
foreground", and the obvious proxy — process importance — is masked by any visible Activity
(`IMPORTANCE_FOREGROUND` 100 outranks `IMPORTANCE_FOREGROUND_SERVICE` 125). That was measured on
2026-09-10 and returned nothing.

**What is owed:** the runtime demonstration. `am start-foreground-service` cannot deliver it —
the service is `exported=false` and adb's shell uid is refused — so the test needs an in-app trigger
or a fresh process, and until it runs this defect rests on reading the source.



### 104 — eight stop sentences, two three words apart · **fixed 2026-09-11** · found 2026-09-11

```
"restarted by the Mac"      "the Mac disconnected"      "mirror feature uninstalled"
"restarted from the phone"  "stopped on the phone"      "mirror service destroyed"
"stopped by the Mac"        "screen capture was stopped on the phone"   ← the platform's
```

`MirrorEngine.stop` took a free `String`. Eight call sites, eight sentences, no type. Two of them
are three words apart, and the three words are the whole meaning: *"Stopped on the phone."* is a
person tapping Stop, *"Screen capture was stopped on the phone."* is Android revoking the
projection.

**The cost is measured, not hypothetical.** Through defect 102 the second sentence was the only
thing the app ever said, eight times in a row, while the mirror died at 107-116 ms — so the phone's
owner was told eight times that the stop had happened *on the phone*, which is true of the location
and false of the agent, and the fact that would have ended it in one reading was never shown.

**The platform hands back no reason.** `MediaProjection.Callback` on `android.jar` 36.1 is
`onStop()`, `onCapturedContentResize` and `onCapturedContentVisibilityChanged`; `MediaProjection.stop()`
takes no argument. Checked rather than recalled, because the fix depends on it. So the reason is
**derived** from the one question the app can answer at that instant.

**Why there is no third revoke member.** *"You stopped it from the notification shade"* is the
commonest benign revoke and would be a pleasant sentence. From inside the app it is
indistinguishable from an unexplained revoke — same callback, no argument, no extra, foreground
service alive in both — so `AndroidRevoked` names both possibilities and claims neither. This is
the folder-picker rule: when the platform returns one result for two intents, nothing may be
explained afterwards.

**The wrong fix, written and then thrown away, is the part worth keeping.** The first test asserted
that no two sentences were *too alike*, by word-set overlap. It is a proxy for the rule, it looked
rigorous, and it **passed with the exact defect sentence restored** — because the sibling sentence
had meanwhile been reworded, so the pair was no longer close even though the defect was back. The
rule is **attribution**, not similarity: a stop Android caused must name Android and must not say
*you*. That is now an `Actor` on the type and an assertion that the sentence agrees with it, and
mutation M7 goes red on it.

One more thing fell out. `fail()` used to stringify the failure's sentence into `stop()`, watch
`stop()` overwrite it with a mechanical one, and then restore it on top — three writes to one field
to end where one would do, which is `CLAUDE.md`'s two-writers-on-one-surface with the writers a few
lines apart. `MirrorStopReason.Failed` carries the failure through, and `stop()` publishes the
`fixHint` it was throwing away.

### 105 — the float's decoder never starts · **fixed 2026-09-13** · found 2026-09-12

```ts
push(frame: H264Frame): void {
  if (frame.config) { … this.configure(); return; }

  const decoder = this.decoder;
  if (!decoder || decoder.state !== 'configured') return;   // ← drops IDRs too

  if (this.awaitingKeyframe) {
    if (!frame.keyframe) { this.hooks.requestKeyframe(); return; }   // ← never reached
```

The recovery path is below the return that makes recovery necessary. A float with no decoder is
unreachable from its own fix.

**Why it is intermittent rather than constant.** `main.ts`'s `onReady` replays the retained config
to the new window. When that replay arrives after the float's listeners are registered the decoder
configures and everything works — observed on 2026-09-12, `1 asked / 1 answered`, decoding. When it
arrives first, nothing ever configures and the window is black and silent for the life of the
session. **The race is the defect**, which is why the fix is the start contract and not a retry.

**Fix direction — the float asks, main answers.** The float requests the parameter sets once its
listeners are up; main replies with the retained config, or says plainly that there is none. One
request in flight, rate-limited — the phone rate-limits its own keyframe requests with a comment
explaining why, and neither Mac decoder does.

**The wrong fix is hoisting the keyframe request above the return.** It trades a silent black window
for a request storm against a decoder that still cannot use the answer, and the storm is harder to
see than the silence.

---

**Fixed 2026-09-13 — and the race was produced on demand, which is the part that makes this a fix
rather than a description.** `docs/testing.md` → Phase 7 Slice 45.

The contract: **the consumer asks, the producer answers.** The float emits `stream-start` immediately
after its own `floatBridge.on…` registrations — a fact only it can know — and main replies to
`event.sender` with the retained config or with `null` plainly. There is no window event in the path,
so there is nothing to win or lose.

| | with the ask | without it |
|---|---|---|
| `droppedWithNoDecoder` | **1**, then recovery | **730**, climbing |
| keyframes requested | 1 | **0** — nothing ever asks |
| decoder | configured at +3.0 s, decoding at +3.9 s | never |
| the card | hidden; it is mirroring | the no-parameter-sets sentence, showing |

`requested: 0` is this defect read straight off a running window: the recovery path is below the
return, so nothing asks, so nothing arrives.

**Two things were nearly shipped wrong and are worth keeping.** `sessionRunning` was first derived
from `config !== null`, which would have made `actionFor`'s `ask-again` branch **structurally
unreachable** — a state drawn beside states that can happen. It reads `video.isOpen()` instead. And
the in-flight gate releases after 5 s: a rate limiter whose answer never comes would otherwise hold
the gate shut forever, which is this defect's own silence with a limiter in front of it.

**`delayFloatListeners` stays after the fix**, for the same reason the other five debug switches
stay: the next person to touch the start path needs to be able to lose the race on purpose.

### 106 — the keyframe path was silent at both ends · **fixed 2026-09-12** · found 2026-09-12

Six discards, three per side. The Mac's three all read `.catch(() => undefined)`; the phone's were a
handler that logged nothing, a `?.` that swallowed a request with no encoder, and an encoder method
that logged **only its failure** — which is `CLAUDE.md`'s own success-case rule broken on the one
call whose entire purpose is to produce a frame.

**What the first run of the instrumentation found, within nine milliseconds:**

```
15:25:12.278 [float]  asking the phone for a keyframe (1 asked / 0 answered)
15:25:12.279 [mirror] keyframe requested — 1 requested / 0 acked / 0 answered by an IDR
15:25:12.287 [float]  keyframe reached the decoder          ← 8 ms after the request
15:25:12.288 [mirror] keyframe request acked                ← the ack arrives AFTER the frame
```

**The frame beat the ack.** That IDR was already in flight when the request went out, so the request
had nothing to do with it — and a cruder instrument would have counted it as an answer and reported
the keyframe path as working. `KeyframeTrace.onKeyframe()` returns null unless a request is
outstanding for exactly this reason.

It also caught a counter of mine that could only ever read zero: `answered by an IDR` was tallied on
the Mac but nothing called `onKeyframe()` from the video path, so the line would have read
`N requested / N acked / 0 answered` forever. **A counter that cannot move is worse than no counter**,
because it reads as a finding rather than as an absence.

### 107 — two float states, one sentence · **fixed 2026-09-12** · found 2026-09-12

See the table. The distinction that matters is `blocking`: `awaiting-keyframe` clears itself the
moment the phone answers, and `no-parameter-sets` never clears, because the code that would ask is
unreachable from it. A test asserting only the wording would pass on a reworded sentence — the same
proxy failure as defect 104's word-overlap check — so the assertion is on the flag.

### 108 — the latency anchor subtracted the encode stage · **fixed 2026-09-13** · found 2026-09-13

The pair `mirror.stats` sends describes **two different moments** of one frame:

| field | stamped | by |
|---|---|---|
| `ptsUs` | when the display pipeline composited it — **capture** | the Surface |
| `monoUs` | `System.nanoTime()` at `dequeueOutputBuffer` — **after encoding** | our own loop |

The Mac treated the second as the first. So `capturedAtMacMs` returned the encoder-output instant,
and **the encode stage was not measured, it was subtracted** — 14 ms of a 32 ms total, 44% of the
figure, on this handset at idle.

**The fix is arithmetic, not a protocol change**, and that is the part worth carrying: the two
timestamps a stage breakdown needs were on the wire the whole time. Reading them as one anchor pair
rather than as two boundaries is what lost the stage.

**What had to be measured rather than reasoned:** whether PTS shares a timebase with `nanoTime`. It
does here (17,696 µs and 15,377 µs — encode durations, not uptimes). Had it not, capture time would
be unknowable on the phone, because nothing in this app observes a frame before the encoder returns
it — and the honest report would have been a pipeline starting at encoder output, **labelled**. That
label now ships on every figure as `origin`.

**Taken 2026-09-14, and every suspect failed it.** `docs/testing.md` → Phase 7 Slice 47. At 60 fps
and again at 120 fps the phone dropped **0** frames and the Mac painted everything; the wire stage
*improves* as the rate doubles (14 ms idle → 7 → 6), which is the opposite of a queue or a
write-pattern bottleneck. `QUEUE_DEPTH` was never under pressure and `writeFrame`'s 240 writes/s at
120 fps cost nothing measurable.

**A fourth fact fell out and is worth recording even though it is not a loss mechanism:**
`KEY_FRAME_RATE = 60` is a rate-control **hint** on a Surface input, not a cap, so on this 120 Hz
panel the encoder really emits ~120 fps. It costs CPU and halves the bits per frame at a fixed
8 Mbps. Nothing is dropped because of it.


### 111 — a scroll shorter than the touch slop is a tap · **fixed 2026-09-15** · found 2026-09-15

`input.scroll` is dispatched as a two-point stroke over 100 ms at exactly the distance the Mac asked
for. Android's `View` layer eats `ViewConfiguration.getScaledTouchSlop()` of every stroke deciding
whether it is a press or a drag — **30 display pixels** on this handset, 8 dp at 600 dpi, read from
`wm density` rather than assumed. Two consequences, and only the first was reported:

| | |
|---|---|
| a stroke **under** the slop | press and release in one place, which is a **tap** on whatever is underneath |
| every **other** stroke | scrolls one slop less than it was asked to, silently |

Measured from the Mac's own historical log, 138 real `input.scroll` messages: **35 of them (25.4%)**
travelled under 30 display px, and the median of the rest asked for 77 px of content movement and
moved it 47. An isolated `dy = -17` capture px — one mouse wheel notch — is 22.7 display px and
appears six times unprompted, seconds apart. That is the YouTube report exactly.

**The fix extends the front of the stroke, not the end.** Extending the end would scroll further than
the wheel asked; moving the start backwards makes the finger pass *through* the point the Mac aimed
at. Where the display has no room behind the start the end takes the balance, and what neither can
take is published as `shortfallPx` on a warning line with the whole-stroke count beside it.

**Proven on hardware, both arms** — `docs/testing.md` → Phase 7 Slice 53a. The APK went on with
`adb install -r` through the pin (28 of 28 grants preserved, both bindings intact, started by name and
confirmed with `scripts/link-up.sh`), and the same sweep was run against the shipped build and the
fixed one:

| | before | after |
|---|---|---|
| sub-slop requests in the sweep | 4 of 6 | 4 of 6 |
| of those, Android **navigated** | **4 of 4** | **0 of 4** |
| of those, Android scrolled | 0 of 4 | **4 of 4** |
| the phone's own execution line | 0 of 6 | 6 of 6 |

`deltaY = 17` is the row that matters: one isolated mouse-wheel notch, the value that appears six
times unprompted in the user's own log, opening a settings screen on the build that shipped.

**The probe refuses to sweep until its discriminator has fired.** The finding is an absence, and
`topResumedActivity` failing to move would make every row read `scroll` on any build — so a real tap
is dispatched through the product's own path first and the activity must change
(`SettingsHomepageActivity → SubSettings`), or the run exits without measuring.

**The under-travel half stopped being arithmetic.** The before arm's own warning lines say it per
scroll: *"the content will move -26px of the 3px asked for"*, *"98px of the 128px asked for"* — a
negative movement for the small ones and a flat one-slop shortfall on the large ones.

### 112 — the Mac produced scrolls at twice the rate the phone could run them · **fixed 2026-09-15** · found 2026-09-15

| | |
|---|---|
| produced, at `WHEEL_WINDOW_MS = 60` | up to **16.7** `input.scroll` per second |
| consumed, median of 181 back-to-back gestures in the phone's own log | **8.55** per second (117 ms each) |

The phone serialises `dispatchGesture` behind a `Mutex`, so the difference queued in `InputClient`,
and its 400 ms staleness rule discarded the overflow: **14 scrolls dropped after waiting 403–486 ms**,
each putting a sentence on the canvas mid-flick. A mouse never fills an 8-deep queue; a trackpad,
plus macOS's momentum tail, fills it every time.

**The clock is the phone's reply now** — one gesture in flight, everything arriving meanwhile summed
into the next — so the two rates cannot disagree on any hardware for any input device. A longer
window was rejected: it is the 263 ms sampling window with a bigger number in it.

**The report's "drop momentum-phase events" cannot be written.** Chromium's DOM `WheelEvent` exposes
no `phase` or `momentumPhase`. Under backpressure it does not need to be: the tail folds into the sum.

After: 40 wheel events over 600 ms → **7 gestures, 0 dropped**, median send gap **118 ms**.

### 113 — the floating window could not be dragged onto a second monitor · **fixed 2026-09-15** · found 2026-09-15

`WorkArea` was `{ width, height }`. Every coordinate in `floatGeometry.ts` is a **global** screen
point, and a second display's work area starts at x = 1512 — or at x = -1920 when it sits to the
left — so `clampX` measured a global x against a width as though every display began at (0,0).

`moveTo` re-clamps on every pointer move, so the window did not merely refuse the second display: it
**snapped back under the cursor once per event**, which reads as being glued down.

All three causes the report proposed were wrong, and the third is the instructive one: the display
*was* always chosen correctly by `getDisplayMatching`. Its origin was discarded one line later, by a
`{ width, height }` literal built from a rectangle that had four fields. The fix makes `x` and `y`
**required** — optional fields would have let the bug survive at every call site in silence, where
the compiler instead named the single line that dropped them — and routes every construction through
one `areaOf()`.

A drag is clamped against the display the **pointer** is over rather than the one the window is on:
during a crossing the cursor has moved and the window has not, so clamping against the window's
display pins it at that edge and the handover can never complete.

### 114 — the floating window never turned when the phone did · **fixed 2026-09-15** · found 2026-09-15

`RATIO = 19.5 / 9` at module scope, read by four functions. The main window's stage follows the phone
through `--capture-aspect` on both writes of `this.capture`; the float's outer bounds followed
nothing, so landscape content sat letterboxed in a portrait frame at a fifth of the area.

**Keeping the width and re-deriving the height is what produces "renders tiny"** — a 300 × 684
portrait window becomes 300 × 157 — so the fix preserves the **picture's area** and solves for the
width, holds the top-left, and re-clamps through `resolveBounds`. `ratioOfCapture` returns `null`
rather than a portrait guess, because *"the phone has not said"* and *"the phone is portrait"* are
different facts.

Proven on hardware, both directions: `2.167 → 0.462, window 970x465` and back to `467x968`, with the
picture area identical at 402,554 either way.

**It also exposed a live gap nobody was looking for**: `clampWidth` bounded width by the available
*height* only, which no 19.5:9 window can ever hit and a landscape one hits at once — a 500 pt-wide
work area produced a 985 pt window.

### 115 — the float's phone controls were invisible, over the picture, and on the nav bar · **fixed 2026-09-15** · found 2026-09-15

Reported as *"at the top, where other app windows can cover them"*. **Measured on the running window
first, they were at 92% of the way down** — the bottom. That half of the report does not describe
this build and is recorded rather than quietly fixed.

What does describe it is three faults in one control:

- `opacity: 0` until hovered, on the one window in this app whose purpose is to be watched while
  something else has focus — which is exactly when the pointer is not in it.
- A pill **over the canvas**. `float.css` had already written down that this would be *"a silent dead
  zone"* once the canvas took input. The canvas took input on 2026-09-14 and the warning came true.
- `bottom: 36px` on a ratio-locked window, which is where Android draws its own gesture bar, so the
  Mac's Home button sat on the phone's Home.

The strip is permanent and **real estate rather than an overlay**: it comes out of the window
exactly as `TITLE` comes out of the height, so nothing covers a part of the phone's screen the canvas
would otherwise accept a tap on. Measured after: `opacity 1`, 5 controls counted as elements,
`overlapsPicture false`, picture ratio 2.172 against the announced 2.167.

**The placement is superseded.** 115 put it on the **right edge** as `RAIL = 36`, a width; **defect
118** moved it to the bottom as `BOTTOM_BAR = 40`, a height, later the same day. The three faults
above are what 115 fixed and none has come back — what changed is the axis, not the argument.

### 116 — a float opened mid-session did not know the phone's screen shape · **fixed 2026-09-15** · found 2026-09-15

`capture` in `float.ts` was written from `mirror.rotate` alone — sent when the phone turns and at no
other time. A window opened into a running session therefore held `null` until the user **physically
rotated their phone**, and every press answered *"The phone has not said what shape its screen is
yet, so that was not sent"* about a shape the main window had known since `mirror.state`. A sentence
true of that window and false of the system.

Three sources now, one writer: `mirror.rotate`; `mirror.state`, **which this window already received
and was throwing the geometry away from**, reading only the message; and the answer to
`stream-start`, where the main process retains the last announced geometry and hands it back beside
the retained parameter sets — same door, same argument, since the session began before this window
existed and neither fact will be announced again.

Cleared on `stopped`, so a gesture cannot be stamped with a screen the phone has left: that refusal
would read to the user as staleness for a mirror that is simply off, which are two different
sentences.

### 117 — no way back to the main window while floating · **fixed 2026-09-15** · found 2026-09-15

`app.on('activate')` was the Electron sample: `if (getAllWindows().length === 0) createWindow()`.
Correct for a one-window app and a **no-op the moment there are two** — with the float open the count
is 1, so clicking the Dock icon did nothing at all.

Nothing was hidden or destroyed. The main window was behind whatever the user had been doing, with no
route forward anywhere in the product except closing floating mode — which is exactly the workaround
that was reported. The tray's *Open ConnectSuite* was a third half-answer: no `restore()` for a
minimised window, no `focus()` for the one it showed. There is no application menu at all.

`revealMainWindow(why)` is one function with four callers — Dock, tray, the float's control strip,
and any future menu — each naming itself in the log, because *"the main window came forward"* with no
reason attached is defect 80's single `UNKNOWN` one product surface over.

**It does not touch the float and must not.** The session lives on the link rather than in either
window, so revealing one costs the other nothing; closing the float to satisfy the request would be
the workaround the user already had. The control reports what actually happened — the main process's
own reading of whether the float survived — rather than asserting it did.

### 118 — the float's controls move to a bottom bar, and get tooltips · **built 2026-09-15** · asked 2026-09-15

An **enhancement**, recorded with the defects because it changes an invariant that three closed
defects depend on and because one real fault fell out of building it.

Defect 115 made the float's phone controls permanent and put them in a **right-edge vertical rail**,
`RAIL = 36` taken out of the window's width. The owner asked for Android's own shape instead:
buttons in a row, under the picture, in their own strip.

**The axis swap is the change, and the two axes are not symmetric.**

| | |
|---|---|
| **width** | had one consumer of side chrome, arithmetic only. `RAIL` gone → the picture is the whole window width, and nothing else moves |
| **height** | already had `TITLE = 34`. `BOTTOM_BAR = 40` joins it, so the **height budget shrinks** and every function turning available height into a width caps lower. The README's ≈401 at 920pt becomes **383** |

`RAIL` is **deleted rather than zeroed** — a constant at 0 is one autocomplete from being subtracted
again, the same argument that keeps `APPS_LAUNCH` out of `MessageType` — and deleting it made the
compiler name every call site.

The README figure is not quietly redefined: the transcription test asserts **both** numbers, the
document's own formula (401, `TITLE` as the only chrome) beside ours (383, with the bar).

**Defect 114's landscape width cap was re-checked, not assumed.** It reads `area.width`, which this
change does not touch, and mutation M8 confirms its test still goes red after the swap.

**Tooltips.** `title` is the app's pattern (11 uses, no CSS tooltip anywhere) and it was on these
buttons. It never fires on **keyboard focus**, so the bar draws its own: 450 ms on hover, **0 ms on
focus**, dismissed on leave, blur, click and Escape, with `title` removed rather than left alongside.
The text comes from `floatRailTooltip` in the same table as the label and the icon; Back, Home and
Recents carry **no** second literal and fall back to their accessible name. The reveal control's
accessible name stays defect 117's full sentence while its tooltip is the short form — asserted in
both directions, because shortening the tooltip by shortening the label is the way this goes wrong.

It overlaps the picture's bottom edge by **24 px**, which is reported rather than claimed away: a
40 px bar cannot contain a tooltip and below it is outside the window. `pointer-events: none` is what
makes that harmless.

**A dead CSS rule fell out, and it never shipped.** The group separator was
`.bar-button.bar-mac:first-of-type::before`. `:first-of-type` is about the **element type** — it means
*the first `button`*, which is Back, and Back has no `bar-mac` — so the selector matched nothing.
`tsc` clean, 22 stylesheet tests green, no hairline drawn. It is the empty-ring icon defect in CSS,
and a screenshot could not have found it: a missing 1 px hairline looks like a design choice. It was
found by reading `getComputedStyle(b, '::before').content` on all five buttons and getting `none` from
every one. The boundary is named by the table now, and exactly one button reports `content: ""`.

**Verified on hardware, portrait and landscape** — `docs/testing.md` → Phase 7 Slice 54. Bar height
**40**, spans the window, `overlapsPicture: false` with a gap of 0, all five buttons fully on screen,
order read from the buttons' own rects as `back, home, recents, shot, reveal`, and the picture's
aspect agreeing with the phone's announced one in **both** orientations (2.174 vs 2.167; 0.461 vs
0.462). The landscape column arrived unprompted — the phone turned mid-run — which makes it defect
114's fix re-proved on the new axis rather than a case anyone set up.

**The reference for this change could not be read.** No screenshot arrived with the request, and its
text describes the buttons as *"Recents, Home, Back"* while asking for them ordered *"Back, Home,
Recents"* — the two conventions, Samsung's and AOSP's. The handset cannot settle it either:
`navigation_mode = 2` is gesture navigation, so it draws no three-button bar, and the Samsung order
keys read `null` **including the control key**, so that query held no information rather than
reporting "unset". The order shipped is the owner's explicitly stated one, asserted by test because
it is a one-line flip nothing else would notice.

---

### 119 — three colour tokens against the design, and a note whose evidence was inverted · **fixed 2026-09-16** · found 2026-09-16

Found by the sweep that had to precede the light theme, not by looking at a screen — a violet is a
violet, and nothing renders *wrong* when the wrong one is drawn.

| token | `tokens.css` held | in the design | the design's value | in the design |
|---|---|---|---|---|
| `--accent` | `#7c6bff` | **0** | `#8B6BFF` | **42** |
| `--live` | `#34d399` | **0** | `#32E58A` | **47** |
| `--destructive` | `#ff6b81` | **0** | `#FF5D5D` | **22** |

**The record is worth more than the divergence.** The block above `--accent` claimed the opposite,
in detail, with counts. Every count is inverted. It was written as a *correction*, dated, and
argued from "reading the source rather than the summary of it" — which is the right method,
executed with `grep -c`. `grep -c` counts **lines**; `ConnectSuite.dc.html` puts dozens of literals
on one. The method was sound and the instrument silently divided by the wrong thing.

So this is the **confirming-reading** entry in `CLAUDE.md` with the roles reversed: not an
instrument fault that flattered a hypothesis, but one that produced a *surprising* result nobody
re-checked because it arrived already labelled as a correction of somebody else's error. A
paragraph that says "this was wrong for the whole build and nothing could have caught it" reads as
the output of exactly the scepticism that would catch it.

**Why the literals mattered.** Eleven `rgba(50,229,138,…)` in the stylesheets, `139,107,255` in
`navModel.ts` and `activity.ts`, `#8B6BFF` in the `icons.ts` brand gradient — all of them looked
like drift and all of them were **the design, still correct**, left behind when the tokens moved.
The 2026-09-05 change reached `tokens.css` and nothing else, so the app drew the design's colours
everywhere a token was not consulted and the substituted ones everywhere it was.

**The wrong fix**, and it was one keystroke away: retarget the literals onto the tokens. That is
what "150 raw literals" invites, it makes every checker green, and it would have finished the job
of erasing the design's palette from the repository.

---

### 120 — the shortcut hint was 3.89:1 in the shipped dark build · **fixed 2026-09-16** · found 2026-09-16

`.hero-key`, the `⌘⇧M` beside **Start mirroring**. `--accent-on-fill` on `--accent` is **5.27:1**
and clears AA; `opacity: 0.75` takes it to **3.89** at 11px/600, which needs 4.5.

**Neither a token nor a pair is wrong, so no palette audit can reach it.** `check-contrast.mjs`
reports the pair clean and is right to. The failure is composed at paint time out of two correct
things and a third that is not a colour at all.

Fixed at `opacity: 0.9` — 0.85 is the first passing step (4.51 / 4.81) and 0.9 leaves margin
without the hint reading as loud as the label it sits beside.

**Its sibling, same shape, light only:** the selected filter pill at **4.43:1**. Its ground is
`--well`, not a card — the same two tokens read **5.04:1** on a card, and the first attempt at a fix
solved against the card and would have shipped a value that still failed. Solved against the real
ground by lowering the light `--accent-tint-selected` to 0.10; dark untouched, 4.73:1 on its own well.

**The rule this leaves:** a palette checker proves the palette. Opacity, gradients, and *which*
surface a thing actually lands on are outside it by construction, and the only instrument that sees
them is one that reads what the browser painted.

---

### 121 — theme-following text on a scrim that does not follow the theme · **fixed 2026-09-16** · found 2026-09-16

`--media-scrim` is the one colour in `tokens.css` that is deliberately identical in both themes,
and the reason is written beside it: it sits over an arbitrary user photograph, not over a themed
surface, so inverting it would make it unreadable in exactly the case it exists for.

`.pane-mirror .mirror-overlay` and `float.css`'s `.float-reason` drew `--text-body` on it. In dark
that is a light grey on a dark scrim and reads at 12:1. In light `--text-body` is near-black:

```
  1.67:1   .mirror-overlay   "Not mirroring."   rgb(90,93,107) on rgb(60,60,63)
```

**Every token here is correct, and the pair that fails is never declared anywhere.** It exists only
because one rule sets a background and another sets a colour, and the cascade brings them together.
That is the Muted pill's 2.23:1 one layer up — there a specificity collision, here a semantic
mismatch — and it is the argument for the rendered-DOM sweep existing beside the token one.

Fixed with `--text-on-media` and a new `--text-on-media-dim` for the hint weight; both are now
explicit pairs in `check-contrast.mjs` (19.76:1 and 10.24:1), which they were not before, because
nothing pairs a token with a surface until someone says they belong together.

**Diagnosing it took one measurement and no reasoning.** The overlay's computed background is
`rgba(7,7,10,0.78)` — `--media-scrim` — arriving from `.pane-mirror .mirror-overlay`, which outranks
the `.mirror-overlay` rule 2,000 lines earlier that sets `--surface-tooltip`. Reasoning from the
first rule gives 0.9-alpha white over black ≈ 225, and a confident wrong diagnosis.



### 136 — the phone's media.thumb returns more than maxEdge · **fixed 2026-09-29**

Asked for `maxEdge: 512`, the SM-S938B answered **640 × 480** (a 1280 × 960 JPEG) and **453 × 806**
(a HEIC). The contract says the phone fits inside `maxEdge`.

**Fix direction:** after `ContentResolver.loadThumbnail(uri, Size(maxEdge, maxEdge), …)`, scale the
bitmap so its long edge is at most `maxEdge` before encoding, and report the produced size — some
providers return a thumbnail at least as large as requested. A JVM test can hold the fit arithmetic.
**The wrong fix is loosening the contract** — `maxEdge` is what bounds a 32-item `media.thumb` frame.


### 137 — the phone lists 0 entries for every granted SAF tree · **open, boundary: the provider**

Persisted grants (`persisted=0x3`) for DCIM, Documents and Pictures; `SafTreeStore` reads 0 children
for each, while `fs.stat` reads the same trees as directories and `media.*` serves DCIM/Camera. It
flipped inside one process, 00:47:44 (DCIM 29) → 00:53:27 (Documents 0), on 2026-09-23.

**Probe, 2026-09-23 10:06 (debug build, `-r` install, grants and trust unchanged).** One children query
per tree root through the product's own path, capped at 20 rows: cursor returned, five columns,
**count 0**, no extras, no exception — the parse never saw a row. The directories hold 29 / 1 / 229
entries on disk (shell `ls -A`, counts only). The provider process restarted at 09:05:58 and still
answers 0. That is what Sidekick **received**; **why** the provider returns zero to this app is not established. **Fix direction:** find why `ExternalStorageProvider` returns an empty children cursor to this
uid; do not re-request grants, do not fall back to another client, do not call the folders empty.

### 138 — the Files list's name column collapses at the window minimum · **fixed 2026-09-23**

At 1100 × 700 the row columns compute to `0px 180px 90px`. Pre-existing (the rule predates Feature D).
**Fix direction:** a container query on the listing that drops the date column below ~420 px, or a
name floor with a shrinking date column.
### 139 — the checklist's Photos row misreports limited access · **fixed 2026-09-23; verified on the SM-S938B end to end**

**SM-S938B, 2026-09-23 15:00:** selected-only (Settings *Allow limited access*, then *Change selection* → Android's *access more photos* dialog → its picker, three synthetic images added) → the row *Some photos allowed* · *Change selection* · *Open photo settings*; the phone sent `photos` with `limited: photos — Some photos allowed — only the photos and videos chosen on the phone are shared…`; the Mac's Photos pane drew *Some photos allowed* and that sentence verbatim. Full access (Settings *Always allow all*) → `limited: none` → no notice on the Mac, row *On*. **One gap:** the full-access grant reached the Mac only when Sidekick resumed (15:03:47; the phone's last line before that, 15:02:31, still said limited, with Settings in front) — the detector watches the Settings-toggle grants, not runtime permissions. `docs/testing.md` → *Feature E — SM-S938B verification*.

**Emulator, 2026-09-23 afternoon:** full, selected-only and denied each read correctly from a real dialog or Settings choice, and each survived a process restart; *Change selection* opens Android's own dialog, then its picker once the choice is fixed; the OS no longer hands out a compat grant. **Still unobserved:** the `limited` field on the wire and the Mac pane's wording — the Mac holds one phone, and pairing the emulator would have replaced the SM-S938B. New limitation: once Android fixes a limited choice, full access is reachable only through Settings. `docs/testing.md` → *Feature E — emulator verification*.

**Fixed in code 2026-09-23; not yet seen on a device.** Following Android's Selected Photos Access guidance: `READ_MEDIA_VISUAL_USER_SELECTED` is declared and requested with the two media permissions on 34+, which ends compatibility mode. One state, `MediaAccess` (full = images **and** videos, or storage ≤ 32; selected = the selected-photos grant alone; else none), is read by `MediaFeature`, the `photos` capability contract and Set up Sidekick. Selected-only keeps `photos` advertised and adds it to a new optional wire field, `limited`, with the phone's sentence; the checklist row reads *Some photos allowed* with *Change selection* (the platform request again); the Mac's Photos pane draws *Some photos allowed* and that sentence. Red-first: 6 phone mutations and 2 Mac mutations, each red on its own tests — including the missing declaration, which the existing manifest test did **not** catch. **Unreached by any test:** the detector's `refresh`, the JSON the session emits, `link.ts`'s assignment, `renderer.ts`'s hand-off, and what Android grants for each dialog choice. Emulator run blocked (Mac disk)

**Fix direction:** declare `READ_MEDIA_VISUAL_USER_SELECTED`, request it with the two media permissions, and give partial access its own state in **one** place `MediaFeature` and the checklist both read (e.g. *Some photos allowed* with *Change* re-opening the platform dialog). **The wrong fix is relabelling the Setup row alone** — the row and the Mac's capability would then disagree, which is what reading `MediaFeature.granted` exists to prevent

**Fix direction:** declare `READ_MEDIA_VISUAL_USER_SELECTED`, request it with the two media permissions, and give partial access its own state in **one** place `MediaFeature` and the checklist both read (e.g. *Some photos allowed* with *Change* re-opening the platform dialog). **The wrong fix is relabelling the Setup row alone** — the row and the Mac's capability would then disagree, which is what reading `MediaFeature.granted` exists to prevent

### 140 — the checklist is reachable only through the Folders drill-down · **fixed 2026-09-23, verified on the emulator and the SM-S938B**

**SM-S938B, 2026-09-23:** paired, Devices → gear → Mac management carries the card above *Paired Macs*, visible at rest; it opens the checklist (8 of 9 on, matching the OS); Done returns to Mac settings.

**Emulator, 2026-09-23 afternoon:** Devices → gear → *Set up Sidekick* renders and opens the checklist; Back returns to Mac settings, then Devices; Done returns to Mac settings; five relaunches landed on Devices, never the checklist. The card sits below the fold on unpaired Mac settings (one scroll). `docs/testing.md` → *Feature E — emulator verification*.

**Fixed in code 2026-09-23; not yet seen on a device.** The Devices gear opens Mac settings, and both of its states now carry a *Set up Sidekick* card (`SetupEntryCard`): the pairing screen at its entry stage (never over a pairing in flight) and Mac management, above the paired list. It pushes the existing `ROUTE_SETUP`, so Back and Done both pop to Mac settings; the five tabs are unchanged and the checklist is still landed on only when onboarding completes. `SetupReachabilityTest` reads that wiring — red under three mutations (gear unwired, Mac management not handed it, a second landing on launch). **The rendered route and Back were not exercised**: the emulator could not be used (Mac disk full)

**Fix direction:** one entry from a top-level surface a person opens anyway (the Devices screen, or the Transfers header beside *Manage folders*), navigating to the existing `ROUTE_SETUP`. **The wrong fix is re-showing the checklist on launch** — it would nag everyone who has finished with it

**Fix direction:** one entry from a top-level surface a person opens anyway (the Devices screen, or the Transfers header beside *Manage folders*), navigating to the existing `ROUTE_SETUP`. **The wrong fix is re-showing the checklist on launch** — it would nag everyone who has finished with it

### 141 — the checklist read the grant list itself · **fixed 2026-09-23**

**Fixed 2026-09-23.** The row and its count read `FsRoots.grantedTrees`. `AppGrantReaderTest` holds the same rule for `app/`, with a control that the scan sees 13 sources and the `FsRoots` call; red when the old line is restored

**Fix direction:** read through `FsRoots`; extend the single-reader rule to `app/`. **The wrong fix is a second filter in the screen** — two copies of one fact

### 142 — the checklist's buttons were unnamed for a screen reader · **fixed 2026-09-23**

**Fixed 2026-09-23.** Each button's description is `SetupPlan.buttonDescription` — *"Allow: Texts"*, *"Not now: Calls"*. Asserted per item (the description names that item's title and the button's words); red when the title is dropped

**Fix direction:** name the feature in the description, from one pure function the test calls. **The wrong fix is a unique visible label per button** — the design's repeated words are fine for sighted reading

### 143 — the battery row said Open Settings and raised a dialog · **fixed 2026-09-23**

**Fixed 2026-09-23.** The row says *Allow*; once refused for good it says *Open Settings*, and the notification-access and Control rows still say *Open Settings* because they do open it. Red when the rule is removed

**Fix direction:** word the action by what happens on tap. **The wrong fix is switching to the Settings list intent** to match the old word — the dialog is the shorter route

### 144 — the force-stop hook does not see `am start -S` · **fixed 2026-09-23**

**Fixed 2026-09-23.** A second matcher, per command segment: `am start` / `start-activity`, a short-flag token whose letters include `S` (`-S`, `-SW`, `-WS`), and our package, in either order. The `am force-stop` matcher is unchanged. `no-force-stop.test.sh`: four new deny fixtures (all four passed through the old hook) and four new pass fixtures (an ordinary `am start`, `-W` with adb's lowercase `-s`, `-S` on another package, `-S` in another command of the chain); 14 of 14

**Fix direction:** also deny `am start` carrying `-S` (alone or in a flag cluster) with our package, with a deny fixture and a pass fixture (an `am start` without `-S`). **The wrong fix is blocking `am start` on our package** — it is how `LinkService` is restarted after `install -r`


### 145 — the Devices screen says Offline while the Mac is connected · **fixed 2026-09-23**

**Fixed 2026-09-23** — `MacLinkView`, read by Devices and Mac settings; red under five mutations including the defect restored verbatim; live on the SM-S938B across a Mac quit and relaunch. Send files is gated on a send path existing (none yet — Feature A), not on the link. `docs/testing.md` → Defect 145.

**Was:** `DevicesScreen` takes `connected` from `Device.isConnected`, filled from the v1 `ConnectionManager`; the Mac link is v2. A true reading about the wrong one of two transports. Seen on the SM-S938B with the link up (`docs/testing.md` → Defect 145, screenshot `s-07-devices-after.png`)

**Fix direction:** read the v2 link state (what Mac settings' `ConnectStage` reads) for the Mac hero, pill and *Send files*, from one shared source, tested at the transition. **The wrong fix is adding the Mac to `ConnectionManager.connectedDevices`** — Sync reads that set for Android-to-Android

### 146 — the force-stop guard does not run on pinned-wrapper commands · **fixed 2026-09-23**

**Fixed 2026-09-23** — the registration no longer narrows the hook; fixtures cover the wrapper forms and the registration itself. **Was:** Registration `"if": "Bash(adb *)"` skips every command that starts with `scripts/adb-pinned.sh` or a variable; the script's own matcher denies the same command when it is run. Seen when `am start -S` reached the emulator (`docs/testing.md` → Defect 146)

**Fix direction:** match the pinned wrappers in the registration (or remove the `if`), with a deny fixture for the wrapper form. **The wrong fix is loosening the matcher** — it is already right

### 147 — check-suites-run blocks non-commit commands while staged sources are stale · **open**

**Open.** Registered `"if": "Bash(git commit *)"`, it denied non-commit commands during Feature A slice 1, including the `./gradlew testDebugUnitTest` run its own message asks for. Every command it blocked contained `$(…)`, `${…}` or a heredoc; the same Gradle run written plainly went through. The mechanism is not established (`docs/testing.md` → Defect 147)

**Fix direction:** establish with fixtures what the `if` does with a command it cannot parse; then have `suites-were-run.sh` exit 0 unless the hook input is a commit, or accept the conservative match and document it. **The wrong fix is removing the hook**: it is right about commits

### 148 — a bulk pull is not bound to its session, and its id is guessable · **fixed 2026-09-29, tests only**

**Fixed 2026-09-29, tests only** (the table row has what and how; hardware owed). Recorded when open: `BulkTransfers.serve()` claims a pending pull by `transferId` alone; `Pending.sessionId` is read only by `forgetSession`; ids are `t-<counter>-<millis mod 100000>`; `fs.transfer.cancel` is keyed by `transferId` alone. Found by the Feature A slice 3 review (F1, F2, F8), which also corrected the proposal's §8 claim that the rule existed (`docs/testing.md` → Defect 148)

**Fix direction:** bind `Pending` and `Incoming` to the owning session token and refuse in `serve()` on a mismatch; use random ids; answer cancel only for the session's own transfers. **The wrong fix is relying on the token**

### 149 — a bulk claim for an unknown transfer is always tagged `photos` · **fixed 2026-09-29, tests only**

**Fixed 2026-09-29, tests only.** Recorded when open: `serve()` answers an unknown `transferId` with `NOT_FOUND`, `feature: "photos"`, hard-coded (`docs/testing.md` → Defect 149)

**Fix direction:** carry the capability on the pending record, and send no `feature` when the id is unknown. **The wrong fix is `"files"`**

### 150 — the Mac's Files and Photos pulls can replace a file at the final name · **fixed 2026-09-29, tests only**

**Fixed 2026-09-29, tests only** (the table row has what and how; hardware owed). Recorded when open: The name is checked before the transfer and published with `rename` after it; `rename` replaces a file that appeared meanwhile (`docs/testing.md` → Defect 150)

**Fix direction:** exclusive publish with `link` + `unlink`, re-choosing on `EEXIST`, and refusing where hard links are unsupported. **The wrong fix is a last-moment `access()` check**

### 151 — the Mac's pull deletes a `.part` it has no record of · **fixed 2026-09-29, tests only**

**Fixed 2026-09-29, tests only** (the table row has what and how; hardware owed). Recorded when open: `<name>.part` is derived from the final name, and an unrecorded one is removed before a fresh pull; it may be another app's download (`docs/testing.md` → Defect 151)

**Fix direction:** a partial name only Sidekick can have made, and never delete a partial the record does not own. **The wrong fix is judging by size or age**

### 152 — debug probes are exported with no permission · **fixed 2026-09-24**

**Fixed 2026-09-24** — `DUMP` on the four filter-less exported harnesses; `DebugProbeGateTest`; the gate demonstrated in both directions on the emulator with throwaway apps; Sidekick's own gated APK not yet on hardware. **Was:** `DesignPreviewActivity`, `PhoneAddressProbe`, `SafChildrenProbeActivity` and `ShareOfferProbeActivity` exported with no filter and no permission. (`FsProbeActivity`, named here at first, is declared in no manifest.) (`docs/testing.md` → Defect 152)

**Fix direction:** gate them behind `android.permission.DUMP`, proven in both directions on a device, with a manifest test. **The wrong fix is `exported="false"`**, which removes the adb path

### 153 — the share pull deleted, or published as Saved, whatever was at its partial's name · **fixed 2026-09-25**

**Fixed 2026-09-25.** Swap, race and failure paths **by synthetic tests only**, in temp folders; the **normal path** passed one supervised live transfer on the SM-S938B (`983a55b`, 2026-09-25 23:16). The live run did not exercise `unexpected-file`, the races, the pending-write hang, collisions, large files or multi-file sharing. Identity from the open handle, identity-checked deletes, a pre-publication and a post-link identity check, and the `unexpected-file` state for a different file found at the saved name (`docs/testing.md` → Defect 153). **Residual, accepted by the owner:** the check-then-delete window (failure cleanup, the post-save partial, and the unchanged startup sweep) against a deliberate process running as the same user — detected by link count, **not prevented**. **Open limitation:** a write that never settles holds the pull open, so a cancel is not guaranteed to finish. **Localhost speed impact: inconclusive** (one of three benchmark passes missed the pre-set 5% criterion).

**Fix direction:** as built. **The wrong fix is any sentence calling it race-free**, and a "retry the save" for `unexpected-file`, which would put a second file beside one nobody can tell apart from it.

### 154 — the destination check's probe files are deleted by name with no identity check · **fixed 2026-09-29, tests only**

**Fixed 2026-09-29, tests only** (the table row has what and how; hardware owed). Recorded when open: Found by reading `shareDestination.ts` while fixing 153; not reproduced, and deliberately left out of 153's patch (`docs/testing.md` → Defect 154).

**Fix direction:** identity-checked deletes, after a swap test shows the current behaviour. **The wrong fix is a longer random name**


### 155 — `ShareReceiver.decide` trusted its caller to send one decision at a time · **fixed 2026-09-26 (working tree)**

**Fixed 2026-09-26, in the working tree only** — the running Mac app is the earlier build. After the Accept's destination check the offer's state is re-read and any end reached meanwhile (Decline, expiry, session end) stands; an Accept already in flight for the offer makes a second one a no-op; the session is re-checked after the await. Found while hardening the version-3 queue, where the same await also let two Accepts clicked together each ignore the other's space reservation (`docs/testing.md` → Defect 155). **Not reachable through the shipped window**, which disables both buttons while a decision is pending.

**Fix direction:** as built — re-read state after every `await` in `decide`, and hold an in-flight marker. **The wrong fix is relying on the window's pending flag**, which is one caller's courtesy and not the receiver's rule.

### 156 — the running Mac app's Files pane had no Pause, Resume or Cancel for a block pull · **fixed 2026-09-30**

The pane's bridge was an object literal in `renderer.ts` — top-level page code no test reaches — and it
omitted `fsPullStop`, `fsPausedPulls` and `fsCancelPaused`. The view treats those as optional (so doubles
without them still construct), which made the omission silent: no Pause, no Cancel, and a paused pull
that could never show **Resume**. The main process (stop, records, automatic resume after an
interruption) was unaffected. The suite was green because `filesView.test.ts` supplied the three calls
in its own double — correct about the view, and at a layer the defect was not in.

**Fix direction:** as built — the bridge and the Files event subscriptions are built by `filesBridgeFrom`
and `wireFilesEvents` in `files.ts`; `renderer.ts` calls them, and `filesWiring.test.ts` derives the
required calls from the view's own `this.bridge.*` uses, drives the real view through the real builder,
and holds `renderer.ts` to that one construction. **The wrong fix is adding the three lines to the
literal in `renderer.ts`**: it repairs today's omission and leaves the next one exactly as unreachable.