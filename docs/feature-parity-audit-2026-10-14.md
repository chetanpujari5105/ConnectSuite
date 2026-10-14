# Feature parity audit — Android app, Mac app, development build, packaged DMG (2026-10-14)

> **Read-only audit. Nothing was built, flipped, installed or launched to write it.** Every row was read from the
> code at `9aade5c` and from the evidence records it cites. Sources: `PRODUCT.md`, `docs/protocol.md`,
> `docs/permissions.md`, `docs/release-inventory.md` (2026-09-29), `docs/defects.md`, `docs/testing.md`, and the
> gate constants themselves.
>
> **Marks used on every claim:** **[V]** verified — read from code at `9aade5c`, or a dated hardware reading is
> cited; **[U]** unverified — nobody has observed it; **[A]** assumed — an estimate or inference, stated as one.
>
> **The one limit that applies to every "packaged" column below:** no packaged Sidekick has ever been launched —
> not on the owner's account (defect 207) and not on a fresh macOS user (`docs/release-candidate-2026-10-14b.md`:
> *"The packaged app has not run"*). So what the DMG **shows** is read from its code and from the static checks of
> RC `bcb92ec`; none of it has been seen on a screen. **[U]** for every on-screen claim about the DMG.
>
> The full owner specification for this audit, given in an earlier session, was not in any file this session
> could read. This document follows the summary in the 2026-10-14 away-mode instruction: per-feature status on
> each side, packaged-build visibility with every release gate named, the Photos pane (save to Mac, video play),
> gaps with build / hide / label options, effort and risk, and a three-tier v1 proposal — plus the owner's
> addition, the development-versus-DMG list (§3).

## 1 · Every release gate, both sides

A **gate** here is anything that makes a development build and a release/packaged build behave differently. All
values read from code at `9aade5c` **[V]**. None was changed by this audit.

### 1.1 Constants (the ones an owner would flip)

| Gate | Side | Value | What it holds back | Its twin |
|---|---|---|---|---|
| `SHARE_V3_RELEASE` | Mac `src/main/shareActivation.ts:98` | `false` | Several files per phone share (`share.file` 3) | `Extensions.MULTI_FILE_RELEASE` |
| `MULTI_FILE_RELEASE` | Phone `core/.../link/Extensions.kt:60` | `false` | Same; also the phone's **multi-select share-sheet entry** via `@bool/share_many_enabled` (`false` in main, `true` in debug res) | `SHARE_V3_RELEASE` |
| `SHARE_WAIT_RELEASE` | Mac `shareActivation.ts:104` | `false` | 30-minute waiting share offers (`share.wait`); without it offers wait 10 minutes | `Extensions.WAIT_RELEASE` |
| `WAIT_RELEASE` | Phone `Extensions.kt:69` | `false` | Same | `SHARE_WAIT_RELEASE` |
| `FS_BLOCKS_RELEASE` | Mac `src/shared/extensions.ts:32` | `false` | Block-verified, resumable Files pulls **above 64 MiB** (`fs.blocks`); without it those pulls arrive **not checksummed** (defect 187) | `Extensions.FS_BLOCKS_RELEASE` |
| `FS_BLOCKS_RELEASE` | Phone `Extensions.kt:79` | `false` | Same | Mac `FS_BLOCKS_RELEASE` |
| `WEBCAM_RELEASE` | Mac `src/shared/webcamWire.ts:87` | `false` | Camera v2 — the phone as a Mac webcam (`ext.webcam`, the camera bridge) | `Extensions.WEBCAM_RELEASE` |
| `WEBCAM_RELEASE` | Phone `Extensions.kt:95` | `false` | Same; `WebcamFeature.install` installs nothing in a release build | Mac `WEBCAM_RELEASE` |
| `CameraReleaseGate.allows(debuggable) = debuggable` | Phone `camera-module/.../CameraFeature.kt:23` | **no constant at all** | Camera v1 — the live preview in the Mac's Camera pane. A release phone never installs it. Lifting it is a code change to this function, not a flag | **none on the Mac** — the Mac's Camera pane is ungated |
| `PRODUCTION_TRANSFER` | Phone `Extensions.kt` | `true` (already on) | Single-file phone → Mac share (version 2) to every trusted Mac | Mac `SHARE_PRODUCTION_READINESS` (both readiness facts `true`) |

