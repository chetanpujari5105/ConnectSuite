# Release candidate — 2026-10-14 (`3bc1aa5`) · NOT signed, NOT published, NOT launched

Built the same way as `83c4096` (`docs/release-candidate-2026-10-12.md`): an exact `git archive` of `3bc1aa5`
into the session scratch directory, `node_modules` APFS-cloned, `npm run build`, then
`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never` and `./gradlew :app:assembleRelease`
without signing. The owner's uncommitted edits could not reach it; `desktop/dist`, `desktop/release` and both
running apps were not touched. **Nothing was installed, launched, signed, notarized, uploaded or pushed.**
Artifacts: `~/.connectsuite-evidence-private/rc-3bc1aa5/` with `SHA256SUMS.txt` (5 of 5 OK) and the raw check output.

**New since `83c4096`:** app batch 1 (`cf12145`, `4f9384c`, `3bc1aa5`) — the forgiving token paste, the
canonical-signature tightening, the token screen's Paste token and help, and the Keychain note
(`docs/token-entry-2026-10-14.md`). No phone source, dependency, manifest or `electron-builder.yml` changed.

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `Sidekick-2.0.0-arm64.dmg` | `428f5555f6f72760d40b91507400729a497bfd0a9fedeadeeaaad89410d4c56c` | 121,679,428 |
| `Sidekick-2.0.0.dmg` (Intel) | `b0350cf8d130b769d9815f26c6527b0b81d6e8abc02f4516c38452fab6715aee` | 126,588,842 |
| `Sidekick-2.0.0-arm64-mac.zip` | `8832a83bed5d33b84dc23720987742702dbde3a93ba354ad00cc231dcce0ca97` | |
| `Sidekick-2.0.0-mac.zip` (Intel) | `2ae1e1bc4451dffa851a0666010246ecda3a7a26e781bec7523502f0ee41827e` | |
| `app-release-unsigned-3bc1aa5.apk` | `040f178c70ca8df5cccf0bf3a9e34621817d80ab8c9d5dc8eb933720398d832f` | **byte-identical to `83c4096`'s** — no phone source changed between the two commits on this branch, so this is a reproducible build, not a stale one (`6e0acb4`'s phone fixes are on `play/release-vc3`, not here) |

`app.asar` SHA-256, both architectures and both zips: `0eac60800537991297b8be379fade145f0564c1584f58426760648ae81490c26`.
Version `2.0.0` (`CFBundleShortVersionString`; Settings › About shows *Version 2.0.0*) — **the same string as
`83c4096`**, so a tester cannot tell the builds apart by version; the checksum or the commit says which.
`LSMinimumSystemVersion` `11.0`.

## Static checks (both architectures, identical)

All of `83c4096`'s checks again — fuses `000011011`, ASAR integrity match, quarantine key, deep-strict codesign
OK (`adhoc,runtime`), Gatekeeper `rejected` (expected for ad hoc), 0 test/map files of 920, release gates all
`false`, the public key in `dist/main/trialKey.js` only, the packaged build cannot skip the trial, defects
221/222 present, **0 private-key hits** in both `.app` bundles, both asars, both zips and all 450 APK entries
(scanner control: an in-memory key seen in all four encodings). Plus, for this batch, read from the packaged JS:

- Paste token button, the help answer, and no doors on the token screen in `dist/renderer/trial.js`;
  `trial-paste` in the preload, and its handler reading the clipboard in `main.js`;
- the Keychain note before `createWindow()` inside `whenReady`, with the owner's sentence in `identityStore.js`;
- the canonical-signature check and `cleanPastedToken` in `dist/shared/trial.js`;
- **the shipped verifier run in Node** against synthetic tokens from an in-memory key (never written): a quoted,
  wrapped token → `ok`, cleaned to exactly the issued token; a 64-hex string → `malformed/checksum` with the
  checksum sentence; last character changed → `bad-signature`; another key → `bad-signature`; cut off →
  `malformed/cut-off`.

The x64 ad-hoc hook logged `21/22 … 1 FAILED: Electron Framework` again (D12, known). **The Intel app has never run.**

## Not proven by these checks

- **The packaged app has not run.** Its Keychain note, whether macOS prompts on a fresh user's first launch,
  the Paste button against a real clipboard, and the token screen in the packaged build all need a fresh
  macOS user (`docs/beta-hardware-plan-2026-10-09.md` §B). Defect 207: never on the owner's account.
- The APK cannot be installed until signed.
