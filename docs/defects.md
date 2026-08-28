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
| **30** | The Mac cannot start a new SMS conversation | **deferred** | — | see below |
| **31** | The media card never learned about changes made on the phone | **closed** | **step 67**, 2026-08-28 | `docs/testing.md` |
| **32** | The SMS pane cannot reach a conversation older than its first page | **deferred** | — | see below |
| **33** | The phone names packages where it means apps, in sentences users read | **deferred** | — | see below |
| **34** | `sms.received` dropped by the Mac: the phone sent a shape the contract does not describe | **closed** | **step 68**, both contact states, 2026-08-28 | `docs/testing.md` |
| **35** | An outgoing call's card was labelled with nothing at all | **closed (outgoing)** / **open (35c, inbound)** | **step 69**, 2026-08-28; 35c needs **step 70** | `docs/testing.md` |
| **36** | A call rejected from the Mac was reported as `missed` | **fixed, awaiting step 70** | precedence verified by **step 69**, 2026-08-28 | `docs/testing.md` |
| **37** | A re-granted notification listener never turned its capabilities back on | **closed** | hardware, link **down**, 2026-08-29 | `docs/testing.md` |
| **38** | A volume change made on the phone never reaches the Mac | **deferred** | — | see below |
| **39** | A message sent from the Mac is missing from the thread it was sent into | **deferred** | — | see below |
| **40** | `call.reject delivered` named a disposition the disposition logic then overrode | **closed** | hardware, 2026-08-29 | `docs/testing.md` |
| **41** | The force-stop hook denies prose that merely mentions the rule | **closed** | hook fixture tests, 2026-08-29 | see below |

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

### 30 — the Mac cannot start a new SMS conversation · **deferred**

The SMS pane can reply into a thread the phone already knows about and cannot address a number that
has none. `sms.send` takes recipients from the thread this client holds, deliberately — see the
`SmsClient` file comment — so there is no path to a first message.

**Fix direction:** a compose surface that names a recipient, which means `sms.send` growing an
explicit-address form in `docs/protocol.md` and a phone-side check that the address is real.

**Wrong fix to avoid:** letting the Mac pass a bare address into the existing `sms.send` and having
the phone trust it. That is the leniency defect 29 forbids: the two sides would disagree about the
shape forever while appearing to work. Whatever ships, `docs/protocol.md` changes first.

Pairs naturally with 32 and 39 — all three are the Phase 4 SMS sitting.

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
