# Feature A — Android Sharesheet → Sidekick → Mac (proposal, rev 2)

> **Status: proposal only. Nothing here is implemented, and `docs/protocol.md` is unchanged.**
> Rev 1 was written 2026-09-23 from the tree at `ea82319`. It supersedes the sketch in
> `docs/sidekick-feature-pass.md` §A, which proposed batching, auto-accept and resume; all three are
> cut from v1 below.
>
> **Rev 2 (2026-09-23, evening) replaces the architecture, because §4's experiment refuted it.** Rev 1
> let the Share-receiving activity finish and had `LinkService` read the shared `content://` URI later.
> On the emulator, a read from the same process — with the foreground `LinkService` running in it —
> failed with `SecurityException` at +1 s, +30 s and +120 s after the activity was destroyed, for both
> source apps tested, while the control read inside the activity succeeded. **That design is
> rejected.** In rev 2 the activity copies the file into private staging before it can finish, and only
> the staged copy is ever sent (§5). The instrument is commit `a79efa1`; the readings are §4 and
> `docs/testing.md` → *Feature A — URI grant lifetime, emulator*.
>
> **The readings are from a Pixel 10 emulator only.** They must be repeated on the SM-S938B before
> release validation (§4).
>
> **Still not authorised by this revision:** implementing Feature A, any build or install, any change
> to `docs/protocol.md` or protocol code, and anything on the Samsung.

## 0 · What the code allows today (read from the tree, not recalled)

| Fact | Where | Consequence |
|---|---|---|
| **Every transfer is started by the Mac.** The phone serves `fs.transfer.begin` and `media.original` and has no phone → Mac request/response. It sends only events | `ControlSession.kt`, `desktop/src/main/link.ts` (the Mac has no code that acks a phone request) | The phone's opening message must be an **event**. Every answer goes Mac → phone as a **request**, which is the direction that already works |
| `BulkTransfers.Pending.open` is a supplier `() -> InputStream?` | `sync-module/.../v2/BulkTransfers.kt` | The **staged file** (§5) can use the existing pull path unchanged: the bulk header, the 256 KB chunks, the whole-file digest, `fs.transfer.progress` and `fs.transfer.done`. The supplier opens the private staged copy, **never** the shared `content://` URI (§4) |
| The Mac's `bulk.pull` needs `expectedBytes` and fails when `received !== expectedBytes` | `desktop/src/main/bulk.ts` | **The size must be known before the offer.** On the Files path it is the only witness to a truncated stream above the 64 MB pre-hash ceiling; for a share it is the staged copy's exact length, and the digest is always present too (§5) |
| A pull writes to `name.part`, renames only after the length and digest verdicts, writes `name.failed` on a mismatch, and `freeName` picks `name (2).ext` | `bulk.ts`, `files.ts` | Nothing is overwritten and partial files never appear at the final name. **v1 reuses this as it is** |
| The Mac's `link.on('message')` handles events with a chain of `if` checks on type and **silently ignores** types it does not know | `desktop/src/main/main.ts` | A phone that sent an offer to an old Mac would wait forever. **An offer must never go to a peer that has not advertised support for it** (§2) |
| Both `hello` parsers read payload fields by key, and the envelope `Json` has `ignoreUnknownKeys = true`. The Mac reads `hello.ack` fields with `?? []` defaults | `ControlSession.kt`, `Messages.kt`, `link.ts` | An **added optional field** is invisible to an old peer. That is the only hello change proposed (§2) |
| The Mac makes no assertion that the capability set is complete. An unknown capability name greys nothing out | `desktop/src/main` (searched for a set assertion; none found) | A new capability name is harmless to an old Mac |
| `SendSelectionActivity` owns `SEND` `text/plain` and turns it into `clip.push` | `app/src/main/AndroidManifest.xml`, `SendSelectionActivity.kt` | **Unchanged in v1.** The new activity must not claim plain text (§6) |

## 1 · v1 scope

**In:** one file, shared through `ACTION_SEND` with `EXTRA_STREAM`, from any app, to the one paired
Mac on the current session. The Mac **asks**, and nothing moves before Accept.

**Out of v1, each for a later proposal:**

| Deferred | Why it is not in v1 |
|---|---|
| `ACTION_SEND_MULTIPLE`, batches, partial-batch states, batch resume | Each adds states to both UIs. v1 proves the single-file path end to end first |
| Automatic acceptance (and any setting for it) | Ask by default was decided. With no setting, there is only one consent path to test |
| macOS notifications | The Mac posts none today. The first one is a separate decision (`docs/phase-7-state.md` §5) |
| Transfer resume | An interrupted transfer is **retried from byte 0**, from the staged copy, while the Retry window is open (§5). The existing `.part` / `.failed` safety is preserved exactly |
| Re-offering across a reconnect | An offer dies with the session it was sent on (§5) |

**Never, in any version:** a new port, a listener, a cloud service, a relay, a public discovery
path, or a silent overwrite.

## 2 · Capability negotiation (versioned)

### The field

Both handshake messages gain one **optional** field, `ext`: an object mapping an extension name to
the highest version of it that this peer implements.

```json
hello      {"protocolVersion":1,"appVersion":"…","deviceName":"…","fingerprint":"…",
            "ext":{"share.file":1}}
hello.ack  {… every existing field unchanged …, "ext":{"share.file":1}}
```

