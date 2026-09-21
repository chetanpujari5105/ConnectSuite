# Resume here — written 2026-09-21: the motion pass closed, and the fix that shipped without taking

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · State in one paragraph

The motion and brand pass is **finished and committed**, in five commits. This sitting extended
nothing: it closed the pass, found and fixed **one product defect and two instrument defects**,
added the **fifteenth** pre-commit hook, and re-took every piece of evidence end to end against the
committed tree. The Mac suite is **911**, the phone suite **450**, typecheck clean, **fifteen hooks
and fifteen guards green**. Nothing is pushed.

| Commit | What |
|---|---|
| `baf5664` | **1** — one motion vocabulary; the press that was never eased; `check-motion-tokens.mjs` |
| `baee5c7` | **2** — `motion-sweep.mjs`; the press moves to its own `scale` channel |
| `63b4d77` | **3** — the brand lockup: the stage, the hairline, the clipped halo |
| `d016bb6` | **4** — the `review-animations` pass; two hover rules against fifteen |
| *(this one)* | **5** — the close-out: defects 129, 130, 131; the fifteenth hook; all evidence re-taken |

## 1 · The headline, because it is the reason this sitting existed

**Commit 3's fix shipped, was documented in the stylesheet, and the browser kept the rule it
replaced.** `shell.css` declared `.brand-mark` **twice**, six lines apart — a `57px` /
`object-position: center` block carrying the comment that explains the stage, and the pre-existing
`65px` / `left center` block immediately below it. Equal specificity, later wins, nothing errors.

`getComputedStyle` returned `width: 65px`. So the artwork — 57px at `object-fit: contain` — sat
pinned to the left of its box, leaving **2px of bare stage on the left and 10px on the right**, with
the lime half of the halo showing through the gap, under a comment specifying six and six and
recording that exact gap as *already fixed*.

Three things follow and all three are in the repo now:

1. **Nothing that reads CSS could have caught it**, which is the conclusion the motion sweep already
   reached about transitions. Every number in the brand evidence now comes from `getComputedStyle`
   or from the screenshot's own pixels.
2. **`stylesheets.test.ts` had a guard for this and it passed**, because its discriminator is
   **distance** — far apart is dead, adjacent is a readable override. Inserting the new rule *above*
   the old one makes proximity the thing that hides it: the pair reads as one commented block. A
   distance is a claim about two things and either can move. There is now an assertion with no
   distance in it.
3. **The same shape appeared twice more in the same sitting** — see §3. One rule or one state
   expressed in two places, with only one of them being read.

## 2 · What was found and fixed

| | |
|---|---|
| **129** | `.brand-mark` declared twice; the browser kept the losing rule. **Fixed.** One block. `stylesheets.test.ts` gains *no selector sets one property to two values in one sheet*, red against the verbatim pair |
| **130** | The motion sweep called two product states defects: **(a)** its mid-FLIP exclusion covered one of the mechanism's two marks, so rows that arrived *without moving* read as `snapping: recent-row (12)`; **(b)** `press-down`'s settle predicate never compared how many nodes the force **reached** to how many the reader **scored**, and the 124 it missed reported their at-rest duration — written up as *"128 apps tiles snap their press"*. **Both fixed**, both shown red against the verbatim case |
| **131** | **Twenty fixture suites under `scripts/` are run by nothing, and two were red on the branch.** `check-renderer-scripts.test.mjs` named `discHue.js`, deleted with its last caller — and **its guard kept passing**, because scope comes from `index.html`. `adb-count.test.sh`'s positive fixtures needed a phone on the cable, because `adb-pinned.sh` execed a literal `adb` while the pin honoured `CONNECTSUITE_ADB`. **Fixed with an enforcement point**, not two repairs |

## 3 · The three that are one shape, because the next one will be too

- **129** — one *rule* in two CSS blocks; only the second was read.
- **130(a)** — one *state* in two marks (`is-arriving` **always**, an inline `transition: none`
  **only if the row moved**); only the inline one was read.
- **131** — one *control* naming one file; the file went away and the control could not tell.

The question all three need is the same: **what else expresses this, and am I reading all of it?**
For CSS the answer is always *a less specific selector you did not enumerate*. For a DOM state it is
*a second mark set on a different condition*. For a control it is *nothing — which is why a name is
an allowlist of one*.

**130(b) is the sharpest thing in the sitting and it is worth reading on its own.** The run printed
the disproof beside the verdict:

```
569 of 697 at 0.1s; others: apps-tile=0.16s …  [forced=573]
```

569 + 128 = 697, and 697 − 573 = 124. Two numbers that must be equal for the reading to exist sat
side by side, differing, with the verdict computed from the other one. The clock nobody wrote down
was **the instrument's own reach** — it does not look like state, which is why it was not in the
predicate.

## 4 · What is committed, and where the evidence is

Everything below is in this commit. Nothing is pushed.

