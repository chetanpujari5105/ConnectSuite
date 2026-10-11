# Release candidate — 2026-10-11 (`8f8ecbb`) · NOT signed, NOT published, NOT launched

Built from an exact `git archive` of `8f8ecbb` (so none of the owner's uncommitted edits could reach either
artifact) into an isolated folder in the session scratch directory: `node_modules` APFS-cloned,
`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never`, then
`./gradlew :app:assembleRelease` without `-Pconnectsuite.signRelease`. `desktop/dist`, `desktop/release` and the
running development app were not touched. **Nothing was installed, launched, signed, notarized, uploaded or
pushed.** Artifacts: `~/.connectsuite-evidence-private/rc-8f8ecbb/` with `SHA256SUMS.txt`; the previous
candidate's folder `rc-34362e1/` is kept. Supersedes `docs/release-candidate-2026-10-09.md` for anything quotable.

**What is new since `34362e1`** (37 commits): the new outlined-mask logo on both apps (`f71ffd1`); the Overview
pill row **Start mirroring · Send files · Device info** and the Recent activity spacing (`c013ff8`, `fb2df10`);
defects 210–220 (stale panes on return, card layout, phone tile, quit wording, …). No dependency, Gradle file,
manifest or backup rule changed.

## 1. Artifacts

| Artifact | SHA-256 | Bytes | State |
|---|---|---|---|
| `Sidekick-2.0.0-arm64.dmg` | `2dd74a2a69c8b8b3e6c59ce184aa47c9d93c36bc28f73f33cab4b6e375beb92b` | 121,646,977 | ad-hoc signed, hardened runtime |
| `Sidekick-2.0.0.dmg` (Intel) | `0fe6d2a4c9cf1c480135fc7cf14bcc2a461b547eb00a155e09ba4c68f017c70d` | 126,587,008 | ad-hoc, see the x64 note |
| `Sidekick-2.0.0-arm64-mac.zip` | `1e897b0ad9fd98059d0bbcf0f6fb41987fd1ef169c774b8f72a9f6bf460dd3a1` | 117,007,046 | same app, zipped |
| `Sidekick-2.0.0-mac.zip` (Intel) | `04a1321eccd016075a8a32b251cf9ed90e521b2fddc4dab44df91d4abc3c78f4` | 121,950,889 | same app, zipped |
| `app-release-unsigned-8f8ecbb.apk` | `53802a456d26e6944be32832e1b62f312e4cafbecbf9872cc751365dfc39dc0f` | 5,316,240 | **unsigned — cannot be installed** |

`app.asar` SHA-256, both architectures and inside both zips: `ef31c799b8f27c50b6bac0c4a61c1426e6810b81ab335daa788cc5163edc06fb`.

## 2. Mac — static checks (both architectures, identical results)

Read from the two `.app` folders the images were packed from; the zipped `app.asar` was then hashed and equals
the one checked (control that the zip carries what was read). The `.dmg` files were not mounted.

| Check | Result |
|---|---|
| Electron fuses | `000011011` — RunAsNode, NODE_OPTIONS, `--inspect` off; ASAR integrity and ASAR-only on (`build/fuses.mjs` `readWire`) |
| ASAR integrity | `Info.plist` hash `23475a12063d…` = SHA-256 of the asar header |
| Quarantine key | `LSFileQuarantineEnabled = true` |
| Signature | deep-strict verify OK; `Signature=adhoc`, `flags=(adhoc,runtime)` |
| Gatekeeper | `rejected` for both (expected for ad-hoc); control Calculator `accepted` in the same run |
| Test / map files in the asar | **0** of 1,074 |
| Release gates | `FS_BLOCKS_RELEASE`, `WEBCAM_RELEASE`, `SHARE_V3_RELEASE`, `SHARE_WAIT_RELEASE` all `false`; call banner packaged-off |
| New logo | `Contents/Resources/icon.icns` byte-identical to `build/icon.icns` at `8f8ecbb` (from `f71ffd1`, the outlined mask) |
| New strings | `hero-send` / *Send files* present, `hero-activity` absent, Recent row `min-height: 52px`, `wireOverviewSend`, *Sidekick was closed on this Mac* (defect 220) — 5 of 5 |
| Bundle | `com.chetan.sidekick.desktop`, `2.0.0` |

**x64 note (known, D12 in `docs/phase-9-distribution-audit.md`):** the ad-hoc hook logged `21/22 … — 1 FAILED:
Electron Framework` for the Intel build and continued, because its gate is the bundle's deep verify, which
passes. The Intel framework carries the signature it arrived with. **The Intel app has never run on an Intel Mac.**

## 3. Android — static checks

