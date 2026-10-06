# Release Phase 2 — scoped hardening batches (proposals, not implemented)

> **Status: PROPOSALS.** Written 2026-10-06 with Phase 1 of `docs/release-tracker.md`. Nothing here is
> built. Each batch is sized to be approved, built and reviewed on its own, red-first. The pairing batch
> (S1) is its own draft: `docs/pairing-v2-proposal.md`. "Phase 2" in this file means the release
> tracker's phase 2 (pairing and privilege boundaries), **not** product Phase 2 in `CLAUDE.md`'s roadmap.

## Order, and why

1. ~~**S1 + S2b**~~ — **done in source 2026-10-06** (`docs/protocol.md` → Pairing (version 2); defects 182, 189).
2. ~~**S4**~~ — **done in source 2026-10-06** (defect 183; `docs/ipc-authorization.md`).
3. ~~**S7**~~ — **done in source 2026-10-06** (defect 185; `docs/protocol.md` → *Provenance*).
4. **S5** — belongs with Developer ID signing (release phase 4), proposed now so it is not designed in a
   hurry.
5. **Integrity inventory** — S8 and S9, small, independent.

---

## S4 — one bridge for every window (defect 183) · **done in source 2026-10-06**

Built as proposed, plus what building it found (`sendAll` broadcasting clipboard contents into other
windows, `fs-send` reading any path, `pairing-qr-render`). The matrix is `docs/ipc-authorization.md`;
the evidence `docs/evidence/s4-ipc-2026-10-06/`.

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

## S7 — any phone app can write the Mac's clipboard (defect 185, Medium) · **done in source 2026-10-06**

> **Built, with these decisions from the owner (2026-10-06):** offer by default; **no** auto-apply setting
> in this batch (item 3 below was not built); a native notification may announce an offer and carries no
> clipboard content; Restore stays. Two things the build added beyond this proposal: offers are bound to
> the control session and single-use, and Restore now refuses when something newer is on the clipboard.
> The contract is `docs/protocol.md` → *Provenance*, which wins where this text differs (e.g. the
> notification has **no** Copy action — a click only opens the pane). Kept below as the argument.

**Today, measured from the code.** `SendSelectionActivity` is exported for `PROCESS_TEXT` and
`SEND text/*` — it must be, to appear in other apps' selection toolbars and share sheets. Any app in the
foreground can fire an explicit intent at it with any `EXTRA_TEXT`; `ClipFeature.sendSelectedText` sends
it as `clip.push` with `source: "phone"` (the same value as an ordinary clipboard sync), and the Mac's
`ClipboardClient.receive` **writes it to the Mac clipboard on arrival** (`desktop/src/main/clipboard.ts`).
The only signal is a toast on the phone. A person who later presses ⌘V in Terminal pastes whatever the
other app chose. What already limits it: the displaced Mac clipboard is kept as a history entry that
Restore puts back; S4 (2026-10-06) does nothing here, because the push arrives over the authenticated
link, from the real phone.

### What changes

1. **Contract first.** `clip.push` gains `origin`, one of:
   - `clipboard` — the phone's own clipboard, read while Sidekick is in front (today's sync);
   - `selection` — text another app handed to `SendSelectionActivity` (toolbar or share sheet).

   The phone sets it; it is never derived from `package`/`referrer`, which are the sending app's to choose.
2. **The Mac applies only `origin: "clipboard"` automatically.** `selection` — and **an absent or unknown
   `origin`**, which is every push from a phone built before this change — is **offered**: a history
   entry marked *From <app> on your phone — not applied*, with **Copy**, and (when the window is not
   focused) a native notification with a **Copy** action. Nothing touches the Mac clipboard until a person
   acts on the Mac.
3. **A Settings switch** under Clipboard: *Apply text other phone apps send, automatically* — **off** by
   default. It changes step 2 for `selection` only; it never makes an unknown `origin` auto-apply.
4. **The phone's toast says what happens:** *Offered to your Mac — choose Copy there* (or *Sent to your
   Mac's clipboard* when the switch is on and the Mac reports it).

### Why this shape

- It keeps the useful flow (select text in any app → it appears on the Mac) and puts the person's
  confirmation on the side where the paste happens.
- Treating an absent `origin` as `selection` fails safe with older phones: the cost is one extra click,
  never an unasked write.
- **The wrong fixes:** checking `referrer`/`package` (sender-chosen); requiring a confirmation on the
  phone (the sending app is in front and can drive or overlay it); dropping the export (the feature
  disappears from every app's toolbar).

### Tests (red first)

- Mac: `clip.push {origin: "selection"}` leaves the clipboard untouched and creates one offered entry;
  **Copy** writes exactly that text and nothing else; an absent `origin` behaves like `selection`;
  `origin: "clipboard"` applies (control); the switch on applies `selection` but never an absent origin.
- Phone (JVM): `sendSelectedText` sets `origin: "selection"`; the foreground clipboard path sets
  `origin: "clipboard"`; a source scan that no other code path builds a `clip.push` without `origin`.
- Hardware (approved separately): select text in a browser on the phone → Send to Mac → the Mac shows
  the offer, its clipboard unchanged until Copy; then one ordinary in-app clipboard sync still applies.

### Decisions needed from you

1. Offer by default for `selection` (recommended), or apply by default with the switch the other way.
2. Whether the native notification is wanted for offers when the Mac window is not focused.
3. Whether the Restore affordance for applied entries stays as it is (recommended: yes).

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
