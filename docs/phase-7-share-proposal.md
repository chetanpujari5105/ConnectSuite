# Feature A — Android Sharesheet → Sidekick → Mac (proposal, rev 1)

> **Status: proposal only. Nothing here is implemented, and `docs/protocol.md` is unchanged.**
> Written 2026-09-23 from the tree at `ea82319`. It supersedes the sketch in
> `docs/sidekick-feature-pass.md` §A, which proposed batching, auto-accept and resume; all three are
> cut from v1 below.
>
> **An experiment gates the architecture (§4).** If the foreground `LinkService` cannot open a shared
> URI after the receiving activity finishes, work stops and the readings are reported before any
> design choice is made. §4 is the first thing to run, before any code.

## 0 · What the code allows today (read from the tree, not recalled)

| Fact | Where | Consequence |
|---|---|---|
| **Every transfer is started by the Mac.** The phone serves `fs.transfer.begin` and `media.original` and has no phone → Mac request/response. It sends only events | `ControlSession.kt`, `desktop/src/main/link.ts` (the Mac has no code that acks a phone request) | The phone's opening message must be an **event**. Every answer goes Mac → phone as a **request**, which is the direction that already works |
| `BulkTransfers.Pending.open` is a supplier `() -> InputStream?` | `sync-module/.../v2/BulkTransfers.kt` | A `content://` stream can use the existing pull path unchanged: the bulk header, the 256 KB chunks, the whole-file digest, `fs.transfer.progress` and `fs.transfer.done` |
| The Mac's `bulk.pull` needs `expectedBytes` and fails when `received !== expectedBytes` | `desktop/src/main/bulk.ts` | **The size must be known before the offer.** It is the only witness to a truncated stream above the 64 MB pre-hash ceiling |
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
| Transfer resume | An interrupted transfer is **retried from byte 0** while the offer is valid. The existing `.part` / `.failed` safety is preserved exactly |
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
- **`size`** is required, never null, and ≥ 0 (see §5 for how it is obtained).
- **`sha256`** is the phone's whole-file digest where it pre-hashed (≤ 64 MB, the existing ceiling,
  or any file it had to read to measure). Otherwise it is `null`, and `verified` is then `false`,
  which is the honest answer.
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
phone → Mac, event    {"offerId":"s-…","reason":"user"|"expired"|"access-lost"}
Mac → phone, request  {"offerId":"s-…","reason":"user"}
ack                   {"offerId":"s-…","stopped":true}
```

On a cancel from either side, the phone calls the existing `BulkTransfers.cancel` for any live
`transferId` on the offer's root, and the Mac deletes that offer's `.part`. The offer is then gone,
and in v1 no resume could use the partial anyway.

## 4 · Required experiment — URI grant lifetime (run first; no code for it exists yet)

**The question:** after the activity that received `ACTION_SEND` finishes, can the foreground
`LinkService` in the same process still open the shared `content://` URI?

A grant attached to a share intent belongs to the receiving activity, and
`takePersistableUriPermission` works only for SAF documents. Documentation alone does not say how
long this grant lasts on this handset, and the repo's rule is to measure it.

### Instrument (to be built only after this proposal is approved)

A debug-only `ShareGrantProbeActivity` (the same shape as `ClipProbeActivity`) that receives
`ACTION_SEND`, and a debug-only hook in `LinkService` that retries the read. It logs **three lines,
with the URI's authority only, never the full URI or the file name**:

1. `R0 control` — `openInputStream(uri)` inside the activity, before `finish()`, reading the whole
   stream and logging the byte count. **It must succeed and match the known size, or the run holds
   no reading.**
2. `R1` — the same read from `LinkService` at +1 s, +30 s and +120 s after the activity's
   `onDestroy`, each logging `ok bytes=N` or the exception's **class and message**. No
   `runCatching { }.getOrNull()`.
3. `R1 settle` — `dumpsys activity activities` confirms the probe activity is **destroyed**, not
   paused, before each R1 read. Otherwise the reading measures a live activity.

### Matrix

