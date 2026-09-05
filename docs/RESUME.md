# Resume here — written 2026-09-05, end of the design-pass sitting (Messages added later the same day)

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · One-line state

**The design pass ran on five panes and found five defects, four of which nothing in this repo could
have seen.** Photos' grid was drawing every tile on top of the two below it; the app's accent has
been the wrong violet for the whole build; every control the design draws shorter than 32px was
drawing at 32px; the app window could be scrolled out of place permanently; and eleven CSS
references pointed at four custom properties that do not exist. All fixed, all guarded, all shot
against the design at the real display size.

## 1 · What is built, and what proved it

| Built | Proof |
|---|---|
| **Photos**, rebuilt — square 4-up grid, date groups, the design's rail row, a two-card detail column | 131px square tiles, **0px** overlap where there had been 79; `photos-compare.png` |
| **Calls** — per-contact avatar fills, the design's foot-of-card strip, 52px keys, gradient Call | rows 56px/12px, keys 52px, six discs six fills; `calls-compare.png` |
| **Settings** — 16px gap, 38px rail rows, 19px titles, a border that no longer shifts the rows below it | columns **200 / 583 / 320**; `settings-compare.png` |
| **Overview** — Device status moved to the design's column, two truncation defects closed | `.quick-sub` truncated **5/8 → 0/8**, `.recent-detail` **4/4 → 0/5**; `overview-compare.png` |
| **Clipboard**, re-diffed — already matching, and two of its numbers were being overridden | `1fr 340px`, 36px badges, 28px pills; `clipboard-compare.png` |
| **Messages**, rebuilt to three columns — thread list with avatars and previews, chat with bubbles and date separators, a composer, and the person card | `280 / 539 / 300`, 60px rows, 34px/72px discs; previews **50 with text / 0 at zero height**; `messages-compare.png` |
| **Card stagger** — the design's `float-in`, which had never been built | five panes opt in; keyed to `.page.route-in` so it replays per navigation |
| **The identity column** — accent, `--live`, `--destructive`, `--radius-panel`, `--radius-media` | counted out of the design file's own literals: `#7c6bff` ×34, `rgb(139,…)` **zero** |

**Tests:** Mac **565** (`cd desktop && npm test`), from 514. Phone untouched.

**Three new instruments, all in the repo**: `scripts/shot.mjs` (named in an evidence README since
the last design pass and did not exist), `scripts/design-shot.mjs`, `scripts/compare-shot.mjs`.
Each refuses rather than writing a file it cannot vouch for.

## 2 · Committed

```
95495c4  The card sweep poisoned itself, and one throw was enough
e546b8b  Messages: the design's three columns, and defect 93 — fifty invisible previews
34185c9  RESUME.md: the design-pass sitting, as a handoff
9dda4b5  The sweep was scrolling the app as it measured, and its published number is corrected
2a9f846  Defect 92: eleven references to four custom properties that do not exist
7f62b2a  Defect 91: the frame was a scroll port, and the Clipboard re-diff
5daddff  Overview: two truncation defects, and the rings moved to the design's column
e3d36f0  Settings against the design, and defect 90: the floor that raised every short control
2ac38b2  Calls: the surface against the design, and the stagger the app never had
         compare-shot.mjs: the build and the design at one width, in one image
39e4b40  Photos: defect 88, the grid that drew every tile over the two below it
```

Working tree clean. All eight commit hooks green.

**One thing to know about the history.** Commit `25208fa` — *"RESUME.md: the audit's link was
dead"* — carries the first ninety minutes of this sitting's work in it as well. A **concurrent
`claude` session** in this repo committed with `-a` at 01:23 and swept up everything uncommitted at
that moment: `tokens.css`, `photos.ts`, `probe.mjs`, `shot.mjs` and the first Photos evidence.
Nothing is lost and nothing is wrong in the tree; the message simply does not describe half of what
the commit contains. If you are reading `git log` to find when the accent was corrected, it is
there and not in `39e4b40`.

## 3 · Half-built and readable

