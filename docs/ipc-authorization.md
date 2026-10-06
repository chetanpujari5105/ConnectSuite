# IPC authorization matrix (Mac) — audit S4, defect 183

> **What this is.** Every channel a renderer can reach, which window may reach it, what it does, what its
> payload must look like, and what it is bound to. The table is **generated from `src/main/ipcPolicy.ts`
> and the three preloads** (2026-10-06), and `ipcPolicy.test.ts` keeps those three in agreement — so if
> this file and the code ever disagree, the code is right and this file is stale.

## The boundary, in order

Every handler in `main.ts` (and the webcam modules) is registered through `guardIpc` (`src/main/ipcAuth.ts`).
Before a handler runs:

1. **The sender is identified by object identity** against the windows this process created and
   registered at creation (main, floating mirror, receive window). Refused: an unknown sender, a
   destroyed window, a window replaced by a newer one of the same role, **a subframe**, no frame, and a
   frame not showing that window's own page (exact resolved path, `windowGuard.navigationDecision`). A
   window's role is never taken from anything the renderer says.
2. **The window's role must be allowed** on the channel (the *Windows* column).
3. **The arguments are validated** — types, sizes, enums, required fields, no unknown fields, no extra
   arguments (`src/shared/ipcSchema.ts`).
4. Then the channel's own **binding** (last column) runs inside the handler.

A refusal returns `{ ok: false, refused: true, reason }` with a short reason, and logs
`refused <channel>: <rule> — N refused / M allowed since launch`. **The payload is never logged.**

The preloads are narrowed too (`src/preload.ts` 150 methods, `src/preloadFloat.ts` 25, `src/preloadShare.ts` 8),
but **the preload is not the boundary**: a compromised page in the float window that bypassed its preload
was still refused by the main process (`docs/evidence/s4-ipc-2026-10-06/results.json`).

## Channels (136)

