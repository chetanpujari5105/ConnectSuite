# The Sidekick motion system — inventory, rules and departures

> Written 2026-09-21 against `c0e48b4`. A state report, not a note to myself.
>
> **The headline is that this app's motion was already largely right, and the audit's first two
> findings were mine rather than the code's.** Both are recorded in §6 because they are the reason
> the numbers below can be trusted, and because the second one is a shape this repo has not written
> down before.

---

## 0 · What this document is

Every animated surface in the Mac app, what triggers it, why it exists, and what it does under
`prefers-reduced-motion: reduce`. It is the contract the guards check: `scripts/check-motion-tokens.mjs`
on every commit, `scripts/motion-sweep.mjs` against the running app.

The rule catalogue behind the judgements is Emil Kowalski's (`improve-animations` → `AUDIT.md`) and
Apple's *Designing Fluid Interfaces* (`apple-design`). Where the two disagree with the Figma handoff,
**the handoff wins and the disagreement is recorded as a departure**, because the handoff is the
contract and this is the argument for it.

**Nothing here is copied from Apple.** No Apple asset, no SF Symbol geometry, no proprietary curve.
The curves are the ones already in `tokens.css`; the principles are public design talks.

---

## 1 · The tokens, and the one rule about them

Every duration and every curve in the app comes from `tokens.css`. A pane may not invent one.

| Token | Value | What it is for |
|---|---|---|
| `--ease` | `cubic-bezier(.22,1,.36,1)` | the default. A strong ease-out: right for anything **arriving** |
| `--ease-in-out` | `cubic-bezier(.77,0,.175,1)` | a thing moving **between two resting places** on screen |
| `--ease-float` | `cubic-bezier(.16,1,.3,1)` | the float window's own curve |
| `--dur-press` | `100ms` | the press going **down**. Feedback lands on pointer-down |
| `--dur-release` | `160ms` | the press coming **back up**. Slower: nobody is waiting on it |
| `--dur-state` | `180ms` | a colour or label changing because a state changed |
| `--dur-toggle` | `160ms` | a switch knob, a segment |
| `--dur-hover` | `200ms` | hover, gated behind `@media (hover: hover)` |
| `--dur-pill` | `200ms` | the nav pill's travel |
| `--dur-route-fade` | `140ms` | the route change. Opacity only |
| `--dur-float` | `220ms` | the toast |
| `--dur-arrive` | `220ms` | one new row entering a list |
| `--dur-ring` | `600ms` | a value arc travelling to a new reading |
| `--dur-spin` | `1.2s` | **new** — one turn of an indeterminate spinner |
| `--dur-spin-fast` | `900ms` | **new** — the smaller state-block spinner |
| `--dur-flash` | `1.4s` | **new** — the deep-link reveal, once |
| `--press-scale` | `0.97` | the press |
| `--press-scale-icon` | `0.94` | a round icon button: less area, so more travel to read |

**Why press and release differ, and why that is not a preference.** `AUDIT.md` §4: *symmetric timing
on press-and-release is a finding*. Apple §1: *respond on pointer-down*. The press is the system
answering the user and must be immediate; the release is the system tidying up after itself and
nobody is watching it. 100 down, 160 up.

### The one rule

> **A `transition` shorthand on a `<button>` must include `scale`.**

The press rides the independent `scale` property, not `transform`. That is not tidiness — it is
forced by two elements whose `transform` channel is already spoken for:

| `.photos-tile` | `transform` is a 2px hover lift at `--dur-hover` | the press was releasing at **200ms** |
| `.recent-row` | `transform` is the FLIP that stops rows teleporting, at `--dur-arrive` | the press was releasing at **220ms** |

One property, two purposes, and only one of them can have the right duration. `scale` and
`transform` compose, so each purpose now has its own channel and its own timing — and the press's
timing is no longer something a pane can change by accident while styling something else.

It is still a rule rather than a guarantee: a pane's `transition` shorthand replaces the whole list,
so it can drop `scale` exactly as it used to drop `transform`. **CSS cannot tell you which selectors
land on a `<button>`**, which is why this is checked by a runtime sweep against the resolved cascade
rather than by the commit hook.

---

## 2 · The inventory

63 animated surfaces. **`state` = a real state or progress change; `decor` = presentation only.**
Every row is reduced under `prefers-reduced-motion: reduce` by the global block in `tokens.css`
unless the Reduced column says otherwise.

### 2.1 · Shell — the frame

