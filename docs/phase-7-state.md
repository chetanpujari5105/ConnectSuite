# Phase 7 — what is actually left

> ## ⚠ Corrected 2026-09-15. **Five claims in this file were false in the flattering direction**, and
> the roadmap points here.
>
> The file was written 2026-09-03 and last edited 2026-09-04. **Sixty-four commits landed on top of
> it** and none of them came back. Almost every row below drifted; the rows that drifted *towards*
> the build looking finished are the ones that cost something, because a reader checks a claim that
> work remains and files a claim that it does not.
>
> | # | Where | It said | Measured 2026-09-15 |
> |---|---|---|---|
> | 1 | §2 **S6** | *Built 2026-09-04* — struck through as discharged | The rota was **deleted** 2026-09-08, defects 96 and 97. `shared/islandRota.ts` does not exist. The departure was **withdrawn, not satisfied** — S6 asked for a cycling island and the island is now a pure function of live status |
> | 2 | §2 **M5** | *Built 2026-09-04 — a third rail slot that routes to Files* | **Unbuilt.** `index.html`'s own rail comment reads *"Record and Transfer are unbuilt"*; the rail holds **two commands and one readout** where the handoff draws five |
> | 3 | §2 **S4 / S5** | *`battery.state` and `net.state` are both on the debt list with **no handler on either side**… Still correct — do not "fix" this* | **`battery.state` has shipped on both sides.** It is specified in `docs/protocol.md`, pushed by `VitalsFeature.kt:150`, handled at `main/main.ts:979`, and drawn by `shared/deviceVitals.ts`. `check-protocol-spec.mjs` lists **`net.state` alone**. The row told the next reader to leave a live bug alone |
> | 4 | §2 **N4 · P5 · F7 · A2** | *Still four. A fifth will invent a fifth* | **Five.** Calls' **C6** is the fifth, and `docs/design-departures.md:386` says so in those words |
> | 5 | §3 **#1** | Media remote *"Card is at `top: 535`, above the fold"* | `top: 915`, **`reachable`**, fraction **0.76**, viewport 1047 — `scripts/probe.mjs` `onScreen`, control 5. Quick actions, Recent activity and the footer strip landed on 2026-09-04 and pushed it to the fold. At the design's 920px height it is **below** it. This is defect 85's shape in the pane defect 85 was fixed in |
>
> **The direction is the finding, not the count.** Four of the five are in §2, and §2 is the section
> headed *"**This is the section to act on**"* — a list of work whose stated blocker has been
> removed. Three of its nine rows were struck through as done by the sitting that did the work,
> which is the one moment nobody re-reads the row. `CLAUDE.md` already carries the rule this breaks:
> a reading that confirms the hypothesis is the one that never gets a second query, and *"I just
> built this"* is the strongest confirming hypothesis there is.
>
> **Everything else below drifted too, in the other direction**, and is corrected in place. §1's
> table is the 2026-09-03 audit and the design pass landed on 2026-09-04: Calls, Clipboard, Settings
> and Overview are all built to the handoff now, measured. §2's **P4** and §4's items 1, 2, 4 and 5
> were all done after this file was written. Those rows were wrong and read as *more work remains*,
> so nobody acted on them and nobody was misled — which is exactly why they are not in the table
> above and exactly why they still had to be fixed.

---

## 1 · Panes, against the design

**Twelve nav rows. Exactly one is unbuilt.** That much still holds. **Everything else in this table
was overtaken by the design pass of 2026-09-04** and is re-measured below — grids read through
`scripts/probe.mjs`, control 13 sections, at a 1920 × 1047 window.

> **Added 2026-09-16 — what "Built to the handoff" is now measured against.**
>
> The four panes this section was written to name — **Calls, Clipboard, Settings and Overview**, the
> ones that *worked and did not look like the design* — are scored against
> `design_handoff_connectsuite/ConnectSuite.dc.html` **and its `README.md`, and against nothing
> else.** That was always the intent and it had stopped being true of one of them.
>
> **Overview is the exception and it has been re-scored.** Slices **59–61** (2026-09-16) rebuilt its
> Device hero, Recent activity and media card against a **second reference** that is not the
> handoff. That reference is now recorded as **superseded** at the top of
> `docs/design-departures.md`, with the six differences it produced measured; the Overview rows
> there are **O6–O14**. So a reader meeting "Built to the handoff" against Overview in the table
> below should read it as *built to the handoff as of the 2026-09-16 re-score*, not as of the
> 2026-09-04 design pass.
>
> The other three are untouched by this and their rows stand: **C1–C7** (Calls), **K1–K6**
> (Clipboard), **G1–G7 / S13 / T1–T3** (Settings). Nothing has re-measured them since 2026-09-15,
> and *not re-measured* is not the same as *still correct* — the banner above this section is what
> that costs.

