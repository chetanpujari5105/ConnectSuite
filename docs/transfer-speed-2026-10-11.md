# Transfer speed — 2026-10-11 (UX batch, section 6)

> **Verdict: Sidekick moves files at the speed of the link it is on, in both directions, with every
> check on. Nothing was changed, because nothing measured was Sidekick's.** The ~10 s you saw for a
> ~630 MB file is this phone's hotspot in its slower state; the ~2 s you remember was a 96 MiB file
> (or a loopback harness), and 2 s for 631 MB is above what this link can physically carry.

## 1 · The link actually in use

Read from both ends, 2026-10-11:

| | Reading |
|---|---|
| Topology | **the Mac is on the phone's hotspot.** The phone's Wi-Fi client is off (`SSID <unknown>`, `IP null`); the phone serves `swlan0` at 10.51.59.236; the Mac (10.51.59.160) has it as its default gateway |
| Band and standard | phone `SoftApInfo{frequency=5745, bandwidth=80 MHz, wifiStandard=6}` — channel 149, 5 GHz, **Wi-Fi 6 (802.11ax)**; the Mac agrees: `802.11ax, Channel 149 (5GHz, 80MHz)`, −38 dBm |
| PHY rate (Mac) | **1,200 Mbit/s at 02:00, 600 Mbit/s at 10:40** — same channel, same signal. The link's rate itself moved by 2× while being measured |
| USB tether | not in use (the phone's only other address is mobile data, `rmnet_data0`) |

## 2 · Raw network speed — no Sidekick code

`nc` on the phone (toybox), a Python socket on the Mac, 512 MiB of zeros per run, timed to the far end
closing (bytes delivered, not queued). Plain TCP, no TLS.

| When | phone → Mac | Mac → phone |
|---|---|---|
| 02:00 (PHY 1,200) | 641 / 662 / 691 Mbit/s (80–86 MB/s) | 701 / 713 / 780 Mbit/s (88–98 MB/s) |
| 10:40 (PHY 600) | 411 / 423 Mbit/s (51–53 MB/s) | 296 / 298 Mbit/s (37 MB/s) |

## 3 · Sidekick, the same file, through the product's own paths

A **synthetic** 631,000,000-byte random file (SHA-256 `96825b90689be00d…`) made for this test and
deleted afterwards on both devices. Every copy hashed equal to the source.

| Run | Path | Time | Rate | Raw link at that moment |
|---|---|---|---|---|
| 02:07, phone → Mac | Files pane pull, **block-verified** (1,204 × 512 KiB blocks, every one matched; whole-file SHA-256 equal) | phone sent in **6,614 ms**; Mac received and verified in **6,709 ms**; click → saved **6,810 ms** | 752 Mbit/s ≈ **93 MB/s** | 641–691 Mbit/s |
| 10:38, Mac → phone | Files pane **Send to phone** (picked by the owner — a script cannot nominate a file, S4), digest agreed in advance | Mac hashed 631 MB in **482 ms** first; phone received and verified in **17,593 ms**; publish 66 ms | 287 Mbit/s ≈ 36 MB/s | 296–298 Mbit/s |
| 10:45, phone → Mac | same pull, again | **11,895 ms** wire; click → saved 11,952 ms | 424 Mbit/s ≈ 53 MB/s | 411–423 Mbit/s |

**Sidekick runs at 97–100 % of the raw link in every pairing, and above my plain-TCP reader in the
02:07 run.** TLS 1.3, pinning, block verification and the SHA-256 checks cost nothing measurable here.

### The split you asked for, and how far it can honestly go

| Stage | Reading | Is it the bottleneck? |
|---|---|---|
| phone read (storage) | 4.5 GB/s from the page cache — shell cannot drop caches, so this is **not** a cold-storage figure | no |
| phone write (storage, push) | 565 MB/s – 0.9 GB/s through FUSE in 256 KiB writes (`dd … conv=fsync`) | no |
| TLS send + network | equals the raw link above, to within 3 % | **the link is the limit** |
| Mac receive + hash + write (pull) | the Mac's own timer (6,709 ms) is within 1.5 % of the phone's send timer (6,614 ms) for 631 MB — hashing and writing keep pace with arrival | no |
| Mac pre-hash (push) | 482 ms for 631 MB (1.3 GB/s), before the first byte is sent; it is what lets the phone verify against a digest agreed in advance | 2.7 % of the push; not worth weakening the check |

A finer in-process split (time inside TLS vs inside the socket per frame) would need instrumentation in
the transfer loops; it was not added, because the end-to-end figures already equal the link and so
there is no time left over for any stage to be hiding.

## 4 · Your earlier numbers, explained

| What you remembered | What the record shows | Comparable? |
|---|---|---|
| ~10 s for a ~631 MB file, phone → Mac (≈ 63 MB/s) | 2026-10-10 13:29: `20261010_115439.mp4`, **617,894,529 bytes in 7,935 ms on the wire (623 Mbit/s)**, same hotspot (10.51.59.236), pulled before the block path existed for it (`verified=false`) | yes — the same route; a few seconds of difference is the link's state (§1) |
| ~2 s for "a similar file" (≈ 315 MB/s ≈ 2.5 Gbit/s) | 2026-10-09: **a 96 MiB file** (100,663,296 B), block pull, **1,732 ms wire / 2,089 ms click → done** (465 Mbit/s) — `docs/RESUME.md`. And 2026-09-29: a **loopback harness** (no Wi-Fi, no TLS, one machine) moved 64 MiB in 160 ms (≈ 410 MB/s) — `docs/transfer-overnight-2026-09-29.md` §5 | **no.** The first is a file 6.6× smaller at the same per-second rate; the second never left the Mac |

2.5 Gbit/s is twice this link's best PHY rate (1,200 Mbit/s) and about three times its best measured
TCP throughput. To get there you would need a faster link — a Wi-Fi 6E/7 network at 160 MHz both
devices support, or a wired route — not a faster Sidekick.

## 5 · What was tried, and why nothing was changed

Each idea from the brief was weighed against the readings above:

- **Larger socket buffers / chunk sizes, fewer small writes** — the Mac already sends 256 KiB frames
  with up to 4 MiB queued; the phone already reads whole frames with `readFully`. At 97–100 % of the
  link there is no headroom for them to recover.
- **Hashing on a worker thread in parallel with receive** — the Mac's receive timer equals the phone's
  send timer; hashing is not delaying arrival.
- **Avoiding double reads** — on the pull, the phone's log shows `fs.transfer.begin` at 02:07:34.385 and
  the last byte sent 6,614 ms later, so no separate pre-read phase precedes the send; the push's pre-hash
  is one extra read of the source on the Mac (482 ms), kept because it is the advance-agreed digest.
- **TLS cipher choice** — no gain is available: the TLS path already equals plain TCP.
- **Progress updates over 4 per second** — a pull's progress tick redraws only the detail panel
  (`FilesView.onPullProgress`), and the transfers finish at link speed regardless.
- **Staying on 5 GHz** — the link already is on 5 GHz (channel 149). Its rate halving between 02:00
  and 10:40 happened on 5 GHz, at −38 dBm.

**Nothing in TLS, pinning, block verification, SHA-256 or resume was touched.** Instruments:
`scripts/files-load-profile.mjs` is unrelated; the pull and push here went through the Files pane's own
`copyToMac` and *Send to phone* (`scripts/transfer-speed-probe.mjs` cannot push since S4 requires a
person-chosen file — recorded, not worked around).

---

# Second sitting, 13:15–14:20 — the share path timed end to end, and every candidate tried

> **Verdict.** Your video took 11.1 s on the wire because the hotspot was carrying ~430 Mbit/s at that
> moment, and Sidekick moved it at that speed. Around that sat ~1–2 s of staging, which runs while the share
> sheet is open, and your own 1.4 s and 19.3 s. **Phone → Mac has no headroom left in the app**: one
> Sidekick stream matches four raw TCP streams. **Mac → phone does**: in today's link state one stream gets
> about half of what four do, and Sidekick's push uses one. A multi-stream push is designed in §9 and **not
> built**. One instrument change shipped: the staging copy now logs its duration and where it went.

## 5 · Your video, 12:36, and the same size again at 13:58

Both logs, millisecond timestamps, each event from the side that owns it. *Wire* is the Mac's own timer,
from the bulk socket being claimed to the file flushed, SHA-256-verified against the digest agreed in
advance, and published. That is receiver-confirmed, not bytes the phone queued.

| Step | Your video (595,001,919 B, `video/*`) | Synthetic, same size (`speed-595mb.mp4`) |
|---|---|---|
| sheet opened → staging copy finished | **not logged** in that build; ~1.0–2.3 s by the runs in §6 | 13:58:22.667 → 24.952: **2,278 ms** (read 1,020 · hash 516 · write 590) |
| *you: copy ready → Send* | *1.40 s* | *6.82 s* |
| Send → offer shown on the Mac | 12:36:42.837 → .862: 25 ms | 13:58:31.770 → .971: 201 ms (offer valid at +104 ms) |
| *you: Accept* | *19.3 s* | *12.0 s* |
| Accept → bulk socket claimed | 12:37:02.172 → .233: 61 ms | 13:58:43.936 → 44.008: 72 ms |
| **wire** (claimed → verified, published) | **11,084 ms — 429 Mbit/s** | **10,202 ms — 467 Mbit/s** |
| published → phone acknowledged | 12 ms | 8 ms (Mac), phone ack 54.198 |
| **total, people excluded** | **~11.2 s + staging** | **12.66 s** |
| received copy SHA-256 = source | yes (the phone's digest matched) | yes, `ae87411c…` |

Link and phone state. 12:36: hotspot, 5,745 MHz (channel 149), 80 MHz, Wi-Fi 6; phone **on battery**,
60 %, discharging, battery saver off, screen on. 13:58: the same hotspot; phone **charging over USB** (the
cable was plugged in for adb), 46–47 °C, thermal status 1; Mac transmit rate 576–1,080 Mbit/s across the
sitting at −35 dBm. Share path in both, not a Files pull. No USB networking: adb only.

## 6 · Staging (the share path's private copy) — the part your log could not show

Added in this sitting: `staging started` and `staged … in N ms (read · hash · write; buffer)`, inside
`ShareStaging.copy` with `System.nanoTime` around each call (`ShareStagingTest` +1, red when the read timer is
removed). Headless runs opened Sidekick's share sheet with `am start` on synthetic videos and pressed Back
after the copy (no offer). The files had just been written, so those reads are **warm** (page cache); the
first shared run at 13:58 read cold-er (1,020 ms read).

| File | 64 KiB buffers (shipped) | 1 MiB buffers (tried) |
|---|---|---|
| 4 MB | 8 ms; 14 ms in the 14:17 share | — |
| 100 MB | 157 ms; 269 ms in the 14:15 share | 241 ms |
| 595 MB | 1,056 · 1,778 · 1,153 ms; 2,278 ms in the 13:58 share | 1,029 · 1,146 · 1,335 ms |

**1 MiB: not kept.** The ranges overlap, and the 100 MB copy got slower. **Hashing on a second thread: not
built.** The hash is 260–520 ms of a copy that runs before Send can be tapped, inside run-to-run noise of
±600 ms, and it is the copy whose digest the Mac verifies against. The prize is at most ~0.5 s of a 12 s
share, and only when the person taps Send faster than the copy finishes.

## 7 · Raw ceiling — plain TCP, no Sidekick (`scripts/raw-link-speed.mjs`)

Toybox `nc` on the phone (pinned), Node on the Mac. *Up* is phone → Mac, timed to the last byte the Mac
read; *down* is Mac → phone, timed to the phone closing each stream after reading everything, with the
phone's own byte count required to equal what was sent. In Mbit/s, in time order.

| When | up, 1 stream | up, 4 streams | down, 1 stream | down, 4 streams |
|---|---|---|---|---|
| 13:2x | 365 · 315 | 378 · 401 | 101 · 113 | 222 · 250 |
| 13:2x, control (phone writes to `/dev/null`, no count) | — | — | 95 · 117 | 191 · 199 |
| 13:4x, alternating 1/4 | 228 · 300 · 280 | 408 · 305 · 241 | 155 · 84 · 64 | 233 · 191 · 199 |
| 14:00, right after the 595 MB share | 437 · 359 | 465 · 482 | — | — |
| 14:06, right after the pushes | — | — | 109 · 112 | 205 · 207 |
| 14:13, right after the pulls | 421 · 490 | — | — | — |

- **Up: four streams do not reliably beat one.** Run-to-run spread (228–437 on one stream) is larger than
  any one-versus-four difference.
- **Down: four streams beat one by 1.5–3× in every pairing this afternoon.** This morning one stream did
  296 Mbit/s down (§2), so the single-stream deficit is a property of the link's state, not a constant.
- Not the buffers: phone `tcp_rmem` 2 / 6 / 16 MB, Mac send autotune to 4 MB; at ~600 Mbit/s and a few ms
  of RTT one stream needs well under 1 MB in flight. Not the instrument: the uncounted control reads the
  same. Loss: **no reading.** `netstat -s` on this Mac returns zero for every counter.
- Instrument faults, recorded: the first version fed the phone's `nc` from `sleep 120`, which held each
  pipeline open after `nc` exited, so three of four down runs had unprinted counts. The script refused them
  as `phone count mismatch` rather than printing a rate. Fixed with `</dev/null` plus `allowHalfOpen`.

## 8 · Sidekick against that ceiling, by size and direction

Receiver-confirmed throughout. The share and pull lines are the Mac's timer; the push lines are the phone's
`fs.transfer.done` timer (its own verdict after hashing what landed). Every copy's SHA-256 equals its source.

| Size | Direction · path | When | Wire | Rate | Raw at that moment |
|---|---|---|---|---|---|
| 4 MB | phone → Mac · share | 14:17 | 116 ms (Accept → saved 173 ms) | ≈ 280 Mbit/s (start-up dominates) | — |
| 100 MB | phone → Mac · share | 14:15 | 1,221 ms | **687 Mbit/s** | link in its fast state (Mac Tx 648–864) |
| 100 MB | phone → Mac · Files pull, block-verified | 14:12 | 1,974 ms | 425 Mbit/s | up 1-stream 421 · 490 |
| 595 MB | phone → Mac · share (synthetic) | 13:58 | 10,202 ms | 467 Mbit/s | up 1: 359–437 · 4: 465–482 |
| 595 MB | phone → Mac · share (**your video**) | 12:36 | 11,084 ms | 429 Mbit/s | not measured then; §2's slow state read 411–423 |
| 595 MB | phone → Mac · Files pull, block-verified | 14:12 | 10,549 ms | 451 Mbit/s | up 1-stream 421 · 490 |
| 100 MB | Mac → phone · Files push | 14:04 | 10,723 ms | 78 Mbit/s — **shared**: ran alongside the 595 MB push | — |
| 595 MB | Mac → phone · Files push | 14:04 | 42,423 ms | **112 Mbit/s** | down 1-stream 109 · 112; 4-stream 205 · 207 |

The push's Mac pre-hash was 167 ms (100 MB) and 566 ms (595 MB), done before the first byte.
**No before/after columns exist for the wire: nothing on it was changed**, because nothing measured on it
was Sidekick's. The one shipped change is the staging timing line, and it changes no timing.

**Already in place, so not "fixes":** a `WIFI_MODE_FULL_HIGH_PERF` lock for the link's whole life
(`LinkService.kt`, irrelevant on a hotspot where the phone is the access point), progress at 4/s on the
phone (`PROGRESS_INTERVAL_MS = 250`) and coalesced to 120 ms on the Mac (display only; the Mac's receive
timer ends within 232 ms of the phone's send timer, publish included), 256 KiB frames, a single read of
the source on each side with the hash taken inline, and TLS that equals plain TCP (§3).

**What depends on your network, not the app:** every rate above moved by 2× within the hour on one
hotspot, at one signal level, with nothing in Sidekick changing. The fastest Sidekick number today (the
100 MB share at 687 Mbit/s) and the slowest (the 595 MB push at 112) came from the same build.
A Wi-Fi 6E/7 router at 160 MHz, or a wired path, raises the ceiling; the app cannot.

## 9 · Design, not built: a multi-stream push for Mac → phone

**The measured case for it.** In today's link state one Mac → phone TCP stream carried 64–155 Mbit/s and
four carried 191–250, and Sidekick's push equalled the single stream (112 against 109–112). Four streams
would have taken the 595 MB push from ~42 s to ~23 s. **The measured case against building it today:** the
gain belongs to a link state. This morning one stream did 296 Mbit/s down with Sidekick at 287, and no
four-stream reading exists for that state. It is also zero for phone → Mac.

**Why it is not a small patch.** The phone's push receiver is built on four single-stream facts, and each
one carries a defect's worth of history:

1. the partial is **append-only** (`"wa"` on SAF; a pending `MediaStore` row on Received files);
2. resume is **one contiguous prefix** (`fs.transfer.begin` → `offset`; the Room record);
3. the digest is **fed in arrival order**, from byte 0 (the resume read-back exists for exactly this);
4. defect 56's verdict, **length before digest**, is decided over that prefix (`FsPartials.arrivalVerdict`).

**The shape that keeps every check:**

- Negotiated as an `ext` (`fs.streams: N`, N ≤ 4), so an old peer on either side gets today's
  single stream. Automatic: no setting. Used only for a push ≥ 64 MiB into a root whose partial supports
  positional writes (Received files first; SAF only where `openFileDescriptor("rw")` is proven per
  provider).
- The Mac's existing pre-hash pass also emits **one SHA-256 per range** (the same read; no second pass).
  The ranges go in `fs.transfer.begin`, are agreed in advance, and cover the file exactly.
- Each range gets its own bulk socket, each authorised by the session token like today's. Each range's
  bytes are hashed as they arrive and **checked against its agreed digest at the end of the range**, the
  block idea the pull path already proved, at range size.
- The whole-file SHA-256 the contract promises today stays: one read-back on the phone after the last
  range (~0.3–1 s for 595 MB, by the staging reads in §6), checked before publication. That is cheaper than
  the ~19 s it would save in today's state, and it keeps `verified=true` meaning what it means now.
- Resume becomes **a set of finished ranges plus one prefix per unfinished range**, in the record.
  Defect 56's rule applies per range: short means resumable, never corrupt.
- Cancel, Pause and session end stop **every** range socket (defect 157's rule, per socket).

**Precondition before any code:** a four-stream raw reading in the *fast* down state, so the gain is known
for the state you are usually in. Then the contract change in `docs/protocol.md`, then both sides.
Estimated as its own batch, with resume and the hardware steps B8 and T3 re-run.