| Channel | Preload method | Windows | Effect | Payload rule | Binding / ownership |
|---|---|---|---|---|---|
| `activity-csv` | main:activityExportCsv | main | action | none | — |
| `activity-events` | main:activityEvents | main | reads personal data | none | — |
| `appearance-get` | main:appearanceGet, float:appearanceGet, share:appearanceGet | main, float, share | read | none | — |
| `appearance-set` | main:appearanceSet | main | action | `[oneOf('system', 'light', 'dark')]` | — |
| `apps-icons` | main:appsIcons | main | read | `[obj({ packages: arr(str({ min: 1, max: 256 }), { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 512 })) })]` | — |
| `apps-list` | main:appsList | main | read | none | — |
| `apps-open-ask` | main:appsOpenAsk | main | action | `[obj({ package: str({ min: 1, max: 256 }) })]` | — |
| `call-answer` | main:callAnswer | main | action | none | — |
| `call-current` | main:callCurrent | main | reads personal data | none | — |
| `call-dial` | main:callDial | main | action | `[phoneNumber]` | — |
| `call-log` | main:callLog | main | reads personal data | `[opt(obj({ limit, before: epochMs }))]` | — |
| `call-reject` | main:callReject | main | action | none | — |
| `camera-current` | main:cameraCurrent | main | read | none | — |
| `camera-frame-ack` | main:cameraFrameAck | main | action | `[str({ max: 64 }), str({ max: 32 })]` | — |
| `camera-request` | main:cameraRequest | main | action | `[facing]` | — |
| `camera-stop` | main:cameraStop | main | action | none | — |
| `camera-switch` | main:cameraSwitch | main | action | `[facing]` | — |
| `clip-clear` | main:clipClear | main | action | none | — |
| `clip-history` | main:clipHistory | main | reads personal data | none | — |
| `clip-offer-copy` | main:clipOfferCopy | main | action | `[obj({ offerId: id })]` | **S7:** the text is looked up in main, never sent by the page; the offer must be pending, unexpired, on the **current control session**, and is consumed by the call — a second Copy writes nothing |
| `clip-offer-dismiss` | main:clipOfferDismiss | main | action | `[obj({ offerId: id })]` | **S7:** removes the offer; never touches the clipboard |
| `clip-open` | main:clipOpen | main | action | `[messageText]` | http/https only, re-decided in main (`openableUrl`) |
| `clip-phone-history` | main:clipPhoneHistory | main | reads personal data | `[opt(num({ min: 1, max: 100, int: true }))]` | — |
| `clip-request` | main:clipRequest | main | action | none | — |
| `clip-restore` | main:clipRestore | main | action | `[obj({ id })]` | a `displaced` entry by id; refused unless this Mac's clipboard still holds exactly the entry that displaced it. The displaced text no longer crosses IPC |
| `clip-send` | main:clipSend | main | action | none | — |
| `clip-set-watching` | main:clipSetWatching | main | action | `[bool]` | — |
| `clip-use` | main:clipUse | main | action | `[messageText]` | — |
| `clip-watching` | main:clipWatching | main | read | none | — |
| `connect` | main:connect | main | action | none | — |
| `contacts-get` | main:contactsGet | main | reads personal data | `[obj({ id: opt(id), number: opt(phoneNumber), withPhoto: opt(bool) })]` | — |
| `contacts-list` | main:contactsList | main | reads personal data | `[opt(obj({ query: opt(str({ max: 200 })), limit }))]` | — |
| `debug-fs-cancel-probe` | main:debugFsCancelProbe | main | development only | `[flat]` | — |
| `debug-fs-delete-probe` | main:debugFsDeleteProbe | main | development only | `[flat]` | — |
| `debug-fs-probe` | main:debugFsProbe | main | development only | `[flat]` | — |
| `debug-fs-pull-probe` | main:debugFsPullProbe | main | development only | `[flat]` | — |
| `debug-fs-stat` | main:debugFsStat | main | development only | `[flat]` | — |
| `debug-push-resume-probe` | main:debugPushResumeProbe | main | development only | `[flat]` | — |
| `debug-resume-probe` | main:debugResumeProbe | main | development only | `[flat]` | — |
| `debug-switches` | float:debugSwitches | float | read | none | — |
| `device-vitals` | main:deviceVitals | main | read | none | — |
| `disconnect` | main:disconnect | main | action | none | — |
| `downloads-choose` | main:downloadsChoose | main | action | none | — |
| `downloads-folder` | main:downloadsFolder | main | read | none | — |
| `downloads-reveal` | main:downloadsReveal | main | action | none | — |
| `downloads-reveal-legacy` | main:downloadsRevealLegacy | main | action | none | — |
| `downloads-use-default` | main:downloadsUseDefault | main | action | none | — |
| `float-close` | main:floatClose, float:floatClose | main, float | window control | none | — |
| `float-minimize` | float:floatMinimize | float | window control | none | — |
| `float-move` | float:floatMove | float | window control | `[obj({ pointer: point, grab: point })]` | — |
| `float-open` | main:floatOpen | main | window control | none | — |
| `float-resize` | float:floatResize | float | window control | `[obj({ x: num({ min: -1e6, max: 1e6 }) })]` | — |
| `float-set-pinned` | float:floatSetPinned | float | window control | `[bool]` | — |
| `float-set-width` | main:floatSetWidth | main | window control | `[num({ min: 100, max: 4_000 })]` | — |
| `float-smart-fit` | float:floatSmartFit | float | window control | none | — |
| `float-state` | main:floatState, float:floatState | main, float | read | none | — |
| `forget-device` | main:forgetDevice | main | action | none | main window only; acts on the one stored phone |
| `fs-cancel` | main:fsCancel | main | action | `[obj({ transferId: id })]` | — |
| `fs-cancel-paused` | main:fsCancelPaused | main | action | `[obj({ rootId: id, id })]` | — |
| `fs-confirm-drop` | main:fsConfirmDrop | main | action | `[arr(localPath, { min: 1, max: 500 })]` | the paths are only a **request**: main shows a native sheet naming every file (or every source folder with its count), **Cancel is the default button**, one sheet at a time; only **Send** grants them to the asking window |
| `fs-drag` | main:fsDrag | main | action | `[arr(localPath, { min: 1, max: 500 })]` | every path must be one this process produced this session (pull result) — `producedFiles` |
| `fs-list` | main:fsList | main | reads personal data | `[obj({ rootId: id, path: opt(str({ max: 4_096 })), limit, afterName: opt(str({ max: 1_024 })), afterId: opt(id) })]` | — |
| `fs-paused-pulls` | main:fsPausedPulls | main | read | none | — |
| `fs-pick-send` | main:fsPickSend | main | action | none | — |
| `fs-pull` | main:fsPull | main | action | `[obj({ rootId: id, id, name: str({ min: 1, max: 1_024 }), size: num({ min: 0, max: 1e15, int: true }) })]` | — |
| `fs-pull-stop` | main:fsPullStop | main | action | `[obj({ transferId: id, how: oneOf('pause', 'cancel') })]` | — |
| `fs-roots` | main:fsRoots | main | read | none | — |
| `fs-send` | main:fsSend | main | action | `[obj({ rootId: id, path: str({ max: 4_096 }), source: localPath })]` | **checked before any byte is read** (`sourceGrants.ts`): the path must have been chosen in a native open panel (`fs-pick-send`) or confirmed in the native drop sheet (`fs-confirm-drop`), **by this same window**, **within the hour**, and still be **the same file** (`dev`/`ino`) |
| `fs-send-abort` | main:fsSendAbort | main | action | `[obj({ source: localPath })]` | — |
| `fs-thumb` | main:fsThumbs | main | reads personal data | `[obj({ rootId: id, ids: arr(id, { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]` | — |
| `input-global` | main:inputGlobal, float:inputGlobal | main, float | action | `[str({ min: 1, max: 32 })]` | — |
| `input-key` | main:inputKey | main | action | `[str({ min: 1, max: 32 })]` | — |
| `input-scroll` | main:inputScroll, float:inputScroll | main, float | action | `[obj({ x: num({ min: -1e6, max: 1e6 }), y: num({ min: -1e6, max: 1e6 }), dx: num({ min: -1e6, max: 1e6 }), dy: num({ min: -1e6, max: 1e6 }), durationMs: duratio…` | — |
| `input-swipe` | main:inputSwipe, float:inputSwipe | main, float | action | `[obj({ points: arr(point, { min: 1, max: 500 }), durationMs: duration, geom })]` | — |
| `input-tap` | main:inputTap, float:inputTap | main, float | action | `[obj({ x: num({ min: -1e6, max: 1e6 }), y: num({ min: -1e6, max: 1e6 }), durationMs: duration, geom })]` | — |
| `input-text` | main:inputText | main | action | `[obj({ text: str({ max: 10_000 }), mode: opt(oneOf('replace', 'append')) })]` | — |
| `log-tail` | main:logTail | main | reads personal data | `[opt(num({ min: 1, max: 5_000, int: true }))]` | — |
| `login-item-get` | main:loginItemGet | main | read | none | — |
| `login-item-set` | main:loginItemSet | main | action | `[bool]` | — |
| `main-window-show` | float:showMainWindow | float | window control | none | — |
| `mark-moment` | main:markMoment | main | development only | `[flat]` | — |
| `media-buckets` | main:mediaBuckets | main | reads personal data | none | — |
| `media-list` | main:mediaList | main | reads personal data | `[opt(obj({ bucketId: opt(id), limit, before: epochMs, beforeId: opt(id) }))]` | — |
| `media-original` | main:mediaOriginal | main | action | `[obj({ id })]` | — |
| `media-preview-original` | main:mediaPreviewOriginal | main | reads personal data | `[obj({ id })]` | — |
| `media-preview-thumb` | main:mediaPreviewThumb | main | reads personal data | `[obj({ id })]` | — |
| `media-thumbs` | main:mediaThumbs | main | reads personal data | `[obj({ ids: arr(id, { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]` | — |
| `menu-routes` | main:menuSetRoutes | main | action | `[arr(route, { max: 64 }), opt(arr(route, { max: 64 }))]` | — |
| `mirror-capture` | main:mirrorCapture, float:mirrorCapture | main, float | action | `[str({ min: 23, max: 64 * 1024 * 1024, pattern: /^data:image\/png;base64,/ })]` | PNG data URL only |
| `mirror-config` | main:mirrorConfig | main | action | `[quality]` | — |
| `mirror-keyframe` | main:mirrorKeyframe, float:mirrorKeyframe | main, float | action | `[opt(str({ max: 200 }))]` | — |
| `mirror-start` | main:mirrorStart | main | action | `[opt(quality)]` | — |
| `mirror-stats` | main:mirrorStats | main | read | none | — |
| `mirror-stop` | main:mirrorStop | main | action | none | — |
| `notif-action` | main:notifAction | main | action | `[obj({ key: str({ min: 1, max: 1_024 }), index: num({ min: 0, max: 32, int: true }) })]` | — |
| `notif-dismiss` | main:notifDismiss | main | action | `[str({ min: 1, max: 1_024 })]` | — |
| `notif-list` | main:notifList | main | reads personal data | none | — |
| `notif-permission` | main:notifPermission | main | read | none | — |
| `notif-reply` | main:notifReply | main | action | `[obj({ key: str({ min: 1, max: 1_024 }), text: messageText })]` | — |
| `notif-sound-get` | main:notifSoundGet | main | read | none | — |
| `notif-sound-set` | main:notifSoundSet | main | action | `[bool]` | — |
| `pairing-qr` | main:pairingQr | main | pairing action | `[opt(bool)]` | main window only; returns the QR image and host/name — not the raw secret field (the image encodes it) |
| `remote-artwork` | main:remoteArtwork | main | read | `[obj({ key: str({ min: 1, max: 1_024 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]` | — |
| `remote-command` | main:remoteCommand | main | action | `[obj({ action: str({ min: 1, max: 64 }), extra: opt(obj({ positionMs: opt(num({ min: 0, max: 1e12 })), volume: opt(num({ min: 0, max: 1_000 })) })) })]` | — |
| `remote-state` | main:remoteState | main | read | none | — |
| `rename-notice` | main:renameNotice | main | read | none | — |
| `renderer-log` | float:logLine | main, float | action | `[str({ max: 32 }), str({ max: 2_000 })]` | — |
| `retry-now` | main:retryNow | main | action | none | — |
| `reveal-saved` | main:revealSaved | main | action | `[obj({ path: localPath })]` | path must be one this process produced (pull or saved original) — `producedFiles` |
| `route-changed` | main:routeChanged | main | window control | `[str({ min: 1, max: 64 })]` | leaving `pairing` discards the code |
| `self-identity` | main:selfIdentity | main | read | none | — |
| `set-manual-address` | main:setManualAddress | main | action | `[str({ max: 255 })]` | — |
| `set-tailscale-address` | main:setTailscaleAddress | main | action | `[str({ max: 255 })]` | — |
| `settings` | main:settings | main | reads personal data | none | — |
| `share-cancel` | share:shareAct('cancel') | share | action | `[offer]` | offer last shown in this window |
| `share-decide` | share:shareDecide | share | action | `[obj({ offerId: id, decision: oneOf('accept', 'decline') })]` | offer must be in the payload last pushed to THIS receive window; then `handleShareDecision` |
| `share-offers` | main:shareOffers | main | reads personal data | none | — |
| `share-open` | share:shareAct('open') | share | action | `[offer]` | offer last shown in this window; the path is looked up in main, never sent |
| `share-retry` | share:shareAct('retry') | share | action | `[offer]` | offer last shown in this window; window visible and focused |
| `share-reveal` | share:shareAct('reveal') | share | action | `[offer]` | offer last shown in this window; the path is looked up in main, never sent |
| `share-window-close` | share:shareWindowClose | share | window control | none | — |
| `share-window-height` | share:shareWindowHeight | share | window control | `[num({ min: 0, max: 10_000 })]` | — |
| `share-window-show` | main:shareWindowShow | main | window control | `[offer]` | offer must exist (`shareReceiver.state`) |
| `share-window-state` | share:shareWindowState | share | reads personal data | none | — |
| `sms-messages` | main:smsMessages | main | reads personal data | `[obj({ threadId: id, options: opt(obj({ limit, before: epochMs })) })]` | — |
| `sms-send` | main:smsSend | main | action | `[obj({ threadId: id, body: messageText })]` | thread id from the phone; the recipient is resolved on the phone (`docs/protocol.md` send rule) |
| `sms-send-new` | main:smsSendNew | main | action | `[obj({ addresses: arr(phoneNumber, { min: 1, max: 20 }), body: messageText })]` | — |
| `sms-threads` | main:smsThreads | main | reads personal data | `[opt(obj({ limit, before: epochMs }))]` | — |
| `status` | main:status | main | read | none | — |
| `stream-start` | float:streamStart | float | read | none | — |
| `webcam-ask` | main:webcamAsk | main | action | `[opt(facing)]` | — |
| `webcam-current` | main:webcamCurrent | main | read | none | — |
| `webcam-spike-current` | main:webcamSpikeCurrent | main | development only | none | — |
| `webcam-spike-run` | main:webcamSpikeRun | main | development only | none | — |
| `webcam-stop` | main:webcamStop | main | action | none | — |
| `webcam-switch` | main:webcamSwitch | main | action | `[facing]` | — |


