# What breaks on a machine that isn't yours — the distribution audit

> **Written 2026-09-02.** Phase 9's first job, and the one the brief called *the real work*:
> everything in this repo that quietly assumes **this Mac**, **this phone**, or **this person**.
>
> Scope: the shipping code. Comments and tests that name the SM-S938B are evidence records and are
> *supposed* to name it — `docs/single-device-audit.md` exists precisely so those readings stay
> attributed. What follows is the set that would reach a stranger.

## 0. Method, and its limits

Four scans over `desktop/src`, `app/src`, `core/src`, `sync-module/src`, `mirror-module/src`:
absolute and home-relative paths, private-range IP literals, personal and device names, and build
configuration. Then a read of the two build files and the Electron entry point.

**What this method cannot see, said before the results:** an assumption expressed as a *default*
rather than a literal. A timeout tuned to this Wi-Fi, a page size tuned to this phone's storage, a
retry count that happens to suit one router — none of those contain a name or a path, and no grep
finds them. Those come out on the second machine, not from this document. §5 lists the ones already
suspected.

---

## 1. Blocking — a stranger sees these

| # | Where | What it is |
|---|---|---|
| ~~**D1**~~ | `desktop/src/renderer/navModel.ts:86` — **fixed 2026-09-02** | The Overview screen's title is the string **`'Good morning, Chetan'`**. Every user of this app is greeted by name — by *this* name — on the first screen after pairing. It is also wrong twice over: it is not a template, and it says *morning* at every hour |
| ~~**D2**~~ | `desktop/src/renderer/index.html:106` — **fixed 2026-09-02** | The sidebar footer's account block is **`<div class="account-name">Chetan Pujari</div>`**, hardcoded in the markup. Beneath it `account-sub` reads *This Mac* and a pill reads *LOCAL* — those two are correct and generic; the name is not |

Both are single-line and neither has a wire dependency. `identity.ts` already derives a device name
from `hostname()`/`userInfo()`, so the material was on hand — what was missing is that nothing asked
for it.

**Fixed 2026-09-02, and the interesting part is what the fix does *not* do.** The obvious repair is
to substitute a name, and the app has no honest source for one: there is no account, `userInfo()
.username` is a login name that reads `chetan` here and `jsmith` or `admin` elsewhere, and
`hostname()` is the machine's name rather than the person's. **A greeting that gets somebody's name
wrong is worse than one that does not use it**, so `overviewTitle()` is the time of day and nothing
else — *Good morning / Good afternoon / Good evening* — which is also the first time that string has
been right after noon.

The sidebar block now describes **this Mac**, which is what its second line (`This Mac`) always
claimed it was doing: the machine's own name, initials derived from it, and the first 16 characters
of this Mac's key underneath — abbreviated the same way the phone's *Paired Macs* list does it, so
the two can be compared by eye. `initialsFor` treats a digit as not-an-initial (`macbook-pro-3` →
`MP`) and answers `''` rather than guessing when there is nothing to read.

**Why these are D-numbers rather than defects:** they are not a mechanism failing, they are a
placeholder that was always going to need replacing and has been sitting in a shipped-looking screen
long enough to stop reading as one. They should be defects the moment anyone else runs this build.

---

## 2. Distribution-blocking — the Mac cannot be handed to anybody yet

