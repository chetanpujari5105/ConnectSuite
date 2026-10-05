# Snapshots — held privately, not in the repository

The before/after snapshots of this run hold the phone's permission grants, secure-setting bindings,
preference hashes, the pairing fingerprint, the receive folder's file names, and the Mac's protected
paths. They are **kept outside version control**, beside the 2026-10-04 original report:

`~/.connectsuite-evidence-private/camera-v2-encoder-spike-2026-10-05/` — directory 0700, files 0600,
18 files, `SHA256SUMS` (itself SHA-256 `08fd93334e9d38f94546497270f4fe6979cb00456c3800a0d3a53ff09ff15432`), verified before the repository copies were removed.

Taken by `docs/evidence/camera-v2-encoder-spike-2026-10-04/snapshot.sh` (read-only; phone reads through
the pin), before the relaunch with the spike switches and after the normal relaunch.

| Compared, before → after | Result |
|---|---|
| phone permissions (27 granted), bindings, preference hashes, preference file names | identical |
| phone pairing (one Mac row, read with the WAL) | identical |
| phone receive folder entries and `.failed`/`.part`/`.pending` markers (0) | identical |
| Mac protected files — the `.failed` marker, the paused-pull record, the identity, the share probes | identical in hash, size, mtime and inode |
| Mac `sidekick.json` | same hash and size; new mtime and inode (the app rewrites it at launch) |

The "before" snapshot was also identical, in every phone file and every protected Mac file, to the
2026-10-04 run's.
