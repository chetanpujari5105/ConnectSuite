# Sidekick feature pass — A to F

> Running report, opened 2026-09-23. Each feature carries: **decision**, existing behaviour, changed
> files, test evidence, screenshot evidence, remaining limitations, commit hash. It is appended to as
> each group lands; the audit (§0) was written **before any code changed** and is not edited
> afterwards except to strike a line that turned out wrong, with the reason beside it.
>
> **Standing constraints for the whole pass.** The real Mac↔SM-S938B link is not unpaired,
> disconnected, reset, revoked or re-networked. No Forget test. No push, no release, no signing, no
> identity change. Nothing private — clipboard text, file contents, thumbnails, real filenames of
> the owner's media — enters this file, `docs/evidence/`, or a commit.

---

## 0 · Audit — what exists, read from the code

Everything below was read from the current tree (`733bd00`), not recalled from docs.

### The one structural fact that decides two features

**Every transfer on this wire is started by the Mac.** `fs.transfer.begin` carries `direction`
*from the Mac's point of view* (`pull` = phone → Mac, `push` = Mac → phone), `media.original` is a
Mac request, and the phone binds the sockets and only *serves* (locked decision #2). There is **no
phone-initiated message that offers a file to the Mac** — the phone → Mac events that exist are
notifications, calls, SMS, clipboard, media-remote, mirror state and transfer progress. So:

- **Mac → phone (B)** rides an existing verb.
- **Phone → Mac, started on the phone (A)** has no verb to ride. It needs a new protocol message.

### Second fact: the Mac drops the phone's transfer verdict on the floor

The phone emits `fs.transfer.progress` (≤ 4/s plus a final) and `fs.transfer.done`
(`ok`, `bytes`, `verified`) for every transfer. `desktop/src/main/main.ts`'s `link.on('message')`
dispatcher handles notifications, calls, SMS, clipboard and remote state — **and neither transfer
event.** Consequences today:

- a push is reported *"sent"* when the Mac finishes **writing**, which `CLAUDE.md` already records as
  the wrong number (bytes queued ≠ bytes delivered — the push-resume probe, defect 56);
- the phone's `verified` verdict on a push is never shown anywhere on the Mac;
- the Files pane cannot draw real push progress, because the only progress it could draw is the
  sender's own write count.

Reading those two events is inside the existing contract and is the foundation for B.

### Feature-by-feature

| | Feature | Real data path today | Protocol support | Decision |
|---|---|---|---|---|
| **A** | Android Sharesheet → Mac | `SendSelectionActivity` handles `SEND` for **`text/plain` only** (selected text → `clip.push`). No stream handling, no file offer | **None.** No phone-initiated offer message exists (above) | **Blocked on a protocol decision** — proposal in §A. The Mac-side receive-folder setting it depends on is independent and is built (see B) |
| **B** | Mac → Android | Files pane: a drop target over the selected folder → `fs.transfer.begin push` → bulk socket. Serial. Phone records a `TransferEntity` and the phone's Transfers screen lists it. Name collision → phone refuses `TARGET_STALE` (never overwrites) and the Mac shows the refusal | Full: push, resume, `overwrite` opt-in, progress + done events | **Build.** Add a *Send to phone* button + multi-file picker + confirmation naming the phone and the destination folder; read `fs.transfer.progress`/`done` for truthful per-file and batch progress and the phone's verdict; collision-safe retry under `name (2).ext` (a different `name` is an existing field). Phone: a completion notification (local only, no wire change) |
| **C** | Photos quality + video | Detail preview = the grid's **256 px** `media.thumb`, drawn into a 4:3 well at `object-fit: cover` → upscaled ~1.2–2.5× and **portraits cropped**. No video element. CSP `img-src 'self' data:` blocks any local file | `media.thumb` allows **`maxEdge` 512** (pane asks 256). `media.original` delivers real bytes over bulk (today into `~/Downloads/Sidekick` only) | **Build**, Mac only. 512 px preview immediately, labelled as a preview; the original on request into a **private preview cache** (not Downloads) served by a narrow `sidekick-media:` protocol with Range support; `<video controls>` gated on `canPlayType` + `error`; `contain` on a dark stage; honest states |
| **D** | Files grid / sort / search | List only, order = the phone's (`dir` desc, name byte-wise). Paged 200 at a time | `fs.list` carries `name`, `size`, `mtimeMs`, `mime`; `fs.thumb` batches 32 | **Build**, Mac only. Sort and search operate on **loaded** entries and say so when `hasMore`. Range-select follows the drawn order. Grid thumbnails only for `image/*`/`video/*` |
| **E** | First-run setup | 5-page onboarding: welcome → **one** runtime permission (notifications) → mirror note → battery exemption → QR pair. Other grants are asked from the Sync tab when features are turned on. Onboarding still draws Material colours | n/a (phone only) | **Build**, phone only: a *Set up Sidekick* checklist reading real status per item, runtime prompts through the platform API on tap, special access by deep link and re-read on resume. Tested on the **emulator** (`emulator-5554`), never with `pm clear` on the SM-S938B |
| **F** | Mirror request while backgrounded | `mirror.start` with no visible Activity → `AWAITING_FOREGROUND`, a HIGH-importance *"X wants to mirror your screen"* notification that deep-links to the Mirror tab; 30 s consent timeout; Mirror tab shows *"X is waiting for you"* and a **Start mirroring** button | Full; the Mac renders the phone's `message`/`fixHint` | **Build the official version**: a notification action *Approve screen sharing*, a dedicated in-app request card (which Mac, what it permits, that Android shows its own prompt), only then the real consent. **No full-screen intent** (reason in §F). Copy: the phone currently tells the Mac *Tap "Start now"* — a label this Samsung does not show — and still says *ConnectSuite* |

### What must not change, checked

- Pairing / trust store / TLS / mDNS / ports: untouched by every group below.
- `applicationId` `com.chetan.connectsuite`, bundle id `com.chetan.sidekick.desktop`: untouched.
- The `Download` wall, `push` gating on the phone's own roots field, compare-and-delete: unchanged.
- The accessibility service's visible name *Sidekick Input* and the app name *Sidekick*: unchanged.

---

## A · Android Sharesheet → Mac — **BLOCKED: needs a protocol decision**

**Status: not implemented.** Stopped per the pass rule *"if a feature requires a new protocol
message… document it and stop."*

### Why no existing message can carry it

The phone cannot start a transfer. It can only answer a Mac's `fs.transfer.begin` or
`media.original`. A share sheet begins on the phone, while the Mac may be idle, so something has to
tell the Mac *there is a file for you*. Nothing on the wire says that. The workarounds that avoid a
new message were each considered and rejected:

| Workaround | Why not |
|---|---|
| Copy shared files into the `app:files` root and let the user pull them from Files | Not a send. The user has to walk to the Mac and fetch them; duplicates bytes on the phone |
| Mac polls `app:files` for new entries | A timer on the control channel for an event the phone already knows about; `media.buckets` is already documented as *must not be sent on a timer* for the same cost reason |
| Smuggle it in `clip.push` / a notification | A clipboard entry and a notification are contracts with their own storage and privacy rules (§6 of the clipboard proposal); overloading either breaks them |

### Proposal for decision (nothing below is built)

One new **phone → Mac event** and one new root `kind`, with the bytes moving on the **existing**
pull path so no second transfer mechanism appears:

```json
share.offer   (event, phone → Mac)
{"offerId":"s-3f1a","rootId":"share:s-3f1a","from":"Samsung SM-S938B",
 "items":[{"id":"0","name":"IMG_2041.jpg","mime":"image/jpeg","size":3874112},
          {"id":"1","name":"report.pdf","mime":"application/pdf","size":null}],
 "expiresMs":600000}
```

- The Mac pulls each item with the **existing** `fs.transfer.begin {"direction":"pull","rootId":"share:s-3f1a","id":"0"}` — resume, digest, progress and done all come for free.
- `share:<offerId>` is a transient root that exists only on the phone, holds read grants for the
  shared `content://` URIs for the offer's lifetime, and is never listed by `fs.list` with no
  `rootId`.
- `size: null` is legal (a provider that does not report `OpenableColumns.SIZE`), and the Mac shows
  *size unknown* rather than `0 B`.
- **Consent model to decide:** does a paired Mac pull automatically into its receive folder, or does
  the Mac show an *Accept* card? The phone's user already chose *Send* on a confirmation screen, so
  the proposal is **auto-pull on the Mac**, with a Mac setting to require acceptance. That is a
  product/security decision and is left to you.
- A `share.cancel` (either side) is the one other message, for a phone user who backs out while the
  Mac is pulling.

**Android side, ready to build once the message exists:** an exported `ShareToMacActivity` with
`SEND` + `SEND_MULTIPLE` for `*/*`; `EXTRA_STREAM` read with `IntentCompat.getParcelableExtra` /
`getParcelableArrayListExtra`; **no `file://` conversion**; the grants that come with the share
intent are only valid while the receiving component is alive, so the offer is held by the
foreground `LinkService` and the confirmation screen, and expires with them. The URIs cannot be
persisted with `takePersistableUriPermission` — that works only for SAF document URIs, not for
arbitrary share URIs — and the proposal says so instead of promising resumability across a phone
restart.

**What was built for A anyway, because it is independent:** the Mac's configurable receive
folder (Settings → File transfer). It is where every pull already lands (Files, Photos), so it is
useful today and is the destination A would use. Recorded under B.

---

## B · Mac → Android — **implemented, real-device tested**

**Decision:** build on the existing `fs.transfer.begin push`. No protocol change.

**Existing behaviour found:** a drop tile over the open folder, serial pushes, a phone that refuses
a name collision with `TARGET_STALE` and never overwrites. Two defects underneath it:

- **Defect 132** — every drop failed: the tile read `file.path`, removed from Electron in v32 (this
  app runs 43.4.1). Proven with a real Chromium drop: `path` read `undefined`, `webUtils` returned
  the real path for the same `File`.
- **Defect 133** — the Mac never read `fs.transfer.progress`/`done`, so a push was "sent" when this
  Mac finished **writing** (bytes queued) and the phone's `verified` never reached a screen. Measured:
  a 60 MB write resolved at 866 ms with the phone at 30%.

**What changed:**

| | |
|---|---|
| Mac → phone flow | **Send to phone…** in the Files toolbar (native multi-file picker) and the drop tile both end on one **confirmation card**: phone name, destination folder, count, total, file list, the collision rule — then Send or Cancel. Nothing moves before Send |
| progress | per-file and batch bars from the **phone's** `fs.transfer.progress`; *arrived* only on the phone's `fs.transfer.done`; `confirming` for "this Mac finished, the phone has not answered" |
| collisions | a name already on the phone is re-offered as `name (2).ext`, `(3)`… (the `name` field is already in the contract) — the original name is kept whenever it is free, nothing is replaced |
| Stop | queued files are not started; the in-flight one is cancelled on the phone with `fs.transfer.cancel`, whose partial stays and **resumes** on the next send (proven: resumed at 29,622,272 bytes) |
| receive folder (also Feature A's) | Settings → File transfer → **Choose… / Use default / Reveal in Finder**. Checked writable before storing; an unavailable chosen folder is refused with its name **before the phone is asked**, never recreated |
| phone | a low-importance *"<name> arrived from <Mac>"* notification after the phone's own **Complete** verdict only, batching a serial send into one running count, tapping through to Transfers. Built and unit-tested; **not yet observed on the device** (installed with F's build) |

**Changed files:** `desktop/src/shared/sendBatch.ts` (+test), `desktop/src/main/{files,downloads,photos,main,store}.ts`,
`desktop/src/preload.ts`, `desktop/src/renderer/{files,renderer,navModel}.ts`, `index.html`,
`styles.css`, `shell.css`, `filesView.test.ts`; `sync-module/.../v2/{ReceivedFiles,ReceivedFileNotifications,BulkTransfers}.kt`
(+`ReceivedFilesTest`), `core/.../NotificationChannels.kt`, `mirror-module/.../MirrorNotifications.kt`,
`app/.../AppNavigation.kt`. Probes: `scripts/sidekick-{send,stop,drop}-probe.mjs`, `sidekick-send-shots.mjs`,
`electron-file-path-probe.mjs`.

**Test evidence:** `docs/testing.md` → *Sidekick feature pass — Feature B*. Live, on the SM-S938B:
2 fresh sends (checksum matched), the same 2 again (arrived as `(2)`, phone logged the refusals),
200 MB stopped at 29.6 MB and resumed from exactly there, a real drop proving defect 132 (cancelled,
nothing sent). Phone tally `8 completed / 1 failed` — the one failure is the Stop.

**Screenshots** (`docs/evidence/sidekick-feature-pass-2026-09-23/`, cropped to the card — the rest
of the pane lists real folder contents): `b-toolbar.png`, `b-send-confirm.png`, `b-send-arrived.png`,
`b-send-synthetic-states.png` (**synthetic** — the pane's reducers fed invented ids, no transfer).

**Found and fixed while testing (my own, not shipped):** Stop did not cancel once the Mac had
finished writing (`confirming`); the per-file count vanished in `confirming`; a long status line
squeezed the file name to zero width; *"Stopped — nothing was sent"* after 29.6 MB had been sent.

**Remaining limitations:**

- The native picker cannot be driven by the harness, so the live runs enter at the pane's `offer()`
  — the method the picker and the drop both end in. The picker itself was not exercised.
- Destination is the folder open in the Files pane; a read-only folder or a phone without `push`
  shows no Send affordance at all. `Download/` itself is still unreachable (the wall).
- Test files left on the phone in **Received files** (`Download/ConnectSuite`): `sidekick-pass-sample*.txt`
  ×3, `sidekick-pass-sample-6mb*.bin` ×2, `sidekick-pass-stop-200mb*.bin` ×2, `sidekick-pass-60mb*.bin` ×2 —
  about 540 MB. Deleting them is yours to do; this pass does not delete files on the phone.

**Commit:** `d18ef15`

### B — completion run (morning of 2026-09-23)

Everything below ran on **B's own commit** on both ends (phone APK and Mac desktop built from
`d18ef15` in a worktree). Real SM-S938B: one file, three files, collision rename, stop during
receiver-side progress, resume (byte-identical, hash checked), and the **Android received-file
notification** — all confirmed. Receive folder: default, Choose… (real panel), Use default, renamed
folder and ejected drive refusals (phone never asked, nothing recreated) — all confirmed. One gap
found and fixed as a follow-up commit: the refusal now carries its fix hint. Full table:
`docs/testing.md` → *Feature B completion run*.

## C · Photos preview quality and video — **implemented, real-device tested (on samples)**

**Decision:** Mac only, no protocol change. The largest thumbnail the protocol allows (512) at once,
the real original on the bulk channel for viewing, a native player for video.

**Root cause (recorded before changing anything):** the detail preview was the grid's 256 px
thumbnail drawn at `object-fit: cover` into a 4:3 well — upscaled, and portraits cropped. The CSP
allowed no bytes from disk, so an original or a video could never have been shown. And the
thumbnail cache was keyed by id alone, so a naive "ask for 512" would have returned the cached 256.
Full table: `docs/testing.md` → Feature C.

**What changed:**

| | |
|---|---|
| stage | a dark `--media-stage` (theme-fixed, like `--media-scrim`), frame shaped to the photo's own aspect, `object-fit: contain`, capped at 360 px tall. Grid tiles keep `cover` |
| preview | `media.thumb maxEdge: 512` in its **own** cache; captioned *Preview · 512 px, the phone's thumbnail* |
| original | images ≤ 40 MB fetched after a 350 ms dwell, decoded off-stage, swapped in only on success; caption *Original · W × H* from the **decoded** size. Larger images: *Load full size · N MB* |
| video | **Play** fetches the original (with the phone's byte count while it loads), then a native `<video controls>` — play/pause, seek, time, fullscreen. No autoplay. `canPlayType` refusal is said before a byte moves; a codec refused after arrival (`error`) is said too |
| states | loading, undecodable (e.g. HEIC here), unsupported video, failed with **Try again**, *no preview on the phone*, *phone not offering originals* |
| metadata | Name (from `media.original`'s ack — not in `media.list`, so shown only once known), kind, taken, size, pixel size (decoded wins over listing), length, type, saved by |
| Save / Reveal | Save to Mac unchanged (receive folder); **Reveal in Finder** after a save, refused for any path outside the receive folder |
| privacy | originals for viewing go to a 0700 temp cache, never the receive folder; emptied at start, on disconnect and at quit; at most 12; no names logged |

**Changed files:** `desktop/src/main/{mediaPreview,photos,main}.ts`, `desktop/src/shared/byteRange.ts`
(+test), `desktop/src/preload.ts`, `desktop/src/renderer/{photos,renderer}.ts`, `index.html` (CSP),
`styles.css`, `tokens.css`, `photos.test.ts`; `scripts/check-color-tokens.mjs`,
`scripts/check-contrast.mjs`; probes `scripts/sidekick-photos-{probe,shots}.mjs`.

**Test evidence:** live on the SM-S938B over two generated samples — the portrait original at
3000 × 4000 via `sidekick-media:`, the video's metadata, controls, no autoplay, and a seek to 7 s with
frame data. One transient (the 512 stage before a small original decodes) was not caught and is not
claimed. Reveal's refusal proven with a positive control.

**Screenshots:** `c-photo-original.png`, `c-video-before-play.png`, `c-video-player.png` — samples
only, cropped to the detail column; the grid (the owner's library) is never in frame.

**Remaining limitations:**

- No universal codec support is claimed. HEVC video and HEIC stills depend on this Mac's decoders;
  both are detected and said, with Save to Mac as the route.
- A 2 GB video is fetched in full before it plays — the bulk channel has no streaming mode. The
  pane shows the phone's byte count while it loads.
- The 512 preview is the protocol's ceiling for a thumbnail; anything sharper is the original.
- Test files: two samples were added to the phone's Received files (`sidekick-pass-portrait-…jpg`,
  `sidekick-pass-video-720p.mp4`), and one saved to `~/Downloads/Sidekick`.

**Commit:** `049d9dd`

### C — review on the owner's real library (morning of 2026-09-23)

Found in `049d9dd` and fixed in a separate commit: **defect 135** — rotated portrait photos (listed
4000 × 2252, decoded 2252 × 4000) were shown through a landscape slot and ~60% cropped; the frame now
takes the real shape and the image is pinned to it. Also fixed: two captions claimed an unmeasured
size ("512 px") and a video type the player merely does not *list* was refused before trying. Found,
not fixed (phone-side): **defect 136**, `media.thumb` exceeds `maxEdge`. Verified live on real photos
(portrait, landscape, HEIC) and real videos (portrait, rotated landscape): full picture visible,
play/pause/seek, honest HEIC fallback, the phone's own not-found sentence. Full record:
`docs/testing.md` → *Feature C review*.

## D · Files grid, sort, filter — **implemented, real-device tested**

**Decision:** Mac only; `fs.list` already carries name, size, `mtimeMs` and MIME, and `fs.thumb` makes
pictures. No protocol change, no device-wide search (none exists on this wire and none is implied).

| | |
|---|---|
| view | **List | Grid** toggle; grid tiles show the phone's picture for images/videos (`fs.thumb`, asked once per id, batched) and otherwise a neutral badge carrying the **real extension** — never a stand-in image. Folders get the folder glyph |
| sort | Name (natural), Date modified, Size, Type (the phone's MIME), ↑/↓, from a toolbar select **and** by pressing a list column header (`aria-sort`). Folders first always; unknown dates/types last in both directions |
| filter | debounced 120 ms, `aria-label` *"Filter the files loaded in this folder by name"*, Escape clears, cleared on folder change; matches the name or the resolved app label |
| honesty | footer states *N of M loaded match …* and, while more is unloaded, that filter and sort cover only what is loaded; **Load more** button; filtered-to-nothing is its own state with **Clear filter**, distinct from an empty folder |
| selection | shift-click ranges over the **drawn** order; drag to Finder, copy and prefetch unchanged, shared by rows and tiles |
| memory | view and sort remembered per viewer in `localStorage`, wrapped so a refusal is harmless |
| wall | the `Download` wall and root list untouched |

**Changed files:** `desktop/src/shared/filesListing.ts` (+test), `desktop/src/renderer/{files,icons,navModel}.ts`,
`index.html`, `styles.css`, `filesView.test.ts`; probe `scripts/sidekick-files-view-probe.mjs`.

**Test evidence:** `docs/testing.md` → Feature D. Live over the phone's Received files: sort order
verified against the model, filter, filtered-empty, grid pictures and badges; the phone only read
(0 mutating requests in the log window).

**Found and fixed:** a render during the filter's debounce erased freshly typed text (probe caught
it; red-first test). The first toolbar wrapped into three rows.

**Screenshot:** `d-grid.png`.

**Remaining limitations:** sort and filter cover loaded entries only (by design, stated in the UI);
tiles have no keyboard focus ring of their own — they are pointer targets like the list rows before
them, and keyboard navigation of the listing is unchanged (not added) by this pass.

**Commit:** `5be1f5e`

### D — review, live (morning of 2026-09-23)

23 live checks over Received files (the only folder the phone lists — defect 137): every sort field
both ways against the phone's metadata, List ↔ Grid keeping folder/selection/detail, real thumbnails
only for images, filter scope, empty and filtered-empty states, instrumented pagination, the phone's
listing unchanged. Fixed in a separate commit: the filter following you into another shared folder,
the toolbar overflowing at the window minimum, and a bare header for a folder the phone lists as
empty. Open and not D's: **137** (phone-side) and **138** (pre-existing list column collapse at the
minimum). Rows and tiles are not keyboard-reachable (pre-existing). Record: `docs/testing.md` →
*Feature D review*.

## E · First-run setup and permissions — **implemented; verified on the emulator and on the SM-S938B end to end (2026-09-23)** — see `docs/testing.md` → *Feature E — SM-S938B verification*; defect 145 found there, open

**Decision:** a *Set up Sidekick* checklist after pairing (and from Sync settings), not a wall of
prompts. No permission added to the manifest; none asked that a feature does not need.

**Existing behaviour found — defect 134:** four features (**Texts, Calls, Contacts, Photos**) had
**no in-app route to being turned on**. Onboarding promised a Sync-tab route that did not exist; on
the test phone those grants had been made by `adb`, without `USER_SET`.

| Item | How it is asked | Status read from |
|---|---|---|
| Sidekick's own notifications (the one non-optional item) | runtime dialog | `POST_NOTIFICATIONS` |
| Camera | **not asked here** — the QR scanner asks when opened | `CAMERA` |
| Show notifications on your Mac | Settings deep link, re-read on return | `enabled_notification_listeners` |
| Texts / Calls / Contacts | runtime dialog; *Turned off in Settings* + **Open Settings** once Android stops asking | the same groups the features check |
| Photos and videos | runtime dialog | `MediaFeature.granted` — the feature's own test |
| Folders | the existing Folders screen (SAF picker) | `persistedUriPermissions` |
| Control from your Mac (*Sidekick Input*) | Accessibility Settings deep link | the input service's own check |
| Keep running in the background | battery-optimisation request | `isIgnoringBatteryOptimizations` |

Every feature row has **Not now** (remembered as a convenience, never as a grant). The header is a
count with its denominator (*1 of 9 turned on*). Lime only on a row that is really on; amber only
where Android has closed the easy route.

**Changed files:** `app/.../setup/{SetupPlan,SetupScreen}.kt` (+`SetupPlanTest`), `AppNavigation.kt`,
`onboarding/OnboardingCopy.kt` (the false sentence), `sync-module/.../SyncSettingsScreen.kt` (entry),
`input-module/.../InputOnboardingCard.kt` (two helpers made public).

**Test evidence:** emulator, clean data — 0 of 9 → Texts allowed through the system dialog (OS:
`USER_SET` grants) → 1 of 9; Calls refused twice → *Turned off in Settings*; notification access
opened and backed out → still *Off* (secure setting confirms); Done → Devices. `SetupPlanTest` 9/9.

**Screenshots:** `e-setup-first-run.png`, `e-system-dialog-sms.png`, `e-setup-texts-on-calls-blocked.png`
(emulator; no personal data).

**Remaining limitations / manual steps:**

- Not yet installed on the SM-S938B (done once with F, to limit link interruptions). On that phone
  most rows will read **On** already, because of the earlier `adb` grants.
- *Not now* hides nothing — the row stays, marked, so it can be revisited.
- ~~Android 14+ *Select photos* reads as Off~~ — **superseded by defect 139**: selected-only is its
  own state, *Some photos allowed* · *Change selection*, verified on the emulator with restarts. Once
  Android fixes a limited choice, full access is reachable only through Settings (no in-app route).
- The `limited` capability field and the Mac pane's wording are unit-tested only: the Mac holds one
  phone, so the emulator was not paired. Full run: `docs/testing.md` → *Feature E — emulator verification*.
- The onboarding pages themselves still draw Material colours (as recorded in the Android redesign
  plan); only the new checklist is Sidekick-styled.

**Commit:** `0d2d038`

## F · Mirror request while backgrounded — **implemented; emulator-verified; live Samsung test pending (manual)**

**Decision:** the official route only. A high-importance notification with a named action; the tap
(the user's gesture) opens Sidekick's own request screen; **Continue** then shows Android's real
consent. No full-screen intent (Android 14+ reserves it for calling and alarm apps, and it would look
like a spoofed system prompt), no background popup, no silent MediaProjection.

**What the person sees on the phone:** a heads-up *"<Mac> wants to see this phone's screen — Tap to
review. Android will then ask you to approve screen sharing."* with **Approve screen sharing**; then a
card saying who asked, what sharing shows, that Android asks next in its own words, what stays black,
and how many seconds are left; **Continue** or **Decline**. After Continue, **the prompt is Android's
and the OEM's** — on this Samsung it reads *Next* then *Share screen*; nothing in Sidekick quotes it.

**What the Mac sees:** the phone's own sentences, now OEM-neutral (*"Approve screen sharing on your
phone — tap the Sidekick notification, or open Sidekick › Mirror."*), and a distinct *declined on the
phone* when the person chooses Decline. The 30-second timeout and its sentence are unchanged.

**Changed files:** `mirror-module/.../{MirrorEngine,MirrorFailure,MirrorNotifications,MirrorState,MirrorStopReason}.kt`,
`ui/MirrorScreen.kt` (+`ConsentCopyTest`, `MirrorContractTest`), `app/src/debug/.../DesignPreviewActivity.kt`,
`desktop/src/renderer/{renderer,float,mirror}.ts` (*Sidekick Input*), `docs/protocol.md`.

**Evidence:** `f-heads-up-synthetic.png`, `f-request-card-synthetic.png` (emulator, synthetic peer).

**Remaining limitations:**

- **Live Samsung test not run** (locked, and an install could strand the link overnight) — see the
  manual steps below.
- Whether the heads-up appears over a full-screen app, and for how long, is Android's and One UI's
  decision (Do Not Disturb, notification settings); nothing here can force it.
- Two Mac sentences still say *"Open ConnectSuite on the phone"* (pairing placeholder,
  `linkHealth.ts`): they belong to the deferred Mac rename (Appendix B of the Android redesign plan,
  decision 14), which also splits `linkHealth.ts`, and were left for it.

**Commit:** `d9e681e`

## Motion — after the static features (skills: `find-animation-opportunities`, then `improve-animations`)

**Opportunity sweep** (only the new surfaces). Three survived the gate; everything high-frequency or
data-bearing was rejected — List/Grid switch and sort reordering (tens a session, over data being
read), filter typing (keyboard-driven), the 512 → original swap (a crossfade would only delay the
sharp pixels), the mirror countdown digits (functional text), tile hover (consistency with rows).

| | Change | Purpose | Values |
|---|---|---|---|
| 1 | send progress bar | stop the bar trailing the phone's real count | was `--dur-ring` 600 ms eased under 250 ms updates → `--dur-state` 180 ms **linear** |
| 2 | send card arriving in the detail column | bridge the swap under the pointer | one-frame `.is-arriving` (`opacity 0; translateY(-4px)`) → rest over `--dur-arrive` on `--ease`, **once per card** — measured live: a forced redraw did not replay it; reduced motion keeps the opacity only (`.motion-fade`) |
| 3 | setup badge Off → On (Android) | state indication on the row the person just acted on | `Crossfade`, 180 ms on `CubicBezierEasing(0.22, 1, 0.36, 1)` — the Mac's `--dur-state` / `--ease` |

**Audit** (`improve-animations`, same scope): one MEDIUM, **fixed** — the first version of #3 animated
shared colours under both crossfading glyphs, so for ~180 ms the outgoing *Off* circle was drawn lime,
a frame claiming a grant the OS had not reported. Each glyph now wears its own state's colours. Two
LOW items kept with feel-checks: whether Chromium transitions `width` on `::-webkit-progress-value` at
all (harmless either way), and the entrance replaying once when *Send* turns the confirm card into
the batch card.

`check-motion-tokens`: 77 declarations, 20 tokens, no raw literals. Evidence `e-motion-contacts-on.png`
(emulator: Contacts allowed through the system dialog, row settled on the lime check).

**Please run `/review-animations` yourself** over this pass — I did not invoke it, as asked.

**Commit:** `accb386`

---

## Summary

| | Feature | State | Commit |
|---|---|---|---|
| A | Android Sharesheet → Mac | **Blocked — needs a new phone→Mac message** (proposal in §A). Its receive-folder setting is built | — |
| B | Mac → Android | Implemented, **live-tested on the SM-S938B** (send, collision rename, Stop, resume, real drop); phone notification built, not yet seen on the device | `d18ef15` |
| C | Photos quality + video | Implemented, **live-tested** on generated samples (original 3000×4000, video seek) | `049d9dd` |
| D | Files grid / sort / filter | Implemented, **live-tested** on Received files; phone only read | `5be1f5e` |
| E | Set up Sidekick | Implemented, **emulator-tested** from clean data; phone install pending | `0d2d038` |
| F | Mirror request | Implemented, emulator-verified (real notification, synthetic peer); **live test pending** | `d9e681e` |
| — | Motion | Three bridges, one audit fix | `accb386` |

Defects found and fixed: **132** (drops failed on `File.path`), **133** (Mac ignored the phone's
transfer verdict), **134** (four features had no in-app route to their permission). Plus, found by
live probes in my own new code and fixed before commit: Stop missing the `confirming` phase, a name
squeezed to zero width, a filter debounce erasing typed text, a badge frame claiming a grant.

## Morning — the manual steps, in order

1. **Install the phone build on the SM-S938B while it is unlocked** (it was locked overnight, and an
   install restarts the link service): `adb -s "$(scripts/target-device.sh samsung)" install -r
   app/build/outputs/apk/debug/app-debug.apk`, then `adb -s "$(scripts/target-device.sh samsung)"
   shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity`, then
   `scripts/link-up.sh` must print three OKs. Pairing and grants survive `-r`.
2. **F, live:** with Sidekick in the background on the phone, press **Start mirroring** on the Mac.
   Expect a heads-up *"<Mac> wants to see this phone's screen"* with **Approve screen sharing**; tap
   it; read the request card; **Continue**; Android shows its own prompt (on this Samsung *Next*, then
   *Share screen*). Also try **Decline** once — the Mac should say *"Screen sharing was declined on
   the phone."* And let one request time out (30 s) to see the notification disappear with it.
3. **B, phone half:** send a file from the Mac (Files → **Send to phone…**) and look for *"<name>
   arrived from <Mac>"* on the phone; tap it — it should open Transfers.
4. **E on the real phone:** open Sync settings → **Set up Sidekick**. Most rows will read **On**
   already, because Texts, Calls and Contacts were granted by `adb` during earlier testing.
5. **A needs your decision** — the `share.offer` proposal in §A (and whether the Mac pulls
   automatically or shows an Accept card). Nothing of A is built.
6. **Run `/review-animations`** over this pass (not invoked by me, as asked).
7. **Optional clean-up** of test files — on the phone in *Received files* (`Download/ConnectSuite`):
   `sidekick-pass-*` (≈550 MB, including two 200 MB samples); on the Mac in `~/Downloads/Sidekick`:
   `sidekick-pass-portrait-3000x4000.jpg` (saved on purpose) and `sidekick-pass-stop-200mb.bin`,
   `inbox-probe.bin`, `nogrant-probe.bin` (pulled by the Files pane's selection prefetch while the app
   was being used at 01:03–01:04 — not by this pass's probes). Nothing was deleted by this pass.
8. Nothing is pushed.
