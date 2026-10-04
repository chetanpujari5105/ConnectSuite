# Camera v2 — signing and activation readiness (checklist)

**2026-10-04. Read-only.** Nothing was installed, enrolled, purchased, signed, activated, uploaded or
changed to write this. No keychain, Apple ID or account was read: where a fact needs one, it says
**unknown** and names the read the owner can run. SIP stays enabled; system-extension developer mode is
not used (proposal §3.5).

**Local activation and public distribution are two separate approvals** (§6). They need different
certificates, and only distribution needs notarization.

## 1. Toolchain — measured on this Mac

| | Reading | Needed |
|---|---|---|
| macOS | 26.6.1 (25G76), Apple silicon | — |
| Active developer directory | `/Library/Developer/CommandLineTools` (`xcode-select -p`) | full Xcode |
| Xcode | **not installed** — no `/Applications/Xcode*.app`; `xcodebuild` refuses: *"requires Xcode, but active developer directory … is a command line tools instance"* | **full Xcode** (B2): provisioning profiles, the Camera Extension target, the capability editor, `notarytool` for distribution |
| Swift | 6.3.2 (CLT), target arm64-apple-macosx26.0 — builds and tests the package today | unchanged |
| SIP | `csrutil status` → **enabled** | stays enabled |
| System extensions | `systemextensionsctl list` → **0 extension(s)** | — |
| Electron packaging | `electron-builder` with `identity: null`, `notarize: false`, `afterPack: build/adhoc-sign.mjs` (ad-hoc) | a real identity, inside-out signing |

## 2. Apple account — known versus unknown

