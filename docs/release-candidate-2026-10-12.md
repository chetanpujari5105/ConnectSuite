# Release candidate — 2026-10-12 (`83c4096`) · NOT signed, NOT published, NOT launched

Built from an exact `git archive` of `83c4096` (so none of the owner's uncommitted edits could reach either
artifact) into an isolated folder in the session scratch directory: `node_modules` APFS-cloned,
`npm run build` then `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never`, then
`./gradlew :app:assembleRelease` without `-Pconnectsuite.signRelease`. `desktop/dist`, `desktop/release` and the
running development app were not touched by the build. **Nothing was installed, launched, signed, notarized,
uploaded or pushed**; no packaged Sidekick ran on the owner's account (defect 207). Artifacts:
`~/.connectsuite-evidence-private/rc-83c4096/` with `SHA256SUMS.txt` and the raw output of the Mac checks
(`static-checks-mac.txt`); `rc-8f8ecbb/` and `rc-34362e1/` are kept. Supersedes
`docs/release-candidate-2026-10-11.md` for §1–3; its §5–6 (statements still to confirm) carry over unchanged.

**What is new since `8f8ecbb`** (12 commits): the beta token trial (`c0071d4`, `d5b98e0`, `da1d28f`), **the
trial's public key** (`3f5155d`) — the first candidate in which a token can be checked — and defects 221 and 222
fixed in the token entry (`83c4096`); the phone's copy says Sidekick (`711a1e0`); the private-key commit guard
and the issuer script (`2c7d924`, `a9aebde`). No dependency, Gradle file, manifest, backup rule or
`electron-builder.yml` changed.

## 1. Artifacts

| Artifact | SHA-256 | Bytes | State |
|---|---|---|---|
| `Sidekick-2.0.0-arm64.dmg` | `a50c2461bcc8e34130707006005dc61be267672702694fe46567f0c853b11d35` | 121,675,455 | ad-hoc signed, hardened runtime |
| `Sidekick-2.0.0.dmg` (Intel) | `5bab1f5b838acffa5f4195f0f4c6423b0e3d67cd6be7e832c90a117a7a803e50` | 126,572,183 | ad-hoc, see the x64 note |
| `Sidekick-2.0.0-arm64-mac.zip` | `eea767cc37b3e8db913dcab8b404f548921792dce40aae0df5b78ed48f50e1fe` | 117,018,323 | same app, zipped |
| `Sidekick-2.0.0-mac.zip` (Intel) | `add42f27e36e195010128a730b0d8db698c3dc40851d19a457273803d5972599` | 121,962,164 | same app, zipped |
| `app-release-unsigned-83c4096.apk` | `040f178c70ca8df5cccf0bf3a9e34621817d80ab8c9d5dc8eb933720398d832f` | 5,316,240 | **unsigned — cannot be installed** |

`app.asar` SHA-256, both architectures and inside both zips: `251e4df6b340433200780fceca991c83d5a71a93528df7788d6a9284924d669b`.
`shasum -a 256 -c SHA256SUMS.txt`: 5 of 5 OK.

## 2. Mac — static checks (both architectures, identical results)

Read from the two `.app` folders the images were packed from; both zips were then extracted and their
`app.asar` hashed equal to the one checked. The `.dmg` files were not mounted.

