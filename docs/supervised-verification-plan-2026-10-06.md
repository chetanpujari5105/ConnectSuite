# Supervised verification — preflight and staged plan (2026-10-06)

> **Status (updated 2026-10-07 00:20): A0–A4, B/H4 and C step 2 (Mac Disconnect/Connect) DONE — the Mac
> runs `4661015`, the phone runs `286e2b0` (`5f014e9e…`), the pair is **v2** on both sides. C step 3 (phone
> Wi-Fi toggle) NOT approved; H4b NOT approved.** **Stage D ran partially and STOPPED at step 6 (§9.10):** steps
> 1, 2 (offer), 4, 5 pass; 3 not runnable (macOS refused the banner); 6 failed — no Send-to-Mac dispatch on the
> retry; 7–8 not run. E/F NOT approved. Open findings: §9.9, §9.10. A4's startup clipboard
> event did **not** occur and its cause is unresolved (§9.6). A0 turned
> the Mac clipboard watcher off (§8); A1's USB checks and A2a's code-only rollback copy are §9. The earlier
> live-dist hash `4f40b0e9…` is **unresolved** (§9.3); the rollback baseline is `f862a1ae…`. No install, relaunch, Activity rewrite, clipboard change, Forget or re-pair
> has happened. **Clipboard method chosen: M1.** **The Mac artifact was rebuilt after defect 191** — the
> `286e2b0` Mac build below is **SUPERSEDED** and must not be installed. Every stage below needs its own approval;
> approving one approves nothing after it. Supersedes the *order* of `docs/pairing-v2-hardware-test-proposal.md`
> (H1–H12) and `docs/s7-hardware-verification-proposal.md` (V0–V11); their pass criteria still apply.
> Evidence for this file: `docs/evidence/verification-prep-2026-10-06/`.

## 1. Preflight findings (read-only, 2026-10-06 17:01–17:15 IST)

| Item | Finding |
|---|---|
| Live Mac instance | **PID 91450** (`Electron .`, cwd `desktop/`, launcher PID 91445), started **2026-10-05 12:51:08**, flags `--force-renderer-accessibility --remote-debugging-port=9222`, no `CONNECTSUITE_*` variables (all debug switches off). User data: `~/Library/Application Support/sidekick-desktop/` |
| Code it runs | `desktop/dist`, built **2026-10-04 17:09:41**, manifest recorded then as `4f40b0e9…` by an **unrecorded procedure that no longer reproduces** (§9.3); measured
22:41 by the §9.2 procedure as `f862a1ae…` (274 files) and copied as the rollback baseline. It predates **29** Mac commits: none of S1, S2, S2b, S3, S4, S6, S7, defect 190, or the Activity call-data rewrite is running |
| Link | Connected to the SM-S938B over Wi-Fi since 16:42 (Mac log). Stored pairing is **legacy** (`paired` has no `pairing: 2`) |
| **Clipboard watcher** | At preflight **`watchClipboard = true`**. **Off since A0 (18:23:46)**; re-verified 22:3x without reading content: setting `False`, IPC `watching=false`, 0 poll/send/apply log lines since the stop (§9.1) |
| Phone | **Read 2026-10-06 22:26** (`phone-readonly-2026-10-06.md`): debug build only, versionCode 1, `lastUpdateTime` **2026-10-04 17:08:34** (predates every phone commit since 10-05), signer `d3a505d2…7d26` = the new APK's, declared permissions identical, user 0 holds all 14 runtime grants; user 95 has the package with no grants; user 150 is a protected profile without it. Installed `base.apk` (`b0ad2a47…`) pulled as the rollback copy. **22:30 additions (§9.1):** no splits (`splits=[base]`); the pulled copy's hash equals one computed on the phone; full manifests identical; notification listener bound; **accessibility service off** (`accessibility_enabled=0`) — already off before this plan |
| Legacy migration marker | `legacy-migration.json`: settings, activity merge and re-pair decision all recorded (2026-09-18) — none run again |

## 2. Artifacts

**Current, to be used:**

| | Mac | Android |
|---|---|---|
| Source revision | **`46610155eb31a796b9ffb475b2c9345ed36df8cb`** (`4661015`, defect 191 fixed) | `286e2b0` — **unchanged and still valid**: no phone module, Gradle, contract (`docs/protocol.md`) or `desktop/src/shared` file changed between `286e2b0` and `4661015` |
| Hash | manifest `bb5941689b8ef4e6d9137cd13e5db0bf28732bba360a6c2441b0b50fd39a524d` (`mac-dist-manifest-4661015.sha256`), 308 files; differs from the superseded build **only** in `main/activity.js` and its map | APK SHA-256 `5f014e9e0b0172ae8ff8cadf3551f5847f9682699535323947607bfd642530ad` |
| Pinned copy | `<scratch>/mac-build-4661015/desktop/dist` | `<scratch>/artifacts/sidekick-debug-286e2b0.apk` |

**Superseded (kept for the record, do not install):** the first table below describes the `286e2b0` Mac
build; its manifest is now `mac-dist-manifest-286e2b0-SUPERSEDED.sha256`.

### 2a. First build, from `286e2b0` (Mac half SUPERSEDED by `4661015`; Android half current)

