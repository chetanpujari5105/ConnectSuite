# Sidekick — Figma design handoff

> **Status: design only, 2026-09-18. No application code has been changed.** This document is the
> bridge between the Figma file and `desktop/`. Where it disagrees with `docs/protocol.md` the
> protocol wins; where it disagrees with the running build, the build is what has to change — and
> **every such change needs a row in `docs/design-departures.md` in the same commit** (see §11).

**File:** `sidekick mac app ui` — `https://www.figma.com/design/sj9q3lneKdEr7Z54TNGPW5/sidekick-mac-app-ui`

Two pages: **Design System** (`28:542`) and **Page 1** (screens). Every frame is 1440 × 980, the
shell is identical in all of them, and dark is the only theme drawn.

---

## 1 · Pages, frames and node ids

### Design System — page `28:542`

| Frame | Node |
|---|---|
| 00 · Foundations | `28:543` |
| 01 · Components | `28:866` |
| 02 · Decisions & open questions | `28:1228` |

### Page 1 — screens

| Pane | Frame | Node |
|---|---|---|
| Overview | Connected | `6:2` |
| | Connecting | `22:6` |
| | Disconnected | `22:184` |
| | Degraded / permission missing | `22:362` |
| | Connected · Media playing *(content variant of Connected, **not** a connection state)* | `40:20881` |
| Mirror | Ready | `31:1566` |
| | Mirroring | `31:1749` |
| | Phone locked | `31:1966` |
| | Consent needed | `31:2166` |
| | Secure content | `31:2350` |
| Files | Browsing | `31:2550` |
| | No folders shared | `31:2819` |
| | Couldn't open folder | `31:2985` |
| | Sending | `31:3175` |
| Photos | Browsing | `31:3431` |
| | Thumbnails only | `31:3704` |
| | Permission needed | `31:3956` |
| | Loading | `31:4122` |
| Messages | Thread | `32:4382` |
| | Send failed | `32:4613` |
| | Permission needed | `32:4845` |
| | Disconnected | `32:5013` |
| Notifications | Inbox | `34:5254` |
| | Replying | `34:5499` |
| | Read only | `34:5744` |
| | Access needed | `34:5989` |
| | Media session in the feed | `40:21209` |
| Clipboard | History | `34:6160` |
| | Phone to Mac | `34:6408` |
| | Sensitive clip | `34:6627` |
| | Disconnected | `34:6867` |
| Calls | Idle | `34:7045` |
| | Incoming | `34:7326` |
| | In call | `34:7618` |
| | Permission needed | `34:7907` |
| Apps | Browsing | `34:8127` |
| | Loading | `34:8440` |
| | No results | `34:8700` |
| | Disconnected | `34:8865` |
| Activity | All events | `34:9188` |
| | Filtered empty | `34:9478` |
| | Nothing recorded | `34:9686` |
| | Disconnected | `34:9849` |
| Settings | General | `34:10156` |
| | Device info (capabilities) | `44:23491` |
| | Connection | `34:10376` |
| | Notifications | `34:10618` |
| | File transfer | `34:10843` |
| Camera | Not built | `34:11064` |
| Pair a phone | Ready to scan | `34:11219` |
| | Searching | `34:11409` |
| | Verifying | `34:11605` |
| | Paired | `34:11793` |
| | Rejected | `34:11956` |
| | No network | `34:12152` |

Every id above was read from the file itself, not transcribed from a screenshot.

---

## 2 · Palette and what a colour is allowed to mean

| Token | Value | Job |
|---|---|---|
| `--bg` | `#0A0A0A` | the window ground |
| `--chrome` | `#0F0F0F` | sidebar and window chrome |
| `--card` | `#161616` | every standard panel |
| `--card-raised` | `#1C1C1C` | nested / selected surface |
| `--control` | `#1A1A1A` | buttons, inputs, tiles |
| `--hairline` | `#FFFFFF` @ 8% | the only border; 12% when a surface is raised |
| `--accent` | `#C6FF33` | **the one accent** |
| `--accent-hover` / `--accent-pressed` | `#D4FF4A` / `#A8DF1F` | |
| `--accent-on-fill` | `#0B1002` | text on lime |
| `--accent-tint` | lime @ 10–14% | active nav, selected row |
| `--warning` | `#FFB547` | degraded, limited, low |
| `--destructive` | `#FF5C5C` | disconnected, failed, destructive |
| `--unknown` | `#9C9EB0` | connecting, unavailable, unknown |
| `--text-primary` | `#F2F3F5` | titles, values |
| `--text-secondary` | `#9A9CA8` | body |
| `--text-meta` | `#6B6E7A` | labels, timestamps, captions |
| `--text-disabled` | `#4A4C55` | an unavailable control, never a promise |

**Lime is allowed on:** the primary action, the active navigation row, a selected segment, healthy
progress and transfer fills, the Overview hero bloom, and a small connected/ready dot.

**Lime is never on:** every chip, every icon, list rows, inactive controls, anything in a
disconnected or failed state, glows, or repeated background gradients. **The old `#32E58A` green is
gone** — connected is lime now, and there is no fifth state colour.

**Amber only for a real limitation** (permission missing, low battery, secure content, partial
feature). **Red only for a real failure or a destructive control.** **Grey for unknown** — a value
the Mac does not have is `—` in grey, never a lime bar at zero.

No purple, blue, cyan, pink or per-category hue exists anywhere in the system. Features are told
apart by glyph and label. **The bottom dock was removed entirely on 2026-09-18** — it duplicated the
sidebar, and search lives in the header and on ⌘K.

