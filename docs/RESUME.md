# Resume here — written 2026-09-20 (third sitting): the phone is back, and the sweep is green

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · State

The phone was re-paired by the owner. Confirmed before anything was read: `phase=connected`,
`paired=true`, `Samsung SM-S938B`, **10 ms**, 11 capabilities, **13 of 13 routes open** — each
asserted by routing to it and reading back the `data-screen` of the section actually visible.

| Commit | What |
|---|---|
| `2a3d367` | **6a** — pairing's *No network* (`34:12152`), **defect 125**: the screen drew a real QR of `0.0.0.0` |
| `68bd6ba` | **6b** — the shell's cross-cutting surfaces, **defects 126–128** |
| `852b9bc` | **6c** — the sweep on a live link; **defect 127's second instance**, found by a column |
| `dfad544` | **6d** — Files' and Photos' five uncaptured states, and **D67** |

**869 → 905 tests.** Typecheck clean, `probe.test.mjs` 24/24, all twelve guards green on every
commit. **Nothing pushed. Nothing within reach of pairing, identity, TLS or the trust store.**

## 1 · The one thing that is still true about every screenshot in this repo

**The Figma MCP is not connected on this account** — it returns *"MCP server not connected"*, not
the plan limit it returned in earlier sittings. Exactly one frame has ever been rendered against
this build: `32:4382`. Everything else is **built to the handoff**, which is the weaker claim and is
what every row, departure and commit message says. Do not upgrade that wording without a render.

## 2 · The largest remaining coherence item, with its scope

**D67 — seven state vocabularies, not one.** `docs/design-departures.md` is headed *"One vocabulary
for states"*; one was deleted (Notifications'), and **six survive**, counted in `styles.css`:

| `files-state*` | `apps-banner*` | `photos-banner*` | `activity-state*` | `files-banner*` | `call-state` |
|---|---|---|---|---|---|
| 16 rules | 6 | 5 | 4 | 2 | 1 |

They are unrelated, not near-duplicates — component 11's `error` is transparent, centred, `0px`
radius, `24px` padding, 600/15px `#F2F3F5`; Files' M4 card is `rgba(255,92,92,.14)`, left-aligned,
`14px`/`14px`, 500/13px `#FF5C5C`. **Two committed captures show both at once**
(`files-couldnt-open-SYNTHETIC`, `photos-permission-SYNTHETIC`): one pane, one screenshot, two
languages for *there is nothing here*.

**It is recorded rather than converted because of a boundary, not a budget.** Component 11's default
is specified *centred in a pane-sized region*; all six live in a narrow column or a full-width bar.
`stateBlock` has a `compact` variant and **`compact` has no Figma frame**, so choosing it is
inventing design. Scope when it is taken: six vocabularies, 34 CSS rules, four panes.

## 3 · Four instrument faults, and two of them are new shapes

| | What it reported | What it was |
|---|---|---|
| focus rings | `0 of 17` | `el.focus()` does not fire `:focus-visible` |
| the whole sweep | **`OK — 0 of 0`** | every route refused, and `0 === 0` is true. A sweep that measured nothing certified everything |
| **focus rings, again** | **`557 of 829`, twice** | **a stable wrong answer.** Photos streams thumbnails in and *replaces* its elements, so a settle predicate on the node count is satisfied while every forced state sits on a dead node. 272 tiles read as unringed — the exact shape of a real defect |
| the captures | `--prep did not land` | **a failed shot exited before its restore**, leaving the app holding an invented refusal, which poisoned the *next* run |

The third is the one to carry forward: everything this repo has written about flaky instruments is
about readings that **vary**, and the fix for those is a settle predicate. This one settled
perfectly and repeated exactly. What separated it from the truth was asking *what is each one
measuring* — a settled pane, or dead nodes. Force and read are one atomic pair now, repeated until
two consecutive pairs agree: **835 of 835 across twelve routes, three consecutive identical runs**,
control **0 of 835** at rest.

