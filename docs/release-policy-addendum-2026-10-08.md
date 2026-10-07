# Policy and distribution — addendum to the 2026-10-07 draft (2026-10-08, DRAFT)

Read with `docs/privacy-and-distribution-2026-10-07.md` (the full package: data flows, permissions, Data safety
answers, permission-declaration checklist, channels). This addendum records what changed since, gives a
**privacy-policy skeleton that matches today's code**, and leaves every publisher field blank. Nothing here is
published, submitted or sent anywhere.

## 1. Corrections since 2026-10-07

| Draft statement | Today | Source |
|---|---|---|
| Logs hold *"lengths, counts and states — no message, clipboard or file content"* | Both apps log **file names** of transferred files; the Mac's Activity history keeps file names. No file *content*, message text or clipboard text | PC-only audit F2; `main.ts`, `bulk.ts`, `DownloadsStore.kt`, `BulkTransfers.kt` |
| Activity keeps an opened clipboard link's host | **No longer** for new events (`219cb76`); history written before that build may still hold hosts, and is not rewritten without the owner's decision | `docs/testing.md` → Phase 1 2026-10-08 |
| *"Nothing leaves your network"* (phone, Link your Mac) | False while ML Kit ships: its terms say it sends Google usage metrics; `datatransport` (CCT backend) is on the release classpath (structural, re-verified 2026-10-08). Options A/B with exact wording: `docs/release-verification-2026-10-08.md` §5 | ML Kit terms; Gradle dependency graph |

## 2. Privacy policy — skeleton (fill the bracketed fields; every sentence maps to a measured behaviour)

> **Sidekick privacy policy** · Effective `[DATE]` · Publisher `[LEGAL NAME]`, `[ADDRESS]` · Contact `[EMAIL]`
>
> **What Sidekick is.** Two apps — one on your Android phone, one on your Mac — that connect directly to each other on
> your own network. There is no Sidekick account and no Sidekick server.
>
> **What moves, and where.** Notifications, messages, call events, contacts you look up, clipboard text, files and
> photos you choose, and your phone's screen when you start mirroring move **only between your phone and your Mac**,
> over an encrypted connection (TLS 1.3) whose keys are pinned when you pair the two. Nothing is sent to us.
>
> **What is stored.** On the Mac: files you copy to it (in the folder you chose), an Activity history (event types,
> times, file names, and call events with the contact's name but never the number), diagnostic logs (connection states, counts, file names — no message,
> clipboard or file content), and the pairing record. On the phone: files sent to it (in `Download/ConnectSuite`, or
> Sidekick's private storage), diagnostic logs of the same kind, and the pairing record. Clipboard history is kept in
> memory only and cleared when the connection drops. Uninstalling the phone app removes its private data; on the Mac,
> deleting the app leaves its data in `~/Library/Application Support/[folder]` until you remove it `[state the exact
> folder and, ideally, offer a Remove all data button]`. Files you copied stay where you put them.
>
> **Third parties.** `[Option A: The phone's QR scanner uses Google ML Kit, which sends Google anonymous usage
> statistics about the scanner (not the camera image and not the code it reads). Google's terms: https://developers.google.com/ml-kit/terms]`
> `[Option B: none — the QR scanner runs entirely on the phone.]`
>
> **Permissions.** Each Android permission is asked for when you turn on the feature that needs it, and the feature
> says what it is for. `[link to the in-app list]`
>
> **Children.** Sidekick is not directed at children. **Changes.** `[how changes are announced]`. **Contact.** `[EMAIL]`

## 3. Google Play — only if Play is chosen

Use the 2026-10-07 draft §5.3 (Data safety) and §5.4 (permission declarations) unchanged, with two edits: Data safety's
*"Data collected"* is **No** only under Option B; and Play's SMS and Call Log permission policy is the gating question
for the SMS and call features — whether any permitted-use exception covers them must be checked against Play's current
policy text before a Play build is planned (not assessed here).

## 4. Direct distribution — the options as they stand

| | Mac | Android |
|---|---|---|
| **Recommended** | Developer ID Application certificate + notarization + stapling (Apple Developer Program, paid; Account Holder creates the certificate). Hardened runtime, fuses and the debugging-switch guard are already in the build | APK signed with the release keystore (`-Pconnectsuite.signRelease=true`, owner only) from the project's site; Android developer verification registration before its enforcement date `[confirm the current date on Google's page]` |
| Possible, not recommended | ad-hoc/unsigned `.dmg` — Gatekeeper refuses on double-click; users must override. Acceptable for a private beta only | Play — see §3 |
| Opened by Option B | — | **F-Droid** becomes possible only without proprietary dependencies (ML Kit and Play services are disqualifying today) |

## 5. Third-party licences

**Mac (packaged `app.asar` from `81ff971`, read 2026-10-08):** 60 package entries (name@version, nested copies
included): MIT 47, ISC 9, BSD-3-Clause 1 (`fast-uri`), BSD-2-Clause 1 (`json-schema-typed`), BSD-3-Clause OR GPL-2.0 1
(`node-forge` — BSD-3-Clause elected), MIT OR CC0-1.0 1 (`type-fest`); plus Electron 43.4.1 (MIT) with Chromium's and
Node's notices inside the framework. **Phone:** unchanged from the 2026-10-07 draft §4 — per-artifact licences are
still **not readable offline** (the Gradle cache holds no POMs). **Neither app has a notices screen yet** — required
before release (owner to approve the generator or plugin).

## 6. Decisions only the owner can make

1. Publisher legal name, address, contact email, effective date.
2. ML Kit: Option A (disclose, strings only) or Option B (replace the scanner; new dependency; recommended).
3. Channel: direct (recommended) and/or Play.
4. Apple Developer Program enrolment; release keystore use (signing is the owner's act).
5. A dependency-advisory audit and its tool (OSV offline recommended; it downloads the public database once).
6. A notices screen in both apps and its generator.
7. Whether existing Activity history that may hold clipboard link hosts is rewritten (irreversible) or left.
