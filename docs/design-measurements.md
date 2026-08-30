# Design measurements — the build against the prototype

Every number here was read over CDP from two live pages at a **matched 1440 × 920** viewport:

- the build, `desktop/dist/renderer/index.html`, on port 9222;
- the prototype, `Mac app UI mockups (1)/design_handoff_connectsuite/ConnectSuite.dc.html`,
  rendered by pointing a throwaway Electron main at it on port 9333.

The first two passes of this comparison are recorded in `docs/testing.md`. This file starts at the
third and is appended to per section, so an interrupted run costs one section rather than the run.

**Every anchor prints the identity string it matched — tag, class, own text — on both sides.**
That column is not decoration. Two passes have now been saved by it: a "device strip" departure
that was the design's *sidebar device card*, and a "primary card" departure that was this build's
**hidden pairing card**. Both produced clean, specific, confident wrong numbers.

---

# Section 1 — The type and colour census

The previous pass reported that "nothing in the type scale ever differed" and attributed every
observed difference to string widths under Archivo vs SF Pro. **That claim does not survive being
measured.** It was made without a per-property comparison ever having run: no `font-size`,
`font-weight`, `line-height`, `letter-spacing` or `color` row appeared in the output *because no
such row was ever produced*. An absence that the query could not have shown is not a finding — it
is the empty-accessibility-tree shape, one layer up.

Run properly, **65 of 83 paired anchor readings differ on at least one of the six properties.**

## 1.1 The typeface question, settled as a fact

Three sources, read rather than inferred:

| Source | What it says |
|---|---|
| `design_handoff_connectsuite/README.md` line 91 | "Archivo throughout (`font-family: 'Archivo', system-ui, sans-serif`; **substitute the codebase's native UI face if it has one — SF Pro is an acceptable native swap**)." |
| The prototype HTML | Loads Archivo from `fonts.googleapis.com` (`<link rel=stylesheet …family=Archivo:wght@400;500;600;700>`) and sets `font-family:'Archivo',system-ui,sans-serif` on `html,body`. |
| The build | `--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`. **Not vendored, and not a fallback** — SF Pro is named first and resolves. |

**The handoff is not silent, and it does not forbid what we draw. It names Archivo and explicitly
sanctions SF Pro as a native swap.** So this is a sanctioned substitution, not a defect, and not
the same class of finding as the blue `--accent` or the 0.72 zoom — both of which were the build
disagreeing with the design with nothing in the handoff permitting it.

`tokens.css` already carries the reason, and it is a second, independent one: the renderer's CSP is
`style-src 'self'`, so a `fonts.googleapis.com` import is blocked outright, and vendoring a woff2
would put a webfont in an app whose first line of description is "no cloud, no account, no relay
server".

**The control that makes the attribution usable.** A prototype that had *failed* to load Archivo
would fall back to `system-ui` — and then every string-width difference blamed on the typeface would
be blamed on a font that was never drawn, while the real cause went unlooked-for. So the prototype
was asked, at the moment of measurement:

```
document.fonts.status        → "loaded"
document.fonts.check('400 16px Archivo') → true
document.fonts.check('600 16px Archivo') → true
[...document.fonts] → Archivo 400 loaded; Archivo 500 loaded; Archivo 600 loaded; Archivo 700 unloaded
```

Archivo 400/500/600 are genuinely loaded and drawn. (700 is unloaded because nothing in the design
asks for it.) **The typeface attribution is real.** The mono face is identical on both sides —
`'SF Mono', ui-monospace, Menlo, monospace` — so no mono row is ever a typeface row.

**Verdict: no fix. Departure X4 stands, now on evidence rather than inference.**

## 1.2 What the census actually found: the build invents line-heights the design does not

The handoff's type table gives a line-height for **exactly one** role:

| Role | Handoff spec | line-height given? |
|---|---|---|
| Page title | 31px / 600 / -0.02em | no |
| Section + card title | 15–21px / 600 / -0.015 to -0.02em | no |
| Body | 13–13.5px / 450–500 / **1.5 line-height** | **yes** |
| Control label | 12.5–13px / 500 | no |
| Meta | 11–12px / 500 / 0.02em | no |
| Sidebar group header | 10px / 600 / 0.12em / uppercase | no |

The prototype behaves accordingly: it sets an explicit `line-height` on the page title (1.15) and on
body copy (1.5), and leaves **every other text element at `normal`** — the face's natural leading.

The build sets a line-height on nearly everything, from four type tokens carrying ratios
(`--text-section` 1.3, `--text-card-title` 1.25, `--text-control` 1.2, `--text-meta-size` 1.3) and
from the body's inherited 1.5 reaching labels that are not body copy.

