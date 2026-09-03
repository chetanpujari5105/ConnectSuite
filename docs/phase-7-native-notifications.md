# Native notifications on the Mac — the scope, measured before anything was built

> **The feature that decides whether this app gets opened in week two.** `docs/phase-7-state.md` §5.2
> is the argument for why; this is what is actually being built, and the five questions that had to
> be answered first.
>
> **Everything below marked *measured* was read on this machine before a line was written.** Two of
> the five answers came back differently from the assumption, and one of them (§1.4) is the single
> most likely way this feature ships broken.

---

## 0 · What was measured, and the control that failed first

`Notification` has never been imported in this app — 13 electron symbols across 91 files, and not
that one. So every question below was open.

| Reading | Result |
|---|---|
| `Notification.isSupported()` | **`true`** — and it is **not** a permission check. It is a static capability answer and returns `true` on a machine that refuses every notification. Do not gate on it |
| `notification.show()` return | **0–3 ms**, always. Fire-and-forget. **It is not a delivery signal** |
| A refusal | **observable** — the `failed` event fires with `UNErrorDomain error 1` (`notificationsNotAllowed`) |
| Reading authorization *in advance* | **no API.** Electron exposes no `getNotificationSettings` equivalent on macOS |
| A dev run's identity | ~~`com.github.Electron`~~ — **wrong, corrected 2026-09-03.** That is what `Info.plist` *declares*; the signature **does not bind Info.plist**, so it is not the identity macOS uses. The code-signing identifier is a bare **`Electron`** |

**The control failed twice before any of this counted**, which is the reason it is trustworthy now.
A first probe run from the scratch directory got `failed` — and a scratch app with no registered
bundle and a genuinely refused permission produce **the same event**. So a signed control app was
built with its own `CFBundleIdentifier` to establish the positive case. Launched directly it
reported `authorizationStatus = 0 (notDetermined)` with `alertSetting = notSupported`, which is a
launch-path artefact and not a permission reading; relaunched through LaunchServices it registered
correctly and then **`requestAuthorization` never called back at all** — no grant, no denial, no
error, a ten-second timeout with `UserNotificationCenter` running.

**So the honest statement is that this Mac's authorization state was never established**, and the
design below does not depend on establishing it. That is the finding, not a gap: the feature is
built so that it does not need to know in advance, because nothing can know in advance.

The control app was removed after the run.

**One hypothesis was raised and refuted after the build, and it is kept because it is the obvious
one.** The Swift control recovered when relaunched through LaunchServices, so `electron .` launching
the binary in a way macOS will not register looked like the cause. It is not: the app was relaunched
with `open -a …/Electron.app`, confirmed connected, and a fresh notification was refused
**identically**. `Electron.app` is already a registered bundle; what is refused is
`com.github.Electron` itself, on this machine. `docs/testing.md` → Phase 7 Slice 11 §4.

**So the feature is built and correct and no banner has ever appeared on this Mac** — the decision
layer chose to post, for the right notification, and the platform said no. That is stated here
rather than left to be discovered, and §5's degraded state is what the user sees meanwhile.

---

## 1 · Which phone events raise a native notification

**Not everything, and the wire does not carry the field that would make this easy.**
`PhoneNotification` has no importance or priority — Android's own "is this worth interrupting for"
decision does not cross the wire. Adding it is a protocol change and is deliberately **not** in this
slice. So the filter is built from fields that already exist, and every exclusion below is a fact
about the notification rather than a guess about the app that sent it.

**No package allowlist, and that is a decision.** A curated list of "important apps" is this
project's own guessing failure — it would be wrong for everyone but its author, and it would fail
silently, in the direction of not telling you things.

### The rule — `shouldNotify`, one home, in `src/shared/`