`hello` means the Mac can **receive** a single-file share offer, version 1. `hello.ack` means the
phone can **send** one.

### Parsing rules (both sides, normative)

1. `ext` absent, `null`, or not a JSON object → treated as `{}`. **This is not an error.**
2. A key the peer does not recognise → ignored.
3. A value that is not an integer ≥ 1 → that key is treated as absent. The rest of `ext` is still
   read.
4. The negotiated version of an extension is `min(mine, theirs)`, and it exists only when **both**
   sides advertise it. v1 has one version, so this reads "both advertise `share.file` ≥ 1".
5. The result is fixed for the life of the session and is **not** renegotiated by
   `capabilities.changed`. A new session renegotiates.
6. `protocolVersion` keeps its meaning. `ext` never changes the major version, and a major mismatch
   is still refused with `PROTOCOL_MISMATCH` before `ext` is read.

### Why a new field rather than `capabilities`

`capabilities` is the **phone's** statement of which of its features have their permissions. The
Mac never sends it, and it is recomputed and resent when permissions change. "This Mac can receive
an offer" is a fact about the Mac's build, fixed for the session. Putting it in the phone-owned list
would mean that list has two writers, which this repo has paid for before (defect 96).

### Old-peer behaviour

| Pair | What happens | Why it is safe |
|---|---|---|
| New phone, old Mac | The Mac's `hello` has no `ext`, so nothing is negotiated. The phone **sends no offer**, and the share sheet says *"Update Sidekick on your Mac to receive files from this phone."* | The phone never produces the event an old Mac would drop |
| Old phone, new Mac | The phone's `hello.ack` has no `ext`. The Mac never expects an offer and treats one as a protocol violation (below) | Nothing changes for the old phone |
| New, new | `share.file` = 1 | — |
| A future v2 phone, v1 Mac | The phone uses version `min(2, 1) = 1` | That is what rule 4 is for |

**A `share.offer` from a peer with no negotiated `share.file` is refused:** it is logged and
answered with `share.respond` `decline` and `reason: "not negotiated"`, never silently dropped. It is
also never acted on.

### Capability `share`

It is added to `capabilities` and `unavailable` like any other capability. It needs no permission
and needs the bulk channel. Its contract covers the requests `share.respond`, `share.saved` and
`share.cancel`. It gives the errors in this namespace a capability name (the namespace rule), so a
failed share never greys out the Files pane.

## 3 · Messages and payloads

The phone offers. The Mac asks the user. On Accept, the Mac pulls through the existing path and then
tells the phone the result.

### `share.offer` — event, phone → Mac

```json
{"offerId":"s-Q3v9aP0kT7mR2xW8yB4nZc","rootId":"share:s-Q3v9aP0kT7mR2xW8yB4nZc",
 "from":"Galaxy S25 Ultra",
 "item":{"itemId":"0","name":"IMG_2041.jpg","mime":"image/jpeg","size":3874112,"sha256":"97b1c8f2…"},
 "expiresAtMs":1790000600000}
```

- **`offerId`** is `s-` plus 22 base64url characters: 128 bits from `SecureRandom`, never reused.
- **`rootId`** is `share:<offerId>`. It is sent explicitly, so the Mac treats it as opaque like every
  other root, and it is never listed by `fs.list` with no `rootId`.
- **`item`** is a single object, not an array. v1 does not represent batches on the wire at all, so
  there is no half-built batch shape for a later version to inherit.
- **`size`** is required, never null, and ≥ 0. It is the **exact byte count of the staged copy**
  (§5), not a provider's claim.
- **`sha256`** is required and never null in rev 2: it is the digest computed while the staged copy
  was written, so every file is pre-hashed whatever its size. (Rev 1 allowed `null` above a 64 MB
  pre-hash ceiling; staging removes the reason for it.)
- **`name`** is the phone's **sanitised** display name (§5). The Mac re-sanitises regardless.
- **`expiresAtMs`** is when the phone will stop honouring the offer (§5).

**The Mac validates before showing anything.** It checks that `ext` was negotiated, that `offerId`
and `rootId` agree, that `size` is an integer ≥ 0, and that `name` and `mime` are strings. Anything
else is declined with `reason: "malformed offer"`.

### `share.respond` — request, Mac → phone

```json
request  {"offerId":"s-…","decision":"accept"}
request  {"offerId":"s-…","decision":"decline","reason":"user"}
ack      {"offerId":"s-…","state":"accepted"}          // or "declined"
error    NOT_FOUND  (feature "share") — unknown, expired or already answered
```

`reason` is one of `user`, `folder-unavailable`, `insufficient-space`, `not negotiated`,
`malformed offer` or `expired`. The phone turns each one into its own sentence and never shows the
code to the user. An offer is answered **once**: a second `share.respond` for the same `offerId`
gets `NOT_FOUND`.

### Bytes — the existing `fs.transfer.begin`, narrowed

```json
request  {"direction":"pull","rootId":"share:s-…","id":"0"}
ack      {"transferId":"t-…","direction":"pull","size":3874112,"name":"IMG_2041.jpg",
          "mime":"image/jpeg","sha256":"97b1…","offset":0,"chunkMax":262144,"mtimeMs":null}
```

