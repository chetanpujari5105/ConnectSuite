# Handoff: ConnectSuite — Mac companion app (11 screens + detached mirror window)

## Overview

ConnectSuite is a macOS desktop app that brings an Android phone's essentials to the Mac:
live screen mirroring, file transfer, photos, messages, notification mirroring, clipboard
sync, calls, phone-as-webcam, an activity log, and settings. The in-app product name is
**ConnectSuite** (sidebar + About). `linkmymac.com` is the marketing domain and appears only
inside sample clipboard/activity data — never as app chrome. Do not present the two as
alternate product names.

The design's defining behaviour: the mirrored phone screen exists in **two views of one
session** — an embedded preview on the Mirror page, and an optional **detached, draggable,
ratio-locked floating window** that can sit anywhere over the desktop, opened from a header
button. Opening or closing the detached window never starts, stops, or duplicates the
mirroring session.

## About the Design Files

The file in this bundle (`ConnectSuite.dc.html`) is a **design reference created in HTML** —
a working prototype that shows intended look and behaviour. It is **not production code to
copy**. The task is to recreate these designs in the target codebase's own environment using
its established patterns and libraries. If no codebase exists yet, choose the framework and
implement there. Recommended targets, in order of fit:

1. **SwiftUI/AppKit** — native, and the design was drawn against real macOS affordances
   (vibrancy, traffic lights, unified toolbar, a real second `NSWindow` for the mirror).
2. **Electron** (`BrowserWindow`) or **Tauri** (`WebviewWindow`) — the prototype's floating
   window is deliberately isolated behind four methods so it can be swapped for a real OS
   window with no other changes (see *State Management*).

The prototype fakes no transport. There is no scrcpy/ADB/network logic, and none should be
inferred from it.

## Fidelity

**High-fidelity.** Final colors, type, spacing, radii, elevation, motion timings and copy.
Recreate pixel-for-pixel using the codebase's own components where they exist. Two caveats:

- **Imagery is placeholder.** Photo thumbnails, avatars and file previews are aspect-correct
  colored placeholders, ready for real assets without layout change. The phone screen, camera
  preview and chart fills are intentionally abstract CSS/SVG — they must look alive, so they
  were never static images.
- **The brand mark is a placeholder glyph** (monoline phone-to-Mac link, violet→cyan gradient
  stroke). It must stay legible at 16px. 24px in the sidebar, 64px in About.

---

## Design Tokens

### Color

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#07070A` | App window ground |
| Elevation 1 (chrome) | `rgba(14,15,21,.72)` + `blur(30px) saturate(140%)` | Sidebar, status island, ⌘K panel |
| Elevation 2 (panel) | `rgba(22,24,34,.82)` | Cards, inspectors — the default surface |
| Elevation 3 (primary) | `#1C1F2B` | The ONE primary card per screen |
| Field / control | `#161822` | Buttons, inputs, tiles |
| Surface border | `rgba(255,255,255,.08)` | Every hairline |
| Inner highlight | `rgba(255,255,255,.05–.07)` inset top | Lit top edge on raised surfaces |
| Text primary | `#F4F4F7` | Headings, values |
| Text body | `#9C9FB0` | Body copy, secondary labels |
| Text meta | `#5B5E6E` | 10–11px non-essential meta ONLY |
| Text on control | `#E7E7EE` | Button labels, list rows |
| Violet accent | `#8B6BFF` | Selected state, primary action fill |
| Violet text/icon | `#8B7AFF` | Accent text and icons (lighter, for contrast) |
| Violet tint | `rgba(139,107,255,.13–.18)` | Selected fills, nav pill |
| Cyan secondary | `#22D3EE` | Secondary data accent |
| Live / connected | `#32E58A` | Connection state, LIVE badge, success |
| Warning | `#F5B23D` | Weak link, paused, quiet hours |
| Destructive | `#FF5D5D` | Destructive actions and failure states ONLY |
| Traffic lights | `#FF5F57` `#FEBC2E` `#28C840` | Window controls (macOS values) |

**Red is reserved.** `#FF5D5D` means destructive or failed. Never use red as an accent,
selected state, or brand color — in a connection product red reads as "link is down."

### Contrast (measured, against the surface each pair sits on)

