# Shipped features with no home in the design — the enumeration, measured

> **Written 2026-09-02. Two of them are fixed in the same sitting; the rest are proposals or are
> shown not to be problems at all.**

The premise this started from was *"six shipped features have no home in the design — media remote
most of all, which has worked since step 67 and has no pane, no sidebar row, no dock tile."* The
first half of that is exactly right. The second half — *most of all* — turned out to be the wrong
diagnosis, and the difference is the whole reason this file starts with numbers.

## 0. The reading that changed the fix

`scripts/homeless-features-probe.mjs`, run against the live window on 2026-09-02.

**The impression was that the media remote is buried.** It is not:

```
the media remote card → {"drawn":true,"hidden":false,"top":535,"height":100,
                         "viewportHeight":865,"aboveTheFold":true}
the contacts card     → {"drawn":true,"hidden":false,"top":233,"height":496,"aboveTheFold":true}
```

Both cards are on screen, at full height, without scrolling. A person who knows where they are can
see them today.

**What is actually broken is that nothing can find them.** The palette is the app's search, and it
answered five queries with nothing at all — with the control that the same palette returns six rows
for `mirror`, so an empty result is a real absence rather than a dead query:

```
palette results for "music"   → []      [control=6]
palette results for "playing" → []      [control=6]
palette results for "remote"  → []      [control=6]
palette results for "contact" → []      [control=6]
palette results for "pair"    → []      [control=6]
```

Eleven screens are reachable by search. Three shipped features are not.

**This is why the fix is not a twelfth sidebar row.** *Buried* and *unfindable* look identical from
the outside and have different fixes: the first is answered by moving the card, the second by making
the search know it exists. Moving a card that is already above the fold would have cost a design
departure and changed nothing about the actual complaint. The rule is the one this project keeps
re-learning — a negative impression is no more evidence than a negative reading, and *"nobody can
find it"* is a claim that can be measured.

## 1. The enumeration

Every shipped Mac-side feature, and where a person reaches it. "Design" is
`ConnectSuite.dc.html`; the counts are `grep -oi` over it.

| Feature | Sidebar row | Dock tile | Named in the design | Where it lives | Verdict |
|---|---|---|---|---|---|
| Mirror | ✔ | ✔ | ✔ | Mirror screen | homed |
| **Input injection** | — | — | implied only | The Mirror canvas itself, with `input-note` above it: *"Click the picture to tap, drag to swipe, scroll to scroll, and type to enter text…"* | **homed by nature.** It is not a feature beside the canvas, it is what the canvas *is*. A row of its own would be a screen containing one sentence |
| Files | ✔ | ✔ | ✔ | Files screen | homed |
| Photos | ✔ | — | ✔ | Photos screen | homed |
| Messages / SMS | ✔ | ✔ | ✔ | Messages screen | homed |
| Notifications | ✔ | — | ✔ | Notifications screen | homed |
| Clipboard | ✔ | — | ✔ | Clipboard screen | homed |
| Calls | ✔ | ✔ | ✔ | Calls screen | homed |
| Activity | ✔ | — | ✔ | Activity screen | homed 2026-09-02 |
| **Media remote** | — | — | **0 mentions** of *remote*, *Now playing*, *playback* | `remote-card` on Overview, `top: 535` | **was unfindable — fixed below** |
| **Contacts** | — | — | 1 mention, in prose | `contacts-card` on Messages, `top: 233` | **was unfindable — fixed below** |
| **Pairing** | — (a route with no row) | — | 6 mentions of *Pair*, 1 of *pairing*, and **no drawn screen** | `PAIRING_SCREEN`, forced whenever `paired` is false | **proposal only — this is item 7's subject** |
| Floating mirror window | — | — | — | A toolbar button in the chrome, plus a Settings entry | homed |
| Drag to Finder | — | — | — | Inside Files, and stated in copy: *"…is on this Mac — drag it to Finder from here."* | homed |
| Manual address / Tailscale / Forget device / Log tail | — | — | — | Settings → Connection and Advanced | homed |
| Mirror debug HUD | — | — | ✔ (the design draws stats) | Mirror screen | homed |

**So the honest count is three, not six** — media remote, contacts and pairing — and one of the
three is a whole separate piece of work. The other items on the original list turn out to be homed
by something other than a nav row: a sentence above a canvas, a line in a pane's copy, a Settings
section. That is worth recording rather than quietly correcting, because *"six features have no
home"* was a reasonable thing to believe from the sidebar alone, and the sidebar is not where those
features live.

## 2. What was built — deep links

