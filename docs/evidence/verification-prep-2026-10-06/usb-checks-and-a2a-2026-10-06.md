# USB checks, watcher re-check and A2a — 2026-10-06 22:30–22:42 IST

Sanitized: no clipboard content, no Activity rows, no log text beyond fixed templates with digits masked,
no addresses. Every `adb` call went through `scripts/adb-pinned.sh samsung`. Nothing was installed,
granted, revoked, cleared, started, relaunched or re-paired; neither clipboard was read or written.

## 1. Watchers

None running at 22:30. The earlier session armed two, in sequence: the first ended at 19:26 with *"no
device within 45 min; nothing was run"*; the second saw the phone at 22:26:06, ran a read-only script
(`phone-readonly-2026-10-06.md`), and exited 0. No process matching a wait loop, `check.sh` or an
`adb wait-for` was alive. None was re-armed.

## 2. Phone (additions to `phone-readonly-2026-10-06.md`, which these readings agree with)

| Reading | Value |
|---|---|
| Pin | `RZCY12330DT` = SM-S938B, Android 16, SDK 36 |
| Splits | **none** — `splits=[base]`; `pm path` returns `base.apk` only. So `base.apk` is the complete *code* of the install (not its data — §4) |
| Pulled copy vs device | `sha256sum` run **on the phone** over the installed path = `b0ad2a47…f327f9`, 95,845,644 bytes, file time 2026-10-04 17:08:25 = the pulled copy's hash. The earlier pass hashed only the local copy; this ties it to the device. No second pull was made |
| Full manifest comparison | `aapt2 dump xmltree AndroidManifest.xml` of installed vs prepared, line numbers stripped: **identical** (467 lines each). `aapt2 dump permissions`: identical (31 entries). Control: `diff` of two different inputs exits 1 |
| What differs | zip entry list: only `classes3/9/12/14/17/18/19.dex` change size. No resource, manifest or native-library entry differs |
| Signer (both) | v2, 1 signer, `CN=Android Debug, O=Android, C=US`, cert `d3a505d2…7d26`, public key `b62dd4d6…1725`; both `Verifies` |
| Database | `@Database` in `ConnectSuiteDatabase.kt` last changed 2026-08-28 (`6445fdd`); no Room/migration change between the installed build and `286e2b0`. One new prefs file (pairing v2), additive |
| Secure-settings bindings | notification listener **bound** (`…NotificationMirrorService`). Accessibility **off**: `accessibility_enabled=0`, no ConnectSuite entry in `enabled_accessibility_services`. This was the state *before* any step of this plan; after A4 the expected reading is "still off", not "restored" |
| Profiles | user 0: installed, 14/14 runtime grants. user 95: installed, 0/14. user 150: not installed, not queryable by the shell |

## 3. Mac clipboard watcher (still off; contents never read)

- `sidekick.json` `watchClipboard` = **False** (only that key read). File mtime 22:08:12 = the reconnect
  at 22:08:12.129 (`lastAddress`), not a watcher change.
- Read-only IPC through `scripts/probe.mjs` (`clip-watching`): **`watching=false`**; control
  `login-item-get` answered (control=1).
- Log since the A0 stop (`18:23:46.529`): 5,324 lines, of which 1,149 `[clipboard]`: **1** `Stopped
  watching this Mac's clipboard` and **1,148** `Cleared # clipboard entries: the link dropped`. **0** poll,
  send or apply lines. Control: 207 `[clipboard]` lines earlier the same day.
- Instrument note: the first count read `$2` as the time; this log writes date and time as one ISO field,
  so it counted every line of the day. Recounted on `$1`.
- Observation, not filed: during the offline stretch the "Cleared 0 clipboard entries" line repeats about
  three times per reconnect attempt (64 against 22 attempts after 22:00). Log volume only.

## 4. A2a — code-only rollback copy (done 22:41)

Location: `~/.connectsuite-evidence-private/rollback-2026-10-06/` — **outside the repository**. Directory
and subdirectories 0700; APKs, manifests and the script 0600; the two `dist/` trees keep their source
modes (files 0644, dirs 0755 — none executable in either source), copied with `ditto`, no recursive
`chmod`. 191 MB.