| Device | Source app | Stimulus |
|---|---|---|
| SM-S938B | Samsung Gallery (`com.sec.android.gallery3d`, a MediaStore URI) | one generated synthetic image |
| SM-S938B | Samsung My Files (`com.sec.android.app.myfiles`, its own provider) | one generated synthetic file |
| emulator | Google Photos, or the AOSP gallery if Photos is absent (named in the result) | one generated synthetic image |
| emulator | Files by Google / DocumentsUI | one generated synthetic file |

The package that answers each URI is recorded (`dumpsys package` on the authority), because in this
repo the provider has turned out not to be the vendor it appears to be (`docs/single-device-audit.md`).

### Decision rule

| Result | Next step |
|---|---|
| R1 `ok` at every interval, on every row | The architecture in §5 stands: `LinkService` holds the offer, and the share screen may close |
| R1 fails on **any** row | **Stop. Report the readings. Choose no architecture.** Options such as a self-grant or keeping the screen open are for the next conversation, not pre-chosen here |

### Preconditions not yet met (deliberately)

- The synthetic media does **not exist yet**. The folder `Pictures/SidekickShareTest/` is **not**
  created, and no test media is generated, until you approve that step. When it is created, the files
  are removed afterwards through MediaStore (never `rm`) and the removal is checked by path and by
  MediaStore row, each with a positive control.
- No existing personal media is used as a stimulus.

## 5 · Behaviour

### The offer's lifecycle (one state machine, on the phone)

`preparing → offered → accepted → sending → saved | failed → (retry → sending) | expired | cancelled | declined`

It will be written as a pure transition function (`ShareOffer.after(event, nowMillis)`) that
`LinkService` calls and a JVM test calls too. This is the defect-67 rule: the test reaches the
transition, not a hand-built state.

| Case | Behaviour |
|---|---|
| **Filename** | `OpenableColumns.DISPLAY_NAME`, then the URI's last path segment, then `Shared file <yyyy-MM-dd HHmmss>`. If there is no extension, one is added from the MIME type via `MimeTypeMap` |
| **Mac-side name** | The Mac **re-sanitises and never trusts the phone's name**: normalise to NFC, drop control characters, replace `/` and `:` with `-`, replace a leading `.` with `_`, and cap at 255 UTF-8 bytes keeping the extension. An empty result becomes `Shared file` |
| **MIME** | `ContentResolver.getType(uri)`, then the intent's type if it is not a wildcard, then `application/octet-stream`. **Display only**: the Mac never chooses a handler from it |
| **Size** | `OpenableColumns.SIZE`, then `openAssetFileDescriptor(uri,"r").length` if it is not `UNKNOWN_LENGTH`, then one full read under *Preparing…*, which also gives the digest. A source that cannot be read is refused on the phone, and no offer is sent |
| **Collision** | The existing `freeName` gives `name (2).ext`. **The final file is never overwritten**, and the card shows the name it will be saved as |
| **Offer timeout** | 10 minutes from the offer. The phone sends `share.cancel{expired}` and the Mac card changes to *Expired* with no buttons |
| **Stall** | 30 s with no bytes on the bulk socket fails the attempt with `share.saved{ok:false, reason:"interrupted"}`. The Mac offers **Retry** while the offer is valid |
| **Cancel** | Either side, with `share.cancel` (§3). The Mac deletes the offer's `.part` |
| **Checksum** | Verified when `sha256` was agreed. On a mismatch: `.failed` is written, `share.saved{ok:false,"checksum"}` is sent, and Retry is offered |
| **Retry** | A new `fs.transfer.begin` from byte 0. The old `.part` is deleted first; there is no appending in v1 |
| **Mac disconnects** | Before Accept: the offer dies with the session, and the phone shows *"<Mac> disconnected — share again when it is back."* During sending: the Mac's `.part` stays (the existing convention) and no resume is attempted. The next share of the same file starts fresh, and `freeName` means the earlier `.part` never blocks it |
| **Mac not connected at share time** | **Send** is disabled with *"<Mac> isn't connected — open Sidekick on your Mac."* Nothing is queued |
| **Folder / space** | The Mac checks `ensureReceiveFolder()` and free space ≥ `size` **when the offer arrives, and again at Accept**. A failure declines with its reason before any bytes move |
| **Zero bytes** | Allowed. The Mac creates an empty file, verified against the empty-input digest |
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
- The URI is never put in `savedInstanceState`. No storage permission and no new foreground-service
  type: `LinkService` is already foreground (`connectedDevice`).
