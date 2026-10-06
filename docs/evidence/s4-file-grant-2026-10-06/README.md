# S4 follow-up — the file-grant boundary (defect 190), 2026-10-06

Synthetic temp files only (`mkdtemp` under the system temp dir). No app launch, no real drop, no phone.

## Original result — the sequence succeeded

`red-before-fix.txt`: the production `main.ts` handlers, loaded with Electron stubbed
(`desktop/src/main/ipcWiring.test.ts`). A main-window sender with a valid page sent
`fs-grant-source` with an arbitrary synthetic path, then `fs-send` with it. The read observer
(`fs.createReadStream`, which `digestOf` and the push use) recorded the path, and the log line
`synthetic-secret.txt: hashed 34 bytes … before sending` shows the whole file was read. The push stopped
only at *"The phone is not connected"* — the harness has no phone; nothing else stood in the way.

## Fix

`desktop/src/main/sourceGrants.ts` + `fs-confirm-drop` in `main.ts`. See `docs/defects.md` → 190.

## Controls, positive and negative (`ipcWiring.test.ts`, `sourceGrants.test.ts`)

| Case | Result |
|---|---|
| Valid selection (native open panel) | read — **positive control that the observer can see a read** |
| Confirmed drop (sheet → Send) | read |
| Forged drop (raw `fs-confirm-drop`, sheet → Cancel) | refused, **0 opens**; sheet named the file; Cancel is default |
| Verbatim original sequence (raw `fs-grant-source`) | no listener; **0 opens** |
| Expired grant (+1 h + 1 ms) | refused before any open; grant removed |
| Different file at the chosen path | refused (`changed`), 0 opens |
| Replaced main window | new window refused (`other-window`); old window refused by the guard; owner still allowed (control) |
| Float / receive window | refused; no sheet drawn |
| Second sheet while one is open | `busy` |
| A file hidden as the 13th of a long drop | sheet lists every source folder with its count |

## Mutations — `mutations.txt`

Nine, all red with the catching test named. Two instrument faults are recorded there rather than
hidden: a first run passed both test files as one zsh word, so every mutation "failed" without
running (discarded); the first M3 was malformed by operator precedence and left the check alive
(discarded, corrected M3 red); the first M8 hung rather than failing (the test now has a 3 s timeout).