| | Status |
|---|---|
| Apple Developer Program membership (B1) | **Unknown to this repo, and treated as absent.** Every document records it as not done; nothing in the tree carries a Team ID. Only the owner can say |
| Team ID | **Missing.** `SidekickCameraIdentity.teamID = nil` (`Sources/WebcamCore/Identity.swift`), so the extension's producer requirement names nobody and **every producer is refused** (fails closed) |
| Signing identities in the keychain | **Unknown — not read.** The owner can check with `! security find-identity -v -p codesigning`. Needed: an **Apple Development** identity (local test), later a **Developer ID Application** identity (distribution) |
| Provisioning profiles | **None exist** (they need B1 and B3) |
| This Mac registered as a development device | **Unknown** — needed for Apple Development profiles (portal → Devices, or Xcode's automatic signing does it) |

## 3. Identifiers and entitlements (from the code; B4 confirms them, they are permanent once shipped)

| Component | Identifier | Entitlements | Signed with |
|---|---|---|---|
| Sidekick.app (Electron) | `com.chetan.sidekick.desktop` (`electron-builder.yml` `appId`, `Identity.appBundleID`) | today's hardened-runtime set (`build/entitlements.mac.plist`: JIT, unsigned-exec-memory, dyld-env, network.client, user-selected and downloads read-write) **minus** `cs.disable-library-validation` (ad-hoc only — delete with real signing) **plus** `com.apple.developer.system-extension.install` and `com.apple.security.application-groups = [<TEAMID>.com.chetan.sidekick.camera]` | profile embedded (restricted entitlement) |
| Camera Extension | `com.chetan.sidekick.desktop.camera` (`Identity.extensionBundleID`); `CMIOExtensionMachServiceName = <TEAMID>.com.chetan.sidekick.camera` | `com.apple.security.app-sandbox`, `com.apple.security.application-groups` (same group). **No network, no file, no camera** | its own profile |
| Bridge | identifier `com.chetan.sidekick.desktop.camera-bridge` (`Identity.bridgeIdentifier`), in `Contents/MacOS/sidekick-camera-bridge` | hardened runtime, none (camera only if Q2 shows the sink needs camera TCC) | same team |
| Decode probe | `sidekick-camera-decode-probe` | — | **never signed, never packaged** — development tool for the encoder spike |
| Device | name "Sidekick Camera", manufacturer "Sidekick"; device `6F1F3C9E-…`, source stream `0B8E4A71-…`, sink stream `A4D2971C-…` | — | — |

**The producer requirement accepts both certificate kinds.** `ProducerAuthorizer.requirement` is
`anchor apple generic and identifier "com.chetan.sidekick.desktop.camera-bridge" and certificate
leaf[subject.OU] = "<TEAMID>"`. An Apple Development and a Developer ID certificate of the same team both
satisfy it, so the local test needs **no code change** beyond the Team ID line. (Read from source, not
yet measured against a real certificate.)

## 4. Packaging and activation steps, in order

1. Team ID into `SidekickCameraIdentity.teamID` (one line); the requirement then names it.
2. An Xcode Camera Extension target compiling `Sources/WebcamExtension` + `Sources/sidekick-camera-extension`,
   with the bundle id, Mach service name and entitlements of §3.
3. Package with electron-builder: extension in `Contents/Library/SystemExtensions/`, bridge in
   `Contents/MacOS/`, profiles embedded; delete `disable-library-validation`; replace
   `build/adhoc-sign.mjs` with inside-out signing (extension, bridge, Electron frameworks, app).
4. The activation call — `OSSystemExtensionRequest.activationRequest` from the process whose bundle
   contains the extension (recommended: a small Node-API addon in Electron main; proposal Q1) — and a
   Settings → Camera install / uninstall button that names every delegate outcome. **Not built.**
5. Copy the signed app to **`/Applications`** (activation from anywhere else is refused —
   `unsupportedParentBundleLocation`, the planned control reading).
6. Press Install; **the admin approves** in System Settings → General → Login Items & Extensions →
   Camera Extensions.
7. `systemextensionsctl list` (read-only) shows it `[activated enabled]`; Photo Booth lists "Sidekick
   Camera" showing the camera-off card.

## 5. Who has to approve what

| Step | Needs |
|---|---|
| Enrol in the Apple Developer Program (B1) | the owner, the owner's Apple ID, payment ($99/yr) |
| Install Xcode (B2) | the owner's approval; an admin password for the install |
| Portal: App IDs, app group, register this Mac, development profiles (B3) | the owner's account |
| Confirm the permanent identifiers (B4) | the owner's decision |
| Create / import signing certificates | the owner (keychain; Xcode can do it under the owner's account) |
| Copy to `/Applications` | admin (or the owner's user, depending on folder permissions) |
| Activation | the owner presses Install; **an administrator approves in System Settings** |
| Uninstall / deactivation | the owner; admin approval again |
| Notarization (B6) | the owner's credentials; **an upload of the whole binary to Apple** |

## 6. Is notarization needed?

| | Local activation on this Mac | Later public distribution |
|---|---|---|
| Certificate | **Apple Development** + development profiles (this Mac registered) | **Developer ID Application** + Developer ID profiles (app *and* extension) |
| Notarization | **Not required** for Apple Development–signed extensions | **Required.** A Developer ID–signed system extension does not load until notarized, even on the Mac that built it — measured by others and stated by Apple DTS (sources below). Not yet measured here |
| Upload to Apple | none | yes — the binary, via `notarytool` |
| Gatekeeper | locally built, no quarantine attribute | stapled ticket, for downloads |

So the approvals separate cleanly:

- **Approval L (local activation):** B1, B2, B3 with **development** profiles, B4, a development-signed
  build in `/Applications`, activation, admin approval. **No notarization, no upload.** Note that this
  changes the plan in `desktop/native/SidekickCamera/README.md` (*Blocked*, steps 6–8), which assumes
  Developer ID throughout; following it literally would make the local test depend on notarization.
- **Approval D (distribution, later):** Developer ID certificates and profiles, notarization (B6),
  stapling, release flags flipped in a commit with evidence. Separately approved; not part of L.

Sources: Apple DTS on the Developer Forums — [Camera Extension installation error (Invalid Signature),
thread 710046](https://developer.apple.com/forums/thread/710046) (*"System extensions signed with
Developer ID must be notarised before they'll load … better to use Apple Development for day-to-day
development"*); [thread 736838](https://developer.apple.com/forums/thread/736838) (missing
entitlements / profiles). Apple — [Creating a camera extension with Core Media
I/O](https://developer.apple.com/documentation/coremediaio/creating-a-camera-extension-with-core-media-i-o).

## 7. Not done, and not to be done without its own approval

Enrol, purchase, install Xcode, create certificates or profiles, register the Mac, sign, notarize,
upload, copy to `/Applications`, activate, approve in System Settings, enable developer mode, change
SIP or any security setting, flip `WEBCAM_RELEASE` on either side.
