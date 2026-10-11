# Before sending Sidekick to 3–5 testers — the owner's checklist (2026-10-11)

In order. Each step says who acts, roughly how long it takes, and what it unblocks. Times are estimates, not
measurements. Steps marked **(me)** I can do once the step before them is done; everything else needs your
hands, your accounts or your decision.

| # | Step | Who | Time | Why it comes here |
|---|---|---|---|---|
| 1 | **Send the two synthetic files from Overview → Send files** (`~/Desktop/sidekick-send-test-2026-10-11/`), then I hash both ends, compare with a send from Files, and delete them by literal path | you (one press + picker), then me | 5 min + 10 min | closes this batch's hardware check (`docs/release-candidate-2026-10-11.md` §4) |
| 2 | ~~**Decide the trial for this beta**~~ **Done 2026-10-12: tokens (D), 45 days, Mac only, not bound to one Mac.** — none, or tokens (D). If tokens: 40 or 50 days, bind to one Mac or not (`docs/trial-licence-summary-2026-10-11.md`) | you | 15–30 min | if *tokens*, steps 3–4 wait for the build |
| 3 | ~~*(only if tokens)* Build option D~~ **Done 2026-10-12** (`c0071d4`…`83c4096`; defects 221–222 fixed on the way): issuer script, verifier, Settings row, read-only expiry — red-first tests | me | 2–3 days | must land before the candidate testers get |
| 4 | ~~*(only if tokens)* Create the signing key for tokens~~ **Created 2026-10-12**; public key in `trialKey.ts`, owner token entered and working. **Still yours: back the key folder up offline** (password manager or encrypted drive) | you | 15 min | key custody is yours |
| 5 | **Publisher details** for the policy: legal name, postal address, support email, effective date, how changes are announced | you | 20 min | the policy cannot be published with placeholders |
| 6 | **Host the privacy policy and permission list** as one static page (any host, no server of Sidekick's); give me the URL | you | 30 min | the guide and the policy point at it |
| 7 | **Two privacy decisions:** may phone logs move in a device-to-device transfer; rewrite pre-`219cb76` Activity history or state it | you | 10 min | either changes one line of code or one sentence |
| 8 | Fill the placeholders, apply the decisions, rebuild the candidate from the new HEAD and re-run every static check | me | 1 h | the build testers get must contain the final text and choices |
| 9 | **Create the Android release keystore** (`keytool -genkeypair …`, RSA 4096 or EC, 25+ years), write `~/.android-keystores/connectsuite.properties`, back the keystore up offline. **Losing it means testers must uninstall to update** | you | 20 min | nobody can install the unsigned APK |
| 10 | **Sign the APK**: `./gradlew :app:assembleRelease -Pconnectsuite.signRelease=true` from a clean checkout of the candidate's commit, then `apksigner verify --print-certs`; send me the certificate SHA-256 | you (I can prepare the exact commands) | 15 min | signing is your act, not mine |
| 11 | **Install the signed APK on your phone and run the pairing path** — Get started → Connect your Mac → Scan the code, one file each way, mirroring once. The release app is a different package from the debug build, so both can be installed. Both use the same ports, though, so stop the debug app's link first (my reading of the code, not tested) | you, me reading logs | 45 min | R8 is on only in release; this is the first time those bytes run |
| 12 | **Create a second macOS user account** (System Settings → Users & Groups, standard user) | you | 10 min | the packaged app must never launch on your account (defect 207) |
| 13 | **Fresh-user test** on that account: download the `.dmg` through Safari (so it is quarantined), follow `docs/beta-tester-guide.md` word for word, note every dialog's exact text and time, pair, send a file each way, quit and reopen, then uninstall and list what is left (`docs/beta-hardware-plan-2026-10-09.md` §D) | you at the Mac, me writing it up | 60–90 min | confirms guide items 1–5, 9, 11–12 in `docs/release-candidate-2026-10-11.md` §5 |
| 14 | Correct the guide from step 13's readings; rebuild if any code changed | me | 30 min – 1 h | testers must get a guide that matches what they see |
| 15 | **Decide the Intel `.dmg`**: ship it labelled *untested on Intel*, or drop it | you | 5 min | it has never run on an Intel Mac, and one framework keeps its original signature |
| 16 | **Licences**: approve one online fetch of the Android dependencies' licence files (or a licence plugin), or ship the current list beside the downloads as stated | you | 5 min decide, me 30 min | neither app has a notices screen |
| 17 | **Decide how to tell testers to get phone logs** (none, or you collect with adb in person) | you | 5 min | release builds have no `run-as` and no in-app export |
| 18 | **Choose how files reach testers** (a private link per person), and send `SHA256SUMS.txt` with them — and **each tester's own token file**, made with the one command in `docs/trial-licence-summary-2026-10-11.md` → *Issuing a token to a tester* | you | 15 min | testers should be able to check what they received |
| 19 | **Write the invitation**: what Sidekick is, that it is a test build, the guide, how to report, the end date if any, and that they can uninstall at any time | you (I can draft it) | 20 min | consent and expectations |

**Total with no trial:** about 5–6 hours of your time, mostly steps 9–13. **With tokens:** add 2–3 days of my
build time before step 8. *(2026-10-12: tokens chosen and built; the current candidate is `83c4096`,
`docs/release-candidate-2026-10-12.md` — step 8 still owes a rebuild once steps 5–7 are decided.)*

**Not needed for 3–5 named testers, and not in this list:** an Apple Developer ID ($99/year) and notarization.
Testers will see the *could not verify* warning and use **Open Anyway**, which the guide explains. Notarization
becomes required before anyone you do not know installs it. **Never needed:** turning off Gatekeeper or SIP.

**Open defects:** `docs/defects.md` is the register; none of them was re-assessed for this checklist.
