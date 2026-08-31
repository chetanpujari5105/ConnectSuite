# Decision brief — defect 45: inbound caller identity

**Status: decided 2026-08-30 — option 4, on the measurement recorded below. Do not re-open it
without reading that measurement first.**

Written 2026-08-29 as an undecided brief. The one reading it was waiting on arrived on 2026-08-30 and
settled it: the extra lands **during** the ring, ~8–111 ms in, on all six episodes measured. Option 4
was gated on exactly that and is therefore available; no call-handling role is taken, so options 1
and 2 stay unbuilt and their costs to the user stay unpaid.

---

## What is actually broken, stated so nobody misreads it later

**This is not a regression. It is a feature that was never real.**

The inbound-number path has **never once** been observed delivering a number to the episode it
belongs to. Every non-empty inbound number ConnectSuite has ever displayed was **residue** — the
previous caller's number, arriving late enough to be mistaken for the current one's. The readings
that looked like a working feature were the bug producing a plausible answer.

There is no earlier state to get back to. Anyone reading the older `Call cN ringing from …` lines as
evidence of something that used to work is reading defect 42.

**The precise mechanism, corrected 2026-08-29.** An earlier note said the extra "never arrives".
That is wrong and the difference decides this brief:

> `EXTRA_INCOMING_NUMBER` **is** delivered. It arrives **after** the `PHONE_STATE` state callback, so
> `begin()` has already published a blank card. On a 197 ms call it arrives after `end()` as well,
> where it fills the field and waits for the next episode to read it.

Proven by elimination: only three lines write `CallWatcher.number`, and between `c1` (08:29) and
`c2` (09:40) the link was down, so no `call.dial` could have run.

**What is now fixed (defect 42) and what is not.** The residue is gone — an episode can no longer
start with a number it did not obtain for itself, so no card will show a stranger's name again. The
consequence is that **every inbound call now reads `Unknown number`**, honestly, because nothing
supplies the number in time. That is the current shipped behaviour and it is correct-but-empty.

**The number that was missing is now in hand — measured 2026-08-30. The extra arrives during the
ring, every time, within ~110 ms.** Option 4 exists. This paragraph replaces the open question that
stood here, and the correction below matters more than the answer.

**First, the misreading this brief itself invited.** The sentence above said "c1 was 197 ms and c3
was 11 s, and neither log can tell us where in that window it landed" — which puts a *call length*
and a *latency* in one list and invites the reader to treat 197 ms as how long the extra takes.
It is not. 197 ms was how long **c1 itself lasted**; it is a fact about that call, not about the
broadcast. The two numbers are unrelated, and the latency is roughly one twentieth of the figure
anyone would have carried away. Do not re-derive a conclusion from the 197 ms; it never measured
this.

**The evidence.** Six inbound episodes on the build with 42's instrumentation
(`lastUpdateTime=2026-08-29 10:01:54`), measured as the interval between the `Call cN ringing` line
that publishes the blank card and the `PHONE_STATE RINGING: number present … taken` line:

| Episode | `begin()` published | extra taken | delay |
|---|---|---|---|
| c9 | 2026-08-30 18:27:15.783 | 18:27:15.791 | **+8 ms** |
| c10 | 2026-08-30 18:38:42.492 | 18:38:42.503 | **+11 ms** |
| c12 | 2026-08-30 19:09:43.867 | 19:09:43.880 | **+13 ms** |
| c11 | 2026-08-30 18:56:46.097 | 18:56:46.168 | **+71 ms** |
| c7 | 2026-08-30 17:37:04.045 | 17:37:04.118 | **+73 ms** |
| c8 | 2026-08-30 17:47:14.574 | 17:47:14.685 | **+111 ms** |

Every one lands while the state is `RINGING` and the episode is `live`, and every one is logged
`taken` — so `CallWatcher.number` holds the caller's number from ~10 ms into the ring onward. The
control is on the same lines: the `number absent` broadcast that precedes each one is logged `not
taken`, so "taken" is discriminating between the two paths rather than labelling everything.

**The direct visual confirmation, c12.** The card was watched continuously through that ring. At
+0.0 s it read `who="Unknown number" status="Ringing"`; at +11.4 s, when the call was answered, it
became `who="+918800000004" status="In progress · +918800000004"`. Nothing fetched the number at
+11.4 s — it had been sitting in `CallWatcher.number` since +13 ms. **The only thing that happened
at +11.4 s was a re-publish**, triggered incidentally by the ringing→active transition. That is
option 4's entire mechanism, already working, firing on the wrong event. Option 4 is not new
machinery; it is one more call to the publish that already exists.

