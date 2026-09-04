# Resume here — written 2026-09-04, end of the clipboard sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · One-line state

**Clipboard is closed** — both directions, the wall measured, the pane able to say why nothing
arrived, and a second send route built and proven. **Phase 7's four remaining panes were never
outstanding**; they were rebuilt on 2026-09-04 and what is left inside them is 28 rows that are
almost all deliberate decisions, not gaps. The real remainder is §5 of `docs/phase-7-state.md`,
one open defect, and an hour of the designer's time.

## 1 · What is built, and what proved it

| Built | Proof |
|---|---|
| **The Clipboard pane's phone-direction line** (defect 85) — four states, tagged union, differing four independent ways | `scripts/clipboard-silence-probe.mjs` at 1440×865 unzoomed: `top=360 bottom=438`, **100% on screen, above the list**, where the explanation had been `top=828`, **21%**. Left column 299 → 560 chars |
| **`Send to Mac`** — `ACTION_PROCESS_TEXT`, phone backgrounded, no clipboard read | Tapped in Chrome's real toolbar: `clip.push → Mac via selection: 28 bytes from Chrome`, and `pbpaste` changed. The far end measured, not the stimulus reported |
| **The four-tap setup card** (defect 86) on the phone's clipboard screen | Rendered and read back on hardware, all four steps in walking order |
| **The clipboard wall itself** | Slice 11: 90/90 and 60/60 background reads refused, with the accessibility service bound and disabled alike. Slice 17: three further entry points, all refused at `importance=125` |

**Test counts:** Mac **488** (`cd desktop && npm test`), phone `sync-module` +8 for `SelectionSend`,
+7 for `ClipboardCopy`. Every new decision has a red-first mutation recorded in `docs/testing.md`.

## 2 · Committed

```
84b3983  Defect 86 fixed: the four taps, in walking order, on the phone
963df26  Defect 86: the toolbar entry was drawn all along, behind a Samsung switch
43834ff  Send to Mac: the cheap trigger, and the copy it made stale
a28b7ea  Defect 85: a live phone-direction line, in the column people read
bd7a0e5  Defect 85: the clipboard pane's copy is right and in the wrong column
```

Working tree clean. `scripts/check-defects.sh` green at **70 numbered rows**.

## 3 · Half-built and readable

- **`scripts/selection-toolbar-probe.sh`** — drives a long-press in one app and captures a frame.
  It **cannot classify**, deliberately: `uiautomator dump` cannot see the floating toolbar, so a
  person reads the picture. Four apps swept; three returned `NO READING`, which is a missing
  reading and not a pass.
- **`app/src/debug/.../ClipTriggerProbe.kt`** — the four-route trigger probe. Its
  `ACTION_PROCESS_TEXT` filters were **removed** once the real feature shipped, so it no longer puts
  a second ConnectSuite row in the selection toolbar. Routes 1–3 still runnable.
- **Nothing is mid-edit.** No file is in a state that will not compile.

## 4 · What needs your hands, and why

1. **WhatsApp is behind a biometric lock.** The category question is unanswered for the one app you
   asked about. Two cases, and they need different verdicts:
   - long-press a **message bubble** → if the bar appears at the *top* with icons (reply, star,
     trash, forward), that is WhatsApp's own message action bar, not a text selection. No
     `PROCESS_TEXT` is possible there, ever, in any app that does this.
   - type in the **compose box**, long-press the text → if you get `Cut Copy Paste ⋮`, it is the
     platform toolbar and `Send to Mac` is in the `⋮`.
2. **Instagram, X and Samsung Notes** returned `NO READING` — no text field on the launch screen.
   Same one long-press each, in any field, to finish the table.
3. **F6 / P3 — the pairing sighting**, still unproven from earlier phases. Needs the phone forgotten
   on the Mac and a re-scan; unpairing leaves this Mac unable to reconnect until someone walks over.

## 5 · Where the panes actually stand

**Against `ConnectSuite.dc.html`, all four were rebuilt in the 2026-09-04 design pass** — Calls
(three columns, filter strip, running clock, 3×4 keypad), Clipboard (two columns, kind badges, sync
timeline), Settings (three columns, six panes from three), Overview (Quick actions, Recent activity,
footer strip). The 28 rows `C1–C7 / K1–K6 / G1–G7 / T1–T3 / O1–O5` are feature departures *inside*
those panes, and reading their status column:

- **21 are `reshaped`** — a deliberate, argued difference from the drawing, already discharged.
- **6 are `unbuilt` and tagged *Not yet*** — G3 interface sounds, G4 automatic updates, G7 per-app
  filters and quiet hours, T2 HEIC conversion, C1 the waveform. Each has a reason recorded.
- **1 is genuinely open work: O4**, Device status rings. `battery.state` and `net.state` are both
  already on the wire.

**Clipboard specifically:** K1–K6 are all reshaped and it now carries the defect-85 state line,
which is not in the design at all. It is the pane furthest *ahead* of the drawing, not behind it.

## 6 · What I would do next, and why

1. **Defect 84 — one notification, eleven banners.** The only open defect touching a shipped
   feature, and it is the one a user meets daily. It is a **product judgement**, not a bug fix: a
   per-key cooldown decides how soon one key may banner twice, and the wrong fix (a package
   allowlist) is already refused in `nativeNotify.ts`. Do this first because it degrades something
   people are already using.
2. **O4, the device status rings.** The last genuinely unbuilt design row whose data already exists
   on the wire — no protocol work, no new grant. Cheapest real progress in the pane set.
3. **The designer's hour**, and it should be booked rather than worked around: the
   *unavailable / partial / failed / empty* vocabulary, once. **Calls was the fifth pane to invent
   its own**, and defect 85 was that same problem reaching a user. Every pane built after this hour
   is cheaper; every one built before it adds a sixth dialect.

I would **not** touch clipboard again. It is closed, and the two things still unknown about it
(WhatsApp's toolbar, whether the Samsung switch exists off-Samsung) are readings, not work.

## 7 · Left changed on your devices

- **The phone: `Send to Mac` is switched ON** in *Manage apps*, done while proving the mechanism.
  The other ten rows were left untouched.
- **The phone: auto-rotate was turned off and back on** during a screenshot. It is back on.
- **The Mac: the dev Electron run is live on `--remote-debugging-port=9222`.** The packaged app in
  `release/mac-arm64` was stopped so the dev run could hold the link, and was not restarted — it
  cannot be started unattended anyway (D15, the Keychain dialog).
- Clipboard history on both sides holds probe strings (`defect-85 …`, `selection-route-…`). Memory
  only; gone on restart.