### 1.2 Development-only switches and build facts (not meant to ship, listed so nothing is missed)

| Gate | Side | In a packaged/release build |
|---|---|---|
| `CONNECTSUITE_DEBUG_SWITCHES` — 18 names (`src/main/debugSwitches.ts`) | Mac | Every one is ignored or forced off by `main.ts` when `app.isPackaged` **[V]**. Twelve are test-only (stall/bypass/probe switches); the six that unlock a *feature* are in §3 |
| `callBanner` switch | Mac `main.ts:261` | Forced off. The incoming-call banner **does not exist** in a packaged build |
| `skipTrial` switch | Mac `main.ts:1008` | Ignored. A packaged build **always** checks the beta token (`trialEnforced`) |
| `keychainNotice` switch | Mac | Not needed: a packaged build shows the Keychain notice on every fresh profile |
| Refused command-line switches (`src/main/releaseGuards.ts`) | Mac | A packaged app exits on `--remote-debugging-port`, `--inspect`, `--js-flags` and six more |
| Developer menu items (Reload, Toggle Developer Tools) | Mac `appMenu.ts`, `main.ts:1297` | Hidden (`showDeveloperItems: !app.isPackaged`) — defect 126's fix |
| Debug-only IPC (`fs.stat` by id, the resume exerciser) | Mac `preload.ts:582,598` | Answered by main only when unpackaged |
| `FLAG_DEBUGGABLE` | Phone, 10 files | Camera v1, Camera v2, multi-file share, `share.wait`, `fs.blocks`, the defect 205 wake-lock measurement markers, the share debug-corruption hook, `ShareDevGate` |
| `app/src/debug/` source set — 21 probe/dev activities | Phone | Absent from a release APK: `ClipProbeActivity`, `SafProbeActivity`, `ShareDevV2/V3Activity`, `DesignPreviewActivity` and the rest. Tools, not features |

## 2 · Feature matrix

**Status words:** *built* · *partly built* (built with a named part missing or open) · *not built* · *deferred* (a
recorded decision to wait) · *unsupported* (a platform wall — permanent, stated in `CLAUDE.md` → Platform walls).

**Packaged DMG column** = what a packaged Mac paired with a **release** phone shows, read from code **[U on screen]**.

