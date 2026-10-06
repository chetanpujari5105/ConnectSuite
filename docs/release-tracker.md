# Sidekick v1 — release tracker (canonical)

> **This is the one place v1 readiness is tracked.** Opened 2026-10-06. It supersedes the matrix in
> `docs/release-readiness-2026-10-06.md` as a working document (that file stays as the overnight
> snapshot) and folds in `docs/release-audit-2026-10-06.md`. **Sidekick is not ready to ship.** Passing
> tests and release-enabled flags are not readiness: nothing below is *release-verified*, because no
> signed build of either app exists to verify. **No dates and no completion percentages are given** —
> there is no agreed unit of work, and any date would be invented.
>
> Update rule: a cell changes only with the evidence that changed it, named in the same edit.

## Blocking public release — every Critical and High finding, and every unknown that could be one

| ID | Severity | Finding | State | Phase |
|---|---|---|---|---|
| RB1 | Critical | No signed build: the Mac `.dmg` is ad-hoc signed; the release APK has no signing config | open — needs Apple Developer Program + release keystore (owner) | 4 |
| S1 / 182 | High | Pairing does not authenticate the phone to the Mac | **fixed in source** 2026-10-06 (`docs/protocol.md` → Pairing (version 2)); **not installed, not hardware-verified**; every existing pairing is legacy and must be re-paired | 2 → 5 |
| S2 / 178 | High | Mac bulk and mirror-video sockets did not pin the phone | **fixed in source** 2026-10-06; **not installed, not hardware-verified** | 1 → 5 |
| P3 / 188 | High (claims) | "Nothing leaves your network" while ML Kit sends usage metrics to Google | open — unmeasured; capture F9, then decide | 4 |
| RB5 | High (policy) | No privacy policy, publisher identity or contact anywhere | open — owner supplies; not invented here | 4 |
| RB6 | High | Five privacy fixes and every Phase 1 fix exist in source only | open — plan F | 5 |
| U-1 | **Unknown** | Whether any existing pairing was made with an impostor (v1 pairing could not tell) | **unknown, and will stay so** — legacy records are labelled, never upgraded; release verification requires a v2 re-pair (`docs/pairing-v2-hardware-test-proposal.md` H4) | 5 |
| U-2 | **Unknown** | Dependency advisories (no `npm audit` / OSV run — it would send the dependency list off this machine) | **unknown** — §Dependency audit below | 2 |
| U-3 | **Unknown** | Behaviour on any phone but the SM-S938B (and the Moto for some rows) | **unknown** — `docs/single-device-audit.md` | 6 |
| U-4 | **Unknown** | Whether `share`/`fs.blocks`/camera/webcam code is safe to enable — never reviewed as release code | **unknown** — gates stay off | 3 |

Mediums (S3 and S4 fixed in source; S5, S7 open; U1 fixed in source) and Lows are tracked in the phases
below; they are not public-release blockers on their own, but S5 must land before a signed build.

## Reconciling 14/22 and 16/22

Both numbers in `docs/release-readiness-2026-10-06.md` are right; they answer different questions.

| Question | Count | Rows | Denominator |
|---|---|---|---|
| Enabled in release code (a release build from this tree would offer it) | **16** | 1–7, 10–13, 15–18, 22 | 22 matrix rows |
| …and with no known gap a user would hit | **14** | the 16 minus 6 (defect 30) and 13 (defect 137) | 22 |
| Gated off in release code | 4 | 9, 14, 19, 20 | 22 |
| Deferred (not built for release) | 1 | 21 | 22 |
| Platform wall, never claimed | 1 | 8 | 22 |
| Release-verified (signed build, on hardware) | **0** | — | 22 |
| Publicly shipped | **0** | — | 22 |

The overnight file called the 14 "shipped". It was not shipped in any public sense; the column below
says *enabled* and keeps *shipped* for something a stranger can install.

## The features

Columns: **Impl** implemented · **Tested** automated tests exist and pass on the current tree ·
**HW** hardware evidence exists (date; ⚠ = predates code changed since) · **Release** verified on a
signed release build — no row has this.

