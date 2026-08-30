# Where the built UI departs from `ConnectSuite.dc.html`, and why

**For the designer.** One page, one row per departure. Nothing here is a complaint about the
design — every row exists because the *wire* cannot currently support what the design draws, or
because Android cannot. Each row says what would have to become true for the design's version to be
built as drawn.

**Design authority.** `design_handoff_connectsuite/ConnectSuite.dc.html` plus its `README.md` is the
final design for this app. Where a screenshot disagrees with those two, they win. This file is the
only place a *deliberate* deviation from them is recorded; if a difference is not in this table, it
is a bug, not a decision.

**Status column.**

- **wall** — Android forbids it. It will not become true; the design's version cannot be built by
  anyone. The control is *removed* and one line of copy replaces it, because a greyed control is a
  promise it might one day light up.
- **unbuilt** — nothing on the wire yet, but nothing stops it. The named change would make it real.
- **reshaped** — built, but not in the shape drawn, because the underlying thing is not what the
  design assumed.

Last updated **2026-08-30** — the app shell landed (§"App shell", S1–S12), every routed screen was
measured against the prototype at a matched 1440 × 920 viewport, and there is now a **pairing screen
proposal** below, which is a request rather than a decision.

---

## Notifications (§7) — shipped

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| N1 | **Muted** filter with a designed empty state | A designed state that says muting is decided on the phone and is not sent to the Mac, with `notif.posted — no mute field in this build` in mono beneath. Its pill carries a **dot, not a count** | **unbuilt** | There is no mute concept anywhere in the protocol — no field, no message, no capability. Drawn as an *empty* state it would be an empty state over nothing: it would read "no apps are muted", which the Mac has no way to know. A `0` on the pill would make the same claim | A `muted: boolean` on `notif.posted`, or a `notif.muted` list. The phone knows; it just does not say |
| N2 | **UNREAD** pill on the detail card | **ONGOING** pill, shown only where `ongoing` is true | **unbuilt** | There is no read/unread state in the protocol. `ongoing` is real — the app pinned the notification and it cannot be swiped away — so the pill slot carries something true instead of something invented | A read/unread field on `notif.posted`. Android does not model this either, so it would have to be a Mac-side notion of "seen in this pane" |
| N3 | **Chat** and **Messages** as two filter pills | One **Messages** pill (`category === "msg"`); the freed slot is **Can reply** (`canReply`) | **reshaped** | Android has a single `CATEGORY_MESSAGE`. Two pills over one category would split the same rows arbitrarily or leave one permanently empty. `Can reply` is real and is already the denominator the pane publishes | Nothing on the wire — this is Android's category set, not ours. A Chat/SMS split would need the Mac to classify by package, which is guessing |
| N4 | Pane **hidden** when the capability is absent (implied — the design has no unavailable state at all) | Pane **stays** and renders the phone's own `reason` verbatim in a `--warning` banner | **reshaped** | The design has no drawn state for "the phone has this feature and is not offering it right now", which is a normal daily state of this product. Hiding the pane leaves the user hunting for a feature that silently stopped existing | A drawn *unavailable* state in the design language. This is the one row where the **design is missing something**, rather than the wire being missing something — worth a screen |
| N5 | Unresolved app label rendered like any other app name | A fallback label (`appName === package`) is set in the **mono** face with a `package id` chip, and announces as `"com.… — app name unavailable"` | **reshaped** | Defect 28. `AppLabels.of` correctly returns the package name when an app has no launcher icon; that fallback is right and must not be "fixed". But a package id must never be *the only thing a user reads* | Nothing — this is the rule working. Worth a drawn treatment in the design so it is not invented per-pane |

## Mirror (§2) — embedded layout **built 2026-08-29**; detached window **built 2026-08-30**

