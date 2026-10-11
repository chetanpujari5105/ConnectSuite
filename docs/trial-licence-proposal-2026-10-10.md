# Trial period and reinstall — a design proposal (2026-10-10)

> **Status: design only. No licence check, server call, payment code or new dependency was added in this
> batch.** Every option below is something to decide, then build.

## 0 · The answer in five lines

1. **A trial that a reinstall cannot restart needs a memory that outlives the app.** On the Mac that can be
   the login Keychain; on Android nothing an app owns survives uninstall without a Google service or a server.
2. **So enforce on the Mac only.** The phone app does nothing without a Mac; licensing the Mac app licenses the
   product, and the phone stays free, account-free and permission-for-permission what it is today.
3. **For the beta, use signed licence tokens with an absolute end date**, one per tester, that you issue by
   hand. A token that says *valid until 2026-11-30* cannot be restarted by reinstalling, needs **no server and
   no network**, and keeps *"nothing leaves your network"* true.
4. **For public sale**, a merchant-of-record licence service (Paddle or Lemon Squeezy class) or the Mac App
   Store. Both mean a network call, so the privacy sentence and in-app copy must change — exactly as in §4.
5. **Effort:** beta tokens ≈ 2–3 days. Public licensing ≈ 1–2 weeks plus the provider's onboarding.

---

## 1 · What the requirement implies

*"Free for 40–50 days, then buy or lose access, and reinstalling must not restart the trial."*

A trial is a **start date** plus a rule. Anything stored only inside the app's own data is deleted with the
app, and the next install sees no start date and starts again. To resist reinstall, the start date (or the end
date) has to live **somewhere uninstall does not reach**:

- on the device, in a store the platform keeps after the app is gone, or
- off the device — a server, or a store/purchase record keyed to an account — or
- **in the licence itself**, as an absolute end date that was decided before the app ever ran.

The third is the only one that needs neither a surviving store nor a network. It is what §7 recommends for
the beta.

## 2 · What survives uninstall, per platform

| Store | Mac | Android |
|---|---|---|
| App's own data (`~/Library/Application Support/…`, app-private storage) | survives deleting the `.app` (macOS does not remove Application Support), but a user can delete it, and a new macOS user has none | **deleted on uninstall** |
| Keychain / Keystore | **login Keychain items persist** after the app is deleted. Read access is tied to the app's code signature: stable once Developer ID-signed; an ad-hoc or unsigned build changes identity per build and prompts (the defect-207 family) | Keystore keys are **deleted on uninstall** |
| Shared storage file | a file in `~/Library` or `~/Documents` survives; trivially deleted | a file in `Download/` survives, but on Android 11+ the reinstalled app **no longer owns it** and cannot read it without the person picking it |
| Device identifier | `IOPlatformUUID` (hardware UUID, readable without special permission) — stable across reinstall and OS reinstall | `Settings.Secure.ANDROID_ID` — stable across reinstall for the same signing key, user and device; changes on factory reset. An identifier, not storage |
| Platform service | iCloud Keychain / CloudKit — needs an Apple account and network | **Block Store** (Google Play services) survives reinstall and moves to a new phone — but it reintroduces a Google dependency the release build removed (16 → 0 Google artifacts, `docs/release-candidate-2026-10-09.md`) and syncs through Google's backup |

**Consequence:** the Mac can hold a trial date offline in the Keychain; the phone cannot without Google or a
server. That is the main reason to enforce on the Mac (§0.2).

## 3 · The options

| | Option | Reinstall-proof? | Network / data | Friction | Can be defeated by | Notes |
|---|---|---|---|---|---|---|
| A | **First-run date in the Mac Keychain** (offline) | yes, for app reinstall | none | none | deleting the Keychain item; a new macOS user; a second Mac; clock tricks (§5) | cheap; honest; weak against a determined person. Needs a stable Developer ID signature to read its own item without prompts |
| B | **Server activation per Mac** — trial start recorded server-side against a hashed hardware ID | yes, including new macOS users and OS reinstall | sends a hashed device ID, app version, time (§4); the server sees the IP address | one automatic call at first run, then periodic re-checks | network-blocking the server (needs offline grace, §6); VMs with fresh hardware IDs | breaks *"no Sidekick server"*; needs a server you run and secure |
| C | **Store licensing** — Mac App Store (receipt + IAP trial) or Google Play (subscription with free trial) | yes, per Apple ID / Google account | the store sees the account and purchase; nothing reaches you beyond sales records | store account, review, store rules | refunds and family sharing, by store rules | the **Mac** App Store requires sandboxing; this Electron app's local-network server use, Accessibility-driven features and helper tools would need an audit before it is feasible. **Play** is the harder case: `READ_SMS`/`SEND_SMS` and the call-log permissions need Play's restricted-permission exception, and the AccessibilityService needs its declaration (`docs/privacy-and-distribution-2026-10-07.md` §5.4) |
| D | **Signed licence file/token** with an absolute end date, verified offline with a public key in the app | **yes** — the end date is in the token, not in a first-run record | none | the tester pastes or opens a token once | copying a token to another Mac (unless bound to a hardware ID, §7.2); clock set back past the end date (§5) | no server, no account; revocation only by expiry or an app update (§7.4) |
| E | **Merchant of record + licence keys** (Paddle, Lemon Squeezy and similar) | yes — activations are counted server-side | licence key + an instance name/ID to the provider at activation and at re-validation | buy, receive a key, paste it | sharing keys (activation limits), blocking the provider (grace) | the provider handles card data, VAT/sales tax and refunds; you never see card details |
| F | **Google Block Store** on the phone | yes | Google backup | none | clearing Google backup | rejected: adds Google Play services back and licenses the wrong half of the product |

