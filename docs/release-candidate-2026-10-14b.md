# Release candidate — 2026-10-14 (`bcb92ec`, version 2.0.1) · NOT signed, NOT published, NOT launched

Built exactly as `3bc1aa5` (`docs/release-candidate-2026-10-14.md`): `git archive` of `bcb92ec` into the session
scratch directory, `node_modules` APFS-cloned, `npm run build`, `CSC_IDENTITY_AUTO_DISCOVERY=false npx
electron-builder --mac --publish never`, `./gradlew :app:assembleRelease` unsigned. Nothing installed, launched,
signed, notarized, uploaded or pushed; no packaged Sidekick on the owner's account. Artifacts:
`~/.connectsuite-evidence-private/rc-bcb92ec/`, `SHA256SUMS.txt` 5 of 5 OK.

**New since `3bc1aa5`:** version 2.0.1 on both apps (`88fc7a1`), the Keychain note says *may ask* (`4b4632e`), the
share-folder check (`d69b9a4`), the blocked-prompt record (`bcb92ec`).

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `Sidekick-2.0.1-arm64.dmg` | `bf8042be0447c1ac9670981674a5a617b0485d4f21ed9f3e600279ae09f8b716` | 121,674,754 |
| `Sidekick-2.0.1.dmg` (Intel) | `1f1a021bb94e671ba4541653f1db04c5f4ae959013fa42c640d13088868f6a1b` | 126,571,629 |
| `Sidekick-2.0.1-arm64-mac.zip` | `0c84c1460814b621bfd3529159895b56735b02cf29d401d538b0d6fad33e7ba0` | |
| `Sidekick-2.0.1-mac.zip` (Intel) | `87239687021a9b5594ffb8000ec3a406da0f834b79559e43cd413cbdc1abde86` | |
| `app-release-unsigned-bcb92ec.apk` | `bbf8e9756fd0da506463c84b9991606ba5fff992f0b1c077b06a97407debe15b` | 5,316,240 — `versionName='2.0.1'`, `versionCode='1'` (aapt2) |

`app.asar` SHA-256, both architectures and both zips: `b15cb025c260495e53097ba9b6443a5f563e86249bcc4894beefcef599863b06`.

## Checks (both architectures, identical)

Every check of `3bc1aa5`'s record passes again — fuses `000011011`, ASAR integrity, quarantine key, deep-strict
codesign (`adhoc,runtime`), Gatekeeper `rejected` (expected), 0 test/map files of 920, release gates `false`, the
public key in `dist/main/trialKey.js` only, the packaged build cannot skip the trial, every batch-1 piece present,
the shipped verifier on synthetic tokens (quoted+wrapped → `ok` and equal to the issued token; checksum →
`malformed/checksum`; last character changed and another key → `bad-signature`; cut off → `malformed/cut-off`),
and **0 private-key hits** across both `.app` bundles, both asars, both zips and all 450 APK entries. New:

- **Version:** the asar's `package.json` `2.0.1`; Settings › About's `APP_VERSION` `2.0.1`; the hello fallback
  `2.0.1`; `CFBundleShortVersionString` `2.0.1`; `LSMinimumSystemVersion` `11.0`.
- The note in `identityStore.js` reads *macOS may ask*, and *macOS will ask* appears nowhere in it.
- x64: the known D12 framework-sign line again. The Intel app has never run.

## Share folder

`~/Desktop/Sidekick-Beta-Share-2026-10-12`: the 2.0.0 DMGs and APK replaced by the 2.0.1 ones (byte-identical
private copies of the old files confirmed in `rc-3bc1aa5/` and `rc-83c4096/` first), README and HTML guide updated,
`node scripts/check-share-folder.mjs` → *no \*.sidekick-token file, no complete token, no private key* over 16,906
files (15 links not followed), `SHA256SUMS.txt` 6 of 6 OK, each artifact `cmp`-identical to `rc-bcb92ec/`.