The Mirror page is the approved reference layout and is not being restructured. Every row below is a
control *inside* it.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| M1 | Tool rail: **Power** | Removed | **wall** | There is no public API for an AccessibilityService to synthesise a `KeyEvent`. `INJECT_EVENTS` is signature-level and will never be available to this app. No app on Android can press the power button | Nothing. This is in `CLAUDE.md`'s platform walls and will not change |
| M2 | Tool rail: **Rotate** | Removed as a button. The pane *displays* the current rotation, which is real | **wall** | `mirror.rotate` is **phone → Mac only**, and `MirrorContractTest` asserts it is never registered as a request. `docs/protocol.md`: *"the Mac cannot turn a phone, so a `mirror.rotate` in the other direction could only be the Mac claiming a rotation that had not happened."* A Rotate button would desynchronise the geometry the encoder is producing from the geometry the Mac is drawing against — and input coordinates are checked against that stamp | Nothing on our side. Forcing a phone's orientation from another device needs `WRITE_SETTINGS` plus per-app override and would fight the phone's own sensor |
| M3 | Tool rail: **Capture** | **Kept, and built Mac-side** | — | Not a departure in the end, but worth the designer knowing it is not a phone command: the Mac already holds the decoded frames, so a capture is `canvas` → file with **no protocol change at all**. It is the one tool-rail item that is real today | — |
| M4 | Tool rail: **Record** | Not drawn | **unbuilt** | Same mechanism as Capture — Mac-side, from the canvas stream — so it is genuinely possible with no wire change. It is left out of this slice because it is a new feature rather than design work, not because it cannot be done | Nothing on the wire. It is a Mac-side feature waiting for a phase |
| M5 | Tool rail: **Transfer** | Not drawn | **unbuilt** | `fs.*` has no payload spec yet. Phase 5 | The `fs.*` namespace being specified and built |
| M6 | Advanced toggle: **Phone screen off** | Removed, replaced by copy | **wall** | `mirror.screenoff` is deliberately absent from the protocol: turning the phone's display off while mirroring needs a **system-signed permission this app cannot hold**. `MirrorContractTest` asserts the type is never registered, so the constant cannot quietly grow a handler | Nothing. This is the reason the constant exists but is unregistered |
| M7 | Advanced toggle: **Sound from phone** | Not drawn | **unbuilt** | No audio message exists anywhere in the protocol. Unlike M6 this is **not** a wall: `AudioPlaybackCapture` is public API on Android 10+ and would carry media audio. (Call audio is separately walled and always will be — `CAPTURE_AUDIO_OUTPUT` is system-only) | An audio channel in the protocol, plus phone-side capture. Worth noting apps can opt out of being captured, so it will be "sound from most apps" |
| M8 | Advanced toggle: **Show touches** | Not drawn | **wall** | It is `Settings.Global.SHOW_TOUCHES`, which needs `WRITE_SECURE_SETTINGS` — signature-level | Nothing, unless the *Mac* draws its own touch indicator over the canvas from the input it is already sending. That is a real alternative and would look identical to the user |
| M9 | Advanced toggle: **Keep screen on** | Not drawn | **unbuilt** | Nothing on the wire. Not a wall — the phone can hold a wake lock while a session is running | A `mirror.start` field, or simply doing it unconditionally while mirroring, which is arguably the right behaviour anyway |
| M10 | Quality rows: **1080p · 60 FPS** / 720p · 30 / 480p · 30 | Kept, with the **actual captured geometry shown beside the chosen row** | **reshaped** | `maxResolution` is a cap on the **short edge**, not a resolution to capture at. A 1440×3120 panel with the 1080 cap captures 1080×2340; the same cap on a 1080p phone changes nothing. So "1080p" is honest as a *request* and misleading as a *fact* — and the phone reports what it actually captured in `mirror.state: running` | Nothing — the design's labels are fine as preset names. The addition is showing the truth beside them |

### Mirror — additional, found while building the pane

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| M11 | A five-item tool rail | Three slots: **Capture**, **Refresh**, and a **Rotation readout** | **reshaped** | With Power, Rotate, Record and Transfer removed (M1, M2, M4, M5), Capture alone would leave a one-item rail. **Refresh** sends `mirror.keyframe`, which is real and is what to press when the picture has torn and is not recovering. The third slot shows the rotation rather than offering to change it — the honest version of M2, in the slot the design gave it | Nothing. `mirror.keyframe` is already in the protocol and simply was not drawn |
| M12 | **Start mirroring** as a violet button inside the stopped-state overlay | Kept in the right column beside Stop | **reshaped** | The design's overlay assumes one stopped state. Ours has several — secure surface, consent denied, encoder failed, phone locked — and each writes its own reason into that overlay. A button living inside it would either be wiped by the next reason or force every reason to carry one. The overlay stays a place where the app explains itself; the control stays where controls are | A separate "stopped" state distinct from "failed, here is why", so the overlay could hold a control without competing with an explanation |

