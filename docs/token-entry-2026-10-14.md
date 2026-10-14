# Token entry and the Keychain note — 2026-10-14 (app batch 1)

From the owner's first install of the packaged `83c4096` DMG: pasting the token text copied from the website
was refused with *"That doesn't look like a Sidekick beta token"*; **Open token file…** worked; the Keychain
prompt came back on every launch until **Always Allow**.

## 1. Diagnosis of the refused paste

Read from the packaged profile's log (`~/Library/Application Support/sidekick-desktop/logs/`), **trial refusal
and acceptance lines only**, the token id masked:

```
13:55:34.632  [trial] beta token refused: malformed
14:00:45.570  [trial] beta token refused: malformed
14:25:14.726  [trial] beta token refused: malformed
14:32:08.183  [trial] beta token <id> accepted — until 2026-11-25T00:00:00.000Z; clock check started fresh
```

**What the log can say:** three refusals, all `malformed`; the token was then accepted from the file at 14:32.
`malformed` means the text did not have the token's shape: not three dot-separated parts beginning
`SIDEKICK-TRIAL-1`, a character outside base64url, or a signature that is not 64 bytes. It rules out a complete
token with a changed character, which would have been `bad-signature`.

**What it cannot say:** what the text was. The line carried no character classes, so a pasted SHA-256, a token
wrapped in curly quotes, one with a zero-width character, an autocorrected dash and a cut-off copy all write the
same line. A checksum paste is **consistent with** the log and is the likeliest given the website's Copy button
on the SHA-256 line; it is **not proven** by it. The refusal line now carries the reason, the source and the
character classes (§2), so the next one will say which.

## 2. What changed

**A forgiving paste, with the check unchanged** (`desktop/src/shared/trial.ts`). `cleanPastedToken` removes
whitespace and line breaks, zero-width characters and `>` quote markers; puts look-alike dashes and quotes back
to ASCII; strips wrapping quotes, backticks, brackets and trailing punctuation; and finds
`SIDEKICK-TRIAL-1.<payload>.<86-character signature>` inside a longer paste. Every character that survives is
one the issuer wrote, and the same Ed25519 verification runs on it. What is stored is the cleaned token, never
the message around it.

**One tightening found while testing it:** a 64-byte signature is 86 base64url characters, and the last one
carries four padding bits that Node ignores. Under the old check, **15 of 63** substitutions of the signature's
last character still verified. The signature must now be spelled exactly as encoded, so one changed character
anywhere in the payload or signature is refused (`bad-signature`). No issued token is affected; Node only emits
the canonical spelling.

**Refusals keep their kinds** (`malformed`, `bad-signature`, `no-key`, and the date refusals) and gain a reason for
the sentence only: `cut-off`, `checksum` (a 64-character hex string), `url`, `email`, `wrong-format`. Each has
its own sentence with a next step. The refusal log line is now, for example:

```
beta token refused: malformed (checksum), from the clipboard — 64 characters, upper 0, lower 16, digits 48, …, hex-only yes
```

character classes and counts only, never the text: a paste is whatever was on the clipboard.

**The token screen** (`desktop/src/renderer/trial.ts`): short copy (*You need a beta token from the person who
invited you. Paste it or open the token file. It is checked on this Mac, and nothing is sent anywhere.*); a
**Paste token** button, first and primary, whose clipboard read happens in the main process (`trial-paste`) so the
text never reaches the page; **Open token file…**; **Use this token** for text typed or pasted into the box; and a
*Where do I get a token?* disclosure: *Ask the person who sent you Sidekick. They send it as text or as a file
ending in .sidekick-token.*

**Open Activity / Open Settings** are gone from the token screen: its whole job is the entry, a first install is
unpaired (they were never drawn there), and the sidebar reaches both anyway. They **stay** on the expired,
clock-back and not-yet screens, whose copy promises that Activity and the settings are still there.