---

## 3 · Typography

SF Pro (system) in the app. **The Figma file is set in Inter** because SF Pro renders zero-width in
this Figma document — a file-level substitution only, not a product decision. Numerals are
JetBrains Mono in Figma, standing in for SF Mono / tabular figures.

| Role | Size / weight | Tracking | Line height | Used for |
|---|---|---|---|---|
| Display | 31 / 600 | −0.02em | 36 | page title |
| Title | 21 / 600 | −0.015em | 26 | card headings, live-call name |
| Section | 15 / 600 | −0.005em | 20 | section and row titles |
| Body | 13.5 / 400–500 | 0 | 20 | body and control labels |
| Caption | 11.5 / 500 | +0.01em | 14 | metadata, captions |
| Micro | 10 / 500 | +0.06em, uppercase | 12 | group labels (`MENU`, `WHAT HAPPENED`) |
| Numeral | 21 / 500 mono | 0 | 26 | metrics, clocks, byte counts |

Nothing sits between these sizes. The 18 literal sizes measured in the build collapse onto this
scale (`docs/native-mac-pass-audit.md` §3).

---

## 4 · Spacing, radius, geometry

**Spacing** on a 4px base: 4 micro · 8 icon↔label · 12 inside chips · 16 card inner rows ·
20 card padding · 24 between cards · 32 pane gutter · 40 section break.

**Radius:** pill `999` (buttons, status pills, chips, badges) · control `10` · card `14` ·
hero and window `20`.

**Geometry:** window 1440 × 980 · sidebar 232 · content gutter 28 · content width 1152 ·
nav row 204 × 36 · button height 36 (32 in toolbars and inside cards) · list row 44–74 ·
card header 18px inset. **There is no dock and no bottom bar**; the window is sidebar + header +
content, and nothing floats over the content.

**Column grids used:** `812 + 324` (Notifications, Apps), `796 + 340` (Clipboard),
`300 + 520 + 300` (Messages, Calls), `212 + 588 + 320` (Files), `188 + 612 + 320` (Photos),
`220 + 592 + 308` (Settings), `812 + 320` (Mirror).

---

## 5 · Components — page `28:866`

| # | Component set | Node | Variants |
|---|---|---|---|
| 1 | Nav row | `28:915` | State = Default / Hover / Active / Unavailable × Badge = No / Yes (7) |
| 2 | Status pill | `28:932` | Connected · Connecting · Degraded · Disconnected |
| 3 | Button / Primary | `28:956` | Default · Hover · Pressed · Disabled · Loading |
| 4 | Button / Secondary | `28:970` | Default · Hover · Pressed · Disabled |
| 5 | Button / Destructive | `28:983` | Default · Hover · Pressed · Disabled |
| 6 | Segment | `28:997` | Selected · Unselected · Hover |
| 7 | ~~Capability chip~~ | — | **Retired 2026-09-18.** The Overview chip row duplicated the sidebar; feature state moved to component 20 |
| 8 | Icon badge | `28:1047` | Tone = Neutral / Accent / Warning / Danger |
| 9 | Stat card | `28:1075` | Reading · Low · Unknown · Last known |
| 10 | List row | `28:1162` | State = Default / Hover / Selected × Trailing = Status / Action / Meta (9) |
| 11 | State block | `28:1226` | Empty · Unavailable · Loading · Permission · Error · Wall |
| 12 | Disconnected state | `32:4380` | Pane banner · Content overlay · Inline notice · Blocked action |
| 13 | Iconography | section on `28:866` | the icon family, sizes, weights, colours and the full mapping |
| 14 | Device metric card | `39:20321` | Battery × Normal / Charging / Low / Unknown, Storage × Normal / Low / Unknown |
| 15 | Media remote (Overview widget) | `40:21854` | Nothing playing · Playing · Paused · No artwork · Skip unavailable · Not seekable · Permission needed · Disconnected |
| 16 | Notification row / Media session | `40:20861` | Playing · Paused · No artwork · Skip unavailable |
| 17 | Slider | `42:21906` | Kind = Playback / Volume × State = Rest / Hover / Dragging / Disabled |
| 18 | Activity row | `42:23024` | Tone = Neutral / Success / Connected / Warning / Failure, Trailing = Chip / Status / Meta / None, plus Hover |
| 19 | Connection & security | `43:23462` | State = Connected / Degraded / Disconnected / Connecting × Layout = Wide / Narrow |
| 20 | Capability status row | `45:24002` | Available · Available + note · Limited · Needs permission · Unavailable · Unbuilt |
| 21 | Sidekick / Brand mark / Compact | in `21 · Brand` | Size = 24 / 32 / 48 |
| 21 | Sidekick / Brand lockup | in `21 · Brand` | Theme = Dark / Light |

**Component 11 settles the state vocabulary** that `docs/empty-and-failure-states.md` records as
the largest named design debt — 84 states across 19 panes, five competing vocabularies. Six kinds,
because *nothing here*, *this cannot work* and *this failed* are different facts:

- **Empty** — nothing has arrived yet, and what would make something arrive.
- **Unavailable** — the feature is not built; carries the phase and a mono namespace handle, or says
  no namespace was proposed.
- **Loading** — what is being read, with a count where one exists.
- **Permission** — the phone's own reason, plus where to fix it. One action, and only because the
  user can act.
- **Error** — what happened, what was not changed, the machine code in mono, and a retry.
- **Wall** — the platform forbids it. **No retry button, ever** — there is nothing to retry.