## 4 · The privacy line — what a server check would send, and the copy that would have to change

Today's draft says (`docs/privacy-policy-draft-2026-10-09.md`):

> *"There is no Sidekick account and no Sidekick server, and we receive nothing from either app."*
> *"**What leaves your network.** Nothing, from Sidekick."*

**Options A and D keep both sentences true.** Options B, C and E make them false, and they must be rewritten
**before** any build that contacts a server ships. No hidden telemetry: the licence call carries only the
fields below, is made by the Mac app only, and is listed in the policy and in Settings.

**A licence check (B or E) would send exactly:**

| Field | Example | Why |
|---|---|---|
| licence key (E) or trial request (B) | `SK-XXXX-…` | what is being checked |
| install ID | `sha256(product salt ∥ IOPlatformUUID)`, first 32 hex | binds the licence to this Mac without sending the hardware UUID itself |
| app version | `2.1.0` | to refuse versions with a known flaw |
| request time | from the Mac's clock | replay protection |
| **unavoidably** | the Mac's public IP address, as any internet connection does | the server must not log it beyond rate limiting; say so |

**Never sent:** anything about the phone, files, messages, notifications, clipboard, contacts, call events,
screen, the Mac's name, the user's name or email (unless they bought with it, in which case the **provider**
holds it, not the app).

**Replacement policy text (B/E), for your review:**

> *"What leaves your network. Sidekick for Mac contacts our licence service when you start a trial or enter a
> licence key, and about once every 30 days after that to confirm it. It sends your licence key, a
> one-way identifier for this Mac (derived from its hardware ID, never the ID itself), the app version and
> the time. Like any internet connection, it also reveals your IP address, which we do not store. Nothing
> about your phone, your files, messages, notifications, clipboard, contacts or calls is ever sent. The phone
> app contacts no server at all. If our service is unreachable, Sidekick keeps working for 14 days."*

**In-app copy (B/E):** Settings → About gains a *Licence* row stating the same in one line, with a *What is
sent* link to the policy section. The first-run trial screen says *"Starting your trial contacts our licence
service once — here is exactly what it sends."* before the call is made.

## 5 · What an offline-only trial can and cannot resist (options A and D)

| Attack | A (Keychain first-run date) | D (signed token, absolute end) |
|---|---|---|
| Reinstall the app | **resists** (Keychain survives) | **resists** (end date is in the token) |
| Delete Application Support | resists | resists |
| Delete the Keychain item | **defeated** — the trial restarts | resists |
| New macOS user account | **defeated** — a new keychain | resists (the token still has its end date); can be copied unless bound (§7.2) |
| A second Mac | **defeated** — a new keychain | resists if the token is bound to one Mac's install ID; otherwise one token works on any Mac |
| A second phone | irrelevant — enforcement is on the Mac | irrelevant |
| Set the clock back | partly: keep a **high-water mark** of the latest time ever seen (in the Keychain) and refuse a clock earlier than it. A cross-check against the **phone's** wall clock would help, but it is **not on the wire today** — `pong` carries the phone's monotonic clock, `hello` no time at all — so it would need a new field, specified in `docs/protocol.md` first. Both clocks can still be rolled back by someone determined | same mitigations, against the token's end date |
| Patch the app binary | **defeated** — no offline scheme survives a modified binary; hardened runtime + notarisation only raise the cost | defeated likewise |

**Conclusion:** offline schemes keep honest people honest. For a named-tester beta that is the right bar; for
public sale, B, C or E is the only way to make reinstalls and second accounts not restart a trial.

## 6 · A fair expiry, whichever option

- **A visible countdown**, never a surprise: Settings → About shows *"Trial — 12 days left"*; a quiet banner on
  the Overview at 7, 3 and 1 days; nothing modal, no nagging inside panes.
- **Never mid-task.** Expiry takes effect at the next app launch or link reconnect, never during a transfer, a
  call or a mirroring session.