| # | Excluded | Why |
|---|---|---|
| **1.1** | `isGroupSummary` | Android's collapse header. It carries no title and no text, so it would post an empty banner. The pane already hides these |
| **1.2** | `ongoing` | A persistent *status*, not an event: a music player, a download's progress bar, a navigation route, and **this app's own foreground service**. Android itself treats these as non-alerting. This is the largest single source of "the phone, twice" |
| **1.3** | An **update** to a key already live | Android has no "changed" event, so a download with a ticking progress bar arrives as a fresh `notif.posted` many times a minute. `onPosted` already computes `isUpdate`; this is the same fact, used twice |
| **1.4** | Anything **older than this session** | See below. This is the important one |

### 1.4 — the replay burst, and why it would have shipped broken

**The phone replays every active notification as an ordinary `notif.posted` the moment a session
becomes ready** (`NotificationFeature.replayTo`, on `addSessionReadyListener`). There is **no
end-of-replay marker on the wire**, and a replayed notification is byte-for-byte identical to a new
one.

The link reconnects on every wake from sleep, every network change, and every phone reboot — Phase 6
made all three reliable. So without this exclusion, **every reconnect dumps the entire phone shade
on screen at once**, and the better Phase 6 made the link, the more often it happens. Fourteen
banners on waking a laptop is uninstall-shaped, and it is the exact failure the user's own framing
names: the phone, twice, in a burst.

**The discriminator is `whenMs`.** A replayed notification was posted on the phone *before* this
session existed; a new one after. The rule is `whenMs >= sessionReadyAtMs - CLOCK_SKEW_GRACE`, and
the grace exists because the two clocks are not the same clock. **The skew is logged on every
session** so that a wrong grace is a number somebody can see rather than a silence.

This is one message type carrying two facts with no field to separate them — the family
`CLAUDE.md` records under *two readings, one fact*, met from a new direction.

---

## 2 · What clicking one does

**Routing to the pane and stopping is doing nothing**, which is the lesson the deep links were built
on: a row that lands you on a screen you could already reach, with no indication of which part
answered, is indistinguishable from a row that failed.

A click does three things, in order:

1. `show()` and `focus()` the window — including from a closed window, since the app survives
   `window-all-closed` by design.
2. Route to **Notifications**.
3. **Reveal the row itself** — scroll it into view and flash it once, through the same
   `revealInScreen` the palette's deep links use, with the same `prefers-reduced-motion` guard.

Step 3 is the one that makes it a link rather than a shortcut. It reuses the existing mechanism
rather than a second copy, and the existing runtime guarantee comes with it: a `reveal` id that no
longer resolves raises a toast instead of silently doing nothing.

**The notification's own key is the reveal target**, so the click is precise even when 14 rows are
on screen.

---

## 3 · Dock badge and sound

### Sound — **off by default, and configurable**

A sound for every message is uninstall-shaped, and the phone in your pocket has already made one.
The native notification ships `silent: true`. A Settings toggle turns it on for people who want it,
defaulting **off**, stored beside `watchClipboard`.

### Dock badge — **counts what you have not seen, not what your phone holds**

A badge reading `14` because the phone's shade holds 14 is permanent furniture, and permanent
furniture stops being read. The badge counts **notifications that arrived while the pane was not in
front of you and that you have not looked at since**, and it clears when the Notifications pane is
focused.

That is a **Mac-side notion of "seen in this pane"** — which is exactly what departure row **N2**
says such a thing would have to be: *"There is no read/unread state in the protocol… it would have
to be a Mac-side notion of 'seen in this pane'."* This is that row being taken up, not a new
invention, and the badge is therefore honest about being local.

Both are configurable; neither is on a timer.

---

## 4 · When the window is already in front

**Two copies of one alert is its own defect**, so the suppression rule is precise rather than
generous:

> A native notification is suppressed when the window is **focused** *and* the current route is
> **Notifications**.

Focused but on Files, Mirror or Settings is **not** suppressed — the pane is not on screen, the row
is not visible, and staying silent there is the same silence this whole feature exists to remove.
The route is already known to the renderer and is sent to the main process on change.

