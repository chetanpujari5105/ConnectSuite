# The native-macOS pass — audit and plan, 2026-09-17

> **Status: implemented 2026-09-17.** Written before any code, as the brief asked. §0's question was
> answered *the brief wins, and every disagreement is a departure row* — those are N-P1–N-P3 and
> N-M2–N-M10 in `docs/design-departures.md`. Evidence: `docs/testing.md` → Phase 7 Slice 63.
> **One finding was withdrawn by measurement, B2** (below). **One plan item changed shape during
> the build, M5**: rings became bars (N-P2), for the reason recorded in that row.

**Instruments.** Every pane shot through `scripts/shot.mjs` at 1628×920 @2x, not zoomed, against an
Electron started 14:24:01, which is **after** the last `dist/` write (14:24:01) — so the shots are of
the current build rather than a stale renderer. Computed styles read live over CDP. Counts are
`grep -o | sort | uniq -c`, not `grep -c`. Skills used: `impeccable` (audit), `apple-design`,
`find-animation-opportunities`, `improve-animations`. **Two named skills are not installed** —
`redesign-existing-projects` and `high-end-visual-design` (taste-skill); `impeccable` and
`emil-design-eng` stand in, and that substitution is recorded here rather than implied.

---

## 0 · The authority question, which decides what "fix" means

`PRODUCT.md` and `docs/design-departures.md` name **one binding visual authority**:
`design_handoff_connectsuite/ConnectSuite.dc.html` + `README.md`. Its rule: *a difference not
recorded as a departure is a bug.* `docs/RESUME.md` §0 records what happened the last time a second
reference was used without saying which one won.

**This brief is a second reference.** Several of its asks are the handoff's own specification:

| Brief asks to remove / change | The handoff says |
|---|---|
| Activity rings on Battery and Storage | *"Device status (panel): three SVG progress rings"*, fills `900ms easeOut`, listed as **load-bearing** |
| Eight category hues (green/orange/pink/teal…) | Tinted dock tiles and activity tiles, specified per category |
| Dock magnification | Specified — but listed as **droppable** |
| Status-dot halo pulse | Not specified for the island; the build added it |

So each change below is labelled **conform** (brings the build back to the handoff), **departure**
(the brief overrides the handoff; needs a row in `design-departures.md` the day it ships) or
**new** (the handoff never drew it).

---

## 1 · The brief's red flags, measured

| # | Brief's claim | Measured in the running build | Verdict |
|---|---|---|---|
| R1 | Rings never animate | `.ring-arc` has `transition: stroke-dashoffset 240ms ease`, **but `overview.ts:133` calls `replaceChildren()` on every vitals update**, so each ring is a new SVG born at its final offset. The transition cannot fire, ever. | **True — and it's a bug, not a style choice** |
| R2 | Gradient/glow "Start mirroring" CTA | `.primary-action`: `background-image: none`, `rgb(139,107,255)`, `box-shadow: none`. The gradient CTA was in an old capture, and `tokens.css` already records the handoff forbidding it. | **Already fixed** |
| R3 | Flat, undifferentiated cards | Chrome has real material (`.sidebar`, `.status-island`: `blur(30px) saturate(1.4)`). Cards have **none** — `.card` is `rgba(22,24,34,.82)` with `backdrop-filter: none` over a `#07070a` ground, so the translucency has nothing to show. Hero is opaque `#1c1f2b`. Result: three greys that differ by ~3% lightness. | **True** |
| R4 | Ungoverned semantic colour | Four semantic tokens exist and are used correctly (`--live`, `--warning`, `--destructive`, `--accent`). **But** there are 9 category hues (`--tint-*-rgb`) plus `--secondary` cyan, and the Overview shows green (battery), amber (storage), pink (clipboard tile) and green (connect tile) in one viewport. The amber storage ring is *correct* (2% free), and reads as decoration because the tiles beside it use hue for category. | **Partly true** — the semantic set is sound; hue is doing two jobs |
| R5 | Chips have inconsistent active/inactive opacity | `.cap` (off) draws `--text-meta` at **12px** — 2.6:1, a token the handoff restricts to *"10–11px non-essential meta ONLY"*. `.cap.on` is green-tinted. `.activity-chip` is a **third** scheme (accent tint). Notification filter `.pill-tab` a fourth. | **True** — four selection vocabularies, one of them below its own contrast rule |
| R6 | Weak header type hierarchy | The page title is fine (31/600/-0.02em over 13.5 body). The weakness is everywhere else: **18 distinct literal `font-size`s in 175 declarations**, against 99 uses of the six type tokens. 10.5, 11, 11.5, 12, 12.5, 13, 13.5 all exist within 3px. | **True, but not where the brief looked** |
| R7 | Zero motion anywhere | False. Nav pill slides (200ms), routes animate (`page-in` 260ms), cards stagger (`float-in` + 50ms steps), toasts, palette, dock, toggles, 44 transitions. `prefers-reduced-motion` is **off** on this Mac, so none of it is suppressed. | **False** — the problem is the *wrong* motion, §3 |