---

## 5b · Iconography

**SF Symbols is the icon language.** The Figma file draws SF-Symbols-*style* vectors, because the
real symbols are an Apple font that cannot be embedded in a Figma document or redistributed — so
**the mapping table below is the contract, and the implementation uses the named symbol itself**,
not a trace of the Figma glyph. On this Electron app that means either the SF Symbols glyph through
the system font in a `<span>`, or an SVG traced from SF Symbols at build time into `icons.ts`, whose
existing enumeration rule still applies: an icon name not in `navModel.iconNamesUsedByTheShell()` is
an icon nobody can check.

**Rules**

- One family, one style. No emoji, no filled/outline mixing, no second icon pack, no illustrated or
  coloured app-style glyphs.
- **Regular weight by default.** Medium for a selected navigation row, a primary-action glyph and
  toolbar actions. Semibold only where clarity is at risk at 12–14 px.
- **Sizes: 12, 14, 16, 18, 20, 24, 32.** Sidebar and list rows 16 · buttons and chips 14 · toolbar
  16–18 · card and section badges 18–20 · state-block badge 24 · empty state 32, quiet and
  monochrome, never an illustration.
- **Colour:** default `--text-secondary` grey. Lime **only** on the active sidebar row and on a
  glyph sitting inside a lime button (near-black `--accent-on-fill`). Amber only for a real
  limitation, muted red only for a real failure or destructive action, `--text-disabled` for a
  control that is briefly unavailable. Never colour as decoration.
- **An icon is never the only explanation of a destructive or consequential action** — Disconnect,
  Forget, Delete and Reject all keep their labels.
- No icon is added because a space looks empty.
- **The lime Sidekick mark is the one custom brand icon** and stays as it is.

**Mapping — Figma glyph key → SF Symbol → where it is used**

| Figma key | SF Symbol | Fit | Used for |
|---|---|---|---|
| `overview` | `square.grid.2x2` | exact | Overview nav |
| `mirror` | `rectangle.on.rectangle` | exact | Mirror nav, float window |
| `files` | `folder` | exact | Files nav, folder rows |
| `photos` | `photo` | exact | Photos nav, image rows, Capture frame |
| `messages` | `message` | exact | Messages nav, reply pill |
| `envelope` | `envelope` | exact | mail notifications |
| `notifications` | `bell` | exact | Notifications nav |
| `clipboard` | `clipboard` | exact | Clipboard nav, copy-state empty |
| `calls` | `phone` | exact | Calls nav, dial, answer |
| `camera` | `camera` | exact | Camera nav (dim, unbuilt) |
| `apps` | `square.grid.3x3` | exact | Apps nav, app tiles |
| `activity` | `waveform.path.ecg` | exact | Activity nav |
| `settings` | `gearshape` | exact | Settings nav |
| `search` | `magnifyingglass` | exact | header search, ⌘K |
| `sliders` | `slider.horizontal.3` | **closest** | Device settings |
| `ellipsis` | `ellipsis` | exact | overflow menu |
| `info` | `info.circle` | exact | Device info |
| `refresh` | `arrow.clockwise` | exact | Refresh, Reconnect, Try again, fresh code |
| `wrench` | `wrench.and.screwdriver` | **closest** | Troubleshoot |
| `play` | `play.rectangle.on.rectangle` | **closest** | Start mirroring, video rows |
| `stop` | `stop.circle` | exact | Stop mirroring |
| `fullscreen` | `arrow.up.left.and.arrow.down.right` | exact | reserved, not drawn yet |
| `pip` | `pip` | exact | floating window |
| `chevronLeft` / `chevronRight` | `chevron.left` / `chevron.right` | exact | paging, back |
| `x` | `xmark` | exact | dismiss, cancel, reject, end call |
| `xcircle` | `xmark.circle` | exact | failure / unavailable status |
| `check` | `checkmark` | exact | inline confirmation |
| `checkcircle` | `checkmark.circle` | exact | success / available status |
| `alert` | `exclamationmark.triangle` | exact | warning, limited access |
| `lock` | `lock` | exact | permission needed, sensitive clip |
| `link` | `link` | exact | Connection settings |
| `linkminus` | `link.badge.minus` | **closest** | Disconnect, disconnected banner |
| `copy` | `doc.on.doc` | exact | Copy on this Mac |
| `send` | `arrow.up` | **closest** | Send a message or reply |
| `download` | `arrow.down.to.line` | exact | Save to Mac, Export CSV |
| `upload` | `arrow.up.doc` | **closest** | send files to the phone, drop tile |
| `external` | `arrow.up.right.square` | **closest** | open on phone, open link, Reveal in Finder, ask to open |
| `doc` | `doc` | exact | document rows |
| `trash` | `trash` | exact | Delete on phone |
| `keyboard` | `keyboard` | exact | reserved for input hints |
| `iphone` | `iphone` | exact | clipboard direction: from the phone |
| `laptop` | `laptopcomputer` | exact | clipboard direction: to this Mac |
| `arrowRight` | `arrow.right` | exact | neutral direction, drop targets |
| `spinner` | *(none)* | **closest** | loading — use a native indeterminate indicator, not a symbol |

**Seven mappings are approximations** and the implementation should use the named SF Symbol rather
than the drawn shape: `slider.horizontal.3`, `wrench.and.screwdriver`,
`play.rectangle.on.rectangle`, `link.badge.minus`, `arrow.up` (for Send), `arrow.up.doc`,
`arrow.up.right.square`. `spinner` has no symbol at all.

