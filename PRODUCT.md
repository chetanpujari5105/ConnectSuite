# Product

<!-- impeccable:product-schema 1 -->

**Scope of this record: the Mac-side Electron app in `desktop/` only.** The Android app is the other
half of the same product and is deliberately out of scope for design work — see *Capabilities and
Constraints → Scope boundary*.

## Platform

web

> The bare value above is the schema's, and it is the closest of the four permitted values. It does
> **not** mean this is a web product. Sidekick for macOS is an **Electron desktop application**
> distributed as a `.dmg`; the renderer happens to be HTML/CSS/TypeScript. It is not a website, a
> SaaS dashboard, a marketing surface, or a browser tab, and no work on it should assume a visitor,
> a session, a landing page, a signup, or a page load. Read *Operating Context* before designing.

## Users

**Primary, today: one operator — the author — on their own machine.** A Mac in front of them, their
own Android phone nearby or in a pocket, both on the same private Wi-Fi or on the phone's hotspot.
They know the protocol, own both devices, and read the logs. Machine handles and namespace strings
on screen are useful to them, not noise.

**Confirmed intent: "me now, strangers later."** The app is personal today, but **no decision may
foreclose distribution.** Copy, onboarding, permission explanations and failure states are written
for someone who has never seen the product, even while the only user is the author. The author's own
name must never appear in shipped copy — that was a real defect (D1: a hardcoded *"Good morning,
Chetan"* greeted every user of the app by the author's name, at every hour of the day).

**The job.** Do phone things without picking up the phone: read and answer a notification, reply to
a text, take or place a call, pull a file or a photo across, paste something between machines, drive
the phone's screen. The session is not a visit — the window is left open for days, and the link
drops and returns underneath it.

## Product Purpose

Two apps that connect an Android phone to a Mac over the local network with **no cloud, no account,
and no relay server.** This record covers the Mac half.

Success is that the user scans a QR code once and never thinks about the connection again. The
behavioural target is LinkMyMac: notification mirroring with reply, SMS and MMS threads, call events
and dialling, contacts, file transfer both directions, a photo and video browser with drag to
Finder, bidirectional clipboard with history, screen mirroring with control, app launching, and a
media remote.

## Positioning

**Everything is local, and the app can prove it.** Not "privacy-focused" as a claim — as a
mechanism a neighbouring product could not truthfully copy:

- TLS 1.3 with self-signed certificates on both ends and SHA-256 fingerprint pinning after pairing.
  **No plaintext fallback, ever.**
- The **phone** binds the listening sockets; the Mac connects out. Nothing is reachable from outside
  the local network, and there is no relay to add one.
- No account exists to have. Nothing to sign into, nothing to sign out of.

**And an honest-refusal posture, which is the second half of the position.** Where the platform
forbids something, the app removes the control and prints one sentence saying why — it does not grey
a button out, because a greyed control is a promise it might one day light up. Where a feature is
not built, the empty state names the phase, never "coming soon". This is locked architecture
decision 6 and it is a product commitment, not a code style.

## Operating Context

**The shipping artifact.** Electron 43 + TypeScript, packaged by electron-builder as a macOS `.dmg`
and `.zip`, arm64 and x64. `appId: com.chetan.sidekick.desktop`. Category:
`public.app-category.utilities`. `LSMinimumSystemVersion: 11.0`. Dark mode supported.

**The window.** One resizable main window with a sidebar of **twelve** nav rows in two groups (MENU
and SYSTEM) and **thirteen** routed sections, a ⌘K command palette that ranks both screens and deep
links, a status island, and a dock. A second `BrowserWindow` provides an always-on-top floating
mirror. macOS shows a `NSLocalNetworkUsageDescription` prompt the first time the app reaches the
phone.

**The link.** Three sockets to the phone: **42501** control (JSON), **42502** video, **42503** bulk
transfer, the last two authorised by the session token from the control handshake. Discovery order
on the Mac: last known IP → default gateway (the phone is the gateway on its own hotspot) → mDNS
`_connectsuite._tcp` → manual IP entry. Pairing is a QR code the Mac draws and the phone scans, once.

**The rhythm of use.** Long-running and interruptible. The phone sleeps, Doze suspends sockets, Wi-Fi
changes, the link drops and reconnects on its own. Every pane must read correctly in the connected,
degraded, and disconnected cases, and those are daily states rather than edge cases.

**The app reaches people who are not looking at it.** Native macOS notifications ship
(`src/main/nativeNotifier.ts`), with the decision logic split into `src/shared/nativeNotify.ts` so it
is testable. macOS exposes no way to read notification authorization in advance, so the feature is
built not to need it — a refusal is observed via the `failed` event, not predicted.

## Capabilities and Constraints

**Scope boundary.** Design and code work covered by this record touches `desktop/` only. The Android
side (`app/`, `core/`, `sync-module/`, `mirror-module/`, `input-module/`) is out of scope. The wire
contract `docs/protocol.md` is shared and is changed there first, then on both sides.

**The panes** (sidebar order; every screen declares its own `state` in `src/renderer/navModel.ts`):

| Pane | State |
|---|---|
| Overview, Mirror, Files, Photos, Messages, Notifications, Clipboard, Calls, Apps | built |
| Activity, Settings (SYSTEM group) | built |
| **Camera** (phone as Mac webcam) | **unbuilt** — there is no virtual camera on this Mac; no namespace proposed. Parked behind signing |
| Pair a phone | built, off the sidebar |
| Deep links: *Now playing* (media remote), *Contacts* | built, reachable from the palette |

**Architecture constraints that are product truth, not preference:**

- Sockets and file IO live in the **main** process. The renderer only draws and sends intents over
  IPC.
- **The renderer is loaded as classic `<script>` tags and cannot use `export`.** A file with one
  throws on its first line and every declaration below it is dead — silently. Testable logic lives in
  `src/shared/`, hung on `globalThis`. Enforced by `scripts/check-renderer-scripts.mjs` on commit.
- **One selector belongs to exactly one stylesheet.** `tokens.css` owns colour plus the two global
  requirements; `shell.css` owns the frame (window, sidebar, nav, island, dock, palette, toast);
  `styles.css` owns what lives inside a screen. They load into one cascade, so a duplicate rule is
  resolved by document order and the later sheet wins silently. Enforced by
  `src/renderer/stylesheets.test.ts`.
- An icon name that is not in `navModel.iconNamesUsedByTheShell()` is an icon nobody can check. The
  app once shipped with no icons at all and nothing noticed.
- A screen with `state: 'unbuilt'` must carry a headline saying what is missing, a reason naming the
  phase, and a mono handle for the wire namespace — or the honest statement that none was proposed.

**Platform walls the Mac must surface rather than design around** (all Android-side, all permanent):

- Call audio cannot be streamed. The documented answer is Bluetooth pairing.
- Screen capture returns black frames for `FLAG_SECURE` surfaces. Detect and say so; do not retry.
- MediaProjection consent cannot be cached — every capture start needs a fresh tap on the phone.
- **Phone → Mac clipboard cannot be automatic.** Android blocks background clipboard reads; the
  phone sends only while it is open. Mac → phone *is* automatic (a polling watcher, since
  `NSPasteboard` has no change notification). The asymmetry is measured, not chosen, and it is the
  single most frequent daily annoyance in the product.
- There is no path-based view of the phone's storage. `fs.*` browses SAF trees the user granted;
  the storage root and `Download` itself are ungrantable, so a file sitting directly in `Download/`
  can never be reached. `Download/ConnectSuite` is a grant-free destination for pushes.
- No arbitrary key injection. `input.global` is back, home, recents, notifications, quick settings,
  lock screen and the power *menu*, and nothing else. There is no power-button press.
- Nothing works outside the local network without a relay, which is out of scope.

**Known open items on this surface, stated so future work does not rediscover them:**

- **The state vocabulary is inconsistent and needs deciding once.** `docs/empty-and-failure-states.md`
  counts **84 empty and failure states across 19 panes**, and Calls is the *fifth* pane to invent its
  own *unavailable / partial / failed / empty* language. This is the largest named design debt.
- The design handoff has **no drawn state for "the phone has this feature and is not offering it
  right now"** (`docs/design-departures.md` N4) — a normal daily state of this product. That row is
  the one place the design is missing something rather than the wire.
- Renderer-view debt: **11 covered / 2 outstanding** (`MirrorView`, `ShellView`).
- **Nothing is signed, notarized or published.** The `.dmg`'s app is *ad-hoc* signed and Gatekeeper
  returns an error rather than a verdict (`docs/phase-9-distribution-audit.md` D12). The release APK
  is refused outright (D13). The signing configuration exists with credentials deliberately blank.
- Defect 17: the Mac holds one phone structurally and refuses a second rather than evicting it.

**Verification available on this surface:** `npm test` in `desktop/` (`node --test` + `tsx`, no
config file), `npm run typecheck`, nine `git commit` guards, and `scripts/probe.mjs` — the only
sanctioned way to read the running UI over CDP, which requires a `question`, requires a `control`
with no default, refuses text matching for presence questions, cannot express a fixed sleep, and
returns no bare scalars. `__probe.onScreen(selector)` reports `visible` / `reachable` / `stranded`;
a card carrying a *state* must be `visible` at rest, not merely reachable.

## Brand Commitments

- **Name: Sidekick**, renamed from ConnectSuite 2026-09-17 (the Sidekick visual-language pass,
  Mac-side branding only — the Android app, the wire protocol namespace and `_connectsuite._tcp`
  are unchanged; see `docs/design-departures.md` for the boundary). **Bundle id
  `com.chetan.sidekick.desktop`, changed the same day.** It was pinned and warned against editing
  casually for exactly the reason that follows — `safeStorage` keys this Mac's TLS private key to
  it, so changing it is an identity change and the phone then refuses the new fingerprint — and it
  was changed anyway, by explicit instruction naming the new value. Every Mac running this build
  mints a fresh identity; every already-paired phone needs to scan a new QR code.
- **Binding visual authority — confirmed still binding in this interview:**
  `Mac app UI mockups (1)/design_handoff_connectsuite/ConnectSuite.dc.html` plus its `README.md`.
  Authoritative for pixels; the README is authoritative for tokens. Where a screenshot disagrees with
  those two, they win. **A difference not recorded in `docs/design-departures.md` is a bug, not a
  decision.** Note the tension future work must respect rather than resolve unilaterally:
  `docs/phase-7-state.md` records four panes (Calls, Clipboard, Settings, Overview) that worked and
  did not look like the handoff; the 2026-09-04 design pass moved them toward it, with every
  remaining deviation documented.
- `Mac app UI mockups (1)/_ds/` is an **unrelated** design system. Ignore it.
- **Voice:** state the reason, name the mechanism. Never "coming soon". Never a claim the product
  cannot support — a `0` on a pill is a claim, and if the Mac cannot know the number it does not draw
  one. Copy that describes an absence says what is absent and why.
- **A package id or wire namespace may appear as a machine handle, never as the only thing a user
  reads.** Every payload carrying a package name carries a resolved label beside it; a fallback label
  is set in the mono face with a `package id` chip and announces as *"com.… — app name unavailable"*.
- **No personal data of the author in shipped copy or defaults.**

## Evidence on Hand

Real, in this repository, and usable as source material:

| Asset | What it is |
|---|---|
| `Mac app UI mockups (1)/design_handoff_connectsuite/` | The binding handoff: `ConnectSuite.dc.html` (11-screen prototype) + `README.md` (497 lines, full token table) |
| `docs/design-departures.md` | 734 lines, one row per deliberate deviation, each with what would make the design's version correct |
| `docs/empty-and-failure-states.md` | Every empty and failure string currently drawn, matched back to source, 0 stale rows |
| `docs/protocol.md` | The wire contract. 63 of 64 message types specified |
| `docs/testing.md` | Hardware evidence behind every claim, per phase |
| `docs/evidence/phase-7-panes-2026-09-04/` | Screenshots of the built panes against the design |
| `docs/phase-7-state.md` | What is actually left in Phase 7, measured against the running app |
| `docs/mac-ui-design-proposals.md` | 947 lines of prose design findings; nothing in it is implemented |
| `docs/remaining.md` | The complete remaining-work inventory, 2026-09-05, every row citing a file or reading |

**Absences that future work must not fabricate.** There are no users other than the author, no
testimonials, no case studies, no benchmarks, no pricing, no licence terms, no App Store or website
presence, no signed or notarized build, no download page, no second Mac, and no telemetry of any
kind. Every hardware reading in this repository comes from one of **two** Android phones
(`docs/single-device-audit.md`, `docs/second-device-moto-g34.md`) — never from a population.

## Product Principles

1. **Unavailable with a reason beats silently absent.** Every feature degrades to a specific,
   user-visible sentence — permission not granted, phone locked, encoder failed. A blank pane is a
   defect, because the user cannot tell "nothing has arrived" from "this was never built".
2. **Local and provable.** No cloud, no account, no relay. The interface must never imply a server,
   a sync service, or an identity, and must never ask for one.
3. **A wall is stated, not designed around.** Where the platform forbids something, remove the
   control and print the sentence. Never grey out what will never light up.
4. **Pair once, then be quiet.** Connection state is ambient, not a task. The user should think
   about the link only when it needs them.
5. **Publish the denominator.** A count without the number that gives it scale reads as whichever
   story the reader already believes — successes beside failures, frames beside elapsed time, bytes
   beside a rate. This holds in the UI, not only in the logs.

## Accessibility & Inclusion

**Open decision — no standard has been chosen, and future work must not assume one was.** Recorded
explicitly so nobody infers a bar from the code, and nobody infers its absence either.

Two commitments **are** confirmed in the build and are owned globally by `tokens.css`:

- `:focus-visible` is a global requirement, not a per-component choice.
- `@media (prefers-reduced-motion: reduce)` is honoured (`tokens.css`, `styles.css`, `float.css`).

Everything else — a contrast target, keyboard reachability of every control, VoiceOver labelling,
Increase Contrast — is undecided. One relevant fact for whoever decides: driving this app for testing
requires launching Electron with `--force-renderer-accessibility`, because without it Chromium
exposes a single opaque `AXGroup` and no accessibility tree exists to read.
