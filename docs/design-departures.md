# Where the built UI departs from `ConnectSuite.dc.html`, and why

**For the designer.** One page, one row per departure. Nothing here is a complaint about the
design — every row exists because the *wire* cannot currently support what the design draws, or
because Android cannot. Each row says what would have to become true for the design's version to be
built as drawn.

**Design authority.** `design_handoff_connectsuite/ConnectSuite.dc.html` plus its `README.md` is the
final design for this app. Where a screenshot disagrees with those two, they win. This file is the
only place a *deliberate* deviation from them is recorded; if a difference is not in this table, it
is a bug, not a decision.

### ⚠ The superseded second reference — do not rebuild against it (recorded 2026-09-16)

**There is exactly one design authority and for one day there were two.** On **2026-09-16**,
`docs/testing.md` Slices **59**, **60** and **61** rebuilt three Overview surfaces — the **Device
hero**, **Recent activity** and the **media card** — each *"against a reference mockup"* supplied
in-session. That reference is **not** `ConnectSuite.dc.html`, it is not in this repository, and it
is **superseded as of 2026-09-16**. Nothing may be rebuilt against it again.

**Why it is recorded rather than deleted from the slices.** The slices are evidence and evidence is
not edited; what was wrong is not the work, it is that three slices said *"rebuilt against a
reference"* without saying **which**, so a later reader has no way to tell a handoff-conformant
surface from a divergent one. Both were called *the reference*.

**What it actually cost, measured 2026-09-16 at 1920 × 1080 through `scripts/probe.mjs`.** Six
Overview departures exist only because the two references disagree, and none was recorded as a
departure at the time:

| | `ConnectSuite.dc.html` + README | Built 2026-09-16 against the second reference |
|---|---|---|
| Recent activity row height | **52px** | **104px** — doubles the card to 626px and is the whole of the column imbalance below |
| Recent activity icon tile | **26px** | **56px** |
| Recent activity time column | absolute mono `09:42` | relative `5m ago` |
| Recent activity heading | h3 **15px** (`Section + card title 15–21px`; all three Overview card titles are 15) | **21px** |
| Media card heading | *(no media card is drawn — X5)* | `MEDIA REMOTE`, **10.5px uppercase**, a size in no row of the type scale |
| Device hero fact grid | **2×2**: Connected via / Latency / Encryption / Signal — **no battery, no storage** | **six rows**, adding Battery and Storage, which the Device status rings already carry |

**The rule this leaves, and it is the transferable part.** A rebuild is scored against a named
authority or it is not scored at all. When work is briefed against an image, the brief says whether
that image *is* the handoff or *supplements* it — and if it supplements it, every difference is a
departure row in this file on the day it ships, not a discovery three weeks later. The failure is
the one `CLAUDE.md` already names about phase rows: nothing in the build can compare two designs,
so a second authority is invisible until somebody reads both.

**Status column.**

- **wall** — Android forbids it. It will not become true; the design's version cannot be built by
  anyone. The control is *removed* and one line of copy replaces it, because a greyed control is a
  promise it might one day light up.
- **unbuilt** — nothing on the wire yet, but nothing stops it. The named change would make it real.
- **reshaped** — built, but not in the shape drawn, because the underlying thing is not what the
  design assumed.

Last updated **2026-09-16** — the superseded second reference recorded above, and the Overview pane
re-scored against the handoff (rows **O6–O14** at the end of the Overview section). Before that,
**2026-09-01** — push landed and **F4 closed**; before that the Files pane landed (§Files, F1–F7). Before that, 2026-08-30: the app shell landed (§"App shell", S1–S12), every routed screen was
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
| M16 | The float's phone controls as a **hover dock** — a pill on window hover, bottom-centre above the nav bar | A **permanent 40pt bar along the bottom**, part of the window's height rather than drawn over the picture. It was a 36pt right-edge rail from 2026-09-15 until later the same day; see M18 | **departure** | Three measurements, not a preference. `opacity: 0` at rest on the one window whose purpose is to be watched while something else has focus; a pill over a canvas that now takes taps, which `float.css` had already warned would be a silent dead zone; and `bottom: 36px`, which on a ratio-locked window is Android's own gesture bar. Defect 115 — and note that the report said *"at the top"*, while the measurement put them at 92% of the way **down** | A float that is never the only surface — the Mac notifying, and the main window reachable (117). Then a hidden control is an accelerator rather than the only route |
| M17 | The float window is the phone's shape | It was **permanently portrait** — `RATIO` was a module constant, so a landscape phone was letterboxed into a portrait frame at a fifth of the area | **closed 2026-09-15** | Not a departure; the build did not match the drawing. The ratio is the announced capture's now and the **outer bounds** follow it, preserving the picture's area rather than its width — keeping the width is what makes landscape tiny. Defect 114 | — |
| M18 | — | The control strip moved from the **right edge** to the **bottom**, and gained hover tooltips | **departure, 2026-09-15** | Owner's request: make it Android's own navigation-bar shape — buttons in a row, under the screen — rather than a toolbar bolted to the side. A geometry change, not a CSS one: `RAIL` (a width) became `BOTTOM_BAR` (a height), so the picture gains the whole window width and the height budget loses 40pt. The handoff draws neither, so this is a departure from a drawing that has no control strip at all. Defect 118 | The designer drawing a control surface for a window that is watched while another app has focus. §3 assumes a hover dock, which that window cannot use |

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
| S6 | Status island **cycling** — "Connected · 10 ms", "Clipboard synced", "Transfer complete · 4.2 MB" | **No rota at all.** The island is a projection of the live link: the connection state, a reason clause when there is a current failure, a latency when connected, and a transfer while one is in flight | **reshaped, twice — see the S6 section below** | The rota shipped, and the thing wrong with it was not which strings it held: it had **no clock**, so a line's maximum age was the session, and it wrote history text with the live tone in one statement. It contradicted the device strip two inches away, daily. A cycling island is a **history** surface, and this product already has one — Activity, which timestamps and filters all eleven categories | Nothing. The design's rota is the departure now: an island that narrates the past cannot also be the thing you glance at to see the present |
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

The structural row above is discharged for Calls: the pane is `300px 1fr 300px`, measured at
`300px 508px 300px` with the page scrolling, with the All / Missed / Contacts strip, the running
call clock, the 3×4 keypad and *Frequently called*.
> **A `1fr` figure here depends on whether the page is showing a scrollbar, and two honest readings
> of the same grid differ by 11px because of it.** The numbers below were re-taken through
> `scripts/phase7-panes-probe.mjs`, which prints the viewport, the scrollbar width and whether the
> page scrolls **before** any width — `{inner: 1440, outer: 1440, scrollbarPx: 11, pageScrolls: true}`
> on this run. An earlier ad-hoc read of the same grids, on a page that happened not to be
> scrolling, gave 519 / 583 / 795. Neither is wrong; they are readings of two different content
> column widths, and it is the *two readings, one fact* family with an entirely mundane cause. Quote
> the scrollbar state with the number or the next person will hunt an 11px regression that does not
> exist.
 What
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

**C8 — the design's contact photographs, and they are drawn now (2026-09-05).** The design fills
every avatar disc with a photograph, and the build drew initials on a per-contact hue. That was the
one Calls row where the design was simply ahead of the build rather than ahead of the wire:
`contacts.get` has carried an optional base64 PNG since Phase 4 as one of the contract's two
deliberate exceptions to *no binary in JSON*, and the Contacts pane already used it. So this needed
no protocol change and no new verb — only for the Calls pane to ask.