```
#F4F4F7 on rgba(22,24,34,.82) → 15.4:1     #F4F4F7 on #1C1F2B → 13.1:1
#9C9FB0 on rgba(22,24,34,.82) →  6.6:1     #9C9FB0 on #1C1F2B →  5.6:1   (body, clears AA)
#5B5E6E on rgba(22,24,34,.82) →  2.6:1     10–11px meta only, never body copy
#32E58A / #8B7AFF / #FF5D5D on panel → 9.4 / 5.4 / 6.2:1
```

Keep saturated pixel area under ~10% per screen.

### Typography

Archivo throughout (`font-family: 'Archivo', system-ui, sans-serif`; substitute the codebase's
native UI face if it has one — SF Pro is an acceptable native swap).

| Role | Size / weight / tracking |
| --- | --- |
| Page title | 31px / 600 / -0.02em |
| Section + card title | 15–21px / 600 / -0.015 to -0.02em |
| Body | 13–13.5px / 450–500 / 1.5 line-height |
| Control label | 12.5–13px / 500 |
| Meta | 11–12px / 500 / 0.02em |
| Sidebar group header | 10px / 600 / 0.12em / uppercase |

**All numerics use a tabular mono face** (`'SF Mono', ui-monospace, Menlo, monospace` +
`font-variant-numeric: tabular-nums`): latency, byte sizes, percentages, timestamps, IPs,
window geometry, dialer digits, file names. Archivo holds at 11–12px for labels but its
proportional figures jitter as values update — this is the only reason a second face exists.

### Spacing, radius, elevation

- Spacing: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28px. Page padding 28px; card
  padding 16–24px; grid gaps 10–16px.
- Radius: **10** (controls, chips) / **14** (tiles, inner cards) / **18** (panels) / **24**
  (app window, phone body). Pills use `999px`.
- Elevation is hairline + shadow + inner highlight, never a heavier fill:
  `0 1px 0 rgba(255,255,255,.05) inset` plus `0 10px 30px rgba(0,0,0,.35)` (panel) or
  `0 24px 56px rgba(0,0,0,.5)` (primary card) or `0 20px 48px rgba(0,0,0,.5)` (float window).
- Surfaces must not all read at the same weight. One primary card per screen, at most.

### Motion

| Gesture | Duration / easing |
| --- | --- |
| Hovers, page transitions, ring fills | 180–220ms `cubic-bezier(.22,1,.36,1)` |
| Nav pill travel | 200ms `cubic-bezier(.22,1,.36,1)` |
| Toggle thumb + track | 160ms `cubic-bezier(.22,1,.36,1)` |
| Float window open/close | 220ms `cubic-bezier(.16,1,.3,1)`, growing from the embedded preview |
| Card entrance stagger | 50ms per card, capped at ~4 |
| Button press | `scale(.98)` for 80–120ms |
| Ambient background blobs | 46–60s drift loops |

Only `transform` and `opacity` animate. `@media (prefers-reduced-motion: reduce)` disables
every animation and transition. Hover lift on cards is 1–2px plus a border shift — nothing more.

### Focus

`:focus-visible { outline: 2px solid #8B6BFF; outline-offset: 2px }` on every interactive
element. Never leave a browser/system default ring.

---

## App Shell

Window: 1440 × 920, radius 24px, `overflow: hidden`, hairline border, deep drop shadow. Outer
page ground is a radial violet-to-black gradient; three blurred violet/cyan/teal blobs drift
behind the chrome at 6–10% opacity. **This is the only place gradient appears as a field** —
no gradient CTAs.

### Sidebar (232px, fixed)

Elevation 1 glass with a lit top-left inner edge and a right hairline. Top to bottom:

1. **Traffic lights** — 12px circles, 8px gap, 52px tall row, 20px left padding.
2. **Brand** — 24px glyph + "ConnectSuite" 15px/600/-0.015em.
3. **DEVICE group header**, then the **device card**: 14px radius, `#161822`, 30px rounded
   phone icon tile in violet tint, "Galaxy S26 Ultra" 12px/600, then a status line —
   pulsing 6px `#32E58A` dot, "Connected", mono "79%".
4. **MENU group**: Overview, Mirror, Files, Photos, Messages, Notifications (badge "3"),
   Clipboard, Calls, Camera. Rows are 38px, 10px radius, 20px line icons, 13.5px/500 labels
   at `#9C9FB0`, rising to `#F4F4F7` on hover; icon scales 1.06 on hover.
