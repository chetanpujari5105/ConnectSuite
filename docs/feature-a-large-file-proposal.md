# Feature A — large files (to ~500 GB): a separate streaming path that can pause and continue (proposal, for review)

Written 2026-09-25. **Nothing here is built, no large transfer has been run, and no value in it is
locked.** Contract text: `docs/protocol.md` → *Share → Large files — resumable streaming (PROPOSED)*.

**Owner requirement (2026-09-25):**
- Individual files of around **500 GB** must be possible when the source and destination have the
  capacity.
- **4 GiB is not a file-size limit.**
- The small-file design (copy privately, then offer) and a large-file streaming design are kept
  **separate**.

**Rev 2 (2026-09-25, after a code review — still not approved).** Rev 1 overstated five things,
corrected below where each is claimed:

1. that Gallery access always disappears at once;
2. that the product Files transfer already resumes;
3. that the phone seeks to a resume offset;
4. that a persisted grant proves a stable, seekable source;
5. that the Mac's "flush" is a save that survives a power loss.

Each claim is now marked **as built**, **measured**, or **proposed**. The review's findings, including
two it had to withdraw, are in *§8*.

---

## 1 · What the current share entry point can and cannot do — from the code and the repo's readings

**1. It keeps access to a Gallery-shared source only while the receiving activity exists.**
- **Platform:** a share intent's URI grant belongs to the receiving activity, and
  `takePersistableUriPermission` works only for SAF documents.
- **Measured, with no other access:**
  - **Emulator (Pixel 10, 2026-09-23; `docs/phase-7-share-proposal.md`):** Google Photos and DocumentsUI
    shares failed with `SecurityException` from **+1 s after the sheet's `onDestroy`**, with the
    foreground `LinkService` in the same process. A control read inside the activity succeeded.
  - **SM-S938B, Samsung My Files (`docs/testing.md`, the `b3eca15` staging proof):** the source read
    failed with `SecurityException` **+2 s after Finish**, while the staged copy read fine. One reading
    at one delay.
- **Measured, but confounded:** Samsung **Gallery** on the SM-S938B **stayed readable after Finish**.
  Sidekick holds `READ_MEDIA_IMAGES`, which opens `content://media` URIs with no grant at all, so this
  says nothing about the grant.
- **Not measured:** an activity that is stopped but not destroyed for a long time; destruction under
  memory pressure; process death while the activity is still recorded in a task.
- **As built:** `ShareToMacModel` copies the file into private staging **while the activity holds
  the grant** (`openInputStream`, sequential), and never keeps the URI. `ShareToMacActivity.onStop`
  finishes the activity, so the grant ends when the person leaves the sheet.
- **Consequence:** streaming a Gallery file **during** a live grant is possible in principle.
  **Continuing** after the activity is gone is not supported by the grant. Reopening through
  Sidekick's own media permission would be a different legal basis, needs the owner's decision, and
  fails under partial media access.

**2. The copy caps what can be sent.**
- A staged file needs `s + max(256 MiB, ⌈s/10⌉) ≤ free`.
- **The SM-S938B has 22.6 GB usable (4%) and reports `level=CAUTION`** — below Samsung's caution line
  of 27.5 GB; warning 13.7 GB, low 1.07 GB (`dumpsys devicestoragemonitor`, read-only, 2026-09-25).
- So on this phone a shared file today is limited to roughly **20 GB**, and a 500 GB file can never
  be copied first on any current phone.

**3. The existing Files feature has some of the pieces a large file needs, and fewer than rev 1 said.**
- **What it has:**
  - **As built:** `ACTION_OPEN_DOCUMENT_TREE` grants **persisted** with `takePersistableUriPermission`
    (`FsRoots.kt`).
  - **Platform:** those grants survive the activity, process death and reboot until revoked. Reboot
    survival has not been re-measured for this proposal.
  - **A persisted grant proves access only** — not that the bytes are stable, that the descriptor can
    seek, or that the document is a real local file.
- **What rev 1 wrongly credited to it (corrected):**
  - **The product Files pull does not resume.** `FilesClient.pull` (`desktop/src/main/files.ts`) passes
    no transfer record, so `isResumable` always refuses and the existing `<name>.part` is deleted
    (defect 151).
  - **The 2026-09-01 resume** (52 MB, cut at 26,476,544 bytes, three digests agreeing) was a
    **`media.original` pull driven by a debug probe** in `desktop/src/main/main.ts`. It proves the
    offset and digest mechanics below the 64 MB pre-hash ceiling, not a product feature.
  - **The phone does not seek.** It opens an `InputStream` and **re-reads and hashes the whole prefix**
    before sending from the offset (`BulkTransfers.digestSkipped`).
  - **No source is ever opened as a file descriptor** on the pull path; seekability is untested.