| # | Feature and exact scope | Gate in release code | Impl | Tested | HW | Release | Remaining defects and dependencies | v1 | Acceptance criteria and evidence required |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Pairing** — one QR scan on the phone; TLS 1.3; fingerprints pinned both ways; **v2: both sides prove the QR secret** | on | yes (v2, 2026-10-06) | yes — 15 loopback-TLS integration + 17 JVM + shared vectors | v1 only (2026-08-25, 2026-09-03); **v2 never run** | no | 182/189 fixed in source; legacy records; bundle-id change forces re-pair | **include once H1–H6 pass** | `docs/pairing-v2-hardware-test-proposal.md` H4–H6 (and H7 when its stand-in exists); release notes say every earlier pairing must be redone |
| 2 | **Reconnect & discovery** — last address → gateway → mDNS → manual; after sleep, boot, update | on | yes | yes | Phase 6, 2026-09-03 | no | Defect 17 (one phone); other OEMs unknown | include, "one phone, tested on Samsung" stated | Boot, Doze and update return on the release build; a second handset |
| 3 | **Notifications** — mirror, reply, actions, dismiss | on | yes | yes | Phase 4, 2026-08-31 ⚠ | no | **179** fixed in source; privacy fixes not installed | include | F4/F5: install, then the log grep with its control |
| 4 | **Mac native notifications** | on | yes | yes | 2026-09-04 | no | — | include | Banner on the release build with a fresh notification-permission prompt |
| 5 | **SMS/MMS threads** — read, reply | on | yes | yes | step 71, 2026-08-31 ⚠ | no | Play eligibility (P1) only matters for Play | include (direct) | F5 log grep; one reply on the release build |
| 6 | **New SMS conversation** — send to a number with no thread | on | Mac half | fakes only | explicit-address only | no | **Defect 30** | **conditional** — ship as "reply" unless F8 passes | F8: one consenting send, absence proven in both providers first |
| 7 | **Calls** — events, dial, answer, reject, log | on | yes | yes | step 70, 2026-08-31 ⚠ | no | `559f1da` not installed | include | F5; a refused call log shows its reason (F6) |
| 8 | **Call audio on the Mac** | n/a | — | the one sentence | SCO fails both ways, 2026-09-14 | — | a platform wall | **never claim** | — |
| 9 | **Incoming-call banner** | **off** when packaged | yes | 22 + gate | none | no | needs one supervised ring | deferred | — |
| 10 | **Contacts** | on | yes | yes | Phase 4 | no | — | include | Lookup on the release build |
| 11 | **Media remote** | on | yes | yes | step 67, 2026-08-28 | no | Defect 38 (phone-side volume never reaches the Mac) | include, volume stated one-way | — |
| 12 | **Files Mac → phone** — `Download/ConnectSuite` and granted folders, resume | on | yes | yes (**pinned socket new**) | 2026-09-01 ⚠ | no | 178 fixed in source, needs F11 | include | F11: one push verified by the phone's digest after the pin change |
| 13 | **Files phone → Mac** — browse, pull, drag to Finder | on | yes | yes | 2026-09-01; **defect 137** since 2026-09-23 ⚠ | no | **Defect 137** (granted trees list 0); 186 (quarantine) | **conditional** — `Download/ConnectSuite` only until 137 is understood | F7: provider log read; F11 one pull |
| 14 | **Block-verified pulls > 64 MiB** (`fs.blocks`) | **off** (`FS_BLOCKS_RELEASE`) | yes | yes | development runs | no | release decision; until then **187**: large pulls unverified | deferred; say "unverified" | Decision recorded; UI states unverified |
| 15 | **Photos & video browser** | on | yes | yes | 2026-09-23 ⚠ | no | Play photo policy (P5) for Play only; depth unmeasured on hardware | include | F6: 20+ pages timed on the phone |
| 16 | **Clipboard + history** — Mac → phone automatic; phone → Mac while open; history | on | yes | yes | 2026-09-01/02 | no | **185** (any phone app can write the Mac clipboard); phone → Mac wall | include, wall stated; **S7 before release** | S7 red-first test; release notes state the wall |
| 17 | **Mirroring + control**, floating window | on | yes | yes (**pinned socket new**) | 2026-09-10 ⚠ | no | 178 needs F11; defect 100 reconciled (closed, not a code defect); needs background restriction lifted (102/103) | include | F11: 30 s of `Encoded +N frames` after the pin change |
| 18 | **Apps** — list, "ask to open" | on | yes | yes | 2026-09-03 | no | — | include, never "launch" | — |
| 19 | **Phone → Mac sharing** | packaged Mac: `share.file 1` only; phone multi-file off | yes | yes | development runs | no | release decision; code never reviewed as release code (U-4) | deferred | — |
| 20 | **Camera v1** | **off** unless phone build debuggable | yes | yes | 2026-10-02 (supervised) | no | most of `docs/camera-v1.md` unrun | deferred | — |
| 21 | **Phone as Mac webcam** | **off** (`WEBCAM_RELEASE`) | partial | Swift 140, Mac, phone | spike PASS 2026-10-05 | no | signing, Camera Extension, defect 177 | deferred; **never claim meeting-app compatibility** | — |
| 22 | **Activity, Settings, theme, login item** | on | yes | yes | 2026-09-16 | no | **181** fixed in source (synthetic only); window bounds not remembered; the pending irreversible Activity rewrite | include | F2 (rewrite counts), F3 (settings persist), F10 (layout in the real window) |

## The six phases

Each item: its acceptance criterion, and the evidence that would close it. Nothing moves to a later
phase silently.

### Phase 1 — immediate security fixes · **done in source 2026-10-06, nothing installed**