| Check | Result |
|---|---|
| Package / version | `com.chetan.connectsuite`, `versionCode 1`, `versionName 2.0.0`, target/compile SDK 36 |
| Debuggable | not set (control: the debug APK's badging shows the flag) — Camera v1 is off |
| Signer | `apksigner verify` → **DOES NOT VERIFY** (unsigned, as intended) |
| Components | 20. Exported: `MainActivity`, `SendSelectionActivity`, `ShareToMacActivity`, `ShareManyToMacActivity`; `SmsMirrorReceiver` (behind `BROADCAST_SMS`) and `ProfileInstallReceiver` (behind `DUMP`). Everything else not exported |
| Foreground-service types | `LinkService`, `ConnectionService` `0x10` connectedDevice; `MirrorService` `0x20` mediaProjection. **No `dataSync`** (0 in the manifest) |
| Debug components | 0 named *probe* or *debug* |
| Google / telemetry | `com/google/mlkit`, `com/google/android/gms`, `com/google/firebase`, `datatransport`: **0** in the dex; control `MainActivity` 1 |
| Permissions | the same 31 entries as `docs/privacy-policy-draft-2026-10-09.md` §3 |
| New logo | `mipmap/ic_launcher_mask`, all five densities, **pixel-identical** to the source PNGs (resolved through the resource table — release renames and recompresses, so a byte comparison reads 0 and is the wrong instrument) |
| New strings | *Scan pairing code*, *Paired Macs*, *Connect your Mac*, *Scan the code* in the dex |

## 4. The Send files hardware check (Mac → phone) — **not yet done**

The owner reported sending the 4 KiB and 100 MiB synthetic files from the new button. **Two independent logs
show they were not sent:** from 23:00 to 23:31 the Mac's log and the phone's log (including its rotated file)
record exactly one push to the phone — `-a4SbfD_SeSbHeFk.mp4`, 7,656,651 bytes, 23:22:08, into Received files,
`verified=true` — and neither `.bin` is in `Download/ConnectSuite` (control: that folder listed two `.mp4`). The
synthetic sources are kept until the check runs:

| File | Bytes | SHA-256 |
|---|---|---|
| `~/Desktop/sidekick-send-test-2026-10-11/send-small-2026-10-11.bin` | 4,096 | `dbfe7be853d0eb741e209b4d4e0307bf8bcbc5cb8a3422b3c37581d2a1e30748` |
| `~/Desktop/sidekick-send-test-2026-10-11/send-100mb-2026-10-11.bin` | 104,857,600 | `a852b0f4e75e5fab5139cc43edc0b064eb485e0c633530a6ca171037c3508139` |

The mp4 push itself is a valid reading of the send path (same function either way), but nothing records
whether it came from the Overview button or from Files.

## 5. Tester guide — statements the owner still has to confirm

`docs/beta-tester-guide.md`, in order of appearance. None of these can be read on the development app.

1. The `.dmg` opens and the drag to Applications works (no `.dmg` from this candidate has been mounted).
2. On a fresh download, macOS shows *could not verify* with only **Done** / **Move to Bin**.
3. **Privacy & Security → Open Anyway**, password, and that the second dialog's button is **Open Anyway** (the
   previous guide said *Open*; neither has been read on this macOS version for this app).
4. Whether the **local network** prompt appears at all on first launch, and its wording.
5. The packaged app shows **Scan this with your phone** on a Mac with no pairing.
6. The Android install path: *install unknown apps* switch, and what Play Protect shows for this signed APK.
7. The pairing path **Get started → Continue → Connect your Mac → Scan the code** on a fresh install of the
   **signed release** APK (verified in source and dex only; R8 is on for release).
8. **Paired with** *Mac name* on the phone and **Connected** on the Mac after the scan.
9. Send files and Start mirroring behave on the packaged app as on the development app.
10. The battery figure (0.4 %/hour) — one phone, one reading (defect 205).
11. Removing it: the Keychain item name *Sidekick Safe Storage* and the folder `sidekick-desktop` for the packaged
    app (measured 2026-10-08 on an earlier build).
12. Mac logs at `~/Library/Application Support/sidekick-desktop/logs/` for the packaged app; and **how a tester
    gets phone logs off a release build** — there is no in-app export and `run-as` does not work on release.
13. What the phone does when a tester shares **several files at once** in release (`SHARE_V3_RELEASE` is
    `false`) — not stated in the guide until read.

## 6. Privacy policy and Data safety drafts — statements the owner still has to confirm

`docs/privacy-policy-draft-2026-10-09.md`.

1. Every `[[PLACEHOLDER]]`: publisher legal name, postal address, support email, effective date, where the
   policy is hosted, how changes are announced, where the permission list is published.
2. **Decision:** may the phone's diagnostic logs move in an Android 12+ device-to-device transfer (today: not
   excluded), or should the `files` domain be excluded?
3. **Decision:** rewrite Activity history written before `219cb76` that may hold a clipboard link's host
   (irreversible), or state it.
4. *"Not directed at children under 13"* — a statement of intent only the publisher can make.
5. The Tailscale sentence (now worded as an option): manual-address connection over Tailscale has never been
   measured.
6. Data safety *"collects: No"* — whether Play's current form counts device-to-device transfers as not
   collected. Play is out of scope for this beta.
7. SMS / call-log permissions under Play policy — not assessed; Play only.
8. Android licences: 152 of 153 artifacts' licences are assumed (Apache-2.0) and not read from the artifacts;
   approve a POM fetch or a licence plugin, or ship as stated. Neither app has a notices screen.
9. The battery cost sentence in §3 — one reading on one phone.

## 7. What these checks do not prove

- **Neither artifact has run.** The packaged Mac app is not launched on the owner's account (defect 207); the
  APK cannot be installed until signed. The fresh-user plan (`docs/beta-hardware-plan-2026-10-09.md` §B) is how.
- R8 is on for release and off for the debug build on the phone.
- One SM-S938B and one Mac, as everywhere in this project.
