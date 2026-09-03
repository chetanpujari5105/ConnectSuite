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

Last updated **2026-09-01** — push landed and **F4 closed**; before that the Files pane landed (§Files, F1–F7). Before that, 2026-08-30: the app shell landed (§"App shell", S1–S12), every routed screen was
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

## Photos — **built 2026-08-31**, on three of the feature's four verbs

The canvas's structure is kept exactly: a **188px `ALBUMS` rail** and the grid inside one panel, with
a **320px detail card** beside it as a sibling on the canvas. What departs is the *content* of the
rail and one state the design does not contain.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| P1 | A curated rail of six smart albums — All photos, Camera, Screenshots, Downloads, Videos, **Favourites** | **All photos** (synthetic) followed by every `MediaStore` bucket the phone reports, newest first. On this handset that is **149 albums** | **reshaped** | The phone has buckets, not smart albums. Four of the design's six happen to exist as buckets, `Videos` is a *type* spanning every bucket, and **Favourites does not exist on the wire at all** — there is no favourite flag in `MediaStore` that a non-gallery app can read. Drawing the design's six would mean inventing two of them | A `favourite` field on `media.list`, and a type filter distinct from the bucket filter. The first is a platform question, not a protocol one |
| P2 | The rail's first row is a smart album | **All photos** is synthetic, not a bucket — it sends `media.list` with **no `bucketId`**, which the phone already answers with every bucket merged under one ordering | **reshaped** | It costs nothing on the wire and it is a better default than "whichever bucket holds the newest file", which on this handset opened the pane on `Download` — 108 items, and not what anyone means by *my photos* | Nothing. This is the design's intent expressed in the phone's vocabulary |
| P3 | Album counts as fixed strings (`12,456`) | The phone's own `count` per bucket, grouped for the locale | **shipped** | `media.buckets` publishes the count, and it is the denominator `media.list`'s pages have to sum to — the number that tells a working pager from one that stalls after its first page | Nothing |
| P4 | A photo opens at full size | **Save to Mac** on the detail card: the original is pulled over the bulk channel into `~/Downloads/ConnectSuite` and the card says where it landed | **shipped 2026-09-01** | Slice 3. It saves rather than *opens* — opening means choosing an application on the user's behalf, and the file has to exist locally first either way. Opening it after saving is a small addition; guessing which app is not | Nothing for the save. A preview *inside* the pane is a separate design question — it needs a decode path and a viewer, neither of which the canvas draws |
| P5 | No state for *the phone has this and is not fully offering it* | A `--warning` banner above a **working** grid: **Thumbnails only, for now**, shown only while the capability is unadvertised | **reshaped, and now conditional** | This is N4's gap in its sharper form. N4 was a feature the phone was not offering *at all*; this is the first feature in the app that is **half offered** — three verbs answer, the fourth does not exist — so the `photos` capability is correctly not advertised while the pane works. The banner is what makes that a designed inconsistency rather than an accidental one | A drawn *partial* state in the design language, distinct from both `unavailable` and `empty`. Second row in this file where the **design is missing something** rather than the wire |
| P6 | Tiles at the design's size | Tiles at `minmax(112px, 1fr)`, square, `object-fit: cover` | **shipped** | Measured at 126 × 126 in a 1440-wide window, four columns beside a 320px detail card | Nothing |

**P5 outlived the situation that produced it, which is the useful part.** Slice 3 turned the
capability on and the banner disappeared with it — driven by one fact, so the chip and the copy
cannot disagree. The state is still drawn and still reachable: any phone that advertises three verbs
without the bulk channel gets it, which is what a version skew between a new Mac and an older phone
looks like. It was built for a situation we created deliberately and it now covers one we did not.

**P5 is the row to read if you read one.** The pane deliberately does **not** gate on the `photos`
capability. Gating would have turned a partly-working feature into a dead one and told the user
"unavailable" about something they can watch working. The rule the pane follows instead: say which
half is missing, in the words of the thing they are about to try, and use `--warning` rather than
`--destructive` — a feature arriving in two halves is not a failure, and red in a connection product
reads as *the link is down*.

The genuinely-unavailable state is still separate and still drawn: with the photos permission
ungranted the phone answers `PERMISSION_DENIED`, and the banner carries the phone's own sentence and
its fix hint **instead of** the grid. Those two must not look alike — one says *this works, but not
all of it*, the other says *this does not work yet, and here is the switch*. **The unavailable branch
is drawn but has not been seen on hardware**: exercising it means revoking a grant the user made by
hand, which is not something to do to someone's phone for a screenshot.

## Files — **built 2026-09-01**, on the read half

The canvas's structure is kept: a left rail, a `NAME` / `DATE MODIFIED` / `SIZE` table, and a 320px
detail card beside it. What departs is almost everything the rail and the drop tiles *contain*,
because the design draws a path-based filesystem and `targetSdk 36` does not have one.