It is drawn on all four discs (live card, log row, Contacts row, *Frequently called*), over initials
that stay underneath, so every refusal degrades to exactly the disc that was there before. Measured
on this handset: **22 of 53 discs carry a photograph**, from **224 of 665 contacts** that have one.

The one place the design still cannot be matched is **resolution**, and it is a phone fact rather
than a decision: 207 of those 224 pictures exist only as a 96px thumbnail (`photo_id`), and just
**17** have a 720px display photo (`photo_file_id`). The card's disc is 104px at DPR 2, so most
faces are drawn from a 96px source at 208 device pixels and are soft. There is no larger image to
fetch — `photo_dimensions` reports `thumbnail_max_dim=96` — and the alternative is a letter.
`docs/testing.md` → Phase 7 Slice 34.

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

`1fr 340px`, measured at `784px 340px` with the page scrolling: the list with its filter strip and
**Clear all**, and the selected entry beside it with Information and the sync timeline. See the
scrollbar note under **Calls** for why that figure moves by 11px between two honest readings.

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

## F6 / P3 — the Mac can tell "nobody scanned" from "scanned, and searching". **Built 2026-09-04, unproven on hardware**

`docs/phase-7-pairing-flow.md` J1 and J2 are the same Mac screen: *code up, nothing scanned* and
*code up, scanned, phone now looking for us*. To the person holding the phone those are entirely
different situations, and one sentence for both means **the first thirty seconds of a failed pairing
are indistinguishable from the first thirty seconds of a working one** — on the first screen a
stranger ever sees.

`TXT_PAIR_INTENT` was already in `docs/protocol.md` and typed in `shared/protocol.ts`, and the phone
half was built. This is the Mac listening: while a code is on screen it browses
`_connectsuite._tcp` for a service publishing `pairIntentKey` of **this Mac's own** fingerprint, and
adds one line to the pairing screen when it sees one.

**There is no negative, and that is the contract's own instruction rather than caution.** From the
declaration in `docs/protocol.md`: *a positive is trustworthy and a negative is not*, because mDNS is
the least reliable of the three discovery paths — dropped by client isolation, by some routers'
multicast handling, and by a phone that has simply not published yet. So the watch only ever *adds*
a line, there is no "nobody has scanned" event, and there must never be one.

| What is proven | How |
|---|---|
| The comparison is right | `shared/pairIntent.test.ts`, 6 tests. The one that matters is **a phone pairing with a different Mac does not match** — a Mac matching any `pair` attribute would announce somebody else's pairing as its own, silently and flatteringly, on the one screen where a stranger cannot check it |
| The watch arms with the code | Measured on the running app: arming a QR wrote `[pair-intent] Watching mDNS for a phone publishing 3030c8ebcddcd0fb`, with 2 lines total in the window, so the absence of anything else is a reading rather than a missed sample |

**What is NOT proven, and it is most of it.** *A registration line is not an execution line.* That
the watch is armed says nothing about whether a real phone publishes the record, whether this Mac's
browser sees it, or whether the screen then draws the line. All three need **an unpaired phone and a
scan**, and unpairing this phone would leave its owner with a Mac that cannot reconnect until
somebody walks over with the handset. So it is recorded as unproven with the stimulus named, in
preference to a pass criterion nothing met.

**The stimulus that would prove it:** forget the phone on the Mac, open the pairing screen, and scan
the code. The line should appear *before* the link comes up — that ordering is the whole feature,
because after the link is up the screen is gone. `[pair-intent]` in the Mac's log carries both the
arm and the sighting.

---

## S6 — the status island narrates real events. **Built 2026-09-04, and the row was hiding a defect**

The row said the handoff's rota — *"Connected · 10 ms"*, *"Clipboard synced"*, *"Transfer complete ·
4.2 MB"* — named two features that did not exist, and that the fix was *"small: the rota takes any
string."* Both features shipped in Phase 5. The wiring was indeed small. **What it uncovered was
not.**

**The rota was built, it cycled every 5.2 s, and it had never once been seen.** Two lines in
`setStatus` did it, and both look completely ordinary:

| | What it did | What that meant |
|---|---|---|
| `setIsland(...)` on **every** status update | `rttMs` changes on every heartbeat, so a status update lands every few seconds | whatever the rota had just cycled to was overwritten a second or two later, permanently |
| `note('Connected · 9 ms')` on every update, deduplicated against the **exact** previous string | `9 ms`, `8 ms`, `10 ms` are three different strings | six latency variants filled the entire six-slot rota inside twenty seconds |

So *"Clipboard synced"* could not have appeared **even once it was wired**: it would have been
evicted by latency jitter before the next cycle. And this is why nobody noticed for a month — **a
rota that is always overwritten looks exactly like a rota with one entry in it.** There is no
symptom. Every screenshot of the app since 2026-08-30 shows a status island reading
`Connected · N ms`, which is what it is supposed to read most of the time.

The rule now lives in `src/shared/islandRota.ts` with its tests: **the link owns the island's text
while the link is changing, and the rota owns it the rest of the time.** Latency is not an event; a
phase change is, and so is an error — an error seizes the pill immediately, because it is the one
thing on it somebody needs at the moment it happens rather than up to 5.2 seconds later. The dot's
tone still follows the link on every update: that is a colour on a live fact, not a line of history.

**Which events are narrated is a named list, not "everything except".** `clipboard`, `files`,
`messages`, `calls`. `system` and `mirroring` are excluded because the island **already narrates
those from the live status** — a five-minute-old *"Connected"* history entry alternating with the
live one is the same fact in two tenses. The corollary is the part worth keeping: a new
`ActivityCategory` does not silently start narrating, it falls through to silence until somebody
decides.

**And a second defect fell out of wiring it**, which is the denominator rule inverted. The
clipboard watcher's automatic send recorded an Activity event **only when the phone refused to
apply it**. So the Activity pane held *"Phone did not apply it"* rows with no successes beside them,
in the one pane whose entire job is to say what happened — and the island had nothing to narrate on
the path that fires most often. It records both now, at the same volume, once per real copy rather
than once per poll.

Measured on hardware, 2026-09-04: after two real copies made outside the app, the rota held
`["Connected", "Sent to phone · 57 bytes, automatically", "Sent to phone · 31 bytes, automatically"]`
and four consecutive 5.5-second samples of the island's text showed three different lines.

---

## Overview — Quick actions and Recent activity **built 2026-09-04**. Rows O1–O5

Two of the handoff's four cards were missing. Both are here now, in the columns the design puts them
in, plus the full-width footer strip.

