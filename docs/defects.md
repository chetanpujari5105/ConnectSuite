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
| **30** | The Mac cannot start a new SMS conversation | **open** — explicit-address path closed on hardware; the **no-thread half is untested** | hardware 2026-08-31 (**step 71**): Mac → bare address `9850850263`, phone verified the recipient, pane opened the thread the *phone* named | `docs/testing.md` |
| **31** | The media card never learned about changes made on the phone | **closed** | **step 67**, 2026-08-28 | `docs/testing.md` |
| **32** | The SMS pane cannot reach a conversation older than its first page | **closed** | on hardware 2026-08-31 — 50 → 89 → 126 → 158 → 183, all distinct | see below |
| **33** | The phone names packages where it means apps, in sentences users read | **deferred** | — | see below |
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
| **51** | The after-send retry reports a loss it does not suffer — an `e:` line and a `dropped` counter for messages the observer then delivers | **open** | found during **step 71**, 2026-08-31 — 2 of 2 Mac-origin sends | `docs/testing.md` |
| **52** | One `dropped` counter for three different things in `VideoChannel`, and the third never reaches it | **open — fix on next touch of the mirror**, not deferred | source sweep, 2026-08-31 — the counter shape 51 asked to be swept for | see below |
| **53** | Two of the Mac's four call refusals move the counter without leaving a line | **open** | source sweep, 2026-08-31 | see below |
| **54** | `photos` would have been advertised with nothing serving the bulk channel its own `media.original` runs on | **closed** | red first, 2026-08-31, before any `media.*` code existed — `CapabilityPermissionTest` | `docs/testing.md` |
| **55** | `fs.list` re-read and re-sorted the whole directory on every page — correct, and 490 seconds for one folder. **Read the rule, not the fix**: every check this project had ever asked of a pager passed while `limit` bounded the frame and never the work, so *a green pager needs a clock beside it* is now a rule in `CLAUDE.md` and outlives this row | **closed** | on hardware 2026-09-01, in the slice that introduced it; found by paging to exhaustion, not by a first page | `docs/testing.md`; the rule is in `CLAUDE.md` |
| **56** | **A truncated push was committed as the finished file.** Above the 64 MB pre-hash ceiling no digest is agreed, so nothing but the length agreed on the control channel could tell an interruption from a completion — and nothing was checking it. **The most serious defect found in Phase 5**: reachable by any interrupted push of a large file, and its symptom is a file that looks whole and is half there, which is exactly what `.part` exists to prevent, defeated on the last step | **closed** | on hardware 2026-09-01, in the slice that introduced it; the guard is `FsArrivalTest`, shown red three ways 2026-09-01 | `docs/testing.md` |
| **57** | `media.thumb` answers `NOT_FOUND` both for a photo that is gone and for one that is there and could not be rendered — one code for two facts, on the namespace whose sibling `fs.thumb` separates them deliberately | **deferred to Phase 6** — the second option Phase 5's closing condition offers, taken deliberately. The branch has never been produced: it needs an undecodable `MediaStore` row, which means truncating a file's bytes under its own entry on somebody's real phone, and a phase of ordinary use produced none. Reporting only — the Mac already drops errored ids into a `missing` set and stops asking, which is correct for both causes | source, 2026-09-01, found by reading the handler against the contract while `media.*` was written into `docs/protocol.md` | see below |
| **58** | **The clipboard undo was reachable and not visible.** With auto-apply on, the Mac captures the clipboard it overwrites as a `displaced` entry so Restore is an undo — the condition `docs/protocol.md` set for removing the confirmation. `onClipArrived` carries the arriving entry and **not** the displaced one created beside it, so the pane's mirror learned about the new clip and never about what it replaced; the Restore row appeared only on the next `refresh()`, which a button click triggers — the click auto-apply exists to remove. **Every test was green**, because no test reads the renderer's list | **closed** | on hardware 2026-09-02, in the slice that introduced it. Found by reading the pane's rows structurally after an auto-apply and noticing the arrival at 1:21:08 had no Restore row while one from 1:17:13 did — not by any failure | `docs/testing.md` → Slice 12 §9 |
| **59** | **A watcher send was invisible in the Mac's clipboard pane.** The pane refreshed only on its own button clicks, and the watcher clicks nothing — so after copying on the Mac the list still rendered *"Nothing yet. Copy something on either machine."* over a history with entries in it. The probe step that should have caught it **had no assertion**: it sliced the first 60 characters of the list and printed them, so a list full of rows was reported under the heading *"The pane starts with an empty history and says so"* | **closed** | on hardware 2026-09-02, in the slice that introduced it; fixed with a `clip-changed` event on any history mutation, re-measured as 2 rows drawn with nothing touched | `docs/testing.md` → Slice 13 |
| **60** | **The link did not come back after a reboot.** `RECEIVE_BOOT_COMPLETED` was declared in `app/src/main/AndroidManifest.xml` from Phase 1 and **nothing received it** — the control is that the whole project declared two `<receiver>` elements, both in `sync-module`, and neither carried a `BOOT_COMPLETED` filter. `LinkBootReceiver` now takes `BOOT_COMPLETED`, Samsung's `QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED` — the last closing the *"reinstalling leaves the phone serverless"* hole `CLAUDE.md` documents, by the same route | **fixed** — the `MY_PACKAGE_REPLACED` half is proven on hardware; **the boot half is not, and cannot be from a laptop**: `BOOT_COMPLETED` is a protected broadcast, `adb root` is refused on this production build, and `am broadcast` is denied at uid 2000, so a real restart (H4) is the only stimulus | 2026-09-02: `adb install -r` → `[boot] PACKAGE_REPLACED: 1 paired device(s)` → `Foreground as PACKAGE_REPLACED, types=0x10` → `Listening on 42501/42502/42503`, 1.5 s, with grants diffed empty before and after. Guarded by `BootAutoStartTest` (9 tests), shown red under three separate mutations | `docs/testing.md` → Phase 6 Slice 1 |
| **61** | **The link wake lock is never re-armed, and the comment on the field claims it is.** `acquireLocks()` guards on `wakeLock == null`, so once the 12-hour `acquire()` timeout lapses it, nothing re-acquires for the rest of the connection. Unreachable in every reading this project holds — the longest observed hold is 31 minutes — **because the link has never stayed up for twelve hours**, which is the problem Phase 6 exists to remove | **closed** | fixed 2026-09-02: `isHeld` guard plus a 20-minute re-arm ticker against a 60-minute timeout. `LinkLockPolicy` + `BootAutoStartTest`, shown red under three mutations including the 59-against-60-minute edit a naive `REARM < TIMEOUT` would pass. The re-arm path itself needs a >20-minute connection and is being sampled overnight | `docs/testing.md` → Phase 6 Slice 2 |
| **62** | **A crash leaves the phone alive, fully granted, and serverless.** After a kill whose reason is `(adj 0): crash`, `START_STICKY` did not restart `LinkService`; the process came back 10 s later for the notification-listener rebind, every capability went green, and no socket was bound. The third route to the state `CLAUDE.md` documents for `adb install -r`, and the only one that needs nothing but a crash. Silent on both sides — the Mac shows the same reconnect loop it shows for a phone in a lift | **closed** | fixed and reproduced in one run on hardware 2026-09-02: the same `Start proc … for service {…NotificationMirrorService}` signature, and 304 ms later `[autostart] LISTENER_REBIND … starting LinkService` → listening → Mac reconnected 11.4 s after the kill. Originally seen as P5b: `Killing 23016 … (adj 0): crash` → `Start proc 31828 … for service {…NotificationMirrorService}` → 0 sockets, with the control that run 1's death logged `Foreground as UNKNOWN` 0.7 s later and this one logged nothing | `docs/testing.md` → Phase 6 Slice 2 |
| **63** | **The onboarding security note describes a pairing flow this app does not have.** *"Devices are paired by confirming a key on both screens"* — nothing is confirmed on both screens: the Mac draws a QR, the phone scans it, and the fingerprint is pinned. A user who reads it waits for a key on the Mac that never appears. Shipped user-facing copy, on the third page every new user sees | **open** | source, 2026-09-02, found by reading the four onboarding pages against the pairing implementation while writing `docs/phase-7-pairing-flow.md`; no test could have seen it — it is a true-sounding sentence about a mechanism | `docs/testing.md` → Phase 7 Slice 4 |