**The Keychain note** (`identityStore.ts` `keychainNoticeDue`, `main.ts` `keychainNoticeIfDue`): a standalone
alert with one **Continue** button, before the first read of the stored identity, on a fresh profile only
(neither `cert.pem` nor `key.enc` on disk, and no stored phone). A packaged build shows it on every fresh profile;
a development build only with the `keychainNotice` debug switch. Storage is unchanged: the identity is still
sealed with `safeStorage`, and nothing creates, reads or deletes the Keychain item beyond what `safeStorage`
already did.

## 3. Where the note had to go — two wrong placements, measured

In an isolated development instance (scratch build of this tree, `CONNECTSUITE_DEV_PROFILE` on a scratch
folder, port 9333, `keychainNotice` on; the owner's packaged and development apps left running and untouched):

| Placement | What happened |
|---|---|
| A sheet on the main window, inside `resolveIdentity` | **Neither the window nor the sheet was on screen.** The window list held a 1440×920 window not ordered in; System Events counted 0 windows, even with the process made frontmost. The process sat blocked behind nothing visible. Control: the same lister showed the development app's window |
| A standalone alert after `createWindow` | Both on screen, but the alert's modal loop answered the page's first IPC calls before `whenReady` had registered them: `No handler registered for 'share-offers'` and `'webcam-current'` |
| **A standalone alert before `createWindow`** (shipped) | The alert alone on screen; Continue pressed by name; then the window, the identity, the trial. **0** handler errors |

The order from that run's log (`docs/evidence/token-entry-2026-10-14/isolated-run-log.txt`):

```
15:15:26.721  [identity] Fresh profile: showing the Keychain notice before the first read of the identity
15:15:38.653  [identity] Keychain notice: Continue — reading the identity next
15:15:38.654  [window]   opened 1440x920
15:15:38.807  [identity] New identity 6E:9E:66:48:… stored (the folder was empty)
15:15:38.818  [trial]    beta access: none — No beta token entered.
```

No macOS password prompt appeared in that run, which is expected: the development Electron is already
trusted for the item. **Not established:** whether a packaged build on a truly fresh macOS user is prompted on
its first launch at all. The item does not exist yet, and an app usually creates its own item without being
asked. If it is not prompted, the note's *"macOS will ask"* is wrong for that first launch and should read
*"may ask"*. The fresh-user test decides this.

**Seen, not changed:** the existing blocked-key prompt (`blockedPrompt`, defect 207) uses the first placement:
a sheet on the window just created. Its 2026-10-08 run recorded it on screen for ~5 s, so it has worked at
least once, but the same shape was invisible here. Worth one isolated run before it is relied on.

## 4. First-run order of a packaged build on a fresh profile, from the code

1. Gatekeeper: *could not verify* → **Done** → Privacy & Security → **Open Anyway**.
2. Sidekick's Keychain note → **Continue** (before any window).
3. `loadIdentity` → `safeStorage`: where macOS can ask for the password (**Always Allow**).
4. The window: **Enter your beta token**, covering the pairing screen.
5. Token accepted → the link starts → macOS's local-network prompt, if it comes → **Allow**.
6. **Scan this with your phone**.

After a new ad-hoc-signed build, step 2 does not show (the profile is not fresh) and step 3 asks once more.

## 5. Tests

Red first, each against the old code: the 17 shared-core tests (corruptions, wrong pastes, refusals, messages,
log), 2 store tests, 4 Keychain-note tests, 3 screen tests. Old behaviour per paste, recorded before the fix:
inner spaces `ok`; double quotes, curly quotes, backticks, an en-dash prefix, a zero-width character, a
trailing full stop, a token inside a message and a checksum all `malformed`.

Mutations, each red on its own test: canonical-signature check removed (1), zero-width removal dropped (1),
signature length unbounded in the search (2), checksum recognition removed (2), store keeps the raw paste (1),
refusal logs the text itself (1), note shown despite a stored phone (1), doors back on the token screen (1), note
moved after `createWindow` (1).

Screenshots, synthetic input only (a made-up 64-hex string, not the DMG's checksum), 1100×700 and 1440×900,
both themes, plain and refused-with-help-open: `docs/evidence/token-entry-2026-10-14/`. In every shot the route
is `pairing` covered by the token screen, the buttons read *Paste token · Open token file… · Use this token*, and
there are no doors; at 1100×700 the longest state ends at 673 px.
