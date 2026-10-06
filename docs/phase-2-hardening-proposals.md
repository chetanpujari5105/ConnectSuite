# Release Phase 2 — scoped hardening batches (proposals, not implemented)

> **Status: PROPOSALS.** Written 2026-10-06 with Phase 1 of `docs/release-tracker.md`. Nothing here is
> built. Each batch is sized to be approved, built and reviewed on its own, red-first. The pairing batch
> (S1) is its own draft: `docs/pairing-v2-proposal.md`. "Phase 2" in this file means the release
> tracker's phase 2 (pairing and privilege boundaries), **not** product Phase 2 in `CLAUDE.md`'s roadmap.

## Order, and why

1. ~~**S1 + S2b**~~ — **done in source 2026-10-06** (`docs/protocol.md` → Pairing (version 2); defects 182, 189).
2. **S4** — the privilege boundary inside the Mac app; makes every future renderer bug smaller.
3. **S7** — a product decision with a small code change.
4. **S5** — belongs with Developer ID signing (release phase 4), proposed now so it is not designed in a
   hurry.
5. **Integrity inventory** — S8 and S9, small, independent.

---

## S4 — one bridge for every window, and IPC that trusts its caller (defect 183, Medium)

**Today.** `desktop/src/preload.ts` exposes one `window.connect` with 166 `ipcRenderer` uses to all
three windows — main, floating mirror, share receive window (which draws phone-supplied file names).
Of 129 `ipcMain` handlers in `main.ts`, only the share-window group (`main.ts:1297-1373`) checks
`event.sender`. Payloads are mostly trusted as typed; `fs-drag` (`main.ts:2637`) will start a drag of
**any** existing path the renderer names.

**Batch.**

1. **Three preloads, one per window**, each exposing only that window's calls. The float window needs
   the mirror stream, input and float controls; the share window needs the `share-*` calls; everything
   else stays main-only. Generated from one table so the three cannot drift: `preloadApi.ts` declares
   `{ channel, windows: ['main' | 'float' | 'share'] }`, and a test asserts each preload exposes exactly
   its rows.
2. **A sender guard on every privileged handler**: `fromWindow(event, 'main')` checks
   `event.senderFrame` is the top frame of that window's `webContents` and that its URL passes
   `windowGuard.navigationDecision`. Handlers registered through one helper so a new one cannot be
   added unguarded; a test enumerates `ipcMain`'s registered channels against the table.
3. **Payload validation at the boundary** for the handlers that act on the outside world: `fs-drag`
   (paths must be inside the receive folder, the preview cache, or a path this process produced in
   this session), `sms-send`, `call-dial`, `clip-use`, `clip-open` (already re-decides its scheme),
   `media-*`, `fs-*`, `set-*-address`, `downloads-*`. Unknown fields refused, types checked, lengths
   capped.

**Red-first tests.** The share window's preload must not expose `sms-send` (red today); a handler
invoked from the float window's `webContents` for a main-only channel is refused (red today);
`fs-drag` with `/etc/hosts` is refused (red today).

**The wrong fix.** A sender check alone. Every privileged call legitimately comes from the main
window, so a sender check stops nothing a compromised main window does — the per-window preloads and
the payload rules are the parts that shrink the blast radius.

**Not in this batch.** A CSP change (already `default-src 'self'`, no inline script), and moving
renderer code to a framework.

---

## S5 — release hardening of the Mac package (defect 184, Medium)

**Today.** `electron-builder.yml` flips no Electron fuses, so RunAsNode, `NODE_OPTIONS` and `--inspect`
are honoured by a packaged build, and ASAR integrity is off. `build/entitlements.mac.plist` grants
`allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables` and
`disable-library-validation` (the last documented as needed only while ad-hoc signed). Chromium's
`--remote-debugging-port` is honoured by packaged builds.

**Batch (with Developer ID signing, release phase 4).**