`offset` is always `0` in v1, because there is no resume. The Mac sends `offset: 0` in the bulk
header, and the phone refuses a non-zero offset on a `share:` root by closing the socket with a
logged reason. `fs.transfer.progress`, `fs.transfer.done` and `fs.transfer.cancel` are unchanged.
Errors on a `share:` root carry `feature: "share"`.

### `share.saved` — request, Mac → phone

This is the Mac's verdict as the receiver. **The phone says "Saved" only after this arrives**, never
when it has finished writing bytes (the lesson of defects 56 and 133).

```json
request  {"offerId":"s-…","ok":true,"bytes":3874112,"verified":true,"savedAs":"IMG_2041 (2).jpg"}
request  {"offerId":"s-…","ok":false,"reason":"checksum"}   // or "truncated", "write-failed", "interrupted"
ack      {"offerId":"s-…"}
```

`savedAs` is the final **file name only**, never a Mac path. With `ok: false`, the offer stays valid
until it expires, and the Mac's **Retry** starts a fresh `fs.transfer.begin` from byte 0.

### `share.cancel` — either side

```json
phone → Mac, event    {"offerId":"s-…","reason":"user"|"expired"|"staging-lost"}
Mac → phone, request  {"offerId":"s-…","reason":"user"}
ack                   {"offerId":"s-…","stopped":true}
```

On a cancel from either side, the phone calls the existing `BulkTransfers.cancel` for any live
`transferId` on the offer's root, deletes the staged copy (§5), and the Mac deletes that offer's
`.part`. The offer is then gone, and in v1 no resume could use the partial anyway.

`staging-lost` replaces rev 1's `access-lost`: the phone no longer holds any access to the source
that could be lost after the offer. It means the staged copy is missing, the wrong length, or read
back with a different digest (§5), which is unrecoverable.

## 4 · URI grant lifetime — measured on the emulator; the rev 1 design is rejected

**The question:** after the activity that received `ACTION_SEND` is destroyed, can the same process
still open the shared `content://` URI while the foreground `LinkService` is running in it?

A grant attached to a share intent belongs to the receiving activity, and
`takePersistableUriPermission` works only for SAF documents. Documentation alone does not say how
long this grant lasts, and the repo's rule is to measure it.

### Instrument (commit `a79efa1`, debug source set only)

`ShareGrantProbeActivity` receives one `ACTION_SEND` (`image/png` or `application/octet-stream`) and
reads the whole stream inside the activity, before `finish()`, as the **control** (bytes and SHA-256).
From the same process it then reopens the same URI at **+1 s, +30 s and +120 s after `onDestroy`**,
recording at each reading whether the foreground `LinkService` was running in this process.
`ShareGrantRun` holds the rules: the control gates every reading, readings are timed from
destruction, a missing reading is `NO_READING` and never `FAIL`, and PASS requires a foreground
`LinkService` at every reading. Logged: the URI's authority, the case, the offset and elapsed time,
`ok`, the exception **class** (never its message, which names the URI), bytes and digest. Never the
URI, a path or a display name.

### Readings — Pixel 10 emulator, 2026-09-23

| Source app | Authority that answered | Control (in the activity) | +1 s | +30 s | +120 s |
|---|---|---|---|---|---|
| Google Photos | `com.google.android.apps.photos.contentprovider` | **read succeeded** | `SecurityException` | `SecurityException` | `SecurityException` |
| DocumentsUI | `com.android.externalstorage.documents` | **read succeeded** | `SecurityException` | `SecurityException` | `SecurityException` |

The foreground `LinkService` was running in the same process for the readings. The control
succeeding is what makes the failures a reading about the grant rather than about the instrument
or the file.

### Decision

The grant does not outlive the receiving activity on either source. **The rev 1 design — finish the
Share-receiving activity and read later from `LinkService` — is rejected.** Rev 1's decision rule
said *stop and report, choose no architecture*; the readings were reported, and the replacement in §5
was chosen by the owner afterwards, not pre-chosen here.

The staging design in §5 does not depend on how long a grant lasts: it reads the URI only while the
activity is alive, which is the condition under which both controls succeeded. It would be correct
even on a device where the grant does outlive the activity.

### Still owed: the Samsung repeat, before release validation

**This is Pixel 10 emulator evidence only.** The SM-S938B rows have not been run:

| Device | Source app | Stimulus | State |
|---|---|---|---|
| SM-S938B | Samsung Gallery (`com.sec.android.gallery3d`, a MediaStore URI) | one generated synthetic image | **not run** |
| SM-S938B | Samsung My Files (`com.sec.android.app.myfiles`, its own provider) | one generated synthetic file | **not run** |

They are repeated with the same instrument before release validation, recording the package that
answers each authority (`docs/single-device-audit.md`). The point of the repeat is not to reopen the
architecture: it is that *"the share grant dies with the activity"* is currently a one-device,
emulator-only sentence, and that the Samsung providers must pass the **control** — a read inside the
live activity — because staging depends on exactly that read. No synthetic media is placed on the
SM-S938B until that step is separately approved.

### The emulator's test files stay where they are

These were created on the emulator for §4 and are **left untouched** by this revision:

- `/sdcard/Pictures/SidekickShareTest/sidekick-share-test-image.png`
- `/sdcard/Documents/SidekickShareTest/sidekick-share-test-file.bin`

They are not deleted, and neither is `/sdcard/window.xml`, without asking first. When removal is
approved, media goes through MediaStore (never `rm`) and removal is checked by path and by MediaStore
row, each with a positive control. No existing personal media was or will be used as a stimulus.

## 5 · Behaviour

### The offer's lifecycle (one state machine, on the phone)

`staging → staged → offered → accepted → sending → saved | failed → (retry → sending) | expired | cancelled | declined`

plus `staging-failed` (no space, source unreadable, over the limit, or cancelled during the copy),
which is terminal and sends nothing to the Mac.

It will be written as a pure transition function (`ShareOffer.after(event, nowMillis)`) that
`LinkService` calls and a JVM test calls too. This is the defect-67 rule: the test reaches the
transition, not a hand-built state. **Every transition into a terminal state carries the instruction
to delete the staged copy**, so deletion is part of the transition the test reaches rather than a
side effect somewhere a test cannot see.

### Staging (rev 2 — replaces rev 1's "read the URI later")

1. **`ACTION_SEND`, one file only.** Anything else is refused on the phone (§6).
2. **The Share-receiving activity owns the granted URI.** Nothing else in the app is ever given it:
   not `LinkService`, not `savedInstanceState`, not anything that outlives the activity. (The
   activity-scoped `ViewModel` that carries the copy across a rotation is cleared with the activity.)
3. **Before the activity can finish, it copies the URI into a private staging file**, in one pass,
   computing as it goes:
   - the **exact byte size** — the count of bytes actually written, which becomes the offer's `size`
   - the **SHA-256** of those bytes, which becomes the offer's `sha256`
   - the **sanitised display name** (the rules below, applied on the phone too)
   - the **MIME type** (the rules below)

   The sheet shows *Preparing…* with a byte-count progress bar during the copy. **Send is disabled
   until the copy has completed and been closed.** Once it has, the activity drops its reference to
   the URI and may finish at any time; nothing afterwards touches the source.
4. **Nothing is ever uploaded from a URI after the activity is destroyed.** The pull supplier opens
   the staged file and nothing else. There is no fallback to the URI.
5. **Space is checked before the copy** (the preflight formula below). If it fails, the sheet shows
   *"Not enough space on this phone to prepare <N> — free up <M> and share again."* and **no offer is
   made**.
6. **Where the staged copy lives:** `cacheDir/share-staging/`, private app storage. **Never** public
   `Download`/`Pictures`, never `MediaStore`, never a cloud or backup location. (`cacheDir` is
   excluded from Auto Backup.)
7. **The Mac still asks before any byte moves.** Staging is local to the phone; the offer, Accept and
   Decline are exactly as in §3 and §7.
8. **`LinkService` streams only the staged file, and only after `share.respond accept`.**
9. **The staged copy is deleted** on decline, expiry, cancel (either side, any state), completion
   (`share.saved ok:true`), unrecoverable failure, and the end of the session the offer was made on.
10. **It is kept only for a visible Retry**, for a bounded time (the Retry window below).
11. **Not in v1:** transfer resume, batching, auto-accept, macOS notifications, silent overwrite.
12. **Logging:** never the content URI (not even with the authority, outside the debug probe), never
    file contents, **never the staging path**. The staged file is named by `offerId`, and lines carry
    `offerId`, byte counts and outcomes (§8).

#### Layout of the staging directory

```
cacheDir/share-staging/
  s-<22 base64url>.part   the copy in progress
  s-<22 base64url>.bin    the finished copy (renamed from .part after close, length and digest)
  s-<22 base64url>.json   marker: {"owner":"sidekick-share-staging","v":1,"offerId":"s-…",
                                   "createdAtMs":…, "size":…, "sha256":"…"}
```

The marker carries **no file name, no MIME type and no URI**. It exists only so a later sweep can
prove an entry is Sidekick's staging data before deleting it.

#### Preflight formula

Let:

- `A` = `cacheDir.usableSpace` at the moment of checking — bytes free **without** evicting anything.
  (`StorageManager.getAllocatableBytes` is deliberately not used: it counts other apps' clearable
  caches, and staging one share must not empty them.)
- `S` = the expected size: `OpenableColumns.SIZE`, else `openAssetFileDescriptor(uri,"r").length` if
  not `UNKNOWN_LENGTH`, else **unknown**.
- `M(S)` = the safety margin = `max(256 MiB, ⌈S / 10⌉)`.

**Proceed only if `S + M(S) ≤ A`.** When `S` is unknown, proceed only if `A > 256 MiB`, and copy
under the limit `L` below.

During the copy, `A` is re-read every 8 MiB written. If it falls below **256 MiB**, the copy stops,
the partial is deleted, and the sheet shows the space error. A provider that delivers **more** bytes
than `S` is not trusted over the count: the count wins, and the copy is still bounded by `L`.

#### The v1 size limit is derived, not declared

There is no fixed maximum. The largest file that may be staged is the largest `s` satisfying
`s + M(s) ≤ A`:

```
L(A) = A − 256 MiB        when A ≤ 2816 MiB   (the margin is its 256 MiB floor)
L(A) = ⌊A / 1.1⌋          when A > 2816 MiB   (the margin is 10% of the file)
L(A) = 0, refuse          when A ≤ 256 MiB
```

