# Phase 4 close-out — notifications, calls, SMS/MMS, contacts, media remote

Status as of **2026-08-29 morning**. Phase 4 is **not closed, and the reason changed**: step 70 ran
on a real inbound ring and **35c FAILED**. 36 is still untested. The failure exposed **defect 45** —
the mechanism 35c depends on has never worked on this device — and **reopened defect 42** on the
inbound path. Phase 4 cannot close on a re-run alone; it needs code. See the last section.

The evidence behind every claim here is in `docs/testing.md`, in dated sections. The defect index is
`docs/defects.md`. This file is the summary a person reads before deciding whether Phase 5 can open;
it is deliberately short on narrative and specific about what is proven and what is not.

---

## What shipped

| Feature | Phone | Mac | Proven by |
|---|---|---|---|
| Notification mirroring + reply | done | done | steps 42-49b, 52 |
| SMS / MMS threads | done | done | steps 55, 58, 58a, 65, 66, **68** |
| Call events, dialing, answer/reject | done | done | steps 60-63, **69**; **70 outstanding** |
| Contacts | done | done | contacts pane run, 2026-08-28 |
| Media remote | done | done | steps 64, 66, **67** |

Four Mac panes landed on 2026-08-28 (contacts, media remote, SMS, calls) and the Mac gained its
first test suite the same day, after six of the phase's defects turned out to be Mac-side.

---

## Verification state of every defect this phase touched

**Closed — fixed and proven on hardware:**

| # | Closed by | The evidence in one line |
|---|---|---|
| 27 | 2026-08-28 | the unavailable reason recomputes with the set that produced it |
| 28 | 2026-08-28 | app names resolved, not package ids — and a third copy found by enumerating |
| 29 | 2026-08-28 | the call log reads the right key; 50 entries, four distinct types drawn |
| **31** | **step 67** | `[remote]` states 466 → 591 while `delivered` stays frozen at 29 |
| **34** | **step 68** | row drawn from the push while the pane's own note still read the pre-send count |
| **35** (outgoing) | **step 69** | headline `Chetan`, second line `Dialling · +919800000001` |
| **37** | hardware, link down | `Capabilities now: …,notifications,remote,…` 1 ms after the listener attached |
| **40** | hardware | the reject ack now explains the `answered` that follows instead of denying it |
| 41 | hook fixtures | the force-stop hook no longer denies prose that documents it |

**Failed or unproven, and no longer a matter of arranging a phone call:**

| # | State after 2026-08-29 09:52 |
|---|---|
| **35c** | **FAILED.** A real ring from `+918800000004` produced `ringing number withheld by the platform`; the card would have read `Unknown number`. Fails the strict clause and the original disjunction alike. |
| **36** | **Still untested.** No Mac-initiated reject happened. The `missed` / `type=5` pair observed is the *phone-rejected* case, which is documented and correct, not defect 36. |
| **45** | **New, High.** `EXTRA_INCOMING_NUMBER` is not delivered on Android 16 to an app that is not the default dialer, so no inbound call carries a number. The code asserts the opposite. |
| **42** | **Reopened.** Its inbound half rested on 45's false premise; `c2` displayed the previous caller's name to the user. |