---

## Closed this sitting, with the evidence that closed each one

### 31 — the media card never learns about changes made on the phone → **closed by step 67**

The push half of the media remote was dead: every state the Mac had ever seen came from its own
command handler, which is why step 64 passed at 16 commands / 0 refused over a broken feature.

**Evidence.** The Mac's `[remote]` state counter climbs **466 → 591** across four playing/paused
flips while `delivered` stays frozen at **29**. `delivered` counts `remote.command`s the Mac sent,
so no Mac command caused any of them, and the flips alternate so each inverts what the Mac was
showing a second earlier. Contrast the run this step exists to prevent: **93 → 93**.

**Reconstructed, and recorded as such.** The phone's `link.log` for that window has rotated away and
no `dumpsys media_session` reading survives, so the Mac-side clauses are proven from the log and the
phone-truth comparison rests on the run's own observation at the time.

### 34 — `sms.received` is dropped by the Mac → **closed by step 68, both contact states**

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

### 37 — a re-granted notification listener never turns its capabilities back on → **closed**

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

### 40 — `call.reject delivered` names a disposition it does not decide → **closed**

**It never corrupted step 70's measurement**, and that was checked before it was fixed rather than
assumed: the sentence is a log string passed to `deliver()`, the wire ack carries only `callId`, and
the disposition comes from `CallWatcher.dispositionOf`. It was fixed because it sat inside step 70's
own instruction table telling the reader an outcome, and would answer a `grep rejected` identically
on a good build and a broken one.

