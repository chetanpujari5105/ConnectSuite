# Feature A — implementation plan (five slices)

> **Status: plan only. No production code exists for Feature A.** Written 2026-09-24 against the
> tree at `eb5ba6d`. The design is `docs/phase-7-share-proposal.md` rev 2; the evidence is
> `docs/testing.md` → *URI grant lifetime, emulator* and *private-staging proof on the SM-S938B*.
> Where this plan and the proposal differ, this plan says so in §0 and the proposal is corrected in
> slice 2, with the contract written first.
>
> **Each slice is a separate go-ahead.** Nothing below authorises starting slice 1.
>
> **Fixed, and not reopened by any slice:** Ask always; one file only; no batching, no resume, no
> auto-accept, no macOS notification, no cloud, no relay, no new port or listener, no silent overwrite.
> The Mac still connects out. Plain-text shares keep going to `SendSelectionActivity` → `clip.push`.

## 0 · Gaps found while planning — resolved here or flagged for a decision

Each of these was found by reading the tree, not recalled. **R** = resolved by this plan (the
resolution is in the slice named). **D** = needs your decision before that slice starts.

| # | Gap | | Resolution or question |
|---|---|---|---|
| G1 | **The Mac chooses the final name before the transfer and `rename`s onto it afterwards** (`files.ts:333` `freeName` → `bulk.ts:439` `fs.rename(part, destination)`). On macOS, `rename` **replaces** a file that appeared at that name in the meantime. The proposal's "never overwritten" is true of the check and false of the commit | R | Slice 4: commit with `fsp.link(part, destination)`, which fails with `EEXIST` rather than replacing, then `unlink(part)`; on `EEXIST`, re-pick with `freeName` and retry, with a cap. Both volumes are the same (`.part` lives beside the destination). The existing Files and Photos pulls have the same window; **fixing them is out of Feature A's scope** and is recorded as a candidate defect in slice 4, not fixed silently |
| G2 | **Two copies of `freeName`** (`main/files.ts:537`, `main/photos.ts:326`) | R | Slice 4 adds one exclusive-commit helper in `main/receiveCommit.ts` used by share only. The two existing copies are left alone (G1's scope note) |
| G3 | **The Mac's bulk pull has no stall timeout.** `bulk.ts` sets a connect timeout, then `setTimeout(0)` | R | Slice 3: a share-only idle timer of 30 s with no bytes, which fails the attempt as `interrupted`. Files and Photos are unchanged |
| G4 | **The Mac pull resumes from an offset the phone acks.** Share must never resume | R | Slice 3: the phone always acks `offset: 0` for a `share:` root and refuses a non-zero bulk-header offset. The Mac deletes any stale `.part` for the offer before each attempt |
| G5 | **Where a `share:` root is resolved.** Putting it into `FsRoots` would make it listable, stat-able and writable through every `fs.*` verb | R | Slice 3: `FsRoots` never learns about share roots. `FsFeature` checks the `share:` prefix **first** in every verb: `fs.transfer.begin` with `direction: pull, id: "0"` is delegated to `ShareFeature`, and every other verb is refused `NOT_FOUND` with `feature: "share"`. One test per refused verb |
| G6 | **The Mac posts no notification, so an offer can sit unseen for its whole 10 minutes** if the window is hidden or minimised. `docs/phase-7-state.md` §5 calls the Mac never notifying anyone the thing that makes people stop using it | **D** | Options: **(a)** in-window card only; the phone says *"Waiting for you to accept on <Mac>"* and the offer expires honestly (proposal as written). **(b)** also bring the Sidekick window forward on an offer. **(c)** also bounce the dock icon once. (b) and (c) are not macOS notifications, but both are the app interrupting you. **Recommendation: (a) for v1**, because the alternatives are the notification decision under a different name |
| G7 | **The name sanitiser is specified twice**, phone-side and Mac-side (proposal §5). Two implementations drift (the "second expression of the rule" failure in `CLAUDE.md`) | R | One fixture file, `docs/fixtures/share-names.json` (input → expected), read by **both** the Kotlin and the TypeScript tests. Neither side's test holds its own copy of the cases |
| G8 | **Where the offer state machine lives on the phone** | R | `sync-module/.../v2/ShareOffer.kt`, a pure transition function (the defect-67 rule), owned by a new `ShareFeature` installed in `ConnectSuiteApp` like every other feature. The activity only stages and hands over |
| G9 | **Where the startup sweep runs in production.** The proof used a debug `ContentProvider` | R | Slice 1: `ConnectSuiteApp.onCreate`, synchronously, before `LinkController.get`. Application creation precedes every activity and service, which is the property the provider was used for. The debug provider is deleted in the same slice, so there is one sweeper per directory |
| G10 | **The debug probe's 10-minute self-expiry deleted evidence mid-run** | R | Production retention follows the proposal (offer expiry, Retry window, terminal-state deletion). The debug probe is moved onto the production `ShareStaging` and **its own expiry is removed**: a probe does not need to delete what it staged, and the startup sweep bounds it |
| G11 | **`docs/protocol.md` must change before any `MessageType` constant does** (`check-protocol-spec.mjs` runs on every commit, and the repo rule is contract first) | **D** | Slice 2 edits `docs/protocol.md`. Earlier instructions forbade touching it; **slice 2's approval has to include it explicitly** |
| G12 | **Mac rebuild and relaunch.** Slices 2–5 change the Electron app, and every check needs a rebuilt Mac app (the standing memory rule is rebuild, then relaunch with both flags). An earlier instruction said *do not replace, reset, unpair or reinstall any Mac app* | **D** | Rebuilding and relaunching the **dev** Electron app from this tree, with the pairing store untouched, is what slices 2–5 need. No reinstall and no packaged app. Please confirm that is allowed when approving slice 2 |
| G13 | **The offer card's writer.** `CLAUDE.md`: a surface with one job gets one writer | R | Offer state lives in the main process (`shared/shareOffer.ts`, pure, tested) and reaches the renderer over one IPC channel. The card is a projection of that state; the status island shows only an active receive (a duration) |
| G14 | **Physical rotation was never tested**; `Activity.recreate()` was | R | Slice 5 includes one physical rotation **if you turn auto-rotate on yourself** for that run. If not, the run records "recreate only" again rather than calling rotation proven |
| G15 | **Process-death cleanup was never seen on a device** | **D** | Slice 5 can observe it only if the process dies. Options: **(a)** leave it JVM-proven and say so. **(b)** you allow one `run-as … kill` of Sidekick's process on the Samsung, with `LinkService` restarted by name afterwards. Force-stop and `am start -S` stay forbidden either way. **Recommendation: (b), once**, because the startup sweep is the only thing bounding a crash's leftovers |
| G16 | **`scripts/link-up.sh` fails with two devices attached** | flag | Not in Feature A's scope. Slices 1 and 5 use the pinned reads recorded in `docs/testing.md` instead. A one-line fix is a separate task |
| G17 | **A share while another is live.** The proposal refuses it | R | Kept. Slice 1 enforces it on the phone (one staging entry at a time). Slice 2's offer validation keeps it on the Mac (one live offer per session; a second one is declined `busy`), a reason added to the enum in slice 2 |

### Decisions taken (2026-09-24, by the owner)

These replace the **D** rows above. Where a row and this block differ, this block wins.

| # | Decision |
|---|---|
| **G6** | **The offer card is shown inside the app window only, in v1.** No macOS notification, and no window-raising or dock bounce. An offer nobody saw **expires honestly**: the state and every sentence say *expired*, and nothing implies the user declined it |
| **G11** | **A narrowly scoped `docs/protocol.md` edit is permitted with slice 2's separate approval**, and not in slice 1 |
| **G12** | **Rebuilding and relaunching the development Mac app is permitted when an approved slice needs it**, provided pairing and trust are preserved. No reinstall and no reset of the packaged Mac app. Slice 1 needed none |
| **G15** | **Sidekick is not killed or force-stopped on the Samsung.** Process-death cleanup stays JVM-tested for now; an emulator-only live test may be considered later. Slice 5 records this row as *not observed on hardware*, with the reason |

## Slice 1 — phone: production one-file intake, private staging, cleanup

**Scope.** `ShareToMacActivity` receives `ACTION_SEND` with one `EXTRA_STREAM`, and stages the file
while it holds the grant. It shows *Preparing…*, then a ready state. **Send stays disabled with the
line "Sending to your Mac isn't available yet"**: there is no offer in this slice, so a Send button
that did anything would be a lie. Cancel and every terminal path delete the staged copy.

**Files likely to change:**

| File | Change |
|---|---|
| `sync-module/src/main/java/com/chetan/connectsuite/sync/v2/ShareStaging.kt` | **new**: `ShareStaging` moved from the debug source set, unchanged in its rules |
| `sync-module/src/main/java/com/chetan/connectsuite/sync/v2/ShareNames.kt` | **new**: display name, MIME and sanitiser (proposal §5), pure |
| `app/src/main/java/com/chetan/connectsuite/ShareToMacActivity.kt` + `ShareToMacModel.kt` | **new**: intake, the copy held across recreation, the re-open-after-recreation check (a failure cancels) |
| `app/src/main/java/com/chetan/connectsuite/ShareToMacCopy.kt` | **new**: every sentence the sheet shows, enumerable (the `OnboardingCopy` pattern) |
| `app/src/main/AndroidManifest.xml` | the activity and its SEND filter: `application/*`, `image/*`, `video/*`, `audio/*`, `font/*`, `model/*`; **no `text/*`, no `*/*`, no `SEND_MULTIPLE`** |
| `app/src/main/java/com/chetan/connectsuite/ConnectSuiteApp.kt` | the synchronous startup sweep, first thing after `LinkLog.init` |
| `app/src/debug/…/ShareStaging.kt`, `ShareStagingSweepProvider` + its manifest entry | **deleted**; the debug probe calls the production `ShareStaging`, and its self-expiry goes |
| `docs/fixtures/share-names.json` | **new**: the sanitiser cases (G7) |

**Tests (each shown red against the defect it names):**

- `ShareStagingTest` moves with the code; all 22 stay, same mutations.
- `ShareNamesTest`: every row of `share-names.json`, plus control characters, `/`, `:`, a leading
  `.`, a 255-byte cap that keeps the extension, empty → `Shared file`, and extension from MIME.
- `ShareManifestTest` (`app/src/test`, parses the merged `AndroidManifest.xml` as XML):
  `SendSelectionActivity` still owns `SEND text/plain`; `ShareToMacActivity` has no `text/*`, no
  `*/*`, and no `SEND_MULTIPLE`. Red if `text/*` is added.
- `ShareToMacCopyTest`: no sentence claims a send happened; no package id in any sentence.
- Refusals on the phone: `file://`, a directory MIME, no stream, and two `ClipData` items → one
  sentence each, no staging.

**Device effects.** An install on the Samsung (pinned, same signing certificate, checked as in
`b3eca15`) adds a new entry, **"Send to Mac"**, to your share sheet for files. It does nothing but
stage and discard. `LinkService` is restarted by name after the install. Synthetic files only.

**Stop condition.** Android tests green, results written this run; guards green. On the Samsung:
one Gallery share and one My Files share each reach *ready* with matching digests; Cancel leaves
`share-staging/` empty; a plain-text share from Chrome still lists only the clipboard entry. Then
stop and report. No `MessageType` change, no Mac change.

## Slice 2 — protocol: negotiation and the offer, answered before any byte moves

**Scope.** The `ext` field in `hello`/`hello.ack`, the capability `share`, and `share.offer`,
`share.respond` and `share.cancel`, **with no bytes and no Mac UI yet.** The Mac validates an offer
and, in this slice, **declines it automatically with `reason: "not supported yet"`** (a real decline
the phone renders, not a silent drop). So the phone's Send becomes real, and every non-transfer path
is exercised end to end.

**Files likely to change:**

| File | Change |
|---|---|
| `docs/protocol.md` | **first**: `ext` and its parsing rules 1–6, the `share` capability, `share.offer`, `share.respond`, `share.cancel`, `share.saved` (specified now, used in slice 3), the reason enum (adding `busy` and `not supported yet`) (**G11**) |
| `core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt` | the `SHARE_*` constants, and `ext` on the hello-ack builder |
| `core/src/main/java/com/chetan/connectsuite/core/link/ControlSession.kt` | read the Mac's `ext` from `hello` (rules 1–6), advertise the phone's in `hello.ack`, and keep the negotiated result on the session |
| `core/src/main/java/com/chetan/connectsuite/core/link/Extensions.kt` | **new**, pure: parse and negotiate |
| `core/src/main/java/com/chetan/connectsuite/core/link/CapabilityContract.kt` | the `share` contract: `share.respond`, `share.saved`, `share.cancel` plus the bulk channel |
| `sync-module/.../v2/ShareFeature.kt`, `ShareOffer.kt` | **new**: the offer registry and the pure state machine (proposal §5), the expiry timer, and `forgetSession` dropping offers **and deleting staged copies** |
| `app/…/ShareToMacActivity.kt`, `ShareToMacCopy.kt` | Send enabled when `share.file` is negotiated; the not-connected, needs-update, waiting, declined, expired and cancelled states |
| `desktop/src/shared/protocol.ts` | the constants and payload types |
| `desktop/src/shared/extensions.ts` + test | **new**, the same rules 1–6 against the same fixtures |
| `desktop/src/shared/shareOffer.ts` + test | **new**, pure: offer validation and the Mac-side state |
| `desktop/src/main/link.ts` | send `ext` in `hello`; read it from `hello.ack` |
| `desktop/src/main/share.ts` | **new**: receives `share.offer`, validates, and (this slice only) auto-declines |
| `desktop/src/main/main.ts` | route `share.offer` and `share.cancel` to `share.ts` |
| `docs/fixtures/ext-negotiation.json` | **new**: rules 1–6 as cases, read by both suites |

**Tests.** `ext` parsing, with every malformed shape, absence and `min()`, on both sides from one
fixture. Offer validation, one test per decline reason. `ShareOffer.after`: answer-once, expiry,
cancel from every state, and every terminal state carrying delete-staged. Old-peer cases: a Mac
`hello` without `ext` means the phone sends no offer and shows the update sentence; a phone
`hello.ack` without `ext` means the Mac treats an offer as a violation and declines `not negotiated`.
`check-protocol-spec`: every new type opens a heading or paragraph in `docs/protocol.md`.

**Device effects.** A phone install as in slice 1, and a **dev Electron rebuild and relaunch (G12)**.
The link reconnects once for each. Pairing is untouched: the handshake gains an optional field that
an old peer ignores.

**Stop condition.** Both suites and all guards green. On hardware: an offer reaches the Mac, is
validated, and is declined; the phone renders the decline and deletes the staged copy. A 10-minute
wait expires correctly on both sides. The phone's *update your Mac* path is shown against a Mac build
with `ext` stripped. No bytes cross; `fs.transfer.begin` is never sent for a `share:` root. Stop.

## Slice 3 — transfer: one file, receiver-confirmed save, checksum, cancel, retry from zero

**Scope.** After Accept (still sent automatically only by a debug switch until slice 4 adds the
button), the Mac pulls `share:<offerId>` / `id "0"` through `fs.transfer.begin` and `bulk.pull`. The
phone streams **only the staged file**. The Mac verifies the length and SHA-256, commits, and replies
`share.saved`. The phone says *Saved* only on `share.saved ok:true`.

**Files likely to change:**

| File | Change |
|---|---|
| `sync-module/.../v2/FsFeature.kt` | the `share:` prefix checked first in every verb (**G5**): begin delegated, everything else `NOT_FOUND` with `feature: share` |
| `sync-module/.../v2/BulkTransfers.kt` | `registerSharePull(stagedFile, size, sha256, sessionId)`; a non-zero offset refused for share (**G4**); the phone-side digest compared against the staged `sha256` while streaming (`staging-lost` on a mismatch) |
| `sync-module/.../v2/ShareFeature.kt`, `ShareOffer.kt` | accepted → sending → saved or failed; the Retry window `min(failedAt + 5 min, expiresAtMs)`; the length check before each attempt |
| `desktop/src/main/share.ts` | accept (debug switch), pull, stale `.part` deletion before each attempt (**G4**), `share.saved`, cancel, retry |
| `desktop/src/main/bulk.ts` | an **opt-in** idle timer (30 s, **G3**), used by share only; Files and Photos are unchanged |

**Tests.** `FsFeature`: a `share:` root refused for `fs.list`, `fs.stat`, `fs.thumb`, `fs.mkdir`,
`fs.delete`, a push begin, a pull with `id` ≠ `"0"`, a begin before Accept, a begin after expiry, and
a non-zero offset (**one test per verb**). A begin from another session is refused (the
`Pending.sessionId` rule). The phone digest mismatch gives `staging-lost`; a Mac checksum mismatch
gives `.failed`, `ok:false checksum`, Retry allowed, and the staged copy kept. The idle timer fires at
30 s and not at 29 s. **Saved only on receipt of `share.saved`**: a test where the phone finishes
writing bytes and no `share.saved` arrives, asserting the phone state is still `sending`, not `saved`.

**Device effects.** Installs and relaunches as in slice 2. The first bytes cross, synthetic only,
into your Mac's receive folder (`Downloads` unless you have changed it). Files named
`sidekick-share-test-*` will appear there.

**Stop condition.** A 100 KB and a 230 KB synthetic file each arrive with matching SHA-256 on the
Mac. A cancel from each side leaves no `.part` and no staged copy. An injected corruption produces
`.failed` and a clean retry. A stall produces `interrupted` then a retry from 0, with the retry's bulk
header shown carrying `offset: 0`. Stop.

## Slice 4 — Mac: the Accept/Decline card, destination availability, collision-safe commit

**Scope.** The incoming-file card (proposal §7): phone name cross-checked against the session, the
name as it will be saved, MIME, exact bytes, the receive folder's full path; **Accept** and
**Decline**, no default button, and Return does not accept. The debug auto-accept switch from slice 3
is deleted. The destination and free space are checked at offer time and again at Accept. Commit is
exclusive (**G1**).

**Files likely to change:**

| File | Change |
|---|---|
| `desktop/src/main/receiveCommit.ts` + test | **new**: exclusive commit, `link` then `unlink`, with `EEXIST` → re-pick (**G1, G2**) |
| `desktop/src/main/share.ts` | the checks at offer and Accept (`ensureReceiveFolder`, `statfs` free ≥ size); commit through `receiveCommit` |
| `desktop/src/renderer/shareCard.ts` + `shareCardView.test.ts` | **new**: the card, a projection of `shareOffer` state (**G13**) |
| `desktop/src/renderer/index.html`, `styles.css` (card body), `shell.css` (placement only) | one selector, one stylesheet |
| `desktop/src/main/main.ts`, preload | one IPC channel for offer state and one for the decision |
| `desktop/src/main/activity.ts` | a timestamped result line in the Activity pane |

**Tests.** `receiveCommit`: a file created at the destination **between** the name choice and the
commit is never replaced (red with `rename`); `EEXIST` re-picks `(2)`; the cap is honoured. The card:
no Accept before the offer validates; Return does nothing; Decline sends `share.respond decline user`.
Folder unavailable or not enough space declines with its reason before any socket opens. Renderer
view coverage (`check-renderer-views.mjs`), the colour-token and contrast checks, and
`check-renderer-scripts.mjs` for a classic-script file with no `export`.

**Candidate defect, recorded not fixed:** G1's replace window exists in the Files and Photos pulls
too. Slice 4 files it in `docs/defects.md` with a fix direction and leaves those paths unchanged.

**Device effects.** A Mac relaunch. The card is seen on screen. Accept and Decline are clicked by
accessibility name (`--force-renderer-accessibility`), never by coordinates.

**Stop condition.** Accept saves and Decline saves nothing, both on hardware with the synthetic
files. A pre-created same-name file on the Mac stays byte-identical, and the share lands as `(2)`.
The card is read through `scripts/probe.mjs` with a control. Stop.

## Slice 5 — end to end: synthetic first, then Samsung Gallery and My Files

**Scope.** The proposal §9 matrices (staging S1–S15, hardware 1–15) run against the finished feature.
No new code except fixes, each red-first.

**Order.** JVM and Mac suites. Then the emulator only if it has room: it is at 417 MB free and
refused a 94 MB install, so it may simply be skipped and recorded as skipped. Then the SM-S938B:
Gallery (`media`) and My Files (`com.sec.android.app.myfiles.FileProvider`), each through Accept,
Decline, expiry, cancel on each side, retry after an injected fault, a collision, and a Mac
disconnect before Accept and during sending.

**Recorded with their limits:** the Gallery grant question stays confounded by `READ_MEDIA_IMAGES`
unless you choose otherwise; physical rotation only if you turn auto-rotate on (**G14**);
process-death cleanup per **G15**; and the §4 Samsung grant-lifetime repeat (+1/+30/+120 s) with the
existing `ShareGrantProbeActivity`, My Files being the row that can answer it.

**Device effects.** Synthetic files only, in the existing `SidekickShareTest` folders and the Mac's
receive folder. A log audit at the end: no content URI, staging path or synthetic file name in
`link.log`, with `offerId` lines as the positive control.

**Stop condition.** Every matrix row is recorded in `docs/testing.md` as pass, fail or not run with
its reason. Nothing is released, packaged or pushed.

## Approvals needed, in order

1. **Slice 1**: approved and done, `912f0da` (evidence in `docs/testing.md` → *Feature A slice 1*).
2. **G6, G11, G12, G15**: decided, see *Decisions taken* above.
3. **Slice 2**: approved 2026-09-24, with conditions beyond this plan's slice-2 text. **Offers only
   from a clearly marked debug trigger** with a synthetic staged file, never from an ordinary user
   share. **The Mac returns an explicit "not available in this version" decline**, a protocol stub
   rather than user approval, with no Accept card of any kind. **Send stays disabled**, and nothing
   claims a send or a save.
4. Slices 3–5: each is a separate approval.