**And a fix that fails in a way nobody would predict:** two `requestAnimationFrame`s before reading.
**rAF does not fire in an occluded window** — Electron behind another window never ran the callback
and the sweep hung with no output. An instrument that works only while somebody is looking at the
app is not one.

## 4 · What is still open

1. **D67**, above — the largest item, and it needs the designer.
2. **One Figma render per screen.** Blocked on the MCP connection.
3. **States needing the phone in a condition this Mac cannot produce**: a real revoked grant, a real
   send failure, an incoming call, a live mirror session, a real `pair.rejected`.
4. **Mirror's right column at 920** — its *Advanced* card is `reachable`, not `stranded` (0.72).
5. **The packaged menu bar is unread.** The app menu's title comes from `CFBundleName`, `Electron`
   in development and `Sidekick` in a packaged bundle — verified from the plist, not from a build.
6. **The designer's hour**, now nine panes deep, plus pairing's *No network* copy and the decision
   to keep **194 native `title` tooltips** (the handoff specifies eighteen components, none a
   tooltip).

## 5 · How to pick it up

```
cd desktop && npm run build && npm test
pkill -f "node_modules/.bin/electron"
nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &
node scripts/shell-parity-sweep.mjs       # refuses rather than passing on an empty denominator
node scripts/files-photos-states.mjs      # restores the panes at both ends; control is 152 albums
node scripts/pair-nonetwork-probe.mjs     # computed style, both card shapes
```

Every CDP command now times out by name after 30 s. If one does, read which — a hang used to print
`Detected unsettled top-level await` at a line number in the *caller*, which says nothing.

---

# Resume here — written 2026-09-20 (second sitting): pairing's last state, and the shell

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · Two things are blocking, and neither is code

1. **The phone stopped trusting this Mac, mid-sitting.** Every reconnect returns
   `SSLV3_ALERT_CERTIFICATE_UNKNOWN` — SSL alert 46, the phone refusing this Mac's certificate —
   so the app correctly forces the pairing screen and **every other route is a no-op**. Nothing in
   this sitting touched identity, TLS or the trust store; the control is that `shell.route('files')`
   called directly is equally a no-op. **Re-pairing is a scan on the owner's phone and a write to
   their trust store, so it was not done.** Until it is, no pane can be screenshotted and the shell
   sweep holds no reading.
2. **The Figma MCP is not connected on this account.** `get_screenshot` returns
   *"MCP server not connected"* rather than the Starter-plan limit it returned in the last two
   sittings. So **every frame in these two batches is built to the handoff**, which is the weaker
   claim, and it is stated in every row, every departure and both commit messages. Exactly one
   Figma frame has ever been rendered against this build: `32:4382`.

## 1 · What landed

| Commit | What |
|---|---|
| `2a3d367` | **6a** — pairing's *No network* (`34:12152`) and **defect 125**: the screen drew a real QR of `0.0.0.0` |
| `68bd6ba` | **6b** — the shell's cross-cutting surfaces, measured. **Defects 126, 127, 128** |

**869 → 900 tests.** Typecheck clean, all twelve commit guards exit 0 on both. Nothing pushed.
Departures **D61–D66**; evidence `docs/evidence/sidekick-batch6/`.

## 2 · The three defects a person would have hit

- **125.** With no network, `localAddress()` returned `'0.0.0.0'`, that went into the pairing
  payload, was encoded into a real QR, and was drawn under *"Scan this with your phone"*. Nothing
  can connect to `0.0.0.0`. The literal had **one writer and no reader** in the whole desktop tree.
- **126.** The macOS menu bar said **Electron**, its About/Hide/Quit said **`sidekick-desktop`**,
  and View offered **Force Reload and Toggle Developer Tools** to users.
- **128.** The New-conversation panel was a modal surface with no role, no label, no Escape and no
  focus restore — read beside the palette, which has all four.

## 3 · Three instrument faults, and the third is the one to read

