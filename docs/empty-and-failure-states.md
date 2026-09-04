# Every empty and failure state currently drawn · 2026-09-04

Extracted from the built source, comments stripped, then each string annotated with the condition
that guards it. **Only strings that reach a person** — Settings row *descriptions* and standing wall
copy are excluded and listed at the end so nothing is silently dropped.

**83 states across 19 panes.** They are grouped by what they *mean*, not by pane, because the
question is how many different sentences say the same thing.

**Three of these counts were wrong when this was first written** — groups 1, 2 and 4 claimed 24, 15
and 6 against tables of 28, 19 and 9, the total read 86 against 83, and the pane count read 17. The pane count then went wrong twice
more while being fixed — 24 from counting files rather than panes, then 23 from a checker that
assumed every table had three columns when group 7 has two. It is **19**, and the checker counts
columns now instead of assuming them. They were typed while
grouping rather than counted from the tables, which is the counting-by-hand failure this repo has a
rule about. Every number here is now produced by parsing the tables below; re-run it with
`scripts/check-state-vocabulary.mjs`.

---

## 1 · "There is nothing here" — 28 sentences for one idea

| Pane | Condition | Verbatim |
|---|---|---|
| Activity | `summary.total === 0` | Nothing yet today. The table below covers everything on record. |
| Activity (shared) | `fetch.events.length === 0` | Nothing has happened yet |
| Apps | `apps.length === 0`, searched | Nothing matches that |
| Apps | `apps.length === 0`, unsearched | The phone listed no apps |
| Calls | `log.length === 0` | There are no calls in the phone’s log. |
| Calls | `rows.length === 0` (stats) | Nothing in the log to count yet. |
| Calls | contact has no numbers | No number on this contact |
| Calls | `state !== 'active'` | No call in progress |
| Clipboard | `entries.length === 0` | Nothing yet. Copy something on either machine. |
| Clipboard | tab `phone`, `rows.length === 0` | Nothing from the phone yet. Open ConnectSuite on it after copying — that is the only moment Android lets it look. |
| Clipboard | tab `mac`, `rows.length === 0` | Nothing copied on this Mac yet. |
| Clipboard | `kind === 'empty'` | The phone’s clipboard was empty. |
| Clipboard | `kind === 'empty'` (row) | Nothing to copy |
| Clipboard | clear pressed, list empty | There is nothing in the list to clear. |
| Contacts | `contacts.length === 0` | The phone’s contact book is empty. |
| Contacts | no numbers and no emails | This contact has no number and no email address. |
| Files | no granted roots | This phone hasn’t shared a folder yet |
| Mirror | `framesDecoded === 0` | There is no picture to capture yet. |
| Mirror | `framesDecoded === 0` (input) | Nothing is being mirrored yet, so there is nothing to click on. |
| Float | `framesPainted() === 0` | There is no picture to save yet. |
| Notifications | `visible.length === 0` | Nothing on the phone’s notification shade right now. |
| Notifications | `visible.length === 0` (title) | The shade is empty |
| Notifications | no selection | Nothing to inspect yet. |
| Notifications | no selection in filter | Nothing to inspect in this filter. |
| Overview | `events.length === 0` | Nothing yet. Transfers, calls and clipboard syncs appear here as they happen. |
| Photos | `items.length === 0` | Nothing in this album |
| Remote | `!state.active` | Nothing is playing on the phone. |
| SMS | `threads.length === 0` | There are no conversations on the phone. |

**Four different openings for the same state:** *Nothing yet…* · *There are no…* · *The phone listed
no…* · *…is empty*. Two panes use a heading plus a sentence (Notifications, Apps); the rest use one
or the other.

---

