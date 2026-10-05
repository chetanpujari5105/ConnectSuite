# Overnight engineering — 2026-10-05 → 06 (unsupervised; code, tests and documents only)

> **Status: in progress.** This file is written as the night goes; the morning summary at the top of
> `docs/RESUME.md` points here. Nothing in it was run on the phone, on a live profile, or in the
> running Sidekick app. Every number below is from a JVM, `node --test` or a temporary directory.

## Evidence log, one entry per change

### E1 — `CameraStreamTest` was timing-dependent (`148b93a`)

- **Repetition did not reproduce it:** 25/25 green under 12× `yes` CPU load.
- **Widening did:** a `Thread.sleep(150)` placed in `CameraStream.shutdown()` after the CAS — the
  stream still correct, `onClosed` still called exactly once, only later — turned **2 of 6** red.
  `isOpen` flips at the CAS, before `closeSocket()` and `onClosed()` run on the watcher thread; one
  test asserted the call count right after polling `!isOpen`, two others covered the gap with
  `sleep(50)` / `sleep(100)`, and the producer test used a 500 ms wall-clock bound.
- **Fix:** `CameraStream.awaitThreadsEnded(timeoutMs)` joins writer and watcher; every "exactly once"
  is counted after it. The producer test asserts the writer is still inside its first write when ten
  offers return (an offer that waited on the writer could only return after the gate's 5 s timeout).
- **Fixed tests:** green clean; green under the 150 ms widening; red under a double-`onClosed`
  mutation (3 of 6) and an offer-blocks-on-writer mutation (1 of 6). 20/20 under load.

### E2 — the pending Activity call-data rewrite could destroy unrelated rows (`87a8b29`)

The one-time rewrite added in `0555c3e` runs on the **next launch** of the Mac app and keeps no backup
(a backup would keep the numbers it removes). Reviewed with synthetic fixtures only:

| Found | Consequence |
|---|---|
| any unreadable line triggered a rewrite that deleted it | a hard quit's half-written *non-call* row was destroyed |
| every non-call row was re-serialised from parsed fields | any field this build does not read was silently dropped |
| a failed rewrite of `activity.jsonl.old` threw through `initAt` | the pane read "could not read" over a readable history; a `.rewrite` temp file was left behind |
| a file ending in a half-written line had the next event appended to it | the new event became unreadable too (masked until now by the over-eager rewrite) |

**Now:** call rows are rewritten under the rule; every other readable row is written back byte for
byte; an unreadable line is kept unless it may hold call data (mentions `calls`, or a 5+ digit run
outside `seq`/`at`); a failed rewrite is logged with its counts, its temp file removed, and the
history still returned. Red first 3 of 5; four mutations each red on exactly their test.

**Synthetic dry run at the real file's scale** (temporary directory, never the profile): 455 lines —
75 numbered call rows, 377 other rows, 3 broken lines → 75 rewritten, 1 broken call line dropped,
**379/379 non-call lines kept verbatim**, 0 numbers left on disk, 2.7 ms.

**What still needs approval:** the rewrite itself, which happens when the app is next launched. It is
irreversible by design. Two copies of older history are **outside** its reach and still hold numbers
if they exist: `logs/activity.jsonl.pre-migration` (the ConnectSuite merge's backup) and the
ConnectSuite folder's own `logs/activity.jsonl`. Neither was opened tonight.

### E3 — notification keys in logs (`98f8e3d`)

Android's key is `user|package|id|tag|uid`; WhatsApp's tag for a one-to-one chat is the contact's
JID (their number). Mac `nativeNotifier` logged it on **every cooldown decision**; Mac
`notifications` on a debug path; phone `NotificationRelay` on a failed dismiss. Both sides now log
`tag#<per-process salted hash>`. Red on both sides with the raw key restored.

### E4 — a failed contact lookup logged the number (`4b3159f`)

`ContactsStore.query` logged `Query on $uri failed: ${it.message}`; the lookup URI is
`…/phone_lookup/<number>` and Android's `SecurityException` repeats it. `ProviderLog.queryFailed`
cuts every `content://` URI after its first segment, in the URI and the message, keeping the
exception type. Red: raw line restored (1/3), redact made a no-op (2/3).

### E5 — SMS logs carried numbers (`0c8a9fe`)

Mac: `sms.send` refusals (`RECIPIENT_MISMATCH`, `SEND_FAILED` name numbers on purpose, for the
person) were logged whole, twice; now `code-only`, the sentence still reaches the pane. Phone:
`no provider row for $address`, and the mismatch line listing both number sets. New guards on both
sides; the phone scan found the mismatch line on its first run.

### E6 — notification reply/action refusals logged a contact's name (`840adc9`)

The wrong-conversation refusal quotes the conversation title. `tell()` gained `ask()`'s existing
`refusalLog`; `notif.reply` and `notif.action` log by code.

### E7 — step 70's `--require-correction` could never pass after `559f1da` (`2d23951`)

It read the number out of the correction line; the line no longer carries one, so the capture was
the word `arrived` and every reject would have been withheld. It now ties the correction to the
**one** inbound episode of the watch by call id, and refuses with a printed reason on zero or two.
9 fixtures, both line formats (the installed APK still writes the old one). Not run against a phone.

### E8 — defect 122: printed shortcuts that did nothing (commit below)

`⌘⇧.` and `⌘⇧T` were printed by the palette and bound to nothing. The palette's commands now become
a **Mirror** menu whose accelerators are the printed keys, running the palette's own `runCommand`;
the page-level `⌘⇧M` handler is removed (one owner). `⌘⇧4` is no longer printed — macOS takes it
first. Tests only; **not seen in the running app**, which was not relaunched.
