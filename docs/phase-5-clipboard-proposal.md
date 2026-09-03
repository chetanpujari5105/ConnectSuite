# Clipboard — the spec pass, written before any code

**Status: a proposal. Nothing in it is implemented, and `docs/protocol.md` is unmodified.** Written
2026-09-01, after Files closed in both directions, because clipboard shares none of that machinery
and has a platform wall of its own that has never been measured on this device.

Read `docs/phase-5-fs-media-proposal.md` first if you want the pattern: prose against the contract,
arguments in one place, readings named before code depends on them. This is the same shape and
deliberately shorter, because clipboard is a smaller feature with one hard question.

---

## 1. What is already decided, and by whom

Three things are fixed before this document starts, and none of them is up for re-argument here.

| Fixed | Where |
|---|---|
| The three message names — `clip.push`, `clip.request`, `clip.history` | `Messages.kt`, and `docs/protocol.md`'s namespace list. The inventory is closed; a fourth name needs an argument this document does not make |
| `clipboard` is gated on the **accessibility service**, not on a runtime permission | `CapabilityContract.kt`. Already written, already tested, and it is the reason clipboard is not advertised today |
| The capability is **not advertised while any of the three is unserved** | `CapabilityContract.isImplemented`'s `containsAll`. Defect 54 is what happens when that is loosened; nobody may loosen it here either |

So this document is about payloads, policy and one measurement — not about names or gating.

---

## 2. The wall, and the instrument that settles it — **built 2026-09-01, unrun**

`CLAUDE.md` carries it in one line: **background clipboard reads are blocked since Android 10 unless
the app has an enabled AccessibilityService or is the default IME.**

That sentence is the whole feature's foundation and it is **inherited from documentation, not
observed on this handset.** Every other load-bearing platform claim in this project has been measured
through the product's own client — the SAF refusal, the bound-selection cursor, the pending
`MediaStore` resume — and each time the measurement changed something. This one has not been taken,
and until it is, nothing below §2 may be built.

**What makes it more than pedantry:** this app *does* have an enabled AccessibilityService (Phase 3,
for input injection), so by that sentence clipboard is a small feature. If One UI adds a further
restriction — `docs/single-device-audit.md` §4 is a list of places it already has — the honest
product is a **foreground-only** clipboard, which is a different feature with different copy,
different gating and a different pane.

### The instrument exists: `ClipProbeActivity`

`app/src/debug/java/com/chetan/connectsuite/probe/ClipProbeActivity.kt`, debug-only, written before
any feature code and **not yet run** — the phone was not attached on the day it was written. Its
class comment is the operating manual; the run commands are in it. What matters here is which
readings it takes and which lookalike each one exists to exclude.

| # | Reading | The lookalike it separates |
|---|---|---|
| 1 | Foreground read of a clip we wrote ourselves | **The precondition.** A refusal means nothing unless the read works at all. The run stops if this fails, and says `stopped=control-failed` |
| 2 | Background read of a clip **we own** | *The owner may read its own clip* is an ordinary explanation that looks identical to *background reads are allowed*. Recorded separately so it cannot be mistaken for reading 3 |
| 3 | Background read of a clip **another app owns** | This is the feature's question. The probe knows what it put there, so *readable and no longer ours* is a foreign clip successfully read — no typing, no shared secret |
| 4 | Reading 3 with the **accessibility service disabled** | Says reading 3 was about the accessibility grant and not about something else. Without it, "it worked" is a fact about this build, not about the mechanism |
| 5 | **A write from the background**, read back from the foreground | Not in the first draft of this document, and nothing else in this repo measures it. `setPrimaryClip` that does not throw is not a clipboard that changed, and a silent no-op is the failure a Mac would never see |

