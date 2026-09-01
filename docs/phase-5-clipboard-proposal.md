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

## 2. The wall, stated as precisely as it can be without a reading

`CLAUDE.md` carries it in one line: **background clipboard reads are blocked since Android 10 unless
the app has an enabled AccessibilityService or is the default IME.**

That sentence is the whole feature's foundation and it is currently **inherited from documentation,
not observed on this handset.** Every other load-bearing platform claim in this project has been
measured through the product's own client — the SAF refusal, the bound-selection cursor, the pending
`MediaStore` resume — and each time the measurement changed something. This one has not been taken.

**What makes it more than pedantry here:** this app *does* have an enabled AccessibilityService
(Phase 3, for input injection), so the documented rule says clipboard reads should simply work. If
that is right, clipboard is a small feature. If Samsung's One UI adds a further restriction — and
`docs/single-device-audit.md` §4 is a list of places it already has — then the honest product is a
foreground-only clipboard, which is a *different feature* with different copy, different capability
gating, and a different pane on the Mac.

**The two readings that settle it are cheap and neither has been taken:**

1. **Background read.** With the app backgrounded and the accessibility service enabled, call
   `ClipboardManager.getPrimaryClip()` from `LinkService` and log what comes back. The control that
   makes it evidence: copy a **known** string on the phone first, and assert the read returns that
   string — not merely that it returns non-null. A stale clip from an earlier foreground read is the
   lookalike, and it is the obvious one.
2. **Background read with the accessibility service *disabled*.** The same call, same conditions.
   This is the control that says the first reading was about the accessibility grant and not about
   something else. Without it, "it worked" is a fact about this build and not about the mechanism.

A third, if the first two disagree with the documentation: `logcat` for
`ClipboardService: Denying clipboard access to …`, which is the line the platform writes when it
refuses — an absence there is not proof, but its presence names the refuser.

**Nothing in §3 or §4 may be built before reading 1 and its control are recorded in
`docs/testing.md`.** That is the same precondition `EXTRA_INITIAL_URI` carried through §8.3, and it
was worth it: the answer there was the *opposite* of what the earlier document assumed.

---

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

## 6. The history

- **Bounded at 20 entries, in memory, on each side.** Not Room. A clipboard history that survives a
  reboot is a file full of other people's passwords, and the feature is not worth that.
- **Cleared on disconnect**, the same rule the contact cache and the thumbnail cache already follow:
  an entry resolved against a phone that has since been unpaired is a claim this Mac cannot still
  stand behind.
- **Duplicates collapse** to the most recent occurrence rather than filling the list.
- 20 entries × a text cap of **64 KB** each is a worst case of 1.3 MB per side, which is nothing, and
  the cap is on the wire as well: `MAX_CONTROL_FRAME` already refuses more, and the refusal must name
  the cap rather than truncating — a silently truncated clipboard entry is a corrupt paste, which is
  the same failure as a truncated file with the same "looks complete" symptom (defect 56).

---

## 7. What this proposal does **not** answer

Named, so nobody reads silence as agreement:

1. **Whether the phone can observe clipboard changes at all, or only read on demand.**
   `ClipboardManager.OnPrimaryClipChangedListener` in a background service is the second half of the
   §2 wall and it is a *different* question from reading: Android may allow the read and never
   deliver the callback. If the callback does not arrive, `clip.push` from the phone becomes
   impossible and the feature degrades to `clip.request` — the Mac asks, the phone answers. **That is
   still a useful feature and the design must survive it**, which is why `clip.request` exists as its
   own name rather than as a special case of push.
2. **What happens when the Mac is not the frontmost app.** Reading the macOS pasteboard is
   unrestricted; writing to it while another app is active is fine. No wall expected, no reading
   taken.
3. **Rich text and file references.** Out of scope with §3's reasoning; the `kind` field is what
   keeps them addable later without a protocol change.

---

## 8. The order to build it in

1. **The two readings in §2, with their controls, recorded in `docs/testing.md`.** Nothing else
   starts. If reading 1 fails, this document is rewritten before any code, because the feature it
   describes is not the feature that is possible.
2. **`clip.request` on the phone**, the direction that needs no observer, plus the sensitive-flag
   refusal — red first, with a fixture that sets `EXTRA_IS_SENSITIVE` and asserts nothing is
   returned.
3. **`clip.push` from the phone**, if and only if §7's listener question answered yes.
4. **The Mac's half and the history**, which is where the echo rule and its concurrency statement
   live.
5. **The pane**, last, against a phone side already proven — the order Files used, and the reason
   slice 7 was cheap.

The capability turns on when all three verbs answer, and not one moment earlier.
