# S5 fuses and S8 quarantine — isolated packaged builds, 2026-10-07 (overnight, unattended)

**What ran:** packaging only, in the session scratch directory, offline from the local Electron cache
(`electron-v43.4.1-darwin-arm64.zip`). `desktop/dist`, `desktop/release` and the live app were not touched;
no packaged **Sidekick** was ever launched; port 9222 was never used.

## 1. Sidekick, packaged from `6777b74` (static checks only — not launched)

Not launched on purpose: a packaged Sidekick mints a keychain item on first run, its userData could collide
with a real profile, and an unpaired instance runs pairing discovery toward the phone on the network.

| check | reading |
|---|---|
| fuse wire in `Electron Framework` | version 1, length 9, **`000011011`** (Electron's default `101100011`) |
| `ElectronAsarIntegrity` in `Info.plist` | present — `Resources/app.asar`, SHA256 — so the integrity fuse has a hash to check |
| `LSFileQuarantineEnabled` | `true` (this build also carried the exclusion patterns, removed afterwards — §3) |
| `codesign --verify --deep --strict` | OK; `Signature=adhoc`, `TeamIdentifier=not set`, hardened runtime |
| asar | 1,066 files; `dist/main/releaseGuards.js`, `quarantine.js`, `clipOfferNotifier.js` present |

## 2. Launch harness — what a launch proves, with a control for every reading

A minimal app (no network, no keychain, no Sidekick code: a hidden window, a `file://` page with a script and
a stylesheet, a `contextIsolation` + `sandbox` preload bridge, one IPC round trip, a result file) packaged with
the **same** `build/adhoc-sign.mjs` + `build/fuses.mjs` + entitlements. Three variants:

- **fused** — release fuses + `entry.js` guard (what a release build is);
- **control** — no fuse change, no guard (Electron defaults) — every instrument's positive control;
- **noguard** — release fuses, no guard — separates the fuse layer from the guard.

Bounds: 20 s per launch; ports 9333/9334 sampled every ~50 ms while the process lived (both checked free
before and after). Runner: `run.py` (paths redacted); raw results: `launch-report.json`.

| test | fused | control | noguard | reading |
|---|---|---|---|---|
| normal launch, direct exec | exit 0; script ran, CSS applied, bridge present, IPC `pong=42`, no Node in page | same | same | **startup and preload work with the fuses on; ASAR integrity validated (it launched)** |
| normal launch via `open` (LaunchServices) | same | same | — | same |
| `ELECTRON_RUN_AS_NODE=1 … -e <write marker>` | marker **absent**, the app ran normally | marker **written** | — | the RunAsNode fuse works |
| `--remote-debugging-port=9333` | exit **78** (guard), port never seen, no `DevTools listening` | port **listening**, `DevTools listening` | port **listening** | **no fuse covers it — the guard is load-bearing** |
| `--inspect=9334` | exit 78 (guard) | port **listening** (`Debugger listening`) | **no listener**, app ran | the inspect fuse works on its own; the guard is a second layer |
| `NODE_OPTIONS=--require <marker script>` | marker absent | marker **absent** too — Electron logged *Most NODE_OPTIONs are not supported in packaged apps* | — | **NO READING for the fuse**: the control could not show injection, so this test cannot tell the fuse apart from Electron's own refusal |

## 3. `LSFileQuarantineEnabled` — measured, and one claim withdrawn

| written by the harness | quarantine |
|---|---|
| `received/plain.bin`, `received/nested/deeper/deep.bin` (LaunchServices launch) | present, present |
| `received/plain.bin` (direct exec) | present |
| paths named by an absolute `…/excluded/*` pattern | **present** |
| paths named by `~/Library/Caches/S5HarnessExclTest/tilde/*` and by a bare `…/tildedir` | **present** |
| the harness's own Chromium profile (40 files, then 42) | **present, 40/40 and 42/42** |
| 3 relaunches over the quarantined profile | each exit 0, page and bridge OK |

**macOS (26.6.1, ad-hoc signed, not sandboxed) honoured the key and ignored every exclusion spelling tried.**
So the exclusion patterns added to `electron-builder.yml` earlier tonight claimed something false; they were
removed, and the comment, `quarantine.ts` and its test now say what was measured. A packaged Sidekick's own
profile files will carry the attribute: harmless for data files (reading and writing are unaffected) and a
relaunch over it worked in the harness — **not** measured with Sidekick itself (keychain, safeStorage).

The test folder created under `~/Library/Caches/S5HarnessExclTest` was removed after the reading; no other
folder was created outside the scratch directory (checked: no `S5Harness*` under Application Support or Caches).

## 4. Not done, and why

- **Entitlements unchanged.** `disable-library-validation` is load-bearing while the build is ad-hoc signed
  (the app does not launch without it, recorded in the entitlements header); `allow-dyld-environment-variables`
  is listed there as needed by V8 and was not tested tonight. Both belong to the Developer ID change.
- **`EnableCookieEncryption` and `GrantFileProtocolExtraPrivileges` unchanged** — the first is a keychain change,
  the second needs Sidekick's real pages proven under it; neither was measured here.
- **Sidekick itself was not launched packaged.** That is a supervised morning item (fresh user, owner present).
