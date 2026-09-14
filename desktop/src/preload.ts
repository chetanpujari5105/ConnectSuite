import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppEntry,
  ClipEntry,
  LocalClipEntry,
  ConnectionStatus,
  GeometryStamp as InputGeometry,
  InputResult,
  MediaBucket,
  MediaItem,
  PairingQrPayload,
  PhoneAck,
  PhoneContact,
  PhoneNotification,
  PhoneResult,
  CallLogEntry,
  IncomingCall,
  RemoteState,
  SmsMessage,
  SmsThread,
} from './shared/protocol';
import type { PullOutcome, PushOutcome } from './main/files';
import type { FloatState } from './main/float';

/**
 * The only bridge between the renderer and the sockets. Everything here is an intent — the
 * renderer never holds a socket, a file handle, or a certificate.
 */
contextBridge.exposeInMainWorld('connect', {
  status: (): Promise<ConnectionStatus | null> => ipcRenderer.invoke('status'),
  pairingQr: (rotate?: boolean): Promise<{ payload: PairingQrPayload; dataUrl: string }> =>
    ipcRenderer.invoke('pairing-qr', rotate === true),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  retryNow: () => ipcRenderer.invoke('retry-now'),
  setManualAddress: (address: string) => ipcRenderer.invoke('set-manual-address', address),
  setTailscaleAddress: (address: string) => ipcRenderer.invoke('set-tailscale-address', address),
  forgetDevice: () => ipcRenderer.invoke('forget-device'),
  settings: () => ipcRenderer.invoke('settings'),
  logTail: (lines?: number): Promise<string[]> => ipcRenderer.invoke('log-tail', lines),

  mirrorStart: (options?: Record<string, unknown>) => ipcRenderer.invoke('mirror-start', options ?? {}),
  mirrorStop: () => ipcRenderer.invoke('mirror-stop'),
  /** `reason` is carried so the log can say which of the three callers asked, and why. */
  mirrorKeyframe: (reason?: string) => ipcRenderer.invoke('mirror-keyframe', reason),
  /**
   * One line from a renderer into the Mac's own log file.
   *
   * The float window had no way to say anything durable. Its decode path could fail for an entire
   * session and leave nothing behind but a devtools console nobody opens — which is the debt-list
   * failure in a different medium: a record that exists and is never read costs what no record
   * costs. `send`, not `invoke`: a log line must never make the caller wait, and it has no answer.
   */
  logLine: (where: string, line: string) => ipcRenderer.send('renderer-log', where, line),
  /** Main → this window: "summarise the stages around now." See renderer/markWindow.ts. */
  onMarkRequested: (callback: (label: string) => void) =>
    ipcRenderer.on('mark-requested', (_event, label: string) => callback(label)),
  /** This window → main: the summary, for the log file. */
  markMoment: (summary: unknown) => ipcRenderer.invoke('mark-moment', summary),
  mirrorStats: () => ipcRenderer.invoke('mirror-stats'),
  /** `mirror.config` at runtime: raise the resolution cap or change bitrate without a restart. */
  mirrorConfig: (options: Record<string, unknown>) => ipcRenderer.invoke('mirror-config', options),
  mirrorCapture: (dataUrl: string) => ipcRenderer.invoke('mirror-capture', dataUrl),

  /**
   * Input, as intents. The renderer works out *where on the picture* it clicked and nothing more;
   * the main process owns the socket, the rate limit, and the one-request-at-a-time rule.
   *
   * Every one of these resolves to an [InputResult] and none of them rejects. A tap that did not
   * happen still has to say so — the user is looking at a phone that did not react — but it says
   * so as `{ ok: false, reason, fixHint }` rather than as a rejection, because `invoke` rewraps a
   * rejection as `Error invoking remote method 'input-key': Error: …` and puts nine words of
   * Electron internals in front of a sentence the phone wrote for a person to read. Defect 22.
   */
  inputTap: (point: {
    x: number;
    y: number;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-tap', point),
  inputSwipe: (swipe: {
    points: Array<{ x: number; y: number }>;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-swipe', swipe),
  inputScroll: (scroll: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-scroll', scroll),
  inputKey: (key: string): Promise<InputResult> => ipcRenderer.invoke('input-key', key),
  inputText: (text: string, mode?: 'replace' | 'append'): Promise<InputResult> =>
    ipcRenderer.invoke('input-text', { text, mode }),
  inputGlobal: (action: string): Promise<InputResult> => ipcRenderer.invoke('input-global', action),

  /** Encoded H.264 access units. The renderer decodes; the main process never touches pixels. */
  onVideoFrame: (
    callback: (frame: {
      keyframe: boolean;
      config: boolean;
      ptsUs: number;
      data: Uint8Array;
      arrivedAt: number;
    }) => void,
  ) => ipcRenderer.on('video-frame', (_event, frame) => callback(frame)),
  /**
   * The phone's stats plus the measured clock offset, pushed as they arrive.
   *
   * The renderer needs the clock anchor to time every frame it paints, which is why this is a
   * push and not part of the once-a-second stats poll.
   */
  onMirrorTelemetry: (
    callback: (telemetry: { clockOffsetMs?: number; phone: Record<string, number> }) => void,
  ) => ipcRenderer.on('mirror-telemetry', (_event, telemetry) => callback(telemetry)),
  /**
   * Phase changes from the phone: waiting on the user, prompting, starting, running, stopped.
   *
   * `mirror.start` acks before consent is even asked for, so these are the only thing that says
   * what is happening between the click and the first frame. The canvas shows the newest one.
   */
  onMirrorState: (
    callback: (state: {
      state?: string;
      message?: string;
      fixHint?: string;
      width?: number;
      height?: number;
      bitrate?: number;
      frameRate?: number;
    }) => void,
  ) => ipcRenderer.on('mirror-state', (_event, state) => callback(state)),
  /**
   * The phone turned, with the geometry it now captures at.
   *
   * Separate from `onMirrorState` because a rotation is not a phase change: the session never
   * stopped running. It arrives just before the new parameter sets on the video channel.
   */
  onMirrorRotate: (
    callback: (rotate: { width?: number; height?: number; dpi?: number; rotation?: number }) => void,
  ) => ipcRenderer.on('mirror-rotate', (_event, rotate) => callback(rotate)),
  /**
   * Carries the phone's own reason string, which is what goes on the canvas.
   *
   * `transient` is true only for a secure surface — the one failure that leaves the session
   * running. It is here because the renderer cannot tell the two apart from the frame stream: a
   * blanked screen keeps producing frames, so "frames are still arriving" means nothing. See
   * defect 23 and [OverlayEnds] in renderer/mirror.ts.
   */
  onMirrorStopped: (
    callback: (info: { reason?: string; fixHint?: string; transient?: boolean }) => void,
  ) => ipcRenderer.on('mirror-stopped', (_event, info) => callback(info)),

  /**
   * Notifications: a live set the phone pushes, and three things you can do to one.
   *
   * `notifList` exists for a window that opens after notifications have already arrived — the
   * events are pushed, so a late subscriber would otherwise see an empty pane until something new
   * happened. It is a read of state the main process already holds, not a request to the phone.
   *
   * The three verbs resolve to `{ ok }` or `{ ok: false, reason, fixHint }` and never reject, for
   * the reason in the input block above.
   */
  notifList: (): Promise<PhoneNotification[]> => ipcRenderer.invoke('notif-list'),
  notifReply: (key: string, text: string): Promise<PhoneAck> =>
    ipcRenderer.invoke('notif-reply', { key, text }),
  notifAction: (key: string, index: number): Promise<PhoneAck> =>
    ipcRenderer.invoke('notif-action', { key, index }),
  notifDismiss: (key: string): Promise<PhoneAck> => ipcRenderer.invoke('notif-dismiss', key),
  onNotifChanged: (callback: (list: PhoneNotification[]) => void) =>
    ipcRenderer.on('notif-changed', (_event, list) => callback(list)),

  /**
   * The renderer's current route, told to the main process.
   *
   * The native notifier needs it to answer one question precisely: a banner is suppressed only when
   * the window is focused **and** the notifications pane is open. Focused on Files is not the same
   * situation and must still notify — docs/phase-7-native-notifications.md §4.
   */
  onPairRejected: (callback: (info: unknown) => void) =>
    ipcRenderer.on('pair-rejected', (_event, info) => callback(info)),
  pairingQrRender: (payload: string): Promise<string | null> =>
    ipcRenderer.invoke('pairing-qr-render', payload),
  routeChanged: (screen: string): void => {
    ipcRenderer.send('route-changed', screen);
  },
  /**
   * A phone has published this Mac's fingerprint over mDNS — it has **scanned the code** (F6 / P3).
   *
   * **A sighting only.** There is no "nobody scanned" event and there must not be one: mDNS is the
   * least reliable of the three discovery paths, so an absence here is not evidence of anything and
   * a screen that rendered one would be making a confident wrong claim in the place a stranger has
   * no way to check it.
   */
  onPairScanned: (callback: (payload: { deviceName: string | null }) => void): void => {
    ipcRenderer.on('pair-scanned', (_event, payload) => callback(payload));
  },

  /** A native notification was clicked: route there, then reveal and flash that row. */
  onRevealNotification: (callback: (key: string) => void) =>
    ipcRenderer.on('reveal-notification', (_event, payload) => callback(payload?.key)),
  /** Whether macOS has refused a notification. Reactive — nothing is claimed before a failure. */
  notifPermission: (): Promise<{
    refused: boolean;
    headline: string | null;
    body: string | null;
    actionable: boolean;
    message: string | null;
  }> => ipcRenderer.invoke('notif-permission'),
  notifSoundGet: (): Promise<boolean> => ipcRenderer.invoke('notif-sound-get'),
  notifSoundSet: (on: boolean): Promise<boolean> => ipcRenderer.invoke('notif-sound-set', on),

  /**
   * Contacts: a search the phone runs, and one contact fetched in full.
   *
   * Both resolve to `{ ok: true, data }` or `{ ok: false, reason, fixHint }` and neither rejects,
   * for the reason in the input block above — `invoke` would rewrap a rejection and put Electron
   * internals in front of a sentence the phone wrote for a person to read (defect 22).
   *
   * There is no `contactsRefresh` and no local book: the `query` goes to the phone because the
   * phone has the indexes, and the number matching that makes `+1 555-123-4567` and `5551234567`
   * the same person lives there and only there.
   */
  /**
   * Clipboard, and the asymmetry is in the method names as much as in the docs.
   *
   * `clipSend` is the **manual override** now: copying on this Mac sends on its own, because macOS
   * gates nothing and the watcher in `clipboardWatcher.ts` polls for it. The button remains for the
   * case the interlock has suppressed something, or somebody just wants to be sure.
   *
   * `clipRequest` is answerable only while
   * ConnectSuite is focused on the phone and otherwise resolves `{ ok: false }` with
   * `PHONE_NOT_FOREGROUND`'s sentence — a live pane, not a grey one, because there is no permission
   * for the user to go and grant.
   *
   * **`clipUse` writes this Mac's clipboard from a click** — an older history row, or Restore on
   * the `displaced` entry that auto-apply pushed aside. Arriving entries no longer come through it:
   * they are applied on arrival, and `onClipArrived` carries `applied` so the pane can say which
   * happened rather than guessing.
   */
  clipSend: (): Promise<PhoneResult<{ bytes: number }>> => ipcRenderer.invoke('clip-send'),
  /** Whether this Mac is watching its own clipboard. The phone has no equivalent and cannot. */
  clipWatching: (): Promise<PhoneResult<{ watching: boolean }>> => ipcRenderer.invoke('clip-watching'),
  clipSetWatching: (on: boolean): Promise<PhoneResult<{ watching: boolean }>> =>
    ipcRenderer.invoke('clip-set-watching', on),
  clipRequest: (): Promise<PhoneResult<ClipEntry>> => ipcRenderer.invoke('clip-request'),
  clipHistory: (): Promise<PhoneResult<LocalClipEntry[]>> => ipcRenderer.invoke('clip-history'),

  /** This Mac's own name and short key, for the sidebar's account block. Side-effect-free. */
  selfIdentity: (): Promise<{ name: string | null; fingerprint: string | null }> =>
    ipcRenderer.invoke('self-identity'),

  /**
   * The Activity screen's log.
   *
   * `error` travels beside `events` rather than replacing them, because an empty list on a failed
   * read is the one shape that makes A2 and A3 indistinguishable — see `shared/activity.ts`.
   */
  activityEvents: (): Promise<
    PhoneResult<{
      events: ActivityEvent[];
      error: string | null;
      stats: { read: number; skipped: number; recorded: number; dropped: number };
    }>
  > => ipcRenderer.invoke('activity-events'),

  /**
   * One activity event as it is recorded, for the status island's rota (S6).
   *
   * Not how the Activity pane gets its rows — that reads the whole list on open. This is a
   * narration channel, and a renderer that missed one loses a line in a pill.
   */
  onActivityRecorded: (callback: (event: ActivityEvent) => void): void => {
    ipcRenderer.on('activity-recorded', (_event, recorded) => callback(recorded));
  },

  /** Opens a save dialog and writes the whole log as CSV. Resolves `ok: false` on cancel. */
  activityExportCsv: (): Promise<PhoneResult<{ path: string }>> =>
    ipcRenderer.invoke('activity-csv'),
  clipPhoneHistory: (limit?: number): Promise<PhoneResult<ClipEntry[]>> =>
    ipcRenderer.invoke('clip-phone-history', limit),
  clipUse: (text: string): Promise<PhoneResult<null>> => ipcRenderer.invoke('clip-use', text),
  /** Empties the list. Not the pasteboard, and not the echo interlock — see `clearHistory`. */
  clipClear: (): Promise<PhoneResult<{ cleared: number }>> => ipcRenderer.invoke('clip-clear'),
  /**
   * Opens an entry that is a web link.
   *
   * The renderer decides whether to *draw* the button; the main process decides whether to *open*,
   * with the same function. A string that arrived from a phone is not this Mac's, and `openExternal`
   * opens whatever a scheme is registered to.
   */
  clipOpen: (text: string): Promise<PhoneResult<null>> => ipcRenderer.invoke('clip-open', text),

  /**
   * Settings → General and → File transfer.
   *
   * `loginItemSet` answers with what macOS **reports afterwards**, not with what was asked for:
   * `setLoginItemSettings` returns `void` and there are real conditions in which it does not take.
   * `honoured` is that comparison, made where the answer is, so the pane cannot draw its own
   * intention as a state.
   */
  loginItemGet: (): Promise<PhoneResult<{ openAtLogin: boolean }>> =>
    ipcRenderer.invoke('login-item-get'),
  loginItemSet: (on: boolean): Promise<PhoneResult<{ openAtLogin: boolean; honoured: boolean }>> =>
    ipcRenderer.invoke('login-item-set', on),
  downloadsFolder: (): Promise<PhoneResult<{ path: string }>> =>
    ipcRenderer.invoke('downloads-folder'),
  downloadsReveal: (): Promise<PhoneResult<{ path: string }>> =>
    ipcRenderer.invoke('downloads-reveal'),
  onClipArrived: (callback: (entry: LocalClipEntry & { applied: boolean }) => void) =>
    ipcRenderer.on('clip-arrived', (_event, entry) => callback(entry)),
  /** The history moved for a reason the renderer did not initiate — a watcher send, or a clear. */
  onClipChanged: (callback: () => void) => ipcRenderer.on('clip-changed', () => callback()),

  contactsList: (options: { query?: string; limit?: number } = {}): Promise<
    PhoneResult<{ contacts: PhoneContact[]; hasMore: boolean }>
  > => ipcRenderer.invoke('contacts-list', options),
  contactsGet: (
    options: { id?: string; number?: string; withPhoto?: boolean },
  ): Promise<PhoneResult<PhoneContact>> => ipcRenderer.invoke('contacts-get', options),

  /**
   * Files, both directions.
   *
   * `fsPush` landed with the phone's receiver; until then this comment said there was deliberately
   * no push method, because a bridge call that always failed is what a drop tile would have been
   * wired to. The affordance is still gated — on the phone's own `push` field in the roots ack, not
   * on this method existing.
   */
  fsRoots: (): Promise<PhoneResult<{ roots: FsRootRow[]; grantHint: string | null }>> =>
    ipcRenderer.invoke('fs-roots'),
  fsList: (options: {
    rootId: string;
    path?: string;
    limit?: number;
    afterName?: string;
    afterId?: string;
  }): Promise<PhoneResult<{ entries: FsEntryRow[]; hasMore: boolean }>> =>
    ipcRenderer.invoke('fs-list', options),
  /**
   * Sends one local file to the phone.
   *
   * `overwrite` is omitted unless the caller means it: the phone refuses with `TARGET_STALE` when
   * something is already at that name, and that refusal is what stands between a push and a file
   * the user already had.
   */
  fsPush: (options: {
    rootId: string;
    path: string;
    source: string;
    overwrite?: boolean;
  }): Promise<PushOutcome> => ipcRenderer.invoke('fs-push', options),
  /**
   * Copies one file from the phone to `~/Downloads/ConnectSuite` and answers with its local path.
   *
   * The path is what [fsDrag] needs: Finder will not accept a promise of a file, only a file, so
   * a row has to be copied before it can be dragged. That ordering is the platform's and it is
   * stated to the user rather than hidden behind a spinner that cannot finish in time.
   */
  fsPull: (options: {
    rootId: string;
    id: string;
    name: string;
    size: number;
  }): Promise<PullOutcome> => ipcRenderer.invoke('fs-pull', options),
  /**
   * Hands one or more local files to Finder as a drag.
   *
   * **`send`, not `invoke`, and that is required rather than a style choice.** `webContents.startDrag`
   * must be called while the renderer's `dragstart` is still on the stack; awaiting an `invoke`
   * round trip first lets the drag gesture end before the drag begins, and macOS quietly drops it.
   *
   * An array always, even for one file. The single-path form was the shape before multi-select and
   * keeping both would mean two call paths through the one thing that cannot be retried mid-gesture.
   */
  fsDrag: (paths: string[]): void => ipcRenderer.send('fs-drag', paths),
  /**
   * Thumbnails for `fs.*` ids. Crosses as entries rather than a Map; the renderer rebuilds it.
   *
   * Separate from [mediaThumbs] because `fs.*` and `media.*` are disjoint id spaces — asking the
   * latter for an `fs.*` id answers `ok: true` with zero entries, which is a silent empty.
   */
  fsThumbs: (options: {
    rootId: string;
    ids: string[];
    maxEdge?: number;
  }): Promise<{ ok: boolean; entries?: [string, string][]; reason?: string; code?: string }> =>
    ipcRenderer.invoke('fs-thumb', options),


  /**
   * The photo browser. Three verbs, because the fourth needs a socket nothing serves yet.
   *
   * `mediaThumbs` answers with entries rather than a Map — see the handler for why — and the
   * renderer rebuilds the Map. Batching against the phone's 32-id cap happens in the main process,
   * so a caller here may ask for as many ids as it likes.
   */
  mediaBuckets: (): Promise<PhoneResult<MediaBucket[]>> => ipcRenderer.invoke('media-buckets'),
  mediaList: (
    options: { bucketId?: string; limit?: number; before?: number; beforeId?: string } = {},
  ): Promise<PhoneResult<{ items: MediaItem[]; hasMore: boolean }>> =>
    ipcRenderer.invoke('media-list', options),
  mediaThumbs: (
    options: { ids: string[]; maxEdge?: number },
  ): Promise<PhoneResult<Array<[string, string]>>> => ipcRenderer.invoke('media-thumbs', options),
  /** Debug builds only: exercises resume end to end. Absent from a packaged build's handlers. */
  debugResumeProbe: (options: { id: string }): Promise<unknown> =>
    ipcRenderer.invoke('debug-resume-probe', options),
  debugPushResumeProbe: (options: {
    rootId: string;
    path: string;
    source: string;
    /** Stop after the interruption, so the phone's process can be killed before the resume. */
    stopAfterCut?: boolean;
    /** Resume only — what runs after the process came back. */
    resumeOnly?: boolean;
  }): Promise<unknown> => ipcRenderer.invoke('debug-push-resume-probe', options),
  /** Debug builds only: drives `fs.list`, `fs.stat` and the traversal refusals over the real link. */
  debugFsProbe: (
    options: { rootId?: string; path?: string; limit?: number; pageCap?: number } = {},
  ): Promise<unknown> => ipcRenderer.invoke('debug-fs-probe', options),
  /** Debug builds only: one fs pull with a digest agreed in advance, and what it left on disk. */
  debugFsPullProbe: (
    options: { rootId: string; path?: string; name: string },
  ): Promise<unknown> => ipcRenderer.invoke('debug-fs-pull-probe', options),
  /** Debug builds only: cancel an agreed transfer and prove the id can no longer be claimed. */
  debugFsCancelProbe: (
    options: { rootId: string; path?: string; name: string },
  ): Promise<unknown> => ipcRenderer.invoke('debug-fs-cancel-probe', options),
  /** Debug builds only: the compare-and-delete guard, both halves. */
  debugFsDeleteProbe: (
    options: { rootId: string; path?: string; name: string },
  ): Promise<unknown> => ipcRenderer.invoke('debug-fs-delete-probe', options),

  /**
   * The app grid. Three verbs, and the third one **asks** rather than launches.
   *
   * `appsOpenAsk` returns a plain ack. There is no result to read and there must never be one: the
   * phone posts a notification and a person taps it, later, or not at all. Anything on this bridge
   * shaped like `{ opened: boolean }` would be inventing a fact neither machine has.
   *
   * `appsIcons` answers with entries rather than a Map, exactly as `mediaThumbs` does. Batching
   * against the phone's 32-package cap happens in the main process.
   */
  appsList: (): Promise<PhoneResult<{ apps: AppEntry[]; count: number; total: number }>> =>
    ipcRenderer.invoke('apps-list'),
  appsIcons: (
    options: { packages: string[]; maxEdge?: number },
  ): Promise<PhoneResult<Array<[string, string]>>> => ipcRenderer.invoke('apps-icons', options),
  appsOpenAsk: (options: { package: string }): Promise<PhoneAck> =>
    ipcRenderer.invoke('apps-open-ask', options),

  /** Pulls one photo at full size over the bulk channel and answers with where it landed. */
  mediaOriginal: (
    options: { id: string },
  ): Promise<PhoneResult<{ path: string; bytes: number; elapsedMs: number }>> =>
    ipcRenderer.invoke('media-original', options),

  /**
   * The media remote: one state the phone pushes, and one verb.
   *
   * `remoteState` reads the state the main process already holds — like `notifList`, it is for a
   * window that opened after the phone connected, not a request to the phone. The state carries
   * `receivedAtMs`, this Mac's clock at arrival, which is the anchor the progress bar runs from;
   * see remote.ts for why the phone's own `positionAtMs` is not used as one.
   */
  remoteState: (): Promise<RemoteState & { receivedAtMs: number }> =>
    ipcRenderer.invoke('remote-state'),
  remoteCommand: (action: string, extra: Record<string, unknown> = {}): Promise<PhoneAck> =>
    ipcRenderer.invoke('remote-command', { action, extra }),
  onRemoteChanged: (callback: (state: RemoteState & { receivedAtMs: number }) => void) =>
    ipcRenderer.on('remote-changed', (_event, state) => callback(state)),

  /**
   * O4's Device status card: the phone's battery and storage.
   *
   * Both a fetch and a subscription, for the reason `remoteState` is: a pane that routes in after
   * the phone reported would otherwise sit at "waiting" until the next tick — a minute for storage,
   * and for a stationary battery an hour. `null` means never reported, which the card draws
   * differently from reported-as-unknown.
   */
  deviceVitals: (): Promise<{
    battery: Record<string, unknown> | null;
    storage: Record<string, unknown> | null;
  }> => ipcRenderer.invoke('device-vitals'),
  onDeviceVitals: (
    callback: (state: {
      battery: Record<string, unknown> | null;
      storage: Record<string, unknown> | null;
    }) => void,
  ) => ipcRenderer.on('device-vitals', (_event, state) => callback(state)),

  /**
   * SMS: a thread list, a page of messages, and one send.
   *
   * `smsSend` takes a thread id and a body and **no recipient**, which is the send rule expressed
   * as a signature: the renderer is the layer most likely to be stale, so it is the layer that
   * cannot name who a message goes to. The main process resolves the addresses from the thread
   * rows the phone sent it, and the phone re-checks them against the provider before the radio
   * sees anything. See docs/protocol.md, "The send rule".
   */
  smsThreads: (options: { limit?: number; before?: number } = {}): Promise<
    PhoneResult<{ threads: SmsThread[]; hasMore: boolean }>
  > => ipcRenderer.invoke('sms-threads', options),
  smsMessages: (
    threadId: string,
    options: { limit?: number; before?: number } = {},
  ): Promise<PhoneResult<{ threadId: string; messages: SmsMessage[]; hasMore: boolean }>> =>
    ipcRenderer.invoke('sms-messages', { threadId, options }),
  smsSend: (threadId: string, body: string): Promise<PhoneAck> =>
    ipcRenderer.invoke('sms-send', { threadId, body }),
  /**
   * Defect 30. The *only* call that names a recipient, and it names no thread — shape two of
   * `sms.send`, for a conversation that does not exist yet. `smsSend` above still takes no
   * recipient, so the send rule cannot be bypassed by passing one for an existing thread.
   */
  smsSendNew: (addresses: string[], body: string): Promise<PhoneAck & { threadId?: string }> =>
    ipcRenderer.invoke('sms-send-new', { addresses, body }),
  onSmsReceived: (
    callback: (event: { threadId: string; message: SmsMessage }) => void,
  ) => ipcRenderer.on('sms-received', (_event, payload) => callback(payload)),

  /**
   * Calls: the one call that can be acted on, the log, and dialling.
   *
   * `callAnswer` and `callReject` take **no arguments**. The call they act on is the one the main
   * process is holding, and it sends that call's id explicitly rather than the protocol's
   * "whatever is in progress" shape — see calls.ts and step 61. A renderer that could name a call
   * could name the wrong one, so it cannot name one at all.
   */
  callCurrent: (): Promise<IncomingCall | null> => ipcRenderer.invoke('call-current'),
  callLog: (options: { limit?: number; before?: number } = {}): Promise<
    PhoneResult<{ calls: CallLogEntry[]; hasMore: boolean }>
  > => ipcRenderer.invoke('call-log', options),
  callAnswer: (): Promise<PhoneAck> => ipcRenderer.invoke('call-answer'),
  callReject: (): Promise<PhoneAck> => ipcRenderer.invoke('call-reject'),
  callDial: (number: string): Promise<PhoneAck> => ipcRenderer.invoke('call-dial', number),
  onCallChanged: (callback: (call: IncomingCall | null) => void) =>
    ipcRenderer.on('call-changed', (_event, call) => callback(call)),

  /**
   * The detached mirror window.
   *
   * Every one of these is a *lifecycle or a pointer position*, never a window rectangle. The
   * geometry invariant lives in `shared/floatGeometry.ts` and is applied in the main process, so a
   * renderer is never in a position to set a width without re-clamping Y — there is no channel that
   * would let it. The README asks for the lifecycle to sit behind four methods precisely so the
   * window can become an `NSWindow` later without a renderer change; this is the wire that keeps
   * that true.
   */
  /**
   * The start contract's asking half: "my listeners are up, what is the stream?"
   *
   * Replaces a push from `main.ts` on a window event that said nothing about whether this page was
   * listening yet. See shared/streamStart.ts — defect 105.
   */
  streamStart: () => ipcRenderer.invoke('stream-start'),
  /** Debug switches the renderer needs — currently only `delayFloatListeners`. Empty in a package. */
  debugSwitches: () => ipcRenderer.invoke('debug-switches'),
  floatOpen: () => ipcRenderer.invoke('float-open'),
  floatClose: () => ipcRenderer.invoke('float-close'),
  floatMinimize: () => ipcRenderer.invoke('float-minimize'),
  floatSmartFit: () => ipcRenderer.invoke('float-smart-fit'),
  floatSetWidth: (width: number) => ipcRenderer.invoke('float-set-width', width),
  floatSetPinned: (pinned: boolean) => ipcRenderer.invoke('float-set-pinned', pinned),
  /** Title-bar drag. `pointer` is in screen points; `grab` is its offset inside the window. */
  floatMove: (pointer: { x: number; y: number }, grab: { x: number; y: number }) =>
    ipcRenderer.invoke('float-move', { pointer, grab }),
  /** Corner drag. X only — see `boundsForCornerDrag` for why Y is not offered. */
  floatResize: (pointer: { x: number }) => ipcRenderer.invoke('float-resize', pointer),
  floatState: (): Promise<FloatState> => ipcRenderer.invoke('float-state'),
  onFloatChanged: (callback: (state: FloatState) => void) =>
    ipcRenderer.on('float-changed', (_event, state) => callback(state)),

  onStatus: (callback: (status: ConnectionStatus) => void) =>
    ipcRenderer.on('status', (_event, status) => callback(status)),
  onPhoneError: (callback: (payload: unknown) => void) =>
    ipcRenderer.on('phone-error', (_event, payload) => callback(payload)),
  onMessage: (callback: (envelope: unknown) => void) =>
    ipcRenderer.on('message', (_event, envelope) => callback(envelope)),
});