Three of these are **walls** — Android forbids them and no version of this app can draw them. They
are grouped here rather than spread through the table because they are one fact: `fs.*` browses the
SAF trees a user has granted, one folder at a time, and there is no view of the whole of storage.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| F1 | **Internal storage** as a root, with `Alarms`, `Android`, `DCIM`, `Downloads`, `Music` beneath it | The roots `fs.list` returns: `ConnectSuite`, plus one row per granted tree | **wall** | There is no path-based view of shared storage at `targetSdk 36`, and the **root of internal storage cannot be granted to anyone** — the picker lists it and disables `USE THIS FOLDER`. Drawn as the design has it, four of those five rows would open on an error | `MANAGE_EXTERNAL_STORAGE`, which is **deliberately not requested**: whole-of-storage is the one permission that makes people uninstall an app whose pitch is no cloud and no account |
| F2 | **Downloads** as a browsable folder | Absent, and named in the pane's own copy as the folder that cannot be reached | **wall** | `Download` itself is refused by the picker, observed through our own package. It is also the folder a user is most likely to go looking for, which is why it gets a sentence rather than silence — the copy is in the rail in every state, and in the M2 card's body | Same as F1 |
| F3 | **Android** as a browsable folder | Absent, and named on the phone's Folders screen | **wall** | `Android/data` and `Android/obb` are unreachable by any route, for any app, since Android 11 — including through the document picker, which blocks those two trees explicitly | Nothing. This one is not even a permission |
| F4 | **"Drop files to send to phone / or click to choose"** and **"Drop here to download to Mac / or pick a folder"** | **The send tile is drawn** — one drop target, reading *"Drop files here to send them to DCIM"*, named for wherever the breadcrumb currently is. The download tile is not: pulling is per-file from the listing, not a folder-shaped drop | **shipped 2026-09-01** (send) · **reshaped** (receive) | Push landed in slice 8. The tile is gated on the phone's own `push` field in the roots ack, never on a Mac-side constant — **absent means false**, so it does not appear over a phone that would answer `FEATURE_UNAVAILABLE`, and it appeared the moment the new phone build connected. One fact drives the tile and the degraded banner together, so they cannot disagree | Nothing for the send tile. The receive tile would need a folder-drop gesture the pull path does not have |
| F5 | Footer reading **"1 selected · 3.2 MB"** and **"1,245 items"** | `28 items`, or `200 loaded · more on the phone` while a directory is still paging | **reshaped** | `fs.list` has no total, and getting one means paging to exhaustion — defect 55's 16,377 entries, 33 pages. `1,245` would be a number with nothing behind it, which is the rule `CLAUDE.md` opens with. What the pane can honestly say is how much it holds and whether there is more | A `total` on the `fs.list` ack. The phone would have to count the directory to send it, which is the same cost moved |
| F6 | Breadcrumb **"Internal storage / DCIM / Camera"** | The root's own label, then the path — **`DCIM › Camera`** | **reshaped** | The first segment is a fiction under SAF: there is no parent above a granted tree that this app can address. The rest of the breadcrumb is real and is exactly what `(rootId, path)` names | Nothing. This is the design's intent in the phone's vocabulary |
| F7 | **No state for *this failed to load*** — the canvas has none, anywhere | Five drawn states, and the two that matter differ four ways: colour, glyph, headline verb, and whether a retry exists | **reshaped** | A pane showing no folders and a pane whose request died are the same picture. This is the **third** row in this file reading *the design is missing something* rather than *the wire is missing something*, after N4 (unavailable) and P5 (partial) | A drawn failure state in the design's language. `#FF5D5D` already exists as the failure colour, so the palette is there — what is missing is the state |

**F7 is the row to hand the designer, and it is now three rows deep.** N4, P5 and F7 are one gap
seen from three angles: the canvas draws features that work and features that are empty, and nothing
else. A product whose whole subject is a link to a device that goes in and out of range spends a
meaningful part of its life in states the design does not contain, and each pane has now invented
its own version of them.

**What the four differences are, and why four.** Measured in the running app, in one window, minutes
apart — `M2` (one root) against a real `M4` produced by revoking the folder on the phone while the
Mac still had it selected:

| | M2 — shared one folder | M4 — couldn't open |
|---|---|---|
| Headline colour | `rgb(244, 244, 247)` — `--text-primary` | `rgb(255, 93, 93)` — `--destructive` |
| Border | `rgba(255, 255, 255, 0.08)` — hairline | `rgba(255, 93, 93, 0.3)` — `--destructive-border` |
| Headline | *"This phone has shared one folder"* — what **is** | *"Couldn't open this folder"* — what **happened** |
| Retry | none | **Try again**, and the phone's code (`ROOT_NOT_GRANTED`) in mono |