| Surface | Trigger | Purpose | Dur | Ease | Properties | Reduced | Kind | Ref |
|---|---|---|---|---|---|---|---|---|
| `.status-island` | link state change | state indication | `--dur-state` | `--ease` | background-color, border-color, color | cross-fade kept via `.motion-fade` | state | FIGMA |
| `.island-text` | island text swap | prevents a one-frame word swap | `--dur-state` | `--ease` | opacity | kept (`.motion-fade`) | state | FIGMA |
| `.island-dot`, `.state-dot` | link state change | state indication | `--dur-state` | `--ease` | background-color | colour kept, instant | state | FIGMA |
| `…[data-state='live']::after` | **transition into** `live` | marks the moment the link returns, **once** | `--dur-ring` | `--ease` | transform, opacity | **halo suppressed**; the dot's colour carries it | state | departure N-M4 |
| `.nav-pill` | route change | spatial continuity — the pill *is* the route story | `--dur-pill` | `--ease-in-out` | transform (JS), background | instant | state | FIGMA |
| `.nav-row`, `.nav-row svg` | selection / hover | state indication | `--dur-state` | `--ease` | color, background-color | colour kept, instant | state | FIGMA |
| `.page.route-in` | route change | prevents a jarring content swap | `--dur-route-fade` | `--ease` | opacity | instant | state | departure N-M2 |
| `.toast` | a toast is shown | a surface arriving | `--dur-float` | `--ease` | opacity, transform | instant | state | FIGMA |
| `.toolbar-button` | hover / press | feedback | `--dur-state` / `--dur-press` down / `--dur-release` up | `--ease` | background, border, color, transform | instant | decor | FIGMA |
| `.recent-row` | a new activity event | prevents rows teleporting (FLIP) | `--dur-arrive` | `--ease` | transform, opacity, background | instant | state | departure N-M6 |
| `.hero-phone-screen` | hero state change | state indication | `--dur-state` | `--ease` | opacity, filter | kept | state | FIGMA |
| `.hero-phone-spinner svg` | hero is `working` | **indeterminate progress** | `--dur-spin` | `linear` | transform | **static ring + the state's own words** (§3, MA-4) | state | FIGMA |
| `.settings-tab`, `.setting-row` | selection / hover | state indication | `--dur-state` | `--ease` | background, color, border | instant | decor | FIGMA |
| `.switch`, `.switch-knob` | toggle | direct-manipulation confirm | `--dur-toggle` | `--ease` | background, transform | instant | state | FIGMA |
| `.segment` | selection | state indication | `--dur-toggle` | `--ease` | background, color | instant | state | FIGMA |

### 2.2 · Controls — the press

| Surface | Trigger | Purpose | Dur | Ease | Properties | Reduced | Kind | Ref |
|---|---|---|---|---|---|---|---|---|
| `button`, `.button` | press | feedback. **The base rule every button inherits** | `--dur-press` down, `--dur-release` up | `--ease` | `scale: .97`, background, border | instant | decor | FIGMA |
| `.remote-button` | press | feedback, round icon button | `--dur-press` / `--dur-release` | `--ease` | `scale: .94` | instant | decor | FIGMA |
| `.tool`, `.global`, `.quality-row`, `.pill-tab`, `.chip`, `.action`, `.send`, `.start-button`, `.stop-button` | press | feedback | `--dur-press` / `--dur-release` | `--ease` | **scale**, background/border | instant | decor | FIGMA |
| `.sms-tab`, `.sms-thread`, `.calls-tab`, `.call-row`, `.dialkey`, `.clip-tab`, `.clip-row`, `.nav-row` | press | feedback — **repaired, see §3 MA-1** | `--dur-press` / `--dur-release` | `--ease` | **scale**, background/border | instant | decor | FIGMA |
| `.photos-album`, `.activity-chip`, `.settings-tab` | press | feedback — **repaired, see §3 MA-7** | `--dur-press` / `--dur-release` | `--ease` | **scale**, background/colour | instant | decor | FIGMA |

### 2.3 · Panes — state and progress