**The stimulus problem, which would otherwise sink the run.** With reads blocked, *the user never
copied anything* and *every read was refused* produce identical silence — the `KEYCODE_BACK` row in
`CLAUDE.md`'s table, where the absent line was a reading that did not exist yet. So `--es mode
verify` takes a **foreground** read afterwards: if the foreign clip is there when we are focused, the
operator did copy and the background nulls were refusals; if it is not, the run reports
`stopped=no-stimulus` and **holds no reading at all**. A silent window is never written down as a
negative on its own.

The probe reports its own bounds on every line — sample interval, window, and the process importance
at each sample, because `moveTaskToBack` is a *request* to background and importance is the
measurement of whether it happened. And it logs **no clipboard text, ever**: length, MIME, label,
`EXTRA_IS_SENSITIVE`, and whether it is still our own marker. A probe for a feature whose whole risk
is other people's passwords must not put one in `logcat`.

### The decisions, pre-registered — written **before** the reading, on purpose

The point of writing these now is that they cannot be rationalised afterwards. Whatever comes back,
the product shape is already decided, and a reading that lands outside this table is a reading that
needs a new argument rather than a quiet reinterpretation.

| Reading 3 | Reading 4 | What ships |
|---|---|---|
| **works** | refused | The documented wall holds. §4's payloads as written, `clip.push` from the phone if §7's listener question also answers yes, and the capability stays gated on the accessibility service — which is now *measured* to be the reason rather than assumed |
| **works** | **also works** | The wall does not exist on this handset. Nothing changes in what ships — the gate stays, deliberately, because a permissiveness we cannot explain is not a permission we can rely on, and other devices do enforce this. Recorded in `docs/single-device-audit.md` as **unknown, single-device** |
| **refused** | refused | **A different feature.** The phone can read its clipboard only while it is on screen, so there is no background `clip.push` and no answerable `clip.request` from a backgrounded phone. What ships is Mac → phone (subject to reading 5) plus a phone-side *Send clipboard* affordance the person taps, and `clip.request` answers a specific error naming the wall — a new code, justified only because the Mac reacts differently: not a permission prompt, not a grey pane, but *open ConnectSuite on the phone*. §4 and §5 are rewritten before any of it is built |
| *no reading* | — | `stopped=no-stimulus` or `stopped=control-failed`. **Nothing is decided and nothing is built.** The run is repeated |

And reading 5, which is independent of all four:

| Reading 5 | What ships |
|---|---|
| The background write **lands** | Mac → phone works as §5 describes, and the phone still *offers* rather than applies — the offer is a design decision about a single-slot store, not a workaround for a wall |
| The background write is a **silent no-op** | The offer model becomes the only thing that works: the phone raises a notification carrying the entry, and the write happens in the moment the person taps it, which is a foreground moment by construction. **This is the same product either way**, which is the strongest argument that §5 got the design right |

**Nothing in §3, §4 or §5 may be built before readings 1, 3 and 4 are recorded in
`docs/testing.md`.** That is the same precondition `EXTRA_INITIAL_URI` carried, and it was worth it:
the answer there was the *opposite* of what the earlier document assumed.

A third instrument, if the readings disagree with the documentation: `logcat` for
`ClipboardService: Denying clipboard access to …`, the line the platform writes when it refuses. Its
absence proves nothing; its presence names the refuser.

## 3. What clipboard is not, and the boundary is sharper than it looks

**It is not a transfer.** Nothing here touches port 42503, `.part`, digests, resume or
`TransferRecord`. A clipboard entry is a small JSON payload on the control channel, and the moment
someone reaches for the bulk socket to carry a clipboard item, the design has gone wrong.

That has a consequence worth writing down now, because it is the first place this feature will be
asked to grow: **an image on the clipboard is out of scope for the first version, and it is out of
scope for a reason rather than for effort.** A copied image is arbitrarily large, it arrives as a
`content://` URI whose provider may not survive the read, and carrying it means either a size cap
that silently truncates people's work or a transfer with a progress UI — which is Files, which
exists. Version one is **text**, and the payload says so with a `kind` field rather than by omission,
so a Mac that meets an image entry from a later phone knows it is looking at something it cannot
render rather than at a broken text entry.

**It is also not a sync.** There is no continuous mirroring in this proposal. §5 argues that.