### Detached mirror window (§3) — built 2026-08-30

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| M13 | A hover dock over a screen the user can also **tap and swipe**, with "both views feed one gesture queue" | Dock only: **Back, Home, Recents, Screenshot**. The canvas takes **no pointer input** | **unbuilt** | The three global actions are `performGlobalAction` and carry no coordinates, so they need no geometry stamp and shipped. A tap does: every coordinate-bearing message must quote the `geometryId` the frame was captured against, cancel an in-flight drag when the phone turns (defect 19) and refuse a gesture older than the staleness window (defect 20). That logic lives in `mirror.ts`, and a second copy of it is the copy that does not get the next fix — which for input means a stroke landing on the wrong app on somebody's real phone, which is what defect 20 already cost | A shared input seam — the coordinate mapping and the drag/stale rules lifted out of `mirror.ts` into `src/renderer/` or `src/shared/` with its own tests, the way `notifyLabels.ts` came out of `notifications.ts`. Then both views call one queue, as the README says. **This is the named follow-up; it is not a wall and not a wire gap** |
| M14 | The phone screen, drawn once | Decoded **twice** — the embedded canvas and the float window each run their own `VideoDecoder` over one broadcast stream | **reshaped** | "Two views of one session" is one *session*, not one decoder. The main process broadcasts access units and each window decodes; opening the float window replays the retained SPS/PPS and asks for an IDR, so it can start mid-stream. Handing decoded frames between renderers would mean a readback and a copy per frame at 60fps, which costs more than a second decode | Nothing on the wire. It is a Mac-side trade and the cheap direction was taken |
| M15 | — | `src/renderer/h264Canvas.ts` holds the decode-and-paint rule; **`mirror.ts` still holds its own copy** | **reshaped** | The float window's decoder was extracted rather than copied, but the Mirror pane was not moved onto it: its version interleaves latency stamps, keyframe sizing and the overlay decision into the same callbacks, and untangling a pane that passed on hardware in Phase 2 needs its own hardware pass. **Recorded here rather than left to be discovered** — this is the two-copies-of-one-rule shape the code rules warn about, and it is live | `mirror.ts` moved onto `H264Canvas`, with the pane's extras as hooks. Wants a hardware re-run of Phase 2's acceptance steps, so it is a step inside whatever sitting can afford one |

## App shell (§"App Shell") — built 2026-08-30

