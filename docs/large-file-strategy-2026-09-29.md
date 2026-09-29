# Large files — strategy addendum (2026-09-29)

> Extends `docs/feature-a-large-file-proposal.md` (rev 2, 2026-09-25, **not approved, nothing built**).
> That document's analysis stands and is not repeated here. This adds: what comparable projects do, with
> licences checked; a correction to where the copy-free path already exists; and an increment plan in
> which each step is separately testable and none needs a 500 GB transfer. **No 500 GB claim is made.**

## 1 · What comparable projects do (sources read 2026-09-29)

| Project | Licence | Large-file design | Resume | Integrity | Borrowable? |
|---|---|---|---|---|---|
| LocalSend (`localsend/localsend`, protocol v2.2) | **Apache-2.0** (repo page) | `prepare-upload` with per-file `token`, then one `POST /upload` per file, the whole file as one body | **none** — an open feature request (issues #1191, #2127); interrupted transfers restart | `sha256` **optional** ("nullable"); receiver *should* answer 422 on mismatch | **No code.** Flutter/Dart, a different stack. Ideas already present here: per-file tokens and parallel files. Its Android receiver writes into its own storage first and then moves the file, **needing twice the space** (issue #3153) — Sidekick's Mac → phone path already writes straight into a pending `MediaStore` item |
| Syncthing, Block Exchange Protocol v1 | MPL-2.0 (project); the spec is a document, not code | files split into blocks: the smallest power-of-two size giving **< 2000 blocks**, from **128 KiB to 16 MiB** | block-level: only missing or bad blocks are re-requested | **SHA-256 per block**; no whole-file hash in the protocol | **The algorithm, not code.** A block manifest is the known-good way to verify and resume a file too large to pre-hash cheaply |

Sources: [LocalSend protocol](https://github.com/localsend/protocol/blob/main/README.md) ·
[LocalSend repository](https://github.com/localsend/localsend) ·
[resume request #1191](https://github.com/localsend/localsend/issues/1191) ·
[double-storage request #3153](https://github.com/localsend/localsend/issues/3153) ·
[Syncthing BEP v1](https://docs.syncthing.net/specs/bep-v1.html).

Nothing was copied from either project. Using a published protocol's *idea* (block sizes, per-block
hashes) carries no licence obligation; no source file is vendored.

## 2 · Where Sidekick already streams without a second copy — a correction to the framing

The rev-2 proposal frames large files as a problem of the **share** entry point, which is right: a
share stages a whole private copy (`ShareStaging`) because the grant dies with the sheet (measured +1 s
emulator, +2 s Samsung My Files). But two copy-free paths **already exist in the product**, and they
bound what is actually missing:

| Direction | Path | Second copy? | Size bound today | Verified today | Resumes today |
|---|---|---|---|---|---|
| Mac → phone | Files pane Send | **no** — bytes go straight into a `MediaStore` pending item | the phone's free space | **yes, every size** (`ec71870`; 96 MiB live, *checksum matched*) | yes (by the phone's own record; Phase 5 slice 8; a 64 MiB resume in today's Mac log) |
| Phone → Mac | Files pane pull from a folder the person granted (SAF) | **no** — streamed from the provider | the Mac's free space | **only ≤ 64 MiB** — above it the phone agrees no digest, so the Mac reports *not verified* (honestly) | **no** in the product — `bulk.pull` resumes only when a caller passes a recorded length, and only the probe does |
| Phone → Mac | Android share → Sidekick | **yes** — the staged private copy | the staging budget (≈ free space) | yes (whole-file SHA-256 of the copy) | no |

So a person can move a very large file **phone → Mac today, without a copy**, by granting its folder and
pulling it from the Mac's Files pane — but it arrives **unverified above 64 MiB and does not resume**.
Those two gaps, not the share sheet, are the shortest route to an honest large-file answer.

## 3 · Which sources can support a very large transfer at all

| Source | Access that outlives the screen | Seekable (resume possible) | Verdict |
|---|---|---|---|
| A file in a folder granted through SAF (`ACTION_OPEN_DOCUMENT_TREE`, persisted) | yes, until revoked | `externalstorage` documents: **expected, unmeasured** (proposal §7 reading 2) | **the candidate for 500 GB** |
| A single document picked with `ACTION_OPEN_DOCUMENT` (persisted) | yes | same reading owed | candidate (Path L's entry) |
| `MediaStore` photo/video, read with Sidekick's own media permission | yes while the permission holds | expected | candidate for large videos |
| A Gallery / My Files **share** (`ACTION_SEND`) | **no** — dies with the sheet (measured) | n/a | **cannot stream past the sheet**; copy (Path S) or route the person to *Choose in Files* |
| Cloud-backed documents (Drive, OneDrive) | provider-dependent | usually not; the provider may download to its own cache | **not supported for resume**; one attempt at most, said before Accept |

## 4 · The increment plan (each step separately testable; none needs a 500 GB run)

| Step | What | Protocol change? | Test without a huge file |
|---|---|---|---|
| **L1** | Verify phone → Mac pulls above 64 MiB with a **block manifest**: the phone hashes each block as it streams (Syncthing sizing: < 2000 blocks, 128 KiB–16 MiB) and sends the manifest at the end; the Mac hashes what landed per block and compares; *verified* only if every block and the count match | **yes** — `fs.transfer.done`/a trailer carries the manifest; new ext key so older peers keep today's behaviour. PROPOSED for owner review | synthetic 96 MiB–1 GiB files; a corrupting-proxy test; mutation of one block |
| **L2** | **Resume** a Files pull in the product: the Mac records `{rootId, id, size, lastModified, bytesVerified}` beside its Sidekick-only partial (151's name), the phone serves from an offset **only after** re-checking the source's size and last-modified, and the manifest makes the resumed prefix verifiable block by block | **yes** (offset honoured by the phone for pulls; rev 2 corrected that the phone does **not** seek today) | cut a 256 MiB pull at 50% (the existing interrupt hook), resume, compare SHA-256 |
| **L3** | **Mac destination space** before a pull begins: refuse up front with the measured shortfall rather than failing at 90% | no | fake `statfs` in tests; a real near-full volume is not simulated |
| **L4** | **Share → "Choose in Files"** for a Gallery/My Files share above the staging budget: the sheet explains and opens the document picker at the file's folder (`EXTRA_INITIAL_URI`, measured honoured) | no (UI + existing pull) | a synthetic file just above a forced small budget |
| **L5** | Phone-initiated large send (Path L proper): the picked document is offered on the share queue as a *stream* item using L1's manifest and L2's resume | **yes** — `share.stream` (already PROPOSED in `docs/protocol.md`) | the same synthetic sizes |

**Order and why:** L3 and L4 need no contract change and remove the two dead ends people meet first.
L1 then L2 make the already-copy-free path honest and interruptible. L5 is last because it is the largest
contract change and depends on both.

## 5 · What stays unclaimed

- No transfer above 96 MiB has been run in this pass; no hours-long run; no 500 GB claim.
- Proposal §7's six readings are still owed (seekability, `fsync` cost, exFAT/APFS external behaviour,
  the Samsung Gallery grant with media permission revoked, the cache quota, one sustained run).
- Cloud-backed sources are excluded from resume by design, and the card must say so before Accept.