**The honest limit is unchanged.** A call shorter than the extra's arrival still ends unknown, and a
missed call from an unknown number stays unknown on the card. c1's 197 ms is the example of that
case — which is the one thing the 197 ms figure is genuinely evidence for.

---

## The options, and what each costs

### Option 1 — `CallScreeningService`

A public API since API 24. The app declares a service, the user grants the **call-screening role**
(`RoleManager.ROLE_CALL_SCREENING`), and the system then calls `onScreenCall(Call.Details)` for every
incoming call *before it rings*, handing over `getHandle()` — the caller's number, reliably, at the
right moment.

**What it costs the user, concretely.** This is the part worth being blunt about, because the role
is not a passive read permission:

- **It is exclusive.** One app holds call screening at a time. Granting it to ConnectSuite **takes it
  away from whatever holds it now** — on a Samsung device that is typically Samsung's own
  Smart Call / spam protection, or Google's Call Screen on Pixels. The user loses their existing spam
  filtering to gain a caller name on their Mac. Most people would not make that trade if it were
  described to them plainly, and describing it plainly is the only honest way to ask.
- **The app becomes responsible for a decision it does not want.** `onScreenCall` requires a
  response: allow, reject, silence, or skip the call log. Answer wrongly or too slowly and you have
  broken the user's phone in the most visible way possible — a missed call, or a call silenced that
  should have rung. The safe response is always "allow everything", which is implementable and
  boring, but it means ConnectSuite sits in the critical path of every incoming call **on a companion
  app's reliability budget**. Phase 6 exists because this app's background reliability on One UI is
  not yet trusted.
- **It is another onboarding grant that can be revoked**, in a Settings screen most users have never
  visited, with no callback when it goes away that is more reliable than the ones defect 37 was about.
- **Play policy.** Call-screening role use is scrutinised, and "so a paired Mac can show a name" is a
  thin justification for holding the phone's spam-protection slot. This is not a blocker but it is
  not nothing.

**What it buys.** The correct number, before the ring, every time, with no race. It is the only
option that makes 35c pass as originally written.

### Option 2 — `InCallService` / becoming the default dialer

**Blunt answer: no, and not close.** Becoming the default phone app means ConnectSuite owns the
entire in-call experience — the incoming-call UI, the in-call screen, the dialer, DTMF, hold,
conference, Bluetooth routing, emergency calls. Not "gains access to"; **owns**. If it crashes, is
killed by One UI's battery manager, or is simply not running, the user cannot answer their phone.

This project's own architecture rules point the other way. It is a companion app that promises
"every feature degrades to *unavailable, here is why*". A default dialer cannot degrade to
unavailable — degrading means the phone stops working as a phone. And Phase 6 is on the roadmap
precisely because backgrounded services on this device are not yet reliable.

Taking on emergency-call responsibility to put a name on a Mac card is not a defensible trade at any
point on this project's roadmap. Listed for completeness and to be ruled out explicitly, so it does
not get rediscovered as a clever idea later.

### Option 3 — record it as a platform wall

Ship what defect 42's fix already produces: inbound cards read `Unknown number`, with a specific
reason string, and `docs/permissions.md` gains an entry beside the call-audio wall.

**What survives, clause by clause — this is the part the decision turns on.**

| Clause | Survives? |
|---|---|
| **35c** — inbound card carries the caller's name or number | **No.** This is the clause that dies. It cannot pass without a number. |
| 35 (outgoing) — a dialled call's card carries its number | **Yes**, unaffected. Verified at step 69; the number comes from `call.dial`. |
| **36** — a Mac-initiated reject reports `rejected`, not `missed` | **Yes, entirely.** 36 is about the *disposition*, which is derived from the state transition and the reject flag. It never needed the number. |
| Inbound call *events* — the Mac learns a call is ringing, and can answer or reject it | **Yes.** The card appears, the buttons work, the disposition is right. Only the identity is missing. |
| Call log — 50 entries, 47 with contact names | **Yes.** The log is read from `content://call_log/calls`, which has numbers and always did. |

**Is the calls pane still worth having?** Yes, and the shape of what remains is worth seeing clearly.
The pane loses caller identity **on the live card only**, for **inbound calls only**. It keeps: the
full call log with names, outgoing dialling with names, answer and reject from the Mac, correct
dispositions, and the "your phone is ringing" signal itself. A Mac that says *"a call is ringing —
answer, or reject"* and then shows the caller's name in the log ten seconds later is a materially
useful thing. It is worse than the promise, and it is not a dead feature.

The honest framing for a user is a sentence, not a blank: *"Android does not give this app the
caller's number for incoming calls. Open the phone to see who it is."*

