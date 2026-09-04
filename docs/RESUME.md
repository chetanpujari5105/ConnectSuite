# Resume here — written 2026-09-05, end of the vocabulary-audit sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · One-line state

**Phase 7's build work is done and the phase is waiting on one hour of the designer's time.** The
copy audit is finished and published; the below-the-fold sweep is clean; two rules the last sitting
owed now have enforcement. No defect touching a shipped feature is open.

## 1 · What is built, and what proved it

| Built | Proof |
|---|---|
| **The vocabulary audit** — 83 states, 8 ideas, 19 panes, verbatim, with the guard condition for each | `docs/empty-and-failure-states.md`, and published at the link in §4. Generated from the source, not retyped; every number parsed out of its own tables |
| **The below-the-fold sweep** across every pane | `scripts/card-visibility-sweep.mjs` at 1440×865: **23 blocks, 21 visible at rest, 2 reachable, 0 stranded** |
| **`__probe.onScreen`** — the one on-screen check every pane uses | `scripts/probe.test.mjs`, 18 pass. Finds the scroller by walking ancestors instead of assuming it |
| **`check-debt-claims.mjs`** — the debt list can deny a false claim now | 5 fixtures, both directions. The first is the verbatim `RESUME.md` sentence that got through |
| **`check-state-vocabulary.mjs`** — the audit's numbers derive from its tables | Both wired as commit hooks; there are **8** now |
| **O4 — Device status rings**, and the `battery.state` / `storage.state` wire under them | On hardware: `79% / Charging` green, `13.7 GB / free of 490 GB` amber at 2.8% free |

**Tests:** Mac **514** (`cd desktop && npm test`). Phone: `+9` `VitalsPayloads`, `+8`
`SelectionSend`, `+7` `ClipboardCopy`.

## 2 · Committed

```
4008bd0  A debt list that can deny, one on-screen check, and the pane sweep
0a71840  The state enumeration's own numbers were wrong; they are checked now
fdde030  The empty and failure states, enumerated
1010604  O4: Device status rings, and the wire they needed first
e4dba7c  Defect 84: the mechanism was wrong, and we are not the cause
82cb830  Defect 84: a per-key cooldown, sized by a signal the phone already sends
8f38065  The selection-toolbar wall, recorded as a wall
84b3983  Defect 86 fixed: the four taps, in walking order, on the phone
a28b7ea  Defect 85: a live phone-direction line, in the column people read
```

Working tree clean. All eight commit hooks green.

## 3 · Half-built and readable

- **`scripts/card-visibility-sweep.mjs`** — reports `NOT MEASURED` as a third outcome rather than
  folding a selector gap into a clean pane. Its heading selector is a **known-incomplete
  enumeration**: seven container conventions exist and it names them, so an eighth will show up as
  `NOT MEASURED` rather than as a pass.
- **`scripts/selection-toolbar-probe.sh`** — captures a frame for a person to read; cannot classify,
  because `uiautomator dump` cannot see the floating toolbar.
- **Nothing is mid-edit.** No file is in a state that will not compile.

## 4 · What needs your hands, and why

**1. The vocabulary decision.** **`docs/empty-and-failure-states.md` in this repo is the
deliverable** — 83 sentences grouped by meaning.

> It was also published as a hosted page and **that link is dead**; the publish reported success
> twice and left nothing the account can open. The file is complete and is the source the page was
> generated from, so nothing is lost. Ask for it to be re-published if a link is wanted. The numbers that make the case: **28 sentences for "there is nothing here"** with four
grammatical openings, **three verbs** for failure, **three words** for unavailability, Files stating
one condition two ways *within a single pane*, and one sentence appearing twice with different
punctuation. This is the blocking item for the rest of Phase 7.

**2. If the music stops and restarts again — run this _while it is happening_.** The reconstruction
is impossible after the fact; `logcat` had already rolled last time (0 lines matching the window).

```sh
adb -s "$(scripts/target-device.sh)" logcat -b all -v time \
  | grep -iE "AudioFocus|MediaSession|audio_focus|ActivityManager.*jio"
```

Start it **before** the music stops, leave it running, and take this at the moment it happens:

```sh
adb -s "$(scripts/target-device.sh)" shell am get-standby-bucket com.jio.myjio
```

The standing reading is bucket **40 (RARE)** with no battery exemption — a sufficient cause on its
own, pointing away from us, but it is a condition today rather than a measurement of that window.

**3. The WhatsApp compose box** — prediction pre-registered in `docs/testing.md` → Slice 21 so it
cannot be rationalised afterwards. Expected: the platform toolbar with `Send to Mac` in the `⋮`.

**4. Instagram, X, Samsung Notes** — returned `NO READING` (no text field on the launch screen). One
long-press each finishes the table.

**5. Defect 84's cooldown branch has never fired.** Needs Jio's next active period; not producible
on demand. The line will read `cooldown <package> (status key, …) — N held / M posted`.

**6. F6 / P3 — the pairing sighting.** Needs the phone forgotten on the Mac and a re-scan; unpairing
leaves this Mac unable to reconnect until someone walks over.

## 5 · Where the panes stand

All four were rebuilt in the design pass. Of the 28 feature rows inside them: **21 `reshaped`**,
**6 `unbuilt` and tagged *Not yet*** with a reason each (G3 sounds, G4 auto-update, G7 per-app
filters, T2 HEIC, C1 waveform), and **O4 built**.

**Nothing in the pane set is unbuilt for want of a sitting.** What remains is either a stated
*Not yet* or the designer's decision.

## 6 · What I would do next, and why

1. **Apply the vocabulary once it is decided** — every pane at once, in one pass, because the value
   is in their agreeing rather than in any single sentence. The audit already lists every site, and
   the sweep says where each one sits.
2. **Then Phase 8 signing.** It unblocks Camera, the packaged-app relaunch (D15), and D12/D13, and
   it is the only thing standing between the two artifacts and anyone else being able to run them.
   It needs an Apple account, which is yours to open.
3. **Not defect 30's no-thread half, not 17, not 38** — all deferred with fix directions, none
   blocking.

## 7 · Left changed on your devices

- **The phone: `Send to Mac` is switched ON** in *Manage apps*. The other ten rows untouched.
- **The phone: auto-rotate was toggled and restored.**
- **The Mac: one dev Electron run on `--remote-debugging-port=9222`.** Earlier in this sitting there
  were **two** instances and the older one held the port — the stale-window trap `CLAUDE.md` warns
  about. `pkill -f "ConnectSuite/desktop/node_modules/electron"` does **not** match a run launched
  as `./node_modules/.bin/electron .` from `desktop/`; `pkill -f "node_modules/.bin/electron"` does.
  Worth knowing before the next reading.
- The packaged app in `release/mac-arm64` is stopped and was not restarted — it cannot start
  unattended anyway (D15, the Keychain dialog).
- Clipboard history on both sides holds probe strings. Memory only; gone on restart.