- **The grant-holding design depends on §4.** Nothing about finishing the activity or backgrounding
  the send is decided until those readings exist.

## 7 · UI

### Phone (bottom sheet)

- A header reading **Send to <Mac name>**, then a thumbnail (images only, decoded locally and never
  sent), the **name**, the **exact size** (`3,874,112 bytes · 3.7 MB`), and *"Saved to your Mac's
  receive folder."*
- Buttons: **Send** and **Cancel**.
- States, in the repo's state vocabulary, one headline each:

| State | Headline |
|---|---|
| preparing | *Preparing…* |
| not connected | *<Mac> isn't connected* |
| Mac needs updating | *Update Sidekick on your Mac* |
| waiting | *Waiting for you to accept on <Mac>* |
| sending | a progress bar, `bytes of total` |
| saved | *Saved on <Mac> as <savedAs>*, only after `share.saved ok:true`. `verified: false` adds *"not checked against a checksum"* |
| failed | the reason, with *Retry from your Mac* |
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
- **Logging:**
  - never a full content URI (the authority only)
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
step is approved (§4).

**Unit tests (each shown red against the defect it is named for):**

- the `ext` parsing rules 1–6, with a fixture for each malformed shape, an absent field, and
  `min()` negotiation
- `share.offer` validation: every reason for declining
- the phone's `ShareOffer.after` transitions, including answer-once, expiry, and cancel from each
  state
- the Mac's name sanitiser and `freeName` interaction
- a share root refusing every verb but the one pull, **one test per refused verb**
- errors carrying `feature: "share"`
- `SendSelectionActivity` still owning `SEND` `text/plain` (a manifest test, so a later change
  cannot silently steal it)

**On hardware and the emulator, after §4 passes (each with a control):**

| # | Case | Pass criterion | Control |
|---|---|---|---|
| 1 | One synthetic image, Accept | `share.saved ok verified=true`; SHA-256 on the Mac = source | the same hash computed on the phone side |
| 2 | Decline | no file, no `.part`, phone *Declined* | the receive folder listed before and after, with a known file present in both |
| 3 | Wait 10 min without answering | the card turns *Expired*, the phone *Expired*, a late Accept gets `NOT_FOUND` | the card was rendered before expiry (`probe.mjs` with `onScreen`) |
| 4 | The same file twice | the second is `(2)`, the first unchanged (hash) | the first file's hash before and after |
| 5 | 70 MB, cancel on the phone | the Mac deletes the `.part`, no final file | the Mac's bytes-*received* counter was > 0 at the cancel |
| 6 | 70 MB, cancel on the Mac | phone *Stopped on your Mac* | as above |
| 7 | Stall injected by the provider | `interrupted`, then Retry from 0 succeeds | the retry's bulk header carried `offset: 0` |
| 8 | Corruption injected (`corruptIfArmed`) | `.failed` written, `ok:false checksum` | a clean run of the same file verifies |
| 9 | Receive folder unavailable | declined at offer time, no socket opened | the phone's bulk accept count unchanged |
| 10 | `hello` without `ext` (a Mac build with the field stripped) | the phone sends no offer and shows the update sentence | the same build with `ext` negotiates |
| 11 | `file://`, a directory, a two-item `ClipData` | each refused on the phone, no offer | one valid content URI in the same run produces an offer |
| 12 | A plain-text share | still reaches `clip.push`; "Send to Mac" is not listed | the Sharesheet for an image lists it |
| 13 | Unknown size | measured, and the offer's `size` = bytes received | a SIZE-reporting run of the same bytes |
| 14 | Zero bytes | an empty file, verified | — |
| 15 | Log audit after 1–14 | 0 full content URIs, 0 synthetic file names in `link.log` | the same grep finds `offerId` lines (positive control) |

**Instruments:** Mac readings go through `scripts/probe.mjs`. Device writes go through
`scripts/adb-pinned.sh`. Every progress figure is bytes *received*.

## 10 · What approval of this document does not authorise

Code in any module, a new Android activity, protocol code, a change to `docs/protocol.md`, building
or installing an APK, creating synthetic media on a device, or anything touching pairing,
permissions or existing personal media. Each is a separate go-ahead, and §4 comes first.
