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
