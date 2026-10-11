# Trial and licence — the proposal on one page (2026-10-11)

A plain summary of `docs/trial-licence-proposal-2026-10-10.md`. **Nothing is built.** No licence check,
server call, payment code or dependency exists in the app.

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
