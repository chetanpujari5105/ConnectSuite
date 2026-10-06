# S7 (defect 185) and the S4 drop sheet (defect 190) — hardware verification proposal (NOT approved, NOT run)

> **Status: a proposal for separate approval.** Written 2026-10-06 after S7 and the S4 follow-up were built
> and tested in code only. **Nothing here has been run.** Every step that changes something on your
> devices is approved on its own; approving one approves nothing after it. Every phone write goes through
> `scripts/adb-pinned.sh` after `scripts/target-device.sh` names the SM-S938B. Use **synthetic text and
> files made for the run**, never personal ones; the Mac clipboard is saved first and put back last.

## What the code-only tests could not prove

- That the real `SendSelectionActivity`, reached from another app's selection toolbar and share sheet,
  produces a push with `origin: "selection"` on the wire (the JVM test reads the source and the payload
  builder, not a running activity).
- That a real arrival on the real Mac leaves `NSPasteboard` untouched (the Mac tests use a pasteboard
  double).
- That the native banner appears as described, with no text, and that clicking it opens the pane only.
- That the native drop sheet (defect 190) appears as a sheet on the real window, with Cancel as default.
- Mixed versions on hardware: only one phone and one Mac exist, so old-phone/new-Mac is reasoned, not run.

## Preconditions (owner decisions)

1. Building and relaunching the Mac app runs the pending one-time Activity call-data rewrite
   (`docs/overnight-2026-10-06.md` E2) — approve that separately, or keep F1's private backup first.
2. Installing the phone build with `adb install -r` leaves the phone serverless until `MainActivity` is
   started by name (`CLAUDE.md`); `scripts/link-up.sh` confirms.
3. These steps write the **Mac clipboard** (V5, V6) and send a few synthetic strings over the link. They
   do not touch pairing, calls, SMS, Bluetooth or permissions.

## Steps

| # | What | Changes | Pass criterion (with its control) |
|---|---|---|---|
| V0 | Save the Mac clipboard: `pbpaste > ~/.s7-run/before.txt` (mode 0600); note `pbpaste \| shasum` | a private file | Control for V7: the hash is recorded |
| V1 | Build and relaunch the Mac app (quit by menu; relaunch with `--force-renderer-accessibility --remote-debugging-port=9222`) | Mac app (and the E2 rewrite) | The Clipboard pane's standing copy says *"Text another app on the phone sends with Send to Mac is only offered"* (read over CDP by element) |
| V2 | Install the phone build; start `MainActivity` by name; `scripts/link-up.sh` | phone app | Three OKs |
| V3 | **Selection → offer.** Set the Mac clipboard to a synthetic marker (`printf S7-MARKER-A \| pbcopy`). On the phone, in Chrome, select a synthetic string (`S7-OFFER-1`, typed into a page you control or a search box) → **Send to Mac** | one push | Phone toast: *"Sent to your Mac — choose Copy there"*. Phone log: `clip.push → Mac via selection (origin selection)`. Mac log: `Offered an arriving entry (origin selection): 10 bytes, NOT applied`. **`pbpaste` still prints `S7-MARKER-A`.** The pane shows an **OFFER** row with exactly **Copy** and **Dismiss** (CDP, buttons counted by element). Control: the same `pbpaste` prints the new value after V5 |
| V4 | **Banner, unfocused.** Focus another app on the Mac, repeat V3 with `S7-OFFER-2`; then click the banner | none beyond the push | The banner reads *"Text offered from your phone"* / *"Open Sidekick to review it. Nothing was copied."* — no text, no app name; **`pbpaste` still `S7-MARKER-A` after the click**; the window comes forward on Clipboard; the Mac log has `offer notification clicked — opened the Clipboard pane, nothing copied` |
| V5 | **Copy.** Press **Copy** on `S7-OFFER-2` (by name over CDP) | Mac clipboard | `pbpaste` prints `S7-OFFER-2`; the pane shows a displaced row with **Restore** and no text. Press Copy on the same row again (if still drawn) or replay the call: refused, `pbpaste` unchanged |
| V6 | **Restore guard.** `printf S7-MARKER-B \| pbcopy`, then press **Restore** | none (refused) | Refused with *"Your clipboard has changed since…"*; `pbpaste` still `S7-MARKER-B`. Then copy `S7-OFFER-2` back, press Restore: `pbpaste` prints `S7-MARKER-A` (control: Restore works when nothing newer is there) |
| V7 | **Dismiss / disconnect.** Send `S7-OFFER-3`, press **Dismiss**; send `S7-OFFER-4`, then Disconnect from the Mac | none | `pbpaste` unchanged across both; the banner (if any) is gone; Copy no longer offered |
| V8 | **The documented sync still applies.** On the phone, copy `S7-SYNC-1` in any app, then bring Sidekick to the front | Mac clipboard | Phone log `via focus (origin clipboard)`; `pbpaste` prints `S7-SYNC-1` with no click; Restore offered |
| V9 | **Logs carry no text.** `grep -c 'S7-'` over the Mac's `logs/sidekick.log` (and `.1`) in the app's userData folder, and the phone's `files/logs/link.log` read via `run-as` | nothing | **0** on both. Control: the same grep for `Offered an arriving entry` returns ≥ 3 on the Mac — the log was read |
| V10 | **Drop sheet (defect 190).** Make `~/.s7-run/drop-me.txt`; drag it from Finder onto Files → the drop tile | none (Cancel), then one push | A sheet on the window names `~/.s7-run/drop-me.txt`; **Return cancels**; nothing sent (phone log has no push). Drag again → **Send** → one push, verified by the phone's digest |
| V11 | Restore the Mac clipboard: `pbcopy < ~/.s7-run/before.txt`; compare the hash; delete `~/.s7-run` | Mac clipboard back | Hash equals V0's |

## What would stay unproven after it

- Old phone → new Mac on hardware (no old build installed side by side); reasoned in `docs/protocol.md`.
- A second Android skin's selection toolbar.
- An adversarial app firing an explicit intent with forged extras: the JVM source guard covers the code;
  doing it on the device needs a test APK, which is a separate install and a separate approval.
