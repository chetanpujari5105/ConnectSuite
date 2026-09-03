# Phase 7 — what is actually left

> **Written 2026-09-03, after Phase 6 closed.** Three questions, answered from measurement where
> measurement was possible: which panes are unbuilt or half-built against `ConnectSuite.dc.html`,
> what in `docs/design-departures.md` has been overtaken by the wire, and which of the homeless
> features still have no home.
>
> The readings are `docs/testing.md` → **Phase 7 Slice 10**, taken through `scripts/probe.mjs` with
> a control on every one, against a **connected** app with real data in the panes. Two instrument
> faults were refused by the harness before any number came out; both are recorded there.

---

## 1 · Panes, against the design

**Twelve nav rows. Exactly one is unbuilt.** Everything else is built and departs from the drawing
by a measured amount.

| Pane | State | The gap, measured |
|---|---|---|
| **Camera** | **unbuilt** — the only one | `aria="Camera — not built yet"`. Needs a macOS **Camera Extension**: a signed system extension, so it is a **distribution problem before it is a code problem**, and Phase 8 is shut. It is correctly in no phase |
| **Calls** | **half-built, and the largest visual gap** | Handoff: `300px 1fr 300px`, a 3×4 dialer, a 40-bar waveform, Mute / Keypad / Speaker. Build: one block, **0 dialpad keys, 0 mute/speaker, 0 waveform**. The 51 buttons are 1 dial + 50 log rows, so the absences are real |
| **Clipboard** | **half-built, and furthest from the drawing while fully working** | Over **4 real history rows**: **0** History/Favourites/Pinned tabs, **0** kind badges (URL, Aa, IMG, {}, FILE), **0** star/pin actions, **0** three-step sync timeline |
| **Settings** | **half-built** | **3 of 8** panes (`Connection`, `Advanced`, `About`); **`200px 916px`** against the handoff's `200px 1fr 320px` |
| **Messages** | **structurally different** | `804px 320px` against `280px 539px 300px`. List **or** thread with a back link, plus a global contacts directory — not list + thread + this-conversation's detail |
| **Overview** | **half-built** | 3 cards drawn (device, capability list, media remote) against the handoff's Quick actions / Device / Recent activity. **Quick actions and Recent activity are both absent** |
| **Pairing** | **placeholder** | A route with no row, drawing a QR on a primary card. `docs/design-departures.md` carries a full proposal in the handoff's language; the design has **no unpaired state at all** |
| Mirror · Files · Photos · Notifications · Activity · Apps | **built**, with departures recorded per pane | Not re-measured in slice 10 — the probe read the wrong level and says so. `docs/design-departures.md` remains the record |

**The one-line answer:** *Camera* is the only unbuilt pane and it is correctly parked. The real
Phase 7 surface is **Calls, Clipboard, Settings and Overview** — four panes that work and do not
look like the design — plus **pairing**, which is not a departure but a hole.

---

## 2 · Departures the wire has overtaken

`docs/design-departures.md` rows are dated. These were true when written and are not now. **This is
the section to act on**, because each is a row whose stated blocker has been removed.

| Row | Said | Now | Cost |
|---|---|---|---|
| **S6** | Status island cycling *"Clipboard synced"* / *"Transfer complete · 4.2 MB"* — *"Both name features that do not exist (Phase 5)"* | **Both exist.** Clipboard shipped in Slices 11–13; transfers in Slices 3–9. The island still narrates only connection phase and refusals | Small. The rota takes any string |
| **S10** | Overview's *Recent activity* — *"needs a session store nothing writes yet"* | **`main/activity.ts` is that store**, landed 2026-09-02 with eleven named recording sites | Small. The data is already there |
| **M5** | Mirror tool rail **Transfer** — *"`fs.*` has no payload spec yet. Phase 5"* | **`fs.*` is specified and built**, both directions, with resume | Medium. It is a rail slot and a route |
| **Settings → File transfer** | *"real; blocked on Phase 5, ships with the feature"* | **Phase 5 shipped and the pane did not** | Small |
| **Pairing P4** | *"A reason when pairing is refused — **not possible**. The Mac sees a closed socket and nothing else"* | **`pair.rejected` is in `docs/protocol.md`, in `MessageType`, in `shared/protocol.ts` as a typed `PairRejectReason`, and the phone sends it** (`ControlSession.kt`). **No Mac-side handler exists** | Small, and it is the sharpest row here — the wire grew *specifically* to answer this and the Mac never listened |
| **Pairing P3 / F6** | *"Distinguishing 'nobody has scanned' from 'scanned, and failing' — **not possible**"* | **Specified.** The scan-time mDNS TXT attribute is typed in `shared/protocol.ts`; phone half built | Small–medium |
| **X5** | Media remote and contacts have *"no pane in the design"* | Still true of the **design**; both are reachable by **deep link** since Slice 2 | Nothing to do until the designer draws one |
| **S4 / S5** | Battery percentage removed; *Signal* cut | **Still correct.** `battery.state` and `net.state` are both on `check-protocol-spec.mjs`'s debt list with **no handler on either side**. The three battery slots exist in the DOM and are `hidden` | Unchanged — do not "fix" this |
| **N4 · P5 · F7 · A2** | Four panes each invented their own *unavailable / partial / failed / empty* state | **Still four.** A fifth will invent a fifth | The designer's, not ours. It is the single most useful hour available |

