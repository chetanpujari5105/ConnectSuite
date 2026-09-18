# Sidekick — Figma to production code, the implementation plan

> **Status: plan only, 2026-09-18. Nothing in `desktop/` has been changed.** This is the ordered
> route from the Figma file to the running app. It is written to be executed one batch at a time,
> each batch stopping for the owner's approval. The design itself is
> `docs/sidekick-figma-handoff.md`; the deliberate deviations are `docs/design-departures.md` rows
> D1–D12; the measured motion and material work it builds on is `docs/native-mac-pass-audit.md`.

**Figma file:** `sidekick mac app ui` —
`https://www.figma.com/design/sj9q3lneKdEr7Z54TNGPW5/sidekick-mac-app-ui`
Pages: **Design System** `28:542` (Foundations `28:543`, Components `28:866`, Decisions `28:1228`)
and **Page 1**, 55 screen frames at 1440 × 980.

**The one-line summary of the work:** this is a *visual and vocabulary* change to the renderer. No
protocol message, no IPC channel, no socket, no Android file and no wire namespace changes. Every
pane that works today must still work when each batch ends.

---

## 1 · Frame map

`State` is the link state the frame draws. `Files` lists what has to change for that frame; every row
also implies `styles.css`, which owns what lives inside a screen.

### Overview — 5 frames, **4 connection states**

| Frame | Node | Screen | State | Files |
|---|---|---|---|---|
| Overview / Connected | `6:2` | Overview | connected | `renderer/overview.ts`, `renderer/remote.ts`, `shared/deviceVitals.ts`, `styles.css` |
| Overview / Connecting | `22:6` | Overview | connecting | `renderer/overview.ts`, `shared/linkHealth.ts`, `shared/linkTone.ts` |
| Overview / Disconnected | `22:184` | Overview | disconnected | `renderer/overview.ts`, `shared/linkHealth.ts` |
| Overview / Degraded | `22:362` | Overview | degraded / permission missing | `renderer/overview.ts`, `main/feature.ts`, `shared/linkTone.ts` |
| Overview / Connected · Media playing | `40:20881` | Overview | **content variant of Connected — not a connection state** | `renderer/remote.ts`, `renderer/overview.ts` |

### Mirror — 5

| Frame | Node | State | Files |
|---|---|---|---|
| Mirror / Ready | `31:1566` | connected, idle | `renderer/mirror.ts`, `shared/mirrorSession.ts`, `renderer/streamStart.ts` |
| Mirror / Mirroring | `31:1749` | running | `renderer/mirror.ts`, `renderer/h264Canvas.ts`, `shared/frameTally.ts`, `renderer/latencyStages.ts` |
| Mirror / Phone locked | `31:1966` | running, black frames | `renderer/mirror.ts`, `shared/mirrorSession.ts` |
| Mirror / Consent needed | `31:2166` | permission | `renderer/mirror.ts`, `renderer/streamStart.ts` |
| Mirror / Secure content | `31:2350` | degraded (FLAG_SECURE) | `renderer/mirror.ts`, `shared/mirrorSession.ts` |

### Files — 4

| Frame | Node | State | Files |
|---|---|---|---|
| Files / Browsing | `31:2550` | connected | `renderer/files.ts`, `shared/filesRoots.ts`, `shared/transferFiles.ts` |
| Files / No folders shared | `31:2819` | empty | `renderer/files.ts`, `shared/filesRoots.ts` |
| Files / Couldn't open folder | `31:2985` | error | `renderer/files.ts`, `shared/filesRoots.ts` |
| Files / Sending | `31:3175` | transfer in flight | `renderer/files.ts`, `shared/transferDigest.ts`, `main/bulk.ts` (read-only) |

### Photos — 4

| Frame | Node | State | Files |
|---|---|---|---|
| Photos / Browsing | `31:3431` | connected | `renderer/photos.ts` |
| Photos / Thumbnails only | `31:3704` | partial | `renderer/photos.ts`, `main/feature.ts` |
| Photos / Permission needed | `31:3956` | permission | `renderer/photos.ts` |
| Photos / Loading | `31:4122` | loading / paging | `renderer/photos.ts` |