- **Nothing is mid-edit.** No file is in a state that will not compile, and `npm test` is green.
- **`.icon-button`** is in defect 90's table with `drawn: 0` rather than a number: it draws at zero
  height on every pane it appears on. That is a **separate question** from the 32px floor, it is not
  investigated, and it is recorded as unmeasured rather than folded in as a pass.
- **The device-status rings do not sweep in.** They carry `transition: stroke-dashoffset 240ms`, and
  a transition fires on a *change* while the arc is created at its final offset. The design toggles a
  flag 140ms after mount to make them animate. Left undone deliberately — it is one line that changes
  what the pane does on **every** redraw, and this pane redraws on every `battery.state`.

## 4 · What needs your hands, and why

**1. The vocabulary decision — still the blocking item, and it grew by two.**
`docs/empty-and-failure-states.md` has 83 sentences. Two new unratified ones were added, both
replacing controls the wire cannot serve:

> Photos: *"Sharing, wallpaper and deleting are on the phone. Nothing on the wire carries them."*
>
> Messages: *"Calling is on the Calls screen. Video, blocking and shared media are on the phone —
> nothing on the wire carries them."*

Both are deliberately the **same shape** as Calls' existing *"Mute, speaker and keypad tones are on
the phone. Nothing on the wire carries them."* rather than two new grammars. That makes **three uses
of one sentence pattern**, which is either a house style or a rut — your call, not mine. Nothing
else in the 83 fitted.

**Two diagnostic strings were deleted outright** and need no replacement, but you should know they
are gone: Messages' *"50 conversations, 2 showing a contact name, 586 unread…"* and Contacts'
*"Sorted by name, which is the only order a book can be read in."* Both were facts about our
implementation on a screen a user reads.

**2. Defect 89 — your phone's deleted photographs are listed as an ordinary album.**
`Android/.Trash/com.sec.android.gallery3d/…/WhatsApp Images` is one of four buckets whose leaf
directory name is *WhatsApp Images*, and `media.buckets` carries no path, so the Mac cannot tell it
from the live one. It needs `relativePath` (or a phone-side `trashed` flag) on the wire — a contract
change, out of scope for a design pass. Two surface-only workarounds were built, drawn, and removed;
the register says why, so nobody builds a third.

**3. Everything the last handoff listed is still open and unchanged** — the WhatsApp compose box,
Instagram/X/Samsung Notes returning `NO READING`, defect 84's cooldown branch, and F6/P3's pairing
sighting. None of them was touched tonight.

## 5 · Where the panes stand

Five compared side by side at your real display size, in
`docs/evidence/phase-7-design-2026-09-05/`. Start with the `*-compare.png` files: build on the left,
design on the right, **both scaled to 1440** because the build is captured at DPR 2 and the artboard
at DPR 1, and each panel carries its own sidecar (window size, DPR, scrollbar, settle) drawn into
the image.

What the build still refuses to draw, with the reason checked against `docs/protocol.md` rather than
recalled:

| Design draws | Verdict |
|---|---|
| Photos: **Share**, **Set as Mac wallpaper**, **Delete from phone** | `media.*` is four verbs and none of them is these. Removed, not greyed |
| Photos: **Camera** / **ISO** metadata rows | `media.list` carries no EXIF and no filename |
| Calls: waveform, **Mute**, **Speaker**, in-call **Keypad** | call audio is a permanent platform wall |
| Messages: **Video call**, **Block contact**, **Shared media** | no verb for any; and blocking is restricted to the default dialer, which this is not |
| Clipboard: row **Star** | Favourites is cut — this history is memory-only |
| Both: **End-to-end encrypted** / **Encrypted** badges | the link is; an SMS is not |

## 6 · What I would do next, and why

1. **Apply the vocabulary once it is decided.** Unchanged from the last handoff and now one sentence
   larger. Every pane at once, in one pass — the value is in their agreeing.
