# Pairing v2, S2b and S4 — hardware test proposal (NOT approved, NOT run)

> **Status: a proposal for separate approval.** Written 2026-10-06 after pairing v2 (defect 182) and
> session-bound side channels (defect 189) were built and tested in code only. **Nothing here has been
> run.** Every step changes something on your devices, and each is approved on its own; approving one
> approves nothing after it. Every phone write goes through `scripts/adb-pinned.sh` after
> `scripts/target-device.sh` names the SM-S938B.

## What the code-only tests could not prove

- That the phone's real `ControlSession`, Room table and `SharedPreferences` behave as `PhonePairing`
  does on the JVM (the JVM tests reach the decisions, not Android).
- That the Android TLS stack (Conscrypt) admits the armed fingerprint and nothing else.
- That the Mac's pairing screen shows the right sentences in the real window.
- That a real pairing, a reconnect, the mirror and a file transfer still work after it.
- Anything about a second trusted Mac (none is available).

## Preconditions (owner decisions)

1. **This re-pairs your devices.** Your current pairing is *legacy*; there is no way to verify it after
   the fact, and release verification requires a v2 pairing. The steps below forget the phone on the Mac
   and the Mac on the phone, which is irreversible in the sense that the old pin is gone (pairing again
   restores a working link).
2. Installing the Mac build runs the pending one-time Activity call-data rewrite (`docs/overnight-2026-10-06.md`
   E2). Approve that separately, or keep F1's private backup first.

## Steps

| # | What | Changes | Pass criterion (with its control) |
|---|---|---|---|
| H1 | Record the current state: `scripts/link-up.sh`; Mac log line `pairing: legacy (…)` after relaunch | nothing | Control: the link is up before anything changes. The legacy line names the stored pairing honestly |
| H2 | Build and relaunch the Mac app (`npm run build`, quit by menu, relaunch with `--force-renderer-accessibility --remote-debugging-port=9222`) | Mac app; runs the Activity rewrite | Settings → Connection → *Trusted device* reads *Paired before secure pairing…* (read by name over CDP) |
| H3 | Install the phone build (`adb install -r`), start `MainActivity` by name, `scripts/link-up.sh` | phone app | Three OKs; phone log `pairing for …: legacy (v1, not authenticated)` — a legacy pair still reconnects |
| H4 | **Secure re-pair:** Forget on the Mac, Forget on the phone, open the pairing screen, scan | trust on both sides | The phone shows **"Code scanned. Verifying your Mac…"** after the scan and **"Paired"** only after the Mac log says `pairing v2, both sides proved the code` (read both by name: `uiautomator dump` on the phone, CDP on the Mac). Phone log the same; Settings no longer shows the legacy sentence. Control: `link-up.sh` three OKs |
| H4b | Cancel on the phone during verification (a second, separate scan) | nothing persistent | The phone says **"Pairing cancelled"**; the Mac does not store the phone; scanning again works |
| H5 | Reconnect: disconnect and reconnect from the Mac; toggle phone Wi-Fi once | nothing persistent | Reconnects with no pairing request (`pair` absent in the phone's hello log) |
| H6 | Side channels after the re-pair (S2 + S2b): mirror 30 s; push one file; pull one file from `Download/ConnectSuite` | none beyond the files | `Encoded +N frames` ticks; the phone verifies the push digest; the pull completes. Control: the phone log shows `bulk channel authorised` / `video channel authorised` |
| H7 | **Impostor-first, on your LAN, with a stand-in you run on this Mac** (no third device): a tiny TLS listener on a second port advertised as the only candidate before the phone, answering `hello.ack` without a proof | nothing on the phone | Mac log `a device at … was not trusted: it answered without proving the pairing code (1 of 8)`, the pairing screen's sentence, and then the real phone pairs. Control: H4 succeeded without it |
| H8 | Old-client refusal (optional): scan a v1 QR (a screenshot from an old build) with the new phone | nothing | The scanner says *This Mac's Sidekick is too old to pair securely…*; nothing armed |
| H9 | **S4, the real windows still work:** open the floating mirror (tap, swipe, pin, resize, close), and receive one shared file in the receive window if `share.file` is enabled in the build under test | nothing | Every action works; the Mac log has **0** `refused` lines from the `ipc` tag for those actions. Control: the log's allowed count rises with each action |
| H10 | **S4, a real drop and a real drag:** drop a file from Finder onto Files → Send to phone; then pull a file and drag it to Finder | one file on each side | **Defect 190:** the drop raises a **native sheet** naming the file, with Cancel as the default button; Cancel sends nothing, Send sends it; the pulled file drags; a file dropped **outside** the drop zone does nothing (S3). Use a synthetic file made for the run, never a personal one |
| H11 | **S4, reveal a saved photo:** Photos → save one original → Reveal | one file | Finder opens on it; a second Reveal after moving the file is refused with the pane's sentence |
| H12 | **S4 log check:** read the Mac log for `refused` lines over H9–H11 | nothing | Only expected refusals (none in normal use); each line carries `N refused / M allowed` and **no payload** |

## What H7 needs that does not exist yet

A stand-in listener that is **not** shipped code: a script under `scripts/` that binds a loopback or LAN
port with a throwaway certificate and answers one hello. It must never be pointed at anything but this
Mac, and the candidate order must be forced through a debug-only switch — which also does not exist.
Building both is a separate, small, approvable batch; until then H7 stays a code-only result
(`pairingV2Link.test.ts`, *an attacker answering FIRST…*).

## What H9–H12 cannot show

A compromised page, a subframe or a replaced window on the real app — those are the isolated Electron run
(`docs/evidence/s4-ipc-2026-10-06/`), which used the real preloads and pages with recording handlers.

## What this will not test

A second trusted Mac claiming the session's side channel (S2b's refusal) — no second Mac exists; the
JVM test against the real `SessionRegistry` is the only evidence. A real network attacker. Any OEM but
Samsung.