Found while measuring, not in the brief:

- **B1 — Start and Stop mirroring are both enabled at once.** `renderer.ts:375-376` sets both from
  `canMirror`; neither reads whether a session is running. The Mirror inspector shows a full-weight
  red *Stop* above a full-weight violet *Start* while nothing is mirroring. An interaction defect.
- ~~**B2 — The `Rotation` tool draws a dash as its glyph**~~ — **withdrawn.** It is not a glyph; it
  is `#mirror-rotation-readout`, a value, reading `—` because nothing is being mirrored and so there is
  no rotation to report. It was read off a screenshot and not checked against the markup.
- **B3 — Device status is a 790px card holding two 72px rings** and ~500px of nothing.

---

## 2 · Audit by screen

Selectors are real; line numbers are from the tree at `f6384a3` + the uncommitted O19–O21 work.

### Frame (`shell.css`) — every screen
| Sev | Finding |
|---|---|
| P1 | **Route change settles in ~410ms.** `.page.route-in` translates the page 10px over 260ms, *and* `.stagger > *` translates each card 8px over 260ms with up to 150ms delay (`styles.css:1771-1775`). Two stacked movements on a tens-a-day action. |
| P1 | **`.island-dot[data-state=live]::after` pulses forever** (`halo`, 2.8s infinite, ~0.36Hz). The app's own principle 4 is *pair once, then be quiet*; a permanent oscillation in peripheral vision is the opposite, and Apple's guidance names slow loops near 0.2Hz specifically. |
| P2 | **The ⌘K palette animates in** (`cmdk-in`, 220ms scale .94). Keyboard-initiated, the most frequent action in the app. |
| P2 | **Dock overshoots** — `cubic-bezier(0.34,1.56,0.64,1)` at `scale(1.35)`: the one bouncy element in an otherwise critically-damped app, on hover. Handoff lists it droppable. |
| P2 | **Status island text and dot change instantly** when the link drops or returns. The one state change the user genuinely needs to notice has no bridge. |
| P3 | 23 transition durations are literals (`160ms`×7, `180ms`×14, `220`, `240`) beside `--dur-*` tokens that exist. |
| P3 | No `prefers-reduced-transparency` handling; the reduced-motion block is a global 0.01ms kill that also removes state feedback. |

### Overview (`styles.css`, `overview.ts`)
| Sev | Finding |
|---|---|
| P1 | R1 — rings rebuilt on every update; never animate. |
| P2 | R3 — `.card`, `.card.primary.hero`, `.device-status-card` are three flat greys. |
| P2 | R5 — `.cap` off-state at 12px `--text-meta`. |
| P2 | B3 — Device status composition. |
| P3 | `.recent` rows rebuilt with `replaceChildren()` (`overview.ts:216`): a naive entrance animation would re-animate **all five rows on every event**. Arrival motion needs keyed diffing first. |

### Mirror
| Sev | Finding |
|---|---|
| P0 | B1 — Start and Stop both live. |
| ~~P2~~ | ~~B2 — Rotation glyph~~ — withdrawn, see §1. |
| P3 | `.quality-row` selected state is a filled dot on the right with an accent-tinted row — a fifth selection vocabulary (see R5). |

### Notifications
| Sev | Finding |
|---|---|
| P2 | Filter `.pill-tab` counts use `--text-meta` mono at 10.5px inside a 13px label — the count reads as disabled. |
| P3 | The dev-build warning card is the loudest element on the pane (amber border, full width) for a state that only exists in development. Correct copy, over-weighted. |