| Surface | Trigger | Purpose | Dur | Ease | Properties | Reduced | Kind | Ref |
|---|---|---|---|---|---|---|---|---|
| `.vital-fill` | a vitals reading changes | **real progress** — a bar travelling to a new value | `--dur-ring` | `--ease-in-out` | transform `scaleX` (JS) | **jumps to value** | state | FIGMA |
| `.state-block[data-kind=loading] .state-badge svg` | a pane is loading | **indeterminate progress** | `--dur-spin-fast` | `linear` | transform | `animation: none` + the block's own words | state | FIGMA (D67) |
| `.security-card[data-state=connecting] svg` | pairing is connecting | **indeterminate progress** | `--dur-spin` | `linear` | transform | static (§3, MA-4) | state | FIGMA |
| `.deep-reveal` | a palette deep link lands | explains *where the thing you asked for is* | `--dur-flash` | `--ease` | border-color, box-shadow | `animation: none`, static border | state | departure |
| `.notif-row`, `.clip-row`, `.activity-chip`, `.sms-composer-row` | hover / selection | state indication | `--dur-state` | `--ease` | background, border, color | instant | decor | FIGMA |
| `.row-actions` | row hover | reveals actions without a layout jump | `--dur-hover` | `--ease` | opacity, transform | instant | decor | FIGMA |
| `.photos-tile` | hover | feedback | `--dur-hover` (lift) / `--dur-release` (press) | `--ease` | transform lift, **scale** press, border, shadow | instant | decor | FIGMA |
| `.photos-album`, `.quality-dot`, `.remote-open`, `.remote-seek` thumb | hover | state indication | `--dur-hover` | `--ease` | background / opacity | instant | decor | FIGMA |
| `.remote-now::before` | track change | prevents an artwork jump-cut | `--dur-route` | `--ease` | opacity | instant | decor | FIGMA |

### 2.4 · Float window (`float.css`)

`.float-frame`, `.light`, `.pin`, `.float-overlay`, `.bar-button`, `.float-resize` — all hover
feedback at `--dur-hover`/`--ease`, all `decor`, all instant under reduced motion via float.css's own
block. `.float-toast` enters at `--dur-pill`/`--ease-float` (opacity + transform), `state`.
`.float-frame.dragging { transition: none }` — **direct manipulation is 1:1 with the pointer and is
never tweened** (Apple §2).

### 2.5 · The brand lockup

| Surface | Trigger | Purpose | Dur | Ease | Properties | Reduced | Kind | Ref |
|---|---|---|---|---|---|---|---|---|
| `.brand-halo` | none — ambient | brand presence behind the mask only | `--dur-brand-breath` `6s` | `ease-in-out` | opacity `.55 → .75` | **no animation at all** | decor | departure (§5) |

---

## 3 · Findings, and what was done about each

Each was confirmed at its `file:line` and re-measured in the running app before it was believed.

| # | Sev | Category | Finding | Fix |
|---|---|---|---|---|
| **MA-1** | **HIGH** | feedback | **134 of 265 buttons snap their press.** A pane's own `transition` shorthand on a `<button>` replaces the base rule's whole list, silently dropping the `transform` it supplies — while `button:active` still applies `scale(.97)`. The press happens; the easing does not. 8 rules: `.sms-thread` (50 nodes), `.call-row` (50), `.dialkey` (13), `.nav-row` (12), `.calls-tab` (3), `.clip-tab` (3), `.sms-tab` (2), `.clip-row` (1) | `transform var(--dur-release) var(--ease)` added to all 8; `motion-sweep.mjs` refuses a button without it |
| **MA-2** | MED | interruptibility | **Symmetric press timing on 10 selectors** — `transform var(--dur-press)` means down *and* up take 100ms, against the base rule's 100/160. `AUDIT.md` §4 | all 10 moved to `--dur-release`, with `:active { transition-duration: var(--dur-press) }` |
| **MA-3** | MED | accessibility | **`hero-spin` has no reduced-motion handling** while its sibling `state-spin` does. The global kill sets `animation-duration: .01ms`, which **freezes the ring mid-turn**: it still reads as a spinner and conveys nothing. Two sites | explicit `animation: none` + a static ring; the surrounding copy carries the state |
| **MA-4** | LOW | tokens | Raw literals in motion declarations: `.clip-tab` `180ms` ×2 (**exactly `--dur-state`**), `hero-spin 1.2s` ×2, `state-spin 900ms`, `deep-reveal-flash 1.4s` + a raw `ease-out` | tokenised; `check-motion-tokens.mjs` refuses new ones |
| **MA-5** | LOW | tokens | `--dur-bar` defined and **used 0 times** | deleted. An unused token is one autocomplete from a second opinion about a duration |
| **MA-6** | LOW | interruptibility | `.toast` enters via `@keyframes`, which restarts from zero rather than retargeting when a toast is replaced while visible | **not changed** — see §4 |

### MA-7, found by the sweep after the static pass called itself done