| | Mac | Android |
|---|---|---|
| What | compiled `dist/` (308 files), the dev-Electron app the live instance runs | `app-debug.apk` |
| Built by | `git archive HEAD desktop` into scratch, `node_modules` symlinked, `npm run build` (exit 0) | `./gradlew :app:assembleDebug --rerun-tasks` (150/150 executed, exit 0) |
| Hash | manifest of per-file SHA-256: `0051f15b91be8bc1c00597d0c6357cc8cb1e7f7cc842e23f6db1b64cba8bb67d` (`mac-dist-manifest-286e2b0-SUPERSEDED.sha256`) | SHA-256 `5f014e9e0b0172ae8ff8cadf3551f5847f9682699535323947607bfd642530ad`, 94,856,261 bytes |
| Pinned copy | `<scratch>/mac-build-286e2b0/desktop/dist` | `<scratch>/artifacts/sidekick-debug-286e2b0.apk` |
| Identity | — | `com.chetan.connectsuite.debug`, versionCode **1**, 2.0.0, target 36, **debuggable**; v2 signer `CN=Android Debug`, SHA-256 `d3a505d2…7d26` = `~/.android/debug.keystore` (2026-04-08) = the installed APK's signer as recorded earlier in `docs/testing.md`. No key was created |

The scratch directory is session temporary storage; if it is gone, both artifacts rebuild from `286e2b0`
and must reproduce these hashes (the APK hash may differ across builds — compare the signer and
package, and record the new hash).

**What they contain** — Mac: S1/S2/S2b-side pinning, S3, S4 + defect 190 (drop sheet), S6, S7 offers,
U1 layout, the Activity call-data rewrite (`0555c3e`, `87a8b29`), call-log/SMS/notification-key log
privacy. Phone (12 commits since 2026-10-04 17:09): S7 origin, pairing v2 + "Code scanned. Verifying
your Mac…", S2b, S6, SMS/contact/call log privacy, `webcam.keyframe`.

**Gates as these two run together (a development pairing, not the release one):** Mac unpackaged with
no switches — `fs.blocks 1`, `share.wait`, `share.ask` and `share.file 3` **advertised** (unpackaged
rules; `SHARE_PRODUCTION_READINESS` is true); webcam, encoder spike, incoming-call banner and every
debug switch **off**. Phone debuggable — `share.file 2`/multi-file and camera v1 may be advertised; they
act only on an explicit share or a camera request, neither of which this plan performs. No gate is changed.

## 3. Startup effects of the new Mac build — current code, synthetic fixtures

Files a relaunch writes, by name (everything else in the profile is read-only to it or untouched):

| File | Effect | New? |
|---|---|---|
| `logs/activity.jsonl` (542.5 KB) | **One-time call-data rewrite** (below), then the usual appended `Sidekick started` row and later events | rewrite is new; appends are not |
| `logs/activity.jsonl.rewrite` | temporary; written then renamed over `activity.jsonl` (new inode); removed on failure | new |
| `logs/activity.jsonl.old` | absent today — would be rewritten under the same rule if it existed; created only at the 1 MB rotation | — |
| `logs/sidekick.log` (+ rotation to `.1` at 512 KB) | appended | no |
| `sidekick.json` | `lastAddress`/`lastDiscoveryVia` on each connect; `paired` only on Forget/re-pair; `watchClipboard` only if toggled. **No new defaults**, so opening it does not rewrite it | no |
| `pull-resume/e78d…json` | 7-day sweep at start; this record is from 2026-10-01 23:40, so it is **kept** until 2026-10-08 23:40 | no |
| `DevToolsActivePort`, Chromium profile files | ordinary Electron housekeeping | no |

**Not touched:** `legacy-migration.json`, `identity/`, `activity.jsonl.pre-migration` (16.8 KB),
`activity.jsonl.pre-seq-repair` (230.9 KB), the whole `connectsuite-desktop/` folder. The two backups and
the old folder's `logs/activity.jsonl` may still hold call numbers; this rewrite does not reach them
(S11b, an owner decision).

**Superseded by defect 191 (`4661015`).** The behaviour measured below is the `286e2b0` build's, and it is
why the Mac was rebuilt. The current behaviour is in §3a.

**The rewrite as first measured, on synthetic fixtures through the `286e2b0` `ActivityStore`**
(`activity-rewrite-synthetic.txt`; 9 lines including a call row with a number, names, an unknown
field, a different key order, digits in an SMS row and two broken lines):

- a call row whose detail is a number → detail becomes **"Unknown number"**; a contact name is kept;
- **every call row whose bytes differ from the store's own serialisation is re-written** — so a call row
  with an extra field **loses that field**, and one with a different key order is re-serialised even
  though its name is unchanged (both are counted as "brought under the rule");
- a broken line is kept, **unless** it may hold call data (mentions `calls`, or has a 5+ digit run outside
  `seq`/`at`), in which case it is **deleted**;