| # | Design draws | Built instead | Status | Why |
|---|---|---|---|---|
| **O1** | **Quick actions**, eight tiles, *"8 available"* | The same eight, generated from `navModel.SCREENS`, counted as *"7 of 8 available"* | **reshaped** | The count is of the ones that **work**, with the total beside it. The design's 8 counts tiles; ours would be a bare 8 over a grid with a dead tile in it, which is the denominator rule with the denominator taken out. Camera is the dead one and stays **marked rather than removed** — state A's rule: removing it leaves a seven-tile grid that reflows the day it ships |
| **O2** | **Recent activity**, five rows and *View all* | The same | — | The row for this said it *"needs a session store nothing writes yet"*. `main/activity.ts` became that store on 2026-09-02 with eleven recording sites. **S10 is discharged** |
| **O3** | Tile captions: *Mirror & control*, *3 new*, … | The screen's own subtitle, and the live unread count where there is one | **reshaped** | A caption written on the dashboard is a claim about a screen, made somewhere the screen cannot correct it. The subtitle is the sentence the screen already owns. `0 new` is never drawn — the rule the sidebar badge follows |
| **O4** | **Device status** — battery, storage and memory rings | **Battery and storage rings, drawn from real pushes. No memory ring** | **built 2026-09-04, reshaped** | `battery.state` and `net.state` are both on `check-protocol-spec.mjs`'s debt list with **no handler on either side**, and there is no storage or memory message at all. Unchanged from **S4 / S5**, which say plainly: do not "fix" this. Three rings over three numbers nobody sends would be the most decorative thing in the app |
| **O5** | The footer strip: an encryption sentence and **Disconnect** | The same, and it goes quiet when the link is down | — | Both halves are real: our link *is* TLS 1.3 with a pinned certificate on both ends, and Disconnect is the call Settings → Connection makes. It is deliberately **not** the badge X1 and C4 cut — those were claims about an SMS and about a cellular call, neither of which this Mac carries a byte of. This one is about the only thing that is ours, and when nothing is connected it says *"Not connected. Nothing is being sent anywhere."* rather than leaving the screen's one security sentence standing over a dead link |

**The Overview drawing now lives in `OverviewView`, not in `renderer.ts`, and that move is the
finding.** It was three functions in `renderer.ts` for about an hour and shipped a bug in that hour:
the card took `events.slice(0, 5)` from a store that returns events **oldest first**, and drew the
five oldest things that had ever happened under a heading reading *Recent activity*. Nothing in the
suite could see it — `renderer.ts` needs `connect`, `shell` and a live DOM at module scope, so every
line of drawing in it is outside the project's entire test surface. It was caught by looking at a
screenshot, which is the fourth time a renderer-only break has been found that way.
`check-renderer-views.mjs` refused the commit until the new class had a test, which is the guard
working on the run that created its subject.

---

## Overview, re-scored against the handoff — **2026-09-16**. Rows O6–O21 (O19–O21 2026-09-17)

The pane was audited against `ConnectSuite.dc.html` and its `README.md` after three of its cards
were found to have been rebuilt against a **second reference**, now recorded as superseded at the
top of this file. Everything below was measured in the running app at a 1920 × 1080 window through
`scripts/probe.mjs`; `docs/testing.md` → **Phase 7 Slice 62** holds the readings with their controls.

**Eight of these thirteen are the build coming back to the handoff** — they are marked **corrected**
rather than given a status, because a departure that is being undone is not a departure. The five
that are genuine departures carry one.