The static fix list came from a DOM read taken on one route. Sweeping **all twelve** found three
more buttons snapping — `.photos-album` (1824 nodes), `.activity-chip` (84), `.settings-tab` (84) —
and two releasing at the wrong duration, `.photos-tile` at 200ms and `.recent-row` at 220ms.

That is the difference between reading a stylesheet and reading a running app, and it is the reason
the sweep exists. It also **retires the tension this document recorded as unfixable a few hours
earlier**: `.recent-row`'s press and its FLIP were said to be inseparable because they shared one
property. They did, and they no longer do. The accepted-tension entry was wrong, and the sweep is
what said so.

### Still open, and honestly so

- **`prefers-contrast: more` is not handled anywhere in the app.** Apple §14 names three independent
  signals and this app answers two. Out of scope here — it is a colour and border question, not a
  motion one — but it is a real gap and belongs in the next colour pass.

---

## 4 · What must not animate

This list is as load-bearing as the inventory. Each entry names the gate that killed it.

| Surface | Why not |
|---|---|
| **The ⌘K command palette** | `AUDIT.md` §1: 100+ times/day → **no animation, ever**. Raycast has none. Already none in this build, deliberately (departure N-M8). **Do not add one.** |
| **The toast's replacement** (MA-6) | Left as `@keyframes`. A toast here is *replaced* at most once every few seconds by a user action, not stacked — so the keyframe restart is not reachable at a rate anyone can see, and converting it to a transition costs an `is-arriving` class and a second writer on a surface that has one. Recorded rather than fixed; if toasts ever stack, this becomes a real finding. |
| **Latency, rtt, fps, bitrate, byte counts** | Functional data the user *reads*. Moving it hinders. |
| **The nav badge count** | Changes on every notification — animating it is constant motion. |
| **Disconnected / error states** | No pulse, no blink, no shake. An error that moves is an error that nags. |
| **Sidebar group labels, static cards** | Non-interactive. Motion on them is decoration with no referent. |
| **Disabled controls** | `button:active:not(:disabled)`. A disabled control that responds is lying. |
| **The Sidekick wordmark** | Static, always. Only the halo behind the mask moves, and only under `no-preference`. |
| **Anything, under `prefers-reduced-motion: reduce`, that moves position** | Opacity and colour survive; transforms do not. |

---

## 5 · The brand lockup — a visibility defect, measured

**The mask was at 1.08:1 against its own sidebar.**

`assets/brand/mark@2x.png` is 114×60, 56% opaque, and its dominant opaque colour is `rgb(22,23,24)`
— median luminance **31 of 255**. The sidebar is `--elev-1` = `rgba(15,15,15,.82)` composited over
`--canvas` `#0a0a0a`, which resolves to `rgb(14,14,14)`. Contrast: **1.08:1**. Only the lime/blue
eyes read; the mask silhouette that carries the brand is invisible.

The treatment, and every constraint on it is the brief's:

- a **compact charcoal stage** behind the lockup — not a lit sidebar — so the black mask has
  something to be black *against*;
- a **subtle neutral edge** on the stage, one hairline, no glow;
- a **clipped halo** behind the mask only: blue left, lime right, low opacity, `overflow: hidden` on
  the stage so nothing bleeds into the nav;
- the **wordmark stays static** and keeps its `--text-primary`;
- the halo **breathes at 6s, opacity only**, `.55 → .75`, and **only** under
  `prefers-reduced-motion: no-preference`. No scale, no rotation, no hue change, no eye-colour
  switching. Under `reduce` there is no animation at all — the halo simply sits at its mid value.

**This is a departure.** The handoff (`61:24256`) draws the lockup on the bare sidebar with no stage
and no halo, and specifies no motion for it. It is recorded in `docs/design-departures.md`.

---

## 6 · Two instrument faults, and the second is a new shape

Both were mine, both produced a confident wrong answer, and both were caught before anything was
written down. They are here because the audit's credibility rests on them.

### 6.1 · A line-based CSS parser cannot see a single-line rule

The first sweep walked the stylesheets line by line, pushing a selector when a line ended in `{`.
**454 rules in this repo are written entirely on one line**, and every one of them was invisible.
`.switch.is-on .switch-knob { transform: translateX(18px); }` is one, so `.switch-knob` was reported
as declaring a transform transition and never setting a transform — a dead transition that is not
dead. Replaced with a brace-matching parser, whose control is that single rule.

This is the instrument's own bound going unreported, which `CLAUDE.md` already has a table about.
The new part is only where it hid: a parser's **grammar**, not its timeout or its page cap.