- **every other readable row is kept byte for byte**, extra fields included; digits in non-call rows are
  not touched (an SMS row's numbers are out of scope);
- **refused write** (read-only folder): the file is left byte-identical, the pane still gets every event,
  the warning carries the counts, and it is retried at the next launch;
- **second launch:** no rewrite (idempotent).

**Irreversible:** the rewrite keeps no backup by design (a backup would keep the numbers). After it, the
original call details, the extra fields on call rows and any dropped broken call lines cannot be
recovered from this Mac. **How many live rows it changes is unknown** — counting them means reading the
live file, which needs your separate approval (a read-only dry run on a private copy, counts only, copy
deleted afterwards). No personal-data backup has been or will be made automatically.

### 3a. The rewrite in the current Mac artifact (`4661015`, defect 191)

Same synthetic fixtures plus two more rows (`activity-rewrite-synthetic-after-fix.txt`):

- a call row is changed **only** when its non-empty `detail` is a number (or carries one): only `detail`
  becomes "Unknown number"; every other field, value and the key order stay;
- every other call row is kept **byte for byte** — names, extra fields, other key orders, empty or
  `unknown` details;
- a call row with an **unknown field that may hold call data** is kept unchanged and **reported** on every
  load (`… carry an unknown field that may hold call data (fieldNames) — kept unchanged, not redacted: a
  policy decision is needed`), names and count only;
- unchanged: non-call rows exact; broken lines that may hold call data dropped, others kept; a refused
  write leaves the file byte-identical and is retried; a second launch is a no-op.

Still irreversible for the rows it does redact, and still unknown how many live rows that is.

## 4. Install and signing compatibility

- `adb install -r` of this APK over the installed debug build is a same-package, same-signer,
  same-versionCode (1) update: the platform accepts it with no `-d`. **Verified 2026-10-06 22:26** by
  reading the installed `base.apk`'s signer and versionCode (`phone-readonly-2026-10-06.md`), and at 22:30 by a
  full manifest comparison: identical manifests and permissions; only seven `classes*.dex` differ (§9.1).
- **Multi-profile:** the package is installed in **user 0** and **user 95**. An `install -r` replaces the
  code for both. Its effect on each profile must be stated and approved separately before A4.
- Data preserved by `-r`: Room DB (schema **version 1**, no migration in this APK), trust store, prefs,
  runtime grants, notification-listener and accessibility bindings (`CLAUDE.md`, measured on this phone).
  Today's baseline: listener **bound**, accessibility **off** (it was off before this plan) — after A4 the
  expected reading is the same, not "restored".
  **Cost:** `LinkService` is not running afterwards — start `MainActivity` by name and confirm with
  `scripts/link-up.sh`.
- No `AndroidManifest.xml` changed since 2026-10-04, so no new permission versus a build from that date;
  versus an older installed build it is unknown until the installed manifest is read.
- Pairing v2 on the phone stores its state in a new prefs file (`link_pairing_v2`); a legacy trust row
  keeps working until re-paired.
- No release APK is involved (it has no signing config and is refused by the platform, D13). No
  credentials are created, read or changed.

## 5. Rollback limitations

| What | Can be undone? |
|---|---|
| Mac code | **Yes** — the exact live `desktop/dist` is copied and verified (A2a, `f862a1ae…`, §9.2); copy it back. Not personal data |
| Mac **Activity rewrite** | **No.** Irreversible by design. The only way to keep the pre-rewrite file is a private copy made **before** relaunch, which is a decision for you (it holds whatever call data is there) |
| `sidekick.json` after re-pair | The legacy pin is **gone** after Forget; the old build can use the new v2 record (the extra `pairing: 2` field is ignored by it — reasoned, not run) |
| Phone APK | Partly — the **installed** `base.apk` is copied and verified (A2a, `b0ad2a47…`); `adb install -r` it back. Code only: no app data, Keystore identity, grants or bindings — **never uninstall**. Same signer and versionCode, so no `-d`. `link_pairing_v2` prefs written by the new build stay behind (ignored by an older build) |
| Phone trust after Forget | **No** for the legacy row; a new pairing restores a working link |
| Mac clipboard | Only as good as the method approved in §6. Restore inside Sidekick is **plain text only** and memory only |
| Phone clipboard | Not readable by shell on Android 10+, so it cannot be snapshotted by us at all |

## 6. Protecting your real clipboard — needs your choice before stage A

Nothing in preparation read, saved or changed either clipboard. Three paths could move your content
during the run:

1. **Mac → phone (the watcher).** It is on now and stays on across a relaunch (`watchClipboard`), and its
   first poll after each (re)connect sends the current Mac clipboard text to the phone. **Prevention:**
   switch *Watch this Mac's clipboard* **off** in the live app before anything else (A0). Off persists,
   and the new build starts with it off. Turned back on in G only if you want it.
2. **Phone → Mac (focus sync).** Every time Sidekick comes to the front on the phone — including
   `am start …/MainActivity` after the install and the QR scan in B — the phone reads **its** clipboard and
   sends it. With the new phone build that push is `origin: "clipboard"`, which the new Mac **applies**,
   overwriting your Mac clipboard (all formats lost; plain text kept in memory for Restore). There is no
   switch for this on either side. **Prevention:** before A's phone start, *you* copy a throwaway string on
   the phone (e.g. `S7-PHONE-PLACEHOLDER`) — we cannot read, save or clear the phone clipboard.
3. **The test itself** writes the Mac clipboard on purpose (D: Copy, Restore).

**Chosen: M1** (owner, 2026-10-06). No snapshot, no helper, no clipboard data saved. The options are kept
below for the record.

For the **Mac clipboard**, choose one:

- **M1 — nothing read (recommended).** Before A, you move anything you care about out of the clipboard
  yourself (paste it somewhere you control), then copy a throwaway string. We never read, save or restore
  it; G leaves a synthetic string on it, which you replace.
- **M2 — full-fidelity snapshot, memory only.** A small Swift helper reads every `NSPasteboardItem` and
  every type's data (text, RTF, HTML, images, file URLs, concealed markers), holds it **in memory** in a
  running process, and on command clears and re-writes all items. Limits: lazily-provided/promised data
  is forced at save time and some providers may refuse (reported as a count, never content); file
  promises and app-private ownership are not reproduced; `changeCount` changes; if the helper dies, the
  snapshot is gone (fails toward privacy). `pbpaste`/`pbcopy` are **not** used — they keep plain text only.
- **M2d — as M2 but kept on disk** (`~/.s7-run`, 0700/0600, deleted in G). Survives a crash; puts
  clipboard content on disk for the run.

Also: if **Universal Clipboard** (Handoff) or a clipboard manager is active, the synthetic strings will
appear there too. They are harmless, but it is worth knowing.

## 7. The staged run (each stage approved separately)

| Stage | Steps | Changes | Pass criterion |
|---|---|---|---|
| **A0** | ~~Switch *Watch this Mac's clipboard* off~~ **DONE 18:23:46** — see §8 | `watchClipboard=false`; forwarding stopped | met |
| **A1** | **DONE 22:26–22:35** (§9.1). You copy harmless test text on the Mac and on the phone (M1); you copy the phone placeholder; plug the phone into USB. Read-only: pin, `dumpsys package` (version, `lastUpdateTime`, grants), `pm path` + pull installed `base.apk`, `apksigner` on it | a read; a copy of the installed APK on this Mac | installed signer = `d3a505d2…7d26`, versionCode ≤ 1; grants recorded |
| **A2a** | **DONE 22:41** (§9.2): code-only rollback copy outside the repo | private copy of four code artifacts | every destination equals its source |
| **A2b** | **DONE 23:09** (§9.4): Sidekick quit by its *Quit Sidekick* menu item, then a private copy of `activity.jsonl` | a personal-data file, private; Sidekick left quit | destination SHA-256 = source, source stable |
| **A3** | **DONE 23:13** (§9.5). Keep current `desktop/dist` as a code copy; quit Sidekick **from its menu**; copy the **`4661015`** scratch `dist` in; verify manifest `bb594168…`; relaunch with the two flags | Mac code; **Activity rewrite runs** (§3a) | `Rewrote activity.jsonl: N…` or no rewrite line; any `unknown field … policy decision` warning recorded as a count; pane loads; `pairing: legacy`; watcher still off |
| **A4** | **DONE 23:23–23:30** (§9.6). `adb install -r` the pinned APK; `am start -n …debug/…MainActivity`; `scripts/link-up.sh` | phone app | three OKs; grants unchanged vs A1 |
| **B** | H1 state; H4 Forget both sides, pair by QR; H4b cancel once | trust on both sides | "Code scanned. Verifying your Mac…", then "Paired" only after the Mac's `pairing v2, both sides proved the code` |
| **C** | H5: disconnect/reconnect from the Mac; phone Wi-Fi off/on once | none persistent | reconnects with no pairing request |
| **D** | V3–V8 with `S7-OFFER-n` strings typed into a page you control; banner click; Copy; Dismiss; Restore guard (`S7-MARKER-B`); one focus sync with `S7-SYNC-1` | Mac clipboard (synthetic) | V3–V8 criteria; `pbpaste` used **only** to read synthetic markers, never before the clipboard holds one |
| **E** | V10: drag `~/.s7-run/drop-me.txt` → sheet → **Return** (must cancel) → drag again → **Send** | one push | sheet names the file; Return cancels; Send pushes; phone verifies the digest |
| **F** | H6/H10: one synthetic push and one pull from `Download/ConnectSuite`, drag the pulled file to Finder; mirror 30 s | synthetic files | digests verified; `Encoded +N frames` ticks |
| **G** | V9 log grep for `S7-` (expect 0, control ≥ 3); restore the clipboard by the approved method; delete `~/.s7-run` and synthetic files on both sides; watcher back on only if you say so; sanitized evidence to `docs/evidence/` | cleanup | hashes and counts recorded; no personal content in evidence |

**Not in this run:** calls, SMS, Bluetooth, camera/microphone, the incoming-call banner, any gate change,
signing, publishing. H7 (impostor stand-in) and H8 (old QR) stay optional and separate.

## 8. A0 — done, 2026-10-06 18:23 IST

- **Instance re-identified:** PID 91450, started 2026-10-05 12:51:08 (unchanged); one page target,
  `index.html`; port 9222 owned by PID 91450.
- **Action:** `scripts/probe.mjs` routed to Clipboard by the nav row's accessible name (landed), read
  `#clip-watch` checked = **true** (control: 1 element), clicked it with the premise re-checked inside the
  same call (landed: the toggle and the pane's own status line agreed), read it back **false**.
- **Verified independently:** `sidekick.json` `watchClipboard` **True → False**; log
  `18:23:46.529 [clipboard] Stopped watching this Mac's clipboard` (0 such lines before; 119,452 polls
  in the stopped watcher's tally); main process over the read-only `clip-watching` IPC → **`watching=false`**
  (control: `login-item-get` answered); **0** `[clipboard]` log lines after the stop.
- **Not read or changed:** either clipboard's contents; no pane text was read. **Side effect:** the main
  window now shows the Clipboard pane.
- **Undo:** the same toggle.

## 9. A1 and A2a — done, 2026-10-06 22:26–22:42 IST

Full record: `docs/evidence/verification-prep-2026-10-06/usb-checks-and-a2a-2026-10-06.md`.

### 9.1 A1 — USB checks and watcher re-check (read-only)

- **Watchers:** none running. The earlier session's first watcher ended at 19:26 with nothing run; its
  second fired at 22:26:06, ran the read-only script and exited 0. None re-armed.
- **Phone:** pin `RZCY12330DT` = SM-S938B; no splits; on-phone hash of `base.apk` = the pulled copy
  (`b0ad2a47…`); full manifest and permission dumps identical to the prepared APK; only seven
  `classes*.dex` differ; same v2 signer and key; database declaration unchanged since 2026-08-28;
  listener bound, accessibility off; users 0 (14/14 grants) and 95 (0/14) hold the package.
- **Mac watcher:** `watchClipboard=False`; IPC `watching=false` (control answered); since the stop, 1,149
  `[clipboard]` lines = 1 stop + 1,148 history clears on link drop, 0 poll/send/apply.

### 9.2 A2a — code-only rollback copy

`~/.connectsuite-evidence-private/rollback-2026-10-06/` (outside the repo; dirs 0700; APKs, manifests and
script 0600; `dist/` trees keep their source modes, none executable). Contents: the installed `base.apk`
(`b0ad2a47…27f9`), the prepared APK (`5f014e9e…30ad`), the pinned `4661015` build (`bb594168…a524d`,
308 files), and the exact live `desktop/dist` (`f862a1ae…fef22`, 274 files). No profile, setting, key,
clipboard, Activity or log. Each destination's manifest, per-file listing and modes equal its source's;
the live dist's were identical before and after the copy; a one-byte mutation changes the manifest
(control). The live `desktop/dist` was not modified.

Manifest procedure: `LC_ALL=C; cd <root> && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 |
shasum -a 256`, with symlinks and specials counted separately (0 in both trees).

### 9.3 Unresolved: the preflight's `4f40b0e9…`

Recorded during the 17:01–17:15 preflight without its procedure; five plausible variants give `10e6ed20…` or `f862a1ae…`, never
`4f40b0e9…`. File mtimes (all 2026-10-04 17:09) are **not** taken as proof that nothing changed. Whether
`4f40b0e9…` described these bytes cannot now be established. **The rollback baseline is `f862a1ae…`.**

### 9.4 A2b — private Activity backup (done 23:09)

- **Instance re-identified:** PID 91450 (launcher 91445, started 2026-10-05 12:51:08), the only
  `Electron .`, cwd `desktop/`, owner of port 9222. Quit by clicking **Quit Sidekick** in its app menu
  through System Events, with the PID and the item's name re-checked in the same script. Exit confirmed:
  neither PID alive, 0 Sidekick processes, 0 listeners on 9222 (control: an unrelated known process is
  still visible). The log's last lines are the ordinary on-disconnect clears at 23:08:29.
- **Copied:** only `~/Library/Application Support/sidekick-desktop/logs/activity.jsonl`, to
  `~/.connectsuite-evidence-private/rollback-2026-10-06/activity-backup-2026-10-06/activity.jsonl`
  (folder 0700, file and `SHA256SUMS` 0600). Refused in advance if the folder existed, if Sidekick was
  running, or if any process had the file open.
- **Verified:** size, mtime, inode and SHA-256 identical over two reads before the copy and once after;
  destination SHA-256 equal to the source's; `shasum -c` OK.
  SHA-256 `3bf3ce35f5cc7a45901d411741dc08b4bee60b107ec5145a4ba879dc25d3020f`, **559,371 bytes, 4,915
  newline-terminated lines**. The last byte is a newline — a structural observation only, not proof that
  every row is valid. No row was printed, searched or parsed.
- **Retention:** kept until the owner explicitly approves deletion. **Reminder due at the end of stage G
  or on 2026-10-13, whichever comes first.** Never deleted automatically.
- **Restore limits** (unchanged from the proposal): the new build re-applies the redaction on every load
  (no run-once marker), so a restore under it is undone at the next launch; overwriting the live file
  loses events written after 23:08; no settings, pairing, clipboard, logs or phone data are in it.
- **Mac left quit.** Not relaunched; `desktop/dist` untouched (`f862a1ae…`). The phone's `LinkService`
  keeps listening; nothing is mirrored to the Mac until a relaunch.

### 9.5 A3 — Mac on `4661015`, Activity rewrite run (done 23:13)

- **Pre-checks, all OK:** Sidekick not running; live `desktop/dist` `f862a1ae…`, 274 files, no specials;
  `watchClipboard` False; live `activity.jsonl` = the A2b backup hash `3bf3ce35…`; backup intact; private
  `4661015` copy `bb594168…`, 308 files; rollback destination absent; same volume.
- **Old build moved, not deleted:** `desktop/dist` → `~/.connectsuite-evidence-private/rollback-2026-10-06/
  mac-live-dist-moved-at-a3/dist` (0700 parent), re-verified `f862a1ae…`, 274 files.
- **New build:** `ditto` of the private `4661015` copy into `desktop/dist`, verified `bb594168…`, 308 files,
  no specials, before launch. Source re-verified after.
- **Launch 23:13:40:** port 9222 free before; 0 `CONNECTSUITE_*` variables;
  `./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222` from
  `desktop/` (verification-session flags, not release configuration). One instance (PID 67469, launcher
  67467), owner of 9222.
- **Rewrite (log, counts only):** `Rewrote activity.jsonl: 294 call row(s) brought under the call-data rule /
  0 unreadable line(s) that may hold call data dropped / 4915 line(s) kept`. **0** unknown-field warnings.
  `Activity log: 2000 event(s) read / 0 line(s) unreadable`. No `.rewrite` temp left. File after:
  SHA-256 `f19445d9…a6ad`, 559,936 bytes, 4,917 lines (4,915 kept + 2 appended since launch).
- **Pane:** routed by accessible name (landed); 9 rows drawn (the page size, `ACTIVITY_PAGE_SIZE = 9`),
  0 state cards; the active *All* chip reads 2000 (the store's read cap); 7 chips.
- **Watcher off:** setting False; IPC `watching=false` (control answered). **Pairing legacy:** no
  `pairing: 2`; log `pairing: legacy (v1, not authenticated)`. **Link:** `Connected to Samsung SM-S938B …
  via last-known` to the existing phone build; 0 drops since. **Debug switches:** 0 `[debug]` lines.
- **Startup warnings:** 2 — the `share.ask` gate notice and one `contacts.get refused: NOT_FOUND`
  (sentence not logged). 0 errors.
- **Untouched:** the A2b backup (`3bf3ce35…`, re-hashed after launch), the A2a copies.

### 9.6 A4 — phone on `286e2b0` (done 23:23–23:30)

- **Pre-checks, all OK:** pin `RZCY12330DT` SM-S938B; installed `base.apk` `b0ad2a47…` on the phone; same
  signer and versionCode 1; no splits; prepared APK `5f014e9e…` and rollback copy `b0ad2a47…` (`shasum -c`
  OK); Mac one instance, `watchClipboard` False, IPC `watching=false`; the owner confirmed both clipboards
  held only harmless test text. Baseline per profile: 0 installed 14/14 granted, 95 installed 0/14, 150 not
  installed; listener bound; accessibility off. (The first grant count read 0 for user 0 — a parser keyed on
  the wrong `User 0:` header; the known positive caught it and it was fixed before the baseline was kept.)
- **Install 23:23:19:** `scripts/adb-pinned.sh samsung install -r --user 0 <private copy>` → `Success`. No
  uninstall, clear, `-d` or `-g`.
- **After:** on-phone `base.apk` `5f014e9e…`; versionCode 1; `lastUpdateTime` 2026-10-04 17:08:34 →
  2026-10-06 23:23:31; installed 0=true, 95=true, 150=false; grants 0=14/14, 95=0/14 (unchanged); listener
  bound; accessibility off (not touched).
- **The link restarted without `am start`.** Phone log 23:23:32.828 `[autostart] PACKAGE_REPLACED … starting
  LinkService` and .829 `LISTENER_REBIND …`; the Mac reconnected at 23:23:32.998, `pairing: legacy`, the
  phone now advertising `webcam:2`. (The `CLAUDE.md` banner's *"`-r` leaves the phone serverless"* is
  older than the autostart fixes; on this install it did not.)
- **A user-95 process appeared** at 23:23:31 (`u95_a1011`, PID 23912), not started by any command here.
  It is cached (`procState 19`), runs **no** service (0 `u95` service records against 2 in user 0), and
  42501–42503 listen only under uid 11011 (user 0). Most likely the platform delivering the package-replaced
  broadcast to every profile that has the package — **reasoned, not measured**: user 95's own app log was
  not read, to leave that profile alone.
- **`MainActivity` started once in user 0** (23:28:05, `am start --user 0 -n …`, exit 0). Usage stats:
  resumed 23:28:06, paused 23:28:57 (Google Pay came to the front). **No clipboard event:** 0 phone `clip`
  lines, 0 Mac arrival lines, Mac clipboard not written by Sidekick. `ClipFeature.onWindowFocused` has
  three silent exits; `ClipEcho` is in memory and was reset by the 23:23:31 restart with nothing sent
  since, so *unchanged* is ruled out. Remaining, indistinguishable from these logs: the window never got
  input focus, or the clipboard read was empty / not text. Not retried (no repeated foregrounding).
  **Candidate defect, not filed:** those silent exits break the log-the-success-and-the-skip rule — the
  absence could not be diagnosed from either log.
- **`scripts/link-up.sh`:** three OKs (foreground service, three listeners under uid 11011, one control
  session). Mac: one instance, 1 reconnect, legacy, watcher off (setting + IPC), 0 errors.
- **Untouched:** A2a copies (`shasum -c` OK), A2b backup (`3bf3ce35…`).
- **Rollback:** `install -r --user 0` of `android/installed-base-2026-10-04.apk` — code only.

### 9.7 B/H4 — secure re-pair (done 2026-10-06 23:46–23:57)

- **Before Forget:** Mac `bb594168…` (PID 67469) and phone `5f014e9e…` running; `link-up.sh` three OKs;
  watcher off (setting + IPC); owner confirmed harmless text on both clipboards. Entries identified without
  printing fingerprints: the Mac's stored phone *Samsung SM-S938B* (legacy, no `pairing` field); the phone's
  single paired device, whose logged fingerprint prefix matched this Mac's own certificate when compared
  locally. Users 95 and 150 not touched.
- **Mac Forget (23:46:37):** Settings → Connection → *Forget this phone* by name, premise (connected,
  `paired`, `pairedLegacy`, device name) re-checked inside the click. First attempt **refused, nothing
  clicked**: the premise read a `state` field that `ConnectionStatus` does not have (it is `phase`). Fixed and
  re-run: `paired` true→false, `pairing` paired→unpaired, stored pairing removed. The phone, still holding
  the legacy pin, then refused the Mac (`UNAUTHORIZED: This phone is not waiting to pair`) — expected.
- **Phone Forget (owner, 23:56:31):** phone log `[trust] Forgot … and closed 0 live session(s)`; four
  refusals of the Mac followed (`This Mac is not paired with the phone`).
- **Pairing (23:57:05–23:57:14):** phone `Pairing armed for Chetans-MacBook-Pro — waiting for it to prove
  the code` at 23:57:05, then `Paired with Chetans-MacBook-Pro — pairing v2, both sides proved the code` at
  23:57:14 (**9 s** in verification by the log). Mac `pairing v2, both sides proved the code` at
  23:57:14.121, connected at .134. **The scan happened before the owner was asked to scan** and was not
  directly observed. That the phone's scanner read the code already on the Mac's screen is an
  **inference, not an established cause**. The *Verifying* screen was **not visually observed** by anyone recording; only
  the phone log's 9 s armed→paired interval shows that verification preceded success.
- **After:** Mac stored `pairing: 2` (flag only), `pairedLegacy` false, 0 `pairing: legacy` lines since;
  phone `pairing for …: v2 (both sides proved the code)`; `link-up.sh` three OKs; watcher off (setting +
  IPC); **0** clipboard arrivals since Forget.
- **Legacy sentence:** still drawn after the pair (1 element, 0 of the non-legacy sentence) because the open
  Settings pane is redrawn only on startup and on a theme change, never on a pairing change. Re-opening the
  Connection tab redrew it: 0 legacy, 1 non-legacy. **Candidate defect, not filed:** Settings → Connection
  keeps a stale trust sentence after Forget/re-pair until the pane is reopened.
- **Instrument note:** one sanitising `sed` used `\b`, which BSD `sed -E` does not support, and two
  fingerprint fragments reached the session transcript (not any file). Later reads printed fixed fields only.
- **Untouched:** A2a copies, A2b backup.

### 9.8 C step 2 — Mac Disconnect, then Connect (done 2026-10-07 00:14)

- **Pre-checks:** Mac PID 67469 on `bb594168…`, phone `5f014e9e…`, stored `pairing: 2`, `link-up.sh` three
  OKs, watcher off (setting + IPC); owner confirmed harmless text on both clipboards.
- **Disconnect** (by name, premise — connected, *Samsung SM-S938B*, paired, not legacy — re-checked in the
  click): phase `connected` → `idle` in 11 ms; Mac log `Disconnected: user disconnected`. **Down confirmed
  from the phone:** `link-up.sh` readings 1–2 OK, reading 3 FAIL *no control session on 42501* — the server
  up, no Mac attached.
- **Connect, once** (by name, premise `idle` + v2 re-checked in the click) at 00:14:54.510: phase
  `connected` at **110 ms** by the probe (100 ms polling, 60 s deadline). Mac log: **1** `Trying` (last-known)
  at .511, `pairing: v2` at .605, `Connected to Samsung SM-S938B` at .616.
- **No pairing requested:** Mac 0 `both sides proved the code`, 0 legacy; phone since 00:14 — 0 `Pairing
  armed`, 0 `Paired with`, 0 refusals, 1 `pairing for …: v2 (both sides proved the code)` label. (A first
  count matched 1 Mac line for "armed": it was `[native-notif] … replay cutoff armed`, a lookalike, not
  pairing.)
- **After:** stored `pairing: 2`; `link-up.sh` three OKs; watcher off (setting + IPC).
- **Clipboard:** 0 arrivals and 0 sends on the Mac; the phone's only `clip` line is the history clear on
  link drop. No clipboard event.
- **Backups unchanged:** A2a `shasum -c` OK; A2b `3bf3ce35…`.

### 9.9 Open findings (as of 2026-10-07 00:20)

1. **H4 completed with v2 verification on both sides, but the scan was not directly observed.** That the
   scanner read the code already on the Mac's screen is an inference, not an established cause.
2. **The *Verifying* screen was not visually verified.** Only the phone log's 9 s armed→paired interval
   indicates verification preceded success.
3. **Settings → Connection showed stale legacy copy after re-pairing** until the Connection tab was
   reopened. Reopening is a workaround, not a fix: the open Settings pane is not redrawn on a pairing change.
4. **A fingerprint-masking command leaked fragments into session output** (BSD `sed -E` has no `\b`). Not in
   any file, screenshot or commit.
5. A4's startup clipboard event did not occur; cause unresolved (§9.6). The focus path's silent exits are a
   candidate defect.
6. An idle user-95 process appeared after the install; cause inferred (package-replaced broadcast), not
   measured (§9.6).

### 9.10 Stage D — supervised clipboard verification (2026-10-07 01:11–01:42), STOPPED at step 6

Markers are named by label only here (**M-BASE** 11 B, **M-OFFER-1** 10 B, **M-OFFER-2** 10 B, **M-NEWER**
12 B, **M-SYNC-1** 9 B); no clipboard content is in this file. Equality was checked by a helper that prints
only *equal / not equal*. Every Mac log read printed a control (lines read) and a count of marker strings in
the log (**0** throughout — no marker ever reached either app's log).

| Step | Stimulus | Observation | Verdict |
|---|---|---|---|
| Pre | builds, v2, `link-up.sh`, watcher | Mac `bb594168…` / phone `5f014e9e…`, `pairing: 2`, three OKs, watcher off (setting + IPC), pane empty; owner confirmed harmless clipboards | — |
| 1 | M-BASE written to the Mac clipboard (`pbcopy`) | equal to M-BASE; 0 `[clipboard]` lines (watcher off — not sent); control 2 lines read | **PASS** |
| 2 | Owner: Keep → select M-OFFER-1 → *Send to Mac*; Sidekick not frontmost (Brave) | phone 01:13:50.256 `clip.push → Mac via selection (origin selection): 10 bytes from Keep Notes`, route `ACTION_SEND from=com.google.android.keep chars=10 → Sent`; Mac 01:13:50.322 `Offered an arriving entry (origin selection): 10 bytes, NOT applied`; clipboard still M-BASE; pane 1 pending offer | **PASS** (offer, clipboard unchanged) |
| 2 — banner | owner saw no banner | macOS unified log: Electron `Adding notification request` at 01:13:50.321, then `usernotificationsd … addRequest not allowed: com.github.Electron` at .330 — **a macOS notification refusal for the development Electron bundle, not an offer failure**. (`com.github.Electron` is also absent from `ncprefs`'s 93 listed apps.) The offer banner's post is not logged by the app itself | banner **unavailable — notification refused by macOS** |
| 3 | click the banner | no banner exists to click; permissions not changed | **NOT RUNNABLE** |
| 4 | *Copy* on the M-OFFER-1 offer (row selected by exact equality inside the page; selection re-checked in the click) | 01:18:37.956 `Applied an arriving entry … 10 bytes, previous clipboard captured`; clipboard equal to M-OFFER-1; notice *On this Mac's clipboard now*; 1 displaced entry | **PASS** |
| 4 — duplicate | second Copy on the consumed offer through the same bridge (`clipOfferCopy`); the pane showed **0** Copy buttons | `ok:false`, *"That offer is no longer waiting — it was copied, dismissed or replaced. Nothing was copied now."*; 01:19:16.198 `Refused a Copy on an offer … nothing written`; clipboard still M-OFFER-1 | **PASS** |
| 5 | *Restore* on the displaced (UNDO) row | 01:20:42.516 `Restored a displaced entry: 11 bytes`; clipboard equal to M-BASE; notice *Put back on this Mac's clipboard.* | **PASS** |
| 6 | Owner: select M-OFFER-2 → *Send to Mac* (01:21) | **no arrival**: Mac 0 `[clipboard]` lines; phone 0 `clip` lines; usage stats show no Sidekick activity after 01:13:50; nothing pressed on the Mac | **FAIL to start** |
| 6 — diagnostic retry (owner-authorised, one) | pinned `input text` typed M-OFFER-2 into a new blank Keep note (verified equal); long-press inside the field (point derived from the field's bounds); owner tapped *Send to Mac* once (reported present) | **no dispatch**: logcat since 01:35:50 — 23,120 lines, **0** mentions of `SendSelectionActivity` or `PROCESS_TEXT` (control: the step-2 window holds **42**); usage stats — no Sidekick activity resumed (control: the 01:13:50 start is listed); phone 0 `clip` lines; Mac 0 offers | **FAIL — see classification** |
| 7, 8 | — | not run | **NOT RUN** |

**Step 6 classification.** C (phone→Mac delivery) and D (Mac rendering/notification) are **ruled out**: nothing
was sent. The `PROCESS_TEXT` intent never reached Sidekick, so the fault lies **at or before the dispatch**:
either the selection-menu tap did not dispatch (A) or the platform did not deliver it to
`SendSelectionActivity` (B). **Between A and B it is inconclusive**: the selection toolbar is a separate popup
window that `uiautomator dump` (active window only on this build) and `dumpsys activity top` cannot read, so
its items were never seen by an instrument. Not retried further.

**Stop condition met.** At 01:40 the Mac clipboard matched **none** of the five markers, with **0** Sidekick
clipboard log lines since step 5 — something outside Sidekick replaced it after 01:23. It was not read or
printed; clipboard checks stopped.

**Instrument faults this stage, each caught before it became a finding:**
- the phone-log control counted `$1 >= t`, admitting 244 untimestamped continuation lines (defect 78's
  shape): *245 since 01:21:17* was really **1**. Fixed to count timestamped lines only; step 2's `249` was
  inflated the same way (its presence reading stands — the matching lines were printed);
- the Restore selector matched the row's *source* label, not its body; it threw before any click;
- `log show` in zsh is a builtin; `/usr/bin/log` was needed — caught by a control returning 0.

**Left on the devices:** a Keep note containing M-OFFER-2 (owner's test note); the Mac clipboard holds
non-marker content not written by Sidekick; the Sidekick history holds the stage's entries until the next
disconnect. Watcher off; backups unchanged.
