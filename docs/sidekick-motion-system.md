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
| `.photos-tile` | hover | feedback | `--dur-hover` (lift) / `--dur-release` (press) | `--ease` | transform lift **behind `@media (hover: hover)`**, `scale` press, border, shadow | instant | decor | FIGMA |
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
| `.brand-halo` | none — ambient | silhouettes the mask against its own sidebar | `--dur-brand-breath` `6s` | `--ease-in-out` | opacity `.5 → .72` | **not declared at all** — gated on `no-preference`, so nothing can freeze | decor | departure (§5) |

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

**The mask sits at 1.09:1 against its own sidebar.**

`assets/brand/mark@2x.png` is 114×60 and 56% opaque; its dominant opaque colour is `rgb(22,23,24)`.
The sidebar is `--elev-1` = `rgba(15,15,15,.82)` composited over `--canvas` `#0a0a0a`, which
resolves to `rgb(14,14,14)` — confirmed by sampling the running app, not computed from the tokens.
Taken over **every** opaque near-black pixel of the mark rather than its single dominant colour,
that is **1.09:1**, and one definition is used everywhere below so there is never a second number
for the same fact. Only the lime/blue eyes read; the winged silhouette that carries the brand is
invisible.

### Why a charcoal stage alone cannot fix it

This is the part worth keeping, because the obvious move is wrong and the arithmetic says so.
Lifting the ground *towards* a near-black mask makes the two closer, not further apart: a stage at
`#1a1a1c` scores **1.03:1**, worse than the bare sidebar. To reach even 3:1 the ground would have
to be `rgb(99,99,99)` — a mid-grey slab in the sidebar, which is not this design.

**A logo is not text and does not owe a text contrast ratio.** What it owes is an *edge*. So the
treatment is three things, and only the third is about contrast at all:

- a **compact charcoal stage**, `--brand-stage` `#17171a`, one step above `--chrome` — a block, not
  a lit panel;
- a **subtle neutral edge**, one inset hairline, which is what actually makes the lockup read as a
  deliberate object rather than a smudge;
- a **clipped halo behind the mask only** — blue left, lime right, `overflow: hidden` on the stage
  so nothing reaches the nav — which silhouettes the wings against varying light instead of against
  an identical flat ground.

The two hues are **sampled from the artwork**, not invented: `rgb(0,196,255)` is the bluest pixel in
the mark and `rgb(233,255,19)` its limest, which is `--accent`'s hue.

### The rule shipped twice and the browser kept the wrong copy

Before any number below is read, the correction that makes them worth reading. `shell.css` declared
`.brand-mark` **twice**, six lines apart: a `57px` / `object-position: center` block carrying the
comment that explains the stage, and the pre-existing `65px` / `left center` block immediately
below it. Equal specificity, later rule wins, and nothing errors. So for a day the stylesheet
described one lockup and the browser drew another — `getComputedStyle` returned `width: 65px`.

The artwork is 57px wide inside a 65px slot at `object-fit: contain`, so `left center` pinned it to
the left and left **eight empty pixels on the right**, showing the lime half of the halo through.
Located in the pixels rather than derived from the CSS, by matching the artwork's own eye pixels
against each capture (control: 453 of 598 matched at the best offset, both times):

| | artwork inside the 69px stage | bare stage left | bare stage right |
|---|---|---|---|
| as drawn | x 2 → 59 | **2px** | **10px** |
| as specified, and now as drawn | x 6 → 63 | **6px** | **6px** |

`stylesheets.test.ts` had a guard for one selector declared twice in a sheet and it passed, because
its discriminator is **distance** and this pair was adjacent. A distance is a proxy for *could the
author see both* — and when the new rule is inserted **above** the old one, proximity is exactly
what hides it: the pair reads as a single commented block. It now also refuses a same-property
contradiction at any distance, with the shipped shape as its fixture.

### What it actually moved, stated as the number rather than the impression

Measured against the tree being committed, with the artwork's **alpha channel** as the classifier
rather than a brightness threshold — a threshold cannot separate a dark wing from the dark ground
behind it, which is the whole problem. The halo breathes, so the ground moves and the reading is a
band between the two keyframes:

| dark | wings | their ground | ratio |
|---|---|---|---|
| on the bare sidebar, no stage | `L=0.0093` | `rgb(14,14,14)` | **1.09:1** |
| on the stage, breath at rest | `L=0.0093` | `L=0.0195` | **1.17:1** |
| on the stage, breath at peak | `L=0.0093` | `L=0.0253` | **1.27:1** |

