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
| **35** | An outgoing call's card was labelled with nothing at all | **closed**, both halves | **step 69** (outgoing) 2026-08-28; **step 70** (35c, inbound) 2026-08-31 | `docs/testing.md` |
| **36** | A call rejected from the Mac was reported as `missed` | **closed** | **step 70** on hardware, 2026-08-31 — `ended rejected` with the platform's `type=5` as the control | `docs/testing.md` |
| **37** | A re-granted notification listener never turned its capabilities back on | **closed** | hardware, link **down**, 2026-08-29 | `docs/testing.md` |
| **38** | A volume change made on the phone never reaches the Mac | **deferred** | — | see below |
| **39** | A message sent from the Mac is missing from the thread it was sent into | **deferred** | — | see below |
| **40** | `call.reject delivered` named a disposition the disposition logic then overrode | **closed** | hardware, 2026-08-29 | `docs/testing.md` |
| **41** | The force-stop hook denies prose that merely mentions the rule | **closed** | hook fixture tests, 2026-08-29 | see below |
| **42** | An episode is labelled with the previous call's number | **closed** | outgoing hardware 2026-08-29; inbound on **step 70**, 2026-08-31 — `c7` drew its own number and contact, not `c6`'s | see below |
| **43** | A call with no number logged as `from ,` on the Mac — the string defect 35 is named for | **closed** | `calls.test.ts`, 2026-08-29 | see below |
| **44** | A message sent on the phone never reaches the Mac — no observer on outgoing rows | **open** | — | see below |
| **45** | `EXTRA_INCOMING_NUMBER` arrives too late for the card, so no inbound call had a number | **closed** by option 4 | **step 70**, 2026-08-31 — 7 of 7 episodes corrected, 16–535 ms | see below |
| **46** | The media remote puts a raw package id in a sentence — defect 28's class, on the Mac, in two places | **open** | enumerated 2026-08-30 | see below |
| **47** | ~~A live call card the Mac cannot correct~~ — **WITHDRAWN.** The card was true; `c13` was a 68-minute WhatsApp video call | **withdrawn**, not a defect | `dumpsys telecom`, 2026-08-31 | see below |
| **48** | Two step-70 locks at two paths excluded nothing — each watcher took its own and both armed | **closed** | reconciled to one path; exclusion fixtures, 2026-08-30 | see below |
| **49** | The exclusion's refusal overstated its own evidence — one CDP client was counted as two | **closed** | `lsof` fixture and three controls, 2026-08-30 | see below |

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

### 46 — the media remote puts a raw package id in a sentence · **open**

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