The shell is the frame every screen sits in: window, sidebar, nav pill, status island, page header
and toolbar, dock, ⌘K palette, toast, connected-device strip. Before it existed the app was one
scrolling column of cards and a Connection debug panel; there was no arrangement of pane-level
styling that could have made that read as this design.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| S1 | Three 12px **traffic-light circles** drawn in the sidebar at a 20px inset, 52px row | The **real macOS traffic lights**, positioned into that exact row by `titleBarStyle: 'hidden'` + `trafficLightPosition: {x:20,y:20}`. The markup for the row is empty | **reshaped** | Three divs would have needed their own close, minimise and zoom; would not draw the system's hover glyphs; and would not go translucent when the window loses focus. The design's *pixels* are met by the system's *buttons*, which is strictly better than a lookalike | Nothing. This is the native translation the README's own "Native translation notes" section asks for |
| S2 | Window **24px radius**, hairline border, deep drop shadow | The system's window: macOS draws its own corner radius and its own shadow behind whatever we paint | **reshaped** | Painting a second 24px radius inside the OS's own produces a rounded rectangle floating in a squared one, which is worse than either. The radius is real, it is just not ours to set | Nothing on macOS. The mockup's 24px is the artboard presenting a window, not an instruction to draw one |
| S3 | Window **1440 × 920** | 1440 × 920 requested; **this display gives 865 of height** and macOS clamps it | — | Not a departure, a fact worth recording so the next screenshot comparison is not read as a layout bug: `screen.availHeight` is 865 on the machine this was built on, so the window opens 55px shorter than the artboard and the page scrolls that much sooner | A taller display |
| S4 | Device card, connected-device strip and Overview hero each carry a **battery percentage** ("79%") | The slot is **removed** from all three, and Settings → Advanced carries `battery: not subscribed on this build (battery.state is unhandled)` | **unbuilt** | `battery.state` is declared in `docs/protocol.md` and **nothing on the Mac subscribes to it**. A lone "—" between "Connected" and a divider is a glyph with no label — a reader has to decode it rather than read it — so the fact moves to where facts live and says what is actually true | Handling `battery.state` on the Mac. The message exists; nothing listens |
| S5 | Overview hero's four facts: Connected via / Latency / **Encryption** / **Signal** | Connected via / Latency / Encryption / **Address** | **reshaped** | Encryption is kept and is *true* — "TLS 1.3, pinned" is the transport, and it is the one claim on this card that holds before the phone answers. **Signal is cut**: nothing on the wire reports link quality, and a made-up "Excellent" beside three measured values is the one lie that would make the other three unreadable. Its slot goes to the address, which locked decision #4's discovery order makes the most useful fact when something is wrong | An RSSI or link-quality field on the wire |
| S6 | Status island cycling **"Clipboard synced"**, **"Transfer complete · 4.2 MB"** | A rota of **real session events only** — the connection phase and its latency, and any refusal the phone sent, deduplicated against the last | **reshaped** | Both of the design's example strings name features that do not exist (Phase 5). An island narrating transfers this app cannot perform is the most visible possible version of what decision 6 forbids, at 5.2-second intervals | Phase 5. The rota takes any string; the events simply have to happen |
| S7 | Eleven sidebar rows, all live | Eleven rows; **five draw a "Not built yet" state** naming the phase and the missing piece — Files, Photos, Clipboard, Camera, Activity | **unbuilt** | The design assumes all eleven work. A nav row that opens a blank page is decision 6 failing at the largest possible scale: the user cannot tell "nothing has arrived" from "this was never written". `navModel.test.ts` asserts every unbuilt screen carries a reason and that no built one does | Phases 5–7 |
| S8 | No **pairing / first-run** screen anywhere; the first screen assumes a paired phone | A `pairing` **route with no sidebar row**, forced whenever `paired` is false and released the moment the phone is trusted | **unbuilt** | This is departures row X5's sharpest case, now answered rather than only recorded. A twelfth nav row would invent something the designer did not draw; a route without a row keeps the sidebar the design's eleven and still means a fresh Mac cannot land on a dashboard describing a phone it has never met | **A designed pairing screen.** This is still the most useful hour a designer could spend on this app |
| S9 | Sidebar footer: account email + **PRO** pill. Settings: Two-factor, Sign out everywhere, "You are up to date" | Footer: "This Mac" + **LOCAL** pill. Settings → About: a "Where your data goes" row reading `local network only` | **reshaped** | Restates X2 at the place it is now visible. There is no account, no tier, no second factor and no update server — CLAUDE.md's first line. The footer still has the design's shape; it says what is true in it | An account system, which is explicitly not this product |
| S10 | Overview right column: **Quick actions** tiles, a **Device** card, **Recent activity** | "What this phone can do" (the capability list) and **Media remote** | **reshaped** | Quick actions is the dock, twice. Recent activity needs a session store nothing writes yet (that is the Activity screen, S7). The two panes that took the space are X5's homeless features — the capability list is the pane that answers "why can't I do X", and the media remote had no pane, no row and no tile anywhere in the design | Recent activity needs a session log. Quick actions needs nothing and is deliberately not duplicated |
| S11 | Mirror **tool rail**: Power, Rotate, Capture, Record, Transfer | Capture, Refresh, and a **Rotation readout** | **reshaped** | Unchanged from M-rows; recorded here because the rail is now generated from `navModel.TOOL_RAIL` rather than hand-written, which is what puts Capture and Refresh inside the icon guard | See M2 |
| S12 | ⌘K palette rows carry a **coloured icon tile** per result | Same, with the screen's own icon in it; a command gets the Mirror glyph | — | Not a departure. Noted because the design's tile is a blank coloured square and ours carries the icon, which is the design's own intent read forwards | — |

### A fifth surface the written colour table does not list

The handoff's colour table gives four elevations — canvas, elevation 1, elevation 2, elevation 3 —
and stops. The prototype draws a fifth: **`#111219`, a recessed well**, on the notification list,
the Settings rail, the Settings right-hand cards and the Advanced diagnostics block. Four surfaces
across three screens is a system value, not a one-off, and it is *below* elevation 2 rather than
above it, so nothing in the existing scale substitutes for it.

Built as `--well`. **Flagged for the designer**: if it belongs in the table it should be named
there, and if it does not, four drawn surfaces need re-specifying.

### Three shell bugs found by screenshotting the shell against the design, and what they cost

Recorded because each was invisible to `tsc`, to `npm test`, and to every check in the repo, and
each was found by looking at a picture:

