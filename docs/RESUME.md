# Resume here — written 2026-09-04, end of the clipboard + defect-84 sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · One-line state

**Clipboard is closed and the selection-toolbar question is settled as a platform wall.** Defect 84
is fixed and its branch is **unproven in the field on purpose**. Phase 7's four "remaining" panes
were never outstanding — they were rebuilt on 2026-09-04. **No defect touching a shipped feature is
open.**

## 1 · What is built, and what proved it

| Built | Proof |
|---|---|
| **Clipboard pane's phone-direction line** (defect 85) — four states, tagged union, four independent differences | `scripts/clipboard-silence-probe.mjs` at 1440×865 unzoomed: `top=360 bottom=438`, **100% on screen, above the list**, where the explanation had been `top=828`, **21%** |
| **`Send to Mac`** — `ACTION_PROCESS_TEXT`, phone backgrounded, no clipboard read | Tapped in Chrome's real toolbar: `clip.push → Mac via selection: 28 bytes from Chrome`, and `pbpaste` changed |
| **The four-tap setup card** (defect 86) on the phone's clipboard screen | Rendered and read back on hardware, all four steps in walking order |
| **Per-key notification cooldown** (defect 84) | Jio's measured sequence **11 banners → 1**; the control from the same run (a chat key, never `ongoing`) stays at **3**. Three red-first mutations |

**Tests:** Mac **500** (`cd desktop && npm test`). Phone: +8 `SelectionSend`, +7 `ClipboardCopy`.
Every decision added this sitting has a red-first mutation recorded in `docs/testing.md`.

## 2 · Committed

```
82cb830  Defect 84: a per-key cooldown, sized by a signal the phone already sends
8f38065  The selection-toolbar wall, recorded as a wall
84b3983  Defect 86 fixed: the four taps, in walking order, on the phone
963df26  Defect 86: the toolbar entry was drawn all along, behind a Samsung switch
43834ff  Send to Mac: the cheap trigger, and the copy it made stale
a28b7ea  Defect 85: a live phone-direction line, in the column people read
```

Working tree clean. `scripts/check-defects.sh` green at **70 rows**.

## 3 · Half-built and readable

- **`scripts/selection-toolbar-probe.sh`** — drives a long-press in one app and captures a frame. It
  **cannot classify**, deliberately: `uiautomator dump` cannot see the floating toolbar, so a person
  reads the picture. Reports `NO READING` as a third outcome rather than folding a missed stimulus
  into a negative.
- **`app/src/debug/.../ClipTriggerProbe.kt`** — the four-route trigger probe. Its `PROCESS_TEXT`
  filters were removed when the real feature shipped, so it no longer doubles the toolbar row.
- **Nothing is mid-edit.** No file is in a state that will not compile.

## 4 · What needs your hands, and why

1. **The WhatsApp compose box** — the one untested case, with the prediction already written down in
   `docs/testing.md` → Slice 21 so it cannot be rationalised afterwards. Expected: the platform
   toolbar, `Send to Mac` in the `⋮`, possibly below WhatsApp's own bold/italic items. Type text,
   don't send, long-press it. Three outcomes and what each means are in that slice.
2. **Instagram, X, Samsung Notes** — returned `NO READING` (no text field on the launch screen). One
   long-press each in any field finishes the table.
3. **Defect 84's cooldown branch has never fired.** It needs Jio's next active period; it is not
   producible on demand. When it fires the line says `cooldown <package> (status key, …) — N held /
   M posted`, and that line beside a stable banner count is the pass.
4. **F6 / P3 — the pairing sighting**, outstanding from earlier phases. Needs the phone forgotten on
   the Mac and a re-scan; unpairing leaves this Mac unable to reconnect until someone walks over.

## 5 · Where the panes stand

**All four were rebuilt in the 2026-09-04 design pass.** The 28 rows `C1–C7 / K1–K6 / G1–G7 / T1–T3 /
O1–O5` are feature departures *inside* them: **21 `reshaped`** (deliberate, argued, discharged),
**6 `unbuilt` and tagged *Not yet*** (G3 sounds, G4 auto-update, G7 per-app filters, T2 HEIC, C1
waveform), and **1 genuinely open — O4**, the Device status rings, whose `battery.state` and
`net.state` are already on the wire.

**Clipboard is the pane furthest *ahead* of the drawing**, not behind it: K1–K6 all reshaped, plus
the defect-85 state line, which is not in `ConnectSuite.dc.html` at all.

## 6 · What I would do next, and why

1. **O4, the Device status rings.** The last genuinely unbuilt design row whose data already exists
   on the wire — no protocol work, no new grant, no second device. It is the cheapest real progress
   left in the pane set, and with defect 84 closed there is nothing more urgent competing.
2. **The designer's hour, and it should be booked rather than worked around.** The
   *unavailable / partial / failed / empty* vocabulary, once. **Calls was the fifth pane to invent
   its own**, and defect 85 was that same problem reaching a user — a pane that could not say why
   nothing had arrived. Every pane built after this hour is cheaper; every one built before it adds
   a sixth dialect. This is the highest-value hour left in Phase 7 and it is not mine to spend.
3. **Then Phase 8 signing**, which unblocks Camera, the packaged-app relaunch (D15) and D12/D13.

I would **not** touch clipboard again. It is closed. The two things still unknown about it —
WhatsApp's compose box, and whether the Samsung switch exists off-Samsung — are readings, not work.

## 7 · Left changed on your devices

- **The phone: `Send to Mac` is switched ON** in *Manage apps*, from proving the mechanism. The
  other ten rows were left untouched.
- **The phone: auto-rotate was toggled and restored.** It is back on.
- **The Mac: the dev Electron run is live on `--remote-debugging-port=9222`.** The packaged app in
  `release/mac-arm64` was stopped so the dev run could hold the link and was not restarted — it
  cannot start unattended anyway (D15, the Keychain dialog).
- Clipboard history on both sides holds probe strings. Memory only; gone on restart.