---

## 4. The payloads

Three names, and the direction each one runs in is the thing to get right first.

### `clip.push` — either side, unsolicited

The sender's clipboard changed and it is telling the other side.

```json
{"kind":"text","text":"https://example.com/a-thing","atMs":1788246046000,
 "source":"phone","appName":"Chrome","package":"com.android.chrome"}
```

- **`kind`** is `text` in this build. A receiver that does not recognise a `kind` shows the entry as
  *"something this Mac can't show yet"* and keeps its place in the history — never discards it, and
  never renders it as empty text.
- **`package` carries `appName` beside it, always.** The package-id rule, which is defect 28 and
  defect 33 and is already in `CLAUDE.md`: a package id may appear as a machine handle, never as the
  only thing a user reads. Resolution goes through `AppLabels.of` including when it fails, so
  `resolved / fell back` stays countable. **Both fields are optional** — the clipboard does not
  always name an owner — and when the owner is unknown the field is *absent*, never `"unknown"`.
- **`atMs`** is the sender's clock. It orders the history and it is **not** trusted for anything
  else; the two clocks disagree and nothing here needs them not to.
- **`source`** is `phone` or `mac`. It exists so a receiver can tell its own echo from a real
  change — see §5.

### `clip.request` — either side

*"Send me what you have now."* Answered with the same body as `clip.push`, or with an explicit empty:

```json
ack {"kind":"empty","atMs":1788246046000}
```

**`empty` is a `kind`, not a null.** A clipboard holding nothing and a clipboard that could not be
read are different sentences, and this project has now recorded that confusion enough times to name
it. The unreadable case is an **error**, with a code and a reason, not an empty ack.

### `clip.history` — either side

The last *n* entries the responder holds, newest first, same body per entry.

```json
request  {"limit":20}
ack      {"entries":[…],"hasMore":true}
```

**No cursor, and that is a decision.** The history is bounded (§6) and small; a pager over 20 rows
would be the third pager in this repo, each of which cost a defect — 32, 50 and 55. When the history
is capped at a size that fits one frame, `hasMore` exists only to say *"the cap is doing something"*
and never to be paged on.

### Errors

| Code | When |
|---|---|
| `PERMISSION_REQUIRED` | the accessibility service is not enabled, so a background read is refused. The `fixHint` deep-links to Settings, exactly as input's does |
| `FEATURE_UNAVAILABLE` | a `kind` the responder cannot produce |
| `BAD_REQUEST` | a malformed `limit`, a missing `text` on a `text` push |

There is deliberately **no** error for "the clipboard is empty". That is `kind: "empty"` and it is a
success.

---

## 5. The policy questions, answered rather than left open

### Does the Mac's clipboard follow the phone's automatically?

**No, not in version one, and this is the decision most likely to be argued with.**

Continuous two-way mirroring is what LinkMyMac does and it is what people expect. It is also a
feature whose failure mode is *silently replacing something the user was about to paste*, on a device
they are not looking at, with no undo. A clipboard is a single-slot store: writing to it destroys
what was there, and the person who loses work does not find out until they paste.

So: **`clip.push` arrives and is offered.** The Mac shows the new entry in its history and a one-tap
*Use this*, and the Mac's own clipboard is written **only when someone asks for it.** The phone
behaves the same way in the other direction.

The cost is one extra click on the common path. The alternative costs somebody a paragraph they had
copied. **If this is revisited, it is revisited with an undo, not by removing the click** — and the
history in §6 is what an undo would be built on, which is part of why it is here in version one
rather than later.

### The echo

A one-slot store plus two writers is an echo waiting to happen: the Mac writes what the phone sent,
notices its own clipboard changed, and pushes it back. `source` plus `atMs` is not enough on its own
— clocks disagree. **The rule: a side never pushes an entry whose text is identical to the last entry
it received.** One comparison, one field of state, and it is a *rule about what to send* rather than
a filter on what arrives, because the receiving side cannot tell an echo from someone genuinely
copying the same string twice.