- **After expiry, read-only, not locked out:** the app opens; Activity, Settings and the export of the
  activity log keep working; files already received stay where they are, untouched; *Show in Finder* works.
  What stops: connecting to the phone for new transfers, mirroring, messages, calls and clipboard sync. The
  pane says why in one sentence and offers *Buy* / *Enter licence* — the same honest-refusal posture as every
  other unavailable feature (PRODUCT principle 1).
- **No data loss, ever.** Expiry deletes nothing — no pairing, no history, no received file.
- **Offline tolerance (B/E):** a failed re-check is not an expiry. The app keeps working for 14 days from the
  last successful check, says so in Settings, and only then falls back to read-only.
- **No dark patterns:** no fake urgency, no hidden auto-renewal, no pre-ticked upgrades, cancellation as easy
  as purchase, and the price and what is included shown before purchase.

## 7 · The beta: signed licence tokens you issue

### 7.1 The token

```
SIDEKICK-LICENCE-1.<base64url(payload)>.<base64url(ed25519 signature)>
payload = {
  "v": 1,
  "id": "beta-007",                 // your reference, for revocation
  "to": "Tester name",              // shown in Settings → About; optional
  "notBefore": "2026-10-15",
  "notAfter":  "2026-11-29",        // the absolute end: 45 days; reinstalling cannot move it
  "bind": "3f9a…" | null,           // optional: the Mac's install ID (§4), so it works on one Mac
  "features": ["all"]
}
```

The Mac app embeds the **public** key and verifies the signature offline. The **private** key never leaves
your Mac (Keychain or a password manager; one backup offline).

### 7.2 Issuing one

1. The tester installs Sidekick; Settings → About shows *"Install ID: 3f9a…"* and *"No licence"* (copy button).
2. They send you the install ID (or you skip binding for a trusted tester).
3. You run `node scripts/licence/issue.mjs --id beta-007 --to "Name" --days 45 [--bind 3f9a…]`; it prints the
   token and appends a row to your private ledger (`id, to, issued, notAfter, bind`).
4. They paste the token into Settings → About → *Enter licence*, or open a `.sidekick-licence` file.

### 7.3 What the app does with it

- valid and in date → normal; Settings shows *"Beta licence — until 29 Nov"*;
- within 7 days of `notAfter` → the countdown of §6;
- past `notAfter`, or bound to another install ID, or a bad signature → read-only mode of §6, with the reason
  in one sentence (*"This licence ended on 29 Nov."*, *"This licence is for a different Mac."*).

### 7.4 Revoking one

Offline tokens cannot be revoked instantly — that is the price of no server. Three levers, in order:
**short validity** (45 days, renew by issuing a new token); a **revocation list compiled into the next app
update** (token IDs); and, only if you later adopt B/E, an online check.

### 7.5 What to build, and what to buy

| Build | Effort |
|---|---|
| `scripts/licence/issue.mjs` + key generation + private ledger | ½ day |
| Mac verifier (`src/shared/licence.ts`, pure, tested red-first: signature, dates, binding, clock high-water mark) and its store in the Keychain | 1 day |
| UI: Settings → About licence row, install ID, paste/open; the countdown banner; the read-only mode's one-sentence states on each pane | 1 day |
| Docs: tester guide section, privacy note (*unchanged claim*), defects/testing entries | ½ day |
| **Buy for the beta** | **nothing** |

## 8 · Public launch, later

- **Merchant of record (E)** — recommended for a direct-download Mac app: licence keys with an activation
  limit, a 30-day re-validation with the §6 grace, the provider handles tax and refunds. Builds on §7's
  verifier (the provider's signed response replaces your hand-issued token). ≈ 1–2 weeks, plus their
  onboarding; requires the §4 copy changes and a Developer ID-signed, notarised Mac app (already owed for
  distribution).
- **Mac App Store (C)** — reinstall-proof by Apple ID, no server of yours, but sandboxing this app is a
  separate investigation and may not be feasible.
- **Play Store for the phone** is a distribution question, not a licensing one: with the Mac licensed, the
  phone app can stay free wherever it is distributed.

## 9 · Recommendation and decisions you owe

**Recommendation:** for the beta, **D — signed, time-boxed tokens, enforced on the Mac only**, optionally bound
to one Mac. It meets *"reinstalling must not restart the trial"* without a server, keeps every privacy claim
true, and is the base the public licensing builds on. For sale, **E** (merchant of record) with the §4
disclosures and §6 grace.

**Decisions:**

1. Trial length: **40 or 50 days** (and from when: the token's issue date, or first launch).
2. **Enforce on the Mac only** (recommended) — or both apps.
3. **Bind tokens to one Mac?** (stronger; costs testers one extra message.)
4. **What keeps working after expiry** — the read-only list in §6, or less.
5. **Public model:** one-time purchase, yearly licence, or subscription; price.
6. **Provider:** a merchant of record (which one), or the Mac App Store, or both.
7. **Accept a network call at all** for the public version — and approve the replacement policy text in §4.
8. **Key custody:** where the signing key lives and who else can issue.
