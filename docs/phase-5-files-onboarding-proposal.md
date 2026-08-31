# The Files grant surface and its onboarding copy — proposed

Written 2026-09-01, before any of it is built. It answers the one item
`docs/phase-5-fs-media-proposal.md` §8.4 still lists as open:

> What remains genuinely open is smaller: the **onboarding copy** for a Files pane whose first
> screen is a list of granted folders rather than a filesystem, and which has to say plainly that
> files sitting directly in `Download/` cannot be reached.

**Nothing here is implemented.** The wire protocol it draws is already settled and is not reopened —
`fs.list` with no `rootId` returns the roots and a `grantHint`, and that is the only call this
surface makes.

> ## Built, 2026-09-01 — the phone half
>
> **§2, §3.1–§3.2, §3.5, §4 and §5 are no longer proposals.** The Folders screen ships in
> `sync-module/.../ui/folders/`, all four states were observed on hardware, and a real folder was
> granted through it on a release-shaped path and read back from the platform. The evidence is
> `docs/testing.md` → **Slice 6**. §3.3, §3.4 and §6 — the Mac's states and its Files pane — were
> built the same day as **Slice 7**, with `M2` and `M4` measured in the running app and each of the
> four differences shown to be load-bearing. F1–F7 have moved to `docs/design-departures.md` now
> that there is a pane that can deviate.
>
> Two things changed in the building, both recorded below rather than quietly: the **quick picks are
> not shipped** (§4), and **`EXTRA_INITIAL_URI` is left unset** with the reading that would settle it
> named (§8.3).