## Events main → renderer

A narrow preload hides an event from a page; this keeps it out of a window's **process**. Every event not
listed goes to the **main window only** (`EVENT_ROLES`, `sendAll`). Before S4, `sendAll` broadcast every
event — clipboard contents (`clip-arrived`), activity, transfers, pairing sightings — to the floating and
receive windows as well.

| Event | Windows |
|---|---|
| `status` | main, float |
| `appearance` | main, float, share |
| `float-changed` | main, float |
| `mirror-rotate` | main, float |
| `mirror-state` | main, float |
| `mirror-stopped` | main, float |
| `video-frame` | main, float |

`share-window` is sent only to the receive window (`ShareReceiveWindow.push`); `mark-requested` only to
the main window.

## The pairing secret, precisely

`pairing-qr` is main-window only. It returns the rendered QR **image** and the public `host` and `name`;
the raw `secret` field never crosses IPC. **The image encodes the secret** — it is a QR code — so a
compromised main renderer could decode it. What this buys is narrower: no other window can ask for or
rotate a code, and no payload carries the secret by accident. The old `pairing-qr-render` channel, which
rendered any string the renderer supplied, is removed.

## Exceptions and untested paths

| Item | Status |
|---|---|
| Handlers registered after `app.whenReady()` (receive window's `share-*`, webcam's) | guarded by the same `ipc` object; **not driven through `main.ts` in a test** (starting the app would start discovery on the network). Covered by `shareWindowBinding.test.ts`, the source checks in `shareDecision.test.ts` / `webcamWiring.test.ts`, and the isolated Electron run |
| ~~`fs-grant-source` trusts the preload's `pathForFile`~~ | **removed 2026-10-06 (defect 190).** Measured through the production handlers: raw IPC from the main window granted an arbitrary synthetic path and `fs-send` then opened and hashed all of it. A drop is now confirmed in a native sheet the renderer cannot press (`fs-confirm-drop`); grants are bound to window, file identity and one hour. **What remains:** the sheet is a person's judgement — a compromised renderer can still *ask*, and a person who reads *Send “id_rsa”* and presses Send has chosen it. The picker has the same property. Evidence: `docs/evidence/s4-file-grant-2026-10-06/` |
| `mirror-config` / `mirror-start` options | validated to `maxResolution` and `frameRate`; the phone re-validates |
| Development probes (`debug-*`, `mark-moment`, `webcam-spike-*`) | main window only, flat primitive objects; registered only when unpackaged |
| A real OS-level file drag onto the window | not performed (as in S3) |
| VoiceOver / keyboard over the narrowed bridges | not run |