### Messages — 4

| Frame | Node | State | Files |
|---|---|---|---|
| Messages / Thread | `32:4382` | connected | `renderer/sms.ts`, `renderer/contacts.ts` |
| Messages / Send failed | `32:4613` | error | `renderer/sms.ts` |
| Messages / Permission needed | `32:4845` | permission | `renderer/sms.ts` |
| Messages / Disconnected | `32:5013` | disconnected | `renderer/sms.ts`, shared disconnected component |

### Notifications — 5

| Frame | Node | State | Files |
|---|---|---|---|
| Notifications / Inbox | `34:5254` | connected | `renderer/notifications.ts`, `shared/notifyLabels.ts`, `shared/liveNotifications.ts` |
| Notifications / Replying | `34:5499` | connected, composing | `renderer/notifications.ts` |
| Notifications / Read only | `34:5744` | connected, no reply action | `renderer/notifications.ts`, `shared/appLabel.ts` |
| Notifications / Access needed | `34:5989` | permission | `renderer/notifications.ts`, `main/feature.ts` |
| Notifications / Media session | `40:21209` | connected + active session | `renderer/notifications.ts`, `renderer/remote.ts`, **new** `shared/mediaSessionRow.ts` |

### Clipboard — 4

| Frame | Node | State | Files |
|---|---|---|---|
| Clipboard / History | `34:6160` | connected | `renderer/clipboard.ts`, `shared/clipboardHistory.ts`, `shared/clipLink.ts` |
| Clipboard / Phone to Mac | `34:6408` | connected, inbound | `renderer/clipboard.ts`, `shared/clipPhoneState.ts` |
| Clipboard / Sensitive clip | `34:6627` | withheld | `renderer/clipboard.ts`, `shared/clipboardHistory.ts` |
| Clipboard / Disconnected | `34:6867` | disconnected | `renderer/clipboard.ts`, `shared/clipEcho.ts` |

### Calls — 4

| Frame | Node | State | Files |
|---|---|---|---|
| Calls / Idle | `34:7045` | connected, no call | `renderer/calls.ts` |
| Calls / Incoming | `34:7326` | ringing | `renderer/calls.ts`, `shared/appCall.ts` |
| Calls / In call | `34:7618` | in call | `renderer/calls.ts` |
| Calls / Permission needed | `34:7907` | permission | `renderer/calls.ts` |

### Apps, Activity, Settings, Camera, Pairing — 20

| Frame | Node | State | Files |
|---|---|---|---|
| Apps / Browsing | `34:8127` | connected | `renderer/apps.ts` |
| Apps / Loading | `34:8440` | loading | `renderer/apps.ts` |
| Apps / No results | `34:8700` | empty search | `renderer/apps.ts` |
| Apps / Disconnected | `34:8865` | disconnected | `renderer/apps.ts` |
| Activity / All events | `34:9188` | any | `renderer/activity.ts`, `shared/activity.ts` |
| Activity / Filtered empty | `34:9478` | filtered-empty | `renderer/activity.ts`, `shared/activity.ts` |
| Activity / Nothing recorded | `34:9686` | empty | `renderer/activity.ts` |
| Activity / Disconnected | `34:9849` | disconnected (pane still works) | `renderer/activity.ts` |
| Settings / General | `34:10156` | any | `renderer/settingsControls.ts`, `shared/appearance.ts` |
| Settings / Connection | `34:10376` | connected | `renderer/settingsControls.ts`, `main/discovery.ts` (read-only) |
| Settings / Notifications | `34:10618` | permission-aware | `renderer/settingsControls.ts`, `shared/nativeNotify.ts` |
| Settings / File transfer | `34:10843` | any | `renderer/settingsControls.ts`, `main/downloads.ts` (read-only) |
| **Settings / Device info** | `44:23491` | any | `renderer/settingsControls.ts`, `main/feature.ts`, **new** `shared/capabilityStatus.ts` |
| Camera / Not built | `34:11064` | unbuilt | `renderer/navModel.ts`, `styles.css` |
| Pair a phone / Ready to scan | `34:11219` | unpaired | `renderer/shell.ts`, `shared/pairingCode.ts` |
| Pair a phone / Searching | `34:11409` | discovering | `renderer/shell.ts`, `main/discovery.ts` (read-only) |
| Pair a phone / Verifying | `34:11605` | handshaking | `renderer/shell.ts`, `shared/session.ts` |
| Pair a phone / Paired | `34:11793` | paired | `renderer/shell.ts` |
| Pair a phone / Rejected | `34:11956` | refused | `renderer/shell.ts`, `shared/pairRejection.ts` |
| Pair a phone / No network | `34:12152` | no local network | `renderer/shell.ts` |