**Evidence.** `call.reject delivered (rejected — the episode is flagged; call.ended decides the
disposition when the call ends, and answered outranks the flag)` followed by `Call c1 ended answered
after 4113ms` — the first line now explains the second instead of denying it.

### 43 — a call with no number logged as `from ,` on the Mac → **closed**

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

### 41 — the force-stop hook denies prose that merely mentions the rule → **closed**

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

### 44 — a message sent on the phone never reaches the Mac · **open**

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

### 32 — the SMS pane cannot reach a conversation older than its first page · **deferred**

50 threads, no way forward. The self-thread was only reachable during step 58 because a message sent
from the phone moved it to position 0.

**Fix direction:** paging on the thread list, the way messages already page with `before`.

**Wrong fix to avoid:** raising the page size. It moves the wall, does not remove it, and makes the
first payload larger for every user in order to hide a problem from the few with long histories.

### 33 — the phone names packages where it means apps, in sentences users read · **deferred**

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

### 39 — a message sent from the Mac is missing from the thread it was sent into · **deferred**

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

### 51 — the after-send retry reports a loss it does not suffer · **open**

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

### 52 — one `dropped` counter for three different things, one of which never reaches it · **open — fix on next touch of the mirror**

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

### 53 — two of the Mac's four call refusals move the counter without leaving a line · **open**

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

### 57 — `media.thumb` calls a failed render a missing photo · **open**

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

**What is still owed, and it needs a restart rather than a decision:** a `[boot] BOOT:` line in
`files/logs/link.log` and `scripts/link-up.sh` returning three OKs with nothing tapped. Until then
the boot path is unproven — the code from the action string onward is identical to the proven path
and unit-tested, but the platform's decision at boot is a different decision at a different
procstate under a compat change that applies only to boot, and a registration line is not an
execution line.

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
service owns rather than from a state change — a quietly healthy connection emits no state changes
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

### 63 — the onboarding security note describes a pairing flow this app does not have · **open**

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