2. **The remaining panes have not been diffed against the design**: Mirror, Files, Notifications,
   Apps, Activity. Four of the five defects found tonight were
   app-wide (the accent, the button floor, the frame, the orphan tokens) and are already fixed
   everywhere; what is left for those panes is their own layout. `scripts/shot.mjs --screen=<id>`
   and `scripts/design-shot.mjs --page=<id>` make each one about ten minutes.
3. **Then Phase 8 signing**, unchanged: it unblocks Camera, D15, D12 and D13, and it needs an Apple
   account, which is yours to open.

## 7 · Left changed on your devices

- **The phone: nothing.** No taps, no installs, no writes. Two `adb` **reads** only — a
  `content query` against `media/external` to find out what the duplicate album rows are.
- **The Mac: one dev Electron run on `--remote-debugging-port=9222`**, relaunched several times
  during the sitting; the last relaunch is the one running. `pkill -f "node_modules/.bin/electron"`
  is the one that matches it.
- **Headless Chrome** was started and killed once per design/compare shot. None should be left; if
  one is, it is on a port in the 9333–9800 range with a `/tmp/design-shot-*` or `/tmp/compare-shot-*`
  profile.
- **Clipboard history on both sides holds probe strings.** Memory only; gone on restart.
- Nothing was force-stopped, nothing was uninstalled, and the phone's `Send to Mac` switch is as you
  left it.

## 7b · Messages, and where Contacts went

The pane was rebuilt to the canvas: three columns at `280px 1fr 300px`, 60px thread rows with
avatars, **previews** and timestamps, a chat panel with asymmetric bubbles and date separators, a
composer, and a person card.

**Contacts is not in the right column any more, and the answer to "where should it live" is
definite.** There is no `contacts` screen in `navModel`; the design's sidebar has no Contacts row;
the design's third column is the open conversation's person. A directory already has a built home —
the **Calls pane's Contacts tab**, over the same `contacts.list`, where picking someone fills the
dialler. So the directory moved into **New conversation**, where searching by name is the verb you
are actually performing, and the palette's *Contacts* row points at Calls.

**The filter tabs are `All` / `Unread`, not the design's `All` / `SMS` / `Chat`.** `sms.threads`
carries no kind — `kind` exists only per *message* — so an SMS tab would mean opening all fifty
conversations to label the list, and *Chat* means RCS, which this app does not implement. `unread`
is on every thread row, so that tab is real.

## 8 · The five findings worth carrying past this repo

Each is in `docs/testing.md` with its measurement; these are the sentences.

1. **A grid container with a definite block size sizes its `auto` rows against the space it has,
   not against its items' `aspect-ratio` height** — and the item then wins anyway and overflows the
   track it was given. `align-content` does not reach it and neither does `grid-auto-rows`. The fix
   is structural: the scroller and the grid are different elements.
2. **`min-height` beats `height`, silently, in the direction nobody reasons about.** A control floor
   written as *"anything that needs to be taller simply is"* also raises everything that needs to be
   shorter, and a toggle 8px too tall looks like a toggle.
3. **An undeclared custom property makes the whole declaration invalid at computed-value time** — it
   becomes `inherit`, not a default. Some of the eleven sites were correct by accident and some were
   not, from one misspelling.
4. **`overflow: hidden` still makes an element a scroll port.** It removes the scrollbar, which is
   the thing that would have told you.
5. **A column flex container with a constrained height shrinks its children**, and the text inside
   them goes first — fifty SMS previews were present, correct and invisible for a whole phase. The
   sharper half is that **the properties you can vary are not necessarily the ones responsible**:
   varying the row changed the symptom, so the row looked like the cause, and only rebuilding the
   whole structure separated them. The first written-down mechanism was wrong and was caught by
   insisting the new guard go red first.

And one about instruments, which cost the most time tonight: **three of the five defects were found
by asking a different question of the running app, not by looking at it** — *which rules declare a
height under the floor?*, *which `var()` names are never declared?*, *what is each of these two
readings actually reading?* Every one of those questions was cheap. None of them would have been
asked by someone reviewing a screenshot.