| Item | State | Evidence | Still needed |
|---|---|---|---|
| S2 — pin every Mac side channel (178) | fixed in source | `pinnedTls.test.ts`: 0 application bytes to a wrong peer on all four paths; mutations red | F11 on hardware |
| S6 — notification-tag log privacy (179) | fixed in source | the audit's attack is a test on both sides, red against FNV | F5 |
| S3 — navigation and window hardening (180) | fixed in source | `windowGuard.test.ts`, `dropGuard.test.ts`; isolated Electron with the real preload (`docs/evidence/release-audit-2026-10-06/s3-window-guard/`) | one real drag (F10) |
| U1/U2 — Settings layout, sidebar, notification rows (181) | fixed in source, synthetic | harness with a control-versus-text check: Settings 2→0 / 5→0, nav fits | F10 in the real window |
| Docs reconciliation | done | D4 closed by evidence (icon hash in the 2026-09-19 package); defect 100 closed with its 2026-09-10 reading; FNV claim corrected | — |

### Phase 2 — pairing and privilege boundaries · **S1, S2b and S4 done in source 2026-10-06; S7 proposed**

S1 + S2b: built to `docs/protocol.md` → *Pairing (version 2)*. Red first against HEAD's own
`LinkClient` (an impostor was pinned and received the token — `docs/evidence/pairing-v2-2026-10-06/`);
Mac 15 + 3 tests, phone 17, all through shared independent vectors; 9 of 10 mutations red (the tenth is
an equivalent guard, explained in the evidence). Hardware: `docs/pairing-v2-hardware-test-proposal.md`.
S4 (defect 183): every IPC handler behind a main-process guard — sender identity, main frame, exact page,
role, payload — with three narrowed preloads and events scoped per window (`docs/ipc-authorization.md`,
133 channels). Tests through the real `main.ts` registrations and an isolated Electron run with the real
preloads and pages; 9 mutations red. Phone pairing wording: *Code scanned. Verifying your Mac…* until the
phone verified the Mac, *Paired* only then (`ConnectStage.pairingOutcome`); 2 mutations red.
Still to come: S7 (`docs/phase-2-hardening-proposals.md` §S7, the next proposal); the dependency audit.
**Acceptance for S7:** a selection push leaves the Mac clipboard untouched until a person presses Copy.

### Phase 3 — functional completion

Defect 30 (F8), defect 137 (F7), the `fs.blocks` decision (row 14), S8/S9 (quarantine, "unverified"
labelling), window bounds persistence, the state vocabulary decision (84 states across 19 panes).
**Acceptance:** each defect closed on hardware or explicitly scoped out of v1 in the release notes.

### Phase 4 — privacy, policy and distribution

Signing (RB1), S5 with the Developer ID, P3 measured and resolved, privacy policy and publisher
details (RB5), the channel decision (direct vs Play; `docs/release-audit-2026-10-06.md` §C), Android
developer verification before its 2027 global date. **Acceptance:** a notarized `.dmg` that Gatekeeper
accepts on a clean Mac; a signed APK that installs; a published privacy policy whose every sentence
matches a measured behaviour.

### Phase 5 — UI/UX and hardware verification

Plan F (install, relaunch, privacy grep, refusal UI, Photos at depth, layout in the real window,
VoiceOver and keyboard traversal once). **Acceptance:** every "⚠" in the HW column above cleared with a
reading and its control in `docs/testing.md`.

### Phase 6 — release candidate and limited beta

A signed build of both apps from one commit; a second Android handset; a small beta of people who are
not the author, with release notes that state every wall and every deferral. **Acceptance:** no new
High in the beta; every claim in the release notes traceable to a row here.

## Dependency audit — proposal, not run

| Option | What leaves this machine | What it finds |
|---|---|---|
| `npm audit --omit=dev` in `desktop/` | the **names and versions** of every package in `package-lock.json` (≈ the dependency tree), sent to `registry.npmjs.org`; no source, no data | npm advisories for the Mac runtime dependencies |
| OSV-Scanner with an **offline** database (`osv-scanner --offline --download-offline-databases`) | **once**, a download of the public OSV database (the request reveals only that a download happened); then nothing — the lockfiles are matched locally | npm and Maven (Gradle lockfile / dependency list) advisories |
| Gradle `dependencyCheck` (OWASP) | downloads the NVD feed; matching local | Java/Kotlin advisories, noisy |
| Do nothing | nothing | nothing — U-2 stays **unknown** |

**Recommendation:** OSV-Scanner offline — the dependency list never leaves the machine. It is a new
tool to install, which this phase is not allowed to do; it needs your approval.

## Decisions needed from you

1. **SDK privacy (P3):** approve capture F9; then disclose ML Kit's metrics, or replace the scanner with
   an on-device decoder that has no network path.
2. **Publisher details (RB5):** legal name, contact address and support email for the privacy policy,
   the Developer ID and Android developer verification. Not invented here.
3. **Distribution:** direct for v1 (recommended in the audit), Play later or never.
4. **Pairing v2 hardware run:** `docs/pairing-v2-hardware-test-proposal.md`, step by step — it re-pairs your
   devices (H4).
5. **S7:** the three decisions at the end of `docs/phase-2-hardening-proposals.md` §S7.
6. **The dependency audit:** which option, if any.
7. **Plan F**, step by step — F2 runs the irreversible Activity rewrite.
