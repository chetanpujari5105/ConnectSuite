# Large files L1 + L2 — the exact security and compatibility rules, for review (2026-09-29)

> **Status: FOR THE OWNER'S REVIEW. Nothing here is implemented, and `docs/protocol.md` is unchanged.**
> Extends `docs/large-file-strategy-2026-09-29.md` §4 (L1 = verify Files pulls above 64 MiB; L2 = resume
> them). Scope is the **Files pane pull** (phone → Mac, `fs.transfer.begin` `direction: pull`) and
> nothing else: shares, pushes and Photos are unchanged. **No 500 GB claim is made by this document or
> by anything it would build**; the largest run it plans is 1 GiB (the Mac has 11 GiB free).

## 0 · What each layer already guarantees — so the rules protect the right thing

| Threat | Already covered by | What L1/L2 adds |
|---|---|---|
| Bytes altered or dropped **on the wire** | TLS 1.3 AEAD on the bulk socket: a flipped bit fails the record MAC and kills the connection | nothing — and this document does not claim the manifest protects the wire |
| Our **framing / write path** losing, duplicating or reordering a chunk; a resume splicing at the wrong byte | only the ≤ 64 MiB pre-hash today; **nothing above it** | per-block digests from the phone, checked by the Mac as blocks land, plus a whole-file digest and a manifest root at the end |
| The **source changing while it is read** (torn file) | the ≤ 64 MiB pre-hash (two reads that must agree); **nothing above it** | a size + last-modified re-read before the first and after the last byte. **Stated as a heuristic**: a writer that keeps size and mtime identical is not detected |
| The Mac's **partial changing while paused** | nothing (no resume in the product) | the Mac reads its partial back and re-hashes it against its own record before resuming |
| The **source changing between an interruption and a resume** | nothing | the phone re-hashes the prefix it is asked to skip and must reproduce the Mac's prefix root |
| A resume record or partial being **claimed by another phone or session** | session binding (defect 148) for claims; nothing for records | records keyed by the paired phone's fingerprint; every resume is a new `transferId` in the current session |

## 1 · Negotiation and compatibility rules

- **C1 — one new extension key, `fs.blocks: 1`**, in `hello.ext` and `hello.ack.ext`, parsed by the six
  existing `ext` rules (absent/garbage → `{}`, unknown key ignored, `min(mine, theirs)`, fixed for the
  session). The cases go in `docs/fixtures/fs-blocks.json`, read by both sides' tests, as
  `ext-negotiation.json` and `share-wait.json` are.
- **C2 — new Mac, older phone** (key absent): exactly today — `sha256: null` above 64 MiB,
  `verified: false`, no resume, a Sidekick partial deleted before a restart. The Mac's card keeps today's
  *"Arrived · not verified"* wording.
- **C3 — older Mac, new phone**: the phone sends no new field and no new event unless the key was
  negotiated. An older Mac never sees `fs.transfer.blocks`, `blockSize`, `manifestRoot` or `SOURCE_CHANGED`.
- **C4 — ≤ 64 MiB is unchanged even when negotiated.** The pre-hash path (digest agreed before a byte
  moves) is stronger than a trailer and already verified on hardware. Blocks apply only above it. Files at
  or below 64 MiB do not resume (they restart; ≤ 1 s on this LAN).
- **C5 — push, share and `media.original` are untouched** by this slice. Share (`share:` roots) keeps
  "offset 0 only" (`BulkClaim.requireOffsetZero`); L5 is a separate contract.