| | First answer | What it was |
|---|---|---|
| focus rings | `0 of 17` | `el.focus()` does not fire `:focus-visible`. Zero rings on a fully ringed app |
| Photos' rings | `14 of 166` | `DOM`/`CSS` are per-target domains whose node map outlives the websocket |
| **the whole sweep** | **`OK — 0 of 0`** | every route refused, and `0 === 0` is true |

**A sweep that measured nothing certified everything**, in a file written the same hour as a probe
carrying the same guard. The denominator is the verdict's own control and is checked before the
ratio now. The committed artifact is the **blocked** run, because that is what the guard looks like
when it fires.

A fourth, from 6a: a `[hidden]` companion was added to `styles.css` on the reasoning that an author
`display` on an id beats the UA's `[hidden]` — then the probe was re-run **with it removed** and
read `display: none` anyway, because `shell.css:41` already declares it `!important` globally. The
hypothesis was refuted by its own control and the line came back out. *The control was only run
because the answer had already come back the way I wanted it.*

## 4 · The reading with the link up, at 17:15

Focus rings **816 of 816** across twelve routes, control **0 of 816** outlined at rest. **0**
surfaces still blurred under reduced transparency, **0** still transitioning under reduced motion,
against **5** translucent at rest. Palette and New-conversation both labelled `role=dialog`; toast
`role=status`. It is not a committed file because the link went down before one could be written.

## 5 · What is still open