| Pane | State 2026-09-03 | State 2026-09-15, measured |
|---|---|---|
| **Camera** | **unbuilt** — the only one | **Unchanged.** `aria="Camera — not built yet"`. Needs a macOS **Camera Extension**: a signed system extension, so it is a **distribution problem before it is a code problem**, and Phase 8 is shut. Correctly in no phase |
| **Calls** | ~~half-built, the largest visual gap — *0 dialpad keys, 0 mute/speaker, 0 waveform*~~ | **Built to the handoff.** `300px 999px 300px` against `300px 1fr 300px`; the 3×4 keypad ships with a **thirteenth** key (⌫, row C5). The three absences are **walls, not gaps**, and are recorded as such: C1 the waveform (no call audio reaches this Mac in either direction), C2 mute/speaker (needs an `InCallService` role), C3 DTMF (no verb on the wire). Rows C1–C7 |
| **Clipboard** | ~~half-built, furthest from the drawing — *0 tabs, 0 badges, 0 timeline*~~ | **Built to the handoff.** Two columns, kind badges over the kinds this wire actually carries, and the sync timeline over the facts this Mac actually holds. The tabs are **not** History / Favourites / Pinned and the markup says why. Rows K1–K6 |
| **Settings** | ~~**3 of 8** panes; `200px 916px`~~ | **Six panes** — General, Connection, Notifications, File transfer, Advanced, About — at **`200px 1fr 320px`**, the handoff's grid exactly. Rows G1–G7, S13 |
| **Messages** | ~~`804px 320px`; list **or** thread with a back link~~ | **Three columns: `280px 1fr 300px`.** The contacts *directory* left the third column on 2026-09-05 and is the recipient picker inside **New conversation** now |
| **Overview** | ~~half-built — *Quick actions and Recent activity are both absent*~~ | **Both built**, 2026-09-04. Measured at rest: `#quick-card` **visible** @142, `#recent-card` **visible** @525, `#device-status-card` @525, `#caps` @824, `#remote-card` **reachable** @915, `#overview-strip` @1052. Rows O1–O5 |
| **Pairing** | **placeholder** | **Phone half F1–F5 built**, F2/F4/F5 proven on hardware 2026-09-03; `pair.rejected` handled on the Mac (see §2). Still **no sidebar row and no drawn design** — the hole is the drawing, not the build |
| Mirror · Files · Photos · Notifications · Activity · Apps | **built**, departures recorded per pane | Unchanged. `docs/design-departures.md` remains the record |

**The one-line answer, restated for 2026-09-15:** *Camera* is the only unbuilt pane and it is
correctly parked. **The four panes this section was written to name are done.** What is left on the
panes is not layout — it is the *unavailable / partial / failed / empty* vocabulary (§2, now five
panes deep) and a drawn pairing screen.

---

## 2 · Departures the wire has overtaken

`docs/design-departures.md` rows are dated. These were true when written and are not now. **This is
the section to act on**, because each is a row whose stated blocker has been removed — and it is
also the section that produced **four of the five corrections in the banner**, because a row struck
through by the sitting that did the work is a row nobody re-reads.

