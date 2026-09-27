# Feature A version 3 — what production enablement still needs

> **Written 2026-09-28 (overnight), from the code at `881c7e2` plus the uncommitted work of the same
> night. Nothing here is enabled, and nothing in this file authorises enabling anything.** The contract
> is `docs/protocol.md` → Share → Version 3 (PROPOSED); the arguments are
> `docs/feature-a-multi-offer-proposal.md` rev 4; where they disagree with this file, they win.

**The question this answers:** what has to be true — in code, configuration, packaging and measured
platform behaviour — before Sidekick appears in the Android share sheet for a **multi-select** from
Samsung Gallery or My Files in a **public** build, and sends each file as its own offer to a Mac that
asks a person about each one.

**Short answer: four gates, each owned by a different kind of work, and none of them is passed.**
The code that exists is development-only by construction (debug source set, disabled component, a
one-shot debug arm on the phone, a debug switch on an unpackaged Mac). Enabling it is not a flag flip.

## 1 · Where each fence is, today (every one read from the code, not recalled)

| Fence | Where | What holds it |
|---|---|---|
| No release build claims `SEND_MULTIPLE` | `app/src/main/AndroidManifest.xml` has none | `ShareManyManifestTest` (source manifest); the packaged release manifest is re-read by `aapt2` at each build (`docs/testing.md`) |
| The several-files screen is not in a release build | `ShareManyToMacActivity` + `ShareManyToMacModel` are in `app/src/debug/` | `ShareManyManifestTest` — *the activity and its model live in the debug source set only*; release dex checked for the class names |
| Even a debug install lists no multi-file target | both debug `SEND_MULTIPLE` activities are `android:enabled="false"` | `ShareManyManifestTest` — *exactly two … both disabled* |
| The screen refuses outside a debuggable build | `ShareManyToMacModel.bind` checks `FLAG_DEBUGGABLE` | code; not JVM-reachable |
| The phone advertises `share.file 3` only when armed, only in a debuggable build, only for one handshake | `Extensions.advertised`, `ShareDevGate.v3` | `ShareDevGateTest` — *release build, arm ignored* |
| The Mac advertises `share.file 3` only unpackaged, with the `shareV3` switch, with `share.ask` open | `shareV3Activation` (`desktop/src/main/shareActivation.ts`) | `shareActivation.test.ts` |
| Every version-3 offer is held for a person — no auto-accept | `shareActivation.ts` (`share.ask` closed refuses version 3) | `shareActivation.test.ts` |
| A published file on the Mac is never replaced | `shareDestination.ts` | `shareDestination.test.ts` (including a hard-link swap) |

## 2 · Code still required

**Phone**
1. **Move the screen to the main source set** (`ShareManyToMacActivity`, `ShareManyToMacModel`), drop its
   `FLAG_DEBUGGABLE` refusal, and register it in `app/src/main/AndroidManifest.xml` **enabled**, with the
   single-file sheet's MIME types and no `text/*`. `ShareManyManifestTest`'s *main manifest claims no
   `SEND_MULTIPLE`* then has to be **replaced** by a test of the new claim — not deleted.
2. **A production path to `share.file 3`** in `Extensions.advertised` that is not the debug arm, decided
   together with the Mac's (below) so that the two cannot disagree. Today there is none, deliberately.
3. **The four open decisions of proposal §20 that change behaviour**, each needing the owner:
   the §13.3 notification (1), **Stop preparing** (3), **lifecycle option A** with `FLAG_KEEP_SCREEN_ON`
   while preparing or waiting (4) — the current `onStop` rule is a fail-closed placeholder, and
   **production values** (6): the §4 budget, the 60-minute backstop, the stall clock's 10- and 60-minute
   limits (all PROVISIONAL), and `ShareSelection.MAX_FILES = 10` (*proposed, not approved*).
4. **Finding F1 of 2026-09-28 (below)**: `ShareManyQueue.end` waits on the main thread, unbounded, for an
   `openInputStream` already under way. A slow provider (a cloud item) could stall the UI thread. Needs a
   decision before a public build, because the fix changes the §11 guarantee's wording.

**Mac**
5. **A production path to `share.file 3`** (today: unpackaged + `shareV3` only), and the same for
   `share.ask`, which version 3 requires.
6. **Stage 3, the group header** (proposal §19): header counts, `count` mismatch, *all saved* only when all
   are saved **and** confirmed. `group` is not sent by the phone yet and the Mac does not validate it (C3).

