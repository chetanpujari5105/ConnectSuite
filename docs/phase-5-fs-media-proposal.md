# `fs.*` and `media.*` — payload specification, proposed

Written 2026-08-31, immediately after Phase 5's first slice (Bug 6's frame caps) landed.

**Nothing here is committed to `docs/protocol.md`, and nothing here is implemented.** The protocol is
the contract; this is the argument for extending it, kept separate so it can be read, disagreed with
and reverted on its own — the same arrangement as `docs/phase-5-proposals.md`, which decided the
caps, the `beforeId` cursor, and what survives from v1's `TransferManager`. This document answers
that file's largest open question: `docs/protocol.md` lists the eight `fs.*` and four `media.*` type
names in its inventory and specifies **nothing else about them** — no request shape, no response
shape, no error table.

It also answers open question **2** from `docs/RESUME.md` (what happens to a running transfer when
the control session dies) and open question **4** (the doc contradicts itself on chunk size),
because both are decisions this specification cannot avoid taking.

Twelve types, in five groups:

1. [The platform wall this spec has to start from](#1-the-platform-wall-this-spec-has-to-start-from)
2. [Roots — what `fs.*` addresses, and why not a path](#2-roots--what-fs-addresses-and-why-not-a-path)
3. [`fs.list`, `fs.stat`, `fs.mkdir`, `fs.delete`](#3-fslist-fsstat-fsmkdir-fsdelete)
4. [The transfer: `fs.transfer.begin` / `progress` / `done` / `cancel`](#4-the-transfer)
5. [`media.buckets`, `media.list`, `media.thumb`, `media.original`](#5-media)
6. [The package-id rule, written into the wire](#6-the-package-id-rule-written-into-the-wire)
7. [Errors](#7-errors)
8. [What this leaves open, deliberately](#8-what-this-leaves-open-deliberately)

---

## 1. The platform wall this spec has to start from

**The v1 plan's file browser cannot be built as written, and neither can the obvious reading of
`fs.list`.** `android-connect-suite-claude-code-prompt.md` describes browsing the phone's storage by
path. On `targetSdk 36` that is not a design choice we get to make:

- **Scoped storage is not optional.** `requestLegacyExternalStorage` stopped working at API 30, and
  we target 36. There is no path-based view of shared storage available to an ordinary app.
- **`Android/data` and `Android/obb` are unreadable to everyone**, by any API, since Android 11 —
  including through the document picker, which explicitly blocks those two trees.
- **`READ_MEDIA_IMAGES` / `_VIDEO` / `_AUDIO` give `MediaStore` rows, not directories.** They are
  enough for the whole photo browser and give nothing at all to a file browser.
- **`MANAGE_EXTERNAL_STORAGE`** ("All files access") does restore a broad path-based view. It is a
  special access the user grants by hand in Settings, exactly like the accessibility service and the
  notification listener this project already asks for, and it is **Play-policy restricted** to file
  managers and similar. **We are not asking for it** — see the decision immediately below.

### The decision: **SAF trees only. `MANAGE_EXTERNAL_STORAGE` is not requested.**

**Taken 2026-08-31, and it is a decision rather than a recommendation.** This app has no cloud and
no account, and whole-of-storage is the one permission that makes people uninstall. A file browser
that asks for everything on the first run has spent the trust the rest of the design is built on.

| Foundation | What the user does | What `fs.*` can then serve | Status |
|---|---|---|---|
| **SAF trees** (`ACTION_OPEN_DOCUMENT_TREE`, persisted URI grants) | Picks a folder, once per folder | That folder and everything under it, read and write | **This is what we build** |
| **All files access** (`MANAGE_EXTERNAL_STORAGE`) | One Settings toggle | Shared storage, minus `Android/data` and `Android/obb`, which stay unreadable regardless | **Recorded, not built** — see below |

The wire protocol in this document is written so that all-files access, if it is ever added, is
**one more root with `kind: "all"`** and not a different feature. That is the only accommodation made
for it: the shape is left open, nothing is requested, and no code asks.

### What SAF actually costs, named rather than worked around

The instruction was to say plainly which named features SAF makes *impossible* rather than merely
slower. Three, and the first two are the same platform restriction:

1. **"Browse the phone's storage" is not a thing this app can offer.** Since Android 11,
   `ACTION_OPEN_DOCUMENT_TREE` **cannot grant the root directory of internal storage.** The user
   grants folder by folder. The Mac's Files pane therefore opens on a list of granted folders, not on
   a filesystem, and there is no view from which the whole phone is visible. This is not a slower
   path to the same place — the place does not exist.

2. **The `Download` folder cannot be granted as a tree at all.** The same Android 11 restriction
   names it specifically, alongside the storage root. `Download` is one of the two folders people
   actually want from a Mac, and under SAF it is unreachable as a browsable tree — so
   *"drag a file the phone downloaded into Finder"* does not work by browsing.

   **This one survives the correction to (3) below, and it is worth being blunt about why.** A
   browser, a chat app or Quick Share drops its file **directly into `Download/`**, not into a
   subfolder — so the fact that `Download/ConnectSuite` can be granted does nothing for files the
   phone has already downloaded. Anything that lands in `Download/` itself is invisible to this app,
   permanently, and the only ways to reach it are the user moving the file on the phone or the
   all-files access we are not asking for. **This is a real, permanent hole in the file browser** and
   it should be stated to the user in the Files pane rather than discovered.

3. ~~**A default destination for "send to phone" cannot be the platform `Download` folder.**~~
   **This was wrong, and the hardware run corrected it.** The restriction is scoped to `Download`
   **itself**, not to its subtree: `Download/Music` was offered `USE THIS FOLDER` **enabled**, with
   the refusal message absent entirely. So "send to phone" *does* get a real default —
   **`Download/ConnectSuite`, created and granted once during onboarding**, which is a folder the
   user's other apps and file manager can see, in the place they already look for arriving files. The
   picker even proposes the move itself: on a refused folder it disables `USE THIS FOLDER` and offers
   `CREATE NEW FOLDER` in its place.

   The app-private root (`kind: "app"`) stays as the fallback for a user who grants nothing, and is
   still worse — a file put there is not somewhere the user will look — but it is no longer the
   *expected* destination.

**The workaround is named and rejected, because working around it is exactly what was asked
against.** `ACTION_OPEN_DOCUMENT` — the single-file picker — reaches `Download` and reaches anything
else, and is not blocked. It is not a fix: it requires a person holding the phone to tap the file,
which defeats the entire premise of browsing from the Mac. Offering it as the answer to (2) would be
a feature that only works when the user is already at the device.

**What SAF does not cost.** The photo and video browser is untouched — `media.*` is `MediaStore`, not
paths, and needs no tree grant at all. `Android/data` and `Android/obb` are unreadable to every app
by any API since Android 11, so nothing is lost there that all-files access would have recovered.
Read and write inside a granted tree, resume, and drag-to-Finder all work normally.

### The recorded upgrade path, with the trade-off stated

If `MANAGE_EXTERNAL_STORAGE` is ever wanted, this is what it buys and what it costs, so the decision
can be re-taken on facts rather than re-argued:

- **Buys:** one Settings toggle replaces every folder pick; the storage root and `Download` become
  browsable; "send to phone" gets a real default destination. All three losses above disappear.
- **Costs:** the app is asking to read every file on the phone, including other apps' shared data,
  chat exports, and documents it will never touch. It is Play-policy restricted to file managers and
  similar, so it also forecloses a Play listing. And it is the permission a user is most likely to
  read as *"why does this need that?"* — on a product whose entire pitch is no cloud, no account, no
  relay.
- **If it is ever added it belongs behind an explicit opt-in**, never in onboarding: a disabled
  "Browse all files" row in the Files pane that deep-links to Settings, alongside a sentence saying
  what it grants. Never a runtime prompt on first run.

### Verified on hardware, 2026-08-31 — SM-S938B, Android 16 / SDK 36

This section was written from the platform documentation and its central claim was **unverified**,
which the first draft said in as many words. It has now been observed, and one of the three losses
turned out to be wrong — which is the argument for running it before building rather than after.

**The method matters more than usual here, and `adb shell am start` would have given a wrong
answer.** The restriction is applied by DocumentsUI against the **calling package's** target SDK, and
a shell-launched intent has no calling package at all. The shell and the app are two different
clients issuing what looks like the same request — defect 50's shape exactly, and the rule it left
behind is *verify a mechanism through the same client the product uses, or you have verified a
different mechanism.* So a debug-only `SafProbeActivity` (`app/src/debug/`, see below) was built to
make our own package the caller. **The run log carries `targetSdk=36`**, which is what makes these
readings evidence about the product rather than a shell artefact.

Four readings, one run, `com.google.android.documentsui/…picker.PickActivity`:

| # | Target | `USE THIS FOLDER` | Refusal message | Elements in dump |
|---|---|---|---|---|
| 1 | Root of internal storage | **`enabled=false`** | `Can't use this folder` / *To protect your privacy, choose another folder* | 32 |
| 2 | `Download` | **`enabled=false`** | same message present | 28 |
| 3 | `Download/Music` | `enabled=true` | **absent** | 15 |
| 4 | `DCIM` (top level) | `enabled=true` | **absent** | 34 |

**The element counts are the control and that is why they are in the table.** Every refusal here is
an absence — a disabled button, a missing grant — and an absence counts only beside a known positive.
Readings 3 and 4 are that positive: the same query, in the same run, against the same picker,
returned an *enabled* button twice. A picker that was broken, or a dump that was empty, would have
produced two more refusals and looked identical to a real finding. Readings 1 and 2 also enumerate
the whole surface — 32 and 28 elements including the full folder listing — so "the button is
disabled" is a reading rather than a miss.

**The failure mode is now named precisely, because the three candidates are different bugs.** It is
**not** absent-from-the-list and **not** selectable-but-the-grant-fails-afterwards. It is: *the folder
is fully browsable, its contents are listed, and the confirm button is disabled with an explicit
in-picker sentence.* Reading 2's dump listed `Download`'s files with sizes and dates while refusing
to grant it, which is the clearest statement of that distinction available.

**The grant on reading 4 was then confirmed from the platform's side**, not from the app's own report
and not from the tap:

```
UriPermission{61d3ce4 content://com.android.externalstorage.documents/tree/primary%3ADCIM [user 0] [prefix]}
  targetUserId=0  sourcePkg=com.android.externalstorage  targetPkg=com.chetan.connectsuite.debug
  mode=0x3  owned=0x0  global=0x0  persistable=0x3  persisted=0x3  persistedCreate=1788183861135
```

`mode=0x3` is `READ|WRITE`, `persisted=0x3` is both flags persisted, `[prefix]` is the subtree. **And
that query carries its own control too:** the same dump shows this package holding other URI grants
at `persisted=0x0`, so it can tell a persisted grant from a non-persisted one and is not reporting
everything as persisted. That closes the third failure mode — a selection the picker accepted but
that did not survive — which is the one nobody can see by watching the screen.

Raw dumps: `docs/evidence/saf-probe-2026-08-31/saf1.xml` … `saf4.xml`.

**`SafProbeActivity` cannot reach a release build, and this was checked rather than assumed.** It
lives in `app/src/debug/`, which AGP merges only into debug variants. Proven by grepping the merged
manifests of both variants: **0 occurrences in all three release manifests, 2 in all three debug
manifests** — so the grep can see the activity where it exists, and the zero is a reading rather than
a miss. It is kept as the reproducer for this section; `rm -rf app/src/debug` removes it entirely.

**The wall is now in `CLAUDE.md`** alongside the others, because it is observed rather than
documented: *there is no path-based view of the phone's shared storage; SAF grants one tree at a
time; the storage root and `Download` itself cannot be granted, though folders inside `Download`
can; and `Android/data` and `Android/obb` are unreachable by any route.*

---

## 2. Roots — what `fs.*` addresses, and why not a path

**Proposed: `fs.*` addresses a `(rootId, path)` pair, never a bare absolute path.**

```json
{"rootId":"saf:primary%3ADCIM","path":"Camera/trip"}
```

`rootId` is opaque to the Mac and stable across sessions. `path` is `/`-separated, relative to the
root, never absolute, and may not contain a `..` segment — the phone rejects one with `BAD_REQUEST`
rather than normalising it, because normalising an escape attempt and then serving the result is how
a path traversal is served politely.

**Why a root id rather than an absolute path.** Three reasons, and the third is the one that decides
it:

1. Under SAF there **is** no absolute path — a tree is a document URI, and inventing a POSIX-looking
   string for it would be a fiction the Mac then tries to navigate.
2. It makes the Mac's model of what it may touch explicit, so "you have not given me access to that
   folder" is a sentence the phone can say precisely instead of a generic denial.
3. It degrades the way rule 6 requires. With no grants at all, `fs.list` with no `rootId` returns
   the app-private root and an `unavailable` reason naming what to grant — not an empty list, which
   is indistinguishable from an empty phone.

**`fs.list` with no `rootId` enumerates the roots.** That is the discovery call; there is no separate
`fs.roots` type, because the inventory is fixed at twelve names and adding a thirteenth to answer a
question the existing one can answer is how namespaces bloat.

```json
fs.list  — request   {}
         — ack
{"roots":[
  {"rootId":"app:files","label":"ConnectSuite","kind":"app","writable":true,
   "freeBytes":48192880640},
  {"rootId":"saf:primary%3ADCIM","label":"DCIM","kind":"tree","writable":true,
   "freeBytes":48192880640},
  {"rootId":"saf:primary%3ADocuments","label":"Documents","kind":"tree","writable":true,
   "freeBytes":48192880640}],
 "grantHint":"Add a folder in ConnectSuite > Files to browse more of this phone"}
```

`kind` is `app` | `tree` | `all`. What this build serves is `app` and `tree`; **`all` is reserved and
unused**, held open so that the upgrade path recorded in §1 would be one more root rather than a
protocol change. A Mac must handle a `kind` it does not recognise by showing the root with its label
and no special treatment, not by discarding it.

`grantHint` is present only when more could be granted, and is a sentence for a person — it is not
parsed, the same rule the capability `unavailable` strings carry. Under SAF it is almost always
present, because there is always another folder that has not been granted; that is the honest state
of this design rather than a defect in it.

---

## 3. `fs.list`, `fs.stat`, `fs.mkdir`, `fs.delete`

### `fs.list` — request

```json
{"rootId":"saf:primary%3ADCIM","path":"Camera","limit":200,
 "afterName":"IMG_2041.jpg","afterId":"msf%3A1000012345"}
```

### `fs.list` — ack

```json
{"rootId":"saf:primary%3ADCIM","path":"Camera","hasMore":true,
 "entries":[
   {"id":"msf%3A1000012345","name":"IMG_2041.jpg","dir":false,
    "size":3874112,"mtimeMs":1756298000000,"mime":"image/jpeg"},
   {"id":"msf%3A1000012399","name":"com.whatsapp","dir":true,
    "size":0,"mtimeMs":1756100000000,"mime":"inode/directory",
    "displayName":"WhatsApp","packageName":"com.whatsapp"}]}
```

**`name` is always the real path component** and is what the Mac sends back to navigate. Where a
component is a package id, `displayName` and `packageName` are added beside it — see
[§6](#6-the-package-id-rule-written-into-the-wire). Prettifying `name` itself would break navigation,
which is the whole reason the path is data and only the label is a sentence.

**`id` is the phone's stable handle** for the entry — a SAF document id, or a `MediaStore` `_ID`.
It is what `fs.stat`, `fs.delete` and `fs.transfer.begin` name, so a rename between two calls
produces a `NOT_FOUND` instead of acting on a different file with the same name.

### Paging, and the two rules it inherits

**Ordering is `dir` descending (folders first), then `name` ascending compared byte-wise, then `id`
ascending byte-wise.** The cursor is the `(afterName, afterId)` pair from the last entry received.

This is the **same total-ordering discipline the `beforeId` decision took** for `sms.threads`,
`sms.messages` and `call.log` (`docs/phase-5-proposals.md` §1), for the same reason: a cursor on one
field alone cannot advance *inside* a group that shares that field's value, and duplicate filenames
across a merged view make that group non-empty. The tiebreaker is not required to be meaningful,
only total, deterministic, and agreed by both sides.

**`limit` is capped at 500 and defaults to 200.** This is not arbitrary and it is the first thing the
frame caps bought us: an `fs.list` ack is a control frame, `MAX_CONTROL_FRAME` is 16 MB, and an entry
is roughly 150–250 bytes of JSON. An uncapped listing of a 100,000-file directory builds a frame the
far side is obliged to refuse — and a refused frame closes the socket, so the symptom would be *"this
folder disconnects the app"*. A cap of 500 keeps the largest legal ack near 125 KB.

**Two preconditions on ever recording this pager as working**, both carried over from defect 50 and
neither optional:

- **It is recorded on consecutive pages, counted, on hardware** — not on its control rendering and
  not on its first page returning rows. `sms.threads` owes its record as `50 → 89 → 126 → 158 → 183`,
  every entry distinct, and this pager owes the same shape.
- **The cursor is verified through the client the app uses.** `SmsStore.threads` paged with a bound
  `?` against a provider that answers bound arguments with an empty cursor, while the same query with
  an inlined literal in `adb shell content query` returned 2990 rows. A hand probe is not the
  tiebreaker, it is the second suspect. And the first reading to take is the one whose correct answer
  is *everything*: a cursor above the newest entry must return every entry, and a wrong value cannot
  return zero — only a selection that never ran can.

### `fs.stat`

```json
request  {"rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345"}
ack      {"id":"msf%3A1000012345","name":"IMG_2041.jpg","dir":false,"size":3874112,
          "mtimeMs":1756298000000,"mime":"image/jpeg","sha256":null}
```

`sha256` is `null` unless the phone already holds one; it is **never** computed on demand, because
digesting a 4 GB video to answer a stat call would block the control channel for a minute with no
progress reporting. The digest is computed streaming during a transfer, which is where it belongs.

### `fs.mkdir`

```json
request  {"rootId":"saf:primary%3ADCIM","path":"Camera","name":"trip"}
ack      {"id":"msf%3A1000012500","path":"Camera/trip"}
```

Creates one directory, not a chain. `name` may not contain `/`.

### `fs.delete` — and it is compare-and-delete, on purpose

```json
request  {"rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345",
          "expectSize":3874112,"expectMtimeMs":1756298000000}
ack      {"deleted":1}
```

**`expectSize` and `expectMtimeMs` are required, and a mismatch refuses the delete** with
`STALE_TARGET`. They are the facts the Mac last saw in `fs.list`; the phone holds the truth and
checks them at the moment of acting.

This is the same shape as the SMS recipient rule — *both facts named, verified on the side that holds
the truth, nothing sent on a mismatch* — which `docs/protocol.md` calls the one guard in this project
against an unrecoverable error. It is also the gate rule from `CLAUDE.md` applied before the fact
rather than after an accident: **the predicate that decides whether to act is evaluated at the moment
of acting**, not read into a variable and then ignored. A delete on someone's phone, issued from a
list that re-renders under the pointer, is precisely the class of action that rule was written for —
and the coordinate-click that opened a share sheet, and the watcher that hung up a live call, were
both cheaper mistakes than this one would be.

`deleted` is a count so that a future recursive delete has somewhere to report; for now it is always
`0` or `1`. **Directory deletion is not specified here** — see [§8](#8-what-this-leaves-open-deliberately).

---

## 4. The transfer

Bytes move on the **bulk channel** (42503) and nothing else changes about it. The control channel
carries the handshake, the progress and the outcome, which is the separation the protocol already
documents and v1 got right.

### `fs.transfer.begin` — request

```json
{"direction":"pull","rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345"}
```

```json
{"direction":"push","rootId":"saf:primary%3ADCIM","path":"Camera/trip",
 "name":"holiday.mov","size":214748364,"mtimeMs":1756290000000,
 "sha256":"6f3b…","overwrite":false}
```

`direction` is from the **Mac's** point of view, which is the only viewpoint that does not need a
sentence to disambiguate it: `pull` moves phone → Mac, `push` moves Mac → phone.

### `fs.transfer.begin` — ack

```json
{"transferId":"t-8f21","direction":"pull","size":3874112,"mtimeMs":1756298000000,
 "sha256":"6f3b…","offset":1048576,"chunkMax":262144}
```

- **`offset` is the resume point**, and it is decided by the **receiver**, which is the side that
  knows what it already holds. For a `pull` the Mac sends the offset it wants in the bulk header; for
  a `push` the phone returns the offset it already has here. This is v1's `resumeOffsets`, reduced to
  one file, which is all one bulk connection ever carries.
- **`chunkMax` is the largest chunk the sender may frame**, and it is `min(ChunkSizes.MAX, whatever
  the peer will accept)` — 256 KB today. It is on the wire rather than assumed so that a future
  change is a negotiation instead of a version break.
- `sha256` may be `null` when the sender chose not to pre-hash, exactly as `TransferFileMeta` allows
  today. A null digest means the transfer is **not verified**, and `fs.transfer.done` says so rather
  than reporting a pass.

**One `transferId`, one file, one bulk connection.** v1 offered a whole job of many files over one
link and interleaved them with everything else; v2 has a dedicated socket precisely so a 2 GB video
cannot stall a `ping`, and a multi-file job is *n* of these driven by the Mac. A folder copy is the
Mac's loop, not a protocol feature.

### The bulk header — one correction to the documented shape

The documented header is
`{"transferId","direction","path","size","mtime","sha256","offset"}`. Two changes:

- **`path` becomes `transferId` only.** Everything else was already agreed on the control channel;
  repeating the path here is a second copy of the same fact, and the two can disagree. The header
  becomes `{"transferId":"t-8f21","offset":1048576}` — small, which is what makes the 64 KB header
  cap comfortable rather than tight.
- **`mtime` is renamed `mtimeMs`** to match every other timestamp in this protocol. It is an
  unshipped field on an unserved channel, so this costs nothing now and costs a compatibility note
  later.

**A header longer than 64 KB closes the socket, and so does a chunk longer than 1 MB** — the caps
that landed in slice 1. Nothing in `fs.*` re-checks a length; the framing layer is the only place a
length is judged.

### `fs.transfer.progress` — event, phone → Mac

```json
{"transferId":"t-8f21","bytes":52428800,"total":214748364,"bytesPerSecond":11534336}
```

**Throttled, not per chunk** — v1's `shouldReport()` had this right. Proposed: at most one every
250 ms, plus one final one at completion, so a progress bar is smooth and the control channel is not
carrying 800 events for a 200 MB file.

The Mac derives fraction and ETA itself. It is not sent, because a fraction with no bytes beside it
is a number with nothing to check it against, and the ETA is a guess the drawing side is better
placed to smooth.

### `fs.transfer.done` — event

```json
{"transferId":"t-8f21","ok":true,"bytes":214748364,"elapsedMs":18400,
 "verified":true,"sha256":"6f3b…"}
```

```json
{"transferId":"t-8f21","ok":false,"code":"CHECKSUM_MISMATCH",
 "message":"holiday.mov arrived with a different checksum, so the partial file was deleted",
 "bytes":214748364,"elapsedMs":18400,"verified":false}
```

**`verified` is a separate field from `ok` and this is deliberate.** A transfer that completed with
no digest to compare against is a *success that was not verified*, and collapsing it into `ok: true`
means the one case worth knowing about looks identical to the one that was checked. This is the
counter rule in a boolean: a pass with no denominator is not evidence.

**On a checksum mismatch the partial is deleted.** v1's comment is the reasoning and it should be
carried over verbatim in spirit: *a corrupt file is worse than a missing one — drop the partial so a
retry is clean.* Note the one thing that is easy to get wrong and that v1 got right: when resuming,
the digest must be computed over the **skipped** region too, or every resumed transfer reports a
checksum failure on a perfectly good file.

### What is left on disk, and how to tell the two failures apart by looking

**Decided 2026-08-31: an interrupted transfer and a corrupt one must be distinguishable in the
directory itself, without consulting a log.** They are opposite states that both amount to "something
went wrong with a file" and they want opposite responses — one resumes, one retries from zero — so a
person or a script looking at the folder has to be able to tell which happened.

Three states, three appearances, on **both** sides since transfers go both ways:

| State | On disk | Means |
|---|---|---|
| In flight, or interrupted | `holiday.mov.part` | Bytes are good as far as they go. **Resumable** — the next `fs.transfer.begin` for this file offers its length as `offset`. |
| Verified complete | `holiday.mov` | Done. Any stale `.part` and any stale `.failed` sidecar for this name are removed as part of the rename. |
| Checksum mismatch | `holiday.mov.failed`, and **no** `.part` | The bytes were wrong and have been deleted. **Retry from zero**, not resume. |

**`.part` presence alone is the resumable signal**, which is why nothing else may ever be left with
that suffix. A `.part` file is a promise that its bytes are good.

**The mismatch case is a sidecar, not a rename, and that is the whole point of the design.**
Renaming the bad partial to `holiday.mov.corrupt` would be simpler and is wrong: it keeps the corrupt
bytes, which is precisely what *a corrupt file is worse than a missing one* forbids, and it leaves
something that can be renamed back by a hopeful user. The sidecar carries the **fact** without
carrying the bytes. It is a small text file, human-readable when opened, holding what happened, when,
the expected digest and the one that arrived:

```
ConnectSuite transfer failed — checksum mismatch
file      holiday.mov
when      2026-08-31T18:22:04.117+05:30
size      214748364 bytes received
expected  6f3b9c1a…
actual    b81e04d7…
The partial file was deleted because the bytes that arrived were wrong.
A retry starts from zero; there is nothing here to resume.
```

Two consequences worth stating rather than meeting later:

- **A `.failed` sidecar is cleared by the next successful transfer of the same name**, at the same
  moment the `.part` is renamed. Otherwise a folder accumulates gravestones for files that are now
  fine, which is its own kind of misleading directory.
- **`fs.list` returns both `.part` and `.failed` entries like any other file** rather than hiding
  them. Hiding them would put the Mac's rendering and the phone's directory into disagreement about
  what is there, and the pane is better off drawing them as what they are. This also means the
  convention survives a Mac that has never heard of it.

**Partials are never visible at their final name.** The receiver writes `name.part` and renames only
after the digest verdict. Without that, "a corrupt file is worse than a missing one" is enforced for
the checksum case and quietly broken for every interruption.

### `fs.transfer.cancel` — request, either side

```json
request  {"transferId":"t-8f21","reason":"user"}
ack      {"transferId":"t-8f21","stopped":true}
```

The partial is **kept** as `name.part`, and the next `fs.transfer.begin` for the same file resumes
from it. That is the opposite policy from a checksum mismatch, and the difference is the point: an
interrupted partial is a resumable artifact, a checksum-failed partial is corrupt. Two states that
both look like "half a file on disk" and want opposite treatment — which is why they are given
different appearances on disk rather than being told apart by inference.

### What happens when the control session dies — **open question 2, answered**

**Proposed: the transfer dies with the session, the bulk socket is closed immediately, and the
partial is kept for resume.**

- **It dies rather than continuing.** `sessionEndedSink` already exists for exactly this, added in
  Phase 2 when the mirror kept a live `MediaProjection` with no consumer — *"capture with no consumer,
  which is a privacy defect and not merely a leak"*. A transfer with no consumer is the smaller
  version of the same shape: nobody is receiving progress, nobody can cancel it, and on a `pull` the
  phone would be reading the user's files for a peer that is gone.
- **The socket is closed at once, not left to time out.** A bulk socket authorised by a token whose
  session has ended is a socket with no authorisation behind it. The token dies with its control
  connection — the protocol already says so — and this makes that statement operational.
- **The partial is kept**, as `name.part`. It is the interruption case, not the corruption case, and
  the directory says so without anyone having to open a log.
- **`fs.transfer.done` is not emitted**, because there is no session to emit it on. The Mac learns
  from the disconnect and shows the transfer as interrupted; it must not show it as failed, and it
  must not show it as complete.

The alternative — letting a transfer outlive its session and re-attach — was considered and is
rejected: it needs transfer state that outlives authentication, which is a security question, to buy
a resume that `offset` already provides for free.

---

## 5. Media

Capability `photos`, gated on `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` (API 33+), falling back to
`READ_EXTERNAL_STORAGE` below that. Errors report `feature: "photos"`, not `"media"` — the mapping
already in `FeatureOf`.

**`media.*` is `MediaStore`-backed and has none of §1's problems.** Media is exactly the surface the
platform still serves by query, which is why the photo browser is buildable while the file browser
needs a grant.

### `media.buckets`

```json
request  {}
ack
{"buckets":[
  {"bucketId":"-1739773001","bucketName":"Camera","count":2841,
   "newestMs":1756298000000,"coverId":"1000012345"},
  {"bucketId":"1284712009","bucketName":"WhatsApp Images","count":612,
   "newestMs":1756100000000,"coverId":"1000009912",
   "appName":"WhatsApp","packageName":"com.whatsapp"}]}
```

`bucketId` is the handle, `bucketName` is what a person reads. Where the bucket's path carries a
package segment — `Android/media/com.whatsapp/WhatsApp Images` — `appName` and `packageName` are sent
beside it, resolved through `AppLabels.of`.

### `media.list`

```json
request  {"bucketId":"-1739773001","limit":200,
          "before":1756298000000,"beforeId":"1000012345"}
ack
{"bucketId":"-1739773001","hasMore":true,
 "items":[
  {"id":"1000012345","kind":"image","mime":"image/jpeg","size":3874112,
   "width":4032,"height":3024,"dateMs":1756298000000,"durationMs":null,
   "ownerPackage":"com.whatsapp","ownerAppName":"WhatsApp"}]}
```

**`before` + `beforeId`, ordering `dateMs` descending then `id` descending byte-wise** — the cursor
decided in `docs/phase-5-proposals.md` §1, unchanged, and this is the first pager built *after* that
decision rather than retrofitted into one.

It is also the pager that needs it most. `MediaStore.DATE_ADDED` is in **seconds**, so a bulk import
or a burst of camera frames puts hundreds of rows on one value — the collision is certain, not
unlucky, exactly as it is for MMS. A millisecond cursor cannot advance inside that group at all.

The same two preconditions from §3 apply: consecutive pages counted on hardware, and the cursor
verified through the client the app actually uses.

### `media.thumb`

```json
request  {"ids":["1000012345","1000012399"],"maxEdge":256}
ack
{"thumbs":[
  {"id":"1000012345","mime":"image/jpeg","width":256,"height":192,
   "data":"/9j/4AAQSkZJRgABAQ…"},
  {"id":"1000012399","error":"NOT_FOUND"}]}
```

**Base64 on the control channel, batched, and bounded.** The reasoning, since this is the one place
this spec puts bytes on the control channel:

- A photo grid needs hundreds of thumbnails within a second of the pane opening. Opening a bulk
  socket per tile is absurd, and a bulk socket for the batch means a second transfer state machine
  serving something that is not a transfer.
- A thumbnail is small **by construction**: a 256 px JPEG is 10–25 KB, about 33 KB base64. If one is
  not small, that is a bug in thumbnail generation, and it should be visible as one.
- **`ids` is capped at 32 per request.** 32 × 33 KB ≈ 1 MB, comfortably inside `MAX_CONTROL_FRAME`'s
  16 MB. The cap exists to bound head-of-line blocking on the channel that also carries `ping`, which
  is the reason locked decision #5 gave side channels their own sockets in the first place.
- **`maxEdge` is capped at 512.** Above that it is not a thumbnail, it is a preview, and it belongs
  on the bulk channel like the original.

**A per-item `error` rather than a failed ack.** One deleted photo in a batch of 32 must not lose the
other 31. The error strings here are the same codes used elsewhere, per item.

### `media.original`

```json
request  {"id":"1000012345"}
ack      {"transferId":"t-9c04","size":3874112,"mime":"image/jpeg",
          "name":"IMG_2041.jpg","sha256":null}
```

**`media.original` is not a fifth transfer mechanism.** It resolves a media id to a transfer and hands
back a `transferId` that then runs on the bulk channel exactly as `fs.transfer.begin` does —
`fs.transfer.progress` and `fs.transfer.done` report it, `fs.transfer.cancel` cancels it. The only
thing it does that `fs.*` cannot is address a `MediaStore` id, which is the whole reason it exists as
a separate type.

Deliberately not `fs.transfer.begin` with a media id: that would give `begin` two mutually exclusive
addressing modes and an error table that has to explain which fields go together. One type, one
addressing mode, one shared execution.

---

## 6. The package-id rule, written into the wire

`docs/phase-5-proposals.md` §4 and `CLAUDE.md` both carry the rule. This is it as protocol text,
proposed for `docs/protocol.md` so that `fs.*` and `media.*` cannot reintroduce defect 33 by
omission:

> **A package id may appear on the wire only as a machine handle, never as the only thing a user
> will read.** Any payload carrying a package name carries a resolved label beside it, and any
> human-readable `message` mentioning an app names the app, not the package.

Where it binds in these twelve, exhaustively — because defect 28 was believed to be two copies and
was three, and the third was found only by enumerating:

| Payload | Handle | Label beside it |
|---|---|---|
| `fs.list` entry whose `name` is a package | `packageName` | `displayName` |
| `media.buckets` bucket in an app-owned directory | `packageName` | `appName` |
| `media.list` item | `ownerPackage` (`OWNER_PACKAGE_NAME`) | `ownerAppName` |
| `fs.transfer.done` / any `error` `message` naming an app | — | the label, in the sentence |

`remote.state` already obeys this (`package` **and** `appName`) and so does the notification relay.
Resolution goes through `AppLabels.of` (`sync-module/.../sync/v2/AppLabels.kt` — not `core/`, which
is where it gets looked for first) **always, including when it fails**: the package name is its
honest fallback for a package with no launcher icon, and the point is that the fallback is *reached
through* `AppLabels` and therefore counted, rather than a raw id being interpolated somewhere that
never asks.

**`name` and `path` are never prettified.** They are what the Mac sends back to navigate. A path
component is data; only the label is a sentence.

---

## 7. Errors

`FeatureOf` already maps `fs` → `files` and `media` → `photos`, so the `feature` field is correct
today with no change.

| Cause | `code` | Feature |
|---|---|---|
| Storage grant missing, or media read permission missing | `PERMISSION_DENIED` | both |
| The path is outside every root the phone has been granted | `ROOT_NOT_GRANTED` | `files` |
| File, directory, bucket or media id no longer exists | `NOT_FOUND` | both |
| `expectSize`/`expectMtimeMs` disagree with the file on disk | `STALE_TARGET` | `files` |
| The receiver has no room for the file | `NO_SPACE` | both |
| Digest mismatch on arrival; the partial was deleted | `CHECKSUM_MISMATCH` | both |
| The socket dropped, the read failed, the write failed | `TRANSFER_FAILED` | both |
| A `..` segment, `limit` out of range, `ids` over 32, `maxEdge` over 512, missing required field | `BAD_REQUEST` | both |
| The build serves no bulk channel yet | `FEATURE_UNAVAILABLE` | both |

**Four new codes are proposed, and each is justified only by the Mac reacting differently.** The
protocol already sets that bar — it is why `GEOMETRY_STALE`, `NO_EDITABLE_FOCUS` and `UNSUPPORTED_KEY`
are separate codes rather than three sentences under `FEATURE_UNAVAILABLE`:

- **`ROOT_NOT_GRANTED` is not `PERMISSION_DENIED`.** `PERMISSION_DENIED` greys out the pane, which is
  right when the capability has no grant at all and **wrong** here: the feature works, the user has
  granted two folders, and they asked about a third. The response is a "add this folder" affordance,
  not a dead pane.
- **`STALE_TARGET` is not `NOT_FOUND`.** The file is there; it is not the file the Mac was looking at.
  The response is refresh-and-ask-again, and it is the one error in this namespace that reports a
  **prevented harm** rather than a refused convenience — the same standing `RECIPIENT_MISMATCH` has in
  SMS, and it should be rare enough that any occurrence is worth investigating.
- **`NO_SPACE` is not `TRANSFER_FAILED`.** Retrying fixes a `TRANSFER_FAILED` and cannot fix this one.
  Only the user can, and they need to be told which side is full.
- **`CHECKSUM_MISMATCH` is not `TRANSFER_FAILED` either**, for the opposite reason: retrying *is*
  worth it, and the partial has already been deleted so a retry is clean. It also says something a
  generic failure does not — the bytes moved and were wrong, which is a different fault from bytes
  that never moved.

**Weighed and rejected: folding all four into `TRANSFER_FAILED` with different `message` strings.**
Reason strings are explicitly not a stable API in this protocol — *do not switch on them, do not
parse them* — so a Mac that must react differently has nothing to switch on. The cost of a new code
is one row in a table; the cost of a missing one is a Mac that greys out a working pane.

---

## 8. What this leaves open, deliberately

1. **Recursive and directory delete.** `fs.delete` here removes one file. A recursive delete on
   someone's phone from a Mac needs a confirmation design, not just a payload, and compare-and-delete
   does not obviously generalise to a tree. `deleted` is a count so the shape survives the addition.
2. **Watching for changes.** There is no `fs.changed` event; a Mac re-lists. `media.*` has the same
   gap and it is more felt there — a photo taken while the pane is open does not appear. Both want a
   `ContentObserver` and the `sms.sent` design is the worked example of doing that correctly,
   including the bounded retry and the refusal to emit a partial shape. Out of scope here because it
   is a second mechanism, not a payload.
3. **Clipboard.** `clip.push`, `clip.request` and `clip.history` are Phase 5 and are **not** specified
   here. They share none of this machinery and they have their own platform wall — background
   clipboard reads need the accessibility service or default-IME status.
4. ~~**Whether to ask for `MANAGE_EXTERNAL_STORAGE` at all.**~~ **Decided 2026-08-31: no**, and the
   restriction it would have lifted is now **observed on hardware** rather than assumed — see the
   end of §1. SAF trees only; the special access is recorded as an upgrade path with its trade-off
   and is not built. What remains genuinely open is smaller: the **onboarding copy** for a Files pane
   whose first screen is a list of granted folders rather than a filesystem, and which has to say
   plainly that files sitting directly in `Download/` cannot be reached.
5. **Multi-file jobs as a protocol concept.** A folder copy is the Mac's loop over *n* transfers.
   If that turns out to be too chatty over a real link, a job wrapper is an addition, not a rewrite.

## One thing this does fix on the way past

`docs/protocol.md` says the bulk channel carries **"raw chunks of 256 KB"** while the design calls for
adaptive sizing between 64 KB and 256 KB. That is open question 4 in `docs/RESUME.md`, and it is a
contract violation on the first slow link. Under this spec the sentence becomes *chunks of **up to**
`chunkMax` bytes, where `chunkMax` is negotiated in the `fs.transfer.begin` ack and is 256 KB today* —
so the adaptive behaviour is inside the contract rather than against it, and the number stops being a
constant two files have to agree about silently.