---

## 2 · Component implementation map

| Figma | Node | Lands in | Notes |
|---|---|---|---|
| Foundations — colour | `28:543` | `tokens.css` | Every value in §2 of the handoff becomes a custom property. `--live` green is **deleted**; connected is `--accent`. `--tint-*` all go |
| Foundations — type | `28:543` | `tokens.css` | Six roles plus the numeral face. The 18 literal sizes in the build collapse onto them |
| Foundations — spacing / radius | `28:543` | `tokens.css` | 4-base scale, five radii |
| Foundations — motion | `28:543` | `tokens.css` + `shell.css` | `--ease`, `--ease-in-out`, `--dur-press/state/route/bar`; reduced-motion and reduced-transparency blocks |
| Nav row `28:915` | 7 variants | `shell.css` | Active = lime tint + lime glyph, no glow. Unavailable says *not built* |
| Status pill `28:932` | 4 | `shell.css` | Connected is lime now |
| Buttons `28:956` / `28:970` / `43:23106` | 13 | `shell.css` (chrome) + `styles.css` (in-pane) | Destructive is Semi Bold, fill 14/20/26%, border 34→48% |
| Segment `28:997` | 3 | `styles.css` | One selection vocabulary; replaces five |
| Icon badge `28:1047` | 4 | `styles.css` | Tone is state, never category |
| Stat card `28:1075` | 4 | `styles.css` | superseded on Overview by the metric card; kept for other panes |
| List row `28:1162` | 9 | `styles.css` | |
| State block `28:1226` | 6 | `styles.css` | empty · unavailable · loading · permission · error · **wall** (wall never gets a retry) |
| Disconnected state `32:4380` | 4 | `styles.css` | banner · overlay · inline notice · blocked action |
| Iconography §13 | `28:866` | **`renderer/icons.ts`** + `navModel.iconNamesUsedByTheShell()` | 45 glyphs, three weights, seven sizes. The mapping table is the contract; seven are approximations of a named SF Symbol |
| Device metric card `39:20321` | 7 | `styles.css`, `renderer/overview.ts`, `shared/deviceVitals.ts` | Storage is stated as **free space** everywhere; the bar fills with free space |
| Media remote `40:21854` | 8 | `renderer/remote.ts`, `styles.css` | Idle draws **no transport**. Output is a readout with no chevron |
| Notification row / Media session `40:20861` | 4 | `renderer/notifications.ts` + new `shared/mediaSessionRow.ts` | Correlates `notif.posted.package` with `remote.state.active` — the shape `shared/appCall.ts` already uses. **No protocol change** |
| Slider `42:21906` | 8 | `styles.css` | Playback lime; volume neutral at rest, lime only while dragging |
| Activity row `42:23024` | 8 | `renderer/activity.ts`, `renderer/overview.ts`, new `shared/activityRow.ts` | One row shape for the Overview card (4 rows) and the Activity pane (11 + pager) |
| Connection & security `43:23462` | 6 | `renderer/overview.ts`, `styles.css` | CSS grid/flex mirroring the Auto Layout; action never beside wrapped copy |
| Capability status row `45:24002` | 6 | `renderer/settingsControls.ts`, new `shared/capabilityStatus.ts` | Available / Limited / Needs permission / Unavailable / Unbuilt |
| Phone hero preview | inside `6:2` | `renderer/overview.ts`, `styles.css` | **Illustration only.** It must never become a frame buffer, a notification list or album art |
| Status island | frames' chrome | `shell.css`, `shared/islandState.ts` | Unchanged in behaviour; re-skinned. It stays a pure function of the live status (defect 96) |
| Header / command palette | frames' chrome | `shell.css`, `renderer/shell.ts` | ⌘K keeps **no** animation |
| Sidebar | frames' chrome | `shell.css`, `renderer/navModel.ts` | **Twelve rows, unchanged.** Device info is a Settings subpage, not a sidebar row |