## 2 · "It failed" — 19 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Apps | `!result.ok` on launch | The phone did not answer. |
| Apps | `this.failure` set | The phone is not sharing its apps |
| Calls | `!result.ok` on `callLog` | The call log could not be read. |
| Calls | `!result.ok` on `callDial` | The call was not placed. |
| Calls | `!result.ok`, generic | That did not work. |
| Contacts | `!result.ok` | The contacts could not be read. |
| Files | `listFailure` set | Couldn’t open this folder |
| Files (shared) | `kind === 'failed'` | Couldn’t read the phone’s folders |
| Activity (shared) | `kind === 'failed'` | The activity log could not be read |
| Overview | activity fetch failed | The activity log could not be read. |
| Mirror | no 2D context | This Mac could not open a 2D canvas to draw the phone screen on. |
| Photos | transfer failed | The transfer did not finish. |
| SMS | `!result.ok` on threads | The conversations could not be read. |
| SMS | `!result.ok` on messages | That conversation could not be read. |
| SMS | `!result.ok` on older page | Older messages could not be read. |
| SMS | `!result.ok` on send | The message was not sent. |
| Notifications | `!result.ok` on reply | The reply was not sent. |
| Transfers (shared) | checksum mismatch | ConnectSuite transfer failed — checksum mismatch |
| Link (shared) | unknown socket error | The connection to your phone failed. See the log for details. |

**Three different verbs for one thing:** *could not be read* (6 uses) · *did not / was not* (6 uses)
· *Couldn’t* (2 uses, and the only contractions in the set). **Overview and shared/activity draw the
same sentence with and without a full stop** — one of them is wrong and nothing says which.

---

## 3 · "The phone is not offering this" — 8 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Apps | `!advertised` (title) | Your phone cannot show the request |
| Apps | `!advertised` (body) | The phone is not offering the apps feature right now. |
| Clipboard (shared) | `!facts.advertised` (title) | Your phone is not offering its clipboard |
| Clipboard (shared) | `!facts.advertised` (body) | The phone is connected but is not advertising the clipboard feature right now. |
| Files | `!advertised` | This phone is not offering the Files feature right now. |
| Files (shared) | `kind === 'unavailable'` | This phone isn’t offering Files right now |
| Photos | `failure` set | The phone is not sharing its photos |
| Files | `degraded` banner | Copying to the Mac works. Sending files to this phone does not — it is not offering that channel. |

**`files` says it two ways in one pane** — `This phone is not offering the Files feature right now.`
and `This phone isn’t offering Files right now` — differing in contraction, article and full stop.
**`offering` (5) vs `sharing` (2) vs `advertising` (1)** for one condition.

---

## 4 · "Not connected" — 9 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Clipboard (shared) | `!facts.connected` (title) | Not connected to your phone |
| Clipboard (shared) | `!facts.connected` (body) | Nothing can arrive from the phone until the link is back. This is not the Android clipboard limit — it is the connection. |
| Overview | `!connected` | Not connected. Nothing is being sent anywhere. |
| Float | `!connected` | The link to the phone dropped, so there is nothing to show. |
| Shell | route blocked, unpaired | Pair a phone first — there is nothing to show until you do. |
| Shell | `health === 'repudiated'` | No phone paired |
| Renderer | `handshaking` / `reconnecting` | Not paired yet |
| Link (shared) | connection refused | Could not reach your phone. Check that both are on the same Wi-Fi and that ConnectSuite is open on it. |
| Link (shared) | `repudiated` | Your phone no longer recognises this Mac. Open ConnectSuite on the phone and scan a new code. |

**`No phone paired` and `Not paired yet` are two states or one, and the copy does not say which.**

---

## 5 · "Waiting / not yet" — 5 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Device status (shared) | `state === null` | Waiting for the phone to report |
| Device status (shared) | `capacityUnknown` | This phone does not report its level |
| Device status (shared) | storage null | This phone did not report its storage |
| Float | awaiting keyframe | Waiting for the phone’s next keyframe… |
| Mirror | `awaitingFreshFrame` | The phone just turned — waiting for the new picture before sending that. |

---

