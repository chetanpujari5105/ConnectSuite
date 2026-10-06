# S7 — clipboard provenance (defect 185), 2026-10-06

Code and isolated tests only. No app launched, no phone, no real clipboard (the Mac tests use a
pasteboard double; every `writeText` is recorded).

## Red first

| Side | File | What it showed |
|---|---|---|
| Mac | `red-before-fix.txt` | `clip.push {origin:"selection"}` and every push with no/unknown `origin` **wrote the clipboard on arrival**; control (`origin:"clipboard"`) green |
| Phone | `phone-red-before-fix.txt` | source guard: no route stamped an origin (2 of 3 red; the third — `sendSelectedText` has no origin parameter — already held) |

## Positive and negative controls

| Case | Result |
|---|---|
| `origin: "clipboard"` (genuine focus sync) | applied, Restore available — **positive control** |
| `selection`, absent, `"Clipboard"`, `"CLIPBOARD"`, `"clipboard "`, `"trusted"`, `""`, `1`, `null`, object, array | **0 writes** each |
| Copy | writes exactly that offer's text, once; a second Copy and an unknown id write nothing |
| Dismiss / expiry (+10 min) / disconnect | 0 writes; Copy afterwards refused; banner withdrawn |
| Other session / no session | refused; own session (control) allowed |
| 7 offers | 5 pending, two oldest withdrawn; a 64 KB + 1 text neither offered nor announced |
| Copy → watcher | refused as **echo** (the reason asserted, not just `ok:false`, since a linkless send also fails) |
| Restore after something newer was copied | refused, 0 writes; unknown id refused |
| Logs | no offer text, Mac clipboard text, app name or package in any captured line; control: the offer and refusal lines were captured |
| Banner | fixed copy; not posted while focused; click opens pane only and withdraws; the notifier has no copy method |
| Pane | Copy/Dismiss by offer id, never `clip-use`; no Open on an offered link; refusals said as problems; Restore by id |
| IPC (real `main.ts` handlers) | float/receive/replaced window refused; text-as-payload, missing id, extra field refused; stale id reaches the handler and writes nothing |
| Phone exported activity | reads exactly four extras by name; names no origin/route; passes `(applicationContext, text, fromPackage)` |

## Mutations

`mac-mutations.txt` — 13, all red with the catching test named, plus an unmutated control.
`phone-mutations.txt` — 5, all red with each results file's age and Gradle's exit beside it. **P4 was
first GREEN**: the extras guard matched identifier arguments only, so `getStringExtra("…ORIGIN")` with a
string literal was invisible. Widened, re-run red; the green run is kept above the red one.