| | |
|---|---|
| the pass | `docs/sidekick-motion-system.md` — §5 rewritten, §6.4–6.6 new |
| the slice | `docs/testing.md` → **Motion pass close-out — 2026-09-21** |
| the defects | `docs/defects.md` → **129, 130, 131**, all fixed |
| the evidence | `docs/evidence/motion-2026-09-21/` — **re-taken end to end**; the mid-pass captures were replaced, not kept beside them |
| new instruments | `scripts/brand-lockup-probe.mjs`, `scripts/brand-pixels.py`, `scripts/check-script-fixtures.mjs` + its hook and fixtures |

Verification, as run:

```
desktop typecheck              clean            desktop npm test    911 / 911
phone ./gradlew test           450 tests, 0 failures (debug and release run the same 450;
                               a naive sum over the XML reads 900)
check-script-fixtures          20 of 20 green (floor 12)
motion-sweep dark / light      13 pass, 0 fail, 0 NO READING, 12 of 12 routes, each
check-motion-tokens            74 declarations, 20 tokens, no raw literals
brand-lockup-probe d/l         ALL READINGS OK        shell-parity   853 of 853 rings
state-system-verify            ALL READINGS OK        card-visibility 0 stranded
check-defects                  115 rows               fifteen hooks  all allow
```

## 5 · The brand lockup's numbers, stated the way they must be quoted

| dark | wings | ground | ratio |
|---|---|---|---|
| bare sidebar, no stage | `L=0.0093` | `rgb(14,14,14)` | **1.09:1** |
| on the stage, breath at rest | `L=0.0093` | `L=0.0195` | **1.17:1** |
| on the stage, breath at peak | `L=0.0093` | `L=0.0253` | **1.27:1** |

**This is not a contrast win and must never be described as one.** The mask is near-black by design;
lifting a ground *towards* it reduces the difference, and 3:1 would need an `rgb(99,99,99)` slab in
the sidebar. **The lockup is readable because it has an edge and sits on a gradient — a shape
against varying light.** The ratio is published only so nobody later reads the screenshot as a
number it did not earn.

The control is the **eyes** — 10.24:1 and 9.48:1 in the same frames. They were bright before any of
this work. A run where the wings and eyes converge is an alignment wrong for both classes, which is
how the first version of the instrument was caught.

Light: **16.55:1** bare, **14.22:1** / **14.01:1** on the stage — the stage *lowers* it slightly,
which is the expected direction and is the evidence that light is not over-glowed. The sidebar takes
**no tint** in either theme (gutter beside the lockup and far below it identical to the byte),
against the stage's own channel spread of 9–13 dark and 5–6 light as the control.

## 6 · What needs the user's hands, and why the machine cannot do it

- **Pushing.** Nothing is pushed, by instruction.
- **A visible Electron window for a sweep.** `Page.bringToFront` does not raise a window another
  application covers, and on this machine System Events reports `windows=0` for the process while
  CDP screenshots it happily. Relaunching usually wins the focus; running a command from the
  terminal takes it straight back. Both final sweeps were taken **occluded**, which each declares on
  its own second line, and that turned out to be the better condition: occlusion stalls
  `requestAnimationFrame`, so the FLIP never clears its marks and the run exercises the mid-FLIP
  exclusion rather than skipping past it.
- **Figma.** The MCP is not connected on this account. **No value in this pass has been compared
  against a Figma file**, and every document says so rather than implying a comparison that did not
  happen.

## 7 · What I would do next, and why

1. **`prefers-contrast: more` is handled nowhere.** Apple names three accessibility signals and this
   app answers two. A colour-and-border question, so it belongs with a colour pass rather than here.
2. **Defect 122 is still open and is the oldest thing in the way** — `⌘1`–`⌘9`, `⌘0`, `⌘,`, `⌘⇧.`,
   `⌘⇧T`, `⌘⇧4` are drawn in the palette and **nothing is bound to any of them**. The fix direction
   in the register stands: a real `Menu.setApplicationMenu` reading `navModel`, **not** a `switch`
   on `event.key` in `shell.ts`. Defect 126 shipped an application menu, so the hard half exists now.
3. **The disabled-control row has a denominator of 1.** It is a real reading and a thin one; it
   needs a state that puts more disabled controls on one screen.
4. **`.toast` uses `@keyframes`** so it restarts rather than retargets. Accepted while toasts do not
   stack; real the day they do.

## 8 · Left changed on the devices

- **The Mac app is running** from `desktop/` with `--force-renderer-accessibility
  --remote-debugging-port=9222`, in **dark**, linked to the phone. Appearance was flipped to light
  and back during the readings and is back where it started.
- **Nothing was left injected in the page.** The before/after capture sets two inline values on
  `.brand-mark` and asserts their removal before exiting; the `is-arriving` stimulus removes the
  class and asserts zero remain; the halo's breath is pinned for the crops and released.
- **The phone was not written to.** No `adb` command in this sitting changed device state; the only
  device reads were `adb devices` and, through the fake, `adb-count.test.sh`'s fixtures.
- **`skills-lock.json` and the `.­*/skills/high-end-visual-design` trees are untracked or modified
  and were deliberately left out of the commit** — they are editor/skill installs, not this work.