**The two roles where the handoff specifies a line-height match exactly on both sides**, which is
the control for this finding — it is not that the harness reports everything as different:

| Anchor | Build | Proto |
|---|---|---|
| page title | 31px / 600 / lh **35.65** / -0.62 / `#f4f4f7` | 31px / 600 / lh **35.65** / -0.62 / `#f4f4f7` |
| page subtitle | 13.5px / 450 / lh **20.25** / 0 / `#9c9fb0` | 13.5px / 450 / lh **20.25** / 0 / `#9c9fb0` |

Every role where the handoff is silent differs, and in both directions — this is not one global
ratio being wrong, it is per-element guesses:

| Anchor | Build lh | Proto lh | Δ | Read from (build / proto) |
|---|---|---|---|---|
| device hero name | **31.5** | 23 | **+8.5** | `h2.hero-name "Samsung SM-S938B"` / `h2 "Galaxy S26 Ultra"` |
| fact label | **16.5** | 12 | **+4.5** | `dt.fact-label "Connected via"` / `div "Connected via"` |
| dock tooltip | **16.5** | 12 | **+4.5** | `span.dock-tip "Mirror"` / `span.cs-tip "Mirror"` |
| sidebar group header | **15** | 11 | **+4** | `div.group-header "Device"` / `div "DEVICE"` |
| fact value | **21** | 15 | **+6** | `dd.fact-value "last-known"` / `div "Local Wi-Fi"` |
| section / card title | **19.5** | 16 | **+3.5** | `h3.card-title "What this phone can do"` / `h3 "Quick actions"` |
| side panel title | **19.5** | 16 | **+3.5** | `h3.side-title "Mirroring quality"` / `h3 "Mirroring quality"` |
| quality row title | **16.9** | 14 | **+2.9** | `span.quality-title "1080p · 60 FPS"` / `span "1080p · 60 FPS"` |
| sidebar device name | **15** | 13 | **+2** | `div.device-name` / `div "Galaxy S26 Ultra"` |
| sidebar device state | **14.3** | 12 | **+2.3** | `span#device-state "Connected"` / `span "Connected"` |
| quality row sub | **14.3** | 12.5 | **+1.8** | `span.quality-sub "Recommended"` / `span "Recommended"` |
| nav label (active) | **13.5** | 15 | **−1.5** | `span.nav-label "Overview"` / `span "Overview"` |
| toolbar label | **12.5** | 13.5 | **−1** | `span "Search"` / `span "Search"` |
| toolbar key (mono) | **11** | 12.5 | **−1.5** | `span.mono.tb-key "⌘K"` / `span "⌘K"` |

The pattern is visible in the code as well as the pixels: `shell.css` already carries two comments
saying *"`normal` in the design"* — on `.brand-name` (patched to 1.05) and on `.device-name` /
`.device-status` (patched to 1.25 / 1.3). Both were added in an earlier pass, **each time a single
height measurement failed and was patched with a hand-picked ratio for that one element**. Nothing
generalised the observation, so eleven more elements kept theirs.

### Which way to fix it — `normal`, or the design's numbers?

These are not the same thing, because the two faces do not have the same natural leading. Measured,
both faces, same probe:

| font-size | SF Pro `normal` | Archivo `normal` |
|---|---|---|
| 10 | 11.5 | 11 |
| 11 | 13 | 12 |
| 12 | 14 | 13 |
| 12.5 | 14.5 | 13.5 |
| 13 | 15 | 14 |
| 13.5 | 16 | 15 |
| 15 | 17.5 | 16 |
| 21 | 25 | 23 |

SF Pro runs ~1–2px looser at every size. So `line-height: normal` in the build would reproduce the
design's *intent* but not its *geometry* — every stacked text block would grow, and the artboard's
measured heights (the 52px device card, the 38px nav row, the 66px notification row) are the part of
the handoff that is a contract.

**The face is the sanctioned variable; the measured heights are the contract.** So the fix is the
design's rendered leading, expressed per role, and the residual is nothing.

**Verdict: build-side. Fixed below.**

## 1.3 `.fact-value` puts the mono face on text that is not a number

| | Build | Proto |
|---|---|---|
| "Connected via" value | **SF Mono** 14px / 500 / lh 21 / `#f4f4f7` — `dd.fact-value "last-known"` | **Archivo** 13.5px / 500 / lh 15 / `#f4f4f7` — `div "Local Wi-Fi"` |