The badge follows the same predicate, from one expression, so the badge and the banner can never
disagree about whether you saw something.

---

## 5 · If macOS refuses — the honest degraded state

**Measured: you cannot ask in advance.** There is no permission API in Electron on macOS,
`isSupported()` answers a different question, and the control app's `requestAuthorization` hung
without a callback. Any code that claimed to know the permission state before posting would be
inventing it.

**Measured: you can observe the first attempt.** `failed` fires with `UNErrorDomain error 1`.

So the degraded state is **reactive, and says so**:

- The first `failed` sets a flag and logs the error with its domain and code intact — never a
  `runCatching`-shaped discard, which is defect 57's whole lesson.
- The Notifications pane then draws a `--warning` banner — not `--destructive`, because a permission
  that was never granted has not failed — carrying macOS's own sentence and where the switch is.
- **It names `Electron`, not ConnectSuite.** A dev run posts as `com.github.Electron`, and the
  packaged `.dmg` is ad-hoc signed with `Identifier=Electron` too (Phase 9, **D12**). So the toggle
  the user needs is under a name that is not this app's, and telling them to look for "ConnectSuite"
  in System Settings would send them somewhere that does not exist. **This is the first place a
  Phase 9 signing defect reaches a user-visible sentence**, and it is a reason to do D12 rather than
  a reason to delay this.
- Until a `failed` has been seen, **nothing is claimed**. The pane says nothing about permission,
  because the app genuinely does not know.

**What this cannot do:** distinguish *delivered* from *delivered into a Focus mode that hid it*.
macOS reports both as success. That is stated here rather than discovered, and no code pretends
otherwise.

---

## 6 · What this slice does not do

- **No protocol change.** `docs/protocol.md` is untouched. An importance field would improve §1 and
  is a separate decision.
- **No reply from the banner.** macOS supports it and the phone's `notif.reply` has worked since
  Phase 4, but a reply action needs its own hardware pass against the `seenTitle` target rule. The
  click opens the pane where reply already works.
- **No claim about a machine whose authorization state was never established.** §0 is explicit.


---

## 7 · Correction, 2026-09-03 — there was no switch, and §5 sent people to look for one

**Reported by the user against §5's own sentence.** The banner said *"Turn them on in System Settings
→ Notifications, under 'Electron'"*. **There is no Electron row in that list** — not off, absent —
so the copy sent someone hunting for a control that macOS never created. That is the
`fixHint`-pointing-at-a-nonexistent-Setting failure, and §5 above is where it was written.

**The mechanism, which §0 had half of and drew the wrong conclusion from.** macOS lists an app under
Notifications only after it registers as a notification client, and it will not register a bundle
whose identity it cannot verify. A dev run is `linker-signed` with `Info.plist=not bound` and
`Sealed Resources=none`; the refusal happens *before* registration, so there is no prompt, no record
and no row.

**The discriminator was the packaged build, and it settles the question §0 left open.** The packaged
app is **also ad-hoc** — and it posts successfully, with `Info.plist entries=33`,
`Sealed Resources version=2` and `Identifier=com.chetan.connectsuite.desktop`. So what was missing
was never an Apple account; it was **the seal**. Control: 3 refusals from dev runs in the same log
file, 0 after the packaged app started, over 2 successful posts.

**Two defects came out of it** — **81**, the copy, now chosen by `refusalCopy({ packaged })`; and
**82**, which is the larger one: the packaged app **could not launch at all**, because
`hardenedRuntime: true` enforces library validation and two ad-hoc signatures have no matching Team
ID. Fixed with one entitlement, $0. `docs/testing.md` → Phase 7 Slice 13.

**And the operational consequence, which changes how this is tested:** native notification *delivery*
is untestable from `npm start`, permanently. The decision layer is not — the `→ notify / → replay /
→ ongoing` lines are written before the post — so only the last step needs a packaged build.
