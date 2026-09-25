# Feature A — large files (to ~500 GB): a separate, resumable streaming path (proposal, for review)

Written 2026-09-25. **Nothing here is built, no large transfer has been run, and no value in it is
locked.** Contract text: `docs/protocol.md` → *Share → Large files — resumable streaming (PROPOSED)*.

**Owner requirement (2026-09-25):**
- Individual files of around **500 GB** must be possible when the source and destination have the
  capacity.
- **4 GiB is not a file-size limit.**
- The small-file design (copy privately, then offer) and a large-file streaming design are kept
  **separate**.

---

## 1 · What the current share entry point can and cannot do — from the code and the repo's readings

**1. It cannot keep access to a Gallery-shared source.**
- A share intent's URI grant belongs to the receiving activity, and `takePersistableUriPermission`
  works only for SAF documents.
- **Measured (Pixel 10 emulator, 2026-09-23; `docs/phase-7-share-proposal.md`):** Google Photos and
  DocumentsUI shares failed with `SecurityException` from **+1 s after the sheet's `onDestroy`**,
  with the foreground `LinkService` in the same process and a control read inside the activity
  succeeding.
- **This has not been measured on the SM-S938B or with Samsung Gallery.**
- That is why `ShareToMacModel` copies the file into private staging at once (`openInputStream`,
  sequential) and never keeps the URI.

**2. The copy caps what can be sent.**
- A staged file needs `s + max(256 MiB, ⌈s/10⌉) ≤ free`.
- **The SM-S938B has 22.6 GB usable (4%) and reports `level=CAUTION`** — below Samsung's caution line
  of 27.5 GB; warning 13.7 GB, low 1.07 GB (`dumpsys devicestoragemonitor`, read-only, 2026-09-25).
- So on this phone a shared file today is limited to roughly **20 GB**, and a 500 GB file can never
  be copied first on any current phone.

**3. The existing Files feature already has the pieces a large file needs, but not their guarantees.**
- **What it has:** `ACTION_OPEN_DOCUMENT_TREE` grants **persisted** with
  `takePersistableUriPermission` (`FsRoots.kt`), which survive the activity, process death and reboot
  until revoked. Its pull **resumes by offset** (observed 2026-09-01: 52 MB, cut at 26,476,544 bytes,
  three digests agreeing).
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
| Survives a disconnect or restart | **no** — the offer ends, both sides clean up | **yes, paused** (§5): resumes from the last verified chunk |
| Size limit | the staging free-space formula (≈ 20 GB on this phone today) | **none of its own** — the Mac destination's space (§6) and the source's own size |
| The multi-offer queue | yes | yes — the same window and queue; a large file is one card |

**Choosing the path:**
- A Gallery share of a file **above the Path S limit** is not refused with a dead end. The sheet says
  *"This file is too large to copy first. Choose it in Files to send it with resume"* and offers
  **Choose in Files**, which opens the document picker aimed at the file's folder.
  - `EXTRA_INITIAL_URI` is honoured on this handset (measured 2026-09-01).
  - The person picks the same file — **Android does not let an app pre-select it**.
- A Gallery share at or below the limit stays on Path S.

---

## 3 · Guarantees — Gallery share versus document picker

| | Gallery share (Path S) | Document picker (Path L) |
|---|---|---|
| Access after the sheet closes | **not guaranteed** — measured lost at +1 s on the emulator; unmeasured on Samsung | guaranteed until revoked, uninstalled, or the file is removed — a persisted grant |
| Resume after interruption | **impossible**: no access to re-read; the offer ends and the person shares again | from the last chunk the Mac verified, if the source still matches its recorded identity |
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
  version.
  - Mitigation: an optional **Verify from the start** on resume re-reads and re-hashes the sent part
    before continuing — as slow as sending it again, but no network.
  - Offered, not default.
- A provider that lies about size (reports 0 or −1) makes the file **not resumable** and **not
  pre-checked for space**. The card says so, and the transfer ends if it exceeds the Mac's reserved
  space.

---

## 5 · Resume after interruption, safely

- **A Path L transfer has a durable record on both sides**, in each app's private data — never in the
  receive folder.
  - **Phone:** `offerId`, the persisted document URI, the recorded identity (§4), the chunk size, and
    the per-chunk digests sent so far.
  - **Mac:** the ownership-ledger entry for its partial (as today), plus the chunk digests it has
    **verified**, the paired phone's fingerprint and `deviceId`, and the destination folder's
    identity.
- **Chunks are 64 MiB** (7,630 for 500 GB) — **proposed.**
  - The phone sends each chunk's SHA-256 on the control channel as `share.chunk {offerId, index,
    sha256}` once that chunk's bytes have left.
  - The Mac hashes what arrived. A mismatch re-requests **that chunk** by offset, at most twice;
    then the transfer fails `checksum`.
- **The resume point is the end of the last chunk the Mac verified** — never a byte count, never the
  partial's length alone. The partial is truncated back to that boundary before appending.
- **When a transfer pauses:** a disconnect, either app restarting, sleep, or a network change.
  - The card reads *"Paused — resumes when your phone reconnects"*, with **Cancel**.
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
- **Long runs:**
  - The Mac holds a `powerSaveBlocker` (`prevent-app-suspension`, not display) for the duration.
  - The phone's `LinkService` wake lock is already re-armed on schedule (defect 61).
  - Sleep of either device is a pause, not a failure.

---

## 7 · Readings required before any Path L value is locked (none run)

1. Samsung Gallery share grant after `onDestroy` on the SM-S938B — the emulator reading does not
   transfer to Samsung by assumption. Debug probe exists (`ShareGrantProbeActivity`); needs an install.
2. Whether a persisted `ACTION_OPEN_DOCUMENT` grant on this handset gives a **seekable** FD for
   `externalstorage` and `media` documents.
3. `RENAME_EXCL` and hard links on an exFAT and an APFS external volume on this Mac.
4. `getCacheQuotaBytes` for our package — **not readable without a build** (read-only attempt
   2026-09-25: `/data/system/cachequota.xml` is `system`-only; `dumpsys storagestats` prints nothing).
   It matters to Path S only.
5. One sustained synthetic transfer, sized to what the phone can source and the Mac can hold, before
   any claim about hours-long behaviour.
