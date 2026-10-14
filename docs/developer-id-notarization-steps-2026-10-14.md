# Developer ID and notarization — the owner's steps (App-5, 2026-10-14)

> **Preparation only. Nothing was bought, enrolled, signed, notarized or uploaded to write this, and no setting in
> `desktop/electron-builder.yml` was changed.** Every step below is **yours** to take.
>
> **Labels:** **[V]** verified in this repository (file or dated measurement named) · **[U]** unverified — Apple's
> or electron-builder's current behaviour, not checked tonight; confirm on Apple's page or by the build output
> before relying on it · **[A]** assumed.

## 0. Why this is needed (what the missing Developer ID costs today) [V]

`docs/phase-9-distribution-audit.md` names four costs, each measured: Gatekeeper answers **rejected** for the
ad-hoc build (D12 — a stranger must use *Open Anyway*); library validation had to be switched off (D14, defect
184's open half); macOS notifications cannot register (defect 81 — and the packaged build has never run, so this is
unproven either way); and every rebuild of an ad-hoc app is a new identity to the Keychain, so it **prompts at
launch, ahead of the window** (D15, measured 2026-09-04). The webcam extension also needs a Team ID
(`docs/camera-v2-signing-readiness.md` §2).

## 1. What to enrol in and buy

| # | Step | Notes |
|---|---|---|
| 1 | **Apple Developer Program**, at developer.apple.com/programs | Paid yearly **[U — price on Apple's page]**. **Individual** enrolment shows your personal legal name as the seller/developer on Gatekeeper's dialog and certificates **[U]**; **Organisation** needs a legal entity and a D-U-N-S number **[U]**. Decide this first — the name is on every signed build and cannot be changed on the certificate later |
| 2 | Wait for approval | can take days **[U]** |
| 3 | **Install full Xcode** from the App Store | Not installed today **[V, `camera-v2-signing-readiness.md` §1]**. Needed for certificates through Xcode, the Camera Extension, and the newest `notarytool` **[U whether the Command Line Tools' `notarytool` suffices for the Electron app alone]** |
| 4 | **Create a *Developer ID Application* certificate** | Xcode → Settings → Accounts → your team → Manage Certificates → **+** → *Developer ID Application*. Only the **Account Holder** can create Developer ID certificates **[U]**. It lands in your login Keychain with its private key |
| 5 | **Back up the certificate + key** | Keychain Access → My Certificates → right-click → Export as `.p12` with a strong password; store offline beside the Sidekick trial-key backup. Losing it means a new certificate; leaking it means anyone can sign as you until you revoke it |
| 6 | **Notary credentials** — choose one | (a) an **App Store Connect API key** (Users and Access → Integrations → Keys; a `.p8` file, a Key ID and an Issuer ID) — recommended, no Apple ID password involved **[A]**; or (b) an **app-specific password** from account.apple.com plus your Apple ID and Team ID |
| 7 | Store them once, outside the repo | `xcrun notarytool store-credentials sidekick-notary --key <path.p8> --key-id <ID> --issuer <ISSUER>` puts them in your Keychain under a profile name **[U for electron-builder reading a keychain profile; the environment variables in step 8 are the documented route]** |

Nothing else needs buying. The Android side is separate (App-1's signing walkthrough).

## 2. What to change in the build — when you are ready (do not do this before step 1.4 exists)

These are proposals; **each is a commit you approve**. None is made tonight.

| # | File | Change | Why |
|---|---|---|---|
| C1 | `desktop/electron-builder.yml` | `identity: "Developer ID Application: <NAME> (<TEAMID>)"` in place of `identity: null` | the header of that file already names this as step 1 **[V]** |
| C2 | same | `notarize: true` (or `{ teamId: <TEAMID> }`), credentials **only** in the environment: `APPLE_API_KEY` (path to `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | the file names the second set **[V]**; the API-key names are **[U]** for electron-builder 25.1.8 — confirm in its docs before the first run |
| C3 | `desktop/build/adhoc-sign.mjs` | **keep the fuses, stop the ad-hoc signing when a real identity is configured.** Today it always signs with `-` **[V]**. If electron-builder then signs with Developer ID afterwards it will re-sign everything, which is fine — but the hook's own deep-verify must not run against a half-signed bundle. Simplest: split the hook so `afterPack` only applies fuses (they must be written **before** any signature — the hook's comment says so **[V]**), and ad-hoc signing runs only when `identity` is null | electron-builder runs `afterPack` **before** its own signing step **[U — confirm in the build log: "applying fuses" then "signing"]** |
| C4 | `desktop/build/entitlements.mac.plist` | **delete `com.apple.security.cs.disable-library-validation`** (the file says *"delete it when signing for real"* **[V]**); review whether `allow-dyld-environment-variables` is needed at all (defect 184 calls it the signing-dependent open half **[V]**) | a notarized hardened-runtime app should not keep exceptions it does not need |
| C5 | same file | keep `allow-jit` and `allow-unsigned-executable-memory` | Electron needs them **[U — re-check against current Electron guidance]** |
| C6 | x64 target | either fix the known framework-sign failure (D12 line in every RC record **[V]**) or **drop x64** from the target list until an Intel Mac is available to run it (audit G12) | the Intel app has never run **[V]** |
| C7 | Camera Extension (later) | Team ID into `SidekickCameraIdentity.teamID`, provisioning profiles, extension signing | out of scope for the first signed build; `camera-v2-signing-readiness.md` §4 |

## 3. How to verify afterwards (each is read-only)

Run on the built `release/mac-arm64/Sidekick.app` and the `.dmg`. **Expected values are [U] until the first run.**

```sh
codesign --verify --deep --strict --verbose=2 Sidekick.app          # → valid on disk, satisfies its Designated Requirement
codesign -dv --verbose=4 Sidekick.app 2>&1 | grep -E 'Authority|TeamIdentifier|flags|Timestamp'
#   Authority=Developer ID Application: <NAME> (<TEAMID>) ; flags=0x10000(runtime) ; a secure Timestamp line
codesign -d --entitlements :- Sidekick.app                         # disable-library-validation absent (C4)
spctl -a -vvv -t exec Sidekick.app                                  # → accepted, source=Notarized Developer ID
xcrun stapler validate Sidekick.app                                 # → The validate action worked!
spctl -a -vvv -t open --context context:primary-signature Sidekick-<ver>-arm64.dmg
npx --yes @electron/fuses read --app Sidekick.app                   # same fuse wire as RC bcb92ec: 000011011 [V]
```

Then repeat **every** static check from `docs/release-candidate-2026-10-14b.md` (ASAR integrity, quarantine key,
release gates false, no test/map files, the trial public key, **0 private-key hits**).

**The real test is on a fresh macOS user, not this account** (defect 207 — never launch a packaged Sidekick on the
owner's account): download the `.dmg` **through a browser** so it is quarantined, open it, drag to Applications,
double-click. Expected **[U]**: one standard *"downloaded from the internet"* dialog naming you, no *Open Anyway*
detour, no *damaged* message.

## 4. Gatekeeper — verified versus unverified

| Claim | Status |
|---|---|
| An un-bundle-signed build gets an **error**, not a verdict (no override) | **[V]** D12, 2026-09-03 |
| The ad-hoc build (today's `afterPack`) gets **rejected**, overridable from Privacy & Security → *Open Anyway* | **[V]** D12, measured on a copy; RC `bcb92ec` records `rejected` **[V]** |
| A Developer ID–signed, notarized, stapled build is **accepted** on first open | **[U]** — never built |
| Notarization passes with the current entitlements and Electron 43 | **[U]** |
| The x64 build signs | **[V] no** — the D12 framework-sign line appears in every RC |

## 5. The Keychain prompt — verified versus unverified

`identity.ts` keeps this Mac's TLS private key sealed with `safeStorage`, which is the login Keychain item
`… Safe Storage`, guarded by an access list tied to the app's **code signature** **[V, D15]**.

| Claim | Status |
|---|---|
| A **rebuilt ad-hoc** app is a new identity to the Keychain and prompts **at launch, before the window** (*Always Allow / Deny / Allow*) | **[V]** D15, 2026-09-04 (under the old name) |
| A **fresh** install (no item yet) creates the item and is on its own access list, so it does **not** prompt | **[A]** — reasoned in D15, never observed; the app's note therefore says *"macOS may ask"* **[V, `4b4632e`]** |
| Successive **Developer ID** builds keep a stable designated requirement, so an update does **not** prompt | **[A]** — the standard Keychain behaviour; unmeasured here |
| A beta tester moving **from an ad-hoc build to the first Developer ID build** | **[U], and it is the one to plan for:** the existing item's access list names the ad-hoc code, so macOS will ask **or** refuse. If the key cannot be read, Sidekick now **writes nothing** and shows *"Sidekick can't use this Mac's saved key"* with **Quit / Show the Key's Folder / Start Over** (`identityStore.ts` `blockedPrompt` **[V]**; seen in an isolated profile 2026-10-14 **[V]**). *Start Over* means a new key and **re-pairing the phone** — tell testers this in the release note |
| Whether macOS asks on the very first launch on a fresh user | **[U]** — the fresh-user test (owner's to-do since RC `3bc1aa5`) |

## 6. Order of work, end to end

1. Decide individual vs organisation → enrol → wait.
2. Install Xcode → create the Developer ID Application certificate → back it up.
3. Create the notary API key → store it.
4. Approve C1–C4 (and C6's choice) as a commit; build; run §3.
5. Fresh macOS user: install from a browser download, launch, pair a phone, record every dialog.
6. Write the release note's *moving from the beta build* paragraph from what step 5 showed.
