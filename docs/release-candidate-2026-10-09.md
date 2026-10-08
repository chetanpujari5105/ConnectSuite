# Release candidate — 2026-10-09 (`34362e1`) · NOT signed, NOT published, NOT launched

Built from an exact `git archive` of `34362e1` (so no uncommitted edit could reach either artifact), into
isolated folders in the session scratch directory. **Nothing was installed, launched, signed, notarized,
uploaded or pushed.** The owner's development identity and profile were not touched by these builds.

## 1. Artifacts

| Artifact | SHA-256 | Size | State |
|---|---|---|---|
| `Sidekick-2.0.0-arm64.dmg` | `d9d3a456b56b533e741ecbf35a87a98dd7b3fc808f8c61c37a73b9ad8f1386d0` | 123.1 MB | ad-hoc signed, hardened runtime |
| `Sidekick-2.0.0.dmg` (Intel) | `f08492d68b7a4178a77e764b898686fd63be79fc847c80ec8c515c82abfd09ca` | 128.0 MB | ad-hoc signed, hardened runtime |
| `Sidekick-2.0.0-arm64-mac.zip` | `19faa28340495af9755d436ac80cc57163652c97206325e74840a7af5aef755c` | 117.7 MB | same app, zipped |
| `Sidekick-2.0.0-mac.zip` (Intel) | `43cb0036f7e3d0a0988f6cc9912aa1a54261b38f5dd99a9742c8e4f7d58ed211` | 122.7 MB | same app, zipped |
| `app-release-unsigned.apk` | `c0814f505cfbbcfdd2a6eb56ada9d2cefa984864a1d0253d52da1b632417fbd9` | 5.1 MB | **unsigned — cannot be installed** |

`app.asar` SHA-256 (both architectures): `07b414c6bb29cc0f113283656eef507fc2e4c5f7f91da983aa44cc6be6734c53`.

**The APK is 5.1 MB; the 2026-10-08 candidate was 25 MB.** The difference is ML Kit's bundled barcode model
and Play-services pieces (item 4).

## 2. Mac — static checks (both architectures, identical results)

| Check | Result | How read |
|---|---|---|
| Electron fuses | `000011011` (RunAsNode, NODE_OPTIONS, `--inspect` off; ASAR integrity and ASAR-only on) | `build/fuses.mjs` `readWire` on `Electron Framework` |
| ASAR integrity | declared hash = SHA-256 of the asar header (`cb59ec83…`) | `Info.plist` `ElectronAsarIntegrity` vs `@electron/asar` header |
| Quarantine key | `LSFileQuarantineEnabled = true` | `Info.plist` |
| Signature | `Signature=adhoc`, `flags=(adhoc,runtime)`, `TeamIdentifier=not set` | `codesign -dv` |
| Gatekeeper | `rejected` (expected for ad-hoc; a verdict, not an error) | `spctl -a -vv -t exec` — reads only |
| Test / map files in the asar | **0** of 1,070 files | asar listing |
| Release gates | `FS_BLOCKS_RELEASE`, `SHARE_V3_RELEASE`, `SHARE_WAIT_RELEASE`, `WEBCAM_RELEASE` all `false`; call banner `!app.isPackaged && …` | compiled JS inside the asar |
| Debug switches | read only when `!app.isPackaged` | compiled `main.js` |
| This batch's fixes present | 207 a/b/c/d, 208 (both halves), item 5 — **7 of 7** | a distinctive string per fix in the compiled JS |
| `entry.js` requires `dist/main/profile.js` and it is packaged | yes | asar |

**Entitlements reviewed** (`build/entitlements.mac.plist`): `allow-jit`, `allow-unsigned-executable-memory`,
`allow-dyld-environment-variables`, `disable-library-validation`, `network.client`,
`files.user-selected.read-write`, `files.downloads.read-write`. No sandbox, no `network.server` (both
deliberate and explained in the file). **Concern for the Developer ID build:** `disable-library-validation` is
documented as needed only while ad-hoc; together with `allow-dyld-environment-variables` it lets anyone able to
launch the app inject a library into it. Both should be removed for the signed build and the removal measured
by a launch — which needs the signed build.

## 3. Android — static checks

| Check | Result |
|---|---|
| Package / version | `com.chetan.connectsuite`, `versionCode 1`, `versionName 2.0.0`, target/compile SDK 36 |
| Debuggable | not set (control: the same `aapt2 badging` query shows `application-debuggable` on a debug APK) — so Camera v1 (`CameraReleaseGate.allows(debuggable)`) is **off** |
| Signer | `apksigner verify` → **DOES NOT VERIFY** (unsigned, as intended; signing is the owner's act) |
| Exported components | `MainActivity` (launcher), `SendSelectionActivity`, `ShareToMacActivity`, `ShareManyToMacActivity` (share/selection entry points); `SmsMirrorReceiver` (protected by `BROADCAST_SMS`); `androidx…ProfileInstallReceiver` (protected by `DUMP`). Everything else `exported=false` |
| Foreground-service types | `LinkService`, `ConnectionService`: `connectedDevice`; `MirrorService`: `mediaProjection`. **No `dataSync`** |
| Debug probes | none in the release manifest (0 names matching *Probe* or *Debug*) |
| Google / telemetry code | with `MainActivity` as the positive control (1): `com/google/mlkit` 0, `com/google/android/gms` 0, `datatransport` 0, `firebase` 0, even as plain strings. ZXing present (R8 renamed its classes; its `QR_CODE` constant is there) |
| Permissions | 31 — listed with reasons in `docs/privacy-policy-draft-2026-10-09.md` §3 |

Dependency graph proof (item 4): release runtime classpath **16 Google artifacts → 0**; merged release manifest
**26 → 20 components**, the six removed being ML Kit's init provider and discovery service, `GoogleApiActivity`,
and `datatransport`'s discovery service, job service and alarm receiver. Permission list unchanged.

## 4. What these checks do not prove

- **Neither artifact has been run.** The packaged Mac app is not launched on the owner's account (defect 207's
  rule); the APK cannot be installed until signed. Launch, pairing, and every feature on these exact bytes are
  unverified — the fresh-user plan (`docs/beta-hardware-plan-2026-10-09.md` §B) is how they get verified.
- R8 is on for release and off for the debug build that is on the phone. A class R8 broke (reflection, a missing
  keep rule) would show only on the signed release build. ZXing uses no reflection; the risk is not zero.
- One SM-S938B and one Mac, as everywhere in this project.

## 5. Install instructions for testers

`docs/beta-tester-guide.md`.