| Item | Source | Verified value |
|---|---|---|
| `android/installed-base-2026-10-04.apk` | pulled from the phone 22:26 | `b0ad2a47a87e0356d39c8494b74f744f9cbe1fc2cf983c4d73951633f3e327f9` |
| `android/sidekick-debug-286e2b0.apk` | prepared APK | `5f014e9e0b0172ae8ff8cadf3551f5847f9682699535323947607bfd642530ad` |
| `mac-build-4661015/dist` | pinned scratch build | manifest `bb5941689b8ef4e6d9137cd13e5db0bf28732bba360a6c2441b0b50fd39a524d`, 308 files |
| `mac-live-dist-2026-10-04/dist` | **the live `desktop/dist`, exactly** | manifest `f862a1ae81bf313186468867dcbe81382dc50d0480313f4f8326c615a76fef22`, 274 files, 0 symlinks/specials |

Not included, by instruction: any profile, setting, identity or private key, clipboard data, Activity
history or log.

**Manifest procedure (deterministic):**

```sh
export LC_ALL=C
cd <root> && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256
```

Every regular file, paths relative with a `./` prefix, NUL-separated, byte-order sorted, SHA-256 of each
file, then SHA-256 of that listing. Symlinks and special files are counted separately (0 in both trees).
This procedure reproduces the recorded `bb594168…` for the pinned build, and the committed per-file listing
`mac-dist-manifest-4661015.sha256` hashes to the same value. The live tree's per-file listing is
`mac-dist-manifest-live-2026-10-04.sha256` (its own SHA-256 is `f862a1ae…`).

**Verification, all OK** (`a2a.sh`, kept in the private directory):

- before copying, all four sources matched the values above;
- the live dist's manifest, per-file listing **and** mode listing were identical before and after the
  copy — it did not change during the copy;
- each destination's manifest, per-file listing and mode listing equal its source's; each APK's hash equals
  its source's;
- control: a copy of the pinned build with one byte appended to `main/activity.js` hashes differently.

The live `desktop/dist` was read only — not deleted, moved or replaced.

## 5. The earlier live-dist hash — **unresolved**

The preflight recorded the live dist as `4f40b0e9…` (plan §1, `testing.md`) without recording how it was
computed. The procedure above gives `f862a1ae…`. Five variants were tried and none gives `4f40b0e9…`:
`dist/`-prefixed paths under C-locale and default sort (both `10e6ed20…`); `./` paths under default sort,
NUL sort, and with `sha256sum` instead of `shasum` (all `f862a1ae…`). Every file's mtime is 2026-10-04 17:09, but **mtimes are not proof that nothing changed** — they
can be preserved or reset by a copy, a checkout or a tool. Whether `4f40b0e9…` describes these same bytes
cannot be established now. **The rollback baseline is the verified copy, `f862a1ae…`**, measured twice
around the copy and once on the destination.

## 6. A2b — private Activity backup (23:08–23:09)

Sidekick (PID 91450) quit through its named **Quit Sidekick** menu item, exit confirmed (no PID, no
helper, no 9222 listener). Then only `activity.jsonl` was copied to
`~/.connectsuite-evidence-private/rollback-2026-10-06/activity-backup-2026-10-06/` (0700; file and
`SHA256SUMS` 0600), with the source stable across reads and the destination hash equal:

| | |
|---|---|
| SHA-256 | `3bf3ce35f5cc7a45901d411741dc08b4bee60b107ec5145a4ba879dc25d3020f` |
| Bytes | 559,371 |
| Lines (newline count) | 4,915 |
| Last byte | newline (structural only) |

No Activity content was read out. Kept until the owner approves deletion; reminder at the end of G or
2026-10-13, whichever is first.

## 7. A3 — relaunch on `4661015` (23:11–23:20)

Pre-checks all passed; the old `desktop/dist` (`f862a1ae…`) was moved (not deleted) to
`~/.connectsuite-evidence-private/rollback-2026-10-06/mac-live-dist-moved-at-a3/dist` and re-verified;
the private `4661015` copy was placed and verified (`bb594168…`, 308 files) before launch.

| Reading | Value |
|---|---|
| Instances | 1 (PID 67469), owner of port 9222; no `CONNECTSUITE_*` variables; 0 `[debug]` lines |
| Rewrite | 294 call rows redacted / 0 lines dropped / 4,915 kept; 0 unknown-field warnings |
| Store | 2000 events read (cap), 0 unreadable |
| `activity.jsonl` after | `f19445d9ae8c49ffcc87dc6ca43f1b561ffe2616a765ab8e8028b05c2148a6ad`, 559,936 bytes, 4,917 lines |
| Activity pane | 9 rows (page size 9), 0 state cards, *All* chip 2000 |
| Clipboard watcher | off — setting and IPC |
| Pairing | legacy |
| Link | connected to the existing phone build, no drops |
| Warnings | 2 expected (share gate; one contact lookup NOT_FOUND), 0 errors |

