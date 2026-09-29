# The complete-app pass — evidence, 2026-09-29

> Kept out of `docs/testing.md` because that file holds the owner's uncommitted Run A block; fold it
> in when that block is committed. The inventory this pass works from is `docs/release-inventory.md`.

## 1 · Mac → phone: every file is checksummed (inventory F-2)

**Before.** `FilesClient.push` pre-hashed only files ≤ 64 MiB (`PREHASH_CEILING`). Above it no digest
was agreed and the phone could only report `verified: false` — the UI said *not checksummed*, honestly,
for exactly the files most exposed to damage in transit.

**Why the ceiling was not worth it — measured on this Mac, 2026-09-29.** SHA-256 over a file with
Node's `createReadStream` + `createHash`:

| File | 64 KiB reads | 1 MiB reads |
|---|---|---|
| 256 MiB random | 230 ms (1,169 MB/s) | 158 ms (1,698 MB/s) |
| 1 GiB | 1,129 ms (951 MB/s) | 619 ms (1,735 MB/s) |

Against the measured wire (32 MiB at 41–42 MB/s, `docs/transfer-overnight-2026-09-29.md` §4), hashing
first costs **≈ 2.4%** of the transfer. Warm page cache; a cold read of a large file will be bounded by
the SSD, still far above the wire. (Both test files were deleted afterwards; the Mac had 15 GB free.)

**After.**
- `FilesClient.push` sends `sha256` for every size. `digestOf` reads 1 MiB at a time, reports progress,
  and can be aborted.
- `fs-send` (main.ts) hashes **once per file**, not once per `name (n)` collision retry, and passes the
  digest to each attempt.
- The row reads *Checking 1.2 GB of 4.0 GB before sending* while it hashes (`sendBatchOnChecking`); the
  bar stays the phone's delivered bytes only.
- **Stop during the hash** ends it (`fs-send-abort`) and the file reads *Stopped before it started —
  nothing was sent.*
- The phone side needed no change: `receiveFrom` already hashes as it writes, re-hashes the kept prefix
  on resume, and accepts a digest at any size.

**Tests.** `filesPush.test.ts` (6): a sparse 64 MiB + 1 file carries the whole-file digest; a caller's
digest is sent as-is; a failed hash sends no digest (never an invented one); `digestOf` equals a one-shot
hash with monotonic bounded progress; abort stops early; a missing file is `null` with `ENOENT`.
`sendBatch.test.ts` +2: checking is never delivery and never moves backwards; Stop during the hash
settles as cancelled.
**Mutation:** the 64 MiB ceiling restored → *a push above the old 64 MiB ceiling carries the whole
file's digest* red, 5 others green; restored by SHA-256.

**Owed on hardware:** one push of a bounded file above 64 MiB reading *checksum matched* on the phone's
own verdict (the acceptance line in the inventory).

## 2 · Defects 148, 149, 150, 151, 154 and a path-traversal in the pull name

### Phone — 148 and 149 (`BulkTransfers`)

- **148.** A Files or Photos pull was claimable by any trusted session's bulk socket, by an id of the form
  `t-<counter>-<millis mod 100000>`, and `fs.transfer.cancel` stopped any id.
  - `serve()` now binds every pull through `BulkClaim.claimToken(boundSessionToken, sessionId)` — a
    share pull to its own token, every other pull to the session that agreed it — and a push through
    `BulkClaim.decidePush`, looked at before it is taken so a wrong claim cannot consume the entry.
  - `fs.transfer.cancel` → `BulkTransfers.cancelFor(session.token, …)`: only the session's own
    transfers. An owner map is held from registration until the socket is done, so a **live**
    transfer (in neither `pending` nor `incoming`) is covered too.
  - Ids are `tf-` + 128 random bits.
- **149.** The refusal for an unknown id sent `feature: "photos"` whatever the transfer was; it now sends
  no feature.