A third palette kind, in `navModel.ts` beside the other two, because the palette's contents are
already the one place the app's route table lives:

```ts
{ id: 'deep.remote',   label: 'Now playing', screen: 'overview', reveal: 'remote-card',
  keywords: ['media','remote','music','playing','playback','pause','skip','track'] }
{ id: 'deep.contacts', label: 'Contacts',    screen: 'messages', reveal: 'contacts-card',
  keywords: ['contacts','people','address book','phone book','number'] }
```

Three decisions in that, each of which could have gone the other way:

- **The keywords are what a person types, not what this repo calls it.** Nobody searching for the
  media remote types *media remote*; they type *music*, or *playing*, or *pause*. A label alone
  would have left four of the five measured queries still empty.
- **Deep links rank last**, after commands and after screens. Typing `c` must not put *Contacts*
  above *Calls* and *Clipboard*, which are whole screens. Asserted, because a later refactor
  reverses it by joining the arrays the other way round — which is what the existing
  commands-before-navigation comment was written for.
- **Activating one routes *and then reveals*.** A row that routes to Overview and stops has, from
  the user's side, done nothing distinguishable from a row that failed: they are on a screen they
  could already reach, with no indication of which part of it answered. The card is scrolled to and
  flashed once, and the flash is disabled under `prefers-reduced-motion`.

Re-measured on the live window after the change, same probe, same controls:

```
palette results for "music"   → ["Now playing" · In Overview]
palette results for "playing" → ["Now playing" · In Overview]
palette results for "remote"  → ["Now playing" · In Overview]
palette results for "contact" → ["Contacts" · In Messages]
palette results for "pair"    → []          ← still, and deliberately: item 7
```

**Guarded four ways**, in `navModel.test.ts`, because a deep link has more ways to rot than a nav
row does:

1. Every link's `screen` is a real screen.
2. Every link's `reveal` id is in `index.html` — a **source scan**, because the model cannot see an
   element deleted from the page. With a control asserting the scan found ids at all.
3. Every link's card is **inside the section it claims**. `In Overview` is a claim printed in the
   palette row, and a card that moved to another screen would send the user somewhere and flash
   nothing.
4. The exact five queries the probe measured as empty now return the feature, with the `mirror`
   query as the control.

The runtime says it too: a `reveal` id that no longer resolves raises a toast rather than silently
doing nothing, for the same reason `runSelected` already refuses to swallow a command with nothing
wired to it.

## 3. What was *not* built, and what each one needs

### 3.1 A dock tile or sidebar row for the media remote — **not built, and probably should not be**

The sidebar is the design's eleven and `PAIRING_SCREEN` already records the reasoning: inventing
rows the designer did not draw is how a shell stops matching its own handoff. The dock is five
tiles the design assigns per-feature hues to; a sixth would need a hue nobody chose.

**What would make it correct:** the designer drawing either. The request is in
`docs/design-departures.md` — a media-remote treatment, and a decision about whether it is a card
on Overview (where it is) or a screen of its own.

### 3.2 A Quick actions tile — **not built, needs a decision**

The design's Overview draws **Quick actions** with eight tiles for eight screens, and the header
says `8 available`. A ninth tile for a card on the same screen is a different kind of thing from the
eight — every one of them is a route — and it would make the count line either wrong or misleading.

**What would make it correct:** one sentence from the designer about whether Quick actions is *"the
eight screens"* or *"the things you do most"*. Under the first reading nothing changes; under the
second, the remote belongs there and the count line needs rewording.

### 3.3 Contacts as a screen — **not built, needs a decision**

Contacts is a 496px card inside Messages, which is a defensible home: it is mostly used to start a
message or a call. It is also the one Phase 4 feature with no surface of its own, and the design
mentions it once, in prose.

**What would make it correct:** knowing whether contacts is *an address book* (a screen) or *a
picker* (a card). This is a product question and not a wire one — `contacts.list` and `contacts.get`
answer either shape today.

### 3.4 Pairing — **item 7, and the largest of the three**

Deliberately out of scope here: it is not a discoverability problem, it is a missing flow. The
design has no drawn state for an unpaired Mac at all. `docs/design-departures.md` §"A request, not a
departure: the pairing screen" already carries the request.

## 4. The one thing to take from this file

The original brief and the measurement disagreed about *which* problem the media remote has, and
both agreed it had one. The measurement was cheap — one probe, five queries, one control — and it
changed the fix from *move the card* to *make the search know it exists*, which is a smaller change
that actually addresses the complaint.

**Before proposing a home for something, measure whether it is unreachable or merely unfindable.**
They look identical from the outside and they are not the same problem.