**Read that as a very small ratio change and as nothing more.** It is not a contrast win and this
treatment must never be described as one. A crop of the rendered lockup reports `13.66:1` between
its 5th and 95th percentiles, and quoting that would be the denominator mistake in a different unit
— the 95th percentile is the *eyes*. Measured in the same frame the eyes are **10.24:1** at rest
and **9.48:1** at peak; they were bright before any of this work and are not what changed. They
flatter every measurement of this mark and are excluded from every claim about the wings.

**The defensible statement is the one with no ratio in it: the lockup is readable because it has an
edge and sits on a gradient — a dark shape against varying light, which is how a black mark is
meant to work.** The stage's inset hairline and the clipped halo are the mechanism. The numbers are
published so nobody later reads `docs/evidence/motion-2026-09-21/brand-after.png` as a contrast
improvement it did not earn.

In **light** the mask is near-black on a near-white sidebar and needs none of this — **16.55:1** on
the bare sidebar, **14.22:1** and **14.01:1** on the stage across the breath. The stage *lowers* it
slightly, which is the expected direction and is the evidence that light is not over-glowed: the
halo's whole contribution there is a channel spread of 5–6 over the sidebar's own 3. The stage
stays so the lockup is one object in both themes.

**And the sidebar itself takes no tint from any of it.** Sampled in the left gutter — 14px of
padding every row shares, which no text enters — beside the lockup and again far below it, the two
are identical to the byte in both themes (`rgb(14,14,14)` dark, `rgb(249,249,252)` light,
per-channel difference **0**), against the stage's own spread of 9–13 and 5–6 as the control that
something *is* tinted eight pixels away.

### The breath

`--dur-brand-breath` `6s`, opacity `0.5 → 0.72`, `--ease-in-out`, infinite. Nothing moves: no scale,
no rotation, no hue change, no eye-colour switching. 6s is 0.17 Hz, deliberately at the slow end of
the 5.5–6.5s band, because Apple §14 warns off slow looping oscillation near 0.2 Hz.

It is declared **inside `@media (prefers-reduced-motion: no-preference)`** rather than overridden
under `reduce`, and that is not a style choice. An override animates and then undoes it, and the
global kill in `tokens.css` would leave this one **frozen mid-cycle** at whatever opacity the clock
stopped on — which is exactly the `hero-spin` fault this same pass found and fixed (§3, MA-3).
Gating the declaration means there is no animation to freeze: the halo sits at its rest value, which
is a designed state rather than an accident.

**This is a departure.** The handoff (`61:24256`) draws the lockup on the bare sidebar with no stage
and no halo, and specifies no motion for it. Recorded in `docs/design-departures.md`.

## 6 · Instrument faults, and 6.2 is a new shape

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

### 6.3 · A fault in the product's own toolkit rather than mine

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

### 6.4 · That exclusion covered one of the mechanism's two marks

6.3's fix excluded elements carrying an **inline** `transition`. `overview.ts` marks a row two ways
and clears both in the same `afterNextPaint`:

```ts
if (previous && !previous.has(event.seq)) row.classList.add('is-arriving');   // always
…
if (dy !== 0) { row.style.transition = 'none'; … }                            // only if it MOVED
```

and `.recent-row.is-arriving` carries `transition: none` in `shell.css`. So a row that arrived
**without moving** gets the class alone, computes `transition-property: none`, and is reported as
`snapping: recent-row (12)` — the exact sentence 6.3 exists to prevent, on the other half of the
same mechanism.

**This is the sitting's own opening defect in a second place.** `.brand-mark` was one rule expressed
in two blocks where only the second was read; this is one *state* expressed in two marks where only
one was read. The question both need is the same: **what else expresses this, and am I reading all
of it?**

The exclusion now tests both and names which mark it found — `recent-row/inline (36),
recent-row/is-arriving (12)`. The predicate is proven at its own layer rather than by waiting for
the state to recur, since a row arriving with `dy === 0` cannot be demanded: three real
`.recent-row` buttons were given the class with no inline style, and the exclusion read **3 snapped
/ 0 excluded** without the branch and **0 snapped / 3 excluded** with it.

---

### 6.5 · A settle predicate over three clocks that named two

The sharpest of the set, because the run printed the disproof beside the verdict.