One difference is a bug away from none: colour alone fails for a reader who cannot distinguish it,
the glyph alone fails at a glance, the headline alone fails the moment someone reuses a component.
Each of the four was deleted in turn and the guard went red for each — `filesRoots.test.ts`.

**Not a departure, and worth saying so: there is no "Add folder" control on the Mac and there will
never be one.** There is no `fs.grant` message; the inventory is fixed at twelve types, and a
thirteenth that made the phone open a picker would be the Mac reaching for a consent surface only a
person holding the phone can answer. The phone's own `grantHint` is rendered verbatim in the rail
instead. The canvas does not draw such a button, so nothing is being removed — this is here so that
nobody adds one.

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
| P4 | A reason when pairing is refused — token expired, fingerprint mismatch, user declined on the phone | ~~**Not possible.** The Mac sees a closed socket and nothing else~~ — **closed 2026-09-03.** `pair.rejected` is in the contract and the phone sends it; the Mac now renders **its own copy keyed on `reason`**, which is what the contract asks for and the opposite of the `error` rule, and arms a fresh code in the same beat. `docs/testing.md` → Phase 7 Slice 12. **The wire half is unproven** — producing one needs a scan, and the stimulus is written out there | Done. The row is kept struck rather than deleted because *"not possible"* was true when written and stopped being true without anything in the build noticing |
| P5 | The countdown | Mac-side only — `armPairing` already holds `expiresAt`; the renderer is simply not told | Expose it on the status payload. No wire change |

**P4 is the one worth a protocol line.** Without it the most common real failure — a code that went
stale while the user walked to their phone — renders as an indefinite "Waiting for a scan", which
is the silent-no-op shape this project keeps ruling out, on the very first screen a new user sees.

---

## Cross-cutting — decided, not yet built

| # | Design draws | Decision | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| X0 | **Eleven sidebar rows.** No Apps screen — the handoff predates the feature | A **twelfth** row, **Apps**, appended to the end of the MENU group with `⌘0` | **reshaped** | App launching is on the Reference behaviour list and had no drawn home. Appended rather than inserted, deliberately: inserting it after Mirror would renumber ⌘3–⌘9 and move seven rows of muscle memory, which is a far larger departure wearing the same size diff. `navModel.test.ts` asserts the count is twelve and that Apps is last in MENU, so a thirteenth cannot arrive without somebody deciding to | A drawn Apps screen. The grid is a 104px auto-fill of 48px icons with two-line labels, which is a guess at the design language rather than an application of it — worth a pass. This is the fourth row where the **design is missing something** rather than the wire |
| X1 | **"Encrypted"** badge on the Messages thread header (§6) | Cut | **reshaped** | Our *link* is TLS 1.3. An **SMS is not encrypted**, and a badge on a message thread reads as a claim about the message. It is the only place in the mockups that makes a security claim the transport cannot back | Nothing could. The badge would be correct on the *connection* strip, where it is already true |
| X2 | **Two-factor**, **Sign out everywhere** (§12 Security); account email and **PRO** pill in the sidebar | Cut. **Trusted devices is kept** | **reshaped** | `CLAUDE.md` line 1: no cloud, no account, no relay server. There is no account to sign out of, no tier, and no second factor. `TrustedDeviceEntity` is real, so that row stays | An account system, which is explicitly not this product |
| X3 | **Connection-state cycler** (§12 Advanced) | Cut from shipping. May live behind a debug flag | **reshaped** | A control that makes the UI claim a connection state the link is not in — a lie-generator wired to the exact surface this project uses to tell the truth. It is genuinely useful for demoing the state machine, which is what the flag is for | Nothing. It is a review tool and should be labelled as one in the design |
| X4 | **Archivo** throughout | **SF Pro** (`-apple-system`), mono is `SF Mono` | **reshaped** | Taken under the handoff's own sanction: *"SF Pro is an acceptable native swap."* The page's CSP is `style-src 'self'`, so a `fonts.googleapis.com` import is blocked, and vendoring woff2 puts a webfont in an app whose first line is *no cloud* | Nothing needed — this is the design's own permitted substitution |
| X5 | Media remote, Contacts, QR pairing / first run, the capability list, manual address, log tail | **No pane in the design** | — | Not a departure yet, because nothing is built against it. Recorded here because these are **shipped, working features with nowhere to live** — pairing especially: the design's first screen assumes a paired phone, and a Mac with no phone paired has no drawn state at all | Screens for them. Pairing is the urgent one |

---

## How to read the "missing from the design" rows — now three of them