**Deliberate substitutions, with the reason:**
- **Activity is `waveform.path.ecg`, not `clock.arrow.circlepath`** — the pane is a live event log,
  not a history rewind.
- **Clipboard direction uses `iphone` and `laptopcomputer`, not arrows** — an arrow in a row reads as
  a control you can press.
- **Reject and End call use `xmark`, never a red phone glyph**, which reads as *place a call*.
- **Apps uses `arrow.up.right.square`, never `play` or `power`** — nothing is launched from the Mac.
- **Capture uses `photo`, not `camera`** — it saves a still from frames the Mac already has.

---

## 5c · The media session, and where it is drawn twice

**One source of truth: `remote.state`.** The Overview widget and the Notifications feed card read the
same object and must never disagree about the track, the app, the playing state, the progress or
which controls exist.

**What the wire actually gives, checked against `docs/protocol.md` and `desktop/src/renderer/remote.ts`:**

| Field / control | Supported | Source |
|---|---|---|
| Artwork | **yes**, separately | `artworkKey` on the state; bytes from `remote.artwork` (base64 JPEG, `maxEdge` ≤ 512). `NO_ARTWORK` is a normal answer |
| Title, artist, album | **yes** | `title`, `artist`, `album` |
| Source app | **yes** | `appName` + `package`; the launcher icon via `apps.icon` |
| Playing / paused | **yes** | `playing` |
| Position | **yes** | `positionMs` paired with `positionAtMs`; the Mac runs the bar itself between pushes |
| Duration | **yes** | `durationMs` |
| Previous / Next | **yes, gated** | `remote.command` `previous` / `next`, allowed only when `canSkipPrevious` / `canSkipNext` |
| Play / Pause | **yes** | `play_pause` (also `play`, `pause`, `stop`) |
| Seek | **yes, gated** | `seek` with `positionMs`, only when `canSeek` |
| Volume | **yes** | `volume` / `volumeMax`; `volume_up`, `volume_down`, `volume_set` |
| Current audio output | **yes, readout** | `output` `{name, kind: bluetooth\|headphones\|speaker\|unknown}` — the phone classifies |
| **Output switching** | **no** | No verb exists and none should be implied. Drawn as a chip with **no chevron** |
| Shuffle, repeat, queue, lyrics, cast, AirPlay | **no** | Absent from the contract entirely — never drawn |

**Where each appears**

- **Overview — Media remote widget** (`15`), beside the hero, never inside it. Idle shows the neutral
  *Nothing playing* card with **no transport row**, because `remote.command` with no session is
  refused `NO_MEDIA_SESSION`. Active shows artwork (or the neutral placeholder), title, artist,
  album, the app chip with the playing dot, a scrubber with both times, prev / play-pause / next,
  volume, and the output readout. A real cover may tint the top of the card at ≤ 22% — never a
  gradient across it, never lime beyond the play control, the progress fill and the playing dot.
- **Notifications — media session card** (`16`), in the feed. It is drawn **only** when a live
  notification's `package` matches a `remote.state` with `active: true`. This is the correlation
  `desktop/src/shared/appCall.ts` already performs for calls, and it needs **nothing new on the
  wire**. With no session the row stays an ordinary notification; there is never a *Nothing playing*
  row in the feed. The detail column repeats the facts and the `Open on phone` action but **not** a
  second transport row — one set of controls, not two.
- **Permission**: both surfaces are gated on the notification-listener grant, so `PERMISSION_DENIED`
  produces the amber state in the widget and an ordinary permission banner in the pane. No transport
  is drawn in either.
- **Disconnected**: the shared component. Last-known media is never redrawn as if it were playing.

**Slider rules** (component 17). Rest is a 4px track with a 9px knob; hover thickens the track to
5px and the knob to 11px; dragging takes a 13px knob with a white ring; disabled drops the knob
entirely, dims the track to 6% and carries the reason beside it (`canSeek: false`). **Playback
carries lime because it is a real reading. Volume is neutral grey at rest and takes lime only while
it is being dragged**, so two lime bars never sit in one card. A scrubber is not drawn at all when
`durationMs` is missing.

**Player layout** follows the owner's reference: artwork with the phone's own launcher icon badged
on its corner (never a brand mark Sidekick draws), title over one `artist — album` line, the
playing pill with the app name, a full-width scrubber with **elapsed on the left and remaining
(`−2:45`) on the right**, centred transport at 40 / 54 / 40, then the volume row with its percentage
and the output readout.

**A control the session refuses is drawn off with the reason** — `canSkipNext: false` dims Next and
says the app does not allow skipping. That is not a fake control: the session exists and has told us
what it will not do. A control with *no session at all* is not drawn.

---

## 6 · Screen-by-screen implementation notes

### Overview (`6:2`, `22:6`, `22:184`, `22:362`) — revised 2026-09-18

**Layout**, inside the 1208-wide content area: hero `28,140` 700 × 300 · media remote `752,140`
428 × 356 · pill row `28,456` · recent activity `28,512` 700 × 252 · the two metric cards
`752,512` and `974,512`, 206 × 148 each · capabilities `28,780` 1152 × 84 · footer strip `28,876`.
Hierarchy: the hero is primary, the media remote is the second-loudest card, the metric cards are
secondary diagnostics and must never out-weigh either.