- **C6 — release gating (owner's choice D4 below).** Recommended: advertised by debuggable phones and the
  unpackaged Mac only, behind `FS_BLOCKS_RELEASE` (phone) / `FS_BLOCKS_RELEASE` (Mac), both `false`,
  flipped in their own commit — the same shape as `share.wait`.

## 2 · Wire shapes (only when `fs.blocks` is negotiated and `size > 64 MiB`)

```json
fs.transfer.begin request  {"direction":"pull","rootId":"saf:…","id":"…",
                            "resume":{"size":1073741824,"mtimeMs":1759140000000,"blockSize":1048576,
                                      "verifiedBlocks":512,"prefixRoot":"9f2c…"}}      // L2 only; omitted on a first attempt
fs.transfer.begin ack      {"transferId":"t-…","direction":"pull","size":1073741824,"mtimeMs":1759140000000,
                            "name":"clip.mov","mime":"video/quicktime","sha256":null,"chunkMax":262144,
                            "offset":0,"blockSize":1048576,"blockCount":1024,
                            "resume":{"accepted":true,"from":536870912}}                // or {"accepted":false,"why":"source-changed"}
fs.transfer.blocks event   {"transferId":"t-…","first":512,"sha256":["ab12…","…"]}      // ≤ 256 digests per event
fs.transfer.done event     {"transferId":"t-…","ok":true,"bytes":1073741824,"elapsedMs":…,
                            "verified":true,"sha256":"<whole file as read>","blockSize":1048576,
                            "blockCount":1024,"manifestRoot":"<sha256 over the 1024 raw 32-byte digests, in order>"}
failure                    fs.transfer.done {"ok":false,"code":"SOURCE_CHANGED","message":"… changed on the phone while it was being sent …"}
```

`blockSize` is the phone's, by one rule both sides can recompute: the smallest power of two from
**128 KiB to 16 MiB** giving **≤ 2000 blocks**, and 16 MiB when none does (Syncthing BEP v1's sizing; the
idea, not code). So 100 MiB → 128 KiB (800 blocks); 1 GiB → 1 MiB (512 KiB would give 2,048); 500 GB → 16 MiB and
29,803 blocks (≈ 2 MB of digests over ≈ 117 events — well inside the 16 MiB control-frame cap).

## 3 · Security rules

- **S1 — Nothing new without negotiation.** Every field and event above is refused (logged, ignored)
  when `fs.blocks` was not negotiated for the session.
- **S2 — Session binding is unchanged (defect 148).** A `transferId` is claimable only by the session
  that received its ack. A resume is always a **new** `fs.transfer.begin` in the current session with a
  new `transferId`; no old id is ever reactivated.
- **S3 — A resume record belongs to one paired phone.** The Mac keeps it in **app-private storage**
  (`userData/pull-resume/`, not the Downloads folder), keyed by the phone's pinned certificate
  fingerprint + `rootId` + document `id`, and holding `{name, size, mtimeMs, blockSize, verified block
  digests, partial path}`. Forget or re-pair drops every record and deletes **only** partials carrying
  Sidekick's suffix (defect 151). A record is never offered to a different phone.
- **S4 — The phone does not trust the Mac's prefix.** It accepts `resume` only when its current
  `size` and `mtimeMs` equal the request's **and** its own hash of the first `verifiedBlocks` blocks,
  read from the source now, reproduces `prefixRoot`. Otherwise `resume.accepted: false` with a reason
  (`source-changed`, `prefix-mismatch`, `bad-request`), and the Mac deletes its partial and record
  before starting from 0. (Recommended default — owner's choice D1.)
- **S5 — The Mac does not trust its own partial on disk.** Before asking to resume it reads the partial
  back, re-hashes the first `verifiedBlocks` blocks and compares them with its record; any difference,
  or a partial shorter than `verifiedBlocks × blockSize`, deletes the partial and record. It then
  **truncates** the partial to exactly `verifiedBlocks × blockSize` (an unverified tail is never kept).
- **S6 — Offsets are only ever block-aligned and inside the file.** `resume.from = verifiedBlocks ×
  blockSize`, `0 < from < size`; the bulk header's `offset` must equal the ack's `resume.from` (or 0 when
  not accepted). Anything else is refused and the socket closed, entry kept (the `BulkClaim` pattern).
- **S7 — Every count is bounded and exact.** `blockSize` must equal the rule in §2; `blockCount =
  ceil(size / blockSize)`; digests are 64 lowercase hex; ≤ 256 per event; `first` must equal the next
  expected index (no gaps, no repeats, no out-of-order). A violation fails the transfer and deletes the
  partial and record.
- **S8 — Publish only after full agreement.** The Mac publishes (exclusive rename, defect 150,
  unchanged) only when: every block's bytes match the phone's digest for it; the count equals
  `blockCount`; the Mac's own root over the verified digests equals `manifestRoot`; the Mac's own
  whole-file SHA-256 equals `sha256`; `bytes == size`; and `fs.transfer.done` said `ok: true`. The Mac
  therefore **waits for `fs.transfer.done`** before publishing a block-verified pull (today it publishes
  on reaching the byte count). A missing `done` within 30 s of the last byte keeps the partial as paused.
- **S9 — A torn source is a failure, not a success.** The phone re-reads size and last-modified before
  the first byte and after the last; a change sends `SOURCE_CHANGED`; the Mac deletes partial and record
  and leaves a `.failed` sidecar (the `CHECKSUM_MISMATCH` treatment — a torn file is worse than none).
- **S10 — Space.** L3's up-front refusal stays. Added: the Mac re-reads free space every 1 GiB received
  and **pauses** (cancel the bulk socket, keep partial + record) when free space falls below
  `remaining bytes + 1 GiB`. It never publishes a partial file and never fails at 90 % with the bytes
  thrown away.
- **S11 — Records expire.** 7 days, or 16 records, whichever first (owner's choice D3); the oldest is
  dropped with its Sidekick partial. Expiry is logged with the name, size and age.
- **S12 — Logs.** Block digests are never logged individually; a line carries counts (`512 of 1024
  blocks verified`) with the denominator, per the counter rule.

## 4 · Behaviour and the honest UI (Files pane card)

| Situation | Card says | On disk |
|---|---|---|
| receiving, blocks verifying | *Receiving · 412 MB of 1.07 GB · every block so far matched* | Sidekick partial |
| link drops / phone sleeps | *Paused — the phone disconnected. It resumes from 412 MB when the phone is back.* | partial + record |
| Mac space runs low | *Paused — not enough space on "Macintosh HD": 1.2 GB more is needed* | partial + record |
| person presses **Pause** | *Paused* + **Resume** | partial + record |
| person presses **Cancel** | *Cancelled — nothing was saved* | partial + record **deleted** (owner's choice D2) |
| resume refused: source changed | *The file changed on the phone since it paused, so it started again from the beginning* | new partial |
| finished, all checks passed | *Arrived · verified block by block* (distinct from ≤ 64 MiB's *checksum matched*) | the file, exclusive name |
| older phone | *Arrived · not verified* (today) | the file |
| torn source | *Not saved — the file changed on the phone while it was being sent* | `.failed` sidecar |

Automatic resume happens **only within the same run of the Mac app and within 10 minutes of the drop**;
after that, or after a restart, the card shows *Paused* with **Resume** and nothing moves without a click.

## 5 · Decisions I need from you

| # | Question | Recommended | Alternative |
|---|---|---|---|
| **D1** | On resume, may the phone **seek** and trust size + mtime, or must it **re-hash the skipped prefix**? | **Re-hash** (S4). It is what today's resume already costs — the phone reads the prefix anyway — and it is the only rule that proves the resumed bytes still match | Seek: fast for a 400 GB prefix, but a same-size same-mtime rewrite would splice two files |
| **D2** | Does **Cancel** keep the partial for later (today's contract text) or delete it? | **Two buttons: Pause keeps, Cancel deletes** | Cancel keeps (a person who cancels a 300 GB file finds 150 GB still on disk) |
| **D3** | Record lifetime | **7 days / 16 records** | shorter/longer |
| **D4** | Release gating | **Dev builds only**, `FS_BLOCKS_RELEASE` off, flipped in its own commit | ship with the next release |
| **D5** | Where the partial lives | **Destination folder** (same volume → atomic exclusive publish; today's convention) | app-private (costs a cross-volume copy at the end, doubling space) |

## 6 · Slices and the bounded tests (each committed separately; each red-first)

1. **Contract + fixtures**: `docs/protocol.md` text, `fs-blocks.json`, both parsers, `blockSize` rule
   tests (100 MiB → 128 KiB, 1 GiB → 1 MiB, 500 GB → 16 MiB, 2000-block boundary both sides).
2. **Phone sender**: per-block hashing while streaming, `fs.transfer.blocks` batching, the manifest on
   `done`, the before/after re-stat. JVM tests over an in-memory source; mutation: drop a block event,
   reorder two, change mtime mid-stream.
3. **Mac receiver**: block verification as bytes land, wait-for-`done` publish, *verified block by
   block*. Tests with a fake bulk stream; the existing `corruptIfArmed` probe flips one byte on the phone
   → the Mac names the failing block. **Hardware: 96 MiB and 256 MiB pulls, SHA-256 of the saved file =
   the phone's `sha256sum`.**
4. **Resume**: Mac record + read-back + truncate; phone prefix re-hash; `resume` request/ack. Hardware:
   cut a 256 MiB pull at 50 % with the existing `interruptAfterBytes` hook, resume, SHA-256 equal; then
   `touch` the synthetic source between cut and resume → *started again from the beginning*.
5. **Space + Pause/Cancel + reconnect**: fake `statfs` tests; hardware pause by a genuinely small
   destination — a 300 MiB APFS disk image as the Files destination for a 256 MiB pull after filling it to
   leave < 1 GiB margin (bounded, removable, not the system disk).
6. **One bounded long run**: 1 GiB, with a Wi-Fi drop in the middle. No larger size is claimed.

Synthetic sources only, generated on the phone under `Download/ConnectSuite/` and deleted by name at the
end of each slice; no personal file is ever read.