| Row | Said | Now, 2026-09-15 | Cost |
|---|---|---|---|
| **S6** | Status island cycling *"Clipboard synced"* / *"Transfer complete · 4.2 MB"* | **WITHDRAWN, not built.** ~~Built 2026-09-04~~ was true for four days. The rota had never once been visible; it was made visible, and **that** is when it turned out to be the wrong surface — text from a six-slot ring, tone from the live link, in one statement. Deleted 2026-09-08, defects **96** and **97**; `shared/islandRota.ts` does not exist. The island is a pure function of the same status the strip reads, and a failure reaches it as `LinkFailure.kind`. **The design asked for a history surface and this app has an Activity pane**; the chrome gets the present tense | **Nil — and the row should be marked withdrawn in `design-departures.md`, not discharged** |
| ~~**S10**~~ | Overview's *Recent activity* | **Built 2026-09-04** — `docs/design-departures.md` → O2. Measured **visible @525** at rest. The five-oldest-events defect was found and fixed in the same pass: it reads `activityPage`, not `.slice(0, 5)` | ~~Small~~ — done |
| **M5** | Mirror tool rail **Transfer** | **UNBUILT.** ~~Built 2026-09-04 — a third rail slot that routes to Files~~ is false. `index.html`'s rail comment reads, in its own words, *"Record and Transfer are unbuilt"*; the rail holds **two commands and one readout** where the handoff draws five. Power and Rotate are gone for stated platform reasons and cannot come back; **Transfer and Record are the two that could** | **Medium — still owed** |
| ~~**Settings → File transfer**~~ | *"real; blocked on Phase 5, ships with the feature"* | **Built 2026-09-04.** Six panes — General, Connection, Notifications, File transfer, Advanced, About — and the third column | ~~Small~~ — done |
| ~~**Pairing P4**~~ | *"A reason when pairing is refused — **not possible**. The Mac sees a closed socket and nothing else"* | **Built.** ~~No Mac-side handler exists~~ is false: `main/link.ts:409` parses it and emits, `main/main.ts:789` receives it, filters a rejection meant for another fingerprint, and sends copy from `shared/pairRejection.ts` to the renderer | ~~Small~~ — done |
| ~~**Pairing P3 / F6**~~ | *"Distinguishing 'nobody has scanned' from 'scanned, and failing' — **not possible**"* | **Mac half built 2026-09-04, sighting still unproven on hardware** — it needs an unpaired phone and a scan, which needs somebody's hands. The comparison is unit-tested and the watch is measured arming | Small–medium — **done, minus the hardware run** |
| **X5** | Media remote and contacts have *"no pane in the design"* | Still true of the **design**; both are reachable by **deep link** since Slice 2 — though `contact` now resolves to **Calls**, not Messages (§3) | Nothing to do until the designer draws one |
| **S4 / S5** | Battery percentage removed; *Signal* cut | **HALF FALSE, and this is the live bug.** ~~Both on the debt list with no handler on either side~~ — `battery.state` **ships on both sides**: specified in `docs/protocol.md`, pushed by `VitalsFeature.kt:150`, handled at `main/main.ts:979`, drawn by `shared/deviceVitals.ts` with a three-state vocabulary. `check-protocol-spec.mjs` lists **`net.state` alone**. What is still true is **S5**: *Signal* is cut and stays cut. **The three battery slots in the shell are `hidden` on a comment that says nothing subscribes — and something does** | **Small — and it was carrying a `do not "fix" this`** |
| **N4 · P5 · F7 · A2 · C6** | Four panes each invented their own *unavailable / partial / failed / empty* state | **Five, not four.** ~~Still four. A fifth will invent a fifth~~ — the fifth arrived and it is Calls' **C6**, which `docs/design-departures.md:386` records in exactly those words: *"four could be bad luck, five is a missing vocabulary"* | The designer's, not ours. Still the single most useful hour available |