**N4**, **P5/X5** and **F7** are the rows where the gap runs the other way — the wire has something
the design does not draw. They are the ones most worth a designer's time, because everything else
here is us declining to draw a thing that would be false, and these are us needing a thing that
would be true.

They are also, read together, one request rather than three:

| Row | The state the wire has | The pane that had to invent it |
|---|---|---|
| N4 | *the phone has this feature and is not offering it right now* | Notifications, 2026-08-30 |
| P5 | *the phone is offering **half** of it* | Photos, 2026-08-31 |
| F7 | *asking failed, and that is not the same as there being nothing* | Files, 2026-09-01 |

Three panes have now each drawn their own version of the same missing vocabulary. A fourth will
invent a fourth, and they will not match. **The ask is small: unavailable, partial, and failed, in
the design's language, once.** The palette already carries the colours — `--warning` for the first
two and `#FF5D5D`, documented as failure-only, for the third — so what is missing is the drawing and
not the tokens.

---

## Structural — Messages and Calls are a different layout from the design's (2026-08-30)

Measured in `docs/testing.md`, "Measurement pass, third run", section 2. Recorded here because it
is **scheduled work,
not a decision**: unlike every row above, nothing here is us declining to draw something. The
tokens are right on both screens, which is exactly why it reads as a styling near-miss instead of
what it is.

| Screen | Design | Build |
|---|---|---|
| Messages | `grid(280px 539px 300px)` — list, open thread, and *this conversation's* detail, side by side | `grid(815px 320px)` — list **or** thread with a back link, plus a global contacts directory |
| Calls | `grid(300px 519px 300px)` — list, live-call card, dialer keypad | ~~one full-width pane holding all three, with no keypad and no in-call controls~~ — **built 2026-09-04 as `300px 1fr 300px`**, with the filter strip, the running clock and the keypad. The in-call controls stay cut; see rows C1–C7 below |

**Six of the eight gaps need nothing on the wire** and are Mac-side layout: the three-column shapes,
the All/SMS/Chat and All/Missed/Contacts filter tabs, the running call timer, and the keypad
(`call.dial` already exists).

**Two need protocol that does not exist**, and are the designer's to confirm before they are built:

| Design element | What is missing | Question for the designer |
|---|---|---|
| **Mute / Speaker** on the live-call card | `call.*` is `incoming`, `ended`, `log`, `dial`, `answer`, `reject`. Nothing carries a mute or an audio route, and the phone half needs an `InCallService` | Are these worth an `InCallService` and two new messages, or should the card say the call is controlled on the phone? |
| **Keypad during a call** (DTMF) | no message carries a DTMF digit | Same question — an IVR is the only real use, and the phone is an arm's length away |
| Messages third column: shared media, Mute notifications, Block contact | no wire support; shared media overlaps `media.*`, unspecified until Phase 5 | Should this column wait for Phase 5, or ship without the media grid? |

**One row where the build is ahead and the design should follow.** The live-call card's audio line:
the design says *"Audio is routed through Galaxy S26 Ultra"*, the build says *"Audio stays on the
phone — pair the Mac to it over Bluetooth"*. Both state the platform wall; only ours names the
remedy. The design's copy should adopt it.

---

## Calls — **built 2026-09-04**, three columns. Rows C1–C7