1. **Re-pair the phone** (owner's action) — then re-run `node scripts/shell-parity-sweep.mjs` and
   commit a green artifact beside the blocked one.
2. **One Figma render per screen.** Owed for every frame but `32:4382`.
3. **Files' and Photos' remaining frames** — *sending*, *no folders*, *couldn't open*, *partial*,
   *permission* were not re-captured after the surface change. All five have tests.
4. **States needing the phone in a condition this Mac cannot produce**: a real revoked grant, a
   real send failure, an incoming call, a live mirror session, a real scan advancing the pairing
   column, a real `pair.rejected`.
5. **The packaged menu bar is unread.** The app menu's title comes from `CFBundleName`, which is
   `Electron` in development and `Sidekick` in a packaged bundle — verified from the plist, not
   from a build. The packaged View menu (no reload, no devtools) is covered by a test and read from
   no packaged build.
6. **The designer's hour**, now nine panes deep. New this sitting: pairing's *No network* copy, and
   the decision to keep **194 native `title` tooltips** because the handoff specifies eighteen
   components and none is a tooltip.

## 6 · How to pick it up

```
cd desktop && npm run build && npm test
pkill -f "node_modules/.bin/electron"
nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &
node scripts/shell-parity-sweep.mjs          # refuses rather than passing on an empty denominator
node scripts/pair-nonetwork-probe.mjs        # computed style, both card shapes
node scripts/shot.mjs --out=/tmp/x.png --screen=<pane> --viewport=1440x920 --settle=1200
```

**If a probe hangs on a `DOM.querySelectorAll`, restart the app.** `DOM` and `CSS` are per-target
domains: an interrupted run leaves a node map a new connection cannot address. `rawForcePseudo`
disables them before enabling for that reason, but a run interrupted elsewhere can still leave it.

---

# Resume here — written 2026-09-20: the full-app Sidekick parity pass, batches 4 and 5

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · What this sitting was

The owner widened the brief: **not a demo shell, a full-app UI completion project** — every screen,
state, dialog and empty state on one Sidekick visual system. The inventory that scopes it is
`docs/sidekick-full-app-inventory.md`, built by reading `navModel.ts` and screenshotting all twelve
routes rather than from memory; its §5 is what is still open.

| Commit | What |
|---|---|
| `66ca178` | **4a** — Messages against the one real Figma render, plus the cross-cutting pass: device strip deleted, `renderer/stateBlock.ts` (components 11 and 12), every per-person/per-app hue gone with `shared/discHue.ts`, content starts at y = 140 |
| `e2cb988` | **4b** — Calls, and **defect 124**: both audio sentences offered the Bluetooth remedy `CLAUDE.md` retracted on 2026-09-14 |
| `8f41a00` | **4c** — Notifications: Muted filter removed (N1), Reply pills, Read-only box |
| `0205e4b` | **4d** — Clipboard: direction chips, neutral kind badges |
| `889f88f` | **5a** — Settings → **Device info** with `shared/capabilityStatus.ts` (discharges D22) |
| `9fbd195` | **5b** — Activity: donut and sparkline out (D9), per-event tone in (discharges D23) |
| `8fd2f36` | **5c** — Apps, Files, Photos, Camera onto the card surfaces |
| `34809be` | **5e** — the media-session row in the Notifications feed (`40:21209`), the last handoff frame with no code |
| `9ebcd4a` | **5d** — pairing's four steps from `shared/pairSteps.ts`, and the manual address where it is needed |

Every commit: typecheck clean, `npm test` 843 → **869** green, guards exit 0. **Nothing pushed.**
Departures **D27–D58**; evidence `docs/evidence/sidekick-batch4/` and `sidekick-batch5/`.

## 1 · The one thing to read before claiming parity

**Exactly one Figma frame has ever been rendered against this build: `32:4382` (Messages · Thread),
saved at `docs/evidence/figma-reference/messages-thread-32-4382.png`.** The MCP allowed one call and
then returned the Starter-plan limit for the rest of two sittings. Every other screen is **built to
the handoff's written spec**, which is a weaker claim, and it is stated as such in the inventory, in
every departure row and in every commit message. *Do not upgrade that wording without a render.*

## 2 · Measured, not assumed

- **Overflow sweep, every pane.** 1440 × 920: 11 of 12 at `scrollHeight === clientHeight`; Mirror is
  264px over because its *Advanced* reference card sits below the fold (D26's layout, carries no
  state). 1100 × 700: no horizontal scroll anywhere; five panes scroll vertically, which is allowed.
- **`card-visibility-sweep.mjs`: 19 cards — 18 visible at rest, 1 reachable, 0 stranded.**
- **Two defects found by measuring rather than looking.** `#page` scrolled to **3,351px in an 808
  window** on Messages: the unread badges' `.visually-hidden` spans are `position: absolute`, and an
  absolute box is clipped only by an overflow container that is also its containing block — no row
  between them was positioned. And at 1100 × 700 the Messages person column wrapped onto a second
  row because its breakpoint sat **above** the rule it overrides.

## 3 · Where evidence can mislead, in this pass specifically

- **Committed captures of Messages, Notifications, Clipboard and Calls are SYNTHETIC on purpose.**
  The live panes carry the owner's real SMS (including one-time codes), notifications and contacts.
  The first Notifications run was thrown away because a real notification arrived *during the
  settle* and redrew the pane — the stimulus succeeded and was undone. Captures now freeze the
  view's `render` after seeding and reload the renderer between shots.
- **Two captures were taken before their content arrived over the wire** (Apps' 126 icons, Photos'
  thumbnails) and showed empty tiles. The icons were in the DOM 3 s later, 126 of 126. Both are
  gated on content now.
- In the *disconnected* and *permission* captures the status island still reads **Connected** —
  only the pane was driven into those states.

## 4 · What is NOT done

Listed in full in `docs/sidekick-full-app-inventory.md` §5. The short version:

1. ~~`40:21209`, the media-session row~~ — **built after this section was first written**
   (`34809be`), so **every frame in the handoff now has code behind it**. What it has never had is a
   real session: the row was driven by hand, and `remote.state` arriving in that shape on hardware
   is unproven.
2. **One Figma render per screen**, whenever the MCP allows it.
3. **States needing the phone in a condition this Mac cannot produce**: a revoked grant, a failed
   send, an incoming call, a live mirror session, a real scan advancing the pairing column.
4. **Pairing's *Rejected* and *No network* frames.**
5. **The designer's hour**, now seven panes deep — the state vocabulary is settled in code, but the
   new prose (Calls' audio sentence, Apps' ask-and-tap footer, the pairing help copy) is unapproved.

## 5 · How to pick it up

```
cd desktop && npm run build && npm test
pkill -f "node_modules/.bin/electron"
nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &
node scripts/shot.mjs --out=/tmp/x.png --screen=<pane> --viewport=1440x920 --settle=1200
```

`--viewport` is new: it emulates the layout viewport because this display cannot open a 920-tall
window, and it clears the emulation on every exit path. **If a shot refuses with "the window is
zoomed (innerWidth … !== outerWidth 0)", the window is hidden, not zoomed** — the app was closed to
the Dock. `open -a desktop/node_modules/electron/dist/Electron.app` brings it back.

---

# Resume here — written 2026-09-19: Sidekick Batches 1–3, for the demo

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · State

| Commit | What |
|---|---|
| `832b332` | **Batch 1** — Figma tokens, Figma-vector icons, `LOGOS/` brand art through dev and packaged builds, the shell (232 sidebar, lockup under the traffic lights, Search = ⌘K palette, no dock) |
| `c06506b` | **Batch 2** — the Overview rebuilt to handoff §6: hero + phone visual, media remote, four-row Recent, two metric cards, Connection & security; connected / connecting / disconnected / permission states |
| `e315c72` | **Batch 3** — Mirror (Session card, one of Start/Stop), Settings → File transfer (brand tile, Show in Finder verified), pairing (code draws on arrival — a real defect) |
| `4bc3693` | **Batch 3 demo polish** — Mirror's Link card (D26), `pairingArm.test.ts` (pairing while connected: no teardown, no forget, no rotation, identity unchanged — also read live), Show in Finder measured read-only, packaged assets byte-identical, five final 1440 × 920 shots. **837 / 837.** No further UI batch is to start before the demo |
| *(the commit after `4bc3693`)* | **Packaged icon** — `build/icon.icns` derived from `LOGOS/main_logo.png` by `derive-brand.mjs`, `mac.icon` in `electron-builder.yml`. Nothing else changed |

Every commit: typecheck clean, `npm test` 818 → 837 green, all commit guards exit 0. Nothing pushed.
Evidence: `docs/testing.md` → *Sidekick Batch 1/2/3*; departures D13–D26 in
`docs/design-departures.md`; screenshots in `docs/evidence/sidekick-batch{1,2,3}/`.

## 1 · The Figma MCP was rate-limited for the whole sitting

Every `get_screenshot` returned the Starter-plan limit. **No pixel overlay against any Figma frame
exists.** Everything was built against `docs/sidekick-figma-handoff.md`'s numbers and the component
values already extracted (icons, D13–D18). One Figma call per frame is owed: `6:2`, `22:184`,
`31:1566`, `34:10843`, `34:11219`.

## 2 · Not proven on hardware

- **This display offers 865px of height**, so the window opens at 1440 × 841, not 920; the final
  shots emulate the viewport. Set the demo Mac's display scaling so 920 fits before presenting.
- **The packaged app carries the Sidekick icon** (`build/icon.icns`, `mac.icon`). On macOS 26 it is
  drawn inside Tahoe's grey plate for legacy icons; removing the plate needs Xcode's `actool` and an
  Icon Composer `.icon`. The dev build (`npm start`) still shows Electron's icon in the Dock.
- **Media remote with a real session.** Idle, permission and offline are real; *playing* was only
  rendered from a synthetic state. Play something on the phone before any demo.
- **A live mirror session** after the Session-card change (consent needs a tap on the phone).
- **Connecting** was rendered synthetically (a real reconnect takes ~250 ms).

## 3 · Next

Batches 4–5 in `docs/sidekick-implementation-plan.md`: Messages, Notifications, Clipboard, Calls;
Apps, Activity (per-event badge tone — D23), Settings → Device info (D22's real home), Camera, the
four-step pairing column.

---

# Resume here — written 2026-09-17: the native-macOS pass

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Nothing is committed.** The tree holds this pass **and** the 2026-09-17 O19–O21 follow-up below
> it, uncommitted together.

## 0 · Read first: which design authority this pass answers to

The owner briefed a visual + motion pass ("native macOS, not a vibe-coded dashboard") and, **when
asked, chose: the brief wins where it disagrees with the handoff, and every disagreement is a
departure row.** Those rows are **N-P1–N-P3, N-M2, N-M4, N-M7–N-M10** at the end of
`docs/design-departures.md`. The handoff is still the authority for everything not named there. This
is recorded so it does not repeat 2026-09-16's unnamed second reference (§ below, and that file's top).

| | |
|---|---|
| The audit and plan, written before code | `docs/native-mac-pass-audit.md` |
| The evidence | `docs/testing.md` → **Phase 7 Slice 63** |
| The departures | `docs/design-departures.md` → *The native-macOS pass* |

## 1 · What changed

- **Defect: Start and Stop mirroring were both on screen.** Nothing held whether a session existed.
  `src/shared/mirrorSession.ts` (8 tests, red-first) now decides; exactly one is shown.
- **Rings → readout + bar** (N-P2). The rings had *never* animated — rebuilt at their final value on
  every update. Bars now travel from the previous reading (`transform: scaleX`, 600ms ease-in-out).
- **Colour roles** (tokens.css): hue means one thing. Battery is neutral until low; capability chips
  are not green (N-P1). One two-state selection rule (`--selection-*`, `--unselected-text`) across
  capability chips, Activity chips, Notifications filter pills, Settings tabs and quality rows.
- **Material:** top-level panels (`.card`, `.pane`, `.files-panel`, `.unbuilt-screen`) are
  `--material-card` + blur; the one primary card stays opaque; nested panels never blur.
- **Motion:** route 410ms → 140ms opacity (N-M2); halo once on connect, not forever (N-M4); island
  words fade on a *tone* change only; ⌘K opens in one frame (N-M8); dock without overshoot (N-M9);
  one press scale (N-M7); no hover on non-interactive cards (N-M10); new Recent activity rows arrive,
  keyed on `seq`, survivors slide (FLIP).
- **Type:** 18 literal sizes → 12; `--text-caption` added.
- **Accessibility:** reduced motion keeps opacity fades on `.motion-fade`; reduced transparency now
  handled (it was ignored while chrome drew blur).

## 2 · What is NOT done or NOT proven

- **`/review-animations` has not been run.** It is user-invocable only. The brief's last step.
- **Start/Stop during a live session is proven by test, not on hardware.** Stimulus: press Start with
  the phone connected; Stop should replace it at once, before consent.
- **No overflow measurement after the 0.5px type moves** — checked by eye on five panes at
  1440×920. A DOM double has no layout; the one tool that can see it is a CDP probe.
- **Card blur cost is unmeasured.** `backdrop-filter` over the animated blobs; the plan said measure
  frame time with the scroll-rate probe and fall back to opaque if it regresses. Not done.
- **The sidebar footer wraps "Chetans-MacBook-Pro" onto three lines at 1440px.** Seen, not caused by
  this pass, not fixed.
- The literal durations in **styles.css** (180ms ×4, 160ms ×2) were not tokenised; shell.css's were.
- The brief named `redesign-existing-projects` and `high-end-visual-design`; **neither is installed**.
  `impeccable` stood in for the audit.

## 3 · Verified, as run

```
npm test (desktop)   767 / 767          all eight .mjs guards + check-defects.sh   exit 0
```
Live CDP reads of every motion value are in Slice 63 §3, from an Electron started after the build.

---

# The previous sitting's brief, kept until its work is committed

# Resume here — written 2026-09-16: Overview re-scored against the handoff, and a second design authority retired

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Committed as `f6384a3`** (the four stacked sittings, one commit). **2026-09-17 follow-up, not yet
> committed:** O19 (storage ring to the handoff's assignment), O20 (the handoff's phone render), O21
> (the strip below the fold at 920px, recorded as a departure), and the 761 count settled — §3.

## 0 · The one thing to read before touching the Overview pane

**There were two design authorities for one day, and one of them is now retired.**

`docs/testing.md` Slices **59**, **60** and **61** (2026-09-16) each say *"rebuilt against a
reference mockup"* and **none of them says which**. It was not
`design_handoff_connectsuite/ConnectSuite.dc.html`. That second reference is recorded as
**superseded** at the top of `docs/design-departures.md`, with the six differences it produced
measured; `docs/phase-7-state.md` §1 now states what "Built to the handoff" is scored against for
each of the four panes it names.

**Do not rebuild against it again.** The transferable rule is in the same place: *a rebuild is
scored against a named authority or it is not scored at all* — nothing in the build can compare two
designs, so a second authority stays invisible until somebody reads both.

## 1 · What this sitting did

A reported 26-item audit of the Overview pane, resolved against the handoff and its `README.md`.
Full evidence: `docs/testing.md` → **Phase 7 Slice 62**. Departure rows **O6–O18**.

**Nine of the 26 were withdrawn by measurement, before any code changed**, and two of those are the
ones worth knowing about:

- The **storage ring** was reported as wrongly bound. It is not — the arc is bound to *used*, which
  is the handoff's binding too. Fixing it as filed would have drawn the ring nearly **empty** on a
  phone with 2% free, which is the alarming direction.
- The **phone preview** was reported as an empty black rectangle needing an empty state. It is the
  handoff's *"150px phone render"* — decoration, not a preview. No device screenshot exists on this
  wire and cannot (Slice 59 §2).

The sticky-pill report and the duplicated-track-title report did not reproduce at all; the dock, the
`MENU` group header and the tinted activity tiles are all specified in the README verbatim.

**Thirteen changes landed.** Eight are the build coming *back* to the handoff and are marked
**corrected** rather than given a departure status; five are genuine departures over surfaces the
handoff never drew.

| | |
|---|---|
| Recent activity rows | 104px → **52px**, tile 56 → **26**, time column 62 → **44** (O8) |
| Column imbalance | **227px → 139px**, measured (O6, O8) |
| Heading sizes on the pane | **4 → 3** (31 / 21 / 15) — O9, O10 |
| Battery renderings on one viewport | **3 → 2**; storage **2 → 1** (O11) |
| Overflow triggers | **2 → 1** (O16) |
| Activity time column | relative-only → **absolute**, with the age on the aria-label and `title` (O17) |
| Capability chips | raw wire ids → readable names; a `check`/`lock` glyph; reasons as **standing copy** (O13, O14, O15) |
| A past failure row | `--destructive` tile → grey + `alert-circle` (O7) |

## 2 · Two defects nothing in the build could have seen

- **123 — the app's most advertised accelerator was bound to a log line. Fixed.** `⌘⇧M` is printed
  on the Overview hero's primary action *and* in the ⌘K palette, and `main.ts` registered it as a
  **`globalShortcut`** for the **mark diagnostic**. A global shortcut is taken before the page sees
  the key, so it had never once started a mirror. Nothing reported it because
  `globalShortcut.register` returned `true` — the only signal available said *the shortcut works*,
  and it did. The mark is on `⌃⌥⌘M` now, unadvertised; mirroring is bound **in the page**, where it
  belongs.
- **122 — every other shortcut hint except ⌘K is decorative. Open, deliberately not fixed.**
  `⌘1`–`⌘9`, `⌘0`, `⌘,`, `⌘⇧.`, `⌘⇧T`, `⌘⇧4` are strings in `navModel.ts` with **nothing bound**.
  There is no application menu at all. It is shell-wide across twelve panes and this pass was scoped
  to one, so it is registered with a fix direction rather than half-done. The fix is a real
  `Menu.setApplicationMenu` reading `navModel`, **not** a `switch` on `event.key` in `shell.ts` —
  that is a second accelerator table and the menu bar is the one people discover.

## 3 · What is NOT done

- **Nothing is committed.**
- **~~`#caps-card` and `#overview-strip` below the fold at 920px~~ — resolved 2026-09-17.** The
  capability list is reference and may scroll. The strip carries state, and cannot be made visible at
  rest without departing from the handoff: the handoff's **own** footer sits at 872–930 against a
  scroll band ending at 865. Recorded as departure **O21** rather than left open.
- **~~The suite measures 757 and this file claimed 761~~ — settled 2026-09-17 by measurement.**
  Parent `59c9475` runs **681**, HEAD `f6384a3` runs **757**, and the test diff is +86/−10 = +76
  exactly, including Slice 58's five deleted Quick-actions tests. 761 was Slice 57's figure, stale
  since Slice 58; it is consistent with the chain but cannot be re-measured (no tree at that state
  exists). Slice 62 §6 carries the table.
- **The storage ring and the phone render were not withdrawn as conformance** — only as defects.
  Both now match the handoff: `490 GB` in the ring over `9.0 GB free` (47.0px of text in a 50.4px
  span, so it stays 13px), and the violet→teal wallpaper with its notch pill (O19, O20).
- **The designer's hour is unchanged and now six panes deep** — the *unavailable / partial / failed
  / empty* vocabulary, a drawn pairing screen, and now a drawn treatment for the capability list and
  the media card, both of which this pass had to invent type sizes for because the handoff draws
  neither.

## 4 · Two regressions this pass introduced, caught by measuring rather than looking

Both are the shape where a correct-looking fix moves the problem, and both are worth carrying:

- **Putting the ring values in the mono face made `10.8 GB` overflow its arc** — 54.8px inside a
  50.4px clear span. `storageRing`'s own comment already records this exact overflow happening once
  before, *"seen in a screenshot, not in any test, because a DOM double has no layout"*. It came
  straight back because mono is wider at the same px. Long values step down a size now, at a
  measured six-character threshold.
- **The metadata column collapsed to 62px for text needing 116**, drawing `Samsung SM-S938B` as
  `Sam…` with 300px of empty row beside it. **The obvious cause was wrong and the measurement said
  so** — removing `.recent-meta`'s `min-width: 0` changed nothing, because the real floor is one
  level in at `.recent-device span`, whose `overflow: hidden` for its ellipsis zeroes *its*
  min-content and propagates up.

**And the instrument was wrong once, caught by its own output.** The first column-imbalance read
classified cards by matching their ids and reported **205px** — but `.caps-card` is
`grid-column: 1 / -1` and spans both columns, so that number was a full-width card's bottom edge
rather than a column's. A card's column is a fact the browser holds; the probe reads it from the
rect against the grid midline now.

## 5 · How this was verified, as run

```
npm test (desktop)               757 tests, 757 pass, 0 fail
scripts/check-renderer-views.mjs 12 covered, 1 debt, 0 unaccounted for
scripts/check-defects.sh         107 numbered rows, all with records
check-color-tokens · check-contrast · check-apps-verb · check-protocol-spec ·
check-debt-claims  · check-orphan-tests                                      all exit 0
```

Every DOM number in Slice 62 came through `scripts/probe.mjs` with a control, at 1920×1080 with
`innerWidth === outerWidth` (no zoom). **Before reading anything over CDP, check who owns :9222** —
`lsof -nP -iTCP:9222 -sTCP:LISTEN` then `ps -o lstart= -p <pid>`. A stale Electron holding the port
serves every query from an old renderer while the window you are screenshotting is the new one, and
a painted window is not evidence the renderer's JS thread is alive.

## 6 · Where the evidence is

| | |
|---|---|
| the slice | `docs/testing.md` → **Phase 7 Slice 62** |
| the departures | `docs/design-departures.md` → **O6–O21**, and the superseded-reference block at the top |
| the defects | `docs/defects.md` → **122** (open), **123** (fixed) |
| what Phase 7 has left | `docs/phase-7-next.md`, and `docs/phase-7-state.md` §1 for the re-scoring note |