`press-down` forces `:active` over `button:not([disabled])` and settles when `scaled` and `visible`
agree across two consecutive force-and-read pairs. It never compared **how many nodes the force
reached** against **how many the reader scored**. `CSS.forcePseudoState` applies to node ids on the
renderer's own schedule, so a sample can be internally stable while the force has landed on a subset
— and every node it did not reach reports its **at-rest** duration, `--dur-release` 0.16s, which is
indistinguishable from a button that does not shorten its press.

It produced this line, and the finding written from it was *"128 apps tiles snap their press"*:

```
569 of 697 at 0.1s; others: apps-tile=0.16s …  [forced=573]
```

**569 + 128 = 697, and 697 − 573 = 124.** Two numbers that must be equal for the reading to exist
sat side by side in the output, differing, with the verdict computed from the other one.

`CLAUDE.md` already says a predicate over independent clocks must settle on every clock. The clock
here is not a channel or a device — it is *the instrument's own reach*, which is why nobody wrote it
down: it does not look like state. `forced === matched` is in the predicate now, the line reads
`[forced=721 of 721 matched; 4 mid-FLIP skipped]`, and a mismatch is a **NO READING** naming the
shortfall rather than a FAIL. Shown red against the verbatim case by narrowing the force selector by
`.apps-tile`: *"the force reached 593 nodes and the reader matched 721 — the 128 it did not reach
report their AT-REST duration"*.

---

### 6.6 · Three smaller ones from the brand readings, each caught by its own control

None cost a written-down number, and all three are the same question — *what is this reading
actually of?*

- **A `clip` on `Page.captureScreenshot` returns a 4x image on a dpr-2 display.** `clip.scale`
  multiplies on top of the device pixel ratio rather than replacing it, and `clip` also sets
  `captureBeyondViewport`, which re-lays-out the page under any rect read beforehand. A 2x asset
  indexed into a 4x capture sampled the wrong pixels for every class. **The eyes control caught it**:
  they came back at **1.28:1** against wings at 1.25:1, and two classes agreeing to two decimal
  places is an alignment wrong for both, not a finding. Plain viewport capture, cropped afterwards.
- **A "sidebar" band that contained the wordmark.** Sampled to the right of the stage, it read
  `rgb(33,33,34)` against `rgb(14,14,14)` far below — a 20-point difference, **all three channels
  moving together**, i.e. light text rather than a tint. Both bands moved into the 14px left gutter
  that no text enters.
- **A tint assertion that was theme-dependent.** The wing/eye separation control asserted the *eyes*
  had the higher ratio. True in dark, false in light, where a lime eye on a near-white ground is the
  low-contrast class. What the control is for is that two different populations were separated at
  all, which is a statement about their luminances and not about either one's ratio.

And one in the reduced-motion reading: **`getAnimations()` returns CSSAnimation and CSSTransition
together.** Under the emulation the page reports **191 transitions of 0.01ms** — `tokens.css`'s own
reduced-motion kill, created *by* applying the media change — so counting them with the animations
reads as "191 ambient animations survived reduced motion", the exact reverse. Ambient motion is a
keyframe animation; the check counts those.

---

## 6b · The `review-animations` pass, row by row

Run against the finished build on 2026-09-21, against `review-animations` → `STANDARDS.md`. Every
row is a standard from that file, not an opinion.