### Settings, Calls, Clipboard, Files, Photos, Messages, Apps, Activity
No findings beyond the systemic ones (R4, R5, R6, literal durations). These panes were brought to
the handoff on 2026-09-04 and it shows; they inherit the frame fixes without pane-specific work.

---

## 3 · Palette and type scale — proposed additions to `tokens.css` only

### Colour: **no new hues. A rule, and two roles.**

The semantic four stay exactly as they are — they are right and they are the handoff's.
What changes is **what hue is allowed to mean**:

```
--accent        violet   selection, primary action, focus. Never state.
--live          green    the link is up / a thing succeeded. State only.
--warning       amber    degraded, low, paused. State only.
--destructive   red      failed / destructive. State only.
--tint-*        category identity on a TILE GLYPH ONLY (dock, activity tile) — never on a ring,
                a chip, a value, or text that could be mistaken for state.
```

The consequence on screen: the battery ring is **neutral** (`--text-primary` arc) until it is
genuinely low, and turns `--warning` then. A green ring at 80% says *success*, which a battery
level is not. `**departure**` (handoff draws it green).

Additions:

```css
--material-card: rgba(22, 24, 34, 0.62);   /* elev-2 made genuinely translucent, paired with blur */
--material-card-blur: blur(24px) saturate(1.3);
--selection-fill: var(--accent-tint-selected);   /* the ONE selected-chip fill */
--selection-border: var(--accent-border);        /* the ONE selected-chip border */
--unselected-text: var(--text-body);             /* 6.6:1 — replaces --text-meta on chips */
```

**The chip rule, exactly two states:** selected = `--selection-fill` + `--selection-border` +
`--text-primary`; unselected = transparent + `--hairline` + `--unselected-text`. Hover moves only the
border. A capability that is *on* is not "selected" — it gets the glyph (`check`), not a colour,
which is how it already carries state for colour-blind readers. `**departure**` for `.cap.on` green.

### Type: four roles, and the 18 literals collapse into them

| Token | Value | Replaces |
|---|---|---|
| `--text-display` *(exists as `--text-page-title`)* | 600 31px/35.65px, -0.02em | 30, 31 |
| `--text-title` *(exists as `--text-card-title` / `--text-section`)* | 600 21px / 600 15px | 14.5, 15, 16, 17, 22 |
| `--text-body` *(exists)* | 500 13.5px/1.5 and 500 13px (control) | 12.5, 13, 13.5, 14 |
| `--text-caption` **new** | 500 11.5px/14px, +0.01em | 10.5, 11, 11.5, 12 |
| `--text-micro` *(exists as `--text-meta-size`)* | 500 10px, +0.02em, uppercase groups only | 8.5, 9.5, 10 |

The handoff's own table *is* this four-step scale; the literals are drift from it, so this is
**conform**, not departure. 8.5px (two uses) is below any legible size on a Retina Mac and goes.

---

## 4 · Motion plan

Existing tokens are kept and extended — `--ease: cubic-bezier(.22,1,.36,1)` is already a strong
ease-out and is the handoff's; no parallel curve is introduced.

New tokens:

```css
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* on-screen movement between two resting places */
--dur-state: 180ms;                              /* colour/label cross-fades on a state change */
--dur-ring: 600ms;                               /* a value arc travelling to a new reading */
```