(The two branches meet at `A = 2816 MiB`, `L = 2560 MiB`.) `L` is computed at the start of the copy
and the copy aborts at byte `L + 1`. The sheet states the limit with the real number when it refuses:
*"This phone has room to prepare files up to <L> right now."* The Mac's own free-space check (below)
is independent and still applies.

#### Cancellation: copying versus sending

| When | Trigger | What happens | Message to the Mac |
|---|---|---|---|
| **Copying** (`staging`) | Cancel, Back, or the activity finishing | The copy coroutine is cancelled, the stream closed, the `.part` deleted. `staging-failed(cancelled)` | **none** — nothing was offered |
| **Staged, not yet sent** | Cancel on the sheet | Staged copy deleted | **none** |
| **Waiting for the Mac** (`offered`) | Cancel on the phone | `share.cancel{user}` event, staged copy deleted | `share.cancel` |
| **Waiting for the Mac** | Mac declines | staged copy deleted | — |
| **Sending** | Cancel on either side | `BulkTransfers.cancel`, the bulk stream closed, **then** the staged copy deleted; the Mac deletes its `.part` | `share.cancel` |
| **Failed, Retry visible** | Cancel on either side, or the window closing | staged copy deleted | `share.cancel` from the side that cancelled; `expired` when the window closes |

A configuration change (rotation) must not cancel a copy: the copy's job is held across
recreation by the activity's `ViewModel`, on the expectation that the same activity record still
holds the grant. **That the
grant survives recreation is unmeasured** and is a row in §9's staging matrix; if it fails there, the
copy is cancelled and the sheet says so rather than finishing silently.

#### Retry window — exact timeout and cleanup trigger

- **Offer expiry:** `expiresAtMs = offeredAt + 10 min`. It applies to `offered` and to `failed`. It
  does **not** cut a transfer in `sending`; the 30 s stall rule bounds that.
- **Retry window:** on entering `failed`, `retryUntil = min(failedAt + 5 min, expiresAtMs)`. If
  `failedAt ≥ expiresAtMs`, the offer goes straight to `expired` and there is no Retry.
- **Cleanup trigger:** `LinkService`'s coroutine scope schedules one `delay` to `retryUntil` on
  entering `failed`. When it fires, `ShareOffer.after(RetryWindowClosed)` → `expired`, the phone sends
  `share.cancel{expired}`, and the staged copy is deleted. A Retry cancels that timer; a Retry that
  fails starts a new window under the same `min(…, expiresAtMs)`, so no staged copy outlives
  `expiresAtMs` except while bytes are actively moving.
- The Mac's Retry button disappears on `share.cancel{expired}`, and a late Retry gets `NOT_FOUND`.

#### Process death and the startup sweep

Offers live in memory only, so **after a process death every staging entry is orphaned by
definition**. On the next process start (`Application.onCreate`, before `LinkService` accepts a
session), a sweep of `cacheDir/share-staging/` deletes an entry **only if all of these hold**:

- it is a regular file directly in that directory — not a symlink, and its canonical path is inside
  the canonical staging directory
- its name matches `^s-[A-Za-z0-9_-]{22}\.(part|bin|json)$`
- for `.bin`, a `.json` marker with the same `offerId` exists and carries
  `"owner":"sidekick-share-staging"`; a `.part` needs no marker (it is always an interrupted copy)
- for `.json`, it parses and carries that owner

Anything else in the directory is **left alone** and counted. The sweep logs one line:
`share staging sweep: deleted N (bytes B), left K unrecognised` — counts only, no names or paths. The
same sweep runs, restricted to entries older than 15 minutes with no live offer, whenever a new share
begins staging, as a backstop for a crash that the process survived.

v1 allows **one staging entry at a time**: a second share while one is live is refused with *"A file
is already being sent to <Mac> — wait for it or cancel it."* This is the no-batching rule, not a new
feature.

#### Integrity of the staged copy

The OS may evict `cacheDir` under storage pressure. So before **each** send attempt the phone checks
the staged file exists and its length equals `size`, and while streaming it compares the digest of
the bytes read against the staged `sha256`. A missing file, a wrong length, or a phone-side digest
mismatch is **unrecoverable**: the phone sends `share.cancel{staging-lost}`, deletes what is left, and
shows *"The prepared copy was lost on this phone — share the file again."* A **Mac-side** checksum
mismatch (`share.saved ok:false "checksum"`) is the ordinary retryable failure, because the staged
copy is still intact.

