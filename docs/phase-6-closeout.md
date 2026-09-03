# Phase 6 close-out — background reliability on One UI

> ## ✅ **PHASE 6 IS CLOSED — 2026-09-03.** Phase 7 continues.
>
> **It is closed against an honest accounting, not against a pass list, and the difference is the
> whole content of this file.** Seven behaviours are claimable on one handset with a control each.
> Seven are hypothesis — and **three of those have no route on this device at all**, which is a
> different and more important statement than *not done yet*.
>
> **The closing condition, written here because the brief never wrote one.** That is itself worth
> saying: Phase 5 closed against two conditions fixed in advance, and `docs/phase-6-brief.md` set
> none, so this file is defining the bar after seeing the results — the shape this repository
> normally refuses. It is stated plainly rather than dressed up, and it is deliberately not
> *"everything works"*:
>
> > **Every Phase 6 question with a route on this handset has been taken, and every remaining one
> > carries its route or the word `None`.**
>
> Ten of eleven slices ran; fifteen defects closed; the three `None` rows are each blocked on a
> second device or on somebody's phone being left degraded for days. **Holding the phase open would
> make its state depend on a purchase decision (H5), which is not a phase state — it is a shopping
> list, and it already has a file.**
>
> **The one thing a reader must not do is quote the first table without the second.** A reliability
> fix that only works on one OEM fails **silently, everywhere else** — the one failure mode nothing
> in this build can catch.

The evidence is `docs/testing.md` → **Phase 6 Slices 1–11**. The defect index is `docs/defects.md`.
The brief, whose §6 this file promotes and supersedes, is `docs/phase-6-brief.md`. The
single-device caveat behind every row is `docs/single-device-audit.md`.

---

## The sentence to ship with

> **Phase 6's fixes are proven on one Samsung handset and are hypotheses everywhere else.** The boot
> path, the Doze survival, the wake lock and the crash recovery were each observed with a control on
> an SM-S938B running One UI on Android 16. None has been seen on a second vendor, on stock Android,
> on a phone in a low standby bucket, or on a phone left alone overnight. Battery management is the
> most vendor-specific surface on Android, so the gap between "works here" and "works" is wider in
> this phase than in any before it.

**That sentence is the deliverable, not an apology for one.**

---

## 1 · What is claimable

Each row was observed on hardware **with a control**. Each carries the single-device caveat above.

| # | What is claimable | What proved it | The control |
|---|---|---|---|
| **C1** | **The link returns after a restart, with nothing tapped** | Slice 6 — a real boot with the notification-listener grant revoked: `startOrLog` reached for `BOOT`, `Foreground as BOOT, types=0x10`, three ports bound 77 ms later, the Mac back in 5.6 s | `LISTENER_REBIND lines since boot: 0` — the competing route removed, not merely outrun |
| **C2** | **…and after an app update** | Slice 1 — `MY_PACKAGE_REPLACED` on `adb install -r`, listening 1.5 s later, and again on every install this phase | The install itself; repeated across the phase |
| **C3** | **A deep-Doze transition does not drop the link** | P2 (exempt) and Slice 8 (unexempt) — listeners 4/4, one session, `deep=IDLE` | **A message that actually crossed** at `deep=IDLE`, 16 s in. `ESTABLISHED` is a socket record, not a live session |
| **C4** | **A crash does not leave the phone serverless** | Defect 62, Slice 2; Slice 10 measured `START_STICKY` winning by 16 ms | `am crash` produced *both* outcomes 49 s apart — a silent kill and a modal with the process alive. The fix was tested against the one that failed |
| **C5** | **The wake lock does not lapse** | Defect 61, overnight — re-armed **before** its timeout rather than repaired after | The first fix measured **59m49s against a 60-minute timeout**: eleven seconds from a nineteen-minute gap. Three mutations red, including the 59-against-60 edit a naive `REARM < TIMEOUT` would pass |
| **C6** | **The phone does not silently overwrite a clipboard it cannot report** | Slice 7, defect 79 — refused at `granted=false`, applied at `granted=true`, refused again after restoring | Both directions, and the restore. Deliverability is a **precondition of the write**, not a check after it |
| **C7** | **`media.thumb` tells a corrupt photo from a deleted one** | Slice 11, defect 57 — `31 made / 0 gone / 1 undecodable` on a deliberately corrupt JPEG | The corrupt file was **written to `Download/ConnectSuite`**, a grant-free root of our own — nothing of the owner's was touched, which is why the deferral expired |

---

## 2 · What is hypothesis — with the route, or with `None`

**This is the table that matters.** It is not a to-do list. Three rows have no route on this device,
and saying so is the finding.