| # | Where | Property | Duration | Curve | Why |
|---|---|---|---|---|---|
| M1 | **Sidebar selection** `.nav-pill` | `transform` | 200ms (keep) | `--ease` (keep) | Already right: spatial continuity, interruptible CSS transition. **Add** a colour cross-fade on the row label (`color`, `--dur-state`) so the text doesn't snap while the pill glides. |
| M2 | **Route change** `.page.route-in` | `opacity` only; **delete** the 10px translate and the card stagger | 140ms | `--ease` | Tens/day. Motion here must be near-imperceptible; the pill already tells the spatial story. Settles in 140ms, down from ~410. `**departure**` (handoff: 260ms + stagger). |
| M3 | **Connection status** `.island-dot`, `.state-dot`, island text | `background-color` on the dot; island text cross-fades (`opacity` out 90ms → swap → in 90ms) | `--dur-state` | `--ease` | State indication. Occasional (link drops a few times a day). |
| M4 | **Connection returns** | one-shot halo: `::after` `scale(1→2.2)` + `opacity(.6→0)`, **once**, on the transition into `live` only | 600ms | `--ease` | Replaces the infinite loop. Marks the moment, then is quiet. |
| M5 | **Rings, live updates** | `stroke-dashoffset` on a **persistent** arc (update attributes in place; build the SVG once) | `--dur-ring` | `--ease-in-out` | State indication. A value moving between two readings is on-screen movement → ease-in-out. Battery changes ~1%/few min, so this is rare and earns 600ms. First paint animates from 0 once per session, not per route. |
| M6 | **Recent activity arrival** | new rows only (keyed on event id): `opacity 0→1`, `translateY(-4px→0)`; existing rows shift via FLIP `transform` | 220ms | `--ease` | Prevents a jarring change — today a new event teleports in and pushes four rows down. **Requires keyed diffing first** or every row re-animates on every event. |
| M7 | **Button press** `button:active`, `.button:active` | `transform: scale(.97)` | 100ms press / 160ms release | `--ease` | Feedback. Exists at `.98`; unify the eleven variants (`.94`, `.96`, `.985`, `.98`) to one value, keep `.remote-button` at `.94` (a round icon button needs more travel to read). Release slower than press, per Apple. |
| M8 | **⌘K palette** | **delete** `cmdk-in` | — | — | Keyboard, 100+/day. Raycast has none. |
| M9 | **Dock hover** | replace overshoot with `--ease`, `scale(1.35)` → `scale(1.18)`, neighbours `1.06` | 180ms | `--ease` | Hover, tens/day, no momentum preceded it → no bounce. |
| M10 | **Card material on hover** | keep handoff's `translateY(-2px)` + border shift | `--dur-hover` | `--ease` | Already specified; gate behind `@media (hover: hover)`. |

**Rejected** (the gate that killed each):

- Animating the latency number or byte counts — *functional data the user reads; moving it hinders.*
- A stagger on the notification / clipboard lists — *redrawn continuously; tens/day.*
- Animating the nav badge count (`70`) — *changes on every notification; would be constant motion.*
- Ambient blob drift — kept, but **paused under reduced-motion and reduced-transparency** rather than
  killed by the global 0.01ms rule, which currently freezes them mid-frame.

**Reduced motion (replacing the global kill):** transforms removed, opacity cross-fades kept at
`--dur-state`, ring arcs jump to value, M4 halo becomes a single 180ms opacity blink.
**Reduced transparency (new):** `--material-card` goes opaque (`--elev-3`), all `backdrop-filter: none`.

---

## 5 · Materials — the elevation stack

```
canvas     #07070a + drifting blobs             (the only field of colour — handoff)
chrome     elev-1  .72 + blur(30) saturate(1.4)  sidebar, island, palette  (exists)
panel      material-card .62 + blur(24) sat(1.3) + hairline + inner highlight   ← NEW
primary    elev-3  opaque #1c1f2b + deeper shadow                                (exists)
control    #161822 opaque                                                        (exists)
```

A panel over the blobs now *shows* the ground softly through it — the NSVisualEffectView behaviour
the brief asks for — while the one primary card stays opaque so it reads as nearer. Never a
translucent surface on a translucent surface (Apple §12): controls inside a panel stay opaque.
Cost: `backdrop-filter` on ~4 cards per pane over an animated background; measured before and after
with the scroll-rate probe, and dropped to opaque if frame time regresses.

---

## 6 · Order of work

| Step | Stylesheet / file | Items |
|---|---|---|
| 1 | `renderer.ts` | **B1** Start/Stop gated on session state (a bug; lands first, alone) |
| 2 | `tokens.css` | §3 colour roles, type roles, §4 motion tokens, §5 material, reduced-motion + reduced-transparency blocks |
| 3 | `shell.css` | M1, M2, M3, M4, M8, M9 |
| 4 | `overview.ts` + `styles.css` | M5 (persistent rings), M6 (keyed recent rows), R5 chip rule, B3 |
| 5 | `styles.css` | M7 press unification; type literals → roles, pane by pane; R3 material on `.card` |
| 7 | `docs/design-departures.md` | a row for every **departure** above, same commit |
| 8 | — | `review-animations` pass, pass/fail per M-row; `npm test`; the commit guards; shots after |