**Hero.** Still the **only** hero treatment in the app: near-black base `#0A0E0B`, one radial lime
bloom, tiled grain at 4% on SCREEN, a 6% hairline. It now carries a **phone visual** at `20,20`,
148 × 262: a rounded device frame, a 17px-radius screen, a quiet camera cutout and speaker slit, a
nav pill, and a wallpaper-like wash built from the app's own palette. **It is device identity, not
content** — no live frames, no notifications, no messages, no album art, nothing personal. Beside it:
device name 21/600, the status pill, then a 2 × 2 detail grid with 30px icon badges — Connection,
Address, Security, Latency.

Per state: **Connected** — forest wash plus a low lime bloom on the phone screen. **Connecting** —
neutral grey wash, a quiet spinner disc, no lime anywhere. **Disconnected** — the screen desaturates
to 55% opacity with a small muted-red `link.badge.minus` disc. **Degraded** — the phone stays warm
because the phone *is* connected; only the status pill, the affected chips and the media card carry
amber.

**Connection & security** (component 19) sits directly under the two metric cards, 428 wide, same
charcoal card. **It is Auto Layout end to end — nothing in it is positioned by hand, and no action
may ever overlap text, a timestamp, another button or the card edge.**

| Part | Layout |
|---|---|
| Card | VERTICAL Auto Layout · padding 16 · gap 12 · width fixed to the column, **height hugs** |
| Content row | HORIZONTAL · gap 12 icon→text, gap 20 text→action · items centred |
| Text block | **Fill container**, min-width 180. Title one line with ending truncation; supporting copy wraps to at most three lines |
| Action group | **Hug contents**, a sibling of the text — so the row reserves its width and can never sit on top of it |
| Bottom action row | full width, **right-aligned**, under a hairline; used in every case except Connected-wide |

**Where the action sits.** Connected keeps the single action beside the text, vertically centred,
because the copy is one line. **Degraded, Disconnected and every narrow layout drop it into its own
bottom row** — the degraded explanation runs to two lines and the disconnected state has two
actions, and neither may begin beside wrapped copy. Bottom rows are right-aligned everywhere, in
both the one-action and two-action cases.

**Narrow (below ~340 px)** the buttons stack and fill the width; heights stay 34 and the gap stays
10. Type never shrinks to make copy fit — the card grows instead. Measured minimum heights:
**Connected 93 · Connecting 132 · Degraded 167 · Disconnected 167.**

**Per state:** **Connected / Degraded** keep the encryption claim and `Disconnect` (a degraded pane's
amber belongs to the permission, never to the link). **Connecting** reads *Not encrypted yet · the
handshake has not finished, so nothing has been sent* with **no action**, because the build has no
verb that cancels an attempt in flight. **Disconnected** states the last session's encryption in the
past tense with its time, and offers **Reconnect** (strong charcoal, `arrow.clockwise`) and
**Troubleshoot** (ghost, `wrench.and.screwdriver`) — neither is lime, because the phone is not
connected, and `Disconnect` is absent. The wide footer strip is gone from Overview; other panes keep
theirs, because those sentences are pane-specific.

**Overview deliberately does not summarise the features.** The `What this phone can do` chip row was
removed on 2026-09-18: the sidebar is the navigation, and each feature's own pane is where its
permission, limit, loading, failure and connected states are explained properly. Overview carries the
link, the media session, the recent events and the two diagnostics — nothing else, and nothing
replaces the chips: no icon row, no feature cards, no KPI tiles. The freed height is left as space.

**The capability list lives in Settings → Device info** (`44:23491`), built from component 20: one
row per feature with the phone's own answer — Available, Limited, Needs permission, Unavailable or
Unbuilt — a short reason only where one is needed, and an action only where Sidekick can really take
you to the fix. Camera stays **Unbuilt** with no action. Lime marks genuinely available, amber a real
permission or limit, muted red a real failure, neutral grey unbuilt and unknown.

**Recent activity** (component 18). Header, the caption *Latest events from your phone and
Sidekick*, and `View all →` top-right. Four rows on Overview, eleven in the Activity pane, one 48px
row shape in both: time in mono on the left, a 30px badge, the event title over one line of
supporting detail, and a single trailing fact — the device, the outcome, a size or a path — then a
chevron. Badges are neutral charcoal unless the event itself was a connection coming up (lime), a
real limitation (amber) or a real failure (red). While the phone is away the card keeps its rows and
says so in the caption, because the log is recorded on this Mac.

**Metric cards** (component 14). Icon badge, label, mono value, caption, 4px bar. Battery shows the
percentage with `Charging` / `On battery` / `Low battery` / `Unavailable`. Storage uses **one
convention everywhere — free space**: value `11.0 GB`, caption `free of 490 GB · 2%`, and the bar
fills with *free* space, so a nearly empty bar genuinely means nearly out of room and earns amber.
Unknown draws `—` and no fill. Badges stay neutral in every state; colour lives in the bar and the
caption.

**Media remote** (component 15) replaces the old empty card, and its states map to `remote.state`:
`active:false` → **Nothing playing**, with a neutral music placeholder, one sentence, and a panel
naming what will appear — **no transport buttons**, because `remote.command` with no session is
refused with `NO_MEDIA_SESSION`, so a disabled row would be a control that can never work.
`active:true` → **Media active**: artwork (or the placeholder on `NO_ARTWORK`), title, artist, the
app chip, a scrubber from `positionMs` + `positionAtMs`, previous / play-pause / next gated on
`canSkipPrevious` and `canSkipNext`, a volume slider from `volume` / `volumeMax`, and the `output`
object as a **readout with no chevron** — nothing on the wire changes the phone's audio route.
`PERMISSION_DENIED` → the amber state, same grant as Notifications. Disconnected → the shared
pattern, and **last-known media is never redrawn as if it were playing**.