### 6.2 · The finding that was two halves of one working mechanism

The corrected parser then reported **nine controls declaring a `transform` transition that never
receive a transform** — `.chip`, `.action`, `.tool`, `.global`, `.pill-tab`, `.start-button` and
three more. Every one is a real, frequently-pressed control. It read exactly like the brief's
premise: *press feedback was specified and never implemented*.

It is wrong. All nine are `<button>` elements, and `styles.css:80` carries
`button:active:not(:disabled) { transform: scale(var(--press-scale)) }` — a **bare element
selector**. The transform arrives from there; the per-class `transition` is what animates it. The
two halves live 2,000 lines apart in one file, and a scan keyed on the selector cannot join them.

**What makes this its own shape:** every instrument fault in `CLAUDE.md` so far is a reading that is
*too narrow*, *too generous*, *stale*, or *measuring the wrong end*. This one had the right target,
the right query, and a correct answer to the question it asked — *does any rule with this selector
set a transform?* The answer was genuinely no. The question was wrong, because the mechanism is not
addressed by that selector at all.

The tell is greppable and worth stealing: **a finding of the form "X declares half a mechanism"
is only a finding once you have asked what else could supply the other half.** For CSS the answer is
always *a less specific selector you did not enumerate* — a bare element, an inherited property, a
`*` rule. The fix was to stop reading CSS and ask the running page for `getComputedStyle`, which
resolves the cascade rather than re-implementing it. That reading is what found MA-1, which is a
**different and real** defect the CSS scan had been sitting on top of the whole time.

The general form, and it is the no-second-expression rule pointed at an instrument: *the audit had
written its own copy of the cascade.* The browser has one. Use it.

---

### 6.3 · The third fault, and it is in the product's own toolkit rather than mine

The sweep, once it worked, reported `snapping: recent-row (48)` — reproducibly, three runs running.
It is not snapping. `overview.ts` writes an inline `transition: none` on each row to do the FLIP and
clears it inside `afterNextPaint`, which is **two nested `requestAnimationFrame`s**. rAF does not run
in an occluded window, and this sweep is driven from a terminal.

Measured: `rafFired: 0` after 1.88s, `document.visibilityState === "hidden"`, four `.recent-row`
nodes carrying `style.transition === "none"`.

**The product is fine, and saying why matters more than the finding.** rAF runs *before* the first
paint anybody sees, so the cleanup lands before the state can be observed — the rows are never drawn
stuck. What was broken is the reading.

Two things follow:

- **`docs/RESUME.md` already records rAF stalling in an occluded window — as an instrument hazard,
  for a sweep that hung.** It is the same mechanism in the same app, met from the other side, and it
  was not recognised on sight. A hazard written down against one tool does not announce itself when
  it appears in another.
- **Refusing to run was the first fix and it was wrong.** `Page.bringToFront` does not raise an
  Electron window another application is covering, and on this machine System Events reports
  `windows=0` for the process while CDP screenshots it happily. An instrument that only runs while
  somebody is looking at the app is the rAF mistake wearing a different hat. So the sweep reads in
  both conditions, **excludes elements carrying an inline `transition`** — the signature of pending
  rAF cleanup — and names them and the reason on the line.

The general form: **a value settled in a frame callback is not readable in a window that is not
painting**, and the instrument must state which of those two worlds it is in. It prints the window's
visibility on every run.

---

## 7 · Verification

| What | How | Where |
|---|---|---|
| tokens only, no raw literals | `scripts/check-motion-tokens.mjs` | commit hook, with fixtures |
| every button's press animates | `scripts/motion-sweep.mjs` | against the running app |
| reduced motion removes movement | `motion-sweep.mjs --reduced` | CDP `Emulation.setEmulatedMedia` |
| reduced transparency keeps surfaces opaque | `motion-sweep.mjs --reduced-transparency` | same |
| disabled controls do not animate | `motion-sweep.mjs` | same |
| nothing blocks a keypress | `motion-sweep.mjs` | Escape closes with motion in flight |

**Measured 2026-09-21, dark and light, 12 of 12 routes:** 9 pass, 0 fail, 0 NO READING, ten
consecutive runs. Press: **8316 of 8316** enabled buttons. Reduced motion: 163 transforms → 0,
3 animations → 0. Reduced transparency: 4 blurred surfaces → 0. Every one with its control.

Evidence, including what it does **not** cover: `docs/evidence/motion-2026-09-21/`.