**Does step 70 become untestable, or just narrower?** **Narrower, not untestable.** Step 70 was
written to prove 35c and 36 together with one ring. Under option 3 it drops 35c and keeps 36, which
is the harder and more interesting half: the reject must report `rejected` and the platform must
show `type=5` for the same call. That still needs one real inbound ring from a real handset, and it
still needs a second person for thirty seconds. **What changes is that the ring stops being blocked
on a design decision** — 36 can be proven on today's build.

Worth noting: 36 was always the clause with a shipped wrong fix behind it, and it is the one that
survives. The clause that dies is the one whose mechanism never worked.

### Option 4 — accept the number when it arrives, and update the card

**Only viable if the extra arrives during the ring**, which the new instrumentation will settle.

`CallWatcher` already pushes `call.incoming` more than once per episode — the ringing→active
transition sends a second one for the same `callId`, and the Mac's card handles it. So if the extra
lands 200 ms into a 20-second ring, the card can be corrected in place: blank first, then the name.

- **Cost to the user:** a card that appears anonymous and then names the caller a moment later. Mildly
  odd; far better than nothing, and honest at every instant.
- **Cost to us:** small. No new grant, no new role, no onboarding step, no Play scrutiny.
- **The trap to avoid:** this must be driven by the extra *arriving*, never by a timer that waits for
  it. A delay before publishing the card is the shape this codebase has rejected four times — defect
  36 shipped it, 37 declined it, 39 still tempts it, and 45's own record names it. Publish blank
  immediately, correct on the event.
- **The honest limit:** it fixes nothing for short calls, where the number arrives after the call is
  over. A missed call from an unknown number stays unknown on the card, though the log gets it.

This is the option that did not exist under the "never arrives" diagnosis, which is why correcting
that diagnosis mattered.

---

## Does any of this change on a phone where the app *is* the default dialer?

**Yes — which means this is a configuration, not a wall, and the distinction should be recorded
accurately.**

`EXTRA_INCOMING_NUMBER` is deprecated and restricted, but the *capability* is not unavailable: it is
reserved for apps holding a call-related role. As the default dialer (`InCallService`) or as the
call-screening app, this app would receive the caller's number by a supported, documented API. The
platform is not withholding the number from all apps; it is withholding it from apps that have not
taken on call-handling responsibility.

So the accurate wording — and it differs from the call-audio wall in a way that matters — is:

> **Not a wall. A toll.** Call audio genuinely cannot be streamed by any app: `CAPTURE_AUDIO_OUTPUT`
> is system-only, and no role unlocks it. Inbound caller identity *can* be obtained, by an app
> willing to hold a call-handling role. We are declining to pay that price, not being refused.

`CLAUDE.md`'s "Platform walls (do not attempt, do not design around)" section should therefore
**not** absorb this as-is. A wall says stop thinking. This says: available at a price we have judged
too high, and the judgement can be revisited if the product changes — for instance if ConnectSuite
ever ships a phone-side dialer of its own.

One more consequence of it being a configuration: **it will behave differently on other devices.**
An OEM that delivers the extra earlier relative to the state callback would make option 4 work well;
one that never delivers it to non-role apps at all would make even option 4 useless. Any decision
here is a decision about *this* device until it is tested on another, and the record should say so
rather than generalising from one handset.

---

## Recommendation

**Option 3 now, with option 4 layered on if the instrumentation says the extra arrives during the
ring. Rule option 1 out for this release; rule option 2 out permanently.**

If it were my product:

- **Option 2 is not a real option.** Owning emergency calling to label a Mac card is
  disproportionate by an enormous margin, and it contradicts the degrade-to-unavailable rule that
  the rest of this codebase actually honours.
- **Option 1 is the technically correct answer and the wrong product decision *today*.** It works,
  and it costs the user their spam protection and puts a companion app in the critical path of every
  incoming call — on a device whose background reliability this project has not yet earned the right
  to be confident about, which is what Phase 6 is for. Revisit it after Phase 6, if users ask for
  inbound names loudly enough to justify the trade being explained to them at onboarding.
- **Option 3 is what should ship**, because the honest empty state is already implemented, already
  correct, and costs nothing. The pane keeps everything except one label.
- **Option 4 is the one to actually build**, if the data supports it: no grant, no role, no
  onboarding, and it recovers the name for every call that rings long enough to answer — which is
  every call a user would care about identifying.

**Sequence I would follow:** wait for the next real inbound call to read the instrumentation (costs
nobody anything); if the extra arrives during the ring, build option 4 and document option 3's
wording as the fallback for calls too short to catch; if it does not, ship option 3 alone and record
option 1 as revisitable after Phase 6.

**And regardless of which is chosen: step 70 should be re-scoped to 36 alone and run.** It is
provable on today's build, it needs one ring, and leaving Phase 4 open on a clause whose mechanism
was never real is the wrong reason to hold a phase open.
