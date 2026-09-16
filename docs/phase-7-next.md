# What is left, in priority order — written 2026-09-15

> **This is the list that came through with its columns eaten.** Written to a file rather than
> printed, and deliberately narrow: no table is wider than three columns, and the long reasoning is
> under each row instead of inside it.
>
> Ordered by **what it changes for a person using the app**, not by size. Everything here is
> measured against the running build, not recalled from `docs/design-departures.md`, which is prose
> written pane by pane over five weeks.

## Done this sitting — not in the list below

| | What |
|---|---|
| ✅ | `docs/phase-7-state.md` corrected — five optimistic claims, plus the stale half of §1, §2 P4, §4 and §5.2 |
| ✅ | Defect **110** — the spec checker walks both ways now; `mic.*` was the worked example |
| ✅ | Defect **109** — battery on the device card, the strip and the hero |
| ✅ | The Settings → Advanced battery line |
| ✅ | Deep links for the clipboard's Restore and the trust controls |
| ✅ | **P5** pairing expiry — `fresh` and `stale` both on hardware |

---

## 1 · Needs nothing but time

### 1.1 — M5, the mirror rail's Transfer slot

**Why first:** it is the only one of the five struck-through rows in `docs/phase-7-state.md` §2 that
was recorded as built and is not. The rail's own comment says so: *"Record and Transfer are
unbuilt."* Two commands and one readout where the handoff draws five.

`fs.*` is specified and built now, which is the blocker the row named. Routes to Files rather than
opening its own picker — a second push path is a second expression of one rule.

### 1.2 — M9, keep the phone's screen on while mirroring

**Not built, and deliberately.** `docs/phase-7-m9-keep-screen-on.md` is the pre-registration: the
mechanism is unknown on this handset and two of its four outcomes produce **no feature**. Building
the toggle first risks a switch the platform ignores, which is the one outcome every automated check
calls a pass.

Needs the user's hands once for the MediaProjection consent tap. The commands are in §4 of that file
and the control comes before the reading.

### 1.3 — Defect 103, `LinkService` believes it is foreground forever

Carried from `docs/RESUME.md`. Cheapest real fix left; `MirrorService` is the worked example in the
same codebase.

### 1.4 — Defect 106's phone-side keyframe instrumentation

Written and never run. Needs a session after the reinstall that has now happened.

### 1.5 — The media remote card has sunk below the fold

Measured 2026-09-15: `top: 915`, verdict **`reachable`**, fraction **0.76**, viewport 1047. It was
at 535 when `docs/phase-7-state.md` was written; Quick actions, Recent activity and the footer strip
landed above it on 2026-09-04 and pushed it down. **At the design's 920px height it is below the
fold entirely.**

Not stranded, so not defect 85 — but it is the same pane and the same mechanism, and it is a card a
person reaches by deep link and then has to scroll for.

### 1.6 — Bookkeeping that keeps a deleted feature deleted

`docs/design-departures.md` → **S6** should read **withdrawn**, not *built*. The rota was built on
2026-09-04 and deleted on 2026-09-08 (defects 96, 97). A row recorded as satisfied by a feature that
was then removed is how a removed feature gets rebuilt.

---

## 2 · Needs the designer — one hour, and it is the same hour it has been

**The *unavailable / partial / failed / empty* vocabulary, drawn once.** Five panes have now each
invented their own: N4 Notifications, P5 Photos, F7 Files, A2 Activity, **C6 Calls**.

`docs/phase-7-state.md` said *"Still four. A fifth will invent a fifth"* — the fifth arrived, which
is the fourth of the five optimistic claims corrected there. A sixth will invent a sixth.

Also owed: a drawn pairing screen (the design has **no unpaired state at all**), and a decision on
Quick actions, which was built without one.

---

## 3 · Needs money — an Apple Developer account

Unchanged from `docs/RESUME.md` and nothing moves without it. **Both artifacts were measured rather
than assumed:** the `.dmg`'s app is *ad-hoc* signed so Gatekeeper returns an error rather than a
verdict (D12 — worse than unsigned, since the right-click bypass does not apply), and the release
APK is refused outright with `INSTALL_PARSE_FAILED_NO_CERTIFICATES` (D13).

This is Phase 8, it gates Phase 9, and it also gates **`mic.*`** — see §4.

---

## 4 · Blocked on the signing test, and this is now enforced

`mic.start`, `mic.stop` and `mic.state` are fully specified in `docs/protocol.md` — three `###`
sections, a negotiated ack, a `silenced` state, an error table — and have **no `MessageType`
constant on either side**. The contract describes a feature neither end can send a byte of.

It is on `SPECIFIED_NOT_ON_THE_WIRE` with its gate stated, printed on every commit. **Do not start
it to clear the entry**: the Mac half needs a hardened-runtime microphone entitlement, and whether
it is buildable at all is unknown until the signing test is taken.

---

## 5 · Needs a second device

Unchanged, and all three rows are honest `None`s on this handset:

- **the mirror fit on other ratios** — verified on the S25 only; `docs/testing.md` → Slice 40 is a
  pre-registration with six outcomes and no device has been pointed at it;
- **every reliability fix from Phase 6** — whether each is a fix or a One UI workaround needs a
  second skin;
- **defect 17** — pairing a second phone costs the S25's pairing, so this is a swap each time.

---

## 6 · Small, found while doing the above, not yet filed

- **Recent activity runs two fields together.** The Overview card drew
  `DisconnectedThe connection to your phone failed. See the log for details.` — a missing separator
  between the event label and its detail. Seen in
  `docs/evidence/phase-7-ui-batch-2026-09-15/01-battery-overview.png`, not measured further.
- **`docs/RESUME.md` no longer holds what `CLAUDE.md` says it holds.** The roadmap describes it as
  carrying *"the post-Phase-6 brief and the ordered Phase 7 list"*; it currently holds the
  post-mirror-block handoff and no ordered Phase 7 list. This file is that list.