1. **The ⌘K palette rendered over every screen, permanently.** `.palette-backdrop { display: flex }`
   is a class selector; the UA stylesheet's `[hidden] { display: none }` is an attribute selector.
   Equal specificity, later sheet wins. `el.hidden` was `true` the whole time. Fixed with one
   `[hidden] { display: none !important }` in shell.css, which is the correct single use of it.
2. **The whole app rendered at 0.72 zoom.** Chromium persists a per-origin zoom level into the user
   data directory, so a stray ⌘- at some point had every size in a design specified to the
   half-pixel drawn at 72%, silently, across launches. `webPreferences.zoomFactor` is only the
   initial value and did **not** hold; `setZoomLevel(0)` on `did-finish-load` does.
3. **The Floating window button drew on all eleven screens.** styles.css redefined
   `.toolbar-button` and loads after shell.css, so it beat `.mirror-only { display: none }`.

The third is the same shape as the `:root` collision that made the accent blue, so it has an
enforcement point rather than a third fix: `stylesheets.test.ts` asserts no selector is declared in
two of the three sheets, and that only tokens.css declares custom properties.

---

## A request, not a departure: **the pairing screen**

Every other row in this file is us declining to draw something the design asks for. This one runs
the other way: **the handoff has no unpaired state at all**, and a Mac with no phone paired is the
first thing every new user sees. It has been recorded as a gap since row X5 and is the one screen
whose absence is a hole rather than a difference.

There is a route for it in the build now (`pairing`, forced while `paired` is false, no sidebar
row — row S8) and it draws a QR on a primary card. **That is a placeholder standing in for a
design, and it should be replaced rather than blessed.** What follows is a proposal in the
handoff's own language so there is something concrete to react to, not a decision.

### What it has to do