### Mirror (`31:1566`–`31:2350`)
Canvas 812 × 700 with the picture at the announced aspect. Right column: Session, Quality, Tools,
Link. **Only one of Start / Stop is ever on screen** (audit B1). Quality presets show the geometry
actually captured beside the chosen row, because `maxResolution` caps the short edge and "1080p" is
a request rather than a fact. Tools are Capture, Refresh (`mirror.keyframe`), the floating-window
toggle and a **rotation readout** — not a rotate control. Stopped states write their reason into the
canvas overlay and the controls stay in the right column (M12).

### Files (`31:2550`–`31:3175`)
Rail of granted roots + `Sidekick` (the grant-free `Download/Sidekick`), a NAME / DATE MODIFIED /
SIZE table, breadcrumb `DCIM › Camera`, a 320 detail card. The Download wall is a permanent card in
the rail in every state. Footer says `28 items` or `200 loaded · more on the phone` — never a total
the wire cannot give. The send tile is gated on the phone's own `push` field; **absent means false**.
There is no "Add folder" control and there must never be one.

### Photos (`31:3431`–`31:4122`)
188 rail of real `MediaStore` buckets with counts, square tiles at 132, 320 detail card.
Partial state is amber and says which half is missing; permission-denied replaces the grid with the
phone's own sentence. Loading shows `500 of 16,369 loaded`, not a spinner.

### Messages (`32:4382`–`32:5013`)
Three columns: threads 300, transcript 520, contact 300. **Deliberately not iMessage** — labelled
transcript blocks, no tails, no blue, sender named on every block, mono timestamps. Send state is
whatever the phone reported (`Sending` / `Sent` / `Not sent`); nothing is marked sent on optimism,
and nothing is queued after a failure. **No encryption badge on a thread** (X1): the link is
encrypted, the SMS is not.

### Notifications (`34:5254`–`34:5989`)
List 812 + detail 324. A row carries a lime **Reply** pill only where `canReply` is true; read-only
rows carry nothing and the detail column shows a *Read only* box explaining there is no reply action
to use. `ONGOING` is the real pill (N2) — there is no unread state on the wire. An unresolved app
label is mono with a `package id` chip (N5). There is no Muted filter (N1).

### Clipboard (`34:6300`–`34:6867`)
List 796 + detail 340. Every row carries a direction chip — **From phone** / **To phone**. Filters
are All / From phone / From this Mac with counts; there are no Favourites or Pinned, because the
history is memory-only (K1). Kind badges are `URL`, `Aa`, `LOCK`, `64KB`, `—`, `?` — never `IMG`,
`FILE` or `{}`. The timeline says *"The phone read its clipboard"*, never *"copied"*, and labels
whose clock each stamp belongs to (K5). Footer carries the bound: `12 of 20 entries, in memory only`.

### Calls (`34:7045`–`34:7907`)
Log 300 + call card 520 + keypad 300. No waveform (C1), no mute or speaker (C2), no in-call keypad
(C3), no encryption badge (C4). The keypad is 3×4 plus ⌫ (C5) and dials before a call only. Every
state carries the audio wall in plain words, and **does not offer Bluetooth as a remedy** — that
was measured on 2026-09-14 and does not work. *Frequently called* is grouped by number with the call
count printed (C7). The clock is a measurement that ticks, not a label.

### Apps (`34:8127`–`34:8865`)
Search + neutral tile grid + detail. The action is **"Ask the phone to open"** and the detail card
explains the mechanism: Android refuses a backgrounded `startActivity`, so the phone posts a
notification and the user taps it. There is no `apps.launch` and no control that implies one. A
package id is a mono chip under the name, never the title.

### Activity (`34:9188`–`34:9849`)
A list of **Activity rows** (component 18) — the same row the Overview card uses — with a compact
Today rail and Export CSV. **No donut and no
sparkline** — this is a departure from A3/A4 and from the handoff, made because the brief rules out
analytics-dashboard styling; the rail lists counts and prints the busiest hour as a sentence. Empty
and filtered-empty are distinct frames with different headlines, bodies and exits (A2). The pane
keeps working while the link is down, and says so.

### Settings (`34:10156`–`34:10843`)
Pane list 220 + content 592 + info column 308. Six panes; **Mirror is not one of them** — it lives
on the Mirror screen. Rows that cannot be controls are drawn as values with a reason
(*Always on*, *Follows the grant*, *Where the app offers it*, *Not on the wire*). The theme segment
is live with three working options and says what System resolved to (G2). Destructive actions sit in
their own bordered section at the bottom of Connection. The info column carries the brand, the
version, the bundle id and *Nothing leaves your network* — there is no account card.

### Camera (`34:11064`)
One frame. Headline says the webcam feature is not built; the body names the reason (a signed system
extension); a mono handle reads `no wire namespace proposed · phase 8, behind signing`. **No preview,
no disabled Start, no "coming soon".** The one control is a route to Mirror, which is real. The
active nav row for an unbuilt pane is neutral, never lime.