`BulkSessionBindingTest` (6). Mutations, each on a **fresh** result file (written 3–4 s after the run
started, `gradle exit 1`): P1 `serve()` back to `boundSessionToken` alone → 1 failure; P2 the cancel
handler back to the unchecked `cancel` → 1 failure. Restored by SHA-256.

**Instrument fault caught before it was reported.** The first mutation run printed `failures="0"` for all
four mutations. Gradle had exited 1 and the XMLs were ~30 s old: zsh had read `:$mod:testDebugUnitTest`
as the `:t` (tail) history modifier, so no test ran at all. Re-run with `${mod}`, each result file's
write time printed against the run's start.

### Mac — 150, 151, 154

- **150.** `BulkClient.pull` published with `fs.rename(part, destination)`, which replaces a file that
  appeared at the name during the transfer. It now goes through `publishPulled`: the share path's
  exclusive hard link (`publishExclusive`), EEXIST → next free name; where hard links are refused (exFAT,
  SMB) an **exclusive copy** (`COPYFILE_EXCL`), which also refuses rather than replaces — so Files and
  Photos keep working on those folders, where the share path deliberately refuses.
- **151.** The partial was `<name>.part` and an unrecorded one was deleted before a pull — another app's
  download. It is now `.<name>.sidekick-pull.part` (`pullPartPathFor`), a name only Sidekick writes.
  The `.failed` sidecar is created exclusively (`wx`) and a stale one is removed only if its text is a
  Sidekick sidecar.
- **Path traversal (found reading 150).** Both pulls did `join(receiveFolder, <the phone's name>)`; a name
  of `../x` would have landed outside the folder. `pullDestination` re-sanitises with the share path's
  rules (`sanitizeShareName`). Photos' duplicate `freeName` was removed.
- **154.** `checkDestination` unlinked its probe files by name. The first probe's dev/ino is read right
  after its exclusive create; each name is unlinked only while `lstat` still shows that identity.

`bulkPullPublish.test.ts` (4) and `shareDestination.test.ts` +1. Mutations, each red on its named test
and restored: M1 `rename` restored (both 150 tests), M2 `<name>.part` restored (151), M3 sanitiser
removed (traversal), identity check disabled (154).

**Suites after §1 and §2:** Mac 1,328 / 0 (was 1,315); `tsc` clean on both configs.

## 3 · Text files in a share (inventory F-9)

**Measured before, on the SM-S938B** (`cmd package query-activities`, read-only): a `SEND` of `text/plain`
resolved to `SendSelectionActivity` (the clipboard send), `text/csv` to nothing of ours, and a
`SEND_MULTIPLE` of `text/*` to nothing of ours. So a My Files selection of `.txt`/`.csv`/`.json` files
did not list Sidekick at all, and a single `.txt` reached the clipboard path, which reads `EXTRA_TEXT`,
found none, and said there was nothing to send.

**After.**
- `ShareManyToMacActivity` (several files) also takes `text/*`. A plain-text share is never a
  `SEND_MULTIPLE`, so this takes nothing from `clip.push`.
- `SendSelectionActivity` takes `SEND` `text/*` (was `text/plain`) and forwards any share that carries an
  `EXTRA_STREAM` to `ShareToMacActivity`, with the read grant passed on (`ShareTextRoute`). Text with no
  stream is still a clipboard send.
- No filter anywhere claims `*/*`.

`ShareTextRouteTest` (5), `ShareManifestTest` and `ShareManyManifestTest` updated to the new rule (not
loosened: each asserts exactly which activity takes which text action, and that nobody takes `*/*`).
Mutations, fresh artifacts: P3 `text/*` removed from the several-files filter → red; P4 a caption
beating the file → red.

**Suites:** phone `app` 174 / 0 and `sync-module` 542 / 0 (run fresh); `core` 219, `input-module` 52,
`mirror-module` 60, 0 failures — up to date, sources unchanged. Debug APK built 11:13:41.

**Owed on hardware:** the resolution table re-read after install, then a My Files selection of text
files through to the Mac.