**Both**
7. **Stage 4, disconnect and restart hardening** (§19): Disconnect with files waiting and queued, ⌘Q
   mid-queue then relaunch, one phone process restart by a method named at the time (never
   `am force-stop`). Automated parts exist for the phone's queue; the rows on hardware do not.

## 3 · Configuration and packaging still required

8. **Both artifacts must be installable by someone else**, which neither is (Phase 9): the Mac `.dmg` is
   ad-hoc signed and Gatekeeper refuses it (D12); the release APK has no certificate and the platform
   refuses it (D13). `docs/phase-9-distribution-audit.md`.
9. **Version skew** has to be written down as behaviour, not assumed: a version-3 phone with a version-2
   Mac negotiates 2, and the screen then refuses several files with *"… Update Sidekick on your Mac to
   send several at once."* (`ShareManyCopy.needsVersion3`, tested). The reverse — a version-3 Mac with a
   version-2 phone — never sees `SEND_MULTIPLE` at all. `docs/versioning.md` is where the pair belongs.

## 4 · Platform measurements still required — on the SM-S938B, supervised

None of these can be produced by code, and none has been taken for `SEND_MULTIPLE`.

10. **The §11 grant readings.** The instrument now exists (`ShareManyGrantProbeActivity`, debug only,
    disabled, 2026-09-28) and is proven only as an instrument, by JVM tests. On the phone it answers:
    - how Samsung Gallery and My Files deliver a multi-select — `EXTRA_STREAM`, `ClipData`, both, and
      whether every stream is in the `ClipData` (the grant is over the `ClipData`'s URIs);
    - whether the grant outlives a **stopped, unfinished** screen (+1 s, +30 s) — the fact that decides
      whether lifecycle option B could ever be considered;
    - whether it survives a **recreation**, and whether it outlives the **finished** screen
      (+1 s, +30 s, +120 s).
    **My Files is the discriminating source.** Gallery rows are `CONFOUNDED` while Sidekick holds a media
    permission, unless the owner approves revoking it for the run (§19 approval 6).
11. **Run A's remaining steps (A1 with two different files, A2–A4) and Run B (B1–B3)** from
    `docs/feature-a-v3-supervised-runbook.md` — the first time the review screen is ever drawn.
12. **§19 Stage 2's hardware rows**: 3 synthetic images from Gallery, 1 synthetic PDF and 1 synthetic file
    larger than that day's measured `min(Bq, Bs)` from My Files, so waiting for room is seen live.
13. **A second device or skin.** Every reading here is one SM-S938B (`docs/single-device-audit.md`). The
    share sheet, DocumentsUI and Gallery are all vendor- or Play-updated.

## 5 · Why no production gate was added tonight

A constant such as `MULTI_FILE_PRODUCTION = false` would gate **nothing**: there is no main-source-set
screen for it to switch on, so it would be a flag that reads as a fence and fences nothing (CLAUDE.md,
*a check that does not gate the action is decoration*). The fences in §1 are structural — a class that
is not in the release build cannot be turned on by a value — and that is stronger than a flag. The
gate belongs in the same change that moves the screen to `main`, where it can be tested against the
thing it gates.

## 6 · Findings from the 2026-09-28 overnight review (not fixed)

- **F1 — an unbounded main-thread wait.** `ShareManyToMacActivity.onStop` → `screenClosed` →
  `ShareManyQueue.end`, which takes the open gate and so waits for any `Env.open` under way. That is by
  design (so no URI is opened once `end` returns), and it is tested. The wait has no bound. With the
  local providers on this phone an open is quick; with a provider that fetches on open it is not known.
  Fix direction: bound the wait and rely on the existing *closed unread* path for an open that returns
  late — which changes §11's sentence from *"no open is running when `end` returns"* to *"no open starts
  after `end` begins, and any that returns late is closed unread"*. **The wrong fix:** moving `end` off the
  main thread without a bound — the screen would then finish while an open is still under way, with
  nothing saying so.
- **F2 — the single-file grant probe's timing.** `ShareGrantProbeActivity` schedules its readings with
  `Handler.postAtTime(elapsedRealtime + offset)`, but `postAtTime` counts `uptimeMillis`, which stops in
  deep sleep. Readings can fire late; each line prints the true elapsed time, so past readings are
  mislabelled in offset, not wrong. The new `SEND_MULTIPLE` probe uses `postDelayed` from the event's own
  instant. Not changed: that probe is not tonight's scope.
- **F3 — `offerStaged(onlyOnSession = …)` is reached by no JVM test directly.** The queue's session pin
  is tested (`ShareManyQueueTest`, three tests, two mutations); the matching refusal inside
  `ShareFeature.offerStaged` needs a `LinkServer` and is reached only on hardware.