### Pair a phone (`34:11219`–`34:12152`)
Centred 560 card: QR plate, the Mac's name and address in mono, a countdown and *Show a fresh code*;
beside it the four steps — **Waiting for a scan · Found your phone · Verifying certificates ·
Paired** — with the address and discovery method printed on step 2 and the fingerprint on step 3.
The sidebar renders inert and dimmed rather than hidden, so the app looks like itself with nothing in
it. Below, *Not finding it?* carries the same-Wi-Fi line, the hotspot line and the manual-address
field — locked decision #4's last resort at the moment it is needed. **Failure is amber, never red:
a phone that has not paired yet has not failed.** Rejection renders the reason from `pair.rejected`
and arms a fresh code in the same beat (P4). *No network* replaces the code with an explanation,
because a code carries an address and there is none to put in one.

---

## 7 · Link-state behaviour, applied everywhere

| State | Chrome | Pane content | Controls |
|---|---|---|---|
| **Connected** | lime dot, `Connected` | live | all available |
| **Connecting** | grey dot, `Connecting…` | last-known or placeholders, no lime | primary disabled, honest note |
| **Degraded** | amber dot, `Limited` | live, with amber only on the affected part | affected controls carry the reason |
| **Permission needed** | pane banner in amber | the phone's own sentence, verbatim | one action, only if the user can act |
| **Loading** | unchanged | skeleton or partial data **with a count** | actions on the loaded part stay live |
| **Failure** | red where the failure is | what happened + what was *not* changed + mono code | retry, unless it is a wall |
| **Disconnected** | red dot, `Disconnected` | content stays, timestamped `as of 09:42` | anything needing the phone goes quiet with a reason; nothing is queued |

The Disconnected component (`32:4380`) is the single source for the last row. A pane never empties
itself on a disconnect, and Reconnect is drawn only where the Mac can actually retry.

---

## 8 · Motion

Tokens, and the reasoning behind each, are in Foundations (`28:543`).

| Token | Value | Applies to |
|---|---|---|
| `--ease` | `cubic-bezier(.22,1,.36,1)` | enter / exit |
| `--ease-in-out` | `cubic-bezier(.77,0,.175,1)` | movement between two resting places |
| `--dur-press` | 100ms press / 160ms release | `scale(0.97)`, `0.94` on round icon buttons |
| `--dur-state` | 180ms | status colour and label cross-fades |
| `--dur-route` | 140ms | route change, **opacity only** |
| `--dur-bar` | 600ms | a metric bar travelling to a new reading |

The dock's magnification spec (N-M9) is deleted with the dock itself.

Specific behaviours: nav pill slides 200ms with the label colour cross-fading rather than snapping ·
**⌘K does not animate** · connection returning plays **one** 600ms halo and then stops, never a loop ·
new Activity and Recent rows animate only when keyed by event id, existing rows FLIP · progress bars
animate `transform: scaleX` · reduced motion drops transforms, keeps 180ms opacity cross-fades and
jumps bars to value · reduced transparency makes the chrome opaque.

Not animated, deliberately: latency and byte counts, notification and clipboard lists, the nav badge
count, anything keyboard-initiated.

**`/review-animations` has not been run.** It needs the owner's own invocation; run it against the
prototypes before any motion ships.

---

## 9 · What is intentionally absent

**Platform walls — never draw a control for these:**
- Call audio in either direction (and **no Bluetooth remedy** — retracted, measured 2026-09-14).
- Mute, speaker, DTMF during a call.
- Power button, arbitrary key injection, rotate-the-phone, phone screen off, show touches.
- Lock screen and `FLAG_SECURE` capture — black frames, detected and stated, never retried.
- Cached MediaProjection consent — every start needs a fresh tap.
- Background clipboard reads on the phone.
- The storage root, `Download` itself, `Android/data`, `Android/obb`.
- Direct app launching (`apps.launch`); Sidekick asks, the user taps.
- Anything outside the local network.

**Unbuilt — absent rather than greyed:** Camera / virtual webcam (phase 8, no namespace), mirror
Record, screen-off and keep-awake toggles, phone audio over the link, HEIC conversion, configurable
download folder, per-app notification rules, quiet hours, interface sounds, automatic updates,
Favourites and Pinned clips, notification mute state, read/unread, smart photo albums and favourites,
shared-media column in Messages, a second paired phone.

**Cut by the product, not by the platform:** accounts, sign-in, PRO pill, billing, "coming soon"
anywhere, category colours, the bottom dock and its magnification, glassmorphism, decorative glows.

---

## 10 · Frames created in this pass

52 screen frames on Page 1 and 3 boards on the Design System page:
Overview 4 · Mirror 5 · Files 4 · Photos 4 · Messages 4 · Notifications 4 · Clipboard 4 · Calls 4 ·
Apps 4 · Activity 4 · Settings 4 · Camera 1 · Pair a phone 6.

---

## 11 · Rows owed in `docs/design-departures.md` when this is implemented

Each of these is a deliberate deviation. A difference not recorded is a bug, not a decision.

1. **Connected is lime, not `#32E58A`.** Reverses the green semantic colour app-wide; `--live` and
   the connection dot change meaning. Supersedes part of V1/V2's palette rows.
2. **Category hue is gone, and so is the dock.** Every `--tint-*` use becomes neutral charcoal, and
   the bottom dock is deleted from every screen — it duplicated the sidebar, and ⌘K plus the header
   search already cover it. Nothing replaces it: no bottom bar, no floating action button.
3. **Progress fills are lime when healthy, amber when the reading is a warning, grey when unknown.**
   Refines V2 with a condition N-P1 was right to ask for.
4. **Activity loses the donut and the sparkline** (against A3 and A4), replaced by a compact counts
   list and a printed busiest hour.
5. **Settings is three columns with six panes and no account block** — the open question at the end
   of the S13 section, answered in the affirmative.