**Closed since:** **42** (an outgoing call labelled with the previous call's number — the blocker)
and **43** (`from ,` in the Mac's log, found behind 42). Step 70 is unblocked and re-armed against
the post-42 build; see the last section.

**Deferred out of Phase 4, with fix directions recorded:** 17, 30, 32, 33, 38, 39. See
`docs/defects.md`; each carries its fix direction and, where one exists, the wrong fix to avoid.

---

## What Phase 5 inherits, and what it must not assume

- **Three SMS defects travel together** — 30 (cannot start a conversation), 32 (cannot reach a
  thread past the first page), 39 (a sent message is missing from the thread until reopened). They
  are one sitting's work and share one protocol decision: what `sms.send` accepts and what its ack
  carries. `docs/protocol.md` changes first.
- **Defect 38 has a test note that must survive** — check `controller.playbackInfo.playbackType`
  before claiming a fix, and test with the phone's own hardware volume keys, never with `volume_set`
  from the Mac. `volume_set` pushes through `onCommand` and makes a broken build look fixed.
- **Defect 17 is a Mac storage shape, not a Phase 4 feature** — one paired slot, structurally. It
  will be felt the first time anyone tests with two phones, and the workaround is a second instance
  with `--user-data-dir`.
- **The serverless-process window is not fixed and is Phase 6's** — a process started by the
  platform rebinding the notification listener runs `ConnectSuiteApp.onCreate`, installs every
  feature, and never starts `LinkService`. Observed for five hours on 2026-08-28. Defect 37's fix
  keeps the *capability set* correct throughout such a window; nothing makes the server come up.

---

## Two rules this phase produced, both now enforced rather than documented

Both are in CLAUDE.md as prose, and prose was not enough in either case.

1. **Never drive the UI by coordinates when a named target exists.** Written after a blind click
   pressed **Share** on a screenshot notification and opened a share sheet on the user's phone — the
   second coordinate-guessed click to do something unintended. Every Mac interaction in steps 67-69
   was driven by element id over the DevTools protocol, and every phone interaction by `adb`.
2. **Before a negative result becomes evidence, prove the query returns a known positive.** Three
   confident wrong answers in one day produced it. Every check in this phase's later steps carries
   its control, and they are recorded beside the results: the 173-button enumeration behind
   "`#call-reject` is absent", the 7-listening-socket enumeration behind "the link is down", the
   `grep -c "Listening on"` returning 0 in the window and 2 over the file.

The enforcement points that now exist: `scripts/hooks/no-force-stop.sh` (with fixtures in
`no-force-stop.test.sh`), and `scripts/check-defects.sh` wired through
`scripts/hooks/defects-in-sync.sh` so a commit cannot leave the defect register and the evidence
disagreeing. The second one exists because step 67 went unrecorded for a full sitting and nothing
in the build could tell.

---

## Step 70 — what is actually left, after the 2026-08-29 attempt

The attempt is written up in full in `docs/testing.md`. The short version:

1. **The watcher rejected a call it had already read as the wrong one.** It waited for the live card,
   read it six times — `Dialling · +919800000001`, which is neither `Ringing` nor the second person's
   number — and clicked Reject anyway, because nothing gated the action on the reading. That hung up
   the user's own outgoing call to the second person. The gate now exists
   (`scripts/step70-watch.mjs`) and refuses to click unless the card reads `Ringing` **and** carries
   the expected number.
2. **The real ring arrived 32 seconds later with nothing watching**, was answered on the phone, and
   ran 33 seconds. 36 was never exercised.
3. **Defect 42 was found**, and it is the reason a re-run needs sequencing rather than just another
   ring.

**Superseded 2026-08-29 09:52.** The ring happened, 35c failed, and the blocker is no longer
scheduling — it is code. **Do not ask anyone for another ring**: the experiment has run and produced
a clean negative, and repeating it under the same conditions produces the same blank.

Order now:

1. **Defect 42's inbound half** — an episode may not begin with a number it did not obtain for
   itself, with no exception for `ringing`. Needs no design decision; makes every inbound card read
   `Unknown number`, which is correct and far better than a stranger's name.
2. **Defect 45** — decide between `CallScreeningService`, `InCallService`, or documenting it as a
   platform wall with a specific reason per locked decision #6. This is a design decision and should
   be taken deliberately, not while holding a phone.
3. **Then** step 70, which will need one ring to prove 35c and 36 together, on a build where the
   inbound number can actually arrive.

**35c's clause is now stricter than as first written.** The caller is in the phone's contacts as
`Contact D`, so the original "their name, else their number" disjunction collapses: the headline
must read **Contact D**, and the bare number is a failure. That is deliberate — it is the only
version of the clause that proves `ContactsFeature.nameFor` fired, which is the integration contacts
was pulled forward into Phase 4 to enable.

If the second person cannot be asked again soon, the alternative that preserves the control without
fixing 42 first is a ring from a number **no preceding episode touched**, with the preceding
episode's number recorded beforehand. That is strictly worse: it makes the result depend on
remembering to arrange it.
