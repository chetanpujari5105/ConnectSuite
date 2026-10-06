# Supervised verification — preflight and staged plan (2026-10-06)

> **Status: PREPARATION ONLY.** Nothing here has been run on a device. No install, relaunch, Activity
> rewrite, clipboard change, Forget or re-pair has happened. Every stage below needs its own approval;
> approving one approves nothing after it. Supersedes the *order* of `docs/pairing-v2-hardware-test-proposal.md`
> (H1–H12) and `docs/s7-hardware-verification-proposal.md` (V0–V11); their pass criteria still apply.
> Evidence for this file: `docs/evidence/verification-prep-2026-10-06/`.

## 1. Preflight findings (read-only, 2026-10-06 17:01–17:15 IST)

| Item | Finding |
|---|---|
| Live Mac instance | **PID 91450** (`Electron .`, cwd `desktop/`, launcher PID 91445), started **2026-10-05 12:51:08**, flags `--force-renderer-accessibility --remote-debugging-port=9222`, no `CONNECTSUITE_*` variables (all debug switches off). User data: `~/Library/Application Support/sidekick-desktop/` |
| Code it runs | `desktop/dist`, built **2026-10-04 17:09:41**, manifest `4f40b0e9…` (unchanged by this preparation, checked before and after). It predates **29** Mac commits: none of S1, S2, S2b, S3, S4, S6, S7, defect 190, or the Activity call-data rewrite is running |
| Link | Connected to the SM-S938B over Wi-Fi since 16:42 (Mac log). Stored pairing is **legacy** (`paired` has no `pairing: 2`) |
| **Clipboard watcher** | **`watchClipboard = true`** — the live app is *already* sending every new Mac copy (plain text, unmarked) to the phone. Existing behaviour, untouched |
| Phone | **Not on USB** (`adb devices` answered with an empty list; no cold-start banner). Installed version, `lastUpdateTime`, signer and grants **could not be read** this sitting. Last recorded installs in the docs are 2026-09-29; the camera runs of 10-02/10-05 installed builds too |
| Legacy migration marker | `legacy-migration.json`: settings, activity merge and re-pair decision all recorded (2026-09-18) — none run again |

## 2. Artifacts (from `286e2b0`, a clean tree: no modified or untracked source files)

| | Mac | Android |
|---|---|---|
| What | compiled `dist/` (308 files), the dev-Electron app the live instance runs | `app-debug.apk` |
| Built by | `git archive HEAD desktop` into scratch, `node_modules` symlinked, `npm run build` (exit 0) | `./gradlew :app:assembleDebug --rerun-tasks` (150/150 executed, exit 0) |
| Hash | manifest of per-file SHA-256: `0051f15b91be8bc1c00597d0c6357cc8cb1e7f7cc842e23f6db1b64cba8bb67d` (`mac-dist-manifest.sha256`) | SHA-256 `5f014e9e0b0172ae8ff8cadf3551f5847f9682699535323947607bfd642530ad`, 94,856,261 bytes |
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

**The rewrite, measured on synthetic fixtures through the current `ActivityStore`**
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

## 4. Install and signing compatibility

- `adb install -r` of this APK over the installed debug build is a same-package, same-signer,
  same-versionCode (1) update: the platform accepts it with no `-d`. **Unverified until the phone is on USB**:
  the installed signer and versionCode must be read first (`pm path` + `apksigner`, `dumpsys package` —
  read-only through `scripts/adb-pinned.sh`).
- Data preserved by `-r`: Room DB (schema **version 1**, no migration in this APK), trust store, prefs,
  runtime grants, notification-listener and accessibility bindings (`CLAUDE.md`, measured on this phone).
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
| Mac code | **Yes** — keep the current `desktop/dist` as a code copy before replacing it, and copy it back. Not personal data |
| Mac **Activity rewrite** | **No.** Irreversible by design. The only way to keep the pre-rewrite file is a private copy made **before** relaunch, which is a decision for you (it holds whatever call data is there) |
| `sidekick.json` after re-pair | The legacy pin is **gone** after Forget; the old build can use the new v2 record (the extra `pairing: 2` field is ignored by it — reasoned, not run) |
| Phone APK | Partly — pull the **installed** `base.apk` (read-only) before installing, then `adb install -r` it back. Same signer and versionCode, so no `-d`. `link_pairing_v2` prefs written by the new build stay behind (ignored by an older build) |
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
| **A0** | Switch *Watch this Mac's clipboard* off in the live app (by name over CDP) | `watchClipboard=false`; forwarding stops | toggle reads off; log `Stopped watching` |
| **A1** | Your clipboard method (§6) done; you copy the phone placeholder; plug the phone into USB. Read-only: pin, `dumpsys package` (version, `lastUpdateTime`, grants), `pm path` + pull installed `base.apk`, `apksigner` on it | a read; a copy of the installed APK on this Mac | installed signer = `d3a505d2…7d26`, versionCode ≤ 1; grants recorded |
| **A2** | Optional, your decision: private pre-rewrite copy of `activity.jsonl` | a personal-data file | — |
| **A3** | Keep current `desktop/dist` as a code copy; quit Sidekick **from its menu**; copy the scratch `dist` in; verify the manifest hash; relaunch with the two flags | Mac code; **Activity rewrite runs** | `Rewrote activity.jsonl: N…` or no rewrite line; pane loads; `pairing: legacy` |
| **A4** | `adb install -r` the pinned APK; `am start -n …debug/…MainActivity`; `scripts/link-up.sh` | phone app | three OKs; grants unchanged vs A1 |
| **B** | H1 state; H4 Forget both sides, pair by QR; H4b cancel once | trust on both sides | "Code scanned. Verifying your Mac…", then "Paired" only after the Mac's `pairing v2, both sides proved the code` |
| **C** | H5: disconnect/reconnect from the Mac; phone Wi-Fi off/on once | none persistent | reconnects with no pairing request |
| **D** | V3–V8 with `S7-OFFER-n` strings typed into a page you control; banner click; Copy; Dismiss; Restore guard (`S7-MARKER-B`); one focus sync with `S7-SYNC-1` | Mac clipboard (synthetic) | V3–V8 criteria; `pbpaste` used **only** to read synthetic markers, never before the clipboard holds one |
| **E** | V10: drag `~/.s7-run/drop-me.txt` → sheet → **Return** (must cancel) → drag again → **Send** | one push | sheet names the file; Return cancels; Send pushes; phone verifies the digest |
| **F** | H6/H10: one synthetic push and one pull from `Download/ConnectSuite`, drag the pulled file to Finder; mirror 30 s | synthetic files | digests verified; `Encoded +N frames` ticks |
| **G** | V9 log grep for `S7-` (expect 0, control ≥ 3); restore the clipboard by the approved method; delete `~/.s7-run` and synthetic files on both sides; watcher back on only if you say so; sanitized evidence to `docs/evidence/` | cleanup | hashes and counts recorded; no personal content in evidence |

**Not in this run:** calls, SMS, Bluetooth, camera/microphone, the incoming-call banner, any gate change,
signing, publishing. H7 (impostor stand-in) and H8 (old QR) stay optional and separate.
