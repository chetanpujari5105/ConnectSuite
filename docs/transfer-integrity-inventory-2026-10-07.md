# Transfer integrity inventory — every packaged transfer path (S9, defect 187), 2026-10-07

Read from source at `0cbe9c8` plus this sitting's S9 commit; **no hardware reading** was taken. "Release
build" means what a packaged build from this tree does with every release gate as it stands today
(`FS_BLOCKS_RELEASE = false`, `SHARE_*_RELEASE` as in `docs/release-tracker.md`). Sizes are bytes; 64 MiB =
67,108,864.

## The paths

| # | Path | Direction | Integrity check in a release build | Verified size range | What the UI says | Tests (unit / loopback) |
|---|---|---|---|---|---|---|
| 1 | **Files → Send to phone** (`fs.push`, `FilesClient.push`) | Mac → phone | Mac hashes the **whole file at every size** before the first byte (`digestOf`); the phone compares and reports `verified` in `fs.transfer.done` | **all sizes**, when the Mac's hash succeeded; a failed hash sends no digest and the push is reported unverified | *Arrived · checksum matched* / *Arrived · not checksummed* — from the phone's `verified`, never upgraded | `filesPush.test.ts` (6, incl. a push above 64 MiB carrying its digest); `bulkPush.test.ts` (5) |
| 2 | **Files → Copy to Mac / drag to Finder** (`fs.pull`, pre-hash) | phone → Mac | the phone pre-hashes **only up to 64 MiB** (`PREHASH_MAX_BYTES`); the Mac compares; a mismatch deletes the partial and leaves a `.failed` marker; the agreed length is checked in every case | **0 – 64 MiB** verified; **above 64 MiB: length only** | `pullCheckSentence`: *Its checksum matched…* / *No checksum was agreed in advance, so nothing compared the bytes.* | **new** `bulkPrehashPull.test.ts` (9): match, mismatch, no digest, empty file, empty vs non-empty digest, short stream ±digest, over-long ±digest |
| 3 | **Files pull, block-verified** (`fs.blocks`) | phone → Mac | every 4 KiB…block compared as it lands; resume re-verifies; source change refused | all sizes — **but gated off in release** (`FS_BLOCKS_RELEASE = false`) | *Verified block by block…*; paused: *…checked block by block* | `filesResume.test.ts` (40+), `bulkBlockPull.test.ts` |
| 4 | **Photos & Videos → Save to Mac** (`media.original`) | phone → Mac | same pre-hash rule as 2: **≤ 64 MiB** verified, above it length only — most videos | 0 – 64 MiB | **fixed tonight:** the saved line now says *Its checksum matched…* or *No checksum was agreed in advance…*. Before, `verified` was dropped at `PhotosClient.original` and a 100 MB video read exactly like a checked photo | `photosPull.test.ts` (+1), `photos.test.ts` (+2) |
| 5 | **Photos preview original** (detail pane) | phone → Mac (private cache) | same as 4; never saved as the person's file | 0 – 64 MiB | no claim made | — |
| 6 | **Phone → Mac sharing** (`share.file`) | phone → Mac | the offer carries the prepared copy's **full SHA-256 at every size** (validated `^[0-9a-f]{64}$`); the Mac compares before publishing; "Saved" only after | all sizes | *Saved* only after a verified publish | `bulkShare.test.ts` |
| 7 | Mirror screenshot, Activity CSV | Mac-local writes | not transfers | — | — | — |

## What was found tonight

- **Path 4 dropped the check result** (fixed, `photoCheckSentence`). The bytes were handled correctly — a
  mismatch was already refused — but a saved video that **nothing compared** was presented with the same
  sentence as a photo whose checksum matched.
- **Path 2 had no loopback test of its own**; the 9 added pass against the existing code (characterisation).
  Mutation MT2 (the length check deleted) stayed **green** against the first 8, because every over-long test
  carried a digest that also caught it; the ninth test — over-long, **no digest** — is the case where the
  length check stands alone, and it is red under MT2.

## What is still true and must be said, not fixed tonight

- **Above 64 MiB, a release-build pull (Files or Photos) is checked on length only.** The UI now says so on
  both panes. The only route to a verified large pull in this tree is `fs.blocks`, which is a **release
  decision** (row 14 of the tracker), not an overnight change.
- **Raising `PREHASH_MAX_BYTES` is not a fix and was not done.** The phone pre-hashes before the transfer
  starts, so a larger ceiling means a 4 GB video read twice and a long silent wait before the first byte —
  the cost `fs.blocks` was designed to remove.
- **No claim of support for very large files (e.g. 500 GB) is made or measured.** Space is checked before a
  pull (`pullSpaceRefusal`) and during a block pull; nothing here has been run above a few hundred MB on
  hardware.

## Proposals (not implemented)

1. **Decide `fs.blocks` for release** (tracker row 14). It is the existing, tested mechanism for verified,
   resumable large pulls; flipping it needs its own review as release code (U-4) and a hardware run.
2. **If `fs.blocks` stays off:** a whole-file digest sent by the phone **after** streaming (`fs.transfer.done`
   carrying the SHA it computed while reading) would let the Mac verify any size against what the phone read,
   at no extra read cost. That is a contract change (`docs/protocol.md` first), proposed here, not improvised.