| # | Feature | Phone | Mac | Packaged DMG (with a release phone) | Evidence |
|---|---|---|---|---|---|
| 1 | Pair once by QR, TLS 1.3, pinning | built | built | same as development | RDV Phase 1; pairing v2 **[V]** |
| 2 | Discovery and auto-reconnect (last IP → gateway → mDNS → manual) | built | built | same | RDV Phase 1, step 71 **[V]** |
| 3 | Beta token trial | — | built | **always enforced**; development skips only with `skipTrial` | `trial.ts`; RC `bcb92ec` static check **[V]**; packaged screen **[U]** |
| 4 | Notifications: mirror, reply, actions, dismiss | built | built | same | RDV Phase 4 **[V]** |
| 5 | macOS system notifications (banner when the window is not in front) | — | built | **only the packaged build can show them**; the development run is refused by macOS by design (`nativeNotify.ts` `refusalCopy`) | never seen working anywhere **[U]** |
| 6 | Incoming-call banner on the Mac | — | built, development-only | **absent** — forced off; no UI names it | "not yet verified on hardware" (`debugSwitches.ts`) **[U]** |
| 7 | SMS/MMS threads, send, new conversation | built | built | same | RDV step 71 **[V]**; **partly**: defect 30's no-thread half open; **MMS sending unsupported by design** (`protocol.md` ~1780) |
| 8 | Calls: events, dial, answer/reject, log, keypad | built | built | same | RDV step 70 **[V]** |
| 9 | Call **audio** on the Mac | unsupported | unsupported | — | wall, `docs/mac-audio-routes.md` §7–9 **[V]** |
| 10 | Contacts | built | built | same | RDV **[V]** |
| 11 | Media remote / Now Playing | built | built | same | RDV; **partly**: defect 38 (phone volume never reaches the Mac) deferred |
| 12 | Clipboard both ways + history + Restore | built | built | same | RDV Slices 11–13 **[V]**; phone → Mac only while the phone app is open — **unsupported** to automate (wall) |
| 13 | Send selected text from any app (`PROCESS_TEXT`) | built | built | same | RDV Phase 7 Slice 21 **[V]**; apps with their own selection bars unreachable (wall) |
| 14 | Files: browse granted folders, pull, push, resume, same-name safety | built | built | same, **except pulls above 64 MiB arrive not checksummed** and say so | RDV F-1…F-5 **[V]**; defect 187 open |
| 15 | Files: block-verified pulls above 64 MiB (`fs.blocks`) | built | built | **absent** (`FS_BLOCKS_RELEASE` both sides) | development-only by owner decision 2026-09-29 |
| 16 | Files: drag to Finder | — | built | same | RDV Phase 5 Slice 9 **[V]** |
| 17 | Photos browser, preview, Save to Mac, video play | built | built | same — see §4 | RDV Feature C 2026-09-23 **[V]** |
| 18 | Photos: **drag to Finder** | — | **not built** | absent | `renderer/photos.ts` has no `draggable`/`dragstart`; the only drag-out is Files' `fs-drag` **[V, by grep]**. Corrects `release-inventory.md` H-1 |
| 19 | Screen mirror + floating window | built | built | same | RDV Slices 43–53a **[V]**; consent tap each session and FLAG_SECURE black — **walls** |
| 20 | Control the phone from the mirror (tap, swipe, text, back/home/recents…) | built | built | same | RDV Phase 3 **[V]**; arbitrary keys and power button — **unsupported** |
| 21 | Apps: list, icons, open on phone (ask + one tap) | built | built | same | RDV 123/123 **[V]**; direct launch — **unsupported** by measurement (`apps.launch` absent) |
| 22 | Phone → Mac share, one file | built | built | same | RDV 2026-09-25 **[V]** |
| 23 | Phone → Mac share, **several files** (v3) | built | built | **absent**: the release phone's multi-select share entry is disabled, and the packaged Mac advertises version 2 | RDV in development builds 2026-09-29 **[V]**; gated |
| 24 | Share offers wait 30 minutes (`share.wait`) | built | built | **absent** — offers wait 10 minutes | development RDV; the 30-minute expiry itself not watched on hardware **[U]** |
| 25 | Very large share beyond the phone's free space ("Path L") | not built | not built | — | proposal only, `docs/feature-a-large-file-proposal.md` |
| 26 | Overview: device status (battery, storage), recent activity, Send files | built | built | same | RDV **[V]**; `net.state` is on the protocol debt list (no handler either side) |
| 27 | Activity history | — | built | same | screenshot-level only **[U]** as a whole |
| 28 | Settings, light/dark/System theme | — | built | same | Slice 55 **[V]**; five panes owe a light check |
| 29 | Camera v1 — live phone camera preview **in the Camera pane** | built, **debuggable builds only** | built, **ungated** | the pane is reachable and draws *"Your phone is not offering its camera"* with the **phone's developer sentence** as the reason (see §5, gap G2) | RDV in development **[V]**; packaged screen **[U]** |
| 30 | Camera v2 — the phone as a **Mac webcam** (Sidekick Camera) | built, development-only | partly built (bridge built; the signed Camera Extension does not exist) | the "Use as webcam" section reads *"Not available on this Mac yet — Using the phone as a webcam is not in this build of Sidekick yet."* | encoder spike 2026-10-04; extension needs Developer ID **[V]** |
| 31 | Microphone (phone mic as a Mac input) | not built | not built | — | spec only (`protocol.md` → Microphone); gated on signing |
| 32 | More than one phone per Mac | — | deferred | — | defect 17 |
| 33 | Use outside the local network | unsupported | unsupported | — | out of scope; Tailscale documented as optional |
| 34 | USB connection | not built | not built | — | the LinkMyMac target names it; no ADB is a locked decision. A USB-tethered phone *may* reach the Mac as a gateway — **[A]**, never tested |
| 35 | Phone set-up, Connect a Mac, Transfers, Folders screens | built | — | — | RDV Android UI pass **[V]** |
| 36 | Link survives reboot, Doze, updates | built | — | — | Phase 6 close-out **[V]**, single OEM |
| 37 | Open-source notices / licences screen | not built | not built | — | required before release (`release-policy-addendum` §5) |
| 38 | "Remove all data" on the Mac | — | not built | — | suggested by the privacy-policy skeleton |
| 39 | Accessibility: VoiceOver walk / TalkBack pass | not verified | not verified | — | no standard chosen (`PRODUCT.md`) **[U]** |
| 40 | Intel Mac build | — | built | the x64 app has **never run** | RC `bcb92ec` **[V]** |