5. **SYSTEM group**: Activity, Settings.
6. **Footer** (top hairline): 30px gradient avatar "CP", "Chetan Pujari" 12.5px/600,
   `chetan@connectsuite.app` 11px truncated, "PRO" pill.

**Active nav pill** — a single absolutely-positioned element, violet tint fill
`rgba(139,107,255,.15)`, `rgba(139,107,255,.28)` border, `0 0 22px rgba(139,107,255,.18)`
glow, that **slides** between rows in 200ms. Critical: its Y offset must be **measured from
the live DOM** (the target row's `offsetTop`), not computed from an assumed row pitch — group
headers and badges change the rhythm and a hard-coded pitch desynchronises. In SwiftUI use
`matchedGeometryEffect` in a `Namespace`.

### Main region

- **Title bar band**: 60px of reserved space at the top of the content column so the floating
  status island never overlaps the page title.
- **Status island** — top-center, absolutely positioned over the chrome: 28px pill, elevation 1
  glass, pulsing status dot, 11.5px label. Cycles real session events every ~5.2s
  ("Connected · 10 ms", "Clipboard synced", "Transfer complete · 4.2 MB").
- **Header**: page title 31px/600/-0.02em, subtitle 13.5px `#9C9FB0` below. Right side toolbar,
  all 32px tall / 10px radius / `#161822` / hairline:
  `[ Search ⌘K ] [ Device settings ] [ Floating window (Mirror page only) ] [ ••• ]`
- **Content**: scrollable, 28px horizontal padding, `page-in` 260ms entrance keyed to the route.
- **Dock** — bottom-center, 5 × 36px app tiles (Mirror, Files, Messages, Calls, Camera) in
  tinted fills. Magnifies to `scale(1.35) translateY(-8px)` on hover with `1.16/-3px`
  neighbour falloff and a label tooltip above.
- **⌘K palette** — 560px, elevation 1 glass, 20px radius, over a `rgba(4,4,8,.5)` +
  `blur(6px)` backdrop, 120px from the top. Search field with an "esc" hint; 44px result rows
  with an icon tile, label, group, and mono shortcut. First row is pre-highlighted.
  **Commands come before navigation**: "Mirror phone" (⌘⇧M), "Stop mirroring" (⌘⇧.),
  "Toggle always on top" (⌘⇧T), "Take screenshot" (⌘⇧4), then all 11 screens (⌘1–⌘9, ⌘,).
  Opens on ⌘K/Ctrl+K, closes on Escape.
- **Toast** — bottom-center above the dock, 32px glass pill with a `#32E58A` dot; used for
  "Screenshot saved to Desktop". 220ms `cubic-bezier(.16,1,.3,1)` in, auto-dismiss at 2.4s.

### Connected-device strip

On every screen except Overview, directly under the header: 14px radius, `rgba(22,24,34,.66)`,
26×40 phone thumbnail, "Galaxy S26 Ultra" 13.5px/600, colored state dot + label, then
right-aligned mono latency, a divider, and mono battery.

---

## Screens

### 1. Overview — "Good morning, Chetan" / "Your phone and Mac are in sync."

Two-column grid `1.04fr 1fr`, 16px gap.

- **Device card** (primary, elevation 3): 150px phone render on the left; right side has the
  device name + "Connected" pill, then a 2×2 mono metric grid (Connected via / Latency /
  Encryption / Signal), a hairline, then "Start mirroring" (solid `#8B6BFF`, 40px, with a
  mono ⌘⇧M hint) and "Device info".
- **Quick actions**: 2×4 grid of 14px-radius tiles, each a 36px tinted icon square + title +
  sub. Screen, Files, Photos, Notifications ("3 new"), Messages, Clipboard, Calls, Camera.
- **Recent activity** (panel): 52px rows — mono time, 26px tinted icon, description, and a
  right-aligned detail that **slides in on row hover** (`opacity 0→1`, `translateX(6px)→0`).
- **Device status** (panel): three SVG progress rings (Battery 79% `#32E58A`, Storage 50%
  `#8B6BFF`, Memory 48% `#22D3EE`) that animate `stroke-dashoffset` over 900ms with 80ms
  stagger on mount and on every route entry; below, a 2-cell hairline-divided grid
  (Connection type, mono IP address).
- **Security footer** (full width): shield icon, "Connection is encrypted end-to-end. Only
  your devices can read this traffic.", and a coral outline "Disconnect" pill.

### 2. Mirror — "Screen mirror" / "Control your phone from your Mac in real time."

Grid `1fr 300px`. **This page is the approved reference layout — do not restructure it.**

- **Primary card**: centered row of
  1. **Vertical tool rail** — 16px radius `#111219` panel, 64px items with an 18px icon over a
     10px label: Power, Rotate, Capture, Record, Transfer.
  2. **Embedded phone preview** — 268px wide, 9:19.5, 24px radius, violet→teal gradient body
     with two radial highlights. Contains: mono status row (12:45 / 79%), a notch pill, a
     pulsing "LIVE" badge, "23°" 44px + "Partly cloudy · New Delhi", a search pill, two 4-up
     app-tile rows, and a three-glyph Android nav bar.
  When the session is stopped, a `rgba(7,7,10,.78)` overlay covers the screen with
  "Mirroring stopped" and a violet "Start mirroring" button.
  Below the phone: **Back, Home, Recents, Alerts, Lock** — five 78px buttons, icon over label.
- **Right column**:
  - **Mirroring quality** — three selectable rows (1080p · 60 FPS "Recommended", 720p · 30 FPS
    "Smooth on weak links", 480p · 30 FPS "Battery saving"), each 14px radius with a title,
    sub, and an 8px dot that fills violet when selected.
  - **Advanced** — 50px toggle rows: Sound from phone, Show touches, Keep screen on,
    Phone screen off. Toggles are 42×24 pills, `#8B6BFF` track when on with a soft violet
    glow, white 18px thumb travelling 18px in 160ms.
  - **Stop mirroring** — 44px, `rgba(255,93,93,.10)` fill, `rgba(255,93,93,.3)` border,
    `#FF5D5D` label. The strongest-signal action on the page.

#### Header button — "Floating window"

Matches Device settings exactly (32px, 10px radius, `#161822`, hairline) with a violet
pop-out/detach icon (never a phone icon) and `border-color: rgba(139,107,255,.34)` on hover.
Tooltip and `aria-label`: "Open mirror in floating window". Sits between Device settings and
`•••`, and only on the Mirror page. Must read as clearly less important than Stop mirroring.

States: **"Floating window"** by default → after opening, **"Show floating window"** with a
6px `#32E58A` dot before the label, which only refocuses the existing window. **Never create
a second instance.** On close it reverts to "Floating window" and mirroring continues.

### 3. Detached mirror window

A real second window (`NSWindow` / `BrowserWindow` / `WebviewWindow`); in the prototype an
overlay at `z-index: 50`. Radius 14px, `#0B0C12`, hairline, `0 20px 48px rgba(0,0,0,.5)`.
**Contains only** the title bar and the phone screen — no sidebar, dashboard, inspector cards,
dock, or tool rail.

- **Title bar** (34px, `rgba(18,20,28,.94)`, bottom hairline): three 11px traffic lights, then
  centered `#32E58A` dot + mono "Galaxy S26 Ultra", then a pin button
  (`#8B7AFF` when always-on-top is on, `#5B5E6E` when off).
- **Phone screen**: the same live view as the embedded preview — status row, LIVE badge,
  weather block, two app-tile rows, Android nav bar.
- **Hover dock**: appears on window hover, bottom-center above the nav bar — glass pill with
  Back, Home, Recents, Screenshot; `opacity 0→1` + `translateY(8px)→0` in 200ms, hides on
  pointer leave. Screenshot fires the "Screenshot saved to Desktop" toast.
- **Resize handle**: 20px diagonal glyph, bottom-right, `cursor: nwse-resize`.
- **Focused state**: border `rgba(139,107,255,.34)` and
  `0 0 0 1px rgba(139,107,255,.14), 0 26px 60px rgba(0,0,0,.56)`. Restrained — no bloom.
  Clicking the main app releases focus.

Interactions:

| Gesture | Result |
| --- | --- |
| Drag title bar | Moves the window; clamped to the desktop; transition dropped mid-gesture so it tracks the cursor exactly; `scale(1.008)` lift and deeper shadow while held |
| Drag corner | Resizes 220px–`maxWidth()`, **9:19.5 locked** — width is the only input, height and Y follow |
| Double-click title bar (or green light) | Smart-fit back to the 300px medium default |
| Pin | Toggles always-on-top; synced with the sidebar/inspector toggle |
| Red light | **Closes the window only** — session, device, quality and toggles all persist |

**Geometry invariant, learned from a real bug:** `height = width × 19.5/9 + 34`. Every width
change must re-clamp Y with the same expression drag uses, and the width cap must be derived
from the available height, not hard-coded:

```
TITLE = 34; RATIO = 19.5/9; MARGIN = 8
maxWidth() = floor((920 - TITLE - MARGIN*2) / RATIO)          // ≈ 401 at 920px tall
clampY(y, w) = clamp(MARGIN, y, max(MARGIN, 920 - (w*RATIO + TITLE) - MARGIN))
```

Clamping drag alone is not enough — presets and corner-resize escape the desktop without it.

### 4. Files — "Browse and move files between your phone and Mac."

Grid `1fr 320px`. Primary card: breadcrumb bar (mono path + "Copy to Mac" / coral "Delete"),
then `196px 1fr` split — indented folder tree on the left (active folder gets the violet
tint + border), file table on the right with a 34px `NAME / DATE MODIFIED / SIZE` header,
48px rows (32px thumb, mono name, date, right-aligned mono size, hover-revealed row actions),
and a selection footer ("1 selected · 3.2 MB" / mono "1,245 items"). Below: two dashed
drop zones — violet "Drop files to send to phone", blue "Drop here to download to Mac".
Right column: file inspector (4:3 preview + mono filename + Kind/Size/Dimensions/Modified)
and **Transfer queue** — mono filename over a 6px violet→cyan progress bar with mono percent,
then a completed row with a `#32E58A` check.

### 5. Photos — "View, organise and import photos from your phone."

Grid `1fr 320px`. Primary card splits `188px 1fr`: album list (All photos, Camera, Screenshots,
Downloads, Videos, Favourites — each with a mono count) and a date-grouped 4-up grid of 12px
tiles (Today / Yesterday / 14 May 2024), video tiles carrying a mono duration chip; the
selected tile gets a violet border. **Favourites is an empty state** by design: centered icon,
"Nothing in this album yet", and one line of explanation. Right column: EXIF inspector
(Taken / Camera / ISO / Size) and four quick actions ending in coral "Delete from phone".

### 6. Messages — "Send and receive SMS and chat messages."

Three columns `280px 1fr 300px`, 600px tall. Conversation list with All/SMS/Chat filter pills
and 60px rows (34px gradient initials avatar, name, truncated preview, mono time; selected row
tinted violet). Thread: header with avatar, name, mono number and an "Encrypted" badge; bubbles
at 16px radius with a 6px tail corner — incoming `#161822` + hairline, outgoing
`rgba(107,90,240,.9)`; centered date separators; an attachment bubble with a file chip;
a 38px rounded input with a circular violet send button. Contact panel: 72px avatar, name,
number, three action buttons (call / video / info), a "Shared media" 4-up grid with a "+12"
tile, a mute toggle, and a coral "Block contact".

### 7. Notifications — "Mirror and reply to phone notifications."

Grid `1fr 380px`. Left: filter pills (All / Chat 2 / Messages 1 / Muted) then 66px cards —
34px tinted app tile, app name, truncated body, mono time, and hover-revealed accept/dismiss
buttons; the selected card is violet-tinted. **Muted is an empty state.** Right (primary card):
notification detail with an "UNREAD" pill, the message quoted in an inset panel, three quick-reply
chips ("On my way", "In five minutes", "Not today"), a reply field with a violet send button,
and a 2×2 action grid ending in coral "Dismiss".

### 8. Clipboard — "Copy on your phone, paste on your Mac."

Grid `1fr 340px`. Primary card: History / Favourites / Pinned tabs plus a coral "Clear all",
then 72px rows — a 36px mono kind badge (URL, Aa, IMG, {}, FILE), content, source + age meta,
and hover-revealed copy/star actions; footer reads mono "128 items in history". Right: the
selected item — "LINK" kicker, 44px icon, the URL wrapping, a Copy (violet) / Open / Share
row, an Information grid, and a three-step **sync timeline** with mono timestamps
(Copied on phone → Synced to ConnectSuite → Available on Mac).

### 9. Calls — "Make and receive phone calls from your Mac."

Three columns `300px 1fr 300px`. Call history with All / Missed 1 / Contacts pills and 56px
rows (missed calls in coral). Center (primary): "End-to-end encrypted" line, 104px avatar,
name 22px, mono number, mono call timer, a **40-bar audio waveform**, a 3-up Mute / Keypad /
Speaker row (Speaker active in violet), a 60px circular coral end-call button, and an
audio-routing note. Right: a 3×4 dialer (mono digit over a letter row), a 48px violet call
button, and a "Frequently called" list.

### 10. Camera — "Use your phone camera as a Mac webcam."

Grid `1fr 340px`. Primary card: 16/9 preview with an abstract subject silhouette, a pulsing
"LIVE" badge, flip/expand controls, and a mono "1920 × 1080 · 60 FPS · MJPEG" readout; below,
a three-cell control row (Front/Back segmented, Resolution and Frame rate dropdowns) and five
compact setting tiles (Flash Off, HDR Auto — violet-selected, Focus Auto, mono Zoom 1.0×,
Stabilise On). Right: camera toggles (Mirror my video, Grid overlay, Low light boost), an
"Available in Mac apps" 5-up tile row with explanatory copy, and a violet "Start camera".

### 11. Activity — "Every sync, transfer and session, logged."

Grid `1fr 320px`. Primary card: category pills (All / Mirroring / Files / Messages / Calls /
System), a 34px `ACTIVITY / DETAILS / TIME` header, 48px rows (24px tinted icon + kind, detail,
right-aligned mono timestamp), and a footer with "Showing 9 of 48 events" plus 1/2/3 pagination.
Right: **Today's summary** — a three-arc SVG donut (violet Files 12, cyan Mirroring 8,
green Messages 6, grey System 22) with a mono "48 / EVENTS" center and a legend with mono
counts; **Last 7 days** — an area sparkline with a violet stroke, a violet-to-transparent fill,
a cyan peak dot and mono date labels; then "Export log as CSV".