| Case | Behaviour |
|---|---|
| **Filename** | `OpenableColumns.DISPLAY_NAME`, then the URI's last path segment, then `Shared file <yyyy-MM-dd HHmmss>`. If there is no extension, one is added from the MIME type via `MimeTypeMap`. The phone then applies the same sanitiser as the Mac (next row), so the name it shows is the name it offers |
| **Mac-side name** | The Mac **re-sanitises and never trusts the phone's name**: normalise to NFC, drop control characters, replace `/` and `:` with `-`, replace a leading `.` with `_`, and cap at 255 UTF-8 bytes keeping the extension. An empty result becomes `Shared file` |
| **MIME** | `ContentResolver.getType(uri)`, then the intent's type if it is not a wildcard, then `application/octet-stream`. **Display only**: the Mac never chooses a handler from it |
| **Size** | The **byte count of the staged copy**, always. `OpenableColumns.SIZE` and the descriptor length are used only as the preflight's `S`. A source that cannot be read, or fails mid-copy, is refused on the phone: the `.part` is deleted, the sheet says *"Couldn't read this file from <app>"*, and no offer is sent |
| **Collision** | The existing `freeName` gives `name (2).ext`. **The final file is never overwritten**, and the card shows the name it will be saved as |
| **Offer timeout** | 10 minutes from the offer. The phone sends `share.cancel{expired}` and the Mac card changes to *Expired* with no buttons |
| **Stall** | 30 s with no bytes on the bulk socket fails the attempt with `share.saved{ok:false, reason:"interrupted"}`. The Mac offers **Retry** while the Retry window is open |
| **Cancel** | Either side, with `share.cancel` (§3). The Mac deletes the offer's `.part` |
| **Checksum** | Always verified (rev 2's `sha256` is never null). On a Mac-side mismatch: `.failed` is written, `share.saved{ok:false,"checksum"}` is sent, and Retry is offered from the staged copy. A phone-side mismatch is `staging-lost` (above) |
| **Retry** | A new `fs.transfer.begin` from byte 0 of the staged copy, while the Retry window is open. The old `.part` is deleted first; there is no appending in v1 |
| **Mac disconnects** | Before Accept: the offer dies with the session, the staged copy is deleted, and the phone shows *"<Mac> disconnected — share again when it is back."* During sending: the staged copy is deleted too, the Mac's `.part` stays (the existing convention) and no resume is attempted. The next share of the same file stages and starts fresh, and `freeName` means the earlier `.part` never blocks it |
| **Mac not connected at share time** | **Send** is disabled with *"<Mac> isn't connected — open Sidekick on your Mac."* Nothing is queued. Staging still runs so the file is ready if the Mac connects while the sheet is open; if the sheet is closed first, the staged copy is deleted |
| **Folder / space** | The Mac checks `ensureReceiveFolder()` and free space ≥ `size` **when the offer arrives, and again at Accept**. A failure declines with its reason before any bytes move |
| **Zero bytes** | Allowed. The staged copy is empty, the offer carries `size: 0` and the empty-input digest (`e3b0c442…b855`), and the Mac creates an empty file verified against it |
| **Refused on the phone before any offer** | A non-`content://` scheme (including `file://`), a directory MIME type, or no `EXTRA_STREAM` |

## 6 · Android: manifest and activity

A **new** `ShareToMacActivity`, **not built yet**:

```xml
<!-- share_to_mac_label = "Send to Mac" -->
<activity android:name=".ShareToMacActivity"
    android:exported="true" android:excludeFromRecents="true" android:taskAffinity=""
    android:label="@string/share_to_mac_label"
    android:theme="@style/Theme.Sidekick.ShareSheet">
  <intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="application/*" />
    <data android:mimeType="image/*" />
    <data android:mimeType="video/*" />
    <data android:mimeType="audio/*" />
    <data android:mimeType="font/*" />
    <data android:mimeType="model/*" />
  </intent-filter>
</activity>
```

- **No `SEND_MULTIPLE` filter in v1.**
- **No `text/*` and no `*/*`**, so a plain-text share never lists this activity and keeps going to
  `SendSelectionActivity` → `clip.push`, exactly as today. The trade-off, recorded rather than hidden:
  a **text file** (`text/plain`, `text/csv`) shared *with* a stream will not list "Send to Mac" in
  v1. A later proposal can add `text/*` once the activity can hand stream-less text back to the
  clipboard path without two Sidekick entries appearing.
- **Reading the URI:** `IntentCompat.getParcelableExtra(intent, EXTRA_STREAM, Uri::class.java)`,
  then `intent.clipData?.getItemAt(0)?.uri` as a fallback, since some senders attach the grant there.
  Anything with more than one `ClipData` item is refused with *"Send one file at a time for now."*
- The URI is never put in `savedInstanceState` and is never handed to `LinkService`. No storage
  permission and no new foreground-service type: `LinkService` is already foreground
  (`connectedDevice`).
- **The activity may finish only after staging has completed or been abandoned** (§5). Rev 1 left
  this open pending §4; §4 answered it.

## 7 · UI

### Phone (bottom sheet)

- A header reading **Send to <Mac name>**, then a thumbnail (images only, decoded locally and never
  sent), the **name**, the **exact size** (`3,874,112 bytes · 3.7 MB`), and *"Saved to your Mac's
  receive folder."*
- Buttons: **Send** and **Cancel**.
- States, in the repo's state vocabulary, one headline each:

| State | Headline |
|---|---|
| staging | *Preparing…*, with a progress bar of bytes copied; **Send** disabled |
| not enough space | *Not enough space on this phone* with the numbers (§5); no offer made |
| couldn't read | *Couldn't read this file from <app>*; no offer made |
| staging lost | *The prepared copy was lost on this phone — share the file again* |
| not connected | *<Mac> isn't connected* |
| Mac needs updating | *Update Sidekick on your Mac* |
| waiting | *Waiting for you to accept on <Mac>* |
| sending | a progress bar, `bytes of total` |
| saved | *Saved on <Mac> as <savedAs>*, only after `share.saved ok:true`. `verified: false` adds *"not checked against a checksum"* |
| failed | the reason, with *Retry from your Mac* and the time the Retry window closes |
| declined | the Mac's reason |
| expired | *Expired* |
| cancelled | *Stopped on your Mac* / *Cancelled* |

### Mac (Ask, always, in v1)

- An offer opens an **incoming-file card** above the current pane. It shows:
  - the **phone name** (`from`), which the Mac cross-checks against the session's paired device name
  - the **file name as it will be saved** (after sanitising and `freeName`)
  - the **MIME type**
  - the **exact size in bytes** as well as the human form
  - the **receive folder's full path**
- Two explicit buttons, **Accept** and **Decline**. **No bytes move before Accept.** There is no
  default button, and Return does not accept.
- While receiving, the **status island** shows *"Receiving <name> from <phone>"* (a transfer lasts
  over time, so it belongs in the island).
- The result is written to the **Activity pane** with a timestamp. The card ends in **Reveal in
  Finder** on success, **Retry** on failure while the offer is valid, or the refusal sentence.
- **No macOS notification** and no dock badge in v1.

## 8 · Security and trust boundary

- **Transport:** unchanged. The existing paired TLS 1.3 with pinned fingerprints, and bulk sockets
  authorised by the control session's token. There is no new port, listener, discovery path, cloud
  service or relay. The Mac still connects out.
- **Who may be offered to:** only a handshaken session with `share.file` negotiated. A share root is
  tied to **that session's token** and to its 128-bit `offerId`. A bulk header claiming the root's
  `transferId` from another session is refused, which is the existing `Pending.sessionId` rule.
  `forgetSession` drops the offer.
- **What a share root permits:** exactly **`fs.transfer.begin` with `direction: "pull"`, `id: "0"`,
  after `share.respond accept`, while the offer is valid**. Every other verb is refused with
  `NOT_FOUND`, `feature: "share"`: `fs.list`, `fs.stat`, `fs.thumb`, `fs.mkdir`, `fs.delete`, `push`,
  `media.*`, any other `id`, any begin before Accept or after expiry, and a non-zero bulk offset.
  **A refused verb is a tested case, one per verb.**
- **No silent overwrite:** partial files are only ever `.part`, a mismatch leaves `.failed`, and the
  final name comes from `freeName`.
- **Staging:** the staged copy is in private app storage (`cacheDir/share-staging/`), readable by
  no other app, excluded from backup, and deleted on every terminal state and on the startup sweep
  (§5). It is never written to shared storage or `MediaStore`.
- **Logging:**
  - never a content URI (the debug probe logs the authority; Feature A logs none)
  - never the staging path or a staged file name — lines name the `offerId`
  - never file contents
  - the file name only where the UI already shows it, and not in `LinkLog`. Log lines carry
    `offerId`, `transferId`, byte counts, the MIME type's top-level type and the outcome
  - `LinkLog` writes a rotating file, and the clipboard proposal's §6 rule applies: a handler written
    the way every other handler here is written would put names on disk
  - every failure line keeps a running `saved / failed` tally (the denominator rule)

## 9 · Test plan (synthetic files only)

**Stimuli:** only generated files (`share-synth-1k.txt`, `share-synth-0b.bin`, `share-synth-6mb.bin`,
`share-synth-70mb.bin`, `share-synth-3000x4000.png`), plus a debug-only `SyntheticShareProvider`
that serves generated bytes and can drop `SIZE` or `DISPLAY_NAME`, omit the MIME type, stall, or
fail mid-stream. **No personal media, ever.** No synthetic media is placed on the SM-S938B until that
step is approved (§4). The emulator's two §4 files stay in place (§4).

**Unit tests (each shown red against the defect it is named for):**

- the `ext` parsing rules 1–6, with a fixture for each malformed shape, an absent field, and
  `min()` negotiation
- `share.offer` validation: every reason for declining
- the phone's `ShareOffer.after` transitions, including answer-once, expiry, cancel from each
  state, the Retry window (`min(failedAt + 5 min, expiresAtMs)`), and **every terminal transition
  carrying the delete-staged instruction** — shown red with the instruction removed from one
- the preflight and limit functions: `M(S)`, `L(A)` at both branches and their meeting point
  (`A = 2816 MiB`), and `A ≤ 256 MiB`
- the sweep's ownership predicate: a planted symlink, a wrong-pattern name, a `.bin` without a
  marker and a marker with the wrong owner are all **kept**; only matching entries are deleted
- the Mac's name sanitiser and `freeName` interaction
- a share root refusing every verb but the one pull, **one test per refused verb**
- errors carrying `feature: "share"`
- `SendSelectionActivity` still owning `SEND` `text/plain` (a manifest test, so a later change
  cannot silently steal it)

**Staging matrix (emulator first; the SM-S938B only after the §4 repeat is approved). Every row also
asserts the staging directory's contents after the case, with a control that the listing can see a
known entry:**

| # | Case | Pass criterion | Control |
|---|---|---|---|
| S1 | Zero-byte file | staged `size: 0`, empty-input digest, offer sent, Mac saves an empty verified file, staging empty afterwards | a 1 KB run through the same path |
| S2 | 1 KB | staged length = 1,024, digest = source digest, saved and verified | the digest computed independently on the generated file |
| S3 | 6 MB | as S2 at 6 MB; progress reaches 100% before Send enables | Send observed disabled during staging |
| S4 | 70 MB | as S2 at 70 MB; staging's peak disk use ≤ size + one buffer | `A` read before and after |
| S5 | Insufficient storage | preflight refuses, sheet states `L` and the shortfall, **no offer** reaches the Mac, no `.part` left | a file under `L` in the same state stages |
| S6 | Source-read failure (`SyntheticShareProvider` fails mid-stream) | `.part` deleted, *Couldn't read…*, no offer | the same provider without the fault stages |
| S7 | Cancel during copy | copy stops, `.part` deleted, no offer, no `share.*` message on the Mac | the Mac's message log shows a normal offer for an uncancelled run |
| S8 | Cancel while waiting for the Mac | `share.cancel{user}`, Mac card leaves, staged copy deleted | the staged `.bin` observed present before the cancel |
| S9 | Decline | staged copy deleted, phone *Declined* | as S8 |
| S10 | Expiry (10 min unanswered) | `share.cancel{expired}`, staged copy deleted, late Accept → `NOT_FOUND` | the card rendered before expiry |
| S11 | Checksum mismatch, Mac side (`corruptIfArmed`) | `.failed` on the Mac, phone *failed* with Retry, staged copy **kept**; Retry from byte 0 verifies; after the Retry window with no Retry, staged copy deleted | the staged digest read before and after equals the offer's |
| S11b | Checksum/length mismatch, phone side (staged file altered in a debug build) | `share.cancel{staging-lost}`, staged copy deleted, *…lost on this phone* | an unaltered staged file sends cleanly |
| S12 | Mac disconnect — before Accept, and during sending | offer dies, staged copy deleted in both; Mac keeps its `.part` only in the second | bytes *received* on the Mac > 0 at the disconnect in the second |
| S13 | Cleanup after process death (process killed while staged and while sending — not with `am force-stop`, which the repo's hook refuses for this package) | on next start, the sweep deletes the Sidekick entries and logs the counts; an unrelated file planted in the directory is **left** | the directory listed before the restart shows the entries |
| S14 | Rotation during copy | the copy continues and completes, or is cancelled with a message; never finishes silently | an unrotated run of the same file |
| S15 | Log audit after S1–S14 | 0 content URIs, 0 staging paths, 0 synthetic file names in `link.log` | the same grep finds `offerId` and sweep-count lines |

**On hardware and the emulator, after the staging matrix (each with a control):**

| # | Case | Pass criterion | Control |
|---|---|---|---|
| 1 | One synthetic image, Accept | `share.saved ok verified=true`; SHA-256 on the Mac = source | the same hash computed on the phone side |
| 2 | Decline | no file, no `.part`, phone *Declined* | the receive folder listed before and after, with a known file present in both |
| 3 | Wait 10 min without answering | the card turns *Expired*, the phone *Expired*, a late Accept gets `NOT_FOUND` | the card was rendered before expiry (`probe.mjs` with `onScreen`) |
| 4 | The same file twice | the second is `(2)`, the first unchanged (hash) | the first file's hash before and after |
| 5 | 70 MB, cancel on the phone | the Mac deletes the `.part`, no final file, phone staged copy deleted | the Mac's bytes-*received* counter was > 0 at the cancel |
| 6 | 70 MB, cancel on the Mac | phone *Stopped on your Mac* | as above |
| 7 | Stall injected by the provider | `interrupted`, then Retry from 0 succeeds | the retry's bulk header carried `offset: 0` |
| 8 | Corruption injected (`corruptIfArmed`) | `.failed` written, `ok:false checksum` | a clean run of the same file verifies |
| 9 | Receive folder unavailable | declined at offer time, no socket opened | the phone's bulk accept count unchanged |
| 10 | `hello` without `ext` (a Mac build with the field stripped) | the phone sends no offer and shows the update sentence | the same build with `ext` negotiates |
| 11 | `file://`, a directory, a two-item `ClipData` | each refused on the phone, no offer | one valid content URI in the same run produces an offer |
| 12 | A plain-text share | still reaches `clip.push`; "Send to Mac" is not listed | the Sharesheet for an image lists it |
| 13 | Unknown size | staged under `L`, and the offer's `size` = staged bytes = bytes received | a SIZE-reporting run of the same bytes |
| 14 | Zero bytes | an empty file, verified | — |
| 15 | Log audit after 1–14 | 0 content URIs, 0 staging paths, 0 synthetic file names in `link.log` | the same grep finds `offerId` lines (positive control) |

**Instruments:** Mac readings go through `scripts/probe.mjs`. Device writes go through
`scripts/adb-pinned.sh`. Every progress figure is bytes *received*.

## 10 · What approval of this document does not authorise

Code in any module, a new Android activity, protocol code, a change to `docs/protocol.md`, building
or installing an APK, creating synthetic media on a device, deleting the emulator's §4 test files or
`/sdcard/window.xml`, running anything on the SM-S938B (including the §4 repeat), or anything touching
pairing, permissions, link state, emulator system settings, log buffers or existing personal media.
Each is a separate go-ahead.