| # | Not settled | Why | Route here? |
|---|---|---|---|
| **U1** | **Whether any Phase 6 fix is a fix or a One UI workaround** | The load-bearing one. Every row in §1 is one vendor's behaviour. Two skins agreeing makes a behaviour general; disagreeing names the vendor — and nothing here has a second skin | **None.** Second device. The Realme that briefly made this answerable is gone |
| **U2** | **The unexempt *and neglected* case** | H1 removed the Doze exemption. It did **not** make the app unused: the bucket stayed `ACTIVE` throughout, and the harsh restrictions live in `RARE`/`RESTRICTED`. Unexempt and unexempt-and-neglected are two experiments; only the first ran | **None.** P6 is withdrawn — the shell can leave `EXEMPTED` and `am set-standby-bucket … 5` is refused, so there is no command that puts it back on a daily driver |
| **U3** | **Samsung's own battery layer** | Device Care's *Sleeping apps* / *Deep sleeping apps* are not readable from `adb` — the state lives in `com.samsung.android.sm`'s private storage. **Asked for on 2026-09-03 and never answered** (the reply came back an unfilled template), so this repo does not know whether the app is in them, before H1 or after | Owner's eyes only — H2. It is the one outcome that undoing H1 does not undo |
| **U4** | **Battery cost** | Needs an unplugged night. It is also the only route to **P3**, whose three instruments disagree about the same wake lock — so this project quotes **no aggregate** | Owner's time — H3 |
| **U5** | **Defect 80's start half** | `ACCESSIBILITY_BIND` has fired three times and started the link **zero** times, each behind a faster route. Fixed and wired; the branch is unexercised | **Yes** — stop `LinkService`, then kill, with the listener revoked. Needs a debug affordance |
| **U6** | **Doze as it actually happens** | Every Doze reading is `force-idle`: a forced transition with USB attached, not an observed descent through the staged states with maintenance windows | Partly — H3 |
| **U7** | **Defect 17 — two phones** | The Mac holds one phone structurally and refuses the second rather than evicting it. Deferred since Phase 4 | **None.** One phone |

---

## 3 · What the phase built

Fifteen defects closed, one fixed with its start half explicitly unclaimed.

| Group | Defects | Note |
|---|---|---|
| **The start routes** | **60** (`LinkBootReceiver`), **64** (the boot path had never started anything), **77** (`BOOT` and `QUICKBOOT` shared one reason name), **80** (`ACCESSIBILITY_BIND` is a start route and nothing followed it) | 80 is **fixed with the start half unproven**, and says so |
| **Staying alive** | **61** (the wake lock was never re-armed), **62** (a crash left the phone alive, granted and serverless) | Both corrected twice; the second version is the one that matters in each |
| **Telling the truth about counts** | **51** (an after-send retry reporting a loss it does not suffer), **52**, **53** (one `dropped` counter for three causes; two Mac call refusals moving a counter with no line) | All three are the denominator rule, unfixed in three places |
| **Saying which thing failed** | **57** (`media.thumb` answered `NOT_FOUND` for a photo that was there), **79** (the phone replaced a clipboard it could not report) | 57 is the sharpest defect this project has found — four idiomatic lines, no one of which review would flag |
| **Copy people read** | **69**, **71** (a permission whose copy described another feature; *Sync* naming two things), **33** (package ids in sentences) | `app/src/test` exists now, so these were testable where defect 65's was not |
| **The instruments** | **78** (`defect64-read.sh` reported 549 lines against 64 real — an 8.5× denominator over a **correct** verdict) | A control wrong in the *safe* direction. It is its own `CLAUDE.md` entry now |

**Carried out of the phase, none of it blocking:** **17** and **38** stay deferred, **30**'s
no-thread half stays open, and **80**'s start half is named above with its stimulus.

---

## 4 · The three readings worth more than the fixes

1. **The instrument's own state contaminating the reading, in the phase where it costs most.** §0 of
   the brief: this handset is **already exempt** from battery optimisation, and it is not an accident
   — onboarding asks for it and it was granted. A Phase 6 that opened by running the app overnight
   and reporting *"it survived"* would have reported the exempt case as the general one. The control
   was `grep -c '^user,'` → **10**: ours is one of ten, beside Samsung's own launcher.

2. **A route is invisible when nothing in your source code is its call site.** Defect 80's run
   removed two competing start routes and still lost to a third — **`START_STICKY`**, which is a
   *return value*, arrives with a null intent, and reported itself as `UNKNOWN`. Grepping your own
   code for start routes finds the routes **you wrote**. The enumeration has to run the other way:
   *what can cause this process to exist at all*, asked of the platform.

3. **A control wrong in the safe direction is worse than no control.** Defect 78 inflated its
   denominator 8.5× while every counted number stayed correct and the verdict stayed right. Nobody
   audits a control for being too *generous* — a generous control cannot produce a false pass in the
   direction anyone is watching. It produces false confidence, invisible until the day the verdict
   is wrong.

All three are in `CLAUDE.md` rather than only here, because a rule with no enforcement point is a
rule someone remembers.

---

## 5 · Suite at close

| | |
|---|---|
| Phone | **389** — `app` 11, `core` 108, `input-module` 44, `mirror-module` 38, `sync-module` 188 |
| Mac | **322** |
| Failures | **0**, both sides |
| `tsc --noEmit` | exit 0 |
| Commit hooks | `check-defects.sh`, `check-protocol-spec.mjs`, `check-apps-verb.mjs`, `check-clip-echo.mjs`, `check-renderer-views.mjs` — all pass |

Read on a `--rerun-tasks` build, **`gradle exit: 0`, results files 9–21 s old** — because a
`failures=0` from a build that never compiled is the most confident wrong answer in the set, and
this project has already published one.

`app/src/test` contributing **11** rather than zero is the visible part of defect 65's structural
fix: at the close of Phase 5 the phone's total was quoted as a sum over **two** of five modules.

---

## 6 · What Phase 7 inherits

- **Nothing blocking.** Every §2 row is a measurement this handset cannot take, not a feature that
  does not work.
- **Three things needing your hands, none urgent**: H2 (one Settings screen, still unanswered),
  H3 (one unplugged night, which also unblocks P3), and U5's debug affordance.
- **One purchase decision, H5**, now better informed than the brief's guess: the shape is three
  instruments — **this Samsung** for the product, **a second skin** for *is this vendor-specific*,
  and **an emulator** for *is this AOSP*. A cheap Pixel remains the right buy and is now the third
  priority rather than the first.
- **`docs/protocol.md` is untouched by this phase**, as intended. No reliability fix needed a wire
  change.