The handoff is a closed list, not a suggestion: *"All numerics use a tabular mono face … latency,
byte sizes, percentages, timestamps, IPs, window geometry, dialer digits, file names"*, and gives
the reason — proportional figures jitter as values update.

`shell.ts` builds four facts and gives all four `.fact-value`, which is `font-family: var(--font-mono)`:

| Fact | Value drawn | In the handoff's mono list? |
|---|---|---|
| Connected via | `last-known` | **no** |
| Latency | `9 ms` | yes |
| Encryption | `TLS 1.3, pinned` | **no** |
| Address | `10.108.253.63` | yes (IP) |

Two of the four are prose set in a monospace face. The design sets exactly the same split the
handoff describes: `Local Wi-Fi` in Archivo, `10 ms` and `10.173.69.248` in SF Mono.

**Verdict: build-side. Fixed below.**

## 1.4 The Overview CTA renders as a secondary button — a cascade collision, confirmed

| | Build | Proto |
|---|---|---|
| primary action | bg `rgb(22,24,34)`, text `#e7e7ee`, 500 / 13px, 32px tall, radius 10 | bg **`rgb(139,107,255)`**, text **`#0b0b12`**, **600 / 13.5px**, **40px** tall, radius 12 |

`shell.css` **already defines this correctly** — `.primary-action { background: var(--accent);
border-color: var(--accent); color: #fff; font-weight: 600 }`, with a comment explaining that the
fill is flat because the handoff forbids gradient CTAs by name. **None of it reaches the screen.**

`CSS.getMatchedStylesForNode` on `#hero-mirror`, in cascade order:

```
  .primary-action                     background: var(--accent) ; color: #fff ; font-weight: 600
      sheet style-sheet-…-2   ← shell.css
  button, .button                     background: var(--control) ; color: var(--text-on-control) ; font: var(--text-control)
      sheet style-sheet-…-3   ← styles.css
```

The element carries `class="button primary-action"`. The base rule matches it through `.button`, so
both rules land at specificity **(0,1,0)** — a tie, broken by document order, and `styles.css` loads
after `shell.css`. The later sheet wins on `background`, on `color`, and — because `font:` is a
**shorthand** — on `font-weight` too, which is how a rule that never mentions weight resets 600
back to 500.

This is the `CLAUDE.md` stylesheet rule failing in its documented way — silently. Nothing errors,
`tsc` is clean, 110 tests pass, and the screen's one call to action reads as a plain control.

**It is a new variant of it, though, and the existing guard cannot see it.**
`stylesheets.test.ts` fails on a *selector declared in two sheets*; here the selectors are
different (`.button` and `.primary-action`) and merely collide on the same element. Same silence,
same class of bug, outside the net.

**Verdict: build-side, two fixes — the button, and the guard that should have caught it.**

## 1.5 Rows that are the design departing from its own handoff — recorded, not fixed

The build follows the written spec in each of these and the prototype does not. Named here so the
next pass does not "fix" the build into disagreeing with the handoff:

| Anchor | Build | Proto | Handoff |
|---|---|---|---|
| meta weight (dock tooltip, device state, quality sub) | 500 | **400** | "Meta 11–12px / **500**" |
| card title tracking | -0.225 (= -0.015em) | **-0.15** on Overview, **0** on Mirror | "Section + card title … **-0.015 to -0.02em**" |
| quality row sub colour | `#5b5e6e` | `#9c9fb0` | "`#5B5E6E` … **10–11px meta only**" |
| control radius | 10px | **12px** | "Radius: **10** (controls, chips)" |

The prototype is also internally inconsistent on tracking — `-0.15` on one screen and `0` on
another for the same 15px/600 role — which is itself worth the designer knowing.

## 1.6 One row that needs the designer, and is not being guessed at

The design draws the latency figure in **`#32E58A`** (success green); the build draws it in
`#f4f4f7`.

| Anchor | Build | Proto |
|---|---|---|
| latency value | SF Mono 13.5→14px / 500 / **`rgb(244,244,247)`** — `dd.fact-value "9 ms"` | SF Mono 13.5px / 400 / **`rgb(50,229,138)`** — `div "10 ms"` |

Colouring it green unconditionally would make the build state something it has not checked: a
600ms link would be drawn in the success colour, on the card whose whole job is to say whether the
link is healthy. That is decision 6 inverted — a specific, confident, wrong reassurance.

The handoff's colour table assigns `#32E58A` no threshold, and the prototype has only one latency
value in it, so nothing distinguishes "latency is always green" from "10 ms is green". **Silent on
the thing that decides the fix, so this stops here** and goes to the designer as a question: at what
figure does latency stop being green? Recorded in `docs/design-departures.md`.

