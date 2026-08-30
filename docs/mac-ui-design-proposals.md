# Mac UI — design system proposals, first pass

**Written 2026-08-29. Prose only. Nothing here is implemented and no renderer file has changed.**

Deliberately **not** phase-numbered. `CLAUDE.md`'s roadmap table is the only phase numbering, and
this work has no row in it. It is closest to **Phase 7** ("Mac UX — packaging, distribution, app
launching, and the polish pass"), which is not open. Two numbering notes to settle before this
becomes a phase:

- The roadmap has **seven** phases and no Camera row. "Camera is Phase 8" is not in the table.
  Phone-as-webcam appears only in *Reference behaviour* ("virtual webcam"), unassigned.
- If the design system lands before Phase 7 opens, it is a **cleanup/foundation step inside
  whichever phase makes it safe**, which the roadmap already permits for deletion and should for
  this. It is not a phase of its own.

This file does not participate in `scripts/check-defects.sh` — that checker compares
`docs/defects.md` against `docs/testing.md` only. **Nothing below is a numbered defect.** They are
design findings, and none of them has been proven on hardware.

---

## Source material, and which file is authoritative

| File | What it actually is | Authority |
|---|---|---|
| `design_handoff_connectsuite/README.md` | The written handoff, 497 lines, full token table | **Authoritative** |
| `design_handoff_connectsuite/ConnectSuite.dc.html` | The 11-screen prototype the handoff documents | **Authoritative** for pixels |
| `ConnectSuite.dc.html` (folder root) | Byte-identical to the one above (`cmp` clean) | Duplicate |
| `uploads/Screenshot … 9.08.30 PM.png` | Capture of the prototype, Mirror page | Corroborating |
| `uploads/Screenshot … 4.23.13 PM`, `4.24.50 PM` | **Earlier, green iteration** | Superseded |
| `uploads/Screenshot … 9.09.05`, `9.09.16`, `10.32.18 PM` | A Mirror variant **not present in either HTML** | Unresolved — see Conflict 2 |
| `uploads/ChatGPT Image Aug 27 …` (11 files) | Concept images that **precede** the handoff | Input, not output |
| `uploads/connectsuite-2026.html` | An earlier prototype, mixed palette | Input, not output |
| `_ds/modernist-…/` | **An unrelated design system.** See Conflict 3 | Ignore |

All twenty-one files carry the same mtime (`2026-08-29 22:40:37`) — the unzip time, not authorship
time. Filename timestamps are the only chronology available, and they are the basis for
"earlier"/"later" above.

---

## Conflict 1 — violet vs green. **The handoff is not silent. Violet wins.**

You asked me not to guess, and I do not have to. The handoff specifies this at length, and the
prototype agrees with it exactly.

**What the handoff says.** `#8B6BFF` is the accent: *"Selected state, primary action fill."*
`#8B7AFF` is its lighter text/icon variant. `#22D3EE` cyan is *"Secondary data accent."*
`#32E58A` green has one job and it is not brand: *"Connection state, LIVE badge, success."*

**Green is a state colour, not the accent.** It is the connected dot, the LIVE badge, the
transfer-complete check, the "You are up to date" card, the battery ring. In the violet screenshots
green appears in exactly those places and nowhere else.

**The gradient is narrower than your reading of it.** The handoff sanctions violet→cyan gradient in
precisely two places — the brand glyph stroke (*"monoline phone-to-Mac link, violet→cyan gradient
stroke"*) and the ambient background blobs — and then forbids it everywhere else in the same
sentence: *"This is the only place gradient appears as a field — **no gradient CTAs**."* So there is
no "gradient accent" to weigh against green. There is a flat violet accent, plus a gradient
restricted to the mark and the ground.

**Verification, rather than an impression of the screenshots.** Counting hex literals in the
prototype the handoff points at:

```
#8B6BFF  36   #32E58A  38   #22D3EE  25
#00d47e / #10b981 / #22c55e / #34d399 / #3ddc84   0
```

Zero green brand hexes. The green in the prototype is `#32E58A` doing the state job the token table
assigns it.

**Why the green screenshots exist.** They are an earlier draft, and three independent things say
so, not just the colour:

| | Green (`4.23`, `4.24 PM`) | Violet (`9.08 PM` onward) + handoff |
|---|---|---|
| Sidebar SYSTEM group | Activity, **Security, Advanced**, Settings | Activity, Settings |
| Dock | 3 tiles | 5 tiles (Mirror, Files, Messages, Calls, Camera) |
| Brand wordmark | "Connect**Suite**" with the second word in green; serif in `4.24` | One weight, `#F4F4F7`, 15px/600 |

The eleven `ChatGPT Image Aug 27` concepts are green too, and they are dated **two days before** the
handoff. The green line runs Aug 27 concepts → the 4 PM screenshots; the handoff and the 9 PM
screenshots are what came out the other side.

**So: violet `#8B6BFF` accent, `#22D3EE` secondary, `#32E58A` for connection/live/success only,
`#FF5D5D` destructive-and-failed only. No question needed.**

One caution on treating screenshots as pixel authority: the `9.09.05 PM` capture draws
**"Start mirroring" as a violet→cyan gradient fill**, which the handoff explicitly forbids. Where a
screenshot and the README disagree, the README and `ConnectSuite.dc.html` win.

---

## Conflict 2 — the Mirror page has two incompatible layouts, and **this one I do need you to settle**

This is not a colour question and it is the one that blocks the largest working feature we have.

**The handoff and the prototype say: embedded preview, plus an optional detached window.** §2:
subtitle *"Control your phone from your Mac in real time."* A vertical tool rail, a 268px embedded
9:19.5 preview, five nav buttons under it, and — in the header — a "Floating window" button that
opens a second view of **one** session. §2 also says: *"This page is the approved reference layout —
do not restructure it."*

**Three screenshots say the opposite.** `9.09.05`, `9.09.16` and `10.32.18 PM` show subtitle
*"The live phone screen opens as its own window — never inside this app,"* a dashed
**"OPENS OUTSIDE"** placeholder where the preview would be, no tool rail, and two right-column cards
the handoff never mentions (a Small/Medium/Large "Floating window" segmented control, and a
"Session" card reading State / Latency / Window / Position).

**Neither HTML file in the bundle contains that variant.** `grep -c "OPENS OUTSIDE"` returns **0**
against both `ConnectSuite.dc.html` and `uploads/connectsuite-2026.html`; the prototype carries only
the "Control your phone from your Mac in real time" subtitle and the tool rail. So the
opens-outside layout came from a canvas state that is not in this handoff, and I cannot reconcile
it from the files present.

By filename time it is also the **latest** thing in the folder (`10.32 PM`, after every violet
capture), which is why I am not simply calling it superseded the way I called green superseded.

**Why it matters more than it looks.** The two layouts imply different work:

- *Embedded* is renderer-only for the preview. `mirror.ts` already paints a `<canvas>` in-page; the
  design work is chrome around a thing that exists.
- *Opens outside* means the mirror **only** ever lives in a second `BrowserWindow` — main-process
  work, a second renderer entry point, and the four-method isolation (`openFloat`, `closeFloat`,
  `smartFit`, `setWidth`) the handoff already specifies. It also deletes the in-page canvas that
  Phase 2 closed on hardware.

I have not picked one. It is question 1 at the end of this file.

---

## Conflict 3 — `_ds/modernist-…/` is a different design system and must not be merged

The folder is a complete, self-consistent design system — token sheet, component pages, two
templates — for something that is **not this app**:

| | Modernist `_ds` | ConnectSuite handoff |
|---|---|---|
| Ground | `#f3f2f2` light | `#07070A` dark |
| Accent | `#ec3013` red | `#8B6BFF` violet |
| Radius | `--radius-sm/md/lg` all **0px** | 10 / 14 / 18 / 24 |
| Elevation | three shadow steps on a light ground | hairline + shadow + inner highlight |
| Rules | *"Do not round a corner anywhere"*, 2px dividers | 1px hairlines at `rgba(255,255,255,.08)` |

Its `readme.md` opens *"Modernist is flat, architectural and set entirely in Archivo: a near-mono
red on white."* The only thing it shares with our handoff is the Archivo family and a Lucide icon
recommendation. Its red-as-accent is the exact thing our handoff forbids in a sentence written for
this product: *"in a connection product red reads as 'link is down.'"*

It is a Claude Design scaffold that rode along in the export. **Do not take tokens from it.** If it
stays in the repo it will be read as a second source of truth by whoever opens the folder next.

---

## 1. The design system, as tokens

Straight from the handoff table, with the decisions this codebase forces marked **[ours]**.

### Where they live

A new `src/renderer/tokens.css`, linked from `index.html` **before** `styles.css`, holding only
`:root` custom properties. `styles.css` keeps the component layer and stops carrying literals.

Two mechanical consequences, both cheap and both easy to forget:

- `scripts/copy-assets.mjs` copies a hard-coded array `['index.html', 'styles.css']`. A third file
  that is not added there builds clean, typechecks clean, and ships an unstyled app. **[ours]**
- The page's CSP is `default-src 'self'; img-src 'self' data:; style-src 'self'`. No inline styles,
  and **no `fonts.googleapis.com`** — see Type below. **[ours]**

### Colour

```
--canvas            #07070A          app window ground
--elev-1            rgba(14,15,21,.72) + blur(30px) saturate(140%)   sidebar, island, ⌘K
--elev-2            rgba(22,24,34,.82)                               default panel surface
--elev-3            #1C1F2B                                          the ONE primary card / screen
--control           #161822                                          buttons, inputs, tiles
--hairline          rgba(255,255,255,.08)
--inner-highlight   rgba(255,255,255,.05)   inset top

--text-primary      #F4F4F7     --text-body     #9C9FB0
--text-meta         #5B5E6E     (10–11px non-essential meta ONLY — 2.6:1, never body)
--text-on-control   #E7E7EE

--accent            #8B6BFF     --accent-text   #8B7AFF
--accent-tint       rgba(139,107,255,.13) … .18
--secondary         #22D3EE
--live              #32E58A     connection state, LIVE, success
--warning           #F5B23D     weak link, paused, quiet hours
--destructive       #FF5D5D     destructive and failed ONLY
```

Two rules that travel with the palette and are the ones most likely to be broken by accident:

- **Red is reserved.** Never an accent, never a selected state, never brand.
- **One `--elev-3` card per screen, at most.** *"Surfaces must not all read at the same weight."*
  This has teeth in §3 below: an unbuilt pane must not claim elevation 3.

Contrast is measured in the handoff and clears AA for body (`#9C9FB0` on panel = 6.6:1). Keep
saturated pixel area under ~10% per screen.

**Current tokens for comparison.** `styles.css` has nine properties: `--bg #101014`,
`--card #191922`, `--text #e8e8ef`, `--muted #9a9aae`, `--accent #6ea8fe` (blue),
`--danger #ff6b6b`, `--ok #5ad18f`. Not one is a handoff value. **Every colour changes.**

### Type

Archivo throughout in the handoff, with a sanctioned escape hatch: *"substitute the codebase's
native UI face if it has one — SF Pro is an acceptable native swap."*

**[ours] Take the swap. Use SF Pro, do not ship Archivo.** Under `style-src 'self'` a Google Fonts
`@import` is blocked outright, so Archivo would mean vendoring woff2 files into `dist/` — new bytes,
a new copy-assets entry, and a webfont fetch in an app whose first line of description is "no cloud".
`styles.css` already sets `-apple-system, BlinkMacSystemFont, "SF Pro Text"`. This is the handoff's
own permitted substitution, not a deviation from it.

```
--font-ui     -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif
--font-mono   "SF Mono", ui-monospace, Menlo, monospace     + font-variant-numeric: tabular-nums

page title      31px / 600 / -0.02em
section title   15–21px / 600 / -0.015 … -0.02em
body            13–13.5px / 450–500 / 1.5
control label   12.5–13px / 500
meta            11–12px / 500 / 0.02em
group header    10px / 600 / 0.12em / uppercase
```

**Every numeric is mono with tabular figures** — latency, bytes, percent, timestamps, IPs, window
geometry, dialer digits, filenames. The handoff's reason is precise and worth keeping: *"its
proportional figures jitter as values update — this is the only reason a second face exists."* That
argument is stronger here than in the mockups, because our HUD updates `rtt`, `fps`, `bitrate`,
`dropped` and two latency splits continuously against a real link.

### Spacing, radius, elevation, motion

```
--space   4 6 8 10 12 14 16 18 20 24 28    page padding 28, card padding 16–24, grid gap 10–16
--radius  10 controls/chips · 14 tiles/inner · 18 panels · 24 window/phone · 999 pills
--shadow-panel    0 10px 30px rgba(0,0,0,.35)
--shadow-primary  0 24px 56px rgba(0,0,0,.5)
--shadow-float    0 20px 48px rgba(0,0,0,.5)
--ease            cubic-bezier(.22,1,.36,1)      --ease-float  cubic-bezier(.16,1,.3,1)
--dur-hover 180–220ms · --dur-pill 200ms · --dur-toggle 160ms · --dur-float 220ms
```

Elevation is *hairline + shadow + inner highlight*, never a heavier fill. Only `transform` and
`opacity` animate. `@media (prefers-reduced-motion: reduce)` disables every animation and
transition — **[ours]** that is not optional polish, it is the one accessibility affordance the
handoff states as a hard requirement alongside `:focus-visible { outline: 2px solid #8B6BFF;
outline-offset: 2px }` on every interactive element.

Current radius is a single `12px`. Current motion is none.

---

## 2. Every pane in the mockups, against what exists today

**What exists today, in one sentence:** `src/renderer/index.html` is a single scrolling column of
nine `<section class="card">` blocks with a drag-region header. There is no sidebar, no router, no
pane, no status island, no dock, no ⌘K, and no second window. The shell is 100% of the design work
and 0% built.

Legend — **working**: built on both sides and proven on hardware · **partial**: built, Mac-side
incomplete or under repair · **unbuilt**: no protocol, no code.

| # | Mockup pane | State | What exists today | Gap |
|---|---|---|---|---|
| 1 | **Overview** | **unbuilt** | No pane. Ingredients in the Connection card: phase, found-via, address, RTT, device name | **4 of its 8 headline numbers have no source** — see below |
| 2 | **Mirror** | **working** (Phase 2 closed 2026-08-26) | `mirror.ts` (47 KB): canvas, reasoned overlay, input row, resolution select, live stats | Layout disputed (Conflict 2); tool rail, quality preset rows, Advanced toggles all absent |
| 3 | **Detached mirror window** | **unbuilt** | One `BrowserWindow` | Main-process work, not renderer. Second entry point + the four-method isolation |
| 4 | **Files** | **unbuilt** | Nothing. `Capability.FILES` is a name | `fs.*` **has no payload spec** (`CLAUDE.md`). Phase 5 |
| 5 | **Photos** | **unbuilt** | Nothing. `Capability.PHOTOS` is a name | `media.*` **has no payload spec**. Phase 5 |
| 6 | **Messages** | **partial** | `sms.ts`: threads, thread view, composer. Steps 55, 58, 58a, 65, 66, 68 | Defects **30, 32, 39** deferred, **44 open**. Mockup asks for things that do not exist — below |
| 7 | **Notifications** | **working** (steps 42-49b, 52) | `notifications.ts`: list, reply, actions, dismiss, reasoned note | Mockup's **Muted** filter has no protocol backing |
| 8 | **Clipboard** | **unbuilt** | Nothing. `Capability.CLIPBOARD` is a name | `clip.*` has no payload spec. Phase 5 |
| 9 | **Calls** | **partial, under active repair** | `calls.ts` + `renderer/calls.ts` + tests. Step 69 closed the outgoing half | **35c FAILED · 36 untested · 42 reopened · 45 open (High)**. And half the mockup's controls are platform walls — below |
| 10 | **Camera** | **unbuilt** | Nothing. There is **no camera capability in the enum at all** (`mic` exists, camera does not) | Virtual webcam needs a macOS Camera Extension — a signing/distribution problem, i.e. Phase 7 |
| 11 | **Activity** | **unbuilt** | "Connection health" card: a `<pre>` log tail + Refresh | Rotating file logs exist per handler; **no structured event store.** The donut and sparkline need counted categories over time |
| 12 | **Settings** | **partial, scattered** | Manual address + Tailscale, Capabilities, Forget phone, Connect/Disconnect/Retry — spread across three cards | 8 mockup panes; three of their rows describe a product we are not building — below |

### Overview's missing numbers — the pane most likely to become the failure you are guarding against

The device card and Device status rings want: Connected via, Latency, Encryption, Signal, Battery
79%, Storage 128 GB, Memory 8 GB, IP address.

- **Have:** connection phase, found-via, address/IP, RTT, TLS state, device name.
- **Do not have:** `battery.state` and `net.state` are **declared as message-type constants on both
  sides and have no sender and no handler.** `grep` finds them in `Messages.kt`, `protocol.ts`,
  two Kotlin tests and one comment — nothing emits them, nothing consumes them.
- **Do not have at all:** there is no storage message, no memory message, and no signal-strength
  message anywhere in the protocol.

So the sidebar device card's "79%", the status strip battery, and three of the four Device-status
rings currently render over nothing. This is the pane the "looked finished over nothing" audit was
about, and it is the one I would build **last**, not first.

### Messages — what the mockup asks for that the wire cannot answer

- **All / SMS / Chat filter pills.** There is no chat/RCS transport. `sms.kind` is `'sms' | 'mms'`.
- **The "Encrypted" badge on the thread header is false and should be cut.** Our TLS link is
  encrypted; an SMS is not. A badge on a *message thread* reads as a claim about the message.
  Nothing else in the mockups makes a security claim the transport cannot back, and this one would.
- **Call / video / info buttons** on the contact panel — no video-call capability exists.
- **Shared media grid** — needs `media.*`, which is unspecified.
- The mockup has **no "new conversation" affordance**, which is a quiet match for deferred defect
  30 (the Mac cannot start one) and worth not "fixing" in the design before the protocol decision.

### Calls — the most dangerous pane in the mockups

§9 specifies a 40-bar audio waveform, a Mute button, and a Speaker button shown active in violet.
**All three are platform walls, locked in `CLAUDE.md`:** *"Call audio cannot be streamed.
`CAPTURE_AUDIO_OUTPUT` is system-only."* There is no audio to draw a waveform from, no stream to
mute, and no route to switch. The handoff's own "audio-routing note" at the bottom of that pane is
the honest half of the same screen. Treatment in §3.

### Settings — three rows describe a different product

**Security** specifies Two-factor "Enabled" in green, and a coral **"Sign out everywhere"** block
with a "Sign out all" button. The sidebar footer specifies an account email and a **PRO** pill.
`CLAUDE.md`, first line: *"no cloud, no account, and no relay server."* There is no account to
sign out of, no tier to be PRO in, and no second factor. **Trusted devices "3 devices" is the one
row in that pane that is real** — `TrustedDeviceEntity` exists and holds deviceId + certificate +
fingerprint + last address.

Settings → Advanced also specifies a **connection-state cycler** (Connecting / Connected / Weak /
Disconnected) that drives the strip and island. The handoff calls it a review affordance. **It must
not ship.** A control that makes the UI claim a connection state the link is not in is a
lie-generator wired to the exact surface this project uses to tell the truth.

### Six shipped things the mockups have no home for

This is the reverse of the table above and matters as much:

| Shipped, working | Where the design puts it |
|---|---|
| **Media remote** (defect 31 closed by step 67) | **Nowhere.** No pane, no sidebar row, no dock tile |
| **Contacts** (working since 2026-08-28) | Only as a side panel inside Messages, not a pane |
| **QR pairing / first run** (Phase 1, hardware 2026-08-25) | **Nowhere.** There is no onboarding or pairing screen |
| **Capabilities list** (defects 24, 26, 27) | Nowhere. Nearest: Settings → Connection |
| **Manual address + Tailscale** (locked decision #4) | Nearest: Settings → Connection |
| **Connection health / log tail** | Nearest: Settings → Advanced diagnostics |

The pairing gap is the sharpest: the design's first screen assumes a paired phone, and a Mac with
no phone paired has no designed state at all.

---

## 3. "Unavailable, here's why" in this design language

The rule is `CLAUDE.md` decision 6 — *"Every feature degrades to 'unavailable, here is why' instead
of failing silently"* — and the codebase already has three working expressions of it that the design
must inherit rather than replace:

- `UnavailableCapability { name, reason }` on the wire, `reason` written for a person, **never
  parsed**.
- `chipLabel()` — `"${capability}: unavailable, ${reason}"` — which exists because a chip that was a
  name and a background colour read out twelve capability names to a screen reader with no
  indication which were on (defect 26).
- The mirror's **overlay vs notice** split: the overlay means *"there is no picture, here is why"*
  and any painted frame takes it down; the notice is a refusal that happens *while frames flow* and
  must not live in the overlay or it is wiped within one frame at 60 fps.

### Four states, four distinct treatments — and they must not look alike

The handoff has one pattern for nothing-here: *"Empty states are designed, not blank"* — icon, one
bold line, one explanatory line, max ~300px (Photos → Favourites, Notifications → Muted). **Using
that one pattern for all four is exactly defect 24/26's shape**: an empty list and an ungranted
permission look identical, and the user cannot tell which they are looking at.

**A. Unbuilt — the feature has no protocol in this build.** Files, Photos, Clipboard, Camera,
Activity, Overview-until-telemetry.

- Pane chrome renders in full: sidebar, header title + subtitle, connected-device strip. The app is
  not broken and should not look it.
- The primary card is replaced by a **single `--elev-2` panel — deliberately not `--elev-3`.** One
  primary card per screen is the handoff's rule; a pane with nothing in it must not claim the
  screen's heaviest surface. The nothing should read as lighter than the something next door.
- Inside, at ~300px: a 40px line icon at `--text-meta`, one 15px/600 `--text-primary` line, one
  13.5px `--text-body` line.
- Then a mono 11px `--text-meta` footer naming the namespace that does not exist:
  `fs.* — not in this build`. Mono because it is a machine handle; the sentence above it is what a
  person reads. That is the package-id rule applied in the direction it points — a handle may
  appear, never as the only thing a user reads.
- **Colour: neutral, never `--destructive` and never `--warning`.** An unwritten feature is not a
  failure and not a permission problem. Red here would read as "link is down" on eleven panes at
  once.
- **Nothing routes to it that implies it works.** No dock tile, no Overview quick-action tile, no
  ⌘K command. The sidebar row stays, at `--text-meta` rather than `--text-body`, with no badge.

  *Recommended, with the alternative stated:* keep the dimmed row rather than omitting it. Omitting
  makes the nav reflow as each phase lands, and someone who has seen these mockups will go looking
  for Files and deserves a sentence rather than an absence. The cost is eleven sidebar rows of which
  five lead to a explanation — which is honest, but it is your call, not mine.

**B. Unavailable — the phone has the feature and is not offering it right now.** Notification
listener not granted, `READ_SMS` denied, the notification-listener-gated media remote.

- Pane chrome renders. The primary card renders **in its real shape**, inert.
- A `--radius-14` inset banner at the top of that card: `rgba(245,178,61,.10)` fill,
  `rgba(245,178,61,.30)` border, 16px warning glyph, and **the phone's own `reason` string verbatim**
  at 13.5px `--text-on-control`.
- **Verbatim is load-bearing.** Defect 27 was the reason going stale the moment it was wrong; it now
  recomputes with the capability set that produced it. The Mac must render it, not paraphrase it,
  not cache it, not map it to a Mac-side string table.
- Where an Android deep link exists (`ACTION_ACCESSIBILITY_SETTINGS`, notification-access settings),
  an `--accent-text` text button sits in the banner. Where none exists, no button — a button that
  cannot act is the decoration-is-not-a-gate failure in miniature.
- Inert controls get `opacity: .45` + `pointer-events: none` + `aria-disabled`, but **the banner
  carries the explanation, not a tooltip per control.** A tooltip is reachable only by someone who
  already suspects they need it.
- Colour: `--warning`. Not red. A permission that has not been granted is not a failure.

**C. Empty — available, granted, and genuinely nothing there.** No notifications, no call log, an
empty album.

- This is the handoff's designed empty state, unchanged: icon, one bold line, one explanatory line,
  ~300px, `--elev-2`, neutral. **And it says the state out loud** — "No notifications" rather than a
  blank list, so it cannot be read as A or B.

**D. Platform wall — impossible, permanently.** Call audio, hardware key injection, the power
button, FLAG_SECURE surfaces, MediaProjection consent caching.

This is the treatment the mockups need most, and it is not a state at all:

> **The control is removed from the design, and one line of copy replaces it.**

A greyed control is a promise that it might one day light up. For a platform wall that promise is
false forever, and a user will hunt for the setting that enables it.

Concretely, against the two panes that need it:

- **Calls.** Cut the 40-bar waveform, Mute, and Speaker entirely. Keep the avatar, the name, the
  mono number, the mono timer, and the coral end-call button. In the space they vacate, put the
  handoff's own audio-routing note as a 13.5px `--text-body` line: *"Call audio stays on the phone.
  Pair your Mac to the phone over Bluetooth to hear it here."* That is the documented answer from
  `CLAUDE.md` and it belongs on the screen where the question is asked.
- **Mirror tool rail.** Five items become three — Rotate, Capture, Transfer. **Power is removed.**
  There is no public API for an AccessibilityService to synthesise a `KeyEvent`; `INJECT_EVENTS` is
  signature-level and will never be available. The nav row's five buttons are already the honest
  set (`performGlobalAction`), and the built row's sixth — Quick settings — should be kept over the
  mockup's five.

### The counted-fallback rule applies to this UI, not only to the logs

*"A count with no denominator is not evidence"* is a code rule, and it is a UI rule for the same
reason. A Capabilities surface showing three greyed rows tells you nothing about scale. It should
read **"9 of 12 available"** beside the list, the way `AppLabels.of` keeps `resolved / fell back` on
the line so "12 fallbacks" can be told from "12 of 12 fallbacks".

This also settles where the homeless Capabilities pane goes: **Settings → Connection**, as a
counted list of available-and-unavailable with each unavailable row carrying its verbatim reason.

### One more, because it is the same mistake in a new place

**Notifications → Muted** is specified as a designed empty state. There is no mute state anywhere in
the protocol. Shipped as designed it is an empty state over nothing — state C rendering what is
actually state A. Either drop the pill until a mute concept exists, or render it as A. It is a small
thing and it is precisely the shape of the problem you asked about.

---

## 4. The smallest slice worth doing first

**Build the Notifications pane, on the notifications feature, and nothing else.**

Not Mirror, and not Overview. The reasoning:

**It is the only pane that is both fully working and Mac-side complete.** Built on both sides,
closed on hardware at steps 42-49b and 52. That makes it a **control**: if the pane looks wrong, the
cause is the design system, because the feature underneath is not the variable. Every other
candidate confounds the test.

**It exercises the whole token set in one screen.** `--elev-2` for the list panel, `--elev-3` for
the detail card — so the one-primary-card-per-screen rule gets tested rather than asserted;
`--control` for the filter pills and the 2×2 action grid; `--accent` for the selected pill, the
tinted selected card and the send button; `--destructive` for "Dismiss", which is the correct and
only sanctioned use of red; 34px tinted app tiles at `--radius-14`; mono tabular timestamps; the
row-hover reveal (`opacity` + `translateX(6px)`, 200ms `--ease`); and a designed empty state. That
is colour, type, spacing, radii, elevation and motion, all six, in one pane.

**It needs no main-process work.** No second `BrowserWindow`, no new IPC, no protocol change,
no phone change, no Phase 5. It is `tokens.css`, `styles.css`, `index.html` and `notifications.ts`
— and the renderer's testable-seam rule already has a worked example next door in
`renderer/calls.ts`, so the pure half of any new drawing rule can hang on `globalThis` and be tested
the way `chips.ts` is.

**It is where the design system's riskiest claim gets proved rather than assumed.** The pane's
34px app-icon tile plus app name is the single most likely place in the whole design for a raw
`com.techmash.playo` to reach a sentence — that is defect 28, found three times by enumerating
rather than by fixing the one on screen. Rebuilding this pane in the new language is the cheapest
real test that the package-id rule survives a visual rewrite.

**And it will immediately exercise §3**, because the pane ships with a Muted filter that has nothing
behind it. Deciding that one — drop it, or render it as "not in this build" — is a five-minute
decision that settles the pattern for the eleven panes that follow.

**Second, once Conflict 2 is answered: Mirror.** It is the biggest working feature and the most
visible payoff, but it needs the layout question settled, it needs main-process work if the answer
is "opens outside", and a third of its tool rail is platform wall. It should not be first for
exactly those reasons.

**Last: Overview.** It is the front page and four of its eight numbers have no sender. Building it
early is how the mockups turn into the thing your first audit prompt existed to prevent.

---

## What I need from you

1. **Conflict 2 — Mirror.** Embedded preview with an optional detached window (handoff §2 and
   `ConnectSuite.dc.html`), or mirror-only-in-a-floating-window (the three latest screenshots, and
   in neither HTML)? Everything else can proceed without this; the Mirror pane cannot.
2. **Unbuilt sidebar rows** — dimmed rows with a "not in this build" pane (recommended), or omitted
   until the feature exists?
3. **Camera's phase.** Not in the roadmap table, which `CLAUDE.md` says is the only numbering.
4. **Confirm the cuts** in §3D and §2: the Calls waveform / Mute / Speaker, the Mirror tool rail's
   Power, the Messages "Encrypted" badge, Settings → Security's 2FA and "Sign out everywhere", the
   sidebar's PRO pill, and Settings → Advanced's connection-state cycler.

---

# Second pass — 2026-08-29, after the README was read independently

Violet accent, green state-only, and Mirror's "do not restructure it" are all confirmed against the
README directly. The OPENS OUTSIDE screenshots are **superseded**; Conflict 2 above is closed on
that basis and no longer blocks the Mirror pane.

## A. The README's input-routing rule vs. defect 20 — **ours is right, and I changed neither**

The README's *Future Android input routing* says, verbatim: *"Discard queued gestures older than
350ms. Clear all queued gestures immediately when the foreground Android package changes. Never
replay stale input into a new foreground app."*

That is defect 20, closed 2026-08-27 — and the design specified it independently, without access to
the run that taught it to us. Defect 20 was not a design review finding: a queued gesture landed on
the launcher during step 32, hit a one-touch contact-dial shortcut, and **placed a real call**,
which re-dialled twice more as the queue drained. Two routes to the same rule, one from drawing the
product and one from it going wrong on somebody's phone, is worth recording as convergence.

Checked clause by clause against the implementation:

| README clause | Ours | Verdict |
|---|---|---|
| Discard queued gestures older than **350ms** | `InputClient.STALE_MS = **400**` (`desktop/src/main/input.ts:69`) | **Differs — keep 400** |
| Clear the queue when the foreground package changes | Not a queue-clear. `foregroundGuard` (`input-module/.../GestureDispatch.kt:114`) refuses at dispatch | **Differs — keep ours** |
| Never replay stale input into a new foreground app | Held by both halves above | **Matches** |

**On 350 vs 400 — ours, and the reason is that it has a denominator.** 400 was chosen against the
phone's *measured* dispatch times: 63 ms a tap, 103 ms a scroll, 203 ms a swipe. The figure is set
so a normal burst of coalesced wheel events still gets through in order behind the slowest single
gesture; at 350 the tail of a coalesced scroll queued behind a 203 ms swipe starts being discarded,
which turns a working scroll into a partial one with a sentence explaining it. The README's 350 is a
reasonable guess and nothing in it claims measurement. This is the same rule as everywhere else in
this repo: a number with a measurement behind it beats a number without one.

**On the queue-clear — ours, and the difference is the more important of the two.** The README wants
the queue cleared *on the foreground-change event*. Ours re-reads `rootInActiveWindow.packageName`
**inside the gesture lock**, immediately before dispatch, and refuses that gesture naming both apps.
Three reasons it stays:

1. **It is strictly more current.** A queue-clear fires when the change is noticed; the check fires
   at the moment of acting. Clearing leaves a race — the package can change between the clear and
   the dispatch of a gesture that survived it — and the check does not. That is `CLAUDE.md`'s own
   rule: *the predicate that decides whether to act is evaluated at the moment of acting, not
   earlier.* A queue-clear is the earlier evaluation.
2. **It needs no event stream.** Clearing on a change means subscribing to window-change
   accessibility events. Ours keeps `accessibilityEventTypes` empty and pulls one field on demand,
   so the app never receives a running record of which apps the user opens.
3. **It fails open, deliberately.** `foregroundGuard` returns null when either package is unknown —
   *"ignorance is never a reason to say no to input the user did make."* An unconditional queue-clear
   has nowhere to express that.

Gestures queued behind a refused one are not stranded: each gets its own check when it reaches the
front, so the queue drains safely rather than being discarded wholesale.

**Nothing was changed.** Both figures and both mechanisms stand as they are.

## B. Float-window geometry — to be implemented exactly as written

Carried verbatim into the Mirror slice, not paraphrased:

```
TITLE = 34; RATIO = 19.5/9; MARGIN = 8
height    = width * RATIO + TITLE
maxWidth()= floor((availableHeight - TITLE - MARGIN*2) / RATIO)     // derived, never hard-coded
clampY(y, w) = clamp(MARGIN, y, max(MARGIN, availableHeight - (w*RATIO + TITLE) - MARGIN))
```

Y is re-clamped with **the same expression drag uses** on every width change — corner-resize, size
presets, and smart-fit alike. The README records this as an invariant learned from a real bug and
notes that clamping drag alone is not enough, because presets and corner-resize escape the desktop
without it. `maxWidth()` is derived from the available height at call time; the README's ≈401 is an
illustration at 920px tall, not a constant.

## C. Scope-cut order — the README's own, adopted unchanged

**Load-bearing** (build these): nav-pill travel · route transition + card stagger · progress rings ·
connection state machine · toggles · transfer-queue progress · row hover reveal · the whole
detached-window drag/resize/focus set.

**Droppable** (cut first): dock magnification · cursor-tracking card glow · drag ghost tilt.

No competing priority order is proposed. The Notifications slice below implements **row hover
reveal** from the load-bearing list and nothing from the droppable one.

## D. Nav pill — measured, never computed

Its Y offset comes from the target row's live `offsetTop`, never from an assumed row pitch: group
headers and badges change the rhythm and a hard-coded pitch desynchronises. Recorded here so the
sidebar slice inherits it. (`matchedGeometryEffect` in a `Namespace` is the native equivalent, and
is not the path this codebase is on.)

## E. The three cuts — confirmed, with reasons

The README does not override any of them; none is contradicted by it, and each is a claim the wire
cannot support.

| Cut | Where | Reason |
|---|---|---|
| **"Encrypted" badge** | Messages thread header (§6) | Our *link* is TLS 1.3; an **SMS is not encrypted**. A badge on a message thread reads as a claim about the message. It is the only place in the mockups that makes a security claim the transport cannot back. |
| **Two-factor + "Sign out everywhere"** | Settings → Security (§12) | `CLAUDE.md` line 1: *no cloud, no account, and no relay server*. There is no account to sign out of and no second factor. **Trusted devices is kept** — `TrustedDeviceEntity` is real. The sidebar's account email and **PRO** pill go for the same reason. |
| **Connection-state cycler** | Settings → Advanced (§12) | A control that makes the UI claim a connection state the link is not in. It is a lie-generator wired to the exact surface this project uses to tell the truth. |

**The cycler is a review tool** the designer built for demoing the state machine, and it is genuinely
useful for that. It may live behind a debug flag — the existing `debugSwitches.ts` seam is where it
belongs — on two conditions: it is **off unless the flag is set**, and it can never be reached from
shipping UI. It must not reach a shipping build. `--force-renderer-accessibility` is already set
this way and is the precedent.

---

# Slice 1 — the Notifications pane. **Staged, not launched.**

Renderer only. No main-process change, no protocol change, no phone change, and **`dist/` was not
rebuilt** — the app that is running is untouched, and `npm start` rebuilds on the next relaunch.

## Files

| File | What |
|---|---|
| `desktop/src/renderer/tokens.css` | **new** — the token layer, 161 lines. Colour, type, spacing, radius, elevation, motion, plus the two hard requirements (`:focus-visible`, `prefers-reduced-motion`) |
| `desktop/src/renderer/notifyLabels.ts` | **new** — the pure label seam, and defect 28's guard surface |
| `desktop/src/renderer/notifyLabels.test.ts` | **new** — 8 tests, including a control |
| `desktop/src/renderer/notifications.ts` | rebuilt in the design language |
| `desktop/src/renderer/styles.css` | pane styles, appended and scoped to `.pane` |
| `desktop/src/renderer/index.html` | links `tokens.css`; the pane's markup |
| `desktop/src/renderer/renderer.ts` | new constructor args; the `reasons` map hoisted to one read |
| `desktop/scripts/copy-assets.mjs` | `tokens.css` added to the copy array |

The token layer is **additive**. The legacy `--bg` / `--card` / `--accent` block stays in
`tokens.css` and the pre-redesign rules stay in `styles.css`, so every unmigrated pane is untouched;
both get deleted by the last pane to migrate. Nothing below the `.pane` scope boundary reaches
outside it.

## SF Pro instead of Archivo, and why that is the handoff's own instruction

The handoff says *"substitute the codebase's native UI face if it has one — SF Pro is an acceptable
native swap."* Taken deliberately: the page's CSP is `style-src 'self'`, so a `fonts.googleapis.com`
`@import` is blocked outright, and vendoring woff2 would put a webfont in an app whose first line of
description is *no cloud, no account, no relay server*. `--font-mono` is `SF Mono / ui-monospace /
Menlo`, all local, with `font-variant-numeric: tabular-nums` on every numeric.

## Defect 28 — proven, not asserted

`notifyLabels.ts` holds every string the pane puts in front of a person, and `userVisibleStringsOf`
**enumerates all seven** so the test asserts over the whole set rather than over the two or three a
person would think to name. That is defect 28's own lesson in test form: it was believed to be two
copies and turned out to be three, found only by enumerating.

**Reintroduced twice, red both times, and put back.**

| Reintroduction | Result |
|---|---|
| `tileInitialOf` reads `one.package` instead of the label | ✖ `the tile initial is not drawn from the package id` — `actual: 'C', expected: 'P'` |
| `replyPlaceholderOf` interpolates `${one.package}` | ✖ two tests — `actual: 'Reply to com.techmash.playo…'`. Caught by the **enumeration**, not by a named assertion |

The second is defect 28's original string shape verbatim, and the enumeration caught it without
being told where to look — which is the property that matters, because the next one will be in a
string that does not exist yet.

Two guards on the guard, so this does not rot:

- `control_the assertion can distinguish a package id from a name` runs a deliberately defective
  label function through the same predicate and requires it to be caught. The negative results in
  that file rest on `!drawn.includes(package)` being able to tell the two apart, and a check that
  cannot separate signal from lookalike returns a clean, confident, wrong answer — the same failure
  as `grep -c remoteinput` reporting two reply actions over two lines of `remoteInputHistory=null`.
  This runs every time, not only when somebody remembers to break it by hand.
- `the enumeration covers every label function the pane can call` asserts the **count** is 7. Adding
  an eighth label function without listing it fails with a diff, instead of silently narrowing the
  coverage of every other test in the file.

**The fallback was not "fixed", and the other half of the rule now holds.** `appName` arrives already
resolved by `AppLabels.of`, which honestly returns the package name for an app with no launcher icon
and keeps `resolved / fell back` on the log line. That is correct. What the Mac was *not* doing was
the rule's second half — *never as the only thing a user reads*. A fallback label is now detected
(`appName === package`), set in the **mono** face rather than the UI face so it reads as a handle,
carries a `package id` chip, and announces as `"com.samsung.… — app name unavailable"` rather than as
a bare package id. The handle appears; it is never alone.

> **Note for `CLAUDE.md`:** the code rules say *"Resolution goes through `AppLabels.of`"* without
> saying where it lives. It is `sync-module/.../v2/AppLabels.kt`. Worth a path, since I looked for it
> in `core/` first.

## The three states, and the two mockup elements that had nothing behind them

| State | Drawn as | Where |
|---|---|---|
| **Empty** (granted, connected, shade genuinely empty) | icon, bold line, explanation, neutral | no notifications; also an empty *filter* over a non-empty shade, which says which filter and how many rows the others hold |
| **Unbuilt** (no concept on the wire) | same skeleton at **elevation 2, never 3**, plus a mono handle naming what does not exist | **Muted** |
| **Unavailable** (phone has it, is not offering it) | `--warning` banner, the phone's `reason` **verbatim** | capability absent |

**Muted.** There is no mute concept anywhere in the protocol — no field, no message, no capability.
Drawn as the handoff's empty state it would be state C rendering what is really state A: an empty
state over nothing, which is the exact failure this pane was chosen to test. So it is a **designed
state, not a blank list** — icon, bold line, explanation — whose content tells the truth: *"Muting is
decided on the phone and is not sent to the Mac,"* with `notif.posted — no mute field in this build`
in mono beneath. Its pill carries a **dot rather than a count**, because `0` would read as "nothing
is muted", which is a claim the wire cannot support.

**"UNREAD" is cut.** The handoff's detail card opens with an UNREAD pill. There is no read/unread
state in the protocol — the same mistake as Muted, one card over. `ongoing` **is** real (the app
pinned the notification and it cannot be swiped away), so that is the pill the card gets.

**Chat and Messages became one pill.** Android has a single `CATEGORY_MESSAGE` (`"msg"`), which is
what `category` carries. Two pills over one category would have split the same rows arbitrarily or
left one permanently empty. The freed slot went to **Can reply**, which is real and is already the
denominator the pane publishes in its note.

## One behaviour change, flagged for veto

The pane used to be **hidden outright** when the capability was absent, with the capability chip
elsewhere carrying the explanation. The original reason was sound — an empty list and an ungranted
permission look identical — but the remedy was to remove the pane rather than to distinguish the
states, which leaves a user hunting for a feature that silently stopped existing.

It now **stays and explains itself**, rendering the phone's `reason` verbatim in a `--warning`
banner. Verbatim is load-bearing: defect 27 was that reason going stale, and it now recomputes on
the phone with the capability set that produced it, so the Mac renders it and does not paraphrase,
cache, or map it to a string table of its own. The card is still hidden when there is no phone at
all — no link, no reason, nothing to say. `renderer.ts` now builds the `unavailable` map **once**,
above both consumers, so two reads cannot disagree.

Say the word and it reverts to hiding; it is one line in `setAdvertised`.

## What was verified without launching

- `npm run typecheck` — clean.
- `npm test` — **63 pass, 0 fail** (8 new).
- Emit checked into a scratch directory, not `dist/`: all 8 label functions emit as top-level
  `function` declarations with **no** `Object.defineProperty(exports…)` wrapper, so they share one
  global scope with the pane exactly as `chips.js` does — which is what the CSP-locked page with no
  module loader requires. **0** `*.test.js` reached the output.

Not verified, because it needs the app running: how it actually looks. The `--warning` banner, the
row-hover reveal, the elevation-2-vs-3 contrast and the mono handle treatment have been reasoned
against the token table, not seen.

---

# Slice 2a — the Mirror pane, embedded layout. **Staged, not launched.**

The layout is the handoff's and is not restructured: primary card holding the tool rail beside the
phone preview with the global-action row under it, 300px right column carrying quality, Advanced and
Stop mirroring. What differs is what is *inside* those slots, and every difference is a row in
`docs/design-departures.md` — **12 Mirror rows**, of which two are Android walls that will never
change.

The headline, because it is worse than expected: **of the design's five tool-rail items and four
Advanced toggles, one is a phone command we can honestly send.** Power and Show touches and Phone
screen off are walls. `mirror.rotate` turns out to be **phone → Mac only** — `MirrorContractTest`
asserts it is never registered as a request, because the Mac cannot turn a phone and a button
claiming otherwise would desynchronise the geometry stamp every input coordinate is checked against.

Two things went the other way and are better than expected:

- **Capture works today with no protocol change at all.** The Mac already holds every decoded frame,
  so a still is one canvas readback. It is now built — the renderer hands a PNG data URL to the main
  process, which owns file IO, and gets back **the path it actually landed at** rather than a toast
  asserting "saved to Desktop" without knowing.
- **The quality presets are real.** `mirror.start`/`mirror.config` accept `frameRate` as well as
  `maxResolution`, so all three of the handoff's rows are backed. The catch is M10: `maxResolution`
  is a cap on the **short edge**, not a resolution, so the pane draws what the phone actually
  captured beside the preset that asked for it.

## What the Advanced card became

Four toggles, none drawable. Instead of four greyed switches — a greyed control is a promise it
might one day light up — each is a row with its reason and a tag that says **which kind of "no"** it
is: `Not possible` in `--warning` for the two walls, `Not yet` in neutral for the two unbuilt. That
distinction is the whole point of the card: a user who reads the wrong one either hunts through
Settings for something that is not there, or stops asking for something we should build.

## One control deliberately not drawn

The handoff's **"Floating window"** toolbar button is not in the markup. Its styles and the geometry
it needs are already built, but the window is the next slice, and a button that does nothing is the
silent no-op this project keeps ruling out. It goes in with the window, not before it.

## Slice 2b's foundation is built and tested ahead of the window

`desktop/src/shared/floatGeometry.ts` — the geometry invariant, transcribed exactly, in the
electron-free layer where a testable seam belongs:

```
height       = width * RATIO + TITLE
maxWidth()   = floor((availableHeight - TITLE - MARGIN*2) / RATIO)
clampY(y, w) = clamp(MARGIN, y, max(MARGIN, availableHeight - (w*RATIO + TITLE) - MARGIN))
```

`resolveBounds` is the single door: drag, corner-resize, size preset and smart-fit all go through
it, which makes *"Y re-clamped with the same expression drag uses"* **structurally true** rather than
four call sites each remembering to do it. There is no path that sets a width without re-clamping Y,
because there is no other path.

Ten tests, written against the failure rather than the formula — the README says the invariant was
learned from a real bug and names presets and corner-resize as the two gestures that escape, so
those two have a test each. Two are worth calling out:

- **`the transcription agrees with the figure the README quotes`** — asserts `maxWidthFor(920) === 401`,
  the README's own number. This is the control on the whole file: if `TITLE`, `RATIO` or `MARGIN`
  were mistyped, every other test would still pass — they would just be testing a different window —
  and this is the only one that would not.
- **`a work area too short for the minimum window still yields a legal Y`** — the inner `Math.max`
  in `clampY`. Without it the upper bound goes negative on a short display and the window is placed
  *above* the top edge, where on macOS it cannot be dragged back.

## Verified

`npm run typecheck` clean · `npm test` **73 pass, 0 fail** (10 new) · every element id `renderer.ts`
binds is present in `index.html`, checked by enumeration rather than by eye · no dangling reference
to the removed `mirror-resolution` select · `dist/` untouched.

**Not verified: how any of it looks.** Two panes are now styled against a token table and never
seen.

---

# Slice 2b — the detached mirror window. **Built and driven on hardware.**

Handoff §3. A real second `BrowserWindow`, opened from the header button slice 2a deliberately left
undrawn. The session is untouched in both directions except for the one row the README makes
explicit: closing the window never stops mirroring, and stopping mirroring always closes the window.

## Files

| File | What |
|---|---|
| `desktop/src/main/float.ts` | **new** — the window lifecycle, behind the README's four methods plus two it names in its interaction table and not in its method list (`moveTo`, `setPinned`), each called out in the header rather than smuggled in |
| `desktop/src/renderer/float.html` | **new** — the second entry point. Same CSP as `index.html` |
| `desktop/src/renderer/float.css` | **new** — §3 only. Does *not* load `styles.css`, which is 1200 lines of panes this window does not have |
| `desktop/src/renderer/float.ts` | **new** — chrome, drag, corner resize, hover dock, screenshot |
| `desktop/src/renderer/h264Canvas.ts` | **new** — decode and paint, extracted rather than copied |
| `desktop/src/renderer/floatButton.ts` + `.test.ts` | **new** — the header button's two states, 4 tests |
| `desktop/src/shared/floatGeometry.ts` + `.test.ts` | `boundsForDrag`, `boundsForCornerDrag`, 4 new tests |
| `desktop/src/main/main.ts` | `sendAll`, the float IPC, config replay on open, close-on-stop |
| `desktop/src/preload.ts`, `renderer.ts`, `index.html`, `scripts/copy-assets.mjs` | the bridge, the button, the two new assets |

## The one design decision this slice had to take on its own

**The frame path.** The handoff specifies the window and says nothing about how a second view gets
pixels. Three options, and the cheap one is right:

- *Move the mirror into the float window* — that is the superseded OPENS OUTSIDE variant, already
  ruled out, and it deletes the in-page canvas Phase 2 closed on hardware.
- *Relay decoded frames between renderers* — a canvas readback plus a structured clone per frame at
  60fps, to save a decode that a Mac does in hardware.
- *Broadcast the access units and decode twice.* Taken. One socket, one session, two decoders.

The interesting part is not the choice, it is what the choice costs: a window that opens **mid
stream** has no parameter sets and no reference frame, and nothing marked `config` is ever coming
again on its own. So opening the window replays the retained SPS/PPS from `video.ts`'s
`configFrame()`, asks the phone for an IDR, and replays the last `status` so the new window is not
sitting there with no device name. `H264Canvas` refuses to start on a P-frame and asks for a
keyframe instead, which is what makes the gap survivable rather than green mush.

## What was left out, and it is one thing

**The canvas takes no taps or swipes.** §3's own interaction table has no row for it — the table is
drag, corner-drag, double-click, pin, red light, and all five are built — but the README's
*Future Android input routing* section says both views feed one gesture queue, so this is a gap
rather than a non-feature. The reason it is a gap and not a copy-paste: pointer input has to quote
the `geometryId` its frame was captured against, cancel an in-flight drag when the phone turns
(defect 19) and refuse a gesture past the staleness window (defect 20). That lives in `mirror.ts`,
and a second copy is the copy that does not get the next fix — where "the next fix" means a stroke
landing on the wrong app on a real phone, which is what defect 20 already cost once.

The hover dock's **Back / Home / Recents** are `performGlobalAction` and carry no coordinates at
all, so they need none of that and shipped. **Screenshot** is a canvas readback on this Mac. Row
**M13** in `docs/design-departures.md` names the seam that closes the rest.

`h264Canvas.ts` is the good half of the same problem and `mirror.ts` is the bad half: the decoder
was extracted for the new window but the Mirror pane was **not** moved onto it, because its copy
interleaves latency stamps, keyframe sizing and the overlay decision into the same callbacks and
untangling a pane that passed on hardware needs its own hardware pass. **That duplication is live**,
and it is row **M15** rather than a comment somebody finds later.

## Verified — and this slice was driven, not reasoned

`npm run typecheck` clean · `npm test` **81 pass, 0 fail** (8 new) · `dist/` carries `float.html`,
`float.css`, `float.js`, `h264Canvas.js`, `floatButton.js`, no `*.test.js`, and no
`Object.defineProperty(exports…)` wrapper on any of the three new renderer scripts.

Each of the eight new tests was **shown to fail against the defect it is named for** and put back:
dropping the grab offset reddens *"a drag holds the grab point under the cursor"*; clamping drag
with its own expression reddens *"clamped by the same expression a preset is"*; anchoring a corner
drag to the pointer reddens *"resizes without moving the window it is anchored to"*; skipping
`resolveBounds` reddens that one **and** *"stops at the minimum width rather than inverting"*;
freezing the button label reddens two of the button tests; leaving the `aria-label` behind reddens
a different two.

On the running app, over CDP, pressing named targets and never coordinates:

| Checked | Result |
|---|---|
| Button, closed | `Floating window`, no dot, `aria-label` "Open mirror in floating window" |
| Button, open | `Show floating window`, dot shown, `aria-label` "Bring the floating mirror window to the front" |
| Pressed three times | **one** window — `/json/list` reports one `float.html` target |
| Window on open | **300 × 684** — `round(300 × 19.5/9) + 34`, the invariant on a real window |
| `setWidth(9999)` | 376 × 849 on this display — **derived**, not the README's 401, which is its 920pt illustration |
| `setWidth(10)` | 220 × 511, the floor |
| Width change alone | moved the window from (1172, 60) to (1128, 33) — Y and X re-clamped by a *width* change, which is the invariant's whole point |
| Real title-bar drag | moved exactly −200 / +90, grab offset held, `.dragging` set and cleared |
| Real corner drag with a wild Y | width 260, height derived, **window did not move** — the vertical component discarded |
| Pin | on, off, and **survived a close and reopen** |
| Red light | window gone, button reverted, link untouched |
| Reopen | width, position and pin all restored |
| Screenshot with no frame | *"There is no picture to save yet."* — not a blank PNG |
| Phone locked | the phone's own sentence, verbatim, in the float overlay |
| **Frames** | **56 painted in the embedded canvas and 56 in the float window**, same stream, two decoders, canvas at 1080×2340 |

Two things were fixed because the window was looked at rather than reasoned about:

- The hover dock sat at `bottom: 14px`, **directly on the phone's own gesture bar** — pressing Home
  meant reaching across the phone's Home. It is 36px now, clear of the ~24px the gesture bar takes
  at this size.
- The dock was hidden with `opacity: 0` alone, leaving an invisible pill that still swallowed
  clicks over the middle-bottom of the phone screen. Harmless while the canvas takes no input and a
  silent dead zone the moment it does. `pointer-events` now moves with the opacity, and `display`
  and `visibility` are both still refused because either would take the buttons out of the tab
  order.

**Not verified:** the window has not been used for a long sitting, so nothing is known about a
second decoder's cost over an hour, and the focused-state border was seen once rather than exercised
across app switches.
