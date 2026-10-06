# Stage D — supervised clipboard verification, 2026-10-07 01:11–01:42 IST: **PARTIAL**

Sanitized record, written 2026-10-07 overnight from the stage's working notes (§9.10 of
`docs/supervised-verification-plan-2026-10-06.md`, which is still uncommitted in the owner's working tree and
was not edited). **No clipboard content, marker text, notification text, QR material, token or fingerprint is
in this file.** Markers are named by label only. Where this record and §9.10 differ, this record is the later
reading, and the differences are listed at the end.

**Stage D is PARTIAL, not passed.** Steps 1, 2 (the offer), 4 and 5 passed; step 3 was not runnable; step 6
did not start a send and its cause is **inconclusive**; steps 7 and 8 were not run.

## Builds and preconditions (unchanged from the stage notes)

| | |
|---|---|
| Mac | `desktop/dist` from `4661015`, manifest `bb594168…`, PID 67469, launched with the verification flags |
| Phone | debug APK from `286e2b0`, `5f014e9e…30ad`, user 0 |
| Pairing | **v2** on both sides (stage B, 2026-10-06 23:57); manual Disconnect/Connect passed (C step 2, 00:14) |
| Mac clipboard watcher | **off** (setting `false`, IPC `watching=false`) throughout |
| Owner confirmation | both clipboards held only harmless test text before the stage |

## Results

| Step | What was done | What was observed | Verdict |
|---|---|---|---|
| 1 | M-BASE put on the Mac clipboard | equal to M-BASE (equality helper prints only *equal / not equal*); 0 `[clipboard]` lines — watcher off, nothing sent | **PASS** |
| 2 | Owner selected M-OFFER-1 in a notes app and chose **Send to Mac**; Sidekick not frontmost | phone: `clip.push → Mac via selection (origin selection)`, 10 bytes; the activity's route line read **`ACTION_SEND`**; Mac: `Offered an arriving entry (origin selection): 10 bytes, NOT applied`; Mac clipboard still M-BASE; pane: one pending offer | **PASS — for the share-sheet route (`ACTION_SEND`) only** |
| 2 — banner | owner saw no banner | macOS unified log: Electron `Adding notification request`, then `usernotificationsd … addRequest not allowed: com.github.Electron` 9 ms later. The development Electron bundle is refused by macOS; Sidekick's own log said nothing about the banner (defect 195, fixed in source since) | **banner unavailable — macOS refused the notification** |
| 3 | click the banner | there was no banner to click; macOS notification permissions were **not** changed | **NOT RUNNABLE** |
| 4 | **Copy** on the M-OFFER-1 offer (row selected by exact equality inside the page; selection re-checked in the click) | `Applied an arriving entry … 10 bytes, previous clipboard captured`; Mac clipboard equal to M-OFFER-1; one displaced entry | **PASS** |
| 4 — duplicate | a second Copy on the consumed offer through the same bridge call (the pane drew **0** Copy buttons) | `ok:false`, *"That offer is no longer waiting — … Nothing was copied now."*; `Refused a Copy on an offer … nothing written`; clipboard still M-OFFER-1 | **PASS** |
| 5 | **Restore** on the displaced row | `Restored a displaced entry: 11 bytes`; Mac clipboard equal to M-BASE | **PASS** |
| 6 | Owner selected M-OFFER-2 and chose **Send to Mac** (01:21) | no arrival: Mac 0 `[clipboard]` lines, phone 0 `clip` lines, no Sidekick activity in usage stats after 01:13:50 | **no send started** |
| 6 — one diagnostic retry (owner-authorised) | M-OFFER-2 typed into a new blank note by a pinned `input text` (verified equal); long-press inside the field (point derived from the field's bounds); the owner reported **Send to Mac** present in the selection toolbar and tapped it once | logcat since 01:35:50 — 23,120 lines, **0** mentions of `SendSelectionActivity` or `PROCESS_TEXT` (control: the step-2 window of the same buffer held **42**); usage stats — no Sidekick activity resumed (control: the 01:13:50 start is listed); phone 0 `clip` lines; Mac 0 offers | **INCONCLUSIVE** — see below |
| 7, 8 | — | — | **NOT RUN** |

**Instrument controls held throughout:** every Mac log read printed the lines read and a count of marker
strings found in the log — **0** throughout; no marker reached either app's log.

## Step 6: what is and is not established

**Established.** No start of `SendSelectionActivity` reached the platform's activity log in the retry window,
by a query that found 42 such mentions in the step-2 window of the same buffer. Nothing was sent; nothing
arrived on the Mac.

**Inconclusive between two places, before the activity:**

- **(A) the selection-toolbar action did not dispatch** — the tap did not produce a start request; or
- **(B) a start was requested and not delivered** to `SendSelectionActivity`.

The instruments could not separate them. The selection toolbar is a separate popup window; on this build
`uiautomator dump` reads the active window only and `dumpsys activity top` does not describe the popup, so the
toolbar's items — including which item was under the tap — **were never seen by any instrument**. That is a
limitation of the instruments, not a finding about the tap or about the person who made it.

**Not established, either way:**

- **That step 6 exercised the `PROCESS_TEXT` route at all.** Step 2's success arrived as `ACTION_SEND` (the
  share sheet). Step 6 was a toolbar selection. The two are different senders with different extras; step 2
  is **no evidence** that the toolbar route works, and step 6 is no evidence that it does not.