**`pair.rejected` is the one to do first.** It is one handler over a message that already exists on
the wire and already leaves the phone, and it removes the worst failure on the first screen a
stranger sees: a stale code rendering as an indefinite *"Waiting for a scan"* — the silent-no-op
shape this project rules out everywhere else.

---

## 3 · The homeless features — the count is six, and it was never seven

`docs/design-departures.md` **X5** names them: *media remote, contacts, QR pairing / first run, the
capability list, manual address, log tail.* **Six.** `docs/phase-7-homeless-features.md` opens by
quoting the premise as *"six shipped features have no home"* and then shows the real number was
**three**. Nothing in this repo has ever listed seven, and the difference is worth keeping rather
than quietly rounding — the same discipline as counting packages against activities.

**Where the six stand now, measured:**

| # | Feature | State | Reading |
|---|---|---|---|
| 1 | **Media remote** | **homed by search, not by design** | palette `music` → `Now playing · In Overview`. Card is at `top: 535`, above the fold. No drawn treatment |
| 2 | **Contacts** | **homed by search, not by design** | palette `contact` → `Contacts · In Messages`. A 496px card at `top: 233` |
| 3 | **QR pairing / first run** | **still homeless, and still unfindable** | palette `pair` → **[]**, control 6. A route with no row, drawing a placeholder |
| 4 | **Capability list** | **homed** | "What this phone can do", measured on Overview |
| 5 | **Manual address** | **homed** | Settings → Connection |
| 6 | **Log tail** | **homed** | Settings → Advanced |

**So: three properly homed, two homed by a deep link the designer has not seen, one still homeless.**

### Two the wire grew after X5 was written, and neither has a home

Both are shipped, working, and unreachable by the app's own search — the exact gap Slice 2 measured
and fixed for the media remote:

| | Feature | Reading |
|---|---|---|
| **7** | **The clipboard's undo** — auto-apply keeps what it overwrote as a `displaced` entry that **Restore** puts back (Slice 12) | palette `restore` → **[]**, `displaced` → **[]**, `history` → **[]** |
| **8** | **Trust controls** — Forget, trusted devices, and the repudiated state defects 73–76 built | palette `forget` → **[]**, `trust` → **[]**, `unpair` → **[]** |

**If a seventh homeless feature is wanted, it is the clipboard's Restore** — and it arrived after
the list was written, which is the more useful observation: **X5 is a snapshot, and every feature
shipped since has been added to a pane without anyone re-asking whether search can find it.** The
deep-link mechanism exists and costs two lines each.

---

## 4 · What Phase 7 is, stated as work

Ordered by **what it changes for a person using the app**, not by size.

1. **`pair.rejected` on the Mac.** One handler. Removes an indefinite silent wait on the first
   screen a stranger meets. The wire is already there.
2. **A native macOS notification for a mirrored phone notification.** See §5 — this is not a
   departure, it is the product's headline feature not reaching the desktop. `Notification` is never
   imported anywhere in `desktop/src`.
3. **Deep links for Restore and trust**, and Settings → **General** / **Notifications** /
   **File transfer**. All Mac-side, all blocked on nothing.
4. **Calls' three columns and the keypad.** `call.dial` exists; six of eight gaps need no wire.
   Mute and DTMF need an `InCallService` and are the designer's to confirm.
5. **Clipboard's tabs, kind badges and timeline.** Pure Mac-side.
6. **The designer's hour**: the *unavailable / partial / failed / empty* vocabulary (four panes have
   now each invented their own), a drawn pairing screen, and a decision on Quick actions (X9).

Deliberately **not** in Phase 7: Camera (needs Phase 8's signing), and anything requiring a second
device.