`CLAUDE.md`'s tagged-union rule applies here in its concurrency half: the "last received" value is
written by the receive path and read by the change observer, and those are two callers. It gets its
concurrency stated, not just its type.

### What about passwords?

A clipboard carries credentials constantly, and this feature moves them over the network. Three
things, and none is optional:

1. **`android.content.ClipDescription.EXTRA_IS_SENSITIVE` is honoured.** An entry flagged sensitive
   by the app that produced it is **not pushed and not stored in the history.** Password managers set
   it. This is one boolean and it is the single highest-value line in the feature.
2. The transport is already TLS 1.3 with pinned certificates and no plaintext fallback, on the local
   network, with no relay. That is the whole point of the product and it applies here unchanged.
3. **The history is memory-only on both sides** (§6). Nothing a clipboard ever held is written to
   disk by this app.

---

## 6. The history — where the user's content lives, for how long, and what they can delete

**This is the first feature in ConnectSuite that stores the user's own content at rest.** Photos and
files *move* content; nothing kept a copy. A clipboard history keeps one, of the one surface people
paste passwords through, so the storage question is answered here in full rather than discovered
later in a bug report.

### The decision, in four lines

| Question | Answer |
|---|---|
| **Where** | **Process memory on each side, and nowhere else.** Not Room, not a file, not `electron-store`, not `localStorage`, not the OS keychain |
| **How long** | Until the link drops or the process ends, whichever is first. Bounded at **20 entries**, **64 KB** of text each |
| **Does it survive a restart** | **No**, on either side, and not across a reconnect either. A restart is a clear, and so is a disconnect |
| **What a person can delete** | Any single entry, and the whole list — on the side they are looking at, immediately, with no confirmation |

**Why memory and not Room**, given that Room is already there and every other list in this app uses
it: a clipboard history that survives a reboot is a file full of other people's passwords, sitting in
app-private storage on a phone that may be rooted, backed up, or handed to somebody. The feature is
not worth that, and "encrypt it" is not an answer — the key would live beside it. **Nothing a
clipboard ever held is written to disk by this app.**

**Cleared on disconnect**, which is the rule the contact cache and the thumbnail cache already
follow: an entry resolved against a phone that has since been unpaired is a claim this Mac cannot
still stand behind. Duplicates collapse to the most recent occurrence rather than filling the list.

**The 64 KB cap is on the wire as well as in memory.** `MAX_CONTROL_FRAME` already refuses more, and
the refusal must **name the cap rather than truncating**: a silently truncated clipboard entry is a
corrupt paste, which is defect 56's failure with a different surface — something that looks complete
and is half there. 20 × 64 KB is 1.3 MB per side, which is nothing.

### The part memory-only does not cover, and it is the one that would have leaked

**`LinkLog` writes to a rotating file on disk.** Every socket handler in this app logs, by a rule in
`CLAUDE.md`, and the success case logs as loudly as the failure. So a `clip.push` handler written the
way every other handler in this repo is written would put the user's clipboard — passwords included —
into a file, on both machines, while the history above was busy being scrupulously in-memory. The
decision is worth as much as its weakest writer.

**No clipboard text is ever logged, on either side, at any level.** What is logged instead, and it is
enough to debug with: `kind`, **length**, whether `EXTRA_IS_SENSITIVE` was set, the resolved app
label, and the counters with their denominators — `pushed / refused-as-sensitive / dropped-as-echo`.
A length and a source are what tell an entry apart in a log; the text adds nothing an engineer needs
and everything an attacker does.

The same rule binds the probe (§2 logs no text) and it binds any future crash report, any HUD, and
any `console.log` in the renderer.

### What "delete" honestly means, and the three things it cannot reach

A person who deletes a clipboard entry expects it to be *gone*. On the side they are looking at, it
is: the entry leaves the list and the memory holding it, immediately. Three things it does not reach,
and each is stated in the UI rather than left to be discovered:

1. **The other side keeps its own list.** The inventory is closed at three message names (§1) and
   none of them is a delete, so clearing is local by construction. The button says so —
   *"Clears this Mac's list. The phone keeps its own until it disconnects."* — rather than implying a
   reach the protocol does not have. Adding a fourth name to make deletion symmetric is a real
   argument someone could make; it is not made here, and it would need one.
2. **The OS clipboard is not ours.** One UI keeps its own clipboard history, macOS hands the
   pasteboard to whatever the user has installed — Alfred, Raycast, Paste. Once an entry has been
   *used*, it is in a store this app does not own and cannot clear. Deleting our row does not unsend
   a paste.
3. **An entry already pasted is out.** Obvious, and worth one sentence in the UI anyway, because the
   word "delete" invites the belief that it is not.

**`EXTRA_IS_SENSITIVE` entries never enter the history at all** (§5), so the strongest protection is
the one that never stores rather than the one that deletes well.

### The undo this is the foundation for

§5 refuses to write the Mac's clipboard automatically, and says that if that is revisited it is
revisited **with an undo, not by removing the click**. This history is what an undo would be built
on: the previous entry has to still exist somewhere in order to be put back. That is part of why it
is in version one rather than later — and it is also why it is capped, cleared and never written to
disk, because an undo buffer is not a reason to keep somebody's password for a week.

## 7. What this proposal does **not** answer

Named, so nobody reads silence as agreement:

1. ~~**Whether the phone can observe clipboard changes at all, or only read on demand.**~~
   **Now measured by the same run** — reading 5 in §2. `OnPrimaryClipChangedListener` is a
   *different* question from reading: the platform may allow the read and never deliver the
   callback, and the two want different products. The probe registers the listener before its own
   control write, so **one foreground callback is the known positive**; a listener that never fires
   even for that is not wired up and its later silence says nothing about the platform.

   The consequence is unchanged and is still the reason `clip.request` is its own name rather than a
   special case of push: **if the callback does not arrive while backgrounded, `clip.push` from the
   phone is impossible and the feature degrades to the Mac asking and the phone answering.** That is
   still a useful feature and the design survives it.
2. **What happens when the Mac is not the frontmost app.** Reading the macOS pasteboard is
   unrestricted; writing to it while another app is active is fine. No wall expected, no reading
   taken.
3. **Rich text and file references.** Out of scope with §3's reasoning; the `kind` field is what
   keeps them addable later without a protocol change.

---

## 8. The order to build it in

1. **The five readings in §2, with their controls, recorded in `docs/testing.md`.** Nothing else
   starts. **Done — the instrument ran on 2026-09-01, `docs/testing.md` → Slice 11, and the answer
   was row 3 of §2's table.** The sentence this line used to carry — *the instrument is built and
   has never been run, it was written on a day the phone was not attached* — is kept here as the
   record of the gap rather than deleted. If reading 1 fails, or the run reports `stopped=no-stimulus`,
   there is no reading and the run is repeated rather than interpreted. If reading 3 is a refusal,
   this document is rewritten before any code, because the feature it describes is not the feature
   that is possible — §2's pre-registered table says which one takes its place.
2. **`clip.request` on the phone**, the direction that needs no observer, plus the sensitive-flag
   refusal — red first, with a fixture that sets `EXTRA_IS_SENSITIVE` and asserts nothing is
   returned.
3. **`clip.push` from the phone**, if and only if §7's listener question answered yes.
4. **The Mac's half and the history**, which is where the echo rule and its concurrency statement
   live.
5. **The pane**, last, against a phone side already proven — the order Files used, and the reason
   slice 7 was cheap.

The capability turns on when all three verbs answer, and not one moment earlier.

**Status, 2026-09-01:** §1's decisions stand, §2's instrument is built and unrun, §6's storage
question is answered, and **no payload has been written into `docs/protocol.md`** — `clip.push`,
`clip.request` and `clip.history` are on `scripts/check-protocol-spec.mjs`'s debt list with that
reason attached, so the gap is counted on every commit rather than remembered.