1. `@electron/fuses` in `build/adhoc-sign.mjs`'s `afterPack`, **before** signing: `RunAsNode` off,
   `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off,
   `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on,
   `EnableCookieEncryption` on. **Adding `@electron/fuses` is a new dev dependency — it needs your
   approval and an install, which this phase did not do.**
2. Refuse `--remote-debugging-port` and `--inspect*` in a packaged build at startup (exit with a log
   line), since no fuse covers Chromium switches.
3. With the Developer ID: delete `disable-library-validation`; test whether V8 still needs
   `allow-dyld-environment-variables` (Electron documents only `allow-jit` as required) and delete it if
   not.
4. A launch test per change: the packaged app starts, `ELECTRON_RUN_AS_NODE=1 Sidekick -e …` does not
   execute, `--remote-debugging-port=9222` does not open a port. Each verified on a scratch package,
   never the installed app.

**What it does not do.** It does not notarize or sign — that needs the Apple Developer Program.

---

## S7 — any phone app can write the Mac's clipboard (defect 185, Medium)

**Today.** `SendSelectionActivity` is exported for `PROCESS_TEXT` and `SEND text/*` (it must be, to
appear in other apps' menus). Any foreground app can fire an explicit intent at it; the text goes out
as `clip.push`; the Mac **applies** it on arrival (`clipboard.ts:141-157`). Only a toast on the phone
tells the user. Mitigation already present: the displaced Mac clipboard is kept and Restore puts it
back.

**Batch.**

1. The phone marks pushes from this activity `source: "selection"` (the in-app path stays `"app"`).
   Contract first: `clip.push.source`, optional, unknown values treated as `"selection"`.
2. The Mac **offers** a selection push rather than applying it: a native notification *"Text from
   <app name> on your phone — Copy"*, and an entry in Clipboard history with **Copy**. Nothing touches
   the Mac's clipboard until the person acts.
3. A Settings switch *"Apply text sent from other phone apps automatically"*, **off** by default, for
   the owner who wants today's behaviour back.

**The wrong fix.** Checking `referrer` or the calling package: both are the sender's to choose.

**Red-first.** A `clip.push` with `source: "selection"` must leave the Mac clipboard untouched (red
today).

**Decision needed from you:** whether a share-sheet/selection send from inside a trusted app (the most
common real use) is worth one extra click on the Mac. The proposal says yes; the switch is the escape.

---

## Integrity and quarantine — the remaining inventory from the audit

| ID | Finding | Proposal | Size |
|---|---|---|---|
| **S8** (186) | Received files carry no `com.apple.quarantine`, so Gatekeeper never assesses a script or app pulled from the phone | Set the attribute on publish in `shareDestination.publishExclusive` and the pull publish path (agent `Sidekick`, the phone's name as origin), or `LSFileQuarantineEnabled` in `extendInfo`; test that a published file carries it | small |
| **S9** (187) | Pulls above 64 MiB carry no digest in a release build (`fs.blocks` off; phone pre-hash ceiling 64 MiB) | Show "unverified" wherever such a pull is listed; keep `FS_BLOCKS_RELEASE` a separate decision (release phase 3). With 178 fixed the network can no longer substitute bytes; residual risk is a phone-side read error | small |
| S2b (189) | Phone accepted a side-channel token from any trusted Mac | **Fixed in source 2026-10-06** (`SideChannelAuth`) | done |
| S10 | Manual and Tailscale addresses stored unvalidated | Validate as IP or hostname with a sentence on refusal (UX, not a hole) | small |
| S11a | File names appear in phone `fs` log lines | Owner decision: keep (debuggable) or ordinal them like 179 | decision |
| S11b | `activity.jsonl.pre-migration` and the ConnectSuite folder's `activity.jsonl` may still hold call numbers outside the pending rewrite | Owner decision, after F2; **never deleted without asking** | decision |
| — | The pending one-time Activity call-data rewrite runs at the next Mac launch and keeps no backup | Already reviewed (overnight E2); plan F1–F2 | approval |

Every row above is open and is in `docs/defects.md` (186, 187, 189) or the release tracker.