No Activity row, contact, clipboard text or pairing material was read out.

## 8. A4 — phone install (23:23–23:30)

| Reading | Before | After |
|---|---|---|
| on-phone `base.apk` | `b0ad2a47…f327f9` | `5f014e9e0b0172ae8ff8cadf3551f5847f9682699535323947607bfd642530ad` |
| versionCode / signer | 1 / `d3a505d2…7d26` | 1 / `d3a505d2…7d26` |
| `lastUpdateTime` | 2026-10-04 17:08:34 | 2026-10-06 23:23:31 |
| installed 0 / 95 / 150 | true / true / false | true / true / false |
| runtime grants 0 / 95 | 14/14 / 0/14 | 14/14 / 0/14 |
| listener / accessibility | bound / off | bound / off |
| app processes | u0 | u0 + **u95 (cached, no service)** |

Command: `scripts/adb-pinned.sh samsung install -r --user 0 …/sidekick-debug-286e2b0.apk` → `Success`.
LinkService restarted by the platform (`PACKAGE_REPLACED`, `LISTENER_REBIND`, 23:23:32.8); Mac reconnected
23:23:32.998, legacy. `am start --user 0` of `MainActivity` once: resumed 23:28:06–23:28:57; **no clipboard
event either side** (cause unresolved, §9.6 of the plan). `link-up.sh` three OKs. No content of any kind
was read out.

## 9. B/H4 — secure re-pair (2026-10-06 23:46–23:57)

| Reading | Value |
|---|---|
| Mac Forget | 23:46:37, by name, premise re-checked in the click (one earlier run refused on a wrong field name, nothing clicked) |
| Phone Forget (owner) | 23:56:31, `Forgot … closed 0 live session(s)` |
| Phone armed → paired | 23:57:05 → 23:57:14, `pairing v2, both sides proved the code` |
| Mac | `pairing v2, both sides proved the code` 23:57:14.121; connected .134; stored `pairing: 2` |
| Legacy lines since Forget | 0 |
| `link-up.sh` | three OKs |
| Watcher | off (setting + IPC) |
| Clipboard arrivals | 0 |
| *Verifying* screen | not visually verified; the scan occurred before the owner was asked to scan and was not directly observed — that the scanner read the code on the Mac's screen is an inference, not an established cause |
| Settings sentence | stale legacy copy until the Connection tab was reopened — a workaround, not a fix (candidate defect) |
| Masking | a masking command leaked fingerprint fragments into session output (not into any file) |

No QR, token, fingerprint, clipboard text or personal data in this file.

## 10. C step 2 — Mac Disconnect / Connect (2026-10-07 00:14)

| Reading | Value |
|---|---|
| Disconnect → idle | 11 ms; phone `link-up.sh` reading 3 FAIL (no control session) — down confirmed |
| Connect → connected | 110 ms (100 ms polling), **1** attempt (last-known) |
| Pairing on reconnect | Mac `pairing: v2`; phone v2 label; 0 armed / 0 proof exchanges / 0 legacy / 0 refusals |
| Stored pairing | `2` |
| `link-up.sh` after | three OKs |
| Clipboard | 0 arrivals, 0 sends; watcher off (setting + IPC) |
| Backups | unchanged |

Phone Wi-Fi toggle (step 3) not approved and not run.

## 11. Stage D — clipboard (2026-10-07 01:11–01:42), stopped at step 6

Markers by label only. Full table: plan §9.10.

| Step | Verdict | Key evidence (sanitized) |
|---|---|---|
| 1 | PASS | Mac clipboard = M-BASE; 0 sends |
| 2 | PASS (offer) | phone `origin selection: 10 bytes from Keep Notes`; Mac `Offered … (origin selection): 10 bytes, NOT applied`; clipboard unchanged |
| 2 banner | unavailable | macOS `addRequest not allowed: com.github.Electron` 9 ms after the app's request |
| 3 | not runnable | no banner |
| 4 | PASS | `Applied an arriving entry … 10 bytes`; duplicate Copy refused (`ok:false`, 0 Copy buttons) |
| 5 | PASS | `Restored a displaced entry: 11 bytes`; clipboard = M-BASE |
| 6 | FAIL to start | no Send-to-Mac dispatch: logcat 0 vs control 42; no activity start vs control |
| 7, 8 | not run | stop: non-marker content on the Mac clipboard, not written by Sidekick |

Markers in either app's log: 0.