**Verdict: open, needs a designer decision. Not fixed, and deliberately not guessed.**

## 1.7 A difference that is not one

`.group-header` reports `text-transform: uppercase` on the build with the source text `"Device"`,
against `none` on the prototype with the source text `"DEVICE"`. **The rendered result is identical**
and this is not a departure — it is recorded only because a naive property diff prints it as one,
and the next run should not chase it.

## 1.8 One more, found by looking rather than by measuring

The Overview media remote's seek and volume sliders were drawing **macOS system blue**.

They are native `<input type="range">` with `accent-color: auto`, and on macOS `auto` resolves to
*the user's own System Settings accent* — blue on this Mac, and pink or graphite on someone else's.
So the app's accent colour was **not ours and not constant between machines**, on a screen whose
every other accent is `#8b6bff`.

Nothing in the repo could have caught it. It is not a token, not a declaration, and not a value any
stylesheet mentions — `grep accent-color *.css` returned nothing, which is exactly why it happened.
No test, no `tsc` pass and no token audit inspects a property the codebase never sets.

This is the third instance of the pattern `tokens.css` already records twice (the blue `--accent`,
the too-light `--bg`): **a colour the design never chose, drawn confidently, invisible to every
check, and found in a screenshot.** Now a global beside `:focus-visible`, scoped to the four control
types that have an accent so it cannot leak by inheritance.

**Verdict: build-side. Fixed.**

## 1.9 Section 1 result

| | Before | After |
|---|---|---|
| Paired anchor readings differing on ≥1 of the six properties | **65 of 83** | **24 of 83** |
| …of which `line-height` | 14 anchors, up to 8.5px out | **0** |

The 24 that remain, all classified, none outstanding as build work:

| Count | Class | Rows |
|---|---|---|
| 8 | **design-side** (§1.5) — the build follows the handoff, the prototype does not | meta weight 500 vs 400 (×7), card-title tracking |
| 4 | **anchor artefact**, named not counted | `nav label (active)` on five screens — the prototype's nav never moves its active row, so this compares our active row against its inactive *Overview*; it matches on Overview, where both are active |
| 3 | **anchor artefact** | `filter pill`, `settings tab`, `settings section` — the two sides put different components at these roles; see section 2 |
| 1 | **open, with the designer** (§1.6) | latency colour |
| 8 | **design-side** | primary CTA size/height/radius — the build draws the handoff's 32px control at 13px in radius 10; the prototype draws 40px at 13.5px in radius 12 |

### What changed in the build

| File | Change |
|---|---|
| `tokens.css` | four type tokens carry the design's rendered leading in px, not a ratio; six `--leading-*` tokens for elements that set their own size; `--accent-on-fill`; a global `accent-color` |
| `shell.css` | eight rules moved off hand-picked ratios; `.fact-value` defaults to the UI face with `.mono` as the opt-in; `.primary-action` removed |
| `styles.css` | `.primary-action` re-declared here, immediately after the base `button` rule, where it wins the tie |
| `shell.ts` | the fact list carries a `numeric` flag; only numerics get `.mono` |
| `stylesheets.test.ts` | a new guard: every class sharing an element with `button` must be declared later in the cascade than the base rule. **Shown to fail** — moving `.primary-action` back to shell.css reports it by name and by both files — and carrying both controls |

112 tests, `tsc` clean.

---

# Section 2 — Messages and Calls, compared by role rather than by surface

The previous pass left ten rows on these two screens as "untestable", on the correct observation
that the elevation-3 anchor matches by *weight* and not by *role*: on Messages the design's primary
surface is a message thread and ours was the conversation list; on Calls the design's is a live-call
card and ours the dialer and log.

That was right about the anchors and wrong to stop there. The anchors being unpairable **is itself
the finding** — two screens whose primary surfaces are different components are not two screens with
a styling difference. Compared by structure instead:

**Both screens are a different layout from the design's. Not a different weight, not a different
token — a different arrangement of different regions.**

## 2.0 First, the control: two absences that are not absences

Measured from a default snapshot, the build appears to have no message thread, no composer and no
live-call card. All three exist. Reporting them missing would have been three false absences in one
section, so each was driven into its live state before anything was written down:

| Claimed missing | How it was checked | What was actually there |
|---|---|---|
| the open thread + composer | pressed the first conversation **by its own element** (`button.sms-thread`), never a coordinate | `div.sms-messages` + `div.sms-compose` — both real |
| the live-call card | drove `calls.renderLive()` with a **synthetic** active call through the pane's own field | `div.call-who`, status line, Hang up, audio-routing note |