| # | Design draws | Built instead | Status | Why |
|---|---|---|---|---|
| **O6** | Device status and the capability list as separate panels (the list is not drawn at all — X5) | **Corrected.** The capability card was a `.card` **inside** `#device-status-card` — the closing `</div>` had never been written — and is now a sibling at `grid-column: 1 / -1` | **corrected** | A bordered card inside a bordered card, and nothing in the build could see it: the HTML is valid, `tsc` has no opinion, and every test reaching `#caps` reached it either way. It read as plausible because the parent is `display: flex; flex-direction: column` with a gap, which is what a sibling looks like — and styles.css's own comment already claimed the intent was *"`.caps` follows it in the same column"*. **Full width rather than back into column two**, measured: as a column-two card it put **301px** of that column below column one, the reported dead space the same size on the other side |
| **O7** | Five activity tiles in teal, violet, green, blue and **grey**. No red anywhere | **Corrected.** A past `Disconnected` / `Connection failed` row drew `--tint-red-rgb`; it draws the grey system tint now, keeping its `alert-circle` glyph | **corrected** | The README: *"Red is reserved … never use red as an accent … in a connection product red reads as 'link is down.'"* The tile was not wrong about the **event** — that really was a failure — it was wrong about **when**: a list of past events sitting two inches under a header reading `Connected · 9 ms`. Red belongs to the live surfaces. The state survives as a **shape**, which is defect 26's rule and is what a reader who cannot separate the hues gets |
| **O8** | *"52px rows — mono time, 26px tinted icon, description, and a right-aligned detail"* | **Corrected.** 52px, 26px tile, 44px time column, card padding back to the shared 20px | **corrected** | Built at 104px / 56px / 62px against the superseded reference. This is the whole of the dead space: it doubled the card to 626px against a 399px neighbour. Measured after — **139px**, from 227px |
| **O9** | All three Overview card titles at `h3 15px/600/-0.015em` | **Corrected.** `.recent-title` was 21px; it reads `--text-section`, the same token `.card-title` does | **corrected** | Two sizes for one role on one pane — `Device status` and `What this phone can do` at 15, *Recent activity* at 21. The type scale has one row for it: *Section + card title, 15–21px*. Sharing the token is what stops the three drifting again |
| **O10** | No media card at all (X5) | **Corrected against the type scale.** `MEDIA REMOTE` at 10.5px uppercase, 0.12em, is now 15px sentence case in `--np-text` | **corrected** | 10.5px/uppercase/0.12em is the **sidebar group header** role and the only 10.5px in the scale is exactly that. On a card it was a fourth heading size on a pane that should have three. Nothing is drawn to copy here, but there is a scale, and this is a card title |
| **O11** | Hero fact grid is **2×2**: Connected via / Latency / Encryption / Signal. **No battery, no storage** | **Corrected.** Four cells — Connection / Security / Latency / Address, Address in Signal's slot per S5. The Battery and Storage rows are gone | **corrected** | Slice 59 made it six. Measured against the handoff that is **three** battery renderings on one viewport (sidebar card, this row, the O4 ring) and **two** storage. The fact is not hidden by removing it: the ring has a caption where a fact cell could only manage a dash, and Settings → Advanced carries the reading's age. This card is the link; the ring card is the device |
| **O12** | Footer strip: *"Connection is encrypted end-to-end. Only your devices can read this traffic."* | **Corrected.** The handoff's sentence, word for word | **corrected** | Ours read *"Encrypted end to end with Samsung SM-S938B…"*, a **third** rendering of the device name. It adds nothing here — it is the only phone this Mac is paired with, the name is 80px above in 21px type, and *"only your devices"* already says who the two parties are |
| **O13** | Nothing — the capability list is X5, undrawn | Chips read `Mirror`, `SMS`, `Microphone`; the wire id moves to `title="<label> — capability id: <id>"` | **reshaped** | They read `mirror`, `sms`, `mic` — lowercase wire ids in a sentence-case interface, which is `CLAUDE.md`'s package-id rule in a second namespace. `sms` and `mic` are the two that make it plain. An unknown capability still falls back to its own id, which is the honest answer and must not be "fixed" |
| **O14** | — | A `check` / `lock` glyph on every chip | **reshaped** | Defect 26 one layer out. 26 fixed the state for a screen reader with a hidden sentence and left a **sighted** reader who cannot separate green from grey with no signal at all — measured: available and unavailable differed in fill, border and text colour, and in nothing else. Both glyph names were already inside `navModel.iconNamesUsedByTheShell()` |
| **O15** | — | Every dimmed capability's reason is **drawn**, under the chips, in the phone's own words | **reshaped** | The card said *"Hover a dimmed one for the phone's own reason"* — the one fact on this card a person actually needs, behind the one gesture a keyboard cannot make. A `title` is not the fix either: defect 118 measured that `title` **never fires on keyboard focus**. Standing copy is this project's answer everywhere else (the Files rail's `grantHint`, Mirror's Advanced block) |
| **O16** | One `•••`, in the page toolbar. The Overview device card has none | **Corrected.** `#hero-more` and its menu are gone | **corrected** | Two overflow triggers 100px apart with no rule saying which held what. Both items already had another home and that was **checked before the trigger came out**: Disconnect is the footer strip's own button on this pane *and* a row in Settings → Connection; *Forget this phone* is the `danger` button in Settings → Connection |
| **O17** | A **mono absolute** time column (`09:42`), in both places the design shows activity | **Corrected.** The column is absolute; the relative age moved to the row's accessible name and `title` | **corrected** | Four rows all reading `3m ago` was the report. A relative time is unreadable exactly when several events arrive together, which on this product is most of the time — ringing, active and ended are three rows inside a minute. The age is not lost, and it is on the **aria-label** rather than only the tooltip, so it is not behind hover either |
| **O18** | Rows carry **no** affordance — the right-hand detail is metadata | **Corrected.** The `View log →` link is gone; all five rows keep the chevron | **corrected** | One row in five had a second affordance, so the list had two vocabularies and the failure row was the odd one. The chevron stays because Slice 60 earned it — every row routes to Activity. Settings → Advanced, where `View log` went, is reachable from the sidebar, from ⌘K and from the Activity pane the chevron opens; checked before the affordance was removed |
| **O19** | Storage ring value `128 GB` (capacity), caption `68 GB free`, arc at used | **Corrected 2026-09-17.** Value `490 GB`, caption `9.0 GB free`; the arc binding is unchanged | **corrected** | Built as the free figure in the ring over `free of 490 GB`. The **defect** report against this ring was withdrawn in Slice 62 — the arc was bound correctly — but the **assignment** still differed from the handoff, and withdrawing the first is not a reason to keep the second. `490 GB` is six characters, exactly on the is-long threshold: measured **47.0px** at 13px mono inside the **50.4px** clear span, so it keeps the full size |
| **O20** | A *"150px phone render"*: violet→teal at 150deg, two radial highlights, a 34×4 notch pill 8px from the top | **Corrected 2026-09-17.** Exactly that, from `--brand-grad-*`, `--tint-violet-rgb`, `--tint-cyan-rgb` and a new `--hero-phone-notch` | **corrected** | Slice 59 drew a neutral charcoal handset against the superseded reference, arguing a coloured rectangle *"reads as decoration"*. It **is** decoration, and the handoff says so. **No empty state**: nothing on the wire can fill this surface (no wallpaper or screenshot exists to send), so there is nothing for it to be empty of |
| **O21** | Security footer, full width, **last** on the pane | Same, and **below the fold at the design's 1440×920 window** — at rest top **1094**, visible band ends **874**, fraction 0; a 317px scroll brings it in | **departure from defect 85's rule, kept** | The strip carries a state — the encryption sentence and Disconnect — which is what defect 85's *visible at rest* rule exists for. **It cannot be met without departing from the handoff, and the handoff wins.** Measured, not argued: the handoff's own render at 920 puts its footer at **872–930** against a scroll band ending at **865** (one artboard, one footer match, one scroller as the control) — the design itself draws it off screen. Removing our capability card would only lift it to **889**, still 15px below. The routes that would work are all departures: a sticky strip (at rest it covers the last ~57px of Recent activity's fifth row, trading one hidden thing for another), or moving it above the activity row (it stops being a footer). Revisit if the designer's hour changes the pane's height budget |

**Three things this pass did not change, and two of them were reported.** They are listed because a
reported item with no row reads as an oversight:

| | |
|---|---|
| The **31px greeting** as the page title | The handoff's own: `### 1. Overview — "Good morning, Chetan"`, and *Page title 31px/600*. The name is already gone (D1); the greeting stands |
| The **dock**, the **`MENU`** group header, and **per-category tinted activity tiles** | All three are specified: *"Dock — bottom-center, 5 × 36px app tiles (Mirror, Files, Messages, Calls, Camera)"*, *"MENU group"* at *10px/600/0.12em/uppercase*, and *"26px tinted icon"*. Reported as defects; they are the design |
| The **device name appearing a third time** | In a *Recent activity* row's metadata, on a historical `Connected` event. That is the handoff's right-aligned detail carrying a fact about the past, not a third live indicator |

### What this pass left measured and unresolved — resolved 2026-09-17

**`#caps-card` and `#overview-strip` are `reachable`, not `visible`, at the design's own 920px
window**, and the two were resolved differently. **The capability list is reference, and may
scroll.** **The strip is not** — it carries a state — and it is row **O21**: a recorded departure
from defect 85's rule, because the handoff's own geometry puts its footer off screen at 920px and
every route to visibility departs from the handoff.

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

## Structural — ~~Settings is two columns against the handoff's three~~ **closed 2026-09-04**

Measured in `docs/testing.md`, "Measurement pass, third run", section 5.5. Unlike most rows in this
file this is not read off the prototype — **the handoff states it in prose**: *"Three columns
`200px 1fr 320px`. Left: eight panes — General, Connection, Notifications, File transfer, Mirror,
Security, Advanced, About."*

~~Measured: design `200px 599px 320px`, build `200px 927px`. The rail carries three of the eight panes.~~

**Built 2026-09-04: `200px 572px 320px` with the page scrolling, six panes in the rail.** The difference from the design's `200px 599px 320px` is gap arithmetic plus an 11px scrollbar, not a decision — see the scrollbar note under **Calls**. The rows below are kept because the *reasoning* in them is still live — every one of them is either now built or now has a numbered departure of its own.

| Missing | Verdict | Blocked on |
|---|---|---|
| **General** — start on login, menu bar, appearance, sounds, updates | real, Mac-side | **Phase 7** (needs macOS integration, and it is that phase's subject) |
| **Notifications** — label + sub + value rows | real, Mac-side | nothing — buildable today |
| **File transfer** | real | **Phase 5**, ships with the feature |
| **Mirror** | **already built, elsewhere** — it is the Mirror pane's side panel | a relocation decision, not a gap |
| **Security** | mostly **cut by X2** — no account means no two-factor and no "Sign out everywhere". Trusted devices is real and lives in Connection | — |
| the **320px right column** — version, Account, PRO, Manage subscription, Billing history, Help, encryption note | mostly **X2**: subscription and billing do not exist in this product. The real parts (version, the encryption statement) are already our **About** pane | — |

### What the six panes are, and why not eight — rows S13, G1–G7, T1–T3

| Pane | State |
|---|---|
| **General** | **built** — Start on login and the appearance segment are real; three rows are cut with a reason each (G1–G4) |
| **Connection** | built since 2026-08-30 |
| **Notifications** | **built** — the sound switch, the refusal report, and three rows cut with a reason (G5–G7) |
| **File transfer** | **built** — every row a value rather than a control, which is the honest shape (T1–T3) |
| Mirror | **not a pane.** It is the Mirror screen's own side panel and always has been. A second copy in Settings is the second copy that stops matching |
| Security | **cut by X2.** No account means no two-factor and no "Sign out everywhere"; Trusted devices is real and lives in Connection, beside the thing it is about |
| **Advanced** | built since 2026-08-30 |
| **About** | built since 2026-08-30 |

**S13 — the third column arrived with two of its three cards.** The brand-and-version card and the
encryption note are real. The Account card, the PRO pill, Manage subscription, Billing history and
Help are X2's cut, and the design's green *"You are up to date"* card became *"Nothing leaves your
network"*: there is no update server to be up to date with, and the encryption sentence is the half
this product can actually sign. **This answers the question below in the affirmative** — the 320px
column is worth drawing without the account block, because two real cards fill it and without it the
three columns read as two and a floating list.

| # | Design draws | Built instead | Status | Why |
|---|---|---|---|---|
| **G1** | **Keep in the menu bar**, a switch | A value: *Always on* | **reshaped** | The tray is created unconditionally at launch and closing the window is what keeps notifications arriving and the clipboard syncing. There is no state to flip. A switch permanently on that cannot be turned off is a control in name only |
| **G2** | **Appearance** — System / Light / Dark, the first two greyed | **A live segmented control; all three work** | **discharged 2026-09-16** | The greying was honest while it lasted — it was the *designer's* statement, *"Dark is the flagship theme. Light arrives next."*, not a promise this build was making. Light has arrived, so the statement of intent became a control: `<button>`s in a `role=radiogroup` with `aria-checked`, reading their value back from the main process rather than assuming it from the click. **`System` genuinely follows macOS** — proven by flipping the OS under a running app, with an explicit choice as the control that must *not* follow. The row also gained a sentence the design has no slot for: what `System` **resolved to**, because "System" alone names the preference and leaves the user to guess what is on screen. `docs/testing.md` → Phase 7 Slice 55 §7 |
| **G3** | **Interface sounds** — *"Play a sound on transfers and alerts"* | Cut, tagged **Not yet** | **unbuilt** | Nothing in this app makes a sound except a native notification, and that switch is on the Notifications pane where it belongs. There are no transfer or alert sounds to turn off |
| **G4** | **Automatic updates** | Cut, tagged **Not yet** | **unbuilt** | There is no update server. Sibling of X2 rather than a new argument |
| **G5** | **Mirror phone notifications**, a switch | A value: *Follows the grant* | **reshaped** | Mirroring is on whenever the phone's notification-listener grant is, and revoking it is a phone setting. A switch beside a fact is a control that cannot change it |
| **G6** | **Inline replies**, a switch | A value: *Where the app offers it* | **reshaped** | Whether a reply box exists is the sending app's decision — it is `RemoteInput` on the notification — not a preference |
| **G7** | **Per-app filters** and **Quiet hours** | Cut, tagged **Not yet** | **unbuilt** | Nothing on the wire carries a per-app rule, and a list held only on this Mac is a filter the phone keeps sending through. macOS already has quiet hours and it applies to these banners like any other; a second schedule would be a rule that silently disagrees with the system's. **The suppression rules that do run are facts about a notification** — group headers, ongoing statuses, replayed backlog — never opinions about an app, and that is deliberate |
| **T1** | **Save downloads to** — a configurable destination | `~/Downloads/ConnectSuite`, shown and revealable, **not configurable** | **unbuilt** | Configurable means a picker, a persisted path, a security-scoped reference, and an answer for a folder that is renamed, unmounted or on a volume that is not there — with a transfer already in flight. It is a day's work with a real failure surface, not a checkbox. The path is read from `main/downloads.ts`, which is now the **one** place that decides it: it was written out twice, and a third copy on a settings screen is the one that goes stale — a screen showing a folder the app does not use is worse than no screen, because it is what somebody consults when they cannot find their file |
| **T2** | **Convert HEIC to JPEG** — *Ask* | Cut, tagged **Not yet** | **unbuilt** | Converting means decoding every image on this Mac and handing somebody a file that is not the one on their phone. A decision, not a missing checkbox |
| **T3** | **Transfer over Wi-Fi only** (in Advanced) | A value: *Always* | **reshaped** | There is nothing else to use. This Mac only ever reaches the phone over the local network or USB — it never leaves the local network at all, so "Wi-Fi only" is not a setting, it is the architecture |

**Reveal in Finder creates the folder first.** `showItemInFolder` on a path that does not exist is a
silent no-op on macOS — no error, no window — and this folder does not exist until the first
transfer. A button that does nothing on a fresh install, indistinguishable from a broken one, is the
silent-no-op shape this project rules out everywhere else.

**Start on login reads the answer back out of macOS.** `setLoginItemSettings` returns `void` and
there are real conditions in which it does not take — a login item the user disabled in System
Settings, a translocated bundle. So the switch flips back to what the system reports and says what
happened, rather than drawing its own intention as a state.

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

---

## M13 — the float takes pointer input · **closed 2026-09-14**

The float window's canvas took no taps or swipes because pointer input has to quote the geometry
stamp a frame was captured against and cancel an in-flight drag when the phone turns — defects 20
and 19 — and retyping that would have been a second copy of safety-critical code. The seam named in
this row now exists: `renderer/pointerGestures.ts` holds the recogniser, `MirrorView` was refactored
onto it in the same change, and the float calls the same object. One copy, two windows.

## F7 — the float button closes on its second press · **departure from handoff §2, 2026-09-14**

§2 specifies the second state as **"Show floating window"**, which *"only refocuses the existing
window"*. It now reads **"Close floating window"** and closes.

**Owner's decision, and the reason is not a preference.** A control whose second press does not undo
its first is not a toggle; every person who pressed it expected the window to go away. It also leaked
an open float across two diagnostic runs in Slice 43, where "click it again" was the obvious cleanup
and did nothing.

**What is lost, recorded rather than glossed:** the refocus affordance. A float hidden behind other
windows is raised by clicking it or via the dock, not from this button. If that bites, the repair is
a third state — focus when open-and-unfocused, close when open-and-focused — and it is a hidden
mode, which is why it was not the first move.


## M16 — the hover dock is a permanent edge strip · **departure from handoff §3, 2026-09-15**

§3 draws the float's phone controls as a **hover dock**: a pill that appears on window hover,
bottom-centre above the nav bar, `opacity` and `transform` only. It shipped exactly like that. It is
now a permanent strip — a 36pt **right-edge rail** when this row was written, and a 40pt **bottom
bar** since the same day (see **M18**) — and the change is a departure rather than a fix to a wrong
implementation: the implementation matched the drawing.

**Three measurements, not a preference.** Defect 115:

- **`opacity: 0` at rest.** This is the one window in the app whose purpose is to be watched while
  another application has focus, which is exactly when the pointer is not inside it. A control that
  only exists under a pointer is a control that does not exist on the window it was drawn for.
- **It sat over the picture.** `float.css` already carried a warning that an invisible pill over the
  canvas would be *"a silent dead zone the moment it takes input"*. The canvas took pointer input on
  2026-09-14 (row M13), and the warning came true without anyone noticing.
- **`bottom: 36px` is Android's gesture bar.** On a ratio-locked window that lands on the phone's own
  Home, so the Mac's Home button sat on top of it.

**The strip is chrome, not an overlay**, and that is the part the design could not have anticipated:
it comes out of the window in `shared/floatGeometry.ts` exactly as `TITLE = 34` does, so the picture
keeps the phone's exact aspect and nothing covers a part of the screen the canvas would otherwise
accept a tap on. Drawing it on top would have been the smaller change and would have reintroduced
the dead zone.

**It was a 36pt right-edge rail for part of one day and is a 40pt bottom bar now** — see **M18**. The
argument above is unchanged by that; only the axis moved.

**What is lost, recorded rather than glossed:** the design's uncluttered float. There is a permanent
40pt bar where there was clean edge, and it costs height rather than width — the picture at the 300pt
default is the full 300pt wide, and the window is 40pt taller than the ratio alone would make it.

**What would make the design's version correct:** a float window that is never the only surface —
i.e. the Mac notifying and the main window being reachable — so that a hidden control is an
accelerator rather than the only route. Row 117 fixed the second half of that; the first is
`docs/phase-7-state.md` §5's finding that the Mac never notifies anyone of anything.

## M17 — the float window turns with the phone · **closed 2026-09-15**

Not a departure: the design assumes the float is the phone's shape, and it was not. `RATIO` was a
module constant, so a landscape phone was letterboxed into a portrait frame at a fifth of the area.
The ratio is now the announced capture's, and the window's **outer bounds** follow it — preserving
the picture's area rather than its width, because keeping the width is what makes landscape tiny.
Defect 114, proven on hardware in both directions.

## M18 — the control strip is a bottom bar · **departure from handoff §3, 2026-09-15**

§3 draws a hover dock. **M16** replaced it with a permanent strip and gave the three measurements
that forced it. This row records the second move, made the same day at the owner's request: that
strip was a **vertical rail on the right edge**, and it is a **horizontal bar along the bottom** now.

**The reason is recognisability rather than a measurement.** A phone has a navigation bar under its
screen; a window that mirrors a phone and puts Back, Home and Recents down its right-hand side reads
as a remote control rather than as a phone. Nothing was wrong with the rail — M16's three faults were
all fixed by it and none of them has come back.

**It is a geometry change and was treated as one.** `RAIL = 36`, a width taken from the side, became
`BOTTOM_BAR = 40`, a height taken from the bottom beside `TITLE = 34`. The two axes are not
symmetric: width loses its only consumer, so the picture spans the whole window; height gains a
second one, so every function that turns available height into a width caps lower — the README's
≈401 at 920pt tall becomes **383**. The transcription test asserts both figures so the document stays
checkable beside a build that made it smaller. `docs/defects.md` → 118.

**What is lost:** 40pt of height where the rail cost 36pt of width. On a 300pt window that is a
slightly shorter picture rather than a slightly narrower one, which is the better trade for a
19.5:9 phone and the worse one for a landscape phone — and the landscape case was measured rather
than reasoned: picture 1494 × 688 at an announced 0.462, agreeing to within 0.001.

**What would make the design's version correct:** unchanged from M16. A float that is never the only
surface, so a hidden control is an accelerator rather than the only route.

**Tooltips came with it**, and they are the one place this window does *not* follow the rest of the
app: `title` is used in eleven places elsewhere and is right there, but it never fires on keyboard
focus. The bar draws its own — 450 ms on hover, immediate on focus — with the text from the same
table as the label, so there is no second copy of any string.

## The native-macOS pass — **2026-09-17**. Rows N-P1–N-P3, N-M2, N-M4, N-M7–N-M10

**Authority, stated so this is not the 2026-09-16 failure again.** The owner briefed a visual and
motion pass *"so it looks and feels like a native macOS app"* and chose, when asked, that **the brief
wins over the handoff where they disagree, and every disagreement is a row here, in the same
change.** The handoff remains the design authority for everything below not named. The brief, its
measured audit and the motion plan are `docs/native-mac-pass-audit.md`; the evidence is
`docs/testing.md` → Phase 7 Slice 63.

| Row | Handoff | Built | Why | What would make the handoff's version right |
|---|---|---|---|---|
| **N-P1** | Battery ring `#32E58A`; capability chips on in green | Battery bar neutral (`--value-arc`), `--warning` only when low; an *on* capability is brighter text, a firmer hairline and the `check` glyph | A hue carries one meaning (tokens.css, *What a hue is allowed to mean*). Green is *the link is up / it worked*; a battery at 80% is neither, and twelve green chips beside a green status dot read as twelve connection states | A second green that is visibly not the connection green — which is two greens, which is the problem |
| **N-P2** | Device status as three SVG progress rings (two built, O4) | A readout (label, 21px mono value), a 4px bar, a caption; fill animates `transform: scaleX` | Two 72px rings in a ~790px card left most of it empty (audit B3), and the rings had **never animated** — the arc was rebuilt at its final value on every update. The brief allows a ring only for a live, animated value; a bar says the same number in less chrome | A Device status card sized to rings, i.e. the handoff's narrower column |
| **N-P3** | Nav pill with a violet glow; toggle track with `0 0 16px` violet glow | No glow on either; the pill keeps its tint, border and lit top edge | A zero-offset coloured halo is decoration, and neither native control draws one | — (taste; reversible in one declaration each) |
| **N-M2** | Route change re-runs the content entrance, 260ms, with a 50ms card stagger | `.page` fades in over 140ms, opacity only; no stagger | Measured ~410ms before a click stopped moving, on the most frequent pointer action in the app; the pill already carries the spatial story | Routes being rare, which they are not |
| **N-M4** | *(island not specified; the build pulsed every live dot forever)* | One 600ms halo when a dot **enters** `live`, then still | *Pair once, then be quiet*; a permanent ~0.36Hz loop in peripheral vision is the reverse | — |
| **N-M7** | Button press `scale(.98)` 80–120ms | `scale(.97)` at 100ms press / 160ms release; `.94` for round icon buttons | Eleven hand-picked press scales (.94–.985) became two tokens | — |
| **N-M8** | ⌘K panel scales in (220ms) | Opens in one frame | Keyboard-initiated and the most frequent action; Spotlight and Raycast do not animate it | — |
| **N-M9** | Dock magnification (listed *droppable*) | Kept, critically damped, `1.18` / `1.06`, fine-pointer hover only | The overshoot curve was the only bounce in the app, on a hover, which carries no momentum to earn it | — |
| **N-M10** | Card hover: `translateY(-2px)` + border | No hover on `.card` | A card is not a control; a hover promises a click it does not answer. Rows, tiles and buttons inside keep theirs | Cards that open something |

**Not departures** (the build returning to the handoff, or new where it drew nothing): the Start /
Stop mirroring pair — only one is on screen now (audit B1, a defect); the card material (the handoff
specifies vibrancy for chrome and draws cards translucent); the four-step type scale and the caption
role (the handoff's scale, with 59 half-pixel literals brought back onto it); the two-state selection
rule; the status island's tone-change fade; the Recent activity arrival; reduced transparency.

---

## The Sidekick visual-language pass — 2026-09-17. Rows V1–V9

**Authority, stated the same way the native-macOS pass above states it.** The owner briefed a
second visual pass the same day, this one supplying a written brief
(`sidekick-visual-brief.md`, read from disk) rather than a screenshot: a lime-on-black palette,
named components (gradient hero card, pill button rows, circular icon badges, filled/ghost
segmented tabs, oversized stat numbers, gradient linear progress bars), each mapped to specific
panes. **The brief wins over both the handoff and the native-macOS pass where they disagree, and
every disagreement is a row here** — the same discipline, the second time it has been invoked in
one day.

**Figma was checked first, per the brief's own instruction, and found empty.** `sidekick-mac-app-ui`
(`8Y36t8bfF4EsVN2RYwuEKB`, page `0:1`) returned `width=0 height=0`, no children, and a 1×1 screenshot
— confirmed by the owner directly in a browser rather than assumed from the MCP read. So the
priority collapses to **brief > `.dc.html` (structure only)**, and the frame-to-pane mapping the
brief asked for does not exist to produce.

| # | Handoff / native-macOS pass | Built | Status | Why |
|---|---|---|---|---|
| **V1** | `--accent` violet `#8b6bff`, restored and re-argued twice already today | `--accent` lime `#c6ff33` (dark), `#9ed600` (light, a fill only — never text-on-white) | **departure** | The brief names lime as the hero colour by hand, for the accent's exact job list — "primary buttons, active tab fill, and progress fills" — the same three roles `--accent` already owned. `--accent-text` in light is `#4f5e00`, measured 7.16:1 on white (linear-luminance both channels), so the hue survives contrast the way the violet-to-`#5b4ae0` derivation did |
| **V2** | N-P1: battery/storage bars neutral (`--value-arc`) when the reading is fine, colour only in `--warning` | `.vital-fill` (Device status) takes a lime gradient (`linear-gradient(90deg, var(--accent-hover), var(--accent))`) when fine; `--warning` unchanged for low | **departure from N-P1** | The brief names "progress fills" as one of lime's jobs, hours after N-P1 made the same fill neutral for the opposite reason (a hue must mean one thing). Both readings are defensible; the brief is later and explicit, so it wins, and `--value-arc` — now drawn by nothing — was deleted rather than kept "in case" |
| **V3** | No gradient hero card anywhere; `.card.primary` is opaque `--elev-3`, the one exception in the app's material system | Overview's connection-status card only: `linear-gradient(135deg, var(--hero-grad-1) 0%, var(--hero-grad-2) 55%, var(--hero-grad-3) 100%)` plus a radial lime bloom and a `feTurbulence` grain overlay (`.hero::after`, `mix-blend-mode: overlay`, opacity .06) | **new** | The brief names this exact card ("the Overview pane's connection status... not Device status") and is explicit that it is the only one: "exactly one hero card in the entire app." `--text-primary` sits on the dark end of the gradient throughout; the bloom is positioned away from the text column so it never has to compete with it |
| **V4** | Hero card's own two actions (`Start mirroring`, `Device info`) live inside it, under a divider (`.hero-actions`) | A three-pill row (`.hero-pill-row` / `.hero-pill-action`) moved outside the hero card, underneath it: `Start mirroring` (still `.primary-action`, now lime), `Device info`, and a new third — `View activity`, routing where `#recent-all` already does | **reshaped** | The brief asks for "pill buttons in a row of three... placed under the gradient hero card," which the handoff's two-button internal row is not shaped for. The third pill is a choice the brief left open; `View activity` was picked because it is the one Overview destination with no other entry point up here, not because the brief named it — flagged rather than silently invented |
| **V5** | `.pill-tab.selected` — a soft accent tint (`--selection-fill`, ~15% alpha) plus border, on Calls/Notifications filters; `.segment.is-on` — the same tint, on Settings → General → Appearance | Both take a **solid** `--accent` fill with `--accent-on-fill` (near-black) text | **departure** | "Segmented pill tabs: one filled lime-on-black, one plain ghost/outline... replace the current chip row styling with this filled-vs-ghost pair pattern." The unselected half was already the ghost half (transparent, hairline, dim text) under the two-state selection rule; only the selected half's fill strength changes, from a tint to a solid |
| **V6** | Notification app-tile (`.app-tile`, generated-hue, no fixed art) and the Apps pane's launcher-icon tile (`.apps-tile-art`, real PNG) both `border-radius: var(--radius-control)` / `12px` | Both `border-radius: var(--radius-pill)` (a true circle) | **departure** | "Circular icon badges: a soft-edged colored circle (not square)... for app icons in the Apps pane and service icons in Notifications." Named for exactly these two spots. The Apps tile is the one with a cost: a real launcher icon is drawn to its own square corners, so the circular mask crops them — accepted, since it is the same trade the brief's own reference apps make |
| **V7** | The dock: five 36px app tiles (Mirror, Files, Messages, Calls, Camera), no sixth slot; ⌘K opens from the header's Search button only | A sixth slot, `.dock-slot-raised` / `.dock-tile-raised` — 46px, solid lime, `margin-top: -14px` so it visibly breaks the top edge of the dock bar — opens the palette, same as the header button | **new** | "Raised, colored circular action button breaking out of a bar... give the single most-used global action (⌘K) this raised-circle treatment in the dock." Additive: the header's Search button is untouched, so ⌘K is reachable exactly as before plus this. No entrance animation on the new slot — matched against `find-animation-opportunities`, below |
| **V8** | Battery/storage numerals: `.vital-value`, `600 21px` mono, unchanged since N-P2 | Unchanged | — | "This is already the Battery/Storage treatment; just restyle it into the new palette, don't redesign it." Nothing to do beyond V2's fill colour — recorded so the row is not read as skipped |
| **V9** | Light theme: not addressed by the brief, which is written dark-first ("true near-black base... not dark grey") | Given AA-safe derivations anyway — lime accent darkened for text (V1), hero gradient lightened to pale green with the same lime bloom, `--hero-grad-glow` at lower alpha | **new, conservative** | Dark is the flagship theme (G2) and the brief does not mention light at all. Rather than leave light mode with an unreadable neon-on-white hero, it was given the same derivation discipline the violet accent already has for light — not a design opinion, a contrast floor |

### The rename — ConnectSuite → Sidekick, Mac-side only

Scoped exactly as briefed: `package.json` (`name`, `description`), `electron-builder.yml`
(`appId` → `com.chetan.sidekick.desktop`, `productName`, `copyright`, `NSLocalNetworkUsageDescription`),
the window title, the sidebar brand, the About card, every in-app string that refers to **this Mac
app** by name. Left alone, deliberately, because it names something else: `SERVICE_TYPE = 'connectsuite'`
(`shared/protocol.ts`, the literal mDNS `_connectsuite._tcp`), `docs/protocol.md`, the Android app's
own name (every "open ConnectSuite on the phone" sentence — the phone app is still called that), and
the Android-side `Download/ConnectSuite` SAF folder. Both boundaries hold at every grep hit; see the
rename's own commit for the full file list.

**This reopens the appId warning `electron-builder.yml` and `PRODUCT.md` both carry, and the
consequence is not hypothetical — it was observed on this machine.** `safeStorage` keys this Mac's
TLS private key to the bundle identifier; changing `appId` mints a new identity, and a phone pinned
to the old fingerprint refuses it. Rebuilding and relaunching after the rename produced exactly
that: `SSLV3_ALERT_CERTIFICATE_UNKNOWN` from the previously-paired Samsung SM-S938B, and the app
forced onto its `pairing` route ("the phone no longer recognises this Mac"). The instruction named
the new `appId` explicitly, so the change stands — but every Mac running this build needs its phone
re-paired from a fresh QR code, and that cost is real rather than theoretical. `electron-store`'s
`name` (`connectsuite` → `sidekick`) and the TLS cert's `organizationName` were renamed the same way
for the same reason: both were already going to reset with the identity change, so leaving them
branded with the old name would have been stale rather than safe.

### Follow-ups flagged, not decided here

- **App icon and `.dmg` asset naming.** `build/` icon assets and the DMG's window layout were not
  touched — renaming the binary assets is a design asset task, not a string edit.
- **The Android app's own name**, the wire protocol's `_connectsuite._tcp` namespace, and the
  Android-side `Download/ConnectSuite` folder. Explicitly out of scope for this pass; a full rebrand
  would need a decision on whether the phone side changes too, and if so, whether the SAF folder name
  changes with it (a folder rename on the phone is a user-visible move, not a relabel).
- **Whether the light theme's derived hero gradient (V9) is good enough to keep**, or whether light
  mode should get its own pass once dark is signed off — the brief gave no opinion to check it
  against.

---

## The Sidekick Figma design system — 2026-09-17/18. Rows D1–D9

**Status: drawn, not built.** These rows record what the Figma file at
`sidekick-mac-app-ui` now specifies and the shipped build does not yet do. They are written before
implementation deliberately, so the first person to touch `desktop/` has the list rather than
rediscovering it. The full handoff — node ids, tokens, per-screen notes — is
`docs/sidekick-figma-handoff.md`, and nothing below may be implemented without the row it names
being kept in sync.

**Authority.** The owner briefed the pass and approved each batch in turn. Where the Figma file and
`ConnectSuite.dc.html` disagree, the Figma file wins for anything listed here and the handoff wins
for anything not; `docs/protocol.md` still wins over both.

| Row | Handoff / build | Figma now specifies | Status | Why |
|---|---|---|---|---|
| **D1** | `--live` green `#32E58A` for connected, beside lime `--accent` | **One positive colour: lime.** Connected is a small lime dot or pill; the green is deleted, not kept as a fifth semantic | **departure** | Two greens beside each other is the problem N-P1 named, arriving from the other direction. The owner chose lime explicitly, and a single positive hue is what makes the "lime is earned" rule checkable |
| **D2** | Category hue on dock tiles and activity tiles (`--tint-*`) | **No category colour anywhere.** Neutral charcoal tiles with line glyphs; features are told apart by glyph and label | **departure** | The brief bans rainbow feature colour outright. It also removes the second job hue was doing, which R4 flagged as the real fault rather than the palette |
| **D3** | Rings for battery and storage (V2 made the bars lime) | **Two metric cards** — badge, label, mono value, caption, 4px bar — with **storage stated as free space everywhere** and the bar filling with free space | **new** | N-P2 already replaced the rings; this settles the wording the build has never fixed. A bar that fills with *free* space makes "nearly empty is bad" true rather than misleading |
| **D4** | Overview hero: gradient card, no device illustration | **A phone visual inside the hero** — device identity only: frame, screen wash from the app palette, quiet cutout and speaker, per-state treatment | **new** | The owner asked for it against a reference. The constraint recorded with it: it is an illustration, never a frame buffer, a notification list or album art — the moment it shows content it becomes a fake live feed |
| **D5** | Media remote: an empty card reading *Nothing playing* | **Four states from `remote.state`**, and **no transport controls while idle** — an explanation panel instead | **reshaped** | `remote.command` with no session is refused `NO_MEDIA_SESSION`. A disabled transport row is the greyed-control shape decision 6 and principle 3 both rule out |
| **D6** | — | `output` drawn as a **readout with no chevron** | **conform** | `docs/protocol.md` says it outright: nothing switches the phone's audio route, and a chevron that opens nothing is an affordance that lies. The reference screenshot has one; it was not copied |
| **D7** | Mixed line icons plus placeholder squares in the sidebar | **One SF-Symbols-based family**, three weights, seven sizes, a mapping table per action, seven approximations named | **departure** | An icon set nobody can enumerate is the `icons.ts` failure again. The mapping table is the enumeration, and seven entries say plainly that the drawn shape is an approximation of the named symbol |
| **D8** | Four state kinds invented per pane (N4, P5, F7, A2, C6) | **Six kinds — empty, unavailable, loading, permission, error, wall — plus one Disconnected component** | **new** | This is the one-hour vocabulary decision `docs/empty-and-failure-states.md` has asked for five times. A wall never gets a retry button; a disconnect never empties a pane |
| **D9** | Activity's donut and seven-day sparkline (A3, A4) | **Neither.** A compact Today list of counts and the busiest hour printed as a sentence | **departure** | The brief rules out analytics-dashboard styling. The counts and the denominator survive; only the chart chrome goes |

**Two things deliberately left alone**: the lime Sidekick brand mark, which stays the one custom
icon in the system, and light mode, which this pass does not draw at all — V9's derivation still
stands and will need its own pass.

**Not yet true of the build.** Every row above is a drawing. `npm test`, `npm run typecheck` and the
nine commit guards have not been run against any of it, because no code has been changed.

---

## Overview slimmed, and a Device info surface for capabilities — 2026-09-18. Rows D10–D12

Same pass as D1–D9, recorded separately because these three change what a pane *contains* rather
than how it looks. Still drawn, not built.

| Row | Handoff / build | Figma now specifies | Status | Why |
|---|---|---|---|---|
| **D10** | Overview carries **What this phone can do** — a full-width card holding eight capability chips with availability dots | **The card is gone from every Overview state**, and nothing replaces it: no chip row, no feature tiles, no KPI cards. The freed height stays as space | **departure** | The chips duplicated the sidebar, which is the navigation; a dot cannot carry a permission, a limit or a failure; and each feature's own pane already has to explain its state properly. Eight pills reading *available* is the generic-dashboard shape the brief rules out |
| **D11** | — | **Settings → Device info**, a seventh pane *inside Settings* (`44:23491`): the device facts, then a **Capabilities** diagnostic list built from one row per feature — Available / Limited / Needs permission / Unavailable / Unbuilt, a short reason only where one is needed, and an action only where the Mac can really take the user to the fix | **new** | Capability state is diagnostics, and diagnostics belong with the device, not on the first screen. Camera stays **Unbuilt** with no action and no "coming soon". **The main sidebar is unchanged — still twelve rows** (S8's shape); this is a subpage of the existing Device settings surface, which is where the header button and the hero's *Device info* action already point |
| **D12** | Overview's footer strip ran the full width with the encryption sentence and Disconnect | **Connection & security**, a compact card under Battery and Storage, with `Disconnect` in it. The Overview footer strip is removed; other panes keep theirs | **reshaped** | The sentence is a fact about the device, so it belongs with the device diagnostics rather than in a strip that spanned the window. Per state: no encryption claim before the handshake completes, no Disconnect where there is nothing to disconnect, and Reconnect/Troubleshoot when the link is down |

**Overview's final inventory, so nothing creeps back in:** the connection hero with the phone
preview, the Media remote, Recent activity, the Battery and Storage cards, and Connection & security.
Five Overview frames exist and **four of them are connection states** — Connected, Connecting,
Degraded, Disconnected. The fifth, *Connected · Media playing*, is a **content variant of Connected**
and must never be documented or implemented as a connection state of its own.