| Standard | Result |
|---|---|
| **100+/day → no animation, ever** | **Pass.** The ⌘K palette has none, deliberately (departure N-M8), and the sweep asserts `animation: none` and `transition-duration: 0s` on it rather than trusting the comment |
| **Never `ease-in` on UI** | **Pass, 0 occurrences.** Measured with `var()` stripped first — the naive scan reported 99, all of them the substring inside `var(--ease)` |
| **Strong custom curves, not the built-ins** | **Pass.** `--ease-in-out` is `cubic-bezier(.77,0,.175,1)`, which is the standard's own recommended value; `--ease` is `cubic-bezier(.22,1,.36,1)`, a strong ease-out |
| **Button press 100–160ms** | **Pass.** 100 down, 160 up, and the asymmetry is the point (Apple §1: respond on pointer-down) |
| **UI under 300ms** | **Pass**, with four deliberate exceptions, each of which is *not* a UI entrance: `--dur-ring` 600ms (a value arc between two readings), `--dur-spin` / `--dur-spin-fast` (constant motion, `linear`), `--dur-flash` 1.4s (a one-shot locator), `--dur-brand-breath` 6s (ambient, gated on `no-preference`) |
| **Never `scale(0)`** | **Pass, 0 occurrences.** Press is `0.97`, inside the standard's 0.95–0.98 band |
| **Only `transform` and `opacity`** | **Pass.** 0 layout properties in any transition. The press now rides `scale`, which is the same compositor path |
| **No `transition: all`** | **Pass, 0 declarations.** The palette's computed `transition-property: all` is the CSS *initial value* on an element with no transition, not a declaration — a lookalike worth naming, since a scan of computed styles reports it identically |
| **Interruptible for rapidly-triggered UI** | **One accepted exception.** `.toast` enters via `@keyframes`, which restarts rather than retargeting. A toast here is replaced by a user action at most every few seconds, not stacked, so the restart is not reachable at a rate anyone can see. Recorded in §4 rather than fixed; if toasts ever stack this becomes real |
| **Hover motion behind `@media (hover: hover)`** | **Fixed in this pass.** Two ungated hover transforms against fifteen gated blocks elsewhere — drift, not a live defect, since a Mac always matches. `.notif-row`'s reveal was **split** rather than gated whole: the `:focus-within` half is the keyboard path and gating it would have hidden the row's actions from keyboard users entirely |
| **Reduced motion: gentler, not zero** | **Pass.** `.motion-fade` keeps the status island's cross-fade so a state change stays legible; every transform goes |
| **Stagger 30–80ms** | **N/A.** There is none: the route stagger was deleted (N-M2) because it put ~410ms in front of the most frequent action in the app |
| **No `prefers-contrast: more`** | **Open, and out of scope.** Apple §14 names three signals; this app answers two. It is a colour-and-border question, not a motion one, and belongs to the next colour pass |

---

## 7 · Verification

| What | How | Where |
|---|---|---|
| tokens only, no raw literals | `scripts/check-motion-tokens.mjs` | commit hook, with fixtures |
| every button's press animates | `scripts/motion-sweep.mjs` | against the running app |
| reduced motion removes movement | `motion-sweep.mjs --reduced` | CDP `Emulation.setEmulatedMedia` |
| reduced transparency keeps surfaces opaque | `motion-sweep.mjs --reduced-transparency` | same |
| disabled controls do not animate | `motion-sweep.mjs` | same |
| the palette has no motion at all | `motion-sweep.mjs --only=keyboard` | asserted, not assumed |
| focus lands with the surface | `motion-sweep.mjs --only=keyboard` | `activeElement` after open |
| Escape closes in the same turn | `motion-sweep.mjs --only=keyboard` | a real `keydown`, read synchronously |
| nothing invisible still takes clicks | `motion-sweep.mjs --only=keyboard` | with the three-part control |
| the brand lockup's geometry, clipping, affordance and breath | `scripts/brand-lockup-probe.mjs` | the resolved cascade, both themes |
| the lockup's wing / eye / ground pixels | `scripts/brand-pixels.py` | the asset's alpha as the classifier |
| one selector, one sheet, one value per property | `stylesheets.test.ts` | `npm test`, with the shipped `.brand-mark` pair as its fixture |

**Measured 2026-09-21 against the committed tree, dark and light, 12 of 12 routes: 13 pass, 0 fail,
0 NO READING, with a phone linked.** Press: **8604 of 8604** enabled buttons, with 48 rows excluded
mid-FLIP and named by their mark. Reduced motion: 168 transforms → 0, 4 keyframe animations → 0.
Reduced transparency: 4 blurred surfaces → 0. Focus rings: **853 of 853** controls across 12 routes,
0 outlined at rest. Every one with its control.

Each sweep now prints **the theme and the link state** on its own first lines, beside the window's
visibility, for the reason the visibility line already existed: a dark run and a light run came back
byte-identical — correctly, since no rule here is about colour — and two files that cannot be told
apart are one reading and a claim.

**The approved-duration list is read from the page's own `--dur-*` tokens, not listed in the
sweep.** The first version hardcoded it and went red the moment `--dur-brand-breath` was added — a
second expression of a rule that has one home, which is the failure this repo has a section about.
The sweep now refuses outright if it can read no tokens, because "every duration is approved" against
an empty list passes on anything.

Evidence, including what it does **not** cover: `docs/evidence/motion-2026-09-21/`.