The calls pane was put back on the phone's real data with `calls.refresh()` and the messages pane
returned to its list; the synthetic call never left the renderer.

## 2.1 Messages — two panes with a master-detail swap, against three side-by-side columns

| | Design | Build |
|---|---|---|
| shape | `grid(280px 539px 300px)` — three columns, 1151 wide | `grid(815px 320px)` — two panes |
| conversation list | column 1, **always visible** beside the thread | pane 1 — **replaced by the thread** when one opens, reached back via a `← All conversations` link |
| open thread | column 2, 539px, beside the list | the *same* pane 1, instead of the list |
| composer | in column 2 | present, in the thread |
| filter tabs | **All / SMS / Chat** above the list | **none** |
| third region | **this conversation's** detail: avatar, three actions, a shared-media grid (`+12`), Mute notifications, Block contact | a **global Contacts directory** with a search field and 50 rows, unrelated to the open thread |

The two differences that matter are not sizes:

1. **List-or-thread, against list-and-thread.** The design never takes the conversation list away.
   The build swaps it out and offers a back link, which is a phone's navigation model on a 1151px
   Mac window with 815px of room for both.
2. **The third column is a different feature.** The design's is scoped to the conversation in view;
   ours is a directory of every contact on the phone, which answers a question nobody on this screen
   asked and does not change when the open thread changes.

## 2.2 Calls — one full-width pane against three columns

| | Design | Build |
|---|---|---|
| shape | `grid(300px 519px 300px)` | one `div.pane.primary`, 1151 wide |
| call list | column 1, 300px, with **All / Missed 1 / Contacts** tabs | full-width, 50 rows, **no tabs** |
| live call | column 2, 519px: "End-to-end encrypted", name, number, **`00:02:18` running timer**, **Mute / Keypad / Speaker** | inside the same pane: name, number, status, Hang up — **no timer, no Mute / Keypad / Speaker** |
| dialer | column 3: a **12-key keypad** (1–9, ✳, 0, #) plus **Frequently called** | a **text input and a Call button** |
| audio routing | "Audio is routed through Galaxy S26 Ultra" | "Audio stays on the phone — pair the Mac to it over Bluetooth" |

The last row is the one place the build is **ahead of the design** and should not be changed to
match it: both state the platform wall, and ours names the remedy. Keep it.

## 2.3 What each gap would actually cost — because they are not one size

Classified against `docs/protocol.md`, so this reads as work rather than as a list of complaints:

| Gap | Needs | Cost |
|---|---|---|
| Messages: three columns, list stays visible | nothing on the wire — `sms.threads`, `sms.messages`, `sms.send`, `sms.received` all exist | **Mac-side layout only** |
| Messages: All / SMS / Chat tabs | nothing — the thread rows already carry what a filter needs | **Mac-side only** |
| Calls: All / Missed / Contacts tabs | nothing — `call.log` rows carry the disposition already | **Mac-side only** |
| Calls: running timer | nothing — the Mac knows when the call started; `call.ended` already carries `durationMs` | **Mac-side only** |
| Calls: three columns + keypad + Frequently called | `call.dial` exists; a keypad is a different way to reach it | **Mac-side only** |
| Calls: **Mute / Speaker** | **no wire messages exist.** `call.*` is `incoming`, `ended`, `log`, `dial`, `answer`, `reject` — nothing for mute or audio route, and the phone half needs an `InCallService` | **new protocol + new phone code** |
| Calls: **Keypad DTMF tones during a call** | same — no message carries a DTMF digit | **new protocol** |
| Messages: shared media, Mute notifications, Block contact | no wire support; shared media overlaps `media.*`, which Phase 5 has not specified | **new protocol, and it belongs with Phase 5** |

## 2.4 The judgement, plainly

**Our Messages and Calls are different screens wearing the same tokens.** The tokens are right —
that is what section 1 measured and what makes the difference easy to miss in a screenshot. The
structure is not: the design puts list, subject and detail side by side on both screens, and the
build puts one region at a time in a wide pane with a directory bolted to the side of one of them.

**This is a build-side finding, not an untestable row.** Six of the eight gaps above are Mac-side
layout work needing nothing new on the wire.

**Not done in this run, deliberately.** Rebuilding both screens is a larger piece of work than the
brief for this pass, which is measurement plus the unrouted panes, and two of the eight gaps need
protocol that does not exist. Recorded here and carried into `docs/design-departures.md` so it is
scheduled rather than rediscovered by the next person who measures an anchor and finds it unpairable.