6. **The whole icon system is replaced** by one SF-Symbols-based family at three weights (§5b). The
   sidebar's placeholder squares, the mixed line set and every ad-hoc glyph go; `icons.ts` and
   `navModel.iconNamesUsedByTheShell()` are rewritten against the mapping table, and the seven
   approximated symbols are named there so nobody re-derives them.
7. **A sixth and a seventh state kind** — Permission and Wall — added beside empty / unavailable /
   loading / error. This is the one-hour vocabulary decision the repo has asked for four times.
8. **Disconnected is a component, not a per-pane invention**, and it preserves last-known content
   with a timestamp rather than blanking the pane.
9. **Apps' primary action is worded "Ask the phone to open"**, with the notification mechanism
   explained in the pane.
10. **Pairing failure is amber rather than `--destructive`**, and the unpaired sidebar renders inert
    rather than hidden.
11. **Camera's active nav row is neutral, not accent** — an unbuilt pane never takes the accent.
12. **Figma is set in Inter** with JetBrains Mono numerals (SF Pro renders zero-width in that file).
    The app keeps the system font; this row exists so nobody "fixes" the app to match the mockup.
13. **The hero carries a phone visual** — a device-identity illustration, not a preview of anything
    the phone is showing. The handoff draws no such element, and the rule that goes with it is that
    it must never become a frame buffer, a notification list or artwork.
14. **Overview is re-laid-out**: the old `Device status` card is gone, replaced by two metric cards
    beside the media remote; the hero grows to 700 × 300 and the media remote to 428 × 356.
15. **Storage is stated as free space everywhere**, with the bar filling with free space — reversing
    the mixed "of 490 GB used" phrasing in the reference material, and settling a convention the
    build has never stated once.
16. **The media remote draws no transport controls while idle.** The old card showed an empty panel;
    a disabled transport row would be the greyed-control shape principle 3 rules out, since
    `remote.command` is refused outright with no session.
17. **`output` is drawn as a readout with no chevron**, per `docs/protocol.md`'s own instruction that
    nothing switches the phone's audio route and no affordance should imply one.

---

## 12 · Before any of this ships

- **Preserve existing functionality.** Every pane in these frames is a pane that works today. The
  renderer cannot use `export`; testable logic belongs in `src/shared/` hung on `globalThis`; one
  selector belongs to exactly one stylesheet, and `tokens.css` owns colour.
- **Run `npm test` and `npm run typecheck` in `desktop/`** before committing, and let the nine commit
  guards run — `check-renderer-scripts.mjs`, `stylesheets.test.ts`, `check-color-tokens.mjs` /
  `check-contrast.mjs` and the rest are the things that catch what review does not.
- **Add the departure rows in the same commit as the change they describe**, not afterwards.
- **A colour literal outside `tokens.css` will fail the build.** The palette in §2 goes into
  `tokens.css` first, with light-mode counterparts derived to the same contrast floor.
- **Run `/review-animations`** on the motion in §8. It has not been run.


---

## 13 · Brand assets

**The source files are `LOGOS/main_logo.png` and `LOGOS/head_logo.png`. Both are originals and are
never edited, resized or recoloured in place.**

**What they actually contain — measured, because the difference matters:**

| | `main_logo.png` | `head_logo.png` |
|---|---|---|
| Size | 1254 × 1254 | 1774 × 887, content 1719 × 799 (2.15 : 1) |
| Content | the mask on a **cream `#EFEDE6` squircle** — an **app-icon tile** | the mask alone, **fully transparent** |
| Wordmark | **none** | **none** |
| Note | ~18 sampled translucent near-white pixels fringe the squircle edge | clean |

**Neither file contains the word “Sidekick”.** The lockup in the sidebar is therefore the mask from
`head_logo.png` **plus the word set in the product type** (Inter Semi Bold 18, −0.015em) — not a
single supplied image. A supplied lockup export would replace it one-for-one.

**Placements, and nothing else:**

| Where | Asset | Size |
|---|---|---|
| Sidebar header, every screen | lockup = mask + wordmark | **148 × 30**, left edge aligned with the nav rows, 14px above, 12px below |
| Pairing / onboarding header | `main_logo.png` app tile + small wordmark | 56 × 56 |
| Settings brand card | `main_logo.png` app tile | 44 × 44 |
| Compact slots | `Sidekick / Brand mark / Compact` | 24 / 32 / 48 — **never below 24**, where the eyes merge |

**Rules.** No badge, pill, card, glow, shadow, border or gradient behind either mark. The brand art is
never a navigation icon, a button glyph, a status icon, a per-screen header, a spinner, or a
replacement for the Overview hero's phone preview — those all stay in the SF-Symbols family.

**Light theme.** The mask reads correctly on `#F4F4F7`; only the wordmark colour changes, to
`#101010`. The raster itself is not recoloured. `main_logo.png`'s cream tile is inherent to the asset
— it is an app icon, and it stays a light tile on dark surfaces in the two places it is used.

**Still required before shipping:**
1. **A monochrome template image for the menu bar.** macOS template images must be monochrome with
   alpha; a colour raster cannot be one, and at 16 px the mask's dark body disappears into a dark
   menu bar. Needs a dedicated `@1x/@2x` template PNG set.
2. **An app `.icns`** for the Dock, the window and the DMG. `build/` has no icon assets yet
   (`docs/phase-9-distribution-audit.md`).
3. **Optional:** a transparent-background export of the full logo, if the cream tile is not wanted in
   the pairing header.