- **What it lacks, which a share requires:**
  - **above a 64 MB pre-hash ceiling a Files transfer is `verified: false`**;
  - it publishes with `rename`, which can replace a file (defect 150);
  - it owns `<name>.part` by name (defect 151);
  - it does not bind the bulk socket to the session (defect 148).

---

## 2 · The design: two paths, chosen by how the file was chosen

| | **Path S — small files (the current design, unchanged)** | **Path L — large files (new)** |
|---|---|---|
| How a person starts it | Gallery → Share → Sidekick (`ACTION_SEND`) | **Sidekick → Send a large file** → Android's document picker (`ACTION_OPEN_DOCUMENT`), or a large file offered from a folder already shared with Sidekick |
| Access to the source | transient; read once, into a private copy, while the sheet is open | **persisted document grant**, taken by Sidekick, released when the transfer ends |
| Digest before the offer | SHA-256 of the private copy | **none** (a 500 GB pre-read would take as long as the transfer); per-chunk digests while streaming |
| Survives the sheet closing | yes (the copy is the offer's) | yes |
| Survives a disconnect or restart | **no** — the offer ends, both sides clean up | **proposed:** paused (§5), continuing from the last verified chunk — only for a descriptor proven seekable at open, and only with the §4 limit on what a continued file promises; otherwise one attempt |
| Size limit | the staging free-space formula (≈ 20 GB on this phone today) | **none of its own** — the Mac destination's space (§6) and the source's own size |
| The multi-offer queue | yes | yes — the same window and queue; a large file is one card |

**Choosing the path:**
- A Gallery share of a file **above the Path S limit** is not refused with a dead end. The sheet says
  *"This file is too large to copy first. Choose it in Files to send it without a copy"* and offers
  **Choose in Files**, which opens the document picker aimed at the file's folder.
  - `EXTRA_INITIAL_URI` is honoured on this handset (measured 2026-09-01).
  - The person picks the same file — **Android does not let an app pre-select it**.
- A Gallery share at or below the limit stays on Path S.

---

## 3 · Guarantees — Gallery share versus document picker

| | Gallery share (Path S) | Document picker (Path L) |
|---|---|---|
| Access after the sheet closes | **not guaranteed** — measured lost at +1 s on the emulator and at +2 s for Samsung My Files; Samsung Gallery's reading is confounded by Sidekick's own media permission (§1) | **access** lasts until revoked, uninstalled, or the file is removed — a persisted grant, *if the provider offers a persistable one*. Access is not stability or seekability (below) |
| Resume after interruption | **impossible**: no access to re-read; the offer ends and the person shares again | only for a descriptor proven seekable at open, from the last chunk the Mac verified, if the source still matches its recorded identity — and with the limit in §4: the continued file is *as read*, not proven one version of the source |
| Detecting a source change | the private copy **is** the source; nothing to detect | best effort only — §4 lists what a provider can hide |
| A source that is not a real local file (cloud, a pipe, `AssetFileDescriptor` with a declared length but no seek) | staging reads it once; fine up to the limit | **not resumable.** If `openFileDescriptor` gives no seekable FD, the card says so before Accept and the transfer runs as one attempt — any interruption means starting again |
| Provider-side limits | the sender app's | the provider's. A cloud provider may download the whole file into its own cache first — **Sidekick cannot see or bound that** |
| Integrity of what arrives | whole-file SHA-256 agreed **before** transfer | per-chunk SHA-256 computed by the phone from what it read, checked by the Mac for each chunk; a manifest root at the end |
| That the Mac holds exactly the file as it was at the start | yes — the copy is frozen | **only if** the source did not change undetectably mid-transfer (§4) |

---

## 4 · Detecting that the source changed

- **Recorded at the offer:**
  - `OpenableColumns.SIZE` and `DocumentsContract.Document.COLUMN_LAST_MODIFIED`;
  - for a media document, `MediaStore.MediaColumns.GENERATION_MODIFIED` (API 30+, increments on every
    change MediaProvider sees);
  - the FD's `st_size`.
- **Re-checked:** before every attempt and resume, **after the last byte**, and once per 1 GiB while
  streaming.
- **Any difference ends the transfer** as `source-changed` — *"The file changed on the phone while it
  was being sent. Nothing was saved."*
- **Mid-stream writes:** the phone hashes exactly the bytes it sends, so the Mac always receives a
  self-consistent copy of *what was read*. A write the provider reflects in any recorded field is
  caught at the next check, and the save is refused.

**What cannot be guaranteed, stated in the copy rather than discovered:**
- **An in-place change that alters no recorded field is undetectable.** Same size, provider does not
  update `last_modified`, not a media item.
- On resume the phone does **not** re-read the bytes already sent. A change inside the part already
  sent, invisible to the recorded fields, would yield a file that is neither the old nor the new
  version. **This is a known blind spot, and it decides what the word *resumable* may promise:**
  - **Without a stronger check,** a continued transfer promises only *the saved file is the bytes the
    phone read, chunk by chunk, across its attempts*. The copy says *continued from where it stopped*
    and *saved as read from the phone*. It never says *resumable* or implies one consistent version.
  - **Re-verify on continue** (option): before sending past the offset, re-read every sent chunk and
    compare each digest with the Mac's record. This catches a change to the sent part that persists at
    the moment of continuing. It costs one read of the prefix on the phone. Local, seekable sources
    only.
  - **Verify after save** (option): after the last chunk, re-read the whole source and compare its root
    with the Mac's. This catches a change during the transfer that persists at the end. It costs one
    full read on the phone.
  - Neither catches a change that was made and then reverted, or one made after the final read.
    **Choosing between these is an owner decision, made before any copy uses *resumable*.**
- **Unknown or dishonest length (0, −1, absent): not on Path L at all.** Such a source stays on Path S,
  which already bounds it by the phone's free space. It comes into the 500 GB promise only once space
  limits, bounded writes, failure handling and truthful progress are defined for it — none is today.

---

## 5 · Continuing after an interruption (proposed)

- **A Path L transfer has a durable record on both sides**, in each app's private data — never in the
  receive folder.
  - **Phone:** `offerId`, the persisted document URI, the recorded identity (§4), the chunk size, and
    the per-chunk digests sent so far.
  - **Mac:** the ownership-ledger entry for its partial (as today), plus the chunk digests it has
    **verified**, the paired phone's fingerprint and `deviceId`, and the destination folder's
    identity.
- **Chunk size: unlocked.** 64 MiB (7,630 chunks for 500 GB) was a placeholder. Two things must be
  measured before any value is chosen:
  - the cost of `fsync` on this Mac's internal disk and on one external drive, since a
    *verified-through* record may advance only once its bytes are on disk (see *Durability
    checkpoints* in `docs/protocol.md`);
  - the cost of re-reading a chunk on the phone.

  How often to checkpoint is a separate parameter from the chunk size. The alternative to
  checkpointing is to re-hash from disk on continue, which moves the cost from write time to resume
  time.
  - The phone sends each chunk's SHA-256 on the control channel as `share.chunk {offerId, index,
    sha256}` once that chunk's bytes have left.
  - The Mac hashes what arrived. A mismatch re-requests **that chunk** by offset, at most twice;
    then the transfer fails `checksum`.
- **The resume point is the end of the last chunk the Mac verified** — never a byte count, never the
  partial's length alone. The partial is truncated back to that boundary before appending.
- **When a transfer pauses:** a disconnect, either app restarting, sleep, or a network change.
  - The card reads *"Paused — continues from where it stopped when your phone reconnects"*, with
    **Cancel**. It does not say *resumable* until one of the §4 checks is chosen and built.
  - On reconnect the phone sends `share.resume {offerId, identity, verifiedThrough}` for each paused
    transfer. The Mac resumes **only if every one of these holds**:
    1. the session's peer presents the **same pinned certificate** and the same `deviceId` as the one
       that was accepted;
    2. the record is less than **24 hours** old (proposed);
    3. the partial still passes the ledger's identity checks and is exactly
       `verifiedThrough × chunk` bytes, truncatable;
    4. the destination folder's identity is unchanged;
    5. the phone reports the source identity unchanged.

    Any failure ends it with its reason, and nothing already published is touched.
- **A resume needs no second Accept** — the Accept was for this file, from this phone — **but it is
  never silent.** The card shows it resuming, and a person may Cancel at any time.
- **Re-pairing or forgetting the phone** discards every paused record, deleting only the Mac's own
  partial.

This is the one place a share outlives its session, and the binding moves from the session token
to the **paired identity**. The bulk socket still presents the new session's token and is bound to
it, and the paired identity is checked in addition. That is a security-relevant change and needs
your explicit approval.

---

## 6 · Mac destination space and integrity

- **Space:**
  - **At the offer and at Accept:** free space must be at least
    `size + margin(size)` plus the queue's reservations.
  - **Proposed margin:** `max(256 MiB, min(⌈size/10⌉, 8 GiB))`. The v2 formula's `size/10` would
    demand **550 GB free for a 500 GB file**; the 8 GiB ceiling keeps the protection for small files
    without that.
  - **While receiving:** re-read every 1 GiB; if free space falls below the remaining bytes + 1 GiB,
    the transfer **pauses** with *"Not enough space left on the destination"*, never a half-written
    publish.
  - The receiving file's reservation is `size − verified bytes`, because its partial already occupies
    the rest.
- **Filesystem:**
  - **Exclusive publication stays mandatory.** Hard links are refused on exFAT and some network
    shares, and **many large external drives are exFAT**.
  - Proposed: publish with `renamex_np(RENAME_EXCL)`, the macOS atomic exclusive rename, **where the
    volume supports it**, and refuse `unsupported-destination` where neither works.
  - Whether exFAT supports `RENAME_EXCL` on macOS 26 **has not been measured**; it is a gating reading.
  - Files of 4 GiB and above on a FAT32 volume are refused before Accept (a 4 GiB **filesystem** limit,
    stated as such).
- **Integrity at the end:**
  - The phone sends the **manifest root**: SHA-256 over the ordered chunk digests, with the chunk size
    and total length.
  - The Mac compares it with the root of the digests **it** verified, and the length with the offer.
  - Then the flush, the exclusive publish and `share.saved`. Saved means exactly what §9 of
    `docs/feature-a-multi-offer-proposal.md` states, with *"SHA-256 of the file"* replaced by *"every
    chunk's SHA-256 and the manifest root"*.
  - **"Flush" today is `Writable.end()`**: the bytes were handed to the operating system. **No
    `fsync` runs anywhere on the Mac**, so today's Saved does **not** promise the file survives a
    power loss (`docs/protocol.md` → *What those words mean, exactly*).
  - An `fsync` before publication would promise that the data reached the drive. It still would not
    promise that the drive emptied its own cache. That takes `F_FULLFSYNC`, which Node does not
    expose. Either strengthening is a new, dated precondition, not a new meaning for the old message.
- **Long runs:**
  - **Proposed, not built:** the Mac holds a `powerSaveBlocker` (`prevent-app-suspension`, not display)
    for the duration. Nothing in `desktop/src` uses one today.
  - The phone's `LinkService` wake lock is already re-armed on schedule (defect 61).
  - Sleep of either device is a pause, not a failure.

---

## 7 · Readings required before any Path L value is locked (none run)

1. Samsung Gallery share grant after `onDestroy` on the SM-S938B **with `READ_MEDIA_*` revoked for the
   run**. Without that, the reading measures Sidekick's own media permission, as the `b3eca15` run
   did. My Files has already been measured at +2 s (lost). Debug probe exists
   (`ShareGrantProbeActivity`); needs an install.
2. Whether a persisted `ACTION_OPEN_DOCUMENT` grant on this handset gives a **seekable** FD for
   `externalstorage` and `media` documents: `fstat` is a regular file, the size is non-negative, and
   `lseek` succeeds. Also whether that stays true after the app restarts. Synthetic files only.
3. The cost of `fsync` on this Mac, internal and one external drive, at the candidate checkpoint
   intervals — before any chunk size is chosen.
4. `RENAME_EXCL` and hard links on an exFAT and an APFS external volume on this Mac — on a volume
   that already exists, never by formatting a drive.
5. `getCacheQuotaBytes` for our package — **not readable without a build** (read-only attempt
   2026-09-25: `/data/system/cachequota.xml` is `system`-only; `dumpsys storagestats` prints nothing).
   It matters to Path S only.
6. One sustained synthetic transfer, sized to what the phone can source and the Mac can hold, before
   any claim about hours-long behaviour.

---

## 8 · Review findings of 2026-09-25, including two it withdrew

The code review that produced rev 2 raised eight findings. Six stand, and are folded into the sections
above:

- Gallery access (§1.1);
- Files resume (§1.3);
- the phone does not seek (§1.3);
- persisted ≠ seekable (§3);
- no `fsync` (§6);
- no `powerSaveBlocker` (§6).

**Two were wrong, and are recorded here so they are not raised again:**

- **"A normal release run never cleans leftover share files in the receive folder."** Withdrawn. The
  review read only `allowedParents` at `desktop/src/main/main.ts:1191` and missed the next line,
  `byRecordedParent: shareAsk.active`. `share.ask` is active because both
  `SHARE_PRODUCTION_READINESS` facts are true (`desktop/src/main/shareActivation.ts`). So the startup
  sweep does clean receive-folder partials, scoped by the parent-folder identity each ledger entry
  proves (runbook §11). Tests: `shareLedgerParent.test.ts` — the production-scope control, and
  interrupted saves.
- **"After a Mac crash between publication and `share.saved`, a Retry can write a second copy."**
  Withdrawn. A Mac crash ends the session, and `ShareOffer.sessionEnded` ends the phone's offer and
  deletes its staged copy, so no Retry exists to repeat. The phone's sheet then reads *Not confirmed*
  or *disconnected during the transfer*, both of which tell the person to check the Mac.
  **What remains** is the already-documented limit: the Mac's *same SHA-256 already saved* warning
  is memory-only, so after a restart, sharing the same file again is not warned about. It lands as
  `name (2)`, never over the first copy.