| # | Where | What it is |
|---|---|---|
| **D3** — **reopened 2026-09-02, and the original closure is kept below rather than deleted** | `desktop/` | Closed the same day as *"an unsigned `.dmg` that launches from `/Applications`"*. **That sentence is true about the artifact and was read as "the Mac app can be handed to someone", which it cannot be** — see D12. The reason is worth more than the row: **opening a `.dmg` locally exercises neither the signature nor quarantine, and those are the only two mechanisms that treat a downloaded file differently from a local one.** The check passed without touching the condition it existed for, which is the same shape as defect 64's boot receiver firing into a state it was not built for and returning success. Original text: *"There is no packaging configuration of any kind. No `electron-builder`, no `electron-forge`, no `build` block in `package.json`. `npm start` runs `tsc` and launches Electron from the source tree. There is no artifact to give anyone."* That part **is** fixed — an artifact exists. What is unfixed is that it installs |
| **D12** | `desktop/release/*.dmg` | **The app inside the `.dmg` is ad-hoc signed and Gatekeeper cannot assess it — it returns an error, not a verdict.** `codesign -dv` reports `Signature=adhoc`, `Identifier=Electron` (electron-builder's default, not our `com.chetan.connectsuite.desktop`), and `spctl -a -t exec` answers *"code has no resources but signature indicates they must be present"* — **with quarantine applied and without**. Measured 2026-09-02, with two controls that both came back clean: Calculator → `accepted / Apple System`, Google Chrome → `accepted / Notarized Developer ID`. This is worse than unsigned: an unidentified-developer app has the right-click → Open bypass, a *broken* signature does not, and the message a downloader gets is the "damaged, move to Trash" one |
| **D13** | `app/build/outputs/apk/release/` | **The release APK cannot be installed by anyone, including us.** Not a policy problem — the platform refuses it: `INSTALL_PARSE_FAILED_NO_CERTIFICATES: Failed to collect certificates`. Measured on this handset 2026-09-02 by attempting the install. `keystore.properties` is absent by design and `.gitignore`d, so the release build assembles unsigned rather than falling back to the debug key — which is the right behaviour and is also an absolute block on distribution |
| **D4** | `desktop/` | **No application icon exists** — no `.icns`, no `icon.png` anywhere outside `node_modules`. **Confirmed by the build**, which said so itself: `default Electron icon is used  reason=application icon is not set`. Still open: an icon is a design asset and there is none to install |
| ~~**D5**~~ | `desktop/package.json` — **fixed 2026-09-02, and the risk was overstated** | No `appId`, no `productName`. Both are set now (`com.chetan.connectsuite.desktop`, `ConnectSuite`). **The mechanism I claimed was measured and does not bite the way this row said:** the packaged app, with a bundle id of its own, read the *dev* build's `safeStorage`-encrypted private key without trouble and the phone accepted the existing fingerprint — `Connected to Samsung SM-S938B at 10.47.66.128 via last-known`, from the packaged binary, with the dev instance killed. The identity files were untouched. So the coupling is looser than asserted; what genuinely matters is that `appId` stays **stable between releases**, which is now pinned and commented rather than absent |
| ~~**D6**~~ | `app/build.gradle.kts` **and** `desktop/package.json` — **fixed 2026-09-02**, see `docs/versioning.md` | Two version numbers that disagree and neither is derived: the Android app is `versionName = "1.0.0"`, `versionCode = 1`; the Mac app is `"version": "2.0.0"`. Nothing in the repo says which is *the* version, and `Link.PROTOCOL_MAJOR` is a third number with a different meaning |

**D5 was written as the one with teeth, and the measurement took some of them out.** It is recorded
that way rather than quietly rewritten: the reasoning was sound — `safeStorage` *is* keyed to the
app's identity, and a bundle id that moves between releases *is* a real hazard — and the reading
showed the packaged build reading the dev build's key anyway. The lesson is the ordinary one in this
repo: a mechanism that plausibly bites is not a mechanism that was observed biting, and the
difference is one run.

**One thing the run did surface that this section had not predicted:** the packaged app and the dev
build **share their `userData` directory**. Electron derives it from `app.getName()`, which comes
from `package.json`'s `name` (`connectsuite-desktop`) and not from `appId` or `productName`. For a
released app that is harmless — there is only one. For this repo it means a packaged build and a
`npm start` build are indistinguishable in their stored identity, pairing, settings and logs, which
is *convenient* today and is the sort of convenience that produces a confusing bug report later.
Recorded as **D11**.

---

## 3. Already correct, checked rather than assumed

Worth listing, because an audit that only reports problems gives no sense of what the denominator
was.

| Area | State |
|---|---|
| **Android release signing** | Already right. `app/build.gradle.kts` reads `keystore.properties`, which `.gitignore` covers along with `*.jks` and `*.keystore`. Without it the release build assembles **unsigned** rather than falling back to the debug key — a missing keystore fails at install time instead of shipping a debug-signed APK |
| **The Mac's TLS identity** | Derived per machine — `hostname()`, `userInfo()`, a freshly generated RSA-2048 key stored through `safeStorage`. No literal, nothing checked in |
| **Debug-only IPC** | The whole `debug-*` block is inside `if (!app.isPackaged)`, and `debugSwitches()` is read only when not packaged. A packaged build has no probe handlers |
| **User data paths** | `app.getPath('userData')` for logs, identity and the activity store. Per-user, per-platform |
| **Discovery** | No hardcoded gateway. `discovery.ts` explicitly refuses to hardcode `192.168.43.1` and says why in a comment: One UI has used several |
| **The one IP literal in the renderer** | `'192.168.1.42'` in `renderer.ts:849` is a **placeholder attribute** on the manual-address field, not a value. Correct as it stands |

---

## 4. Wants attention, not blocking

| # | Where | What it is |
|---|---|---|
| **D7** | `desktop/src/main/files.ts:325`, `photos.ts:194` | `join(homedir(), 'Downloads', 'ConnectSuite')`. Per-user and therefore not a hardcoded path — but it ignores a **relocated Downloads folder**, which `app.getPath('downloads')` respects. A one-word change, and the reason it is not urgent is that the destination is stated to the user either way |
| ~~**D8**~~ | `sync-module/.../CallNumberRules.kt:17` — **withdrawn 2026-09-02, the claim was wrong** | This row said a comment carried *a real phone number* out of a hardware log into shipping source, and asked for it to be redacted. It was already redacted. Enumerating every match instead of acting on the one that was found: the file family contains `+919800000001`, `+919900000002`, `+918200000005`, `+918300000006`, `+918800000004` — **five numbers of the form `91` + two digits + `0000000` + an incrementing digit**, which is an anonymisation scheme, not a phone book. The redaction was made and then reverted: these are quoted log excerpts, and blurring evidence to remove a risk that is not there makes the record less faithful for nothing |
| **D9** | `app/build.gradle.kts:26` | `applicationId = "com.chetan.connectsuite"`. A personal namespace for a distributed app. **Not a bug and not cheap to change** — the applicationId is the app's identity to the Play Store, to every runtime grant on every installed device, and to both secure-settings bindings. Changing it after anyone has installed is a fresh install with all grants lost. It is listed so the decision is *made* rather than defaulted into |
| **D11** | `desktop/src/main` (Electron behaviour) | The packaged app and the `npm start` build **share `~/Library/Application Support/connectsuite-desktop`** — identity, pairing, settings and logs. Electron derives `userData` from `app.getName()` → `package.json` `name`, not from `appId`. Harmless for a release, and a source of confusing local results: a change tested against the packaged build shows up in the dev build and vice versa. Fix, if it is worth one: `app.setPath('userData', …)` behind `app.isPackaged`, so a dev build has its own |
| **D10** | `desktop/src/renderer/index.html:115` | The `LOCAL` pill in the account block. Correct today — it distinguishes this from a cloud product — but it reads like a plan tier next to a person's name, and with D2 fixed it will be the only thing in that block |

---

## 5. What the second machine will find, that this could not

Named so the list exists before the run rather than after it. None of these contains a literal a
grep can catch:

- **The hotspot assumption.** Discovery order #4 puts the default gateway second because *the phone
  is the gateway when the Mac is on its hotspot*. On a network where it is not, that step resolves
  to a router, and what it does then has never been measured.
- **Timeouts tuned to one link.** `FS_LIST_TIMEOUT_MS`, the mirror ack timeout, the 15-second
  heartbeat. All chosen against a phone one metre away on a private hotspot.
- **`safeStorage.isEncryptionAvailable()` returning false.** Handled — the key stays in memory and
  the identity regenerates each launch — but the *consequence* on the phone is a rejected
  fingerprint and a pairing that has to be redone, and no screen explains that. This is the one row
  here that is a user-visible failure rather than a performance question.
- **A Mac with no Downloads folder, or a read-only one.** D7's other half.
- **Every reading in `docs/single-device-audit.md`**, which is that document's whole subject.

---

## 6. The order to fix them in

1. **D1, D2** — two lines, and they are what a stranger sees first.
2. **D5** — before any artifact is built, because it decides where the identity lives.
3. **D3, D4** — the packaging itself.
4. **D6** — a version scheme, decided once, before there are two releases to reconcile.
5. ~~D8~~ — withdrawn. It was already anonymised, and the check that established that was
   enumerating all five matches rather than reading the one the grep surfaced first. That is the
   *what else looks exactly like this* rule pointed at my own finding: one plausible-looking number
   is a phone number; five in an arithmetic sequence are a scheme.
6. **D7, D9, D10** — when convenient. D9 is a decision, not a task.