### 12. Settings — "Tune ConnectSuite to your workflow."

Three columns `200px 1fr 320px`. Left: eight panes — General, Connection, Notifications,
File transfer, Mirror, Security, Advanced, About. Center (primary): pane title + sub, then
hairline-separated rows, each a label + explanatory sub with its control right-aligned
(toggle, segmented control, or dropdown).

- **General**: Start on login, Keep in the menu bar, Appearance (System/Light/**Dark** — Dark
  selected; light mode is deferred), Interface sounds, Automatic updates.
- **Security**: Lock ConnectSuite (with icon tile), Auto-lock "After 5 min", Two-factor
  "Enabled" in green, Trusted devices "3 devices", then a coral-bordered
  **"Sign out everywhere"** block with a "Sign out all" button.
- **Advanced**: Transfer over Wi-Fi only, Accept transfers automatically, a **connection-state
  cycler** (Connecting / Connected / Weak / Disconnected — drives the status strip and island
  for review), and a mono diagnostics block (link, codec, session, reconnects) with a violet
  caret.
- Connection / Notifications / File transfer / Mirror / About render as label + sub + value rows.

Right column: About card (64px brand glyph, "ConnectSuite", mono "Version 1.0.0", tagline),
Account card (avatar, name, email, PRO pill, three chevron rows), and a green-tinted
"You are up to date" card.

---

## Interactions & Behavior

- **Routing**: sidebar rows, dock tiles, Overview quick-action tiles, and ⌘K all navigate.
  Route change re-runs the content entrance (260ms) and re-triggers ring/donut fills.
- **Row hover reveal**: list-row actions animate `opacity` + `translateX(6px)` in 200ms
  (Files, Notifications, Clipboard, Overview activity).
- **Card hover**: `translateY(-2px)` + border to `rgba(255,255,255,.14)`. Tiles also lift the
  fill to `#1C1F2B`.
- **Toggles**: 160ms; track to `#8B6BFF` with `0 0 16px rgba(139,107,255,.4)`; thumb travels 18px.
- **Segmented / chip selection**: violet tint fill + violet border; unselected are transparent
  or `#161822`.
- **Empty states are designed, not blank**: Photos → Favourites, Notifications → Muted. Icon,
  one bold line, one explanatory line, max ~300px wide.
- **Connection states** drive the strip, island dot, and float-window dot together:
  Connecting `#F5B23D` "— ms", Connected `#32E58A` "10 ms", Weak `#F5B23D` "184 ms",
  Disconnected `#FF5D5D` "— ms".
- Load-bearing interactions, if scope must be cut: nav-pill travel, route transition + card
  stagger, progress rings, connection state machine, toggles, transfer-queue progress, row
  hover reveal, and **the whole detached-window drag/resize/focus set**. Droppable:
  dock magnification, cursor-tracking card glow, drag ghost tilt.

## State Management

Keep three groups **separate** — the embedded view and the detached window are two consumers
of one session, and conflating them is what produces duplicate-session bugs.

```
mirrorSession        isMirroring, qualityPreset ('high'|'mid'|'low'),
                     soundFromPhone, showTouches, keepScreenOn, phoneScreenOff

embeddedMirrorView   isVisible, receivesInput

floatingMirrorWindow isOpen, isFocused, isAlwaysOnTop, x, y, width, height
                     (height derived: width * 19.5/9 + 34)
```

Transitions:

| Trigger | Effect |
| --- | --- |
| Header "Floating window" | `isOpen ? focus() : open()` — never a second instance |
| Float red light / `closeFloat()` | `isOpen = false` only. Session, device, quality, toggles untouched |
| "Stop mirroring" (inspector or ⌘⇧.) | `isMirroring = false`, `isOpen = false`. Device stays paired |
| Double-click title bar | `width = 300`, then re-clamp Y |
| Size preset / corner drag | `setWidth()` → clamp to `[220, maxWidth()]` → re-clamp Y |
| Pin (title bar or inspector) | Single shared `isAlwaysOnTop` |

Isolate the window lifecycle behind exactly four methods — `openFloat`, `closeFloat`,
`smartFit`, `setWidth` — and let nothing else read the coordinates directly, so they can be
replaced with `BrowserWindow` / `WebviewWindow` / `NSWindow` calls without touching the UI.

Other app state: `route`, `cmdkOpen`, `cmdkQuery`, `islandMessage`, `toast`,
`connectionState`, `selectedAlbum`, `selectedChat`, `notificationFilter`, `settingsPane`,
plus the settings toggle map.

### Future Android input routing

Both views feed one gesture queue. Carry this rule into the transport layer verbatim:

> Discard queued gestures older than 350ms. Clear all queued gestures immediately when the
> foreground Android package changes. Never replay stale input into a new foreground app.

No transport is implemented or implied in the design.

## Native translation notes

- Glass surfaces (sidebar, island, ⌘K panel) → `NSVisualEffectView` `.sidebar` / `.hudWindow`.
- Ambient blobs → two `CAGradientLayer`s on slow `CABasicAnimation`, or one Metal noise layer.
- Nav pill → `matchedGeometryEffect` across nav rows in a `Namespace`.
- Rings and donut → `Shape` + `trim(from:to:)` + `.animation(.easeOut(duration:0.9))`.
- Brand gradient → `LinearGradient` masked by the glyph path.
- Traffic lights, unified toolbar and vibrancy come free from the window — do not redraw them.
- The detached mirror should be a real always-on-top window (`.floating` level) with
  `aspectRatio` set on the content view so the OS enforces the 9:19.5 lock.

## Light mode (deferred)

Dark is the shipping theme. Light is a token remap once dark is signed off, not a redesign:
ground `#FAFAFC`, cards `#FFFFFF`, hairlines `rgba(0,0,0,.07)`, violet darkened to `#5B4AE0`
for contrast on light, same radii/spacing/motion.

## Assets

None shipped. Everything is code-drawn: line icons are hand-authored SVG on a 24px grid at
1.5–1.7 stroke (Lucide is a compatible drop-in), the brand glyph is inline SVG, and all
imagery is placeholder fills. Supply real photo/avatar/file thumbnails at the documented
aspect ratios; keep the phone screen, camera preview and charts procedural so they animate.

## Files

- `ConnectSuite.dc.html` — the full 11-screen prototype including the detached mirror window,
  ⌘K palette, and every interaction described here. Open it in a browser and click through;
  the Settings → Advanced connection-state cycler and the Mirror header button are the two
  fastest ways to see the state machines.
- A design-rationale comment block sits at the end of that file (token table, measured
  contrast, motion timings, native translation).