The structural row above is discharged for Calls: the pane is `300px 1fr 300px`, with the
All / Missed / Contacts strip, the running call clock, the 3×4 keypad and *Frequently called*. What
follows is the list of things the handoff draws that are **not** on screen, one row each, and every
one of them is a capability the wire cannot back rather than an omission.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| **C1** | A **40-bar waveform** under the caller's name, animated | Nothing. The card goes name → number → clock → controls | **wall** | **There is no audio on this Mac, in either direction.** `CAPTURE_AUDIO_OUTPUT` is system-only and AccessibilityService call recording violates Play policy — `CLAUDE.md`'s first platform wall. A waveform is a *picture of a signal*, so drawing one over silence is the most literal available form of claiming a capability the wire does not have. An idling flat line would be worse, not better: it reads as *the other person is not speaking* | Nothing. Not "no protocol yet" — no route exists for any app |
| **C2** | **Mute** and **Speaker** on the live card | One line: *"Mute, speaker and keypad tones are on the phone. Nothing on the wire carries them."* | **unbuilt** | `call.*` is `incoming`, `ended`, `log`, `dial`, `answer`, `reject`. Nothing carries a mute or an audio route, and the phone half needs an `InCallService` — a role the user grants, not a permission | Two messages and an `InCallService`. Still the designer's call, unchanged from the row above: is a Mute you press on a Mac you cannot hear through worth the role prompt? |
| **C3** | **Keypad** as an in-call control (DTMF) | The keypad is on the right and types a number **before** a call. It cannot send a tone into one | **unbuilt** | No message carries a DTMF digit. The distinction matters and is drawn in the pane rather than hidden: a keypad that looks in-call and does nothing is worse than an absent one | A `call.dtmf` verb. An IVR is the only real use |
| **C4** | **"End-to-end encrypted"**, lock glyph, on the live-call card | Cut | **reshaped** | Our *link* is TLS 1.3. The **call** is a cellular call this Mac does not carry one byte of, and a lock badge on a call card is a claim about the call. Identical reasoning to **X1**, which cut the same badge from a Messages thread — this is the second sighting, and the pattern is that the badge is correct on the *connection* strip and false on anything the phone does independently of us |
| **C5** | Twelve keys, no delete | Thirteen: the design's 3×4, plus **⌫** under `#` | **reshaped** | A keypad with no way back is unusable the first time a finger slips, and the field is 300px away from where the eye is. The 3×4 the handoff draws keeps its shape; the delete sits under it | A drawn delete key. This is a **design gap**, not a wire one — the fifth row in this file where the gap runs that way |
| **C6** | Only a call **in progress**. There is no drawn state for *no call* | A headline, what will appear here, and the audio wall | **reshaped** | This is the **fifth pane to invent its own empty state** — after N4 (Notifications), P5 (Photos), F7 (Files) and A2 (Activity). Recorded loudly rather than styled quietly: four could be bad luck, five is a missing vocabulary. See *How to read the "missing from the design" rows* | The one drawn *unavailable / partial / failed / empty* set that four rows have now asked for |
| **C7** | *Frequently called* — three people, each labelled **Mobile** | The three most-called **numbers** from the phone's own log, each labelled with **how many calls** | **reshaped** | There is no favourites list on the wire, so the list is derived. It is grouped by number because a number is what you can dial. The count is drawn because the count is what the word *frequently* asserts — a list of three names with the basis removed is the denominator rule in a sidebar. The number's *type* (Mobile / Work) is not in `call.log` and is not guessed at | `call.log` carrying the number type, or a favourites verb. Neither is worth a message on its own |

**The clock is a measurement and is drawn as one.** `00:02:18`, three fields always, ticking on a
one-second interval from `startedAtMs` — not a formatted label. `callsView.test.ts` asserts the
interval exists, because a clock that does not tick is a label wearing a clock's formatting and the
two are indistinguishable in a screenshot.

**The Contacts tab asks the phone.** It is not a filter over the call log — there is no book on the
Mac to filter, and a local filter stops finding people whose number is stored in a format nobody
typed. A contact with no number is drawn *and says so*: "not in the list" and "in the list with
nothing to dial" are different facts about a person, and hiding the second makes the search look
broken.

## Clipboard — **built 2026-09-04**, two columns. Rows K1–K6

`1fr 340px`, measured back at `795px 340px` in a 1151px content column: the list with its filter
strip and **Clear all**, and the selected entry beside it with Information and the sync timeline.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| **K1** | Tabs: **History / Favourites / Pinned** | **All / From phone / From this Mac**, each with its count | **reshaped** | Favourites and Pinned both mean *this survives*. `docs/phase-5-clipboard-proposal.md` §6 is the first at-rest storage decision in this project and it says the opposite: 20 entries, **memory only**, cleared on disconnect, gone on restart, never on disk. A star that vanished when the phone went out of range would be a lie about the word — and the fix for that is a database, which is the decision §6 declined to make. The strip carries the filters the data supports instead | A decision to persist the history. That is a §6 reversal, not a UI change, and it would want the same standard §6 was written to: what is on disk, for how long, and what reads it |
| **K2** | Five kind badges: `URL`, `Aa`, `IMG`, `{}`, `FILE` | `URL`, `Aa`, plus one per state kind — `LOCK`, `UNDO`, `—`, `64KB`, `?` | **reshaped** | **Three of the five cannot occur.** `docs/protocol.md`: `clip.push` carries `kind` of `text`, `empty` or `sensitive` and a text body — there is no image, file or attachment in this namespace. A badge that can never be drawn is a promise in a legend. **`{}` is cut for a different reason and it is the more interesting one:** *code* is a guess. Braces, semicolons and indentation all mislabel a shopping list, and a badge that is wrong some of the time is worse than an absent one because nothing on screen says which you are looking at. `URL` is **not** a guess — `openableUrl` either parses the whole string as an http(s) URL or it does not | An image or file clipboard, which is a `clip.*` redesign. The `{}` badge needs nothing from the wire and a rule somebody will defend |
| **K3** | Row actions: **copy** and a **star** | The row selects; the actions are in the detail column | **reshaped** | The star is K1's. Copy moved because the detail column is where the entry is shown in full, and two Copy buttons for one entry is the second copy that stops matching |
| **K4** | Detail actions: **Copy / Open / Share** | **Copy** (or **Restore**), and **Open** only for a link | **reshaped** | macOS's share sheet is `NSSharingServicePicker` and Electron does not expose it; there is nothing to substitute that is not a different feature wearing the label. **Open is drawn by the same function that decides whether opening is permitted** — `src/shared/clipLink.ts` — and it is strict on purpose: an entry is a string a phone sent, and `openExternal` opens whatever a scheme is registered to on this Mac (`file://` opens Finder, `x-apple.systempreferences://` opens a Settings pane, every installed app may claim its own). http and https only, and prose containing a link is **not** a link, because otherwise the button and the row disagree about what is about to happen | Electron exposing the share sheet |
| **K5** | Sync timeline: *Copied on phone 09:42:03* → *Synced to ConnectSuite 09:42:04* → *Available on Mac 09:42:04* | *The phone read its clipboard* → *Arrived on this Mac* → *Put on this Mac's clipboard* / *Not put* / *not recorded*, each dated step labelled with **whose clock** | **reshaped** | **"Copied on phone" is the wrong sentence, not a missing timestamp.** Android forbids a background clipboard read — measured, Slice 11, 90 of 90 refused — so the phone reads its clipboard when ConnectSuite comes to the front, which may be an hour after somebody copied. `atMs` is *when the phone read it*. Drawing it as "copied" is a true-sounding sentence about the wrong moment, which is precisely the shape defect 63 was: nobody checking it would find it false, because the mechanism it names is real and is not the one in front of the reader. The clock labels are the second half: `atMs` is the phone's and `receivedAtMs` is this Mac's, with **no correction between them**, and a timeline that stacked them unlabelled invites somebody to subtract one from the other and call the difference latency | Nothing on the design's side. This is the build being more precise than the drawing, and the drawing should adopt it |
| **K6** | Footer: *128 items in history* | *N of 20 entries, in memory only — cleared when the phone disconnects, gone when this app restarts, never written to disk* | **reshaped** | Same §6. The bound is the interesting half of the number, and a bare count invites the assumption K1 cuts |