## 3 · Works in the development build, missing / hidden / disabled in the DMG

This is the owner's added question: **everything reachable with the debug switches and development gates on that
a packaged DMG does not have**, with the gate or reason. Nothing here was flipped or built tonight.

| # | Feature | In development | In the DMG | Gate / reason | What the DMG user sees |
|---|---|---|---|---|---|
| D1 | **Several files per share** (phone → Mac) | works with a debug phone (RDV 2026-09-29) | absent | `SHARE_V3_RELEASE` (Mac) + `MULTI_FILE_RELEASE` / `share_many_enabled` (phone) | Sidekick is **not listed** in the phone's share sheet for a multi-file selection. No sentence anywhere — the share sheet is Android's, there is nowhere on the phone or the Mac to put one |
| D2 | **30-minute waiting offers** | works | absent — 10 minutes | `SHARE_WAIT_RELEASE` + `WAIT_RELEASE` | Nothing missing on screen; the offer card states its own deadline either way |
| D3 | **Checksummed Files pulls above 64 MiB** | works | absent | `FS_BLOCKS_RELEASE` both sides | the saved row says it was **not checksummed** (defect 187's fix) — explained |
| D4 | **Camera v1 preview** | works with a debug phone | works only with a **debug** phone; a release phone never offers it | `CameraReleaseGate` (phone, no constant) | the Camera pane says *"Your phone is not offering its camera"* plus the phone's raw reason `not built yet — waiting on camera.request, camera.stop, camera.switch, camera channel unserved` — **explained, but in developer words and inaccurate for a user** (G2) |
| D5 | **Phone as a Mac webcam** | the bridge runs with `webcamDev` (+ `webcamSpike` for the spike) | absent | `WEBCAM_RELEASE` both sides; also needs the signed Camera Extension | *"Not available on this Mac yet — Using the phone as a webcam is not in this build of Sidekick yet."* — explained |
| D6 | **Incoming-call banner** | works with `callBanner` (never verified on hardware) | absent | `callBanner` forced off when packaged | nothing — no control or copy anywhere names it, in either build. Not a broken promise, so no label owed |
| D7 | **Use without a beta token** | `skipTrial` | impossible | `trialEnforced` | the beta token screen (by design) |
| D8 | **Pairing decoy test path** | `pairDecoyFirst` | absent | test-only | nothing (correct) |
| D9 | Error-path test switches — `stallRemoved`, `bypassReplyGuard`, `bypassRemoteGuard`, `forceRecipientMismatch`, `stallCallEnded`, `delayFloatListeners`, `shareOmitExt`, `shareSilent`, `shareAcceptProbe`, `shareDevReceive`, `shareV2`, `shareV3Off` | available | absent | test-only; several **weaken guards** | nothing (correct — none of these should ever ship) |
| D10 | Developer menu, DevTools, CDP port, debug IPC | available | absent | `app.isPackaged`, `releaseGuards.ts` | nothing (correct) |
| D11 | Phone probe and dev activities (21) | in a debug APK | absent from the release APK | `src/debug` source set | nothing (correct) |

**The reverse direction, for completeness — the DMG has what development lacks:** macOS banners (row 5), the
Keychain notice on a fresh profile, the enforced beta check, the refused-switch guard, ASAR integrity and the
quarantine key on received files.

**Candidates for "build into the final DMG" are D1–D6 only.** D7–D11 are guards or tools and should stay out.
Owner's call for each of D1–D6 is in §6.

## 4 · The Photos pane — save to Mac and video play

| Part | Status | Evidence | Packaged |
|---|---|---|---|
| Grid of albums and items, paging, return refresh | built | RDV; defect 212 fixed 2026-10-10 **[V]** | same **[U on screen]** |
| 512 px preview, labelled as a preview; original fetched after 350 ms for images ≤ 40 MB | built | Feature C 2026-09-23: *Original · 3000 × 4000* on a synthetic JPEG **[V]** | same |
| **Save to Mac** | built | RDV 2026-09-23 on that JPEG: only the saved photo reached `~/Downloads/Sidekick`; viewed originals stayed in the 0700 cache **[V]** | same; a save **above 64 MiB** says it was *not checksummed* (defect 187) |
| **Reveal in Finder** after a save | built | refuses paths outside the receive folder, `../` escapes and prefix lookalikes; positive control true **[V]** | same |
| **Video play** (H.264 MP4) | built | synthetic 12 s 1280 × 720 MP4: *Play* → *Original video · 1280 × 720*, controls on, seek to 7 s readyState 4 **[V]** | **[U]** — the `sidekick-media://` scheme (`main/mediaPreview.ts`, `registerSchemesAsPrivileged` + `protocol.handle`) has never served a byte inside a packaged, ASAR-sealed app |
| Video the player does not list (`video/quicktime`, HEVC) | partly | *"does not list … It may still play"* with **Try anyway · N MB**; only the player's own `error` says *cannot play* **[V copy]**; real HEVC files from a phone never measured **[U]** | same |
| HEIC stills | partly | shown as the phone's preview with *"Save to Mac keeps the original exactly as it is"* **[V copy]** | same |
| Selected-photos (limited) access | built | RDV 2026-09-23, *Some photos allowed* **[V]** | same |
| **Drag a photo to Finder** | **not built** | no drag source in `renderer/photos.ts` **[V]** | absent; the pane offers Save to Mac + Reveal in Finder instead. No copy promises a drag **[V by grep of the pane's strings for "drag": 0]** |
| Delete / organise on the phone | not built | the subtitle says *"View, organise and import"* — **"organise" has no verb behind it** **[V]**: `media.*` has `buckets`, `list`, `thumb`, `original` only | same — **a claim the pane cannot keep** (G4) |

## 5 · Gaps, with build / hide / label options

Effort and risk are **estimates [A]**, in focused working sessions, assuming the current code and test habits.

| Gap | What is wrong | Build | Hide | Label | Recommendation |
|---|---|---|---|---|---|
| **G1** Several-files share (D1) | gated; a release user sees no Sidekick for a multi-select | **flip both gates** after a fresh supervised run on the release pair — 1 session + hardware; risk **medium** (provisional values in `docs/feature-a-v3-production-enablement.md`) | already hidden | not possible — Android's share sheet has no room for a sentence | owner decision; Tier 2 |
| **G2** Camera v1 in a packaged Mac with a release phone (D4) | the pane explains, but with a developer sentence that also says *"not built yet"*, which is false of the feature | make Camera v1 releasable on the phone — a code change to `CameraReleaseGate` + a supervised run; 1–2 sessions; risk **medium** (camera claim on 42502, coexistence with mirror) | hide the Camera row in a packaged build — changes a pane the owner may use with a debug phone; risk **low**, but it is a behaviour change | **phone side**: when the release gate refuses, report *"Not available in this beta yet"* instead of the `missing` list — 1 session, Kotlin + test; risk **low** | **done 2026-10-15, `98c504b`** — owner chose the label: a release phone now says *"Not available in this beta yet."*; gate unchanged, not installed |
| **G3** Webcam (D5) | needs Developer ID, a signed Camera Extension and both gates | 5+ sessions after signing; risk **high** | already explained | done | Tier 3 |
| **G4** Photos subtitle *"organise"* | promises a verb that does not exist | build delete/move (`media.*` change, protocol first) — 3+ sessions; risk **high** (deleting a person's photos) | — | change the subtitle to *"View and save photos and videos from your phone."* — minutes; risk **none** | **done 2026-10-15, `7039c8d`** (stage 5): *"View and import photos and videos from your phone."*; red-first test; design-departures P7. Revert it if you prefer other words |
| **G5** Photos drag to Finder | the LinkMyMac target names it; not built | reuse Files' `fs-drag` after a Save — 1 session; risk **low** | — | nothing promises it today | Tier 2 if wanted |
| **G6** Pulls/saves above 64 MiB unchecked (D3) | release has no digest above 64 MiB | flip `FS_BLOCKS_RELEASE` both sides after a release-pair run — 1 session; risk **medium** | — | already says *not checksummed* | Tier 2 |
| **G7** macOS banners (row 5) | only a packaged build can show them, and none has run | nothing to build; needs a fresh-user packaged run | — | copy exists for refusal | Tier 1 check on the fresh macOS user |
| **G8** Incoming-call banner (D6) | built, never verified, no UI | verify on hardware, then ungate — 1 session; risk **low** | already invisible | not owed | Tier 2 |
| **G9** `sidekick-media://` in a packaged app | Photos originals and video play depend on it; never exercised packaged | — | — | — | Tier 1 check on the fresh macOS user |
| **G10** Notices/licences screen | required before a public release | generator + one screen each side — 2 sessions; risk **low** | — | — | Tier 1 |
| **G11** Defect 30 no-thread SMS, 38 volume, 17 second phone | open/deferred | as in the register | — | — | carry as known issues |
| **G12** Intel build never run | — | — | drop x64 from v1 | — | owner: ship arm64 only, or test on an Intel Mac |

## 6 · Proposed v1 scope, three tiers (a proposal — the owner decides)

**Tier 1 — ship in v1 as it is, once the release pair is checked.** Everything in §2 marked *built* with no gate:
pairing and reconnect, notifications with reply, SMS/MMS reading and SMS sending, calls (control, not audio),
contacts, media remote, clipboard both ways, send-selected-text, Files (with the honest *not checksummed* above
64 MiB), Photos browse / preview / Save to Mac / video play, mirror and control, Apps open-on-phone, single-file
share, Overview, Activity, Settings, the beta token. **Owed before it ships:** the fresh-macOS-user packaged run
(G7, G9, the Keychain prompt, the token screen), a signed APK, the notices screen (G10), the G2 label, the G4
subtitle, and the Developer ID decision.

**Tier 2 — built and gated; ship in v1 only if the owner flips the gate after one supervised run on the release
pair.** Several-files share (G1, both gates), 30-minute offers (D2, both gates), block-verified large pulls (G6,
both gates), the incoming-call banner (G8, one switch → a setting), Photos drag to Finder (G5, small build).

**Tier 3 — not in v1.** Camera v1 preview *unless* the owner chooses G2's build route; the webcam (G3, needs
signing first); microphone; very large share (Path L); a second phone (17); USB; Photos delete/organise.

## 7 · What this audit could not verify

- **Any packaged on-screen state** — no packaged app has run. Every DMG column is read from code.
- Whether a release **phone** and a packaged **Mac** negotiate exactly what §1 predicts — read from the negotiation
  code and its tests, never observed as a pair, because no signed release APK has been installed.
- HEVC and real phone `.mov` playback in the Photos pane.
- The Intel app.

## 8 · Decisions owed by the owner (from this audit)

> **Decided 2026-10-15:** v1 = everything built and honestly labelled, no gate flipped; Tier 2 = G1, G6, G5
> (plan: `docs/tier2-release-pair-plan-2026-10-15.md`); G2 labelled (`98c504b`); subtitle kept; Apple silicon only
> (`82dbc9e`); webcam and microphone stay Tier 3; H-1 corrected (`ffd8f89`). The list below is kept as asked.

1. For each of **D1–D6**: build into the final DMG (flip/ungate after a run), keep development-only, or drop.
2. **G2**: Camera v1 in v1 — make it releasable, hide the row in a packaged build, or keep it and fix the phone's
   sentence (recommended at minimum).
3. **G4**: the subtitle was changed tonight as an honesty fix (`7039c8d`) — keep or reword.
4. **G12**: ship Intel or arm64 only.
5. Accept or edit the three tiers in §6.