Phase 1 works like this, and the screen is constrained by it rather than by taste. The Mac mints a
QR carrying `{ host, fp, token, name }` — its address, its certificate fingerprint, a 16-byte
pairing token, and its name. The phone scans it, trusts that fingerprint, and **starts listening**;
the Mac dials *out* to the phone (locked decision #2), finds it by the discovery order in locked
decision #4, and completes a TLS 1.3 handshake pinned to the fingerprint on both sides. The token
has a TTL, so the code goes stale on its own.

The screen therefore has to carry four things at once: a code to scan, an instruction, a live
account of how far the pairing has got, and a way out when the network will not cooperate.

### Proposed layout — 1440 × 920, the shell as it already is

The sidebar renders, dimmed: there is no phone, so the device card reads its empty state and the
eleven nav rows are all `--text-meta` and inert. That is deliberate — the app should look like
itself with nothing in it, not like a different app. Title-bar band, island and dock render as
normal; the island carries the pairing state.

- **Page header** — title "Pair your phone" 31px/600/-0.02em; subtitle "Scan once. After that this
  Mac finds your phone on its own." 13.5px `--text-body`.
- **One primary card**, `--elev-3`, `--radius-panel`, 20px padding, **centred, 560px wide** — the
  only elevation-3 surface on the screen, per the one-primary-card rule. Two columns inside,
  `280px 1fr`, 24px gap:
  - **Left: the code.** 240px QR on a white `--radius-tile` plate with 12px of quiet zone. Under
    it, 11px `--text-meta` mono: the Mac's name and address, e.g. `Chetan's MacBook Pro ·
    10.108.253.63`. Under that, a `--text-meta` countdown — `code refreshes in 4:12` — and a
    `--accent-text` text button, "Show a fresh code".
  - **Right: the four steps.** A vertical list, 38px rows, each a 6px state dot + a 13.5px label,
    with the reached ones at `--text-primary` and the rest at `--text-meta`:
    1. *Waiting for a scan* — armed, nothing found
    2. *Found your phone* — an address answered (carries the mono address and how it was found:
       `mdns` / `gateway` / `last-known`)
    3. *Verifying certificates* — TLS handshake in flight
    4. *Paired* — `--live`, and the screen releases to Overview
    The dot on the **current** step pulses; the ones behind it are solid `--live`; the ones ahead
    are `--text-meta`. Never more than one pulsing dot, so the screen always answers "where is it
    stuck" without being read.
- **Below the card, `--elev-2`, full 560px**: "Not finding it?" with three 13.5px lines — same
  Wi-Fi network; the phone's hotspot works too; and a manual-address field with a Save button,
  which is locked decision #4's last resort surfaced at the one moment it is needed rather than
  buried in Settings.
- **Failure** is state B's banner, inset in the primary card: `rgba(245,178,61,.10)` on
  `rgba(245,178,61,.30)`, warning glyph, and the reason **verbatim**. Never `--destructive` — a
  phone that has not been paired yet has not failed.

### Copy, as drawn

> **Pair your phone** / Scan once. After that this Mac finds your phone on its own.
> **On your phone:** open ConnectSuite → **Mac** tab → **Scan pairing code**.
> Waiting for a scan · Found your phone · Verifying certificates · Paired
> **Not finding it?** Both devices must be on the same Wi-Fi. Your phone's hotspot works too.

### What it needs from the wire

Three things, in the order they matter. **Two of the four steps above are already derivable and one
is not**, which is the honest state of it:

| # | Need | Status today | Ask |
|---|---|---|---|
| P1 | Step 2, *Found your phone* | **Already derivable.** The phone publishes `_connectsuite._tcp` and the Mac's discovery reports `via`, so "found, at this address, by this method" is on hand | Nothing |
| P2 | Step 3, *Verifying* | **Already derivable.** The link exposes a `handshaking` phase | Nothing |
| P3 | Distinguishing *"nobody has scanned"* from *"scanned, and the connection is failing"* | **Not possible.** The phone is the listener and the Mac dials out, so before mDNS resolves there is no signal that a scan happened at all. The screen would sit on step 1 through a genuine failure | A scan-time announcement, or an accepted-then-closed signal. mDNS publication at scan time is the cheapest and needs no protocol change — only that the phone registers the service the moment the code is scanned rather than when the listener is ready |
| P4 | A reason when pairing is refused — token expired, fingerprint mismatch, user declined on the phone | **Not possible.** The Mac sees a closed socket and nothing else, so the banner would have nothing verbatim to render and would have to paraphrase, which is exactly what defect 27 was | `pair.reject { reason }` sent before the close, written for a person, never parsed. One message |
| P5 | The countdown | Mac-side only — `armPairing` already holds `expiresAt`; the renderer is simply not told | Expose it on the status payload. No wire change |

**P4 is the one worth a protocol line.** Without it the most common real failure — a code that went
stale while the user walked to their phone — renders as an indefinite "Waiting for a scan", which
is the silent-no-op shape this project keeps ruling out, on the very first screen a new user sees.

---

## Cross-cutting — decided, not yet built

| # | Design draws | Decision | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| X1 | **"Encrypted"** badge on the Messages thread header (§6) | Cut | **reshaped** | Our *link* is TLS 1.3. An **SMS is not encrypted**, and a badge on a message thread reads as a claim about the message. It is the only place in the mockups that makes a security claim the transport cannot back | Nothing could. The badge would be correct on the *connection* strip, where it is already true |
| X2 | **Two-factor**, **Sign out everywhere** (§12 Security); account email and **PRO** pill in the sidebar | Cut. **Trusted devices is kept** | **reshaped** | `CLAUDE.md` line 1: no cloud, no account, no relay server. There is no account to sign out of, no tier, and no second factor. `TrustedDeviceEntity` is real, so that row stays | An account system, which is explicitly not this product |
| X3 | **Connection-state cycler** (§12 Advanced) | Cut from shipping. May live behind a debug flag | **reshaped** | A control that makes the UI claim a connection state the link is not in — a lie-generator wired to the exact surface this project uses to tell the truth. It is genuinely useful for demoing the state machine, which is what the flag is for | Nothing. It is a review tool and should be labelled as one in the design |
| X4 | **Archivo** throughout | **SF Pro** (`-apple-system`), mono is `SF Mono` | **reshaped** | Taken under the handoff's own sanction: *"SF Pro is an acceptable native swap."* The page's CSP is `style-src 'self'`, so a `fonts.googleapis.com` import is blocked, and vendoring woff2 puts a webfont in an app whose first line is *no cloud* | Nothing needed — this is the design's own permitted substitution |
| X5 | Media remote, Contacts, QR pairing / first run, the capability list, manual address, log tail | **No pane in the design** | — | Not a departure yet, because nothing is built against it. Recorded here because these are **shipped, working features with nowhere to live** — pairing especially: the design's first screen assumes a paired phone, and a Mac with no phone paired has no drawn state at all | Screens for them. Pairing is the urgent one |

---

## How to read the two "missing from the design" rows

**N4** and **X5** are the only rows where the gap runs the other way — the wire has something the
design does not draw. They are the ones most worth a designer's time, because everything else here
is us declining to draw a thing that would be false, and those two are us needing a thing that would
be true.