**A Mac→phone entry gets one recorded step and a pointer.** The `clip.push` ack says whether the
phone applied it and this history does not keep that — the Activity log records all three outcomes
as distinct rows. So the second step says so and carries no time, rather than inventing one.

**`undefined` and `false` are two different final steps.** `applied === false` is *not put on this
Mac's clipboard*; `applied === undefined` is *whether it reached this Mac's clipboard was not
recorded* — an entry from before the field existed. Collapsing them is the absence-read-as-a-negative
failure inside a timeline.

**Clear all confirms, and says what it did not touch.** The history is memory-only, so a cleared
entry is gone from everywhere; and the thing a person will fear is that the button also emptied
their pasteboard. It did not, and it does not touch the echo interlock either — `clearHistory` is
separate from the disconnect path's `clear` for exactly that reason: `linkDropped()` forgets what
this side last *sent*, so reusing it would make the next watcher poll read this Mac's unchanged
clipboard as new and push it to the phone. **Emptying a list must not cause a send.**

---

## Open question — when does latency stop being green?

The prototype draws the Overview latency figure in `#32E58A`, the success colour. The build draws it
neutral, and is **deliberately not being changed** until this is answered: colouring it green
unconditionally would have the card report a 600ms link in the success colour, on the one card whose
job is to say whether the link is healthy.

The handoff's colour table assigns `#32E58A` no threshold, and the prototype contains a single
latency value, so nothing in the design distinguishes *"latency is always green"* from *"10 ms is
green"*. **What figure does it stop at, and is there an amber band before red?** Measured in
`docs/testing.md`, "Measurement pass, third run", section 1.6.

---

## State A — two routes are kept and marked, where the note said remove them (2026-08-30)

`docs/mac-ui-design-proposals.md` §3, state A, says of a screen with nothing behind it:
*"Nothing routes to it that implies it works. No dock tile, no Overview quick-action tile, no ⌘K
command."* The build keeps two of those three routes and **marks** them instead. Recorded here
because `shell.ts` has claimed since `3f8b90f` that it was, and it was not — a comment pointing at a
record that does not exist is the same shape as a claim with no evidence behind it.