**Revision 2, same day.** Rev 1 designed one empty state and stopped. That is the trap this project
has now recorded seven times in `CLAUDE.md`: **a surface showing nothing and a surface that failed to
load are the same picture**, and a design that draws only the first has decided, silently, that the
second will be indistinguishable from it. §3 is new and is the part to read; §6 (the Mac's pane) and
§7 (enforcement) are rewritten around it. §5 is marked *built* — `FsRoots` shipped in slice 5 doing
exactly what rev 1 proposed, so that section is now a record rather than a proposal.

---

## 1. The decision this screen exists to carry

The Files feature is the only one in the app whose **first-run state is empty by design and stays
empty until the user does something the Mac cannot do for them.** Every other capability turns on
with a permission dialog or a Settings toggle; this one turns on folder by folder, forever, and
never reaches "all of it".

So the screen's job is not to collect a grant. It is to make an unusual shape legible before the
user runs into it:

| What the user expects | What is true |
|---|---|
| "I'll browse my phone from the Mac" | You browse the folders you have added, one at a time |
| "Downloads is the folder I want" | `Download` itself can never be added. Android refuses it |
| "Then I'll add it later" | There is no later. It is refused permanently, to every app that has not asked for all-files access |
| "So nothing can reach the phone" | Sending *to* the phone works with no grant at all |

**The fourth row is why the screen is not a wall of apology.** The push half of `fs.*` needs no
folder pick and no permission — observed on hardware, `docs/phase-5-fs-media-proposal.md` §4, and
re-observed by `DownloadsProbeActivity` with four storage permissions reading `false` on the line
above the write. So the honest first-run message is *"this already works one way; adding a folder is
what opens the other"*, not *"grant something before anything happens"*.

**One caveat on the fourth row, and it is a timing one.** `direction: "push"` answers
`FEATURE_UNAVAILABLE` in this build — the *mechanism* is proven, the *verb* is not served. Until push
lands, the fourth row is true of the platform and not yet true of the product, and the screen must
not promise it in the present tense. The copy in §4 is written for the build where push exists; the
one sentence that changes before then is called out there.

---

## 2. Where it lives — and why it is **not** an onboarding page

**Proposed: a fourth tab in Sync, `Folders`, beside Devices / Transfers / Feed. Onboarding gains one
sentence and no page.**

The name is not a free choice. `FsRoots.GRANT_HINT` already ships this sentence to every Mac:

> Add a folder in ConnectSuite on the phone, under Sync › Folders, to browse more of it

That string is on the wire, unparsed, and is what a Mac user reads when they wonder why they can see
one folder. A screen called anything else makes the phone a liar in a sentence the Mac renders
verbatim. `SyncRoute.kt`'s `SyncTab` enum gains one entry; nothing else moves.

`OnboardingScreen.kt` already states the rule this follows, in its own copy:

> "Notification mirroring and SMS need extra access. Those are asked for from the Sync tab, when you
> turn them on — not now."

and the file's header comment gives the reason: *"a user who has just been shown what Sync does will
grant nearby-devices access; the same user asked for SMS access before seeing anything will not."*
Folder picking is the most abstract grant in the app — it asks the user to predict which folders a
Mac they have not yet paired will want — so it is the worst possible thing to put on page 5 of a
first run. A user who taps through it grants nothing and has been told the wall once, at the moment
they were least able to care.

The sentence onboarding gains, on the existing Sync page, beside the one quoted above:

> Sending files to this phone works straight away. Browsing the phone's folders from the Mac needs
> you to pick each folder first — that is in Sync › Folders, whenever you want it.

**Rejected alternative: an onboarding page that opens the picker.** It buys one folder from a user
who does not yet know what for, and it spends the one moment the wall can be explained without
interrupting anything.

---

## 3. The states, drawn before the screen

This section exists because of one sentence: **a pane showing zero folders looks identical to a pane
that failed to load.** That is the same failure as an empty accessibility query, a `grep -c` with no
matched lines, and a poll that sampled either side of a 263 ms window — a reading that cannot tell
its target from a lookalike, rendered with total confidence. The difference here is that the
lookalike is one we draw ourselves, so it is the one case in that whole family we can simply refuse
to build.

### 3.1 The asymmetry, which decides how much to build on each side

The two sides do not have the same problem, and pretending they do would produce an unreachable
state on the phone — decoration, by the rule in `CLAUDE.md` about checks that do not gate anything.

- **The phone reads `contentResolver.persistedUriPermissions`.** In-process, synchronous, no IPC
  that can time out, no network. It cannot meaningfully fail. There is no *loading* state worth
  drawing and no *failed to load* state that can be reached — so the phone must not draw one. Its
  empty state is unambiguous **by construction**, and that is worth one comment in the source
  saying why, or someone adds a spinner and a retry button to be safe and creates two states that
  can never be told apart because one never occurs.
- **The Mac asks `fs.list` over a link that drops.** Every one of loading, failed, timed out,
  capability-absent and genuinely-empty is reachable in a normal week. This is where the seven-times
  trap actually lives, and where the work goes.

Writing that down is the point. Rev 1 designed one empty card and left the Mac's five other states
to be invented per-render by whoever built the pane.

### 3.2 The phone's states — four, and none of them is "failed"

| State | When | What it looks like |
|---|---|---|
| **No folders added** | `grantedTrees` is empty | The empty card of §4. Titled *"No folders yet"* — a fact about what the user has done, not about what we could read |
| **Folders** | one or more grants | Rows, plus the wall card, which stays |
| **A grant that no longer resolves** | the folder was deleted or the OS dropped it; `FsRoots.all` **keeps it in the list** | The row, dimmed, reading *"This folder is gone from the phone"* and offering only **Remove**. Never dropped silently — an absence the user cannot act on is worse than a broken row they can |
| **Picker returned nothing** | user cancelled, or Android refused the folder — see 3.5 | Nothing changes, and **no message is shown**. See 3.5 for why a toast here would be a guess |

There is no fifth. If a future version adds one that can fail — a folder count fetched from
somewhere, a thumbnail — it gets a failed state at that moment and not before.

### 3.3 The Mac's states — six, and two pairs of them are the trap

| # | State | Reached when | Non-negotiable in the drawing |
|---|---|---|---|
| M1 | **Loading** | `fs.list` in flight, first time | A skeleton, no copy that asserts anything about content |
| M2 | **Ready, one root** | ack with `roots.length === 1` — the app root, always present | *Almost* empty. Headline says one folder is shared, not that nothing is |
| M3 | **Ready, several roots** | ack with more | The list |
| M4 | **Failed** | error ack, timeout, or the link dropped mid-request | `#FF5D5D`, the phone's own message, and a **Retry**. Never the word "no" or "nothing" |
| M5 | **Capability absent** | `files` not advertised | `#F5B23D`, the phone's own `reason` verbatim. This is N4's pattern, already built for Notifications |
| M6 | **Degraded** | `files` advertised, `push` unavailable — **this build** | `#F5B23D` banner over a working pane, and **no upload affordance at all**. P5's pattern, already built for Photos |

**The two pairs.** M2/M4 is the trap named in the brief. M5/M6 is its sibling and is the one this
project has already met twice: *"the phone does not offer this"* and *"the phone offers most of
this"* are different sentences, and the design draws neither.

M6 is not hypothetical and is not a design preference. `docs/protocol.md` says it outright — *"A
Files pane must not draw an upload affordance against this build"* — and `docs/RESUME.md` says it
again in slice 5's table. Both places, deliberately, because it is the kind of rule that gets
softened by whoever is drawing the drop tile the design shows.

### 3.4 The discrimination rule: four differences, not one

**M2 and M4 must differ in four independent ways, so that no single mistake can collapse them.**

| | M2 — ready, almost empty | M4 — failed |
|---|---|---|
| Colour role | neutral surface, `rgba(22,24,34,.82)` | destructive, `#FF5D5D` |
| Icon | folder | alert |
| Headline verb | states what **is** — *"This phone has shared one folder"* | states what **happened** — *"Couldn't read the phone's folders"* |
| Controls | none, plus the grant hint | **Retry**, always |

One difference is a bug away from none. The colour alone fails for anyone who cannot distinguish it;
the icon alone fails at a glance; the headline alone fails when someone reuses a component. Four is
not belt-and-braces, it is the same argument as *"the partial is never at its final name"* — the
property has to survive one of its guarantees being wrong.

**The design's own token table already decides the colour half**, which is why this is not an
invention: `#FF5D5D` is documented as *"destructive actions and failure states ONLY"*, and
`README.md` adds *"in a connection product red reads as 'link is down'"*. So M4 gets red and M2 must
not, and no new token is needed for either.

**And the state must be one value, not two booleans.** The enforceable half of this is in §7: an
`isEmpty` flag beside an `error` flag is two facts that can disagree, and the render that reads only
the first is exactly how the two states become one picture. A tagged union in `src/shared/` makes
the ambiguous combination unrepresentable, which is a stronger guarantee than any test over the
rendering.

### 3.5 The lookalike inside the picker: **cancelled and refused are the same result**

Worth its own heading, because it is a discrimination failure sitting inside the one interaction this
screen exists for, and the answer to it shapes the copy rather than the code.

When Android refuses a folder it does not return an error. It lists the folder normally, shows two
lines of its own — `Can’t use this folder` over `To protect your privacy, choose another folder`
— and sets `USE THIS FOLDER` to `enabled="false"`. The user then backs out, and
`ActivityResultContracts.OpenDocumentTree` hands us `null`.

**The readings carry their own control, which is why they count.** `saf1.xml` and `saf2.xml` — the
storage root and `Download` — hold both refusal strings and `enabled="false"`. `saf3.xml` and
`saf4.xml`, taken the same way on grantable folders, hold `enabled="true"` and neither string. So
the dump can tell a disabled button from an enabled one, and the absence in the last two is a
reading rather than a failure to look.

A user who changed their mind hands us the same `null`.

**So we cannot tell "tried Download and was refused" from "decided not to".** There is no extra, no
result code, no way to ask afterwards. Two consequences, and the second is the one that matters:

1. **Never show a message after a cancelled pick.** *"That folder can't be added"* would be a
   confident wrong answer half the time, which is precisely the failure mode this repo keeps
   recording. Silence is the honest response to a result that carries no information.
2. **Therefore the wall must be stated before the picker opens, not after it refuses.** This is the
   whole argument for the wall card being a standing part of the screen rather than an error state.
   A user who reads it first never meets the disabled button; a user who does meet it has already
   been told what it means. The copy is doing the work the platform refuses to do.

This also kills the tempting shortcut of "let them try, then explain". There is nothing to explain
*with*.

---

## 4. The screen, in the design's language

`ConnectSuite.dc.html` draws no phone screens — it is the Mac app, eleven screens and a detached
mirror window. What carries across is its **voice** and its **state vocabulary**, both of which the
phone already speaks: the canvas's Photos empty state reads *"Nothing in this album yet"* over an
explanatory line, and `NotificationsScreen.kt` already ships *"Nothing here yet"* over an
explanatory line. Same sentence shape, both sides, without anyone having coordinated it. Keep it.

Material 3, `Card` and `PermissionCard` as the rest of the app uses them. Three regions.

```
┌────────────────────────────────────────────────┐
│  Folders                                       │  headlineMedium
│  The Mac can open the folders you add here,    │  bodyLarge, onSurfaceVariant
│  and nothing else on this phone.               │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  No folders yet                          │  │  ← empty state, Card,
│  │                                          │  │    default surface
│  │  Sending files to this phone already     │  │
│  │  works — they arrive in                  │  │
│  │  Download › ConnectSuite.                │  │
│  │                                          │  │
│  │  Add a folder to browse it from the Mac. │  │
│  │                          [ Add folder ]  │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  (no quick picks — see below)                  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ ⚠  Two folders Android will not give     │  │  ← the wall, Card,
│  │    any app                               │  │    tertiaryContainer
│  │                                          │  │
│  │  **Download itself can never be added.** │  │
│  │  Android refuses it, and folders inside  │  │
│  │  it are fine — Download › ConnectSuite   │  │
│  │  works. So a file your browser or        │  │
│  │  WhatsApp drops straight into Download   │  │
│  │  cannot be reached from the Mac. Move it │  │
│  │  into a folder you have added and it     │  │
│  │  appears.                                │  │
│  │                                          │  │
│  │  Android › data and Android › obb are    │  │
│  │  closed to every app on the phone,       │  │
│  │  including this one.                     │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Quick picks are not shipped. That is a decision with a reason, not a deferral.**

A chip is a promise about where the picker opens, and **this app cannot make that promise.** With
`EXTRA_INITIAL_URI` unset — which §8.3 decides deliberately — the picker does not start at the top
of storage: **it chooses.** Observed on this handset, 2026-09-01: with no initial URI it **restored
its own last location** and opened inside `DCIM`. So a chip labelled `Camera` would open wherever
DocumentsUI happened to be, which on a second run is wherever the *previous pick* ended. The label
would be right by coincidence and wrong by default, and the user has no way to tell which.

**Four readings the same day settle it, and the accurate claim is stronger than the first one
written here.** Same handset, same unaimed intent, `FsRoots.pickerIntent()` unchanged between them:
the picker restored its previous location and opened **inside `DCIM`** at 02:27, 02:29 and 02:30,
then at 03:02 opened at the **root of internal storage** with `Can’t use this folder` and
`USE THIS FOLDER` `enabled="false"`. Timestamps and their anchoring log lines are in
`docs/testing.md` → Slice 7.

So the starting point is not merely *not the top of storage*: **it is not stable between runs on one
device.** A chip labelled `Camera` would have been right three times and wrong the fourth, with
nothing on screen to tell a user which run they were in — and the fourth would have delivered them
onto the exact refusal §3.5 exists to keep them away from.

"Unset" reading as "starts at the top" is the assumption that makes chips look safe, and it is
false twice over. A chip returns only if §8.3's reading says the picker can be aimed reliably — not
before, and not as a cosmetic addition.

**The one sentence that is dated.** *"Sending files to this phone already works"* is true of v1's
transfer path and not yet of `fs.*` push. Until push lands the empty card reads *"Add a folder to
browse it from the Mac"* and drops the first paragraph — an empty state that promises a verb
answering `FEATURE_UNAVAILABLE` is the same lie as an upload button on the Mac.

Once a folder exists the empty-state card is replaced by rows, and the wall card **stays** — it is
not a first-run message, it is a standing fact about the feature, and by 3.5 it is the only thing
that can reach the user before the picker does:

```
│  ┌──────────────────────────────────────────┐  │
│  │  📁  Camera                              │  │  bucket label
│  │      DCIM › Camera · read and write      │  │  bodySmall, onSurfaceVariant
│  │                              [ Remove ]  │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  📁  Trip photos                    dimmed│  │  ← the unresolvable grant
│  │      This folder is gone from the phone  │  │
│  │                              [ Remove ]  │  │
│  └──────────────────────────────────────────┘  │
```

### Five copy rules this screen is written under

1. **Name the folder the way the phone's own file manager names it.** `DCIM › Camera`, never
   `content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FCamera`. The URI is the
   machine handle; the breadcrumb is the sentence. This is the package-id rule from `CLAUDE.md`
   applied to a different kind of opaque identifier, and it binds the same way.
2. **State the wall as a property of Android, not of this app.** "Android refuses it" is true and
   checkable; "we can't read Download" reads as a missing feature someone could file a bug about.
3. **Never say "grant permission".** No permission is involved — there is no runtime dialog, nothing
   in Settings › Permissions, and nothing to revoke there. The verb is *add a folder*, and the
   opposite is *remove*.
4. **Say what still works in the same breath as what does not.** The wall card names
   `Download › ConnectSuite` working, immediately after saying `Download` does not. A limitation with
   no working case beside it reads as the feature being broken — which is the counter rule from
   `CLAUDE.md` in prose rather than in a log line.
5. **Never report an outcome the platform did not tell us.** From 3.5: a cancelled pick gets
   silence, because refusal and cancellation arrive as the same `null`. Any message here would be a
   coin flip rendered as a fact.

### The Remove row is a real revoke, and it says so

`releasePersistableUriPermission` is immediate and total: the Mac loses that root on its next
`fs.list`. There is no confirmation dialog, because nothing is destroyed — this removes access, not
files — and a dialog would imply otherwise. The row's supporting line says
**"Removes the Mac's access. Nothing on the phone is deleted."**

---

## 5. What the state is read *from* — **built in slice 5, as proposed**

Rev 1 proposed this; `sync-module/.../v2/FsRoots.kt` ships it, and its header comment carries the
argument, so this section is now a record of a decision rather than a request for one.

**The granted roots are read from `contentResolver.persistedUriPermissions`, and there is no Room
table of folders.** Android already holds this list, survives reboot with it, and is the only thing
that can revoke it. A Room mirror would be a second copy of a fact the platform owns, free to
disagree with it the first time a user clears app data or the OS drops a grant — and the screen would
then offer a folder that `fs.list` cannot open. One home for the rule, per `CLAUDE.md`.

The consequence for `fs.*`: `rootId` is derived from the tree URI rather than assigned by us, so it
is stable across reboots and process death without anything storing it. `saf:primary%3ADCIM` *is*
the grant.

`FsRoots.all` also already answers rev 1's second open question: **a grant that no longer resolves is
kept in the list**, for the reason 3.2 gives. The screen owes it a drawn state, which §4 now has.

**Not to be confused with the transfer records**, which do stay in Room — those are our own state
about a copy in progress, not a fact the platform holds, and §4 of the payload spec is explicit that
the Room row is authoritative for resume precisely because the *filesystem* is not ours.

---

## 6. The Mac's Files pane — proposed, and deliberately not built yet

Not built until the Folders screen is settled, because a pane has nothing to open on until a release
build can grant a folder. Written here so the copy is decided once and both sides say the same thing.

### 6.1 The two states that carry the wall

**M2 — ready, one root.** The pane opens on the roots from `fs.list`, and on first run that is one
row — `ConnectSuite`, the app-private folder — plus a `grantHint`. So the Mac's empty state is not
empty; it is **almost** empty, which is worse, because one working root looks like a broken list of
many.

> **This phone has shared one folder**
>
> ConnectSuite's own folder is always here. To browse more of the phone, open ConnectSuite on the
> phone and go to **Sync › Folders**.
>
> Folders are added on the phone, one at a time — the Mac cannot ask for them.
>
> Files saved straight into the phone's **Download** folder can't be reached from here at all.
> Android refuses that folder to every app. A folder *inside* Download is fine.

**The fourth paragraph is new in rev 2 and it is there because the brief is right: that hole belongs
in the pane, not in a doc.** It is the one limit a Mac user will otherwise discover by looking for a
file that is definitely on their phone and definitely not in this list. Stated here, it costs two
lines; discovered, it costs the user's belief that the pane is showing them everything.

**The third paragraph is a protocol fact, not a UX choice.** There is no `fs.grant` message and there
is not going to be one: the inventory is fixed at twelve types, and a thirteenth that makes the phone
open a picker would be the Mac reaching for a consent surface only a person holding the phone can
answer. So the Mac must not draw an "Add folder" button. A button that sends a request the phone
answers with a picker nobody is looking at is worse than no button —
`docs/phase-5-fs-media-proposal.md` §1 rejects `ACTION_OPEN_DOCUMENT` for exactly this reason:
*"a feature that only works when the user is already at the device."*

`grantHint` is what the Mac renders under that heading, verbatim, unparsed — the same standing the
capability `unavailable` strings have.

**M4 — failed.** Everything 3.4 requires, and one thing more: the phone's own message is rendered
verbatim if there is one, and the code is shown in mono beneath it. `Couldn't read the phone's
folders` over `ROOT_NOT_GRANTED` is diagnosable; a generic "Something went wrong" is the same
information as a blank pane.

### 6.2 Where the canvas draws something the wire cannot serve

These are the rows that will move into `docs/design-departures.md` **when the pane is built** — not
before. That file's contract is that anything not in it is a bug rather than a decision, and a pane
that does not exist yet cannot deviate from anything. They are listed here so the build has them
ready and so the designer sees them at proposal time rather than at handoff.

| # | Design draws | Proposed instead | Status | Why |
|---|---|---|---|---|
| F1 | **Internal storage** as a root, with `Alarms`, `Android`, `DCIM`, `Downloads`, `Music` beneath it | The roots from `fs.list` — `ConnectSuite`, plus each granted tree | **wall** | There is no path-based view of shared storage at `targetSdk 36`. The root of internal storage cannot be granted to anyone. Drawn as the design has it, four of those five rows would open on an error |
| F2 | **Downloads** as a browsable folder | Absent, and named in M2's copy as the folder that cannot be reached | **wall** | `Download` itself is refused by the picker; the design's row is also spelled with an `s` the platform does not have. This is the single most likely folder for a user to look for, which is why it gets copy instead of silence |
| F3 | **Android** as a browsable folder | Absent, and named in the phone's wall card | **wall** | `Android/data` and `Android/obb` are unreachable by any route, for any app, since Android 11 |
| F4 | **"Drop files to send to phone / or click to choose"** upload tile | Not drawn at all in this build | **unbuilt** | `direction: "push"` answers `FEATURE_UNAVAILABLE`. `docs/protocol.md` and `docs/RESUME.md` both already forbid the affordance. It returns, as drawn, when push lands |
| F5 | Footer reading **"1,245 items"** | The count of what has been loaded, with `hasMore` — *"200 loaded · more"* | **reshaped** | `fs.list` has no total. Getting one means paging to exhaustion, which is defect 55's 16,377-entry directory. A number with no denominator is the rule `CLAUDE.md` opens with; `1,245` here would be a guess |
| F6 | Breadcrumb **"Internal storage / DCIM / Camera"** | The root's own label, then the `(rootId, path)` pair — *"DCIM › Camera"* | **reshaped** | The first segment is a fiction under SAF. The rest of the breadcrumb is real and is exactly what the wire addresses |
| F7 | No state for *this failed to load* — the canvas has none, anywhere | M4, per 3.4 | **reshaped** | Third time a row in this family has read *the design is missing something* rather than *the wire is missing something*, after N4 (unavailable) and P5 (partial). A drawn failure state in the design's language would close all three |

**F7 is the row to hand the designer.** N4, P5 and F7 are one gap seen from three angles: the canvas
draws features that work and features that are empty, and nothing else. A product whose whole
subject is a link to a device that goes in and out of range spends a meaningful share of its life in
states the design does not contain.

---

## 7. What would catch a violation of any of this

Asked per `CLAUDE.md`, and answered honestly rather than with a check that would look like coverage.

| The claim | What enforces it | Verdict |
|---|---|---|
| **M2 and M4 can never render as each other** | The pane's state is one tagged union in `src/shared/` — `idle` / `loading` / `ready` / `failed` — not an `isEmpty` boolean beside an `error`. The ambiguous combination is unrepresentable, and a test asserts each variant yields a distinct headline and that **only `failed` carries a retry** | **Enforceable, and it is the strongest of these** — write it with the pane, per the `src/shared/` seam rule |
| The pane draws no upload affordance while push is unavailable | A test over the pure view model asserting the upload tile is absent unless a `push` capability flag is set. `navModel`'s icon enumeration catches an icon, not a tile, so this needs its own | **Enforceable** |
| A tree URI never reaches a user-visible string; the breadcrumb does | A test over the pure label function with a real `primary%3ADCIM%2FCamera` tree id, asserting no `%` and no `content://` | **Built** — `FsPathsTest` and `FoldersModelTest`. Confirmed on the device: the gone row read `DCIM › cs-gone-test` |
| The roots list has exactly one source | A source scan asserting `persistedUriPermissions` is *called* in exactly one file, the way `transferFiles.test.ts` pins the `.part` suffix | **Built** — `FsRootsSingleSourceTest`. It failed on its first run against a KDoc and now strips comments, with fixtures both ways: defect 41's lesson, met again |
| No message is shown after a cancelled pick | The wording moved into pure `pickMessage`, so a test can assert `null` for a cancelled pick — and it still reports a pick that succeeded then failed to persist | **Built and shown to fail** — returning a sentence turns it red. This was *recorded, not enforced* in rev 2; the rule was worth an enforcement point |
| The phone never draws a "failed to load" state it cannot reach | Two things. `FoldersScreen`'s `when` is exhaustive, so the **compiler** refuses a new variant; `FoldersModelTest` scans the source for variants, which catches the case the compiler cannot — someone adding one *and* rendering it | **Built**, both shown to fail. Rev 2 said *nothing automatic, and nothing should be*; that was wrong, and cheaply so |
| The wall copy stays accurate if Android changes the restriction | **Nothing, and nothing can.** It is one OEM picker's behaviour at one API level | **Recorded** — `SafProbeActivity` is the reproducer, and re-running it is the only check there is |

The last three are the honest ones. The last in particular: the four readings behind this copy are
`docs/evidence/saf-probe-2026-08-31/saf1.xml`–`saf4.xml`, taken through our own package so the
calling package's target SDK is the product's. If the copy is ever doubted, that probe is re-run —
it is not re-argued from documentation, which is what produced the wrong version of loss (3) in the
first place.

---

## 8. Open, and small

1. ~~**Whether the quick picks should include `Download/ConnectSuite`.**~~ **Resolved: not yet, and
   the reason is a fact rather than a preference.** That folder **does not exist until the first file
   lands in it** — `DownloadsProbeActivity`'s poller read `No such file or directory` on its first
   five samples, and the `MediaStore` insert is what created the directory. A quick pick pointing at
   a folder that is not there opens the picker in `Download` with `USE THIS FOLDER` disabled, which
   walks the user straight into the one refusal §3.5 exists to keep them away from. So: the pick
   appears **only when the folder exists**, which in this build means **after push ships**, labelled
   *Received files* and listed last.
2. ~~**Whether an unreadable root should be shown as a broken row or dropped.**~~ **Resolved by the
   code: kept.** `FsRoots.all` keeps it, §4 draws it, 3.2 gives the reason.
3. **Open, and deliberately left so: `EXTRA_INITIAL_URI` is unset.** Decided 2026-09-01. Aiming the
   picker would land the user one tap from the right answer and would also mean a pick that *starts*
   inside `Download` for the `Received files` case — the one directory whose refusal §3.5 exists to
   keep them away from. Aiming an instrument at a place that may refuse is the failure, not the fix.

   **The reading that would settle it**, and it has not been taken: open the picker with
   `EXTRA_INITIAL_URI` pointing at `Download/ConnectSuite` on a handset where that folder exists, and
   dump the tree. Three outcomes, three different decisions — (a) the picker opens *inside* the named
   folder with `USE THIS FOLDER` `enabled="true"`, and aiming is safe and worth it; (b) it opens in
   the named folder's **parent** (`Download`, `enabled="false"`), and aiming actively walks the user
   into the refusal, so it stays unset forever; (c) the extra is ignored and the picker restores its
   own last location — which is what it did with the extra *absent* in this sitting — and aiming buys
   nothing. It is one probe run and it needs the folder to exist, so it is naturally push's sitting,
   not this one.

   Until it is taken, **no chip or button in this app may claim a destination**, because none of them
   can honour one.
4. ~~**Whether the Folders tab appears when no Mac has ever been paired.**~~ **Resolved: always
   present.** Decided and built 2026-09-01. `FsRoots.GRANT_HINT` — *"Add a folder in ConnectSuite on
   the phone, under Sync › Folders"* — is on the wire, unparsed, and **cannot check whether anyone is
   paired**. A tab that appears only after pairing makes that sentence wrong for exactly the people
   reading it. The cost is a tab with nothing to do on a fresh install; the empty card already says
   what it is for, so it is an empty state rather than a dead end.