**Three new `src/shared/` modules** (pure, testable, hung on `globalThis`, no `export`):
`mediaSessionRow.ts`, `activityRow.ts`, `capabilityStatus.ts`. Each ships with its own
`*.test.ts` beside it, each test shown red first against the defect it is named for.

---

## 3 · Batch order

Each batch ends at a stop. Nothing in a later batch starts before the owner approves the one before.

**Batch 1 — tokens, type, icons, shell.** `tokens.css` rewritten to the new palette and type scale;
`icons.ts` and `navModel.iconNamesUsedByTheShell()` rebuilt from the mapping table; `shell.css`
re-skinned — sidebar, header, status island, palette, buttons. **The dock is deleted** (markup, CSS
and its motion spec). Highest-risk batch for the stylesheet-ownership rule; nothing else moves.

**Batch 2 — Overview and its variants.** The hero with the phone preview, the metric cards, the
Connection & security card, the Recent activity rows, the Media remote widget. The old chip row,
the Device status card and the wide footer strip are removed. Four connection states plus the media
content variant.

**Batch 3 — Mirror, Files, Photos.** Mirror's stopped-reason overlays and the one-of Start/Stop rule
(audit B1) land here; Files gets the new table and the drop tile; Photos gets the partial and
permission states.

**Batch 4 — Messages, Notifications, Clipboard, Calls.** Includes the media-session feed card and
its correlation module, the clipboard direction chips and timeline wording, and the Calls audio wall
copy. **No Bluetooth remedy sentence anywhere.**

**Batch 5 — Apps, Activity, Settings, Camera, Pair a phone.** Apps' *Ask the phone to open* wording,
the Activity row list, Settings including the **Device info** subpage and its capability list, the
Camera unbuilt state, and the pairing flow's four steps.

**Batch 6 — accessibility, motion, QA, packaging review.** `prefers-reduced-motion`,
`prefers-reduced-transparency`, `:focus-visible` coverage, contrast re-run over the rendered DOM
(defects 120 and 121 were both invisible to a token audit), the motion spec from handoff §8 with the
five additions the animation review asked for, and a packaging sanity pass. **No signing work** —
that is Phase 8 and out of scope here.

---

## 4 · Architecture protections

These are not style preferences; each one has already cost this project a defect.

- **`tokens.css` owns colour and custom properties only.** No component may declare a second
  `:root`. A value that is not a token means the token is missing.
- **`shell.css` owns the frame** — window, sidebar, nav, island, palette, toast. **`styles.css` owns
  what lives inside a screen.** One selector belongs to exactly one stylesheet;
  `src/renderer/stylesheets.test.ts` fails the build on a duplicate.
- **No `export` in any file the page loads**, including `src/shared/` files in `index.html`. A file
  with one throws on its first line and every declaration below it is silently dead (defect 94).
  `scripts/check-renderer-scripts.mjs` enforces it on commit.
- **Icons go through `icons.ts` and `navModel.iconNamesUsedByTheShell()`.** A name outside the
  enumeration is an icon nobody can check — the app once shipped with no icons and nothing noticed.
- **No colour literal outside `tokens.css`.** `check-color-tokens.mjs` and `check-contrast.mjs` run
  on commit; every dark token needs its light counterpart or the check fails.
- **Preserve every IPC channel, socket, protocol message and handler.** This work changes what is
  drawn, never what is sent. `docs/protocol.md` is untouched.