| Route | The note says | The build does | Why |
|---|---|---|---|
| **Dock tile** (Files, Camera — 2 of the design's 5) | remove | keep, desaturated, tooltip and `aria-label` read *"Files — not built yet"* | Removing two leaves a three-tile dock. That is a change to the design's own composition made for a reason that **expires as each phase lands**, and it reflows the dock every time a feature ships. A marked tile carries the same information and the dock stops moving |
| **⌘K palette row** | remove | keep, with `Not built yet` in place of the group name | A palette that hides five screens **disagrees with the sidebar about which screens exist**, which is a worse lie than a marked row. Someone who has seen these mockups will type "Files" and deserves a sentence rather than no result |
| Overview quick-action tile | remove | **not applicable** — the build has no quick-actions grid (departure S10; the dock is that grid, once) | — |

The clause is honoured where it costs nothing: the sidebar row drops from `--text-body` to
`--text-meta`, carries no badge, and its accessible name ends *"— not built yet"*.

**What would change this:** the note's reasoning is about implying a feature works. If a marked
tile still reads as working to someone who has not hovered it, the tiles should go. That is a
question for the designer, and it is the only part of state A the build takes a different view on.

---

## Structural — Settings is two columns against the handoff's three (2026-08-30)

Measured in `docs/testing.md`, "Measurement pass, third run", section 5.5. Unlike most rows in this
file this is not read off the prototype — **the handoff states it in prose**: *"Three columns
`200px 1fr 320px`. Left: eight panes — General, Connection, Notifications, File transfer, Mirror,
Security, Advanced, About."*

Measured: design `200px 599px 320px`, build `200px 927px`. The rail carries three of the eight panes.

| Missing | Verdict | Blocked on |
|---|---|---|
| **General** — start on login, menu bar, appearance, sounds, updates | real, Mac-side | **Phase 7** (needs macOS integration, and it is that phase's subject) |
| **Notifications** — label + sub + value rows | real, Mac-side | nothing — buildable today |
| **File transfer** | real | **Phase 5**, ships with the feature |
| **Mirror** | **already built, elsewhere** — it is the Mirror pane's side panel | a relocation decision, not a gap |
| **Security** | mostly **cut by X2** — no account means no two-factor and no "Sign out everywhere". Trusted devices is real and lives in Connection | — |
| the **320px right column** — version, Account, PRO, Manage subscription, Billing history, Help, encryption note | mostly **X2**: subscription and billing do not exist in this product. The real parts (version, the encryption statement) are already our **About** pane | — |

**The question for the designer:** with Security and the account column mostly cut by X2, and Mirror
already living in the Mirror pane, the design's eight panes reduce to about four for this product —
General, Connection, Notifications, File transfer — plus Advanced and About. **Is a 320px third
column still worth drawing** once the account block leaves it, or does Settings become two columns
by design rather than by omission?


---

## Files, added 2026-09-01 (Slice 9) — F8 and F9

**F8 — the canvas drags a file straight from the phone to Finder; this copies first.**
`webContents.startDrag` needs a path that exists at the instant the gesture begins, and a `dragstart`
handler cannot await a network copy — the gesture is over long before the bytes are. macOS *has* file
promises for exactly this and Electron does not expose them.

So a row is draggable **after** it has been copied, the detail card carries a **Copy to Mac** button
(`#files-copy-to-mac`), and a drag of an uncopied row cancels itself and starts the copy — so the
second drag works and nobody has to read anything to discover the order. The one sentence in the
detail card says why rather than leaving it to be inferred. **This is the platform, not a
simplification**, and it will stop being a departure only if Electron exposes promised files.

**F9 — the canvas's left rail lists only folders the user shared; this leads with two they did not.**
`Received files` and `ConnectSuite` are on every phone before anything is granted, and `Received
files` is where a push lands with no grant at all — so it is the most useful row in the rail and it
sorts first. The canvas had no equivalent because the grant-free destination did not exist when it
was drawn.

The consequence, and it bit immediately: **anything counting "how many folders has this phone
shared" must count `kind === 'tree'`.** The rail's length is not that number, and reading it as one
made the pane's almost-empty state — where the `Download` wall lives — unreachable for everyone.
`sharedFolderCount` is the one home for it.

---

## Activity — **built 2026-09-02**, the last unbuilt pane but one

The canvas's structure is kept: a paged table with `ACTIVITY | DETAILS | TIME`, a filter chip row
above it, and a 320px rail beside it carrying a donut, a seven-day sparkline and **Export log as
CSV**. What departs is the chip set, and — the row worth reading — the fact that the artboard draws
**one** state where the pane has five.

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| **A1** | Five chips: **Mirroring · Files · Messages · Calls · System** | The same five in the same order, plus **Clipboard**, and a chip is drawn **only for a category present in the log** | **reshaped** | Clipboard shipped after this artboard was drawn and its events have to land somewhere. Folding them into *System* would make a filter that does not find the thing its user came looking for, which is worse than one more chip. The second half — only drawing a chip for a category that exists — is the rule the count beside it makes necessary: a permanent `Calls 0` chip is a filter that can only ever produce an empty table, which is a fifth state manufactured by the UI | Nothing on the wire. This is the design's chip set plus one feature it predates |
| **A2** | Nine rows and a pager, and **no other state** | Five states with ids: **A1** reading, **A2** unreadable, **A3** nothing recorded, **A4** nothing matching this filter, **A5** the table | **reshaped** | This is N4 and P5's gap in its sharpest form yet. A3 and A4 are the pair — *nothing has ever happened* and *nothing matches Files* would render as the same blank table, and a user cannot tell "nothing has been transferred" from "nothing is recorded, ever". They differ in four independent ways (headline verb, body, whether the filter is named, whether the chip row survives as a way out) and `shared/activity.test.ts` asserts all four | A drawn *empty* and a drawn *filtered-empty* state in the design language. **Fourth row in this file where the design is missing something** rather than the wire |
| **A3** | A donut with four fixed legend rows, and `48` in the middle | The donut over **today**, with a legend row only for a non-zero category — and, when today has none, a **sentence instead of the chart** | **reshaped** | A donut with no arcs and a `0` in the middle is a chart of nothing that still looks like a chart. `Calls 0` beside a ring with no calls arc is a row that takes the eye and says nothing. The design's four rows are this rule with the data it happened to have | Nothing |
| **A4** | A seven-point sparkline with day labels | The same, **including days with zero**, and the **peak printed beneath it** | **reshaped** | Two reasons, both the same rule. Drawing only the days that had events compresses a quiet week into a straight line that looks like a busy one. And a sparkline with no scale is a shape, not a measurement — one event a day and a hundred a day draw the identical curve, which is a count with no denominator wearing a chart | Nothing. A y-axis in the design language would be better than the printed peak |
| **A5** | `Showing 9 of 48 events` | The same, plus the **filter name** and the unfiltered total: `Showing 9 of 12 Files events · 48 in all` | **reshaped** | With a filter on, `9 of 12` is a true sentence about the wrong denominator, and the design's string cannot say which one it means | Nothing |
| **A6** | **Export log as CSV** | The same, through a save dialog, RFC 4180 quoted, oldest-first, carrying the sequence number | **shipped** | The quoting is not decoration: a detail can hold a comma, a quote or a newline — a file name, an app label — and a CSV that breaks on the first one loses rows silently. Oldest-first with the `seq` column means two exports can be diffed | Nothing |
| **A7** | A timeline over "every sync, transfer and session" | Six categories fed from **eleven named recording sites, all in `main.ts`** | **reshaped** | The subtitle promises everything and the store records what the main process can see as an *event* rather than as a log line. Photos, notifications and contacts have no rows yet — deliberately, since none of them has an event the Mac observes rather than a request it makes. Recording sites are enumerated `R1`–`R11` in one file so a hole is something a reader can find | A recording site per feature. It is a small addition each; the design does not constrain it |

**A2 is the row to read if you read one, and it is the fourth of its kind.** N4 was *the phone has
this feature and is not offering it*; P5 was *the phone is half offering it*; F-series added *the
grant exists and the folder is gone*. This one is **the Mac's own empty**, and it is the first where
both halves of the ambiguity are entirely local — no phone, no wire, no permission. The design draws
populated screens because populated screens are what a design is for; the states that cost users
their afternoon are the other four, and each time this file records one it is the same request:
**a drawn language for nothing-here, distinguishing at least empty, filtered-empty, failed and
loading.**

**Not a departure, recorded so it is not read as one:** the pane deliberately keeps working while
the link is down. It is the only screen whose data never comes from the phone, and *what happened
before it dropped* is exactly the question somebody has when it is down.

---

## Cross-cutting, added 2026-09-02 — the palette reaches inside a screen

| # | Design draws | Built instead | Status | Why | What would make the design's version correct |
|---|---|---|---|---|---|
| **X8** | A ⌘K palette over **commands and screens** | The same, plus a third kind — **deep links**, which route to a screen and then reveal a card inside it. Two today: *Now playing* (in Overview) and *Contacts* (in Messages) | **reshaped** | Measured on 2026-09-02: the palette returned **nothing** for *music*, *playing*, *remote* and *contact*, with the control that it returns six rows for *mirror*. Eleven screens were reachable by search and three shipped features were not. Both cards are above the fold and perfectly visible — this is a findability gap, not a layout one, which is why nothing moved | Either a drawn treatment for the media remote and for contacts (a screen, a dock tile, a Quick actions slot), or a drawn palette row for a destination that is a card. Until one exists, the deep link is what ships |
| **X9** | Quick actions: **8 tiles**, header `8 available`, every tile a route | Unchanged — and the media remote is **not** added to it | **unbuilt, needs one sentence from the designer** | A ninth tile for a card on the same screen is a different kind of thing from the eight, and it makes the count line either wrong or misleading | Knowing whether Quick actions means *the eight screens* or *the things you do most*. Under the first nothing changes; under the second the remote belongs there and the header needs rewording |