- **Anything about the paths after the activity** (phone → Mac delivery, the Mac's offer handling and
  drawing). Step 6 never reached them, so it neither implicates nor clears them. They were exercised
  successfully once, in step 2, for the share route.
- **Any cause.** Nothing in the code read overnight explains a start that never reached the activity log.
  One defect found on the share route (192: `EXTRA_TEXT` read as `String`) cannot produce step 6's
  observation, because it acts only after the activity has started.

## Stop condition

At 01:40 the Mac clipboard matched **none** of the five markers, with **0** Sidekick clipboard log lines
since step 5 — something outside Sidekick replaced it after 01:23. It was **not read, printed, snapshotted,
cleared or restored**. Clipboard checks stopped there.

## Instrument faults caught during the stage (none reported in faulty form)

- The phone-log count used `$1 >= t`, admitting untimestamped continuation lines (defect 78's shape): *245
  since 01:21:17* was really **1**. Step 2's count of 249 was inflated the same way; its presence reading
  stands because the matching lines themselves were printed.
- The Restore selector matched the row's source label rather than its body; it threw before any click.
- In zsh, `log` is a builtin; `/usr/bin/log` was needed — caught by a control returning 0.

## Left on the devices after the stage

A note in the owner's notes app containing M-OFFER-2 (the owner's test note); the Mac clipboard holding
non-marker content not written by Sidekick; Sidekick's in-memory history holding the stage's entries until
the next disconnect. Watcher off; both rollback copies and the Activity backup unchanged.

## Still unverified after stage D

C step 3 (phone Wi-Fi off/on), H4b (pairing cancellation), the banner click, the toolbar (`PROCESS_TEXT`)
route end to end, steps 7–8 (Dismiss; one focus sync with M-SYNC-1), stages E and F. A4's missing startup
clipboard event (2026-10-06 23:28) remains **unexplained**; defect 193 makes the next one diagnosable and
explains nothing about that one.

## Differences from the stage notes (§9.10)

1. §9.10 says *"C (phone→Mac delivery) and D (Mac rendering/notification) are ruled out: nothing was sent."*
   **Superseded.** Step 6 did not reach those paths, so it neither rules them in nor out.
2. §9.10's step-2 row is a pass without naming the route. **Stated here:** it passed for `ACTION_SEND` only.
3. §9.10 classifies step 6 as *FAIL*. **Here:** no send started, and the cause is inconclusive between the
   toolbar action and its delivery, with the instrument limitation that leaves it so.
