# Resume here — written 2026-09-14, end of the mirror block

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Everything is committed**, head `ba106fa`. All four mirror items from
> `docs/mirror-diagnosis-2026-09-09.md` are done. This file is the wide view, because the last four
> days were entirely inside mirror internals.

## 0 · Where the app stands, in one table

| | state |
|---|---|
| Phases 1–6 | **closed**, each against stated conditions (`docs/phase-5-closeout.md`, `docs/phase-6-closeout.md`) |
| Phase 7 — Mac UX | **in progress.** Panes all built; the four mirror items closed today |
| Phase 8 — signing | **not started**, and it is the gate on Phase 9 |
| Phase 9 — distribution | **started, blocked on an Apple account.** Both artifacts exist and **neither can be given to anyone** |
| Mac suite | **681** |
| phone suite | **442** |
| commit hooks | **11** |

## 1 · The four mirror items — all closed

| § | what | outcome |
|---|---|---|
| 3 | the fit | fixed; verified on the S25 in **both orientations**, box and tap mapping, error 0,0 |
| 1 | the float never starts | defect 105 — the start contract; the race **watched losing** (730 dropped / 0 asked) and recovering (1 dropped, decoding in 3.9 s) |
| 4 | latency | defect 108 — the anchor was **subtracting the encode stage**, 44% of the figure. Fixed, measured at three rates |
| 2 | float input | shipped, on a **shared** recogniser; `mirror.rotate` reached one window and that went in first |

**§4's standing question is perceptual, not technical.** 0 dropped frames at 60 and 120 fps, ~25 ms
capture-to-paint, peak under 40 ms. Three suspects written down in advance all failed; a fourth was
looked for and also failed. The instrument for the remaining question is built —
**`Cmd+Shift+M`**, or `scripts/mirror-mark.mjs`.

**The one measured cost no latency stage can show:** at 120 Hz each frame carries **half the bits**
(12.3 KB vs 23.8 KB, same content, same bitrate). That is the standing candidate if the marks come
back clean.

## 2 · What is owed, by what it needs

### Needs money — Apple Developer account (~$99/yr)

**Nothing about distribution moves without it**, and both artifacts are measured rather than assumed
(`docs/phase-9-distribution-audit.md`):

- the `.dmg`'s app is **ad-hoc signed**, so Gatekeeper returns an *error* rather than a verdict —
  **worse than unsigned**, because the right-click bypass does not apply (D12);
- the release APK is refused outright: `INSTALL_PARSE_FAILED_NO_CERTIFICATES` (D13).

Config for signing and notarization is written with credentials blank. This is Phase 8, and Phase 9
cannot finish before it.

### Needs a second device

- **The fit on other ratios.** Verified on the S25 only. Both Motorolas (2.22222) and the vivo
  (2.22963) are **away**. `docs/testing.md` → Slice 40 is a pre-registration with six outcomes and
  **no device has been pointed at it.**
- **Every reliability fix from Phase 6.** Whether each is a fix or a One UI workaround needs a second
  skin. `docs/phase-6-closeout.md` §2 has three rows whose route reads `None`.
- **Defect 17** means pairing a second phone costs the S25's pairing, so this is a swap each time.

### Needs neither — just time

- **Defect 103** — `LinkService` believes it is foreground forever. Cheapest real fix left;
  `MirrorService` is the worked example in the same codebase.
- **Defect 102's own reading** is done (Slice 42) but **the phone-side keyframe instrumentation from
  106 has still never run** — it needs a session after the reinstall that has now happened.
- **Camera pane** — the only unbuilt pane, correctly parked behind Phase 8.
- **The state vocabulary** — *unavailable / partial / failed / empty* — still wants one hour from the
  designer. Calls was the fifth pane to invent its own.

## 3 · One thing found while writing this, and it is a real gap

**The defect register's long-record headings have drifted from its own index.** Defect 101's heading
reads `**open**` while its table row reads *"Measured both ways, 2026-09-10"*; 63, 57 and 44 look the
same way. `scripts/check-defects.sh` says plainly that it checks **existence, not status wording** —
so this is unguarded by design, and it has now drifted far enough that **no honest count of open
defects can be given from the file as it stands.**

That audit is owed before anyone quotes a number. It is a reading task, not a code task: walk the 92
rows, make each heading agree with its row, and decide then whether a status checker is worth having
or whether two statuses in one file is the thing to remove.

## 4 · Where to pick up

1. **The marks.** The owner is using the mirror and marking. Read `[mark]` lines from
   `~/Library/Application Support/connectsuite-desktop/logs/connectsuite.log`. If they are all
   clean, the answer is the 120 Hz bit budget, not latency.
2. **The register audit** (§3). Cheap, and everything else quotes it.
3. **Defect 103**, which needs nothing but a build.
4. **Phase 8** the moment there is an Apple account.
