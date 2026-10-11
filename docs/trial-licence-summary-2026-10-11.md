# Trial and licence — the proposal on one page (2026-10-11)

A plain summary of `docs/trial-licence-proposal-2026-10-10.md`. **Option D was chosen and built on
2026-10-12** — see *Decided and built* at the end. There is still no server call, payment code or new
dependency in the app.

## The problem in one sentence

A free trial that a reinstall cannot restart needs something that remembers the start (or end) date somewhere
an uninstall does not reach. On the Mac, the login Keychain survives deleting the app. On Android, nothing the
app owns survives an uninstall without Google's services or a server. So the proposal **enforces on the Mac only**.
The phone app does nothing without a Mac, so licensing the Mac licenses the product.

## The options

| | Option | Sends anything to a server? | Stops | Does not stop |
|---|---|---|---|---|
| **A** | First-run date stored in the Mac's Keychain | **No** | reinstalling the app; deleting its settings folder | deleting the Keychain item, a new macOS user, a second Mac, a patched app |
| **B** | Your own server records each Mac's trial start | **Yes**: a one-way Mac ID, app version, time; the server sees the IP address | reinstalls, new macOS users, OS reinstalls | blocking the server (needs a grace period), virtual machines, a patched app |
| **C** | Mac App Store / Google Play trial | The **store** sees the account and purchase; nothing reaches you | reinstalls, per Apple / Google account | store rules (refunds, family sharing). The Mac App Store requires sandboxing this app (may not be feasible). Google Play restricts the SMS and call-log permissions |
| **D** | **A signed licence token you issue by hand, with a fixed end date** | **No** — checked offline inside the app | reinstalls, deleting settings, new macOS users (the end date is in the token) | a token copied to another Mac (unless bound to one Mac's ID); a clock set back (partly limited); a patched app. Cannot be revoked before its end date except by an app update |
| **E** | A licence-key seller (Paddle / Lemon Squeezy type) | **Yes**: licence key + a one-way Mac ID, at activation and about every 30 days; the seller holds buyer details and card data | reinstalls, key sharing beyond an activation limit | blocking the seller (grace period), a patched app |
| **F** | Google Block Store on the phone | Google backup | reinstalls | — rejected: it puts Google services back into the phone app and licenses the wrong half |

**No offline scheme (A, D) survives someone who modifies the app.** They keep honest people honest. B, C and E
are the only ways to stop new accounts and second machines restarting a trial, and they make the privacy
sentence *"nothing leaves your network"* false, so it would have to be rewritten before shipping. The proposal
gives the exact replacement text in its §4.

## What any option must do when the trial ends

A visible countdown (Settings, plus a quiet banner at 7, 3 and 1 days). Never stop mid-transfer, mid-call or
mid-mirroring. After expiry the app opens read-only: Activity, Settings and received files keep working, and
new connections stop with a one-sentence reason. **Nothing is ever deleted.**

## Recommendation

- **For the 3–5 tester beta: D.** Signed, time-boxed tokens, enforced on the Mac only, optionally bound to one
  Mac. No server, no account, every privacy claim stays true. About 2–3 days to build, nothing to buy.
- **Or no trial at all for the first 3–5 testers.** They are named people you invited. A beta that ends
  through a hand-issued token is mostly useful if the beta will be passed on to strangers. If not, the trial can
  wait until the public version and be built once, as E.
- **For public sale: E** (a licence-key seller), with the disclosures and the 14-day offline grace in the
  proposal. About 1–2 weeks plus the seller's onboarding. It needs a Developer ID-signed, notarized Mac app,
  which you need anyway.

## Decisions only you can make

1. **Trial for this beta at all — yes or no.** If yes: 40 or 50 days, counted from when (token issue or first launch).
2. **Mac only** (recommended) or both apps.
3. **Bind each token to one Mac?** Stronger, but costs each tester one extra message.
4. **What keeps working after expiry** — the read-only list above, or less.
5. **Public price model:** one-time purchase, yearly, or subscription; and the price.
6. **Seller:** which licence-key seller, the Mac App Store, or both.
7. **Accept a network call at all** in the public version, and approve the replacement privacy text.
8. **Key custody:** where the signing key lives, and who else may issue tokens.

---

## Decided and built — 2026-10-12

**The owner chose D:** signed, time-boxed tokens, **45 days**, enforced on the **Mac only**, no server, no
network call, no account. Tokens are **not bound** to one Mac: the same token works on a second Mac, by
decision. Built in `desktop/src/shared/trial.ts` (format, Ed25519 check, verdict, copy),
`desktop/src/main/trial.ts` (store and gate), `desktop/src/renderer/trial.ts` (screens) and
`scripts/issue-trial-token.mjs` (issuer). **Nothing in any of them sends anything anywhere.**

### What the Mac stores, locally

One file, `trial.json`, in Sidekick's own profile folder
(`~/Library/Application Support/sidekick-desktop/`):

- **the token as entered** — public, signed, holding the tester's label, a random id and the two dates;
- **the clock mark** — the latest time Sidekick has seen this Mac's clock at, sealed with the login
  Keychain (`safeStorage`) so it is not a plain number to edit;
- **which notices were shown** — the 7-day and 1-day ones, so neither repeats.

The private key is never on a tester's Mac and never in this repository (a commit hook refuses it).

### Making the key — once, on the owner's Mac

```sh
mkdir -m 700 -p ~/.sidekick-trial-key
node -e "const c=require('node:crypto'),f=require('node:fs'),p=require('node:path').join(require('node:os').homedir(),'.sidekick-trial-key','private.pem');const k=c.generateKeyPairSync('ed25519');f.writeFileSync(p,k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});console.log(k.publicKey.export({type:'spki',format:'der'}).toString('base64'))"
```

It writes the private key to `~/.sidekick-trial-key/private.pem` (mode 600, refuses to overwrite one that
exists) and prints **only the public key** — 60 characters starting `MCowBQYDK2VwAyEA`. The public key goes
into `desktop/src/main/trialKey.ts`; the private key stays on that Mac. Back it up offline (a password
manager or an encrypted drive). **If it is lost, no new token can be issued for builds carrying its public
key; if it leaks, anyone can issue tokens until a build with a new key replaces it.**

### Issuing a token

```sh
node scripts/issue-trial-token.mjs --key ~/.sidekick-trial-key/private.pem --label "Asha" --days 45
```

It prints the token (or writes it with `--out asha.sidekick-token`) and appends a row to
`~/.sidekick-trial-key/issued-tokens.tsv`: when, id, label, start, end. `--start YYYY-MM-DD` sets a later
start; without it the token starts at the beginning of today (UTC).

### How a tester gets and enters it

The owner sends the token — the text, or the `.sidekick-token` file — by any private channel. On first
launch Sidekick shows **Enter your beta token** before pairing; the tester pastes it or presses **Open token
file…**. Later tokens go into **Settings › About › Beta access**, which also shows the quiet line *Beta
access until 26 Nov 2026 · 44 days left*. A wrong, damaged, expired or not-yet-valid token gets its own
sentence; nothing is stored.

### What the Mac does with it

| Situation | What happens |
|---|---|
| valid | everything works; Settings shows the days left |
| 7 days left, then 1 day left | one gentle notice each (a toast), never repeated |
| expired | at the next connect — never mid-transfer, mid-call or mid-mirroring — a friendly screen stands in place of the phone panes: *ended on…*, how to get a new token, and the entry. **Activity and Settings stay open, Activity can be exported, nothing is deleted or hidden** |
| not yet valid | the same screen, naming the start date |
| the clock is more than a day behind the last time Sidekick saw it | the screen says so in plain words and points at Date & Time; fixing the date clears it. If the clock had run **ahead** and was corrected, a token **issued later** clears it |
| no token yet | the screen asks for one |
| a build without the public key | the screen says the build cannot check tokens — a build problem, not the tester's |
| development build | checks exactly as packaged, unless started with `CONNECTSUITE_DEBUG_SWITCHES=skipTrial`; **a packaged build ignores that switch** (tested) |

### Limits, stated rather than discovered

A token cannot be revoked before its end date (issue short ones); it works on any Mac it is copied to
(allowed); deleting `trial.json` loses the clock mark, which only weakens the clock check (the end date is in
the token); and no offline check survives someone who modifies the app.