| Check | Result |
|---|---|
| Electron fuses | `000011011` — RunAsNode, NODE_OPTIONS, `--inspect` off; ASAR integrity and ASAR-only on (`build/fuses.mjs` `readWire`) |
| ASAR integrity | `Info.plist` `36b5b28713a3…` = SHA-256 of the asar header |
| Quarantine key | `LSFileQuarantineEnabled = true` |
| Signature | deep-strict verify OK; `Signature=adhoc`, `flags=(adhoc,runtime)` |
| Gatekeeper | `rejected` for both (expected for ad-hoc); control Calculator `accepted` in the same run |
| Test / map files in the asar | **0** of 920 |
| Release gates | `FS_BLOCKS_RELEASE`, `WEBCAM_RELEASE`, `SHARE_V3_RELEASE`, `SHARE_WAIT_RELEASE` all `false` |
| **Trial public key** | present in `dist/main/trialKey.js` (the scan for it over the whole extracted asar found exactly that one file); `main.js` requires `./trialKey` and passes `TRIAL_PUBLIC_KEY` to the trial |
| **The packaged build cannot skip the trial** | `main.js` builds the trial with `packaged: app.isPackaged, skipSwitch: !app.isPackaged && debugSwitches().skipTrial`, and `trial.js`'s `trialEnforced` returns `packaged \|\| !skipSwitch` — so a packaged app checks whatever `CONNECTSUITE_DEBUG_SWITCHES` says. `CONNECTSUITE_DEV_PROFILE` is likewise ignored when packaged (`profile.test.ts`). With the `RunAsNode` and `--inspect` fuses off, the packaged binary cannot be started as Node or attached to, which is how the development walk shifted its clock |
| Defects 221 / 222 | the fix is in the packaged `dist/renderer/trial.js` |
| **Private-key material** | **0 hits** in both `.app` bundles (267 files each), both extracted asars (920 each) and both extracted zips. Searched: a PEM private-key block with a body, and the Ed25519 PKCS#8 prefix as base64, hex and raw bytes. Control: a key made in memory for the run (never written) was found in all four encodings |
| Bundle | `com.chetan.sidekick.desktop`, `2.0.0` |

**x64 note (known, D12 in `docs/phase-9-distribution-audit.md`):** the ad-hoc hook again logged `21/22 … — 1
FAILED: Electron Framework` for the Intel build and continued, because its gate is the bundle's deep verify,
which passes. **The Intel app has never run on an Intel Mac.**

## 3. Android — static checks

| Check | Result |
|---|---|
| Package / version | `com.chetan.connectsuite`, `versionCode 1`, `versionName 2.0.0`, target/compile SDK 36 |
| Signer | `apksigner verify` → **DOES NOT VERIFY** (`Missing META-INF/MANIFEST.MF` — unsigned, as intended) |
| New strings | `711a1e0`'s *Settings > Apps > Sidekick > Permissions > SMS* present in the dex, the old *… ConnectSuite …* absent — and the reverse in `8f8ecbb`'s APK (control `MainActivity` in both). The two APKs are the same size by coincidence; their hashes differ |
| **Private-key material** | **0 hits** over all 450 entries (5,272,883 bytes uncompressed, equal to the archive's own listing), read entry by entry in memory — extracting to this case-insensitive disk collides R8's renamed resources (`res/9n.9.png` / `res/9N.9.png`) and would silently drop files |
| Manifest, components, permissions, foreground-service types | unchanged since `8f8ecbb` (no manifest or Gradle change); §3 of `docs/release-candidate-2026-10-11.md` stands |

## 4. The trial in this candidate

The candidate checks tokens against the key created on 2026-10-12. Every state was walked on the owner's Mac
on the development build of the same source, without the skip switch (`docs/testing.md` → *Beta trial — key
created, owner token entered, every state on screen*). **The packaged app itself has not shown its token screen
yet** — that is the fresh-user test (checklist step 13), where the tester's first token is entered.

## 5. What these checks do not prove

- **Neither artifact has run.** The packaged Mac app is not launched on the owner's account (defect 207); the
  APK cannot be installed until signed. The fresh-user plan (`docs/beta-hardware-plan-2026-10-09.md` §B) is how.
- The private-key scan finds the shapes it names; a key encrypted, split or re-encoded beyond them would not be
  seen. Keeping the key outside the repository and the build is the real protection, and it was.
- R8 is on for release and off for the debug build on the phone.
- One SM-S938B and one Mac, as everywhere in this project.