**What to do first has changed.** `pair.rejected` was this section's headline and it is done. The
three rows that are still work are **S4** (three hidden battery slots over a live feed), **M5** (the
rail's Transfer slot) and **S6's bookkeeping** — `design-departures.md` should read *withdrawn*
where it reads *built*, because a row recorded as satisfied by a feature that was subsequently
deleted is how a deleted feature gets rebuilt.

---

## 3 · The homeless features — the count is six, and it was never seven

`docs/design-departures.md` **X5** names them: *media remote, contacts, QR pairing / first run, the
capability list, manual address, log tail.* **Six.** `docs/phase-7-homeless-features.md` opens by
quoting the premise as *"six shipped features have no home"* and then shows the real number was
**three**. Nothing in this repo has ever listed seven, and the difference is worth keeping rather
than quietly rounding — the same discipline as counting packages against activities.

**Where the six stand now, measured:**

| # | Feature | State | Reading |
|---|---|---|---|
| 1 | **Media remote** | **homed by search, and it has since sunk** | palette `music` → `Now playing` ✓ (live, control 6). ~~Card is at `top: 535`, above the fold~~ — measured 2026-09-15 at **`top: 915`, verdict `reachable`, fraction 0.76**, viewport 1047. Quick actions, Recent activity and the footer strip landed above it on 2026-09-04. **At the design's 920px height it is below the fold entirely.** No drawn treatment, and now no resting visibility either |
| 2 | **Contacts** | **homed by search, not by design** | palette `contact` → `Contacts` ✓ (live, control 6). ~~In Messages~~ — **In Calls since 2026-09-05**: the directory left Messages' third column for the recipient picker inside *New conversation*, and a palette row cannot usefully reveal something that is usually hidden. Calls' Contacts tab is permanent |
| 3 | **QR pairing / first run** | **still homeless, and still unfindable** | palette `pair` → **[]**, control 6. A route with no row, drawing a placeholder |
| 4 | **Capability list** | **homed** | "What this phone can do", measured on Overview |
| 5 | **Manual address** | **homed** | Settings → Connection |
| 6 | **Log tail** | **homed** | Settings → Advanced |

**So: three properly homed, two homed by a deep link the designer has not seen, one still homeless.**

### Two the wire grew after X5 was written, and neither has a home

Both are shipped, working, and unreachable by the app's own search — the exact gap Slice 2 measured
and fixed for the media remote:

| | Feature | Reading |
|---|---|---|
| **7** | **The clipboard's undo** — auto-apply keeps what it overwrote as a `displaced` entry that **Restore** puts back (Slice 12) | **Still true, re-measured 2026-09-15**: palette `restore` → **[]**, `displaced` → **[]**, `history` → **[]**, control `mirror` → 6 |
| **8** | **Trust controls** — Forget, trusted devices, and the repudiated state defects 73–76 built | **Still true, re-measured 2026-09-15**: palette `forget` → **[]**, `trust` → **[]**, `unpair` → **[]**, control `mirror` → 6. `pair` → **[]** too |

**If a seventh homeless feature is wanted, it is the clipboard's Restore** — and it arrived after
the list was written, which is the more useful observation: **X5 is a snapshot, and every feature
shipped since has been added to a pane without anyone re-asking whether search can find it.** The
deep-link mechanism exists and costs two lines each.

---

## 4 · What Phase 7 is, stated as work

Ordered by **what it changes for a person using the app**, not by size.

> **Superseded 2026-09-15 — five of these six are done.** The list is kept rather than rewritten,
> because what it got wrong is the useful part: it was written the day before the design pass and
> the native-notification work, and every item it *underestimated* got built while the three items
> in §2 that it never listed are the ones still open.

| # | 2026-09-03 | 2026-09-15 |
|---|---|---|
| 1 | **`pair.rejected` on the Mac.** One handler | **Done.** `link.ts:409` → `main.ts:789` → `shared/pairRejection.ts` |
| 2 | **A native macOS notification for a mirrored phone notification.** *"`Notification` is never imported anywhere in `desktop/src`"* | **Done.** `main/nativeNotifier.ts` imports it, posts, badges, and holds each banner's instance alive so a late click is not lost. The decision lives in `shared/nativeNotify.ts` where a test can reach it. See §5.2, which is the argument that produced it |
| 3 | **Deep links for Restore and trust**, and Settings → General / Notifications / File transfer | **Half done.** The three Settings panes shipped 2026-09-04. **The two deep links did not** — re-measured above, all six words return `[]` |
| 4 | **Calls' three columns and the keypad** | **Done** 2026-09-04. `300px 999px 300px`, 3×4 plus ⌫ |
| 5 | **Clipboard's tabs, kind badges and timeline** | **Done** 2026-09-04 |
| 6 | **The designer's hour**: the *unavailable / partial / failed / empty* vocabulary, a drawn pairing screen, a decision on Quick actions (X9) | **Still open, and one pane worse.** Five panes have now each invented their own. Quick actions was built without the decision |

**What §4 would say if it were rewritten today**, ordered the same way:

1. **The three hidden battery slots** (S4). The data arrives; the device card, the strip and the
   hero hide it on a comment that is no longer true, and Settings → Advanced says it is unhandled.
2. **Deep links for Restore and trust.** Two shipped features the app's own search cannot find.
3. **P5 pairing expiry.** `link.ts` already holds `expiresAt`; a stale QR is the first thing a
   stranger meets and it currently expires silently.
4. **M9 keep the screen awake while mirroring**, and **M5** the rail's Transfer slot.
5. **The designer's hour**, unchanged and now five panes deep.

Deliberately **not** in Phase 7: Camera (needs Phase 8's signing), and anything requiring a second
device.

---

## 5 · The honest product question — a fresh install, a paired phone, one week

Two questions, deliberately kept apart, because they have different answers and different fixes.
**What annoys you** is friction you route around and keep using. **What makes you stop** is the
thing that removes the reason to open it at all. Everything below is grounded in a reading, and each
reading names where it came from.

### 5.1 The first thing that annoys you — hour one, not week one

**You copy something on your phone, switch to the Mac, press ⌘V, and get the thing you copied an
hour ago.**

`ClipFeature.onWindowFocused` carries the comment that makes this exact: *"This is the whole
phone-to-Mac path. There is no observer to hook and no background read to take; a person copies
something in another app, comes back to ConnectSuite, and this runs."* The wall behind it is
measured, not inherited — `docs/testing.md` → Slice 11: **90 of 90** reads refused with the
accessibility service bound, **60 of 60** with it disabled, over clips proven readable with focus
half a second earlier.

So the phone half of *"copy on either machine, paste on the other"* requires **opening ConnectSuite
on the phone first**. The Mac half is genuinely automatic — a watcher polls `NSPasteboard`, applies
on arrival, and keeps what it displaced behind Restore. The asymmetry is real, it is the platform's,
and no Android app can do better.

**Why it is an annoyance rather than a dealbreaker:** you learn the gesture in about three days and
it becomes a reflex. **Why it still costs the most of any single thing:** it fires several times a
day, every day, and it fires on the feature the subtitle promises in the sidebar. There is no fix,
only mitigation — the pane's standing copy already says it, and what would help is making the phone
gesture cheap (a share-sheet target, a quick-settings tile) rather than pretending the wall is not
there.

**Second, close behind, and also a wall:** mirroring asks for consent on the phone **every single
time**. `MirrorConsentActivity` says so — *"MediaProjection consent cannot be cached — Android 14
re-asks every time, by design."* Start mirroring, pick up the phone, tap. Every session.

Neither of these is a defect and neither is fixable. They are the tax this product pays for having
no cloud and no account, and they should be stated in onboarding rather than discovered.

### 5.2 The first thing that makes you stop using it — and it is not a wall

> **DISCHARGED 2026-09-04. This section is kept because it is the argument, not the status.**
> `main/nativeNotifier.ts` exists: it imports `Notification`, posts a banner, badges the dock, holds
> each banner's instance alive so a click minutes later is not dropped, and claims nothing about
> permission until a post has actually failed — `Notification.isSupported()` returns `true` on a
> machine that refuses everything, which is a static capability answer read as an authorization one.
> The decision lives in `shared/nativeNotify.ts` where a test can reach it. Scope:
> `docs/phase-7-native-notifications.md`.
>
> **Every present-tense sentence below is now false**, and the readings under it were true on
> 2026-09-03. It stays in the file because §5 is the only part of this document a design audit could
> not have produced, and deleting the argument once the work lands is how the next missing feature
> becomes invisible again.

**The Mac app is completely silent. Close the window and the product ceases to exist.**

Measured 2026-09-03, with a control that is non-trivially true:

```
electron named imports across 91 files in desktop/src  →  13 symbols
  BrowserWindow, Menu, Tray, app, clipboard, contextBridge, dialog,
  ipcMain, ipcRenderer, nativeImage, powerMonitor, safeStorage, screen

'Notification' among them            →  false
new Notification / requestPermission →  0 matches in src/ (the two hits are
                                        NotificationsView and NotificationClient)
app.dock                             →  never used
setBadge / badgeCount / flashFrame   →  0
tray.setTitle                        →  '● CS' / '○ CS' — connection state only
```

A phone notification arrives, crosses TLS, is parsed, is stored, is rendered into a pane, and is
counted on a sidebar row that reads `Notifications14` — and **nothing on the Mac tells you.** No
banner, no dock badge, no bounce, no sound. The tray glyph says whether the link is up and nothing
about what came over it.

**This is the death spiral, and it is a spiral rather than a complaint:**

1. Notification mirroring is the feature that justifies a phone-link app. It is the reason to have
   one running.
2. It only reaches you while the ConnectSuite window is in front of you.
3. A window that has to be in front to be useful competes with your actual work, so it goes behind.
4. Behind, the app delivers nothing — so you glance at your phone instead, exactly as before.
5. In week two you notice the app has been running for days and has never once been the reason you
   learned something. You quit it, and you do not reopen it, because nothing prompts you to.

Every step is caused by step 2 and step 2 is roughly forty lines of Electron.

**The comparison that makes the size of this clear.** The product's own reference target does the
opposite: a notification arrives, macOS shows it, you reply from the banner, and you never open the
app. Here the phone half is finished — the listener, the reply path, `AppLabels`, the ongoing flag,
`notif.reply` proven on hardware in Phase 4 — and it terminates in a pane. **The expensive half is
built and the cheap half is missing**, which is why this is the highest-value item in Phase 7 and
why it is item 2 in §4.

### 5.3 The distinction, stated plainly

| | The annoyance | The killer |
|---|---|---|
| **What** | Clipboard phone → Mac needs the app open on the phone | The Mac never notifies you of anything |
| **When** | Hour one, then several times a day forever | Week two, silently, as a decision you never consciously make |
| **Cause** | An Android platform wall, measured 90/90 and 60/60 | A missing Mac-side feature |
| **Fixable** | **No.** Only mitigated — cheaper phone-side gestures, honest copy | **Yes, and it was** — `new Notification(...)` plus a reply action, shipped 2026-09-04 |
| **Cost if ignored** | Daily friction; the product still earns its place | The product stops being opened |

**The uncomfortable part, and the reason this belongs in the repo rather than in a chat:** the
annoyance has been documented, argued and measured at length — Slice 11 exists, the wall has a
decision table, the copy was rewritten twice. The killer has never been written down anywhere. It
is not in `docs/design-departures.md`, because the handoff draws an app you are looking at and every
departure row is measured against the drawing. **A design audit cannot find a missing feature that
the design never drew, and this whole document is a design audit** — which is why §5 is here and
why it is the section to act on.

---

## 6 · What §5's ranking did not know — added 2026-09-15

§5 asks *what annoys you first* and *what makes you stop*, and answers **the clipboard's phone→Mac
wall** and **the Mac never notifying anyone**. Both answers stand. But the ranking was produced by
reading the code and the design, and on 2026-09-15 seven bugs were reported **from a week of real
use**. Five of them are in the mirror and input surfaces, which §5 does not mention at all.

**The gap is structural and worth stating, because §5 was written to close exactly this kind of
gap.** §5 is an argument about *features that are absent or walled*. It has no way to see a feature
that is present, advertised, tested and **quietly wrong in use** — and four of the seven were that:

| | What a user hit, daily | What every check said |
|---|---|---|
| **112** | scrolling with a trackpad stuttered and dropped mid-flick | 138 scrolls delivered, the phone answering every one |
| **111** | a mouse wheel opened videos instead of scrolling | `input.scroll delivered` for all of them |
| **114** | the float stayed portrait when the phone turned | `mirror.rotate` handled, geometry stamped correctly |
| **116** | *"The phone has not said what shape its screen is yet"* on a live mirror | the main window knew the shape throughout |

Every one of those produced a **success** line in a log this project is proud of. The denominator
rule works — it catches a failure hiding behind no success count — and it is silent about a success
that is wrong. `input.scroll delivered (596,977 by 0,-17 …)` is a true sentence about a message that
became a tap.

**So the third question §5 should have asked is: _what does this app do that reports success and is
wrong?_** The instrument for that is not a log and not a test; it is somebody using it for a week,
which is what produced this list. Two of the seven — the float's rotation and its
has-not-said-the-shape message — had **never been exercised by anything in this repo**, because the
float window's own probe runs had all followed a rotation.

**One consequence for §5.1's ranking.** Its "first thing that annoys you" was the clipboard gesture,
several times a day. Scroll-as-tap fired **35 times in 138 scrolls**, which is more often than that,
on a surface the clipboard's copy does not cover — and it was not a wall, it was a fixable defect
that had been shipping since scroll existed. The ranking is not wrong; it was taken over the wrong
population. §5's own sentence — *"everything below is grounded in a reading"* — held, and the
readings were all of the code.