## 6 · "This build / this Mac cannot" — 7 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Notifications (shared) | dev build refusal | Notifications cannot work in this development build |
| Notifications | filter has no match | Not in this build |
| Notifications | mute list | Muted apps are not mirrored |
| Notifications | mute list (body) | The phone does not tell the Mac which apps are muted, so this list cannot be built here. |
| Overview | `screen.state !== 'built'` | Not built yet |
| Nav model | camera | There is no virtual camera on this Mac |
| Calls | live card | Mute, speaker and keypad tones are on the phone. Nothing on the wire carries them. |

---

## 7 · Input refusals — Mirror only, 5 sentences, and nothing else in the app does this

| Condition | Verbatim |
|---|---|
| `!inputAdvertised` | This phone is not accepting taps or typing yet. |
| no screen shape yet | The phone has not said what shape its screen is yet, so that was not sent. |
| rotated mid-press | The phone turned while you were pressing, so that was not sent. |
| mirror stopped mid-press | The mirror stopped while you were pressing, so that was not sent. |
| rotation pending | The phone just turned — waiting for the new picture before sending that. |

**Mirror is the only pane that explains a refusal in terms of what the user was doing.** Every other
pane states a fact about the system. It is also the only one that says *"so that was not sent"* —
naming the consequence — which nothing else does.

---

## 8 · Empty-input guards — 2 sentences, same shape, different words

| Pane | Condition | Verbatim |
|---|---|---|
| Notifications | `text.length === 0` | An empty reply was not sent. |
| SMS | `body.length === 0` | An empty message was not sent. |

The only pair in the whole set that is already consistent.

---

## Where these sentences sit — the below-the-fold sweep

Asked of every pane at **1440 × 865, unzoomed**, with `scripts/card-visibility-sweep.mjs`. It is
worth having in the same document as the copy, because a sentence below the fold and a sentence that
does not exist are the same sentence to a reader.

**23 blocks: 21 visible at rest, 2 reachable by scrolling, 0 stranded.**

| | |
|---|---|
| **Overview → Device status** | `top=865` in an 865 px window — entirely below the fold at rest, reachable by scrolling `#page` |
| **Mirror → Advanced** | `top=480`, 99% visible; clipped by a few pixels |

Nothing is unreachable, which is the floor rather than the finding. **The finding is that
reachability is not the bar for a card that carries a state** — defect 85 was reachable and still
failed, because a person asking *why is nothing here* does not scroll to discover whether an answer
exists. Neither of the two above carries a state sentence: Device status draws its own three states
*inside* the visible card once scrolled to, and Advanced is a settings group. So no state sentence in
this document is currently below the fold.

**A second finding fell out of the sweep and is the designer's, not a defect.** The panes use
**seven different container conventions** for what is visually one thing — `.card`, `.side-card`,
`.pane-*`, `.clip-panel`, `.files-panel`, `.calls-log-panel`, `.files-rail-title`. The first version
of the sweep counted `.card` and reported *"no cards"* for nine of thirteen panes, which is a fact
about a selector rather than about those panes. It matters here because a vocabulary decision that
says *"the empty state goes in the card header"* has seven places to land.

---

## What was excluded, and why

- **Settings row descriptions** (`renderer.ts` 1167–1570) — explanatory copy for a control, not a
  state a condition produces. They contain the same vocabulary (*there is no…*, *nothing…*) and
  would triple this list without being states.
- **Standing wall copy** — the clipboard's Android paragraph, the Files `Download` wall, the Calls
  audio wall. Always present; not produced by a condition.
- **The phone's own sentences**, which arrive over the wire as `reason` / `fixHint` and are drawn
  verbatim. **They are a second vocabulary this list does not cover** and the phone has its own
  conventions.

## The count that answers the question

**Eight ideas. 83 sentences.** The largest group is "there is nothing here" at 28 uses with **four**
distinct grammatical openings; failures use **three** different verbs; unavailability uses **three**
different words for the same predicate. Two panes state one condition two ways within themselves
(Files, Apps), and one sentence appears twice with different punctuation (the activity log).