- **Do not touch** `app/`, `core/`, `sync-module/`, `mirror-module/`, `input-module/`, the
  `_connectsuite._tcp` mDNS name, the wire namespaces, or `Download/ConnectSuite` on the phone.
- **The renderer only draws.** Sockets and file IO stay in the main process.
- **A departure row lands in the same commit as the change it describes**, not afterwards.

---

## 5 · Verification, every batch

Run in this order, and stop on the first failure:

1. `npm run typecheck` in `desktop/` — `tsc --noEmit` plus the test project.
2. `npm test` in `desktop/` — and check `check-suites-run.mjs` reports **GREEN**, not `stale` or
   `unrun`; a green from a build that did not compile is the most confident wrong answer there is.
3. The commit guards: renderer scripts, stylesheet collisions, colour tokens, contrast, renderer
   views, state vocabulary, orphan tests, defects and protocol sync, versions, apps verb.
4. **Launch Electron** — `npm start`, with `--force-renderer-accessibility` when the run needs the
   accessibility tree.
5. **Compare against the exact Figma node.** `scripts/shot.mjs` at 1628 × 920 @2x, then
   `scripts/compare-shot.mjs` against the frame named in §1. Quote the node id in the evidence.
6. **Drive the states**, not just the happy one: connected, connecting, degraded, permission needed,
   loading, error, disconnected. Reads go through `scripts/probe.mjs` — it requires a control,
   refuses a fixed sleep, and `__probe.onScreen()` reports `visible` / `reachable` / `stranded`. **A
   card carrying a state must be `visible` at rest.**
7. Record the batch in `docs/testing.md` with its controls, and the departures in
   `docs/design-departures.md`.
8. **Stop for the owner's approval.**

---

## 6 · What needs a real phone

None of these can be claimed from a screenshot or a unit test. Each needs the SM-S938B on the same
network, and each needs its control recorded beside it.

| # | What | Why a device is the only way |
|---|---|---|
| 1 | Start / Stop mirroring | MediaProjection consent cannot be cached; every start needs a fresh tap. Only one of Start/Stop may be on screen |
| 2 | Media remote, active session | `remote.state` with `active: true` only exists when an app holds a session |
| 3 | Playing / paused and position | `positionMs` + `positionAtMs` drive a bar the Mac runs itself between pushes |
| 4 | Artwork and source app | `artworkKey` → `remote.artwork`, and `NO_ARTWORK` is a **normal** answer that must draw the placeholder |
| 5 | Previous / Play-Pause / Next availability | `canSkipPrevious` / `canSkipNext` come from the session's own `PlaybackState.actions` |
| 6 | Volume and audio output | `volume` / `volumeMax`, and `output.kind` is classified **by the phone** |
| 7 | Notification reply | Needs a real `RemoteInput` action; the read-only path must look different |
| 8 | File transfer progress and resume | Resume from the last confirmed byte — and the probe must report bytes *delivered*, never bytes queued (defect 56) |
| 9 | Permissions and degraded states | Revoking a grant by hand is the only way to see them; the partial-photos state has still never been seen on hardware |
| 10 | Mirror walls | Lock screen and `FLAG_SECURE` black frames, and the consent-denied path |
| 11 | Pairing | The four steps, a rejected code, and the no-network case |

**Two hardware facts to carry into the work rather than rediscover:** a call's audio never reaches
this Mac by any route, and the phone→Mac clipboard cannot be automatic. Both are measured walls with
their evidence in `CLAUDE.md`.

---

## Open questions before Batch 1

1. **Light theme.** Shipped 2026-09-16 with 58 token pairs at 0 failing. The Figma file draws dark
   only, so every new token needs a light counterpart derived to the same contrast floor — or the
   owner decides light mode gets its own pass afterwards.
2. **`Stat card` (component 9)** is superseded on Overview by the metric card. Keep it for other
   panes or retire it, as the capability chip was.
3. **Device info entry point.** The pane exists in Settings; the header's *Device settings* button
   and the hero's *Device info* action should both route to it. Confirm that is the intent.
