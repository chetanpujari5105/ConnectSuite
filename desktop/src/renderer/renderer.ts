/**
 * The renderer draws and nothing else. Every socket, certificate, and file handle lives in the
 * main process; this file only reads status and sends intents through the preload bridge.
 *
 * Deliberately module-free so tsc emits a plain script the CSP-locked page can load.
 */

declare function chipLabel(capability: string, available: boolean, reason?: string): string;

/*
 * `shell` (shell.ts), `GLOBAL_ACTIONS` (navModel.ts) and `chipLabel` (chips.ts) need no import and
 * no `declare`: these are plain scripts in one global TypeScript scope, so the real definitions are
 * already visible here — and a `declare` would be a second signature free to drift from the first.
 */

interface UnavailableCapability {
  name: string;
  reason: string;
}

interface RendererStatus {
  phase: string;
  via?: string;
  address?: string;
  deviceName?: string;
  capabilities: string[];
  unavailable?: UnavailableCapability[];
  /** Offered but partial, with the phone's sentence (defect 139). Same shape as `unavailable`. */
  limited?: UnavailableCapability[];
  rttMs?: number;
  lastError?: string;
  nextRetryInMs?: number;
  paired: boolean;
  /** P5. When the armed pairing token stops being accepted — absolute epoch ms, absent if none. */
  pairingExpiresAt?: number;
}

interface ConnectBridge {
  /**
   * Appearance. `appearance` is the preference; `theme` is what it resolves to at this instant.
   * Optional on the bridge because `float.ts` shares this declaration and both windows get it —
   * but an older preload in a stale `dist/` would not, and a renderer that throws on startup is a
   * blank window. The call sites use `?.` for the same reason.
   */
  appearanceGet?: () => Promise<{
    ok: boolean;
    data: { appearance: 'system' | 'light' | 'dark'; theme: 'light' | 'dark' };
  }>;
  appearanceSet?: (value: 'system' | 'light' | 'dark') => Promise<{
    ok: boolean;
    data: { appearance: 'system' | 'light' | 'dark'; theme: 'light' | 'dark' };
  }>;
  onAppearance?: (
    callback: (state: { appearance: 'system' | 'light' | 'dark'; theme: 'light' | 'dark' }) => void,
  ) => void;
  /** Told to the main process on every route change — see shell.ts and the native notifier. */
  routeChanged(screen: string): void;
  onPairRejected(
    callback: (info: {
      headline: string;
      body: string;
      refreshCode: boolean;
      reason: string;
      qr: string | null;
    }) => void,
  ): void;
  /** Renders an already-armed QR payload. Does not arm a new one — that would rotate the token. */
  pairingQrRender(payload: string): Promise<string | null>;
  menuSetRoutes(routes: { id: string; label: string; shortcut: string }[]): Promise<void>;
  onMenuRoute(callback: (id: string) => void): void;
  onRevealNotification(callback: (key: string) => void): void;
  notifPermission(): Promise<{
    refused: boolean;
    headline: string | null;
    body: string | null;
    actionable: boolean;
    message: string | null;
  }>;
  notifSoundGet(): Promise<boolean>;
  notifSoundSet(on: boolean): Promise<boolean>;
  status(): Promise<RendererStatus | null>;
  /** This Mac's own name and short key, for the sidebar's account block. */
  selfIdentity(): Promise<{ name: string | null; fingerprint: string | null }>;
  /** The Activity screen's log. `error` rides beside `events` — see shared/activity.ts. */
  activityEvents(): Promise<{
    ok: boolean;
    data?: {
      events: ActivityEvent[];
      error: string | null;
      stats: { read: number; skipped: number; recorded: number; dropped: number };
    };
    reason?: string;
  }>;
  activityExportCsv(): Promise<{ ok: boolean; data?: { path: string }; reason?: string }>;
  pairingQr(
    rotate?: boolean,
  ): Promise<{ payload: { host: string; name: string }; dataUrl: string; reachable: boolean }>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  retryNow(): Promise<void>;
  setManualAddress(address: string): Promise<void>;
  setTailscaleAddress(address: string): Promise<void>;
  forgetDevice(): Promise<void>;
  settings(): Promise<{ manualAddress: string | null; tailscaleAddress: string | null }>;
  logTail(lines?: number): Promise<string[]>;
  mirrorStart(options?: Record<string, unknown>): Promise<{
    ok: boolean;
    requestedAt?: number;
    capture?: Record<string, number>;
  }>;
  mirrorStop(): Promise<{ ok: boolean }>;
  mirrorKeyframe(reason?: string): Promise<void>;
  /** Main asks this window to summarise the stages around now. */
  onMarkRequested?(callback: (label: string) => void): void;
  /** The summary, back to main, which writes it to the log file. */
  markMoment(summary: unknown): Promise<void>;
  mirrorConfig(options: Record<string, unknown>): Promise<{ ok: boolean }>;
  mirrorCapture(dataUrl: string): Promise<{ ok: boolean; path?: string; reason?: string }>;

  /**
   * The detached mirror window. Lifecycle only — this pane opens it and is told when it changes,
   * and never reads or writes its coordinates. See main/float.ts.
   */
  floatOpen(): Promise<{ open: boolean } | null>;
  floatClose(): Promise<unknown>;
  onFloatChanged(callback: (state: { open: boolean }) => void): void;
  floatState(): Promise<{ open: boolean } | null>;
  mirrorStats(): Promise<{
    frames: number;
    bytes: number;
    kbps: number | null;
    framesPerSecond: number | null;
    clockOffsetMs?: number;
    phone: Record<string, number> | null;
  }>;
  onVideoFrame(callback: (frame: MirrorFrame) => void): void;
  onMirrorTelemetry(callback: (telemetry: {
    clockOffsetMs?: number;
    phone: Record<string, number>;
  }) => void): void;
  onMirrorState(callback: (state: {
    state?: string;
    message?: string;
    fixHint?: string;
    width?: number;
    height?: number;
    bitrate?: number;
    frameRate?: number;
  }) => void): void;
  onMirrorRotate(callback: (rotate: {
    width?: number;
    height?: number;
    dpi?: number;
    rotation?: number;
  }) => void): void;
  onMirrorStopped(callback: (info: { reason?: string; fixHint?: string }) => void): void;
  // `{ ok: false, reason, fixHint }` rather than a rejection — see defect 22 and the note on
  // `InputResult` in mirror.ts. Typed loosely here because this interface only has to be
  // structurally assignable to the one MirrorView actually uses.
  inputTap(point: Record<string, unknown>): Promise<InputResult>;
  inputSwipe(swipe: Record<string, unknown>): Promise<InputResult>;
  inputScroll(scroll: Record<string, unknown>): Promise<InputResult>;
  inputKey(key: string): Promise<InputResult>;
  inputText(text: string, mode?: 'replace' | 'append'): Promise<InputResult>;
  inputGlobal(action: string): Promise<InputResult>;

  // Phase 4: notifications. Same result shape, same reason — see defect 22. `Notif` comes from
  // notifications.ts, which is a plain script in the same global scope rather than a module.
  notifList(): Promise<Notif[]>;
  notifReply(key: string, text: string): Promise<InputResult>;
  notifAction(key: string, index: number): Promise<InputResult>;
  notifDismiss(key: string): Promise<InputResult>;
  onNotifChanged(callback: (list: Notif[]) => void): void;

  // Phase 4: contacts. `{ ok: true, data }` or `{ ok: false, reason, fixHint }`, never a
  // rejection — defect 22 again. `Contact` comes from contacts.ts, a plain script in the same
  // global scope rather than a module.
  contactsList(options: { query?: string; limit?: number }): Promise<
    { ok: true; data: { contacts: Contact[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  contactsGet(options: { id?: string; number?: string; withPhoto?: boolean }): Promise<
    { ok: true; data: Contact } | { ok: false; reason?: string; fixHint?: string }
  >;

  // Phase 5: clipboard. Asymmetric, and the types say so — this Mac watches its own clipboard and
  // `clipSend` is the manual override,
  // `clipRequest` is answerable only while ConnectSuite is focused on the phone. `clipUse` is the
  // only call that writes this Mac's clipboard, which is why it is its own method rather than a
  // side effect of receiving.
  clipSend(): Promise<{ ok: true; data: { bytes: number } } | { ok: false; reason?: string; fixHint?: string }>;
  /**
   * The watcher's switch. There is no phone-side twin and there cannot be one: Android refuses a
   * background clipboard read to every app, so the phone has nothing to watch with.
   */
  clipWatching(): Promise<{ ok: true; data: { watching: boolean } } | { ok: false; reason?: string }>;
  clipSetWatching(
    on: boolean,
  ): Promise<{ ok: true; data: { watching: boolean } } | { ok: false; reason?: string }>;
  clipRequest(): Promise<
    { ok: true; data: ClipEntryRow } | { ok: false; reason?: string; fixHint?: string }
  >;
  clipHistory(): Promise<
    { ok: true; data: ClipEntryRow[] } | { ok: false; reason?: string; fixHint?: string }
  >;
  clipUse(text: string): Promise<{ ok: true; data: null } | { ok: false; reason?: string }>;
  /** Empties the list. Not the pasteboard and not the echo interlock — see `clearHistory`. */
  clipClear(): Promise<
    { ok: true; data: { cleared: number } } | { ok: false; reason?: string; fixHint?: string }
  >;
  /**
   * Settings → General and → File transfer.
   *
   * `loginItemSet` answers with what macOS reports **afterwards**, and `honoured` is that
   * comparison. `setLoginItemSettings` returns `void` and there are conditions in which it does not
   * take, so a toggle drawing its own intention would be a check that does not gate.
   */
  loginItemGet(): Promise<
    { ok: true; data: { openAtLogin: boolean } } | { ok: false; reason?: string }
  >;
  loginItemSet(
    on: boolean,
  ): Promise<
    { ok: true; data: { openAtLogin: boolean; honoured: boolean } } | { ok: false; reason?: string }
  >;
  downloadsFolder(): Promise<
    | {
        ok: true;
        data: { path: string; chosen: boolean; defaultPath: string; legacyPath: string | null };
      }
    | { ok: false; reason?: string }
  >;
  downloadsChoose(): Promise<{ ok: true; data: { path: string } } | { ok: false; reason?: string }>;
  downloadsUseDefault(): Promise<
    { ok: true; data: { path: string } } | { ok: false; reason?: string }
  >;
  /** A phone published this Mac's fingerprint over mDNS — it scanned the code. F6. */
  onPairScanned(callback: (payload: { deviceName: string | null }) => void): void;
  /** One activity event as it is recorded — the status island's rota, S6. */
  onActivityRecorded(
    callback: (event: { category: string; kind: string; detail: string }) => void,
  ): void;
  downloadsReveal(): Promise<{ ok: true; data: { path: string } } | { ok: false; reason?: string }>;
  downloadsRevealLegacy(): Promise<{ ok: true; data: { path: string } } | { ok: false; reason?: string }>;
  renameNotice(): Promise<{ ok: true; data: { notice: string | null } } | { ok: false; reason?: string }>;
  onRenameNotice(callback: (notice: string | null) => void): void;
  /** Opens an entry that is a web link. The scheme is re-decided in the main process. */
  clipOpen(
    text: string,
  ): Promise<{ ok: true; data: null } | { ok: false; reason?: string; fixHint?: string }>;
  onClipChanged(callback: () => void): void;
  onClipArrived(callback: (entry: ClipEntryRow) => void): void;

  // Files, both directions. Push arrived with the phone's receiver in slice 8 (`fsSend` since the
  // 2026-09-23 pass, collision-safe and matched to the phone's own progress), `fsPull` and
  // `fsDrag` with drag to Finder in slice 9. The upload affordance is still gated — on the phone's
  // own `push` field in the roots ack, never on these methods existing.
  fsRoots(): Promise<
    | { ok: true; data: { roots: FsRootRow[]; grantHint: string | null; push: boolean } }
    | { ok: false; reason?: string; fixHint?: string; code?: string }
  >;
  fsSend(options: {
    rootId: string;
    path: string;
    source: string;
  }): Promise<{
    ok: boolean;
    bytes?: number;
    reason?: string;
    code?: string;
    fixHint?: string;
    sentAs?: string;
  }>;
  fsPickSend(): Promise<
    | { ok: true; data: { files: Array<{ source: string; name: string; size: number }>; skipped: number } }
    | { ok: false; reason?: string }
  >;
  fsCancel(options: { transferId: string }): Promise<{ ok: boolean; reason?: string }>;
  fsSendAbort(options: { source: string }): Promise<{ aborted: boolean }>;
  onPushChecking(callback: (checking: { source: string; hashed: number }) => void): void;
  onPushAgreed(callback: (agreed: { source: string; transferId: string; name: string }) => void): void;
  /** Defect 132: `File.path` does not exist in Electron ≥ 32. */
  pathForFile(file: File): string;
  /** Every envelope the phone sends. The Files pane reads `fs.transfer.progress`/`done` from it. */
  onMessage(callback: (envelope: unknown) => void): void;
  fsPull(options: {
    rootId: string;
    id: string;
    name: string;
    size: number;
  }): Promise<{
    ok: boolean;
    path?: string;
    bytes?: number;
    verified?: boolean;
    verifiedBy?: 'prehash' | 'blocks';
    reason?: string;
    fixHint?: string;
    paused?: boolean;
    noSpace?: boolean;
    cancelled?: boolean;
    sourceChanged?: boolean;
    resumedFrom?: number;
  }>;
  fsPullStop(options: { transferId: string; how: 'pause' | 'cancel' }): Promise<{ stopped: boolean }>;
  fsPausedPulls(): Promise<Array<{ rootId: string; id: string; name: string; size: number; verifiedBytes: number; updatedAtMs: number }>>;
  fsCancelPaused(options: { rootId: string; id: string }): Promise<{ removed: boolean; partial?: string }>;
  onPullAgreed(callback: (info: { transferId: string; rootId: string; id: string; name: string; resumedFrom: number; blocks: boolean }) => void): void;
  onPullFinished(callback: (info: { rootId: string; id: string; name: string; result: PullResult }) => void): void;
  /** Fire-and-forget by necessity: `startDrag` cannot survive an awaited round trip. */
  fsDrag(paths: string[]): void;
  fsThumbs(options: {
    rootId: string;
    ids: string[];
    maxEdge?: number;
  }): Promise<{ ok: boolean; entries?: [string, string][]; reason?: string; code?: string }>;
  fsList(options: {
    rootId: string;
    path?: string;
    limit?: number;
    afterName?: string;
    afterId?: string;
  }): Promise<
    | { ok: true; data: { entries: FsEntryRow[]; hasMore: boolean } }
    | { ok: false; reason?: string; fixHint?: string; code?: string }
  >;

  // Phase 5 slice 2: the photo browser's three working verbs. Shapes mirror photos.ts, which is a
  // plain script in the same global scope rather than a module. `mediaThumbs` answers with entries
  // rather than a Map — a Map does not survive the bridge as something readable by key.
  mediaBuckets(): Promise<
    { ok: true; data: MediaBucketRow[] } | { ok: false; reason?: string; fixHint?: string }
  >;
  mediaList(options: { bucketId?: string; limit?: number; before?: number; beforeId?: string }): Promise<
    { ok: true; data: { items: MediaItemRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  mediaThumbs(options: { ids: string[]; maxEdge?: number }): Promise<
    { ok: true; data: Array<[string, string]> } | { ok: false; reason?: string; fixHint?: string }
  >;
  mediaOriginal(options: { id: string }): Promise<
    { ok: true; data: { path: string; bytes: number; elapsedMs: number } }
    | { ok: false; reason?: string; fixHint?: string }
  >;
  mediaPreviewThumb(options: { id: string }): Promise<
    { ok: true; data: { data: string | null; error: string | null } } | { ok: false; reason?: string }
  >;
  mediaPreviewOriginal(options: { id: string }): Promise<
    | { ok: true; data: { url: string; name: string; bytes: number; mime: string } }
    | { ok: false; reason?: string; fixHint?: string; code?: string }
  >;
  onMediaPreviewAgreed(
    callback: (ticket: { id: string; transferId: string; size: number; name: string; mime: string }) => void,
  ): void;
  revealSaved(options: { path: string }): Promise<{ ok: true; data: { path: string } } | { ok: false; reason?: string }>;

  // Phase 7: the app grid. `appsOpenAsk` returns a bare ack on purpose — the phone answers
  // `{ asked: true }` and there is no field saying whether the app opened, because it does not know.
  appsList(): Promise<
    { ok: true; data: { apps: AppRow[]; count: number; total: number } }
    | { ok: false; reason?: string; fixHint?: string; code?: string }
  >;
  appsIcons(options: { packages: string[]; maxEdge?: number }): Promise<
    { ok: true; data: Array<[string, string]> } | { ok: false; reason?: string; fixHint?: string }
  >;
  appsOpenAsk(options: { package: string }): Promise<InputResult>;

  // Phase 4: the media remote. `RemoteStateView` comes from remote.ts, a plain script in the same
  // global scope rather than a module.
  remoteState(): Promise<RemoteStateView>;
  remoteCommand(action: string, extra?: Record<string, unknown>): Promise<InputResult>;
  onRemoteChanged(callback: (state: RemoteStateView) => void): void;

  // Phase 4: SMS. `smsSend` takes no recipient — the send rule, as a signature. `smsSendNew`
  // takes one and no thread, which is the only shape where a recipient is the source of truth.
  smsThreads(options: { limit?: number; before?: number }): Promise<
    { ok: true; data: { threads: SmsThreadRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  smsMessages(threadId: string, options: { limit?: number; before?: number }): Promise<
    { ok: true; data: { threadId: string; messages: SmsMessageRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  smsSend(threadId: string, body: string): Promise<InputResult>;
  /**
   * Defect 30. The one call that names a recipient — and it names no thread, which is what makes
   * it safe: it cannot be used to supply a recipient for a conversation that already has one.
   */
  smsSendNew(addresses: string[], body: string): Promise<InputResult & { threadId?: string }>;
  onSmsReceived(callback: (event: { threadId: string; message: SmsMessageRow }) => void): void;

  // Phase 4: calls. `callAnswer`/`callReject` take no arguments — see calls.ts and step 61.
  callCurrent(): Promise<CallCard | null>;
  callLog(options: { limit?: number; before?: number }): Promise<
    { ok: true; data: { calls: CallLogRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  callAnswer(): Promise<InputResult>;
  callReject(): Promise<InputResult>;
  callDial(number: string): Promise<InputResult>;
  onCallChanged(callback: (call: CallCard | null) => void): void;
  onStatus(callback: (status: RendererStatus) => void): void;
  /** O4's Device status card. `null` means never reported, which is drawn differently. */
  deviceVitals(): Promise<{
    battery: Record<string, unknown> | null;
    storage: Record<string, unknown> | null;
  }>;
  onDeviceVitals(
    callback: (state: {
      battery: Record<string, unknown> | null;
      storage: Record<string, unknown> | null;
    }) => void,
  ): void;
  onPhoneError(callback: (payload: { code: string; message: string; fixHint?: string }) => void): void;
  /** The receive card. Optional for the same stale-preload reason as `onAppearance`. */
  shareOffers?(): Promise<ShareCardData[]>;
  onShareOffers?(callback: (offers: ShareCardData[]) => void): void;
  shareWindowShow?(offerId: string): Promise<{ ok: boolean; reason?: string }>;
}

declare const connect: ConnectBridge;

/**
 * The last status the renderer drew, held because a Settings pane is **built when it is opened** and
 * `render(status)` is what has the facts. Without this the Device info pane would draw whatever was
 * true when the app started.
 */
let lastStatus: RendererStatus | null = null;

const ALL_CAPABILITIES = [
  'mirror', 'input', 'notifications', 'sms', 'calls', 'contacts',
  'files', 'photos', 'clipboard', 'remote', 'apps', 'mic',
];

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/*
 * Start and Stop mirroring: exactly one is on screen. Two inputs from two clocks — the phone's
 * advertised capabilities (via `render`) and the session (via `MirrorView`) — and one painter that
 * both call, so neither can paint the pair from half the facts. `shared/mirrorSession.ts` holds the
 * rule. Declared above `render` because `render` can run before `MirrorView` exists.
 */
let canMirror = false;
let mirrorSession: MirrorSession = 'idle';
function paintMirrorButtons(): void {
  const b = mirrorButtons(canMirror, mirrorSession);
  const start = el<HTMLButtonElement>('mirror-start');
  const stop = el<HTMLButtonElement>('mirror-stop');
  start.hidden = !b.startShown;
  start.disabled = !b.startEnabled;
  stop.hidden = !b.stopShown;
  // The sentence under the one button — `mirrorNote` in shared/mirrorSession.ts, where it is tested.
  el('mirror-session').dataset.session = mirrorSession;
  el('mirror-session-note').textContent = mirrorNote(canMirror, mirrorSession);
  // The Overview hero's primary action follows the same rule: while a session exists it does not
  // offer to start a second one — it opens the picture that is already running.
  const running = b.stopShown;
  el('hero-mirror').dataset.session = mirrorSession;
  el('hero-mirror-label').textContent = running ? 'Open mirror' : 'Start mirroring';
  el('hero-mirror-key').hidden = running;
}

/**
 * One pass over everything the link's state changes.
 *
 * The shell owns the chrome — device card, connected-device strip, Overview hero, status island —
 * and is handed the status once. It is deliberately *one* call: those four are four views of one
 * fact, and the last time two views of one fact were fed separately in this codebase it was
 * defect 27, a reason going stale in one place and not the other.
 */
/**
 * Mirror's Link card. Every value is the live status or a dash — a round trip is shown only when one
 * was measured, and the route uses the shell's own wording (`heroTransportOf`), so the card and the
 * Overview hero cannot name the same link two ways.
 */
function paintMirrorLink(status: RendererStatus | null): void {
  const connected = status?.phase === 'connected';
  const rows: Array<[string, string]> = [
    ['Route', heroTransportOf(status)],
    ['Address', connected ? (status?.address ?? '—') : '—'],
    ['Round trip', connected && status?.rttMs !== undefined ? `${status.rttMs} ms` : '—'],
    ['Encryption', connected ? 'TLS 1.3, pinned' : '—'],
  ];
  el('mirror-link').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.className = 'mono';
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function render(status: RendererStatus | null): void {
  shell.setStatus(status);
  // Held for Settings → Device info, which is built when it is opened rather than on every status.
  lastStatus = status;
  drawPairSteps();

  setDiag('state', status?.phase ?? '—');
  setDiag('via', status?.via ?? '—');
  setDiag('address', status?.address ?? '—');
  setDiag('rtt', status?.rttMs === undefined ? '—' : `${status.rttMs} ms`);
  setDiag('device', status?.deviceName ?? '—');
  setDiag('error', status?.lastError ?? 'none');

  // The button is enabled only while the phone advertises `mirror`. Anything else would offer
  // the user an action the phone has already said it cannot perform.
  canMirror = status?.capabilities?.includes('mirror') ?? false;
  paintMirrorButtons();
  paintMirrorLink(status);

  // The phone's own sentence for anything it is not offering. Hoisted above its two consumers —
  // the panes below and the capability chips further down — rather than built twice: defect 27 was
  // this reason going stale, and one map read at one moment cannot disagree with itself.
  const reasons = new Map((status?.unavailable ?? []).map((u) => [u.name, u.reason]));
  // The pane stays and explains itself rather than vanishing. It is handed the reason verbatim
  // and never a Mac-side paraphrase — see NotificationsView.setAdvertised.
  notifications.setAdvertised(
    status?.capabilities?.includes('notifications') ?? false,
    reasons.get('notifications'),
  );
  // Same rule for contacts, and the pane loads its first page the moment it is advertised — which
  // is what makes granting READ_CONTACTS mid-session visible without a reconnect.
  contacts.setAdvertised(status?.capabilities?.includes('contacts') ?? false);
  // Photos is the one pane whose *content* does not depend on this. The three read verbs answer
  // either way; what the capability decides is whether full-size originals work, which is exactly
  // what the pane's banner says — so this call turns the banner off and the Save button on in the
  // same moment the chip goes green, from the same fact.
  // Defect 139: selected-only access is advertised *and* limited; the phone's sentence is passed
  // through so the pane says "Some photos allowed" exactly when the phone's checklist does.
  const limited = new Map((status?.limited ?? []).map((l) => [l.name, l.reason]));
  photos.setAdvertised(status?.capabilities?.includes('photos') ?? false, limited.get('photos') ?? null);
  // Apps, and it is the Photos rule with one difference worth naming: the grid works either way,
  // and what the capability decides is whether the *ask* can be delivered at all. The phone's own
  // reason is passed straight through rather than paraphrased — this side cannot know which switch
  // is off, and guessing is defect 27's shape.
  apps.setAdvertised(status?.capabilities?.includes('apps') ?? false, reasons.get('apps') ?? null);
  // The phone's own `reason` is passed straight through — a Mac-side paraphrase would be this side
  // guessing which grant is missing, which is the thing it cannot know.
  files?.setAdvertised(
    status?.capabilities?.includes('files') ?? false,
    reasons.get('files') ?? null,
  );
  // The media remote rides the notification-listener grant, so this lights together with
  // `notifications` — one grant, two features. See docs/protocol.md.
  // Defect 85. Two facts, kept apart on purpose: `connected` is the phase and `advertised` is the
  // capability list. A phone can be connected and not offering clipboard, and a stale capability
  // list read on a dropped link would report a connection problem as a permission one.
  clipboard.setLinkState(
    status?.phase === 'connected',
    status?.capabilities?.includes('clipboard') ?? false,
    reasons.get('clipboard') ?? null,
  );
  remote.setAdvertised(
    status?.capabilities?.includes('remote') ?? false,
    status?.phase === 'connected',
    reasons.get('remote') ?? null,
  );
  // Three facts, not one boolean — a dropped link keeps the conversations on screen under a
  // Disconnected banner; a refused grant shows the phone's own reason. See SmsView.setLinkState.
  sms.setLinkState(
    status?.phase === 'connected',
    status?.capabilities?.includes('sms') ?? false,
    reasons.get('sms') ?? null,
  );
  calls.setAdvertised(status?.capabilities?.includes('calls') ?? false);

  // The same rule for input: no button for a promise the phone has not made. Unlike the mirror
  // buttons the canvas cannot be "disabled" — so the view is told, and it answers a click with the
  // reason and the way to fix it rather than doing nothing.
  const canInput = status?.capabilities?.includes('input') ?? false;
  mirror.setInputAdvertised(canInput);
  for (const button of GLOBAL_ACTIONS) {
    el<HTMLButtonElement>(`input-${button.id}`).disabled = !canInput;
  }
  el('input-note').textContent = canInput
    ? 'Click the picture to tap, drag to swipe, scroll to scroll, and type to enter text into ' +
      'whichever field is selected on the phone.'
    : 'Controlling the phone needs Sidekick Input turned on under Accessibility on the ' +
      'phone. Mirroring works without it; clicking does not.';

  /*
   * The capability chips used to be drawn here — a dot beside a name, first on Overview (D10) and
   * then in Settings' side column (D22). They are **Settings → Device info** now, as component 20
   * rows, with the phone's sentence under each. The decision moved to `shared/capabilityStatus.ts`
   * where a test can reach it; this file is reachable by none.
   */

  // Connection & security and the Recent caption follow the link, so they are redrawn from the same
  // status the rest of this function reads rather than from a second subscription that could be a
  // frame behind it.
  overview.setStatus({
    phase: status?.phase,
    paired: status?.paired ?? false,
  });
}

/** One capability row: glyph, name, state word, and the phone's sentence where there is one. */
function capabilityRowEl(row: {
  id: string;
  label: string;
  state: 'available' | 'limited' | 'permission' | 'unavailable' | 'unbuilt';
  note: string | null;
}): HTMLElement {
  const el_ = document.createElement('div');
  el_.className = 'device-cap';
  el_.dataset.state = row.state;
  const tone = capabilityTone(row.state);
  el_.dataset.tone = tone.tone;

  const glyph = document.createElement('span');
  glyph.className = 'device-cap-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.appendChild(iconSvg(tone.icon, 16));

  const lines = document.createElement('div');
  lines.className = 'device-cap-lines';
  const name = document.createElement('div');
  name.className = 'device-cap-name';
  name.textContent = row.label;
  lines.appendChild(name);
  if (row.note) {
    const note = document.createElement('p');
    note.className = 'device-cap-note';
    // The phone's own sentence, verbatim — never a Mac-side paraphrase (defect 27).
    note.textContent = row.note;
    lines.appendChild(note);
  }

  const state = document.createElement('span');
  state.className = 'device-cap-state';
  state.textContent = capabilityStateLabel(row.state);

  // The wire id stays reachable as a handle rather than on screen — the package-id rule.
  el_.title = `${row.label} — capability id: ${row.id}`;
  el_.append(glyph, lines, state);
  return el_;
}

function describe(status: RendererStatus): string {
  switch (status.phase) {
    case 'connected':
      return `Connected to ${status.deviceName ?? 'phone'}`;
    case 'searching':
      return 'Looking for the phone…';
    case 'connecting':
    case 'handshaking':
      return `Connecting to ${status.address ?? 'phone'}…`;
    case 'reconnecting':
      return status.nextRetryInMs
        ? `Reconnecting in ${Math.round(status.nextRetryInMs / 1000)}s`
        : 'Reconnecting…';
    default:
      return status.paired ? 'Disconnected' : 'Not paired yet';
  }
}

/** The code on screen, for the P5 tick. Held because the tick has no other source for it. */
let shownCode: { name: string; host: string } | null = null;

/** Whether the last `pairing-qr` said a code could be scanned. Read by the steps column too. */
let codeIsScannable = true;

async function showQr(rotate = false): Promise<void> {
  const { payload, dataUrl, reachable } = await connect.pairingQr(rotate);
  el<HTMLImageElement>('qr').src = dataUrl;
  shownCode = { name: payload.name, host: payload.host };
  applyPairShape(reachable);
  if (reachable) await drawCodeState();
  // A new code invalidates a sighting of the old one. The main process replaces its watch for the
  // same reason; this is the screen's half of it.
  el('pair-scanned').hidden = true;
}

/**
 * `34:12152` — the card and the steps column, off **one** fact, in one call.
 *
 * They are two surfaces two inches apart on one screen, and they were briefly two writers reading
 * the same variable from two call sites. That is the status island's failure in miniature, and the
 * thing that makes it a rule rather than a near miss is that a probe caught it: driving the card
 * alone left the column reading *Waiting for a scan* beside a card explaining there was nothing to
 * scan, and the screen looked entirely plausible.
 *
 * It is also what a probe can call. `pairCard.ts` covers the card and `pairSteps.ts` covers the
 * column; only this says the two move together, and only in a browser is that observable.
 */
function applyPairShape(reachable: boolean): void {
  codeIsScannable = reachable;
  // The header is the third surface on this screen and it was the last to be told. Its sentence is
  // the shell's to write; this only hands over the fact.
  shell.setPairReachable(reachable);
  /*
   * The action re-runs `showQr` without rotating — re-reading the interfaces is the whole of
   * "check again", and rotating would invalidate a code somebody may already be looking at.
   */
  applyPairCard(
    {
      title: el('pair-title'),
      sub: el('pair-sub'),
      qr: el('qr'),
      note: el('qr-note'),
      offline: el('pair-offline'),
      button: el('new-qr'),
    },
    pairCardView(reachable),
    () => void showQr(),
  );
  drawPairSteps();
}

/**
 * P5 — the line under the QR, recomputed against the clock.
 *
 * ### Why it ticks rather than being written once
 *
 * The state that matters is **stale**, and nothing sends an event when a token expires — expiry is
 * an instant passing, not something happening. Written once at `showQr` the line would be correct
 * for five minutes and then wrong forever, which is the failure it exists to fix rather than a
 * smaller version of it.
 *
 * ### Why it re-reads `status()` rather than trusting the last one
 *
 * `pairingExpiresAt` moves when the renderer re-arms, and `status` events fire on link *transitions*
 * — an armed code sitting untouched produces none. A tick against a remembered expiry would count a
 * live code down to zero and draw *"expired"* over one this Mac would accept.
 */
async function drawCodeState(): Promise<void> {
  const status = await connect.status();
  const state = pairingCodeState(status?.pairingExpiresAt, Date.now(), shownCode?.name, shownCode?.host);
  const note = el('qr-note');
  note.textContent = state.text;
  note.dataset.codeState = state.kind;
  /*
   * Emphasis, not existence: the button is always there, because a screen whose only way forward
   * appears conditionally is one a user can get stuck on.
   *
   * **`primary-action`, and the first version of this line said `button-primary`** — a class that
   * exists in no stylesheet. `tsc` was clean, the write test asserted `classList.contains(...)` and
   * passed, and the button drew exactly as it had before. It was caught in a screenshot, which is
   * where the empty-ring icons were caught too: a name that resolves to nothing is invisible to
   * every layer that checks names against each other rather than against the thing they name.
   * `stylesheets.test.ts` now asserts this one resolves.
   */
  el('new-qr').classList.toggle('primary-action', state.urgent);
}

/**
 * F6 / P3 — the Mac tells *"nobody has scanned this"* from *"scanned, and now looking for you"*.
 *
 * `docs/phase-7-pairing-flow.md` J1 and J2 are the same Mac screen today, which means the first
 * thirty seconds of a failed pairing look exactly like the first thirty seconds of a working one.
 * The phone publishes this Mac's fingerprint over mDNS from the moment it scans; this is the Mac
 * listening for it.
 *
 * **There is no negative.** `docs/protocol.md` says it where the attribute is declared: a positive
 * is trustworthy and an absence is not, because mDNS is dropped by client isolation, by some
 * routers, and by a phone that has not published yet. So this only ever *adds* a line. A Mac saying
 * "nobody has scanned this code" over a phone that scanned it forty seconds ago would be a
 * confident wrong answer in the one place a stranger has no way to check it.
 */
/*
 * ---- Appearance: the ONE writer of `data-theme` ------------------------------------------------
 *
 * The main process resolves the preference (see `shared/appearance.ts` for why the rule lives
 * there) and pushes `{ appearance, theme }`. This stamps the resolved theme on `<html>` and does
 * nothing else — no media query, no second decision, no local cache of what the theme "should" be.
 *
 * That is deliberate and it is the status-island lesson (defect 96): a surface with one job gets
 * one writer. A `@media (prefers-color-scheme)` block in tokens.css would be a second writer on the
 * same element, deciding from a different source on a different clock, and the two would disagree
 * exactly when the user has chosen Light on a dark Mac — the case the feature exists for.
 *
 * The listener is registered **before** the first `appearanceGet()` so an OS flip during startup
 * cannot land between the read and the subscribe and be lost.
 */
function stampTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
}

connect.onAppearance?.((state) => {
  stampTheme(state.theme);
  shell.refreshSettings();
});

void (async () => {
  const result = await connect.appearanceGet?.();
  if (result?.ok) stampTheme(result.data.theme);
})();

{
  // The pairing screen's manual address — the same store Settings → Connection writes, through the
  // same IPC. One setting, two doors: this one is at the moment the address is needed.
  const field = document.getElementById('pair-manual') as HTMLInputElement | null;
  const save = document.getElementById('pair-manual-save');
  if (field && save) {
    save.addEventListener('click', () => {
      void (async () => {
        const address = field.value.trim();
        await connect.setManualAddress(address);
        savedManual = address;
        shell.toast(address === '' ? 'Address cleared.' : `Trying ${address}…`);
      })();
    });
  }
}

connect.onPairScanned((payload) => {
  const line = el('pair-scanned');
  line.hidden = false;
  line.textContent = payload.deviceName
    ? `${payload.deviceName} has scanned this code and is looking for this Mac. Keep both on the same Wi-Fi.`
    : 'A phone has scanned this code and is looking for this Mac. Keep both on the same Wi-Fi.';
  pairSighting = { seen: true, name: payload.deviceName ?? null };
  drawPairSteps();
});

/**
 * The mDNS sighting, held because it is an **event** and the step column is redrawn on every status.
 * A positive only: an absence is never evidence (F6 / P3, and `docs/protocol.md` says so where the
 * attribute is declared).
 */
let pairSighting: { seen: boolean; name: string | null } = { seen: false, name: null };

/** The four steps beside the code. The rule is `shared/pairSteps.ts`; this only draws it. */
function drawPairSteps(): void {
  const host = document.getElementById('pair-steps');
  if (!host) return;
  const status = lastStatus;
  const steps = pairSteps({
    sighted: pairSighting.seen,
    sightedName: pairSighting.name,
    phase: status?.phase ?? null,
    paired: status?.paired ?? false,
    fingerprint: macFingerprint,
    address: status?.address ?? null,
    scannable: codeIsScannable,
  });
  host.replaceChildren();
  const list = document.createElement('ol');
  list.className = 'pair-step-list';
  for (const [index, step] of steps.entries()) {
    const item = document.createElement('li');
    item.className = 'pair-step';
    item.dataset.state = step.state;
    const mark = document.createElement('span');
    mark.className = 'pair-step-mark';
    mark.setAttribute('aria-hidden', 'true');
    // A tick for a step that is done, the number for the rest — the shape half of the state, so it
    // does not depend on colour alone (defect 26).
    if (step.state === 'done') mark.appendChild(iconSvg('check', 12));
    else mark.textContent = String(index + 1);
    const lines = document.createElement('div');
    lines.className = 'pair-step-lines';
    const label = document.createElement('div');
    label.className = 'pair-step-label';
    label.textContent = step.label;
    lines.appendChild(label);
    if (step.note) {
      const note = document.createElement('p');
      note.className = 'pair-step-note';
      note.textContent = step.note;
      lines.appendChild(note);
    }
    item.append(mark, lines);
    list.appendChild(item);
  }
  host.appendChild(list);
}

/** This Mac's own fingerprint, for the verify step — the value the phone shows beside it. */
let macFingerprint: string | null = null;

/**
 * Keeps the displayed code alive. The token does not change, so a code scanned minutes ago still
 * works; this only stops the window closing under a user who is still walking to their phone.
 */
async function keepPairingArmed(): Promise<void> {
  const status = await connect.status();
  if (status?.paired) return;
  await showQr();
}

/**
 * The log tail, held here because the node it draws into only exists while Settings \u2192 Advanced
 * is on screen. Keeping the text and painting it on build is what lets the 15s refresh keep
 * running whether or not anybody is looking at it.
 */
let lastLogTail = '';

async function refreshLogs(): Promise<void> {
  lastLogTail = (await connect.logTail(120)).join('\n');
  const node = document.getElementById('logs');
  if (node) node.textContent = lastLogTail;
}

// Connect / Disconnect / Retry / Forget / the two addresses / Refresh log all moved into the
// Settings panes registered further down. Only the pairing screen's own button is bound here,
// because the pairing screen is static markup rather than a built pane.
el('new-qr').addEventListener('click', () => {
  hidePairRejection();
  void showQr(true);
});

/*
 * The pairing screen never opens without a code. The code was drawn at launch only when unpaired
 * and then by the 60 s re-arm, so a pairing screen reached any other way — a repudiation mid-session
 * routes here, and so does ⌘K — drew a broken <img> with its alt text for up to a minute. Not
 * rotated: this arms the same code `showQr()` would, it does not invalidate one on screen.
 */
/*
 * The macOS menu bar, built from the list the sidebar and the palette already read.
 *
 * Handing the list over rather than writing one in the main process is the same rule the nav rows
 * and the ⌘K palette follow: one list, three surfaces, so a route added to `SCREENS` appears in
 * all three or in none. Pairing is left out deliberately — it is not a place to go, it is a place
 * the app puts you.
 *
 * The accelerators become the menu's, which means ⌘1…⌘0 no longer reach this page's keydown
 * handler. They arrive here instead, and call the same `shell.route` the sidebar calls: one
 * navigation path, not two.
 */
void connect.menuSetRoutes(SCREENS.map((s) => ({ id: s.id, label: s.label, shortcut: s.shortcut })));
connect.onMenuRoute((id) => {
  if (id === '__palette__') shell.openPalette();
  else shell.route(id);
});

shell.onRoute((id) => {
  if (id === 'pairing' && !el<HTMLImageElement>('qr').getAttribute('src')) void showQr();
});

/**
 * F7 — the phone refused this pairing.
 *
 * The main process has already armed a fresh code and sends it in the payload, so this draws the
 * explanation and the new QR **together**. Drawing the sentence over the old code would say "here
 * is a fresh one" beside the one that was just refused.
 */
/**
 * The rename notice on the pairing card. The main process decides whether a rename re-pair is still
 * owed and hands over the sentence or `null`; this only draws it. Asked once at startup and told
 * again when it clears, so a notice never outlives the connection that paid for it.
 */
function drawRenameNotice(notice: string | null): void {
  const box = el('pair-rename');
  box.textContent = notice ?? '';
  box.hidden = notice === null;
}
void connect.renameNotice().then((result) => {
  if (result.ok) drawRenameNotice(result.data.notice);
});
connect.onRenameNotice(drawRenameNotice);

function hidePairRejection(): void {
  el('pair-rejection').hidden = true;
}

connect.onPairRejected((info) => {
  if (info.qr) {
    // Rendered from the payload rather than by re-asking, so the code on screen is the same one the
    // phone will be shown — a second `pairingQr` call would rotate the token again.
    void connect.pairingQrRender(info.qr).then((dataUrl) => {
      if (dataUrl) el<HTMLImageElement>('qr').src = dataUrl;
    });
  }
  const box = el('pair-rejection');
  box.replaceChildren();
  const headline = document.createElement('p');
  headline.className = 'pair-notice-headline';
  headline.textContent = info.headline;
  const body = document.createElement('p');
  body.className = 'pair-notice-body';
  body.textContent = info.body;
  box.append(headline, body);
  box.hidden = false;
  shell.route('pairing');
});

/*
 * The sidebar's account block, filled from this Mac rather than from the markup.
 *
 * D1/D2: it read `Chetan Pujari` and `CP`, hardcoded, so every user of this build had the author's
 * name and initials in their own sidebar. There is no account to read a person's name from, so the
 * block says what this Mac is called and what its key is — which is what its second line, `This
 * Mac`, has always claimed it was doing.
 *
 * It fails quietly to the machine's own fallback: `identity.ts` already answers
 * `${username}'s Mac` when `hostname()` is empty, so there is no state in which this draws nothing
 * and no explanation.
 */
void (async () => {
  const self = await connect.selfIdentity().catch(() => ({ name: null, fingerprint: null }));
  const name = self.name ?? 'This Mac';
  el('account-name').textContent = name;
  el('account-avatar').textContent = initialsFor(name);
  if (self.fingerprint) el('account-sub').textContent = `key ${self.fingerprint}…`;
  // The verify step prints it beside the phone's own, so the two can be compared by eye.
  macFingerprint = self.fingerprint ?? null;
  drawPairSteps();
})();

// Mirroring is only offered when the phone actually advertises it, which is the capability
// contract doing its job at the UI layer: no button for a promise the phone has not made.
const mirror = new MirrorView(
  el<HTMLCanvasElement>('mirror-canvas'),
  el('mirror-overlay'),
  el('mirror-notice'),
  el('mirror-stage'),
  connect,
);
mirror.onSessionChange((session) => {
  mirrorSession = session;
  paintMirrorButtons();
});

// Notifications. The pane exists where the phone has promised the feature, and where it has not,
// it now stays and says why in the phone's own words rather than disappearing — the first pane
// rebuilt in the design language, and the first to draw the "unavailable, here is why" state as a
// designed surface instead of an absence. See docs/mac-ui-design-proposals.md §3.
const notifications = new NotificationsView(
  el('notif-card'),
  el('notif-note'),
  el('notif-list'),
  el('notif-notice'),
  el('notif-filters'),
  el('notif-detail'),
  connect,
);

/*
 * The feed's media row reads **the same `remote.state` the Overview widget reads** — handoff §5c's
 * first line, and the reason this is a second listener on one channel rather than a second source:
 * the two surfaces must never disagree about the track, the app or which controls exist. A cleared
 * session (`active: false`) reaches the pane like any other, so the row goes back to being an
 * ordinary notification the moment the music stops.
 */
connect.onRemoteChanged((state) => notifications.setMediaSession(state));
void connect.remoteState().then((state) => notifications.setMediaSession(state)).catch(() => {});

/**
 * A native notification was clicked.
 *
 * Route **and reveal** — routing alone lands the user on a screen they could already reach with no
 * indication of which row answered, which is indistinguishable from a link that failed. This is the
 * deep-link lesson (docs/phase-7-homeless-features.md §2) applied to a banner.
 */
connect.onRevealNotification((key: string) => {
  shell.route('notifications');
  window.requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`#notif-list [data-key="${CSS.escape(key)}"]`);
    if (!row) {
      // Never a silent no-op: the notification may have been dismissed on the phone between the
      // banner and the click, and saying so beats landing on a pane with nothing highlighted.
      shell.toast('That notification is no longer on your phone');
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('deep-reveal');
    window.setTimeout(() => row.classList.remove('deep-reveal'), 1400);
  });
});

/**
 * The macOS permission banner, drawn only once a post has actually been refused.
 *
 * Nothing is claimed before that: Electron exposes no way to read authorization on macOS, and
 * `Notification.isSupported()` answers a different question — it returns `true` on a machine that
 * refuses everything. Measured in docs/phase-7-native-notifications.md §0.
 */
async function refreshNotifPermission(): Promise<void> {
  const state = await connect.notifPermission();
  const banner = el('notif-permission');
  if (!state.refused) {
    banner.hidden = true;
    return;
  }
  banner.replaceChildren();
  const head = document.createElement('p');
  head.style.margin = '0 0 4px';
  const strong = document.createElement('strong');
  strong.textContent = state.headline ?? '';
  head.appendChild(strong);
  const line = document.createElement('p');
  line.style.margin = '0';
  line.textContent = state.body ?? '';
  banner.append(head, line);
  if (state.message) {
    const detail = document.createElement('code');
    // macOS's own sentence, verbatim. Paraphrasing a platform's failure text is what defect 57 was.
    detail.textContent = state.message;
    banner.appendChild(detail);
  }
  banner.hidden = false;
}
// The sound toggle. Reads its state from the main process rather than from the markup's `checked`
// attribute, so the box and the stored preference cannot disagree after a restart.
const notifSound = el<HTMLInputElement>('notif-sound');
void connect.notifSoundGet().then((on) => {
  notifSound.checked = on;
});
notifSound.addEventListener('change', () => {
  void connect.notifSoundSet(notifSound.checked);
});

connect.onNotifChanged(() => void refreshNotifPermission());
void refreshNotifPermission();

// Photos. Fetches when the screen is opened rather than at launch — 12 albums and a page of
// thumbnails is a round trip and a megabyte, and nobody has looked at the screen yet. It is the
// one pane that does **not** consult the capability list: `photos` is not advertised because
// `media.original` needs the bulk channel, while the three verbs this pane uses all answer today.
const photos = new PhotosView(
  {
    mediaBuckets: () => connect.mediaBuckets(),
    mediaList: (options) => connect.mediaList(options),
    mediaThumbs: (options) => connect.mediaThumbs(options),
    mediaOriginal: (options) => connect.mediaOriginal(options),
    mediaPreviewThumb: (options) => connect.mediaPreviewThumb(options),
    mediaPreviewOriginal: (options) => connect.mediaPreviewOriginal(options),
    revealSaved: (options) => connect.revealSaved(options),
  },
  el('photos-card'),
  el('photos-banner'),
  el('photos-note'),
  el('photos-albums'),
  el('photos-tiles'),
  el('photos-detail'),
);
// Feature C: the original being fetched for viewing is drawn from the phone's own progress.
connect.onMediaPreviewAgreed((ticket) => photos.onPreviewAgreed(ticket));
connect.onMessage((envelope) => photos.onTransferEvent(envelope));
shell.onRoute((id) => {
  if (id === 'photos') void photos.refresh();
});

// Apps. Fetches on open like Photos and Files — 122 labels and a megabyte of icons is a round trip
// nobody has asked for until the screen is looked at.
//
// Like Photos, it does **not** gate on the capability: `apps.list` and `apps.icon` answer whether or
// not the chip is green, because the chip is gated on POST_NOTIFICATIONS and only `apps.open.ask`
// needs it. A grid hidden because the doorbell is off would be a working feature turned into a dead
// pane.
const apps = new AppsView(
  {
    appsList: () => connect.appsList(),
    appsIcons: (options) => connect.appsIcons(options),
    appsOpenAsk: (options) => connect.appsOpenAsk(options),
  },
  el('apps-banner'),
  el('apps-note'),
  el<HTMLInputElement>('apps-search'),
  el('apps-grid'),
  el('apps-toast'),
);
shell.onRoute((id) => {
  if (id === 'apps') void apps.refresh();
});
// Files. Fetches on open, like Photos, and for the same reason — the roots are a round trip nobody
// has asked for until the screen is looked at.
//
// Unlike Photos, this pane **does** consult the capability: `files` is advertised (all six verbs
// answer; `push` degrades), so an absent capability here means the phone genuinely is not offering
// the feature, and the honest drawing is the phone's own sentence rather than an empty rail.
// The bridge and the event subscriptions are built by files.ts, where a test can call the same
// functions this page does (defect 156: an inline literal here dropped Pause, Resume and Cancel).
const files = createFilesView(filesBridgeFrom(connect));
shell.onRoute((id) => {
  if (id === 'files') void files?.refresh();
});
/*
 * The one live fact the island shows beside the connection, and the only one this app has.
 *
 * A transfer is *in flight* — it has a beginning, a duration and an end, so it is happening now in
 * the sense the island's rule requires. A clipboard sync is not: `clip-send` is a request and its
 * reply, `clip-arrived` is an instant, and both are history the moment they exist. They are
 * recorded in Activity and acknowledged by the toast, which is what a moment gets.
 */
if (files) files.onWorkChanged = (work) => shell.setWork(work);
// Feature B (2026-09-23) and fs.blocks: the pane's event subscriptions — see wireFilesEvents.
if (files) wireFilesEvents(connect, files);


// Clipboard. Built on all three verbs, and it does not gate itself on the capability for a reason
// the other panes do not have: the interesting failure — the phone being unfocused — is a *state*
// this pane draws a sentence for, not an absence that should grey it out. There is no permission to
// grant, so a grey pane would offer nothing to act on.
const clipboard = new ClipboardView(
  connect,
  el('clip-list'),
  el('clip-wall'),
  el('clip-wall-phone'),
  el('clip-notice'),
  el('clip-phone-state'),
  el('clip-phone-icon'),
  el('clip-phone-headline'),
  el('clip-phone-detail'),
  el<HTMLButtonElement>('clip-phone-action'),
  el<HTMLButtonElement>('clip-send'),
  el<HTMLButtonElement>('clip-request'),
  el<HTMLInputElement>('clip-watch'),
  el('clip-tabs'),
  el('clip-detail'),
  el('clip-foot'),
  el<HTMLButtonElement>('clip-clear'),
);
void clipboard;

// Activity. Fetches on open like Files and Photos, and for a different reason: the log is the
// Mac's own file, so the cost is a disk read rather than a round trip — but a pane nobody has
// opened has no business reading a file either, and the route hook is the same shape.
//
// It is the only pane in the app whose data never comes from the phone, which is why it stays
// drawable while the link is down. That is deliberate: "what happened before it dropped" is
// exactly the question somebody has when it is down.
const activity = new ActivityView(
  {
    activityEvents: () => connect.activityEvents(),
    activityExportCsv: () => connect.activityExportCsv(),
  },
  el('activity-host'),
);
shell.onRoute((id) => {
  if (id === 'activity') void activity.refresh();
});

// Contacts. Same hidden-not-greyed rule as the notifications card above. The search box is wired
// inside the view because the debounce belongs with the thing it debounces.
const contacts = new ContactsView(
  el('contacts-people'),
  el('contacts-note'),
  el<HTMLInputElement>('contacts-search'),
  el('contacts-list'),
  el('contacts-notice'),
  connect,
);

// The media remote. Same hidden-not-greyed rule; `active: false` is handled inside the view as a
// state rather than as an absence, because nothing playing is normal.
const remote = new RemoteView(
  el('remote-card'),
  el('remote-note'),
  el('remote-body'),
  el('remote-notice'),
  connect,
);

// Messages. The pane holds no recipient and offers no way to type one; see sms.ts.
// Four regions rather than one body: the pane is the design's three columns plus the New
// conversation panel as of 2026-09-05, and they have different lifetimes — the thread list survives
// opening a conversation, the chat is replaced by it, and the person card follows the chat.
const sms = new SmsView(
  el('sms-card'),
  el('sms-note'),
  {
    tabs: el('sms-tabs'),
    list: el('sms-list'),
    chatHead: el('sms-chat-head'),
    chatBody: el('sms-chat-body'),
    composer: el('sms-composer'),
    person: el('sms-person'),
    newPanel: el('contacts-card'),
    newButton: el('sms-new'),
    newCancel: el('sms-new-cancel'),
    newTo: el<HTMLInputElement>('sms-new-to'),
    newBody: el<HTMLInputElement>('sms-new-body'),
    newSend: el<HTMLButtonElement>('sms-new-send'),
    state: el('sms-state'),
    threadsFoot: el('sms-threads-foot'),
    // Fills the Calls dialler and goes there; the dialler's own confirm step still stands.
    callNumber: (number: string) => {
      shell.route('calls');
      calls.fillDialler(number);
    },
  },
  el('sms-notice'),
  connect,
);

// Calls. The live card and the log are separate elements because they have different lifetimes:
// the card exists only while a call does, and blanking the log with it would throw away the one
// thing still worth reading.
const calls = new CallsView(
  el('calls-card'),
  el('calls-note'),
  el('call-live'),
  el('calls-body'),
  el<HTMLInputElement>('call-number'),
  el<HTMLButtonElement>('call-dial'),
  el('calls-notice'),
  el('calls-tabs'),
  el('call-keypad'),
  el('call-frequent'),
  connect,
);

/**
 * The six global actions, and their wire names.
 *
 * `power` is deliberately absent and must stay absent: `performGlobalAction` cannot press the
 * power button, and the power *menu* it can open is one stray click away from switching off the
 * phone this Mac is talking to. See docs/protocol.md.
 */
/*
 * The six global actions, wired from navModel.GLOBAL_ACTIONS — the same table shell.ts draws the
 * buttons from, so a seventh action is one edit rather than two that can disagree about which
 * buttons exist. There is no power button here and there cannot be one: no app on Android can
 * press it.
 */
for (const button of GLOBAL_ACTIONS) {
  el(`input-${button.id}`).addEventListener('click', () => void mirror.global(button.action));
}

el('mirror-start').addEventListener('click', () => void mirror.start(selectedQuality()));
el('mirror-stop').addEventListener('click', () => void mirror.stop());

/**
 * The three quality presets from the handoff, carrying the two fields `mirror.start` and
 * `mirror.config` actually accept.
 *
 * `maxResolution` is a **cap on the short edge**, not a resolution to capture at — the phone reads
 * its own panel, scales to fit the cap with the aspect preserved, and rounds both edges even. So
 * "1080p" is an honest name for the request and a misleading claim about the result, which is why
 * the pane draws what the phone actually captured beside it rather than trusting the label. See
 * docs/design-departures.md, M10.
 */
const QUALITY_PRESETS = [
  { id: 'high', title: '1080p · 60 FPS', sub: 'Recommended', maxResolution: 1080, frameRate: 60 },
  { id: 'mid', title: '720p · 30 FPS', sub: 'Smooth on weak links', maxResolution: 720, frameRate: 30 },
  { id: 'low', title: '480p · 30 FPS', sub: 'Battery saving', maxResolution: 480, frameRate: 30 },
] as const;

let quality: (typeof QUALITY_PRESETS)[number] = QUALITY_PRESETS[0];

function selectedQuality(): { maxResolution: number; frameRate: number } {
  return { maxResolution: quality.maxResolution, frameRate: quality.frameRate };
}

function drawQuality(): void {
  const host = el('mirror-quality');
  host.replaceChildren();
  for (const preset of QUALITY_PRESETS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = preset.id === quality.id ? 'quality-row selected' : 'quality-row';
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(preset.id === quality.id));

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'quality-title';
    title.textContent = preset.title;
    const sub = document.createElement('span');
    sub.className = 'quality-sub';
    sub.textContent = preset.sub;
    text.append(title, sub);

    const dot = document.createElement('span');
    dot.className = 'quality-dot';
    dot.setAttribute('aria-hidden', 'true');

    row.append(text, dot);
    row.addEventListener('click', () => {
      quality = preset;
      drawQuality();
      // Mid-session this goes over `mirror.config`, which rebuilds the phone's encoder without a
      // second consent tap. Before a session it is simply the value the next start will send.
      void mirror.setQuality(selectedQuality()).catch(() => {
        /* Not mirroring yet: the value is picked up by the next start. */
      });
    });
    host.appendChild(row);
  }
}
drawQuality();

/**
 * The four Advanced toggles the handoff draws, and why not one of them is drawn as a toggle.
 *
 * A greyed control is a promise that it might one day light up, and for the two walls below that
 * promise is false forever — so the control is removed and the reason replaces it. Each row says
 * which kind it is, because "Android forbids this" and "we have not built it yet" are different
 * facts and a user deciding whether to go looking in Settings needs to know which one they have.
 *
 * These strings live here rather than in the markup so they sit beside the code that knows them,
 * and so a change to the protocol that makes one real is a change in one place.
 */
const ADVANCED_LIMITS = [
  {
    name: 'Sound from phone',
    kind: 'unbuilt' as const,
    why: 'No audio channel exists in the protocol yet. Media audio is possible on Android 10+; ' +
      'call audio never will be.',
  },
  {
    name: 'Show touches',
    kind: 'wall' as const,
    why: 'It is a secure system setting, and changing it needs a signature-level permission this ' +
      'app cannot hold.',
  },
  {
    name: 'Keep screen on',
    kind: 'unbuilt' as const,
    why: 'Nothing on the wire carries it. The phone could hold a wake lock while mirroring.',
  },
  {
    name: 'Phone screen off',
    kind: 'wall' as const,
    // No backticks. This string is set with `textContent`, so markdown does not render — it
    // renders as backticks, which is what shipped. Wire message names are written plainly here;
    // the mono treatment they deserve is a span, and this row has no room for one.
    why: 'Blanking the phone while it mirrors needs a system-signed permission. The mirror.screenoff ' +
      'message is deliberately unimplemented, and a test asserts it is never registered.',
  },
];

function drawAdvancedLimits(): void {
  const host = el('mirror-advanced');
  host.replaceChildren();
  for (const limit of ADVANCED_LIMITS) {
    const row = document.createElement('div');
    row.className = 'limit-row';
    const head = document.createElement('div');
    head.className = 'limit-head';
    const name = document.createElement('span');
    name.className = 'limit-name';
    name.textContent = limit.name;
    const tag = document.createElement('span');
    tag.className = `limit-tag ${limit.kind}`;
    // The two words are the whole point of the row. "Not possible" closes the question; "Not yet"
    // leaves it open, and a user who reads the wrong one either goes hunting through Settings for
    // something that is not there, or stops asking for something we should build.
    tag.textContent = limit.kind === 'wall' ? 'Not possible' : 'Not yet';
    head.append(name, tag);
    const why = document.createElement('p');
    why.className = 'limit-why';
    why.textContent = limit.why;
    row.append(head, why);
    host.appendChild(row);
  }
}
drawAdvancedLimits();

/** A still of what is on screen now. Taken from the Mac's own decoded frames — no phone command. */
el('mirror-capture').addEventListener('click', () => void mirror.saveStill());

/** `mirror.keyframe`. What to press when the picture has torn and is not recovering. */
el('mirror-refresh').addEventListener('click', () => void connect.mirrorKeyframe('Refresh pressed'));

/*
 * **"That was bad."** The main process owns the shortcut (a global one, so the keystroke is taken by
 * the OS and never reaches the mirror canvas to be forwarded to the phone as text) and asks here,
 * because the samples live in this window.
 */
connect.onMarkRequested?.((label: string) => {
  const summary = mirror.markMoment(label);
  void connect.markMoment(summary);
});
/*
 * M5 — the rail's Transfer slot. Its blocker was `fs.*` having no payload spec; that was removed
 * when Files shipped on 2026-09-01.
 *
 * It **routes** rather than opening its own picker. A second push path here would be a second
 * expression of the rule Files already owns — the destination, the resume logic, the overwrite
 * refusal and the copy that explains where things land — and the second expression is the one that
 * stops matching. The mirror session is unaffected by the route: the pane keeps its state, and the
 * floating window exists for watching while doing something else.
 */
el('mirror-transfer').title = 'Opens Files, where transfers in both directions live';
el('mirror-transfer').addEventListener('click', () => shell.route('files'));

/*
 * The "Floating window" button.
 *
 * One call in both states. `floatOpen` is `isOpen ? focus() : open()` in the main process, so this
 * button does not decide which of the two it is doing — it cannot create a second instance even if
 * it is pressed twice before the window has finished loading, which a check up here would not
 * survive. See main/float.ts:openFloat.
 */
el('mirror-float').addEventListener('click', () => {
  // A toggle, not two names for "open". `floatOpen` was called in both states and the main process
  // resolved it as `isOpen ? focus() : open()`, so the second press raised a window the user was
  // trying to dismiss. The button's own label is the state — it is set from `floatButtonLabelsFor`
  // and from nowhere else — so reading it here keeps the two from disagreeing.
  const open = el('mirror-float-label').textContent?.trim() === 'Close floating window';
  void (open ? connect.floatClose() : connect.floatOpen());
});

/**
 * The button's two states, from the one place that owns all three of its strings.
 *
 * Driven by the main process's own view of the window rather than by what this pane last did, so
 * closing the window from its own red light reverts the button here too — the two are not in the
 * same renderer and cannot be kept in step by the click handler.
 */
function drawFloatButton(open: boolean): void {
  const labels = floatButtonLabelsFor(open);
  el('mirror-float-label').textContent = labels.label;
  el('mirror-float').setAttribute('aria-label', labels.description);
  el('mirror-float').setAttribute('title', labels.description);
  el('mirror-float-dot').classList.toggle('hidden', !labels.dot);
}

connect.onFloatChanged((state) => drawFloatButton(state.open));
void connect.floatState().then((state) => drawFloatButton(state?.open ?? false));

/* ================================================================================================
 * Settings, and where the Connection debug card went
 *
 * The old top-of-window "Connection" card had fifteen HUD rows, four link buttons, a manual
 * address, a Tailscale address and a log tail. It exists nowhere in the design, and the shell had
 * no honest place to put a debug card on every screen — but the information behind it is the only
 * thing on this Mac that answers "why is it not connecting", so **none of it was deleted**.
 *
 * The design does have a home for it: §12 Settings → Advanced, "a mono diagnostics block (link,
 * codec, session, reconnects) with a violet caret". So the HUD was reshaped into that block —
 * those four lines are the headline, and every reading that does not fit one of them is listed
 * under it rather than dropped. The buttons and the two addresses went to Settings → Connection,
 * which is where the handoff puts connection controls.
 *
 * `DIAGNOSTICS` is the store. The HUD interval writes into it through [setDiag]; the Advanced pane
 * reads it when it is drawn. That indirection is what lets the readings keep updating once a
 * second whether or not anybody is looking at Settings, without the interval needing to know
 * whether the nodes it writes to exist.
 * ============================================================================================ */

const DIAGNOSTICS: Record<string, string> = {};

/**
 * Record one reading, and update it on screen if the Advanced pane happens to be open.
 *
 * `getElementById` rather than `el()` on purpose: `el()` casts a null into an HTMLElement and the
 * caller finds out one property access later. Here the node genuinely may not exist — the pane is
 * rebuilt on every Settings draw — and "not on screen" is the normal case, not an error.
 */
function setDiag(key: string, value: string): void {
  DIAGNOSTICS[key] = value;
  const node = document.getElementById(`diag-${key}`);
  if (node) node.textContent = value;
}

/** One `label: value` line in the block, carrying the id [setDiag] writes to. */
function diagLine(key: string, label: string): HTMLElement {
  const line = document.createElement('div');
  line.className = 'diagnostics-line';
  line.append(document.createTextNode(`${label}: `));
  const value = document.createElement('span');
  value.id = `diag-${key}`;
  value.textContent = DIAGNOSTICS[key] ?? '—';
  line.appendChild(value);
  return line;
}

/** The two saved addresses, held here because the pane that shows them is rebuilt on every draw. */
let savedManual = '';
let savedTailscale = '';

function addressControl(
  value: string,
  placeholder: string,
  save: (next: string) => Promise<void>,
  onSaved: (next: string) => void,
): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'row';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Save';
  button.addEventListener('click', () => {
    void (async () => {
      await save(input.value.trim());
      onSaved(input.value.trim());
      // Said out loud rather than left to be inferred from a field that looks the same after a
      // save as before one.
      shell.toast(input.value.trim() === '' ? 'Address cleared.' : `Saved ${input.value.trim()}.`);
    })();
  });
  wrap.append(input, button);
  return wrap;
}

// Overview's two new cards. `View all` is the design's own link and goes to the pane that holds
// the same events; Disconnect is the call Settings → Connection makes.
/**
 * Overview's Quick actions, Recent activity and footer strip.
 *
 * A view class rather than three functions in this file, and that is the point: `renderer.ts` is
 * reachable by no test — it needs `connect`, `shell` and a live DOM at module scope — so anything
 * that draws in here is outside every test in the project. `check-renderer-views.mjs` exists
 * because three renderer-only defects shipped green from exactly that position, and the *fourth*
 * was found here by looking at a screenshot: the card took the head of the events array, which the
 * store returns oldest-first, and drew the five oldest events under a heading reading "Recent
 * activity". Moving the drawing into a class is the fix that makes the next one catchable.
 */
const overview = new OverviewView(
  {
    activityEvents: () => connect.activityEvents(),
    disconnect: () => connect.disconnect(),
    // `connect` starts a link the user stopped; `retryNow` skips the backoff of one that is already
    // retrying. Each is a no-op in the other's case, so Reconnect is both, in that order.
    reconnect: async () => {
      await connect.connect();
      await connect.retryNow();
    },
  },
  el('recent-list'),
  el('recent-sub'),
  {
    card: el('security-card'),
    badge: el('security-badge'),
    title: el('security-title'),
    body: el('security-body'),
    actions: el('security-actions'),
  },
  (id, pane) => shell.route(id, pane),
  el('ring-row'),
);

/*
 * O4, and the chrome's three battery slots. Both a fetch and a subscription: the fetch covers a
 * window that opened after the phone reported, which for storage is a minute of "waiting" and for a
 * stationary battery can be an hour.
 *
 * **One arrival, two surfaces, one call site.** The device card, the connected-device strip and the
 * hero were `hidden` for a phase on a comment reading *"nothing subscribes to it"* — written when
 * that was true and left behind when `VitalsFeature` landed. They are fed from the same statement as
 * the ring rather than from a second subscription, so the two cannot drift apart the way the comment
 * drifted from the code.
 */
let lastBattery: { level: number | null; charging: boolean; capacityUnknown: boolean } | null = null;
/** When it arrived on this Mac. `battery.state` carries no timestamp — see `batteryDiagnostic`. */
let lastBatteryAtMs: number | null = null;
const onVitals = (v: { battery: Record<string, unknown> | null; storage: Record<string, unknown> | null }): void => {
  overview.setVitals(v.battery, v.storage);
  // The battery still reaches the shell: the sidebar device card and the connected-device strip
  // draw it. The hero no longer does — departure O11, 2026-09-16 — so `shell.setStorage` is gone
  // with the row it fed, and storage now has exactly one surface, the O4 ring.
  shell.setBattery(v.battery as Parameters<typeof shell.setBattery>[0]);
  if (v.battery) {
    lastBattery = v.battery as typeof lastBattery;
    lastBatteryAtMs = Date.now();
  }
};
void connect.deviceVitals().then(onVitals);
connect.onDeviceVitals(onVitals);
el('recent-all').addEventListener('click', () => shell.route('activity'));
el('recent-all').append(iconSvg('chevron', 14));
// The hero's two actions take their glyphs here rather than in the markup, for the reason every
// other icon in this app does: `index.html` cannot call `iconSvg`, and a hand-inlined <svg> in the
// page is a copy of geometry that `icons.test.ts` cannot see. `prepend` so the label stays the
// element's first text and the accessible name is unchanged.
el('hero-mirror').prepend(iconSvg('mirror', 15));
el('hero-info').prepend(iconSvg('info', 15));
el('hero-activity').prepend(iconSvg('activity', 15));
// The card is redrawn when the screen is opened rather than on a timer: it is five rows off a
// store the main process already holds, and a dashboard that silently refetches every second is a
// cost with nothing behind it.
shell.onRoute((id) => {
  if (id === 'overview') void overview.refresh();
});
void overview.refresh();

/**
 * The version, in one place.
 *
 * It is drawn twice — the About row and the third column's brand card — and two literals is the
 * second one that goes stale. `scripts/check-versions.mjs` already guards `package.json` against the
 * Android build; this keeps the two on-screen copies from being a third and a fourth number.
 */
const APP_VERSION = '2.0.0';
el('settings-version').textContent = `Version ${APP_VERSION}`;

/**
 * Settings → **General**, the handoff's first pane.
 *
 * Two of its five rows are real, one is the design's own greyed control, and two are cut with the
 * reason attached. Departures G1-G4.
 */
shell.addSettingsPane(
  'general',
  'General',
  'How Sidekick behaves on this Mac.',
  () => {
    const body = document.createElement('div');

    body.appendChild(
      settingToggle(
        'Start on login',
        'Open Sidekick when you sign in to this Mac. It starts in the menu bar with no window.',
        async () => {
          const result = await connect.loginItemGet();
          return result.ok ? result.data.openAtLogin : false;
        },
        async (on) => {
          const result = await connect.loginItemSet(on);
          if (!result.ok) return false;
          if (!result.data.honoured) {
            // macOS took the call and did not do it. Named rather than swallowed: the usual cause
            // is a login item the user disabled in System Settings, which no amount of asking again
            // will change.
            shell.toast(
              'macOS did not accept that. Check System Settings → General → Login Items.',
            );
          }
          return result.data.openAtLogin;
        },
      ),
    );

    // A statement, not a toggle: the tray is created unconditionally at launch and closing the
    // window is what keeps notifications and clipboard sync alive. There is no state to flip, and a
    // switch that is permanently on and cannot be turned off is a control in name only.
    body.appendChild(
      settingValue(
        'Keep in the menu bar',
        'Always. Closing the window leaves Sidekick running there, which is what keeps ' +
          'notifications arriving and the clipboard syncing. Quit from the menu bar icon.',
        'Always on',
      ),
    );

    /*
     * Appearance, and it is a real control now.
     *
     * It used to be three `<span>`s with Dark hardcoded on — drawn that way because the handoff
     * says *"Dark is the flagship theme. Light arrives next."* Light has arrived, so the statement
     * of intent becomes a segmented button group: `<button>`s, because they are pressed, and
     * `role=radiogroup` with `aria-checked`, because three mutually exclusive options are a radio
     * group and a screen reader that hears three buttons learns nothing about which is active.
     *
     * The value is read back from the main process's reply rather than assumed from the click —
     * the same reason the Start-on-login toggle flips back when macOS disagrees. `System` is the
     * case that makes this matter: clicking it sets no theme at all, it hands the decision to the
     * OS, and what comes back is whatever the Mac says right now.
     */
    const appearance = document.createElement('span');
    appearance.className = 'segmented';
    appearance.setAttribute('role', 'radiogroup');
    appearance.setAttribute('aria-label', 'Appearance');
    const segments = new Map<string, HTMLButtonElement>();
    for (const [value, label] of [
      ['system', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark'],
    ] as ['system' | 'light' | 'dark', string][]) {
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'segment';
      seg.textContent = label;
      seg.setAttribute('role', 'radio');
      seg.setAttribute('aria-checked', 'false');
      seg.addEventListener('click', () => {
        void (async () => {
          const result = await connect.appearanceSet?.(value);
          if (result?.ok) markAppearance(result.data.appearance, result.data.theme);
        })();
      });
      segments.set(value, seg);
      appearance.appendChild(seg);
    }
    const appearanceNote = document.createElement('span');

    /*
     * The note under the control, and it says what `System` *resolved to* rather than only what was
     * chosen. "System" alone is the half-answer this project keeps writing down: it names the
     * preference and leaves the user to guess what is on screen, which is the one thing they can
     * already see. Naming both is what makes the row readable on a Mac that flipped at sunset.
     */
    function markAppearance(chosen: string, theme: 'light' | 'dark'): void {
      for (const [value, seg] of segments) {
        const on = value === chosen;
        seg.classList.toggle('is-on', on);
        seg.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      appearanceNote.textContent =
        chosen === 'system'
          ? `Following macOS, which is ${theme} right now.`
          : `Always ${theme}, whatever macOS is set to.`;
    }

    void (async () => {
      const result = await connect.appearanceGet?.();
      if (result?.ok) markAppearance(result.data.appearance, result.data.theme);
    })();

    const appearanceControl = document.createElement('span');
    appearanceControl.className = 'appearance-control';
    appearanceControl.append(appearance, appearanceNote);
    body.appendChild(
      settingRow('Appearance', 'Light and dark, or follow the Mac.', appearanceControl),
    );

    body.appendChild(
      settingLimit(
        'Interface sounds',
        'unbuilt',
        'Nothing in this app makes a sound except a native notification, and that switch is on the ' +
          'Notifications pane where it belongs. There are no transfer or alert sounds to turn off.',
      ),
    );
    body.appendChild(
      settingLimit(
        'Automatic updates',
        'unbuilt',
        'There is no update server. Sidekick has no account and talks to nothing but your ' +
          'phone, so there is nowhere for it to check. Updating means installing a new build.',
      ),
    );
    return body;
  },
);

/**
 * Settings → **Device info** (frame `44:23491`) — the capability list's real home, and what D22
 * recorded as owed since Batch 2.
 *
 * It replaces the Overview chip row (D10) and the side-column card that stood in for it: a dot
 * beside a name cannot carry a permission, a limit or a failure, and every one of those is a
 * different sentence. `shared/capabilityStatus.ts` decides which of the five states each feature is
 * in; this only draws it. An action appears **only** where this Mac can really take someone to the
 * fix, which today is nowhere — every one of these grants is changed on the phone, and a button
 * that opens nothing is the greyed-control shape decision 6 rules out.
 */
shell.addSettingsPane(
  'device',
  'Device info',
  'What this phone is, and what it is offering this Mac.',
  () => {
    const body = document.createElement('div');
    const status = lastStatus;
    const connected = status?.phase === 'connected';

    const facts = document.createElement('div');
    facts.className = 'device-facts';
    const factRows: Array<[string, string]> = [
      ['Device', status?.deviceName ?? '—'],
      ['Address', connected ? (status?.address ?? '—') : '—'],
      ['Connection', heroTransportOf(status as unknown as Parameters<typeof heroTransportOf>[0])],
      ['Security', connected ? 'TLS 1.3, pinned' : '—'],
    ];
    for (const [label, value] of factRows) {
      const row = document.createElement('div');
      row.className = 'device-fact';
      const name = document.createElement('span');
      name.className = 'device-fact-label';
      name.textContent = label;
      const val = document.createElement('span');
      val.className = 'device-fact-value mono';
      val.textContent = value;
      row.append(name, val);
      facts.appendChild(row);
    }
    body.appendChild(facts);

    const heading = document.createElement('h3');
    heading.className = 'device-caps-title';
    heading.textContent = 'Capabilities';
    body.appendChild(heading);

    const caption = document.createElement('p');
    caption.className = 'device-caps-sub';
    caption.textContent =
      'One row per feature, with the phone’s own answer. Anything missing is granted on the phone.';
    body.appendChild(caption);

    const list = document.createElement('div');
    list.className = 'device-caps';
    const reasons = new Map((status?.unavailable ?? []).map((u) => [u.name, u.reason]));
    for (const capability of ALL_CAPABILITIES) {
      const row = capabilityRow({
        id: capability,
        label: capabilityLabel(capability),
        // `mic` is unbuilt on **both** ends — there is no audio channel in the protocol and no
        // microphone feature in this app — and the phone says so in its own reason ("not built
        // yet"). Drawing it as *Unavailable* would put the absence on the phone.
        unbuilt: capability === 'mic',
        limitedNote:
          capability === 'mic'
            ? 'Not built: no audio channel exists in the protocol, on either side.'
            : null,
        advertised: status?.capabilities?.includes(capability) ?? false,
        reason: reasons.get(capability) ?? null,
        connected,
      });
      list.appendChild(capabilityRowEl(row));
    }
    // Camera is not a wire capability at all — it is a pane this build does not have. It is listed
    // because a feature the user can see in the sidebar and not in this list reads as an oversight,
    // and `unbuilt` is the state that says whose absence it is. No action, no "coming soon".
    list.appendChild(
      capabilityRowEl(
        capabilityRow({
          id: 'camera',
          label: 'Camera',
          unbuilt: true,
          limitedNote: 'Not built: the virtual webcam needs a signed macOS system extension.',
          advertised: false,
          reason: null,
          connected,
        }),
      ),
    );
    body.appendChild(list);
    return body;
  },
);

shell.addSettingsPane(
  'connection',
  'Connection',
  'How this Mac finds the phone, and what to do when it cannot.',
  () => {
    const body = document.createElement('div');

    const links = document.createElement('div');
    links.className = 'row';
    for (const [label, run] of [
      ['Connect', () => void connect.connect()],
      ['Disconnect', () => void connect.disconnect()],
      ['Retry now', () => void connect.retryNow()],
    ] as [string, () => void][]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', run);
      links.appendChild(button);
    }
    body.appendChild(
      settingRow('Link', 'Discovery order: last known address, then the default gateway, then mDNS.', links),
    );

    body.appendChild(
      settingRow(
        'Manual address',
        'Used only when the last known address, the default gateway and mDNS all fail.',
        addressControl('', '192.168.1.42', (next) => connect.setManualAddress(next), (next) => {
          savedManual = next;
        }),
      ),
    );
    body.appendChild(
      settingRow(
        'Tailscale address',
        'Optional. Nothing works outside the local network without one; this is the documented path.',
        addressControl('', '100.x.y.z', (next) => connect.setTailscaleAddress(next), (next) => {
          savedTailscale = next;
        }),
      ),
    );

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'danger';
    forget.textContent = 'Forget this phone';
    forget.addEventListener('click', () => {
      void (async () => {
        await connect.forgetDevice();
        render(await connect.status());
        await showQr();
      })();
    });
    body.appendChild(
      settingRow(
        'Trusted device',
        'Removes the phone\u2019s certificate from the trust store. You will pair again from scratch.',
        forget,
      ),
    );

    // The saved values are filled in after construction so the two inputs above stay one helper.
    const inputs = body.querySelectorAll('input');
    if (inputs[0]) inputs[0].value = savedManual;
    if (inputs[1]) inputs[1].value = savedTailscale;
    return body;
  },
);

/**
 * Settings → **Notifications**.
 *
 * The design's four rows are *Mirror phone notifications*, *Per-app filters*, *Quiet hours* and
 * *Inline replies*. Two of the four are real here and neither is a toggle: mirroring is on whenever
 * the phone's listener grant is, and inline reply is on whenever the notification carries a
 * `RemoteInput`. Both are **facts about a grant**, and a switch beside a fact is a control that
 * cannot change it. Departures G5-G7.
 */
shell.addSettingsPane(
  'notifications',
  'Notifications',
  'What reaches this Mac, and what macOS does with it.',
  () => {
    const body = document.createElement('div');

    // The refusal state, first, because it is the one thing that makes everything below moot. It is
    // **reactive by necessity**: `Notification.isSupported()` returns true on a machine that
    // refuses every banner, and Electron exposes no way to read macOS authorization. So nothing is
    // claimed until a post has actually failed, and then this says exactly what macOS said.
    const state = document.createElement('div');
    state.className = 'setting-note';
    state.textContent = 'Checking what macOS has said about notifications…';
    body.appendChild(state);
    void connect.notifPermission().then((permission) => {
      state.className = permission.refused ? 'setting-note is-warning' : 'setting-note';
      state.textContent = permission.refused
        ? `${permission.headline ?? 'macOS refused a notification.'} ${permission.body ?? ''}`
        : 'No banner has been refused by macOS in this session. Nothing is claimed before one is — ' +
          'there is no way to read the permission itself, so this is a report rather than a check.';
    });

    body.appendChild(
      settingToggle(
        'Play a sound',
        'Off by default. The phone in your pocket has already made a sound for this notification, ' +
          'and a second one per message is what makes people uninstall a mirror.',
        () => connect.notifSoundGet(),
        (on) => connect.notifSoundSet(on),
      ),
    );

    body.appendChild(
      settingValue(
        'Mirror phone notifications',
        'On whenever the phone’s notification-listener grant is. There is no switch here because ' +
          'there is nothing this Mac could switch — revoking it is a phone setting.',
        'Follows the grant',
      ),
    );
    body.appendChild(
      settingValue(
        'Inline replies',
        'On for every notification that carries one. Whether a reply box exists is the sending ' +
          'app’s decision, not a setting.',
        'Where the app offers it',
      ),
    );
    body.appendChild(
      settingLimit(
        'Per-app filters',
        'unbuilt',
        'Nothing on the wire carries a per-app rule, and a list held only on this Mac would be a ' +
          'filter the phone keeps sending through. The suppression rules that do run — group ' +
          'headers, ongoing statuses, replayed backlog — are facts about a notification rather ' +
          'than opinions about an app, deliberately.',
      ),
    );
    body.appendChild(
      settingLimit(
        'Quiet hours',
        'unbuilt',
        'macOS already has one, and it applies to this app’s banners like any other. A second ' +
          'schedule here would be a rule that silently disagrees with the system’s.',
      ),
    );
    return body;
  },
);

/**
 * Settings → **File transfer**.
 *
 * The departures file has carried this pane as *"real; blocked on Phase 5, ships with the
 * feature"* since 2026-08-30. Phase 5 shipped on 2026-09-01 and the pane did not. Every row is a
 * value rather than a control, and that is the honest shape: the destination is fixed, the naming
 * rule is fixed, and there is no conversion. Departures T1-T3.
 */
shell.addSettingsPane(
  'transfer',
  'File transfer',
  'Where files land, and what they are called when they get there.',
  () => {
    const body = document.createElement('div');

    // T1, made real on 2026-09-23: **Choose…** stores a folder the main process has already checked
    // it can write to; **Use default** puts it back. Neither moves a file already saved.
    const controls = document.createElement('div');
    controls.className = 'setting-actions';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.id = 'settings-receive-choose';
    choose.textContent = 'Choose…';
    const useDefault = document.createElement('button');
    useDefault.type = 'button';
    useDefault.id = 'settings-receive-default';
    useDefault.textContent = 'Use default';
    useDefault.hidden = true;
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.textContent = 'Reveal in Finder';
    reveal.addEventListener('click', () => {
      void connect.downloadsReveal().then((result) => {
        // A chosen folder that has gone is refused with its name, never recreated — say which.
        shell.toast(result.ok ? `Opened ${result.data.path}` : (result.reason ?? 'Could not open the folder.'));
      });
    });
    controls.append(choose, useDefault, reveal);
    const macRow = settingRow(
      'Save downloads to',
      'Where files from your phone land on this Mac — Files, Photos and anything sent from the ' +
        'phone. Changing it does not move files already saved.',
      controls,
    );
    // The path is read from the main process rather than written here, because it is written in
    // exactly one place (`main/downloads.ts`) and a settings screen showing a folder the app does
    // not use is worse than no settings screen: it is the screen somebody consults when they cannot
    // find their file.
    const path = document.createElement('span');
    path.className = 'setting-path mono';
    path.textContent = 'reading…';
    macRow.querySelector('.setting-row-text')?.appendChild(path);
    body.appendChild(macRow);

    // Earlier downloads: ConnectSuite saved into `~/Downloads/ConnectSuite` before the rename, and
    // those files stay exactly where they are. Drawn only when the main process reports that the
    // folder exists; its one action reveals it and can never create, move or change anything.
    const legacyRow = document.createElement('div');
    legacyRow.hidden = true;
    body.appendChild(legacyRow);

    const showFolder = (): void => {
      void connect.downloadsFolder().then((result) => {
        if (!result.ok) return;
        path.textContent = result.data.chosen ? result.data.path : `${result.data.path} (default)`;
        useDefault.hidden = !result.data.chosen;
      });
    };
    choose.addEventListener('click', () => {
      void connect.downloadsChoose().then((result) => {
        if (result.ok) shell.toast(`Files from your phone will be saved to ${result.data.path}`);
        else if (result.reason && result.reason !== 'cancelled') shell.toast(result.reason);
        showFolder();
      });
    });
    useDefault.addEventListener('click', () => {
      void connect.downloadsUseDefault().then((result) => {
        if (result.ok) shell.toast(`Back to ${result.data.path}`);
        showFolder();
      });
    });

    void connect.downloadsFolder().then((result) => {
      if (!result.ok) return;
      path.textContent = result.data.chosen ? result.data.path : `${result.data.path} (default)`;
      useDefault.hidden = !result.data.chosen;
      const legacyPath = result.data.legacyPath;
      if (!legacyPath) return;
      const show = document.createElement('button');
      show.type = 'button';
      show.textContent = 'Show in Finder';
      show.addEventListener('click', () => {
        void connect.downloadsRevealLegacy().then((revealed) => {
          shell.toast(revealed.ok ? `Opened ${revealed.data.path}` : (revealed.reason ?? 'Could not open the folder.'));
        });
      });
      const row = settingRow(
        'Earlier downloads',
        'Files saved by ConnectSuite remain in ~/Downloads/ConnectSuite.',
        show,
      );
      legacyRow.replaceWith(row);
    });

    body.appendChild(
      settingValue(
        'Send to the phone',
        'Files sent from this Mac arrive in the folder open in the Files pane. Received files — ' +
          'Download/ConnectSuite on the phone — needs no permission of any kind, so it works on a ' +
          'phone that has shared nothing.',
        'The open folder',
      ),
    );
    body.appendChild(
      settingValue(
        'Duplicate handling',
        'A name that already exists gets a numbered suffix, in both directions: a file sent to the ' +
          'phone over a name already there arrives as “name (2)”. Nothing is ever overwritten.',
        'Keep both',
      ),
    );
    body.appendChild(
      settingValue(
        'Keep original filenames',
        'The phone’s name is used as-is, apart from the suffix above.',
        'On',
      ),
    );
    body.appendChild(
      settingLimit(
        'Convert HEIC to JPEG',
        'unbuilt',
        'Photos arrive exactly as the phone stored them. Converting would mean decoding every ' +
          'image on this Mac and handing you a file that is not the one on your phone, so it is a ' +
          'decision rather than a missing checkbox.',
      ),
    );
    body.appendChild(
      settingValue(
        'Transfer over Wi-Fi only',
        'There is nothing else to use. This Mac only ever talks to the phone over your own ' +
          'network or a USB link — never over mobile data, because it never leaves the local ' +
          'network at all.',
        'Always',
      ),
    );
    return body;
  },
);

shell.addSettingsPane(
  'advanced',
  'Advanced',
  'Diagnostics. This is where the Connection debug card went — nothing it showed was dropped.',
  () => {
    const body = document.createElement('div');

    /*
     * The handoff's four lines, in its order. They are a *summary*: `link` is the transport and
     * address, `codec` is what the video pipeline settled on, `session` is what this link has
     * managed, `reconnects` is what it has cost. Everything the HUD measured that does not fit one
     * of the four is in the full list below rather than thrown away — a summary that quietly drops
     * the peak latency is the same shape as a failure count with no success count.
     */
    const headline = document.createElement('div');
    headline.className = 'diagnostics';
    headline.append(
      diagLine('link', 'link'),
      diagLine('codec', 'codec'),
      diagLine('session', 'session'),
    );
    const reconnects = diagLine('reconnects', 'reconnects');
    const caret = document.createElement('span');
    caret.className = 'diagnostics-caret';
    caret.textContent = '\u258c';
    reconnects.appendChild(caret);
    headline.appendChild(reconnects);
    body.appendChild(headline);

    const detail = document.createElement('div');
    detail.className = 'diagnostics';
    for (const [key, label] of [
      ['state', 'state'],
      ['via', 'found via'],
      ['address', 'address'],
      ['device', 'phone'],
      ['rtt', 'round trip'],
      ['capture', 'capture'],
      ['rotation', 'rotation'],
      ['fps', 'frame rate'],
      ['bitrate', 'bitrate'],
      ['dropped', 'dropped'],
      ['latency', 'latency'],
      ['latency-link', '  phone \u2192 Mac'],
      ['latency-decode', '  Mac \u2192 painted'],
      ['ttff', 'first frame'],
      ['battery', 'battery'],
      ['error', 'last error'],
    ] as [string, string][]) {
      detail.appendChild(diagLine(key, label));
    }
    body.appendChild(detail);

    const log = document.createElement('pre');
    log.className = 'log-tail';
    log.id = 'logs';
    log.textContent = lastLogTail;
    body.appendChild(log);

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh log';
    refresh.addEventListener('click', () => void refreshLogs());
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(refresh);
    body.appendChild(row);

    return body;
  },
);

shell.addSettingsPane(
  'about',
  'About',
  'Sidekick for macOS. No cloud, no account, no relay server.',
  () => {
    const body = document.createElement('div');
    const version = document.createElement('span');
    version.className = 'setting-value';
    version.textContent = APP_VERSION;
    body.appendChild(settingRow('Version', 'The Electron app in desktop/.', version));

    /*
     * The handoff's About column also carries an Account card, a two-factor row, "Sign out
     * everywhere" and "You are up to date". All four describe a product with accounts and an
     * update server, and this one has neither — CLAUDE.md's first line. Rather than draw them
     * greyed, which is a promise they might light up, the pane says what is actually true.
     * Departures row X2.
     */
    const scope = document.createElement('span');
    scope.className = 'setting-value';
    scope.textContent = 'local network only';
    body.appendChild(
      settingRow(
        'Where your data goes',
        'Nowhere. There is no account, no telemetry and no relay: the Mac talks to the phone over ' +
          'TLS 1.3 on your own network, and to nothing else.',
        scope,
      ),
    );
    return body;
  },
);

/**
 * The debug HUD, once a second.
 *
 * Three of these numbers come from the phone and cannot be worked out here: the capture geometry
 * it settled on, the frames it dropped before they reached the wire, and the clock reading that
 * makes latency measurable. The rest are measured on this side of the link.
 */
setInterval(() => {
  void (async () => {
    const decoded = mirror.stats();
    const link = await connect.mirrorStats();
    const phone = link.phone;

    // "83 frames" is cumulative and outlives the session; the fps beside it is a live rate. When
    // the rate is null the session is not delivering, and saying so in words is what stops the
    // pair being read as "83 frames arriving at 0 fps".
    el('mirror-stats').textContent =
      decoded.framesDecoded === 0
        ? ''
        : decoded.fps === null
          ? `${decoded.framesDecoded} frames · no frames arriving`
          : `${decoded.framesDecoded} frames · ${decoded.fps} fps`;

    const capture = decoded.capture;
    setDiag(
      'capture',
      capture?.width ? `${capture.width}x${capture.height} (cap ${capture.maxResolution}p)` : '—',
    );
    // Blank until the phone has actually turned once: "0°" would claim a measurement that has not
    // been made, and the phone only sends `mirror.rotate` when its rotation changes.
    setDiag('rotation', decoded.rotation === null ? '—' : `${decoded.rotation}°`);

    // The Mirror pane's own two readouts, from the same source as the diagnostics above so the two
    // cannot disagree. The rail shows the rotation rather than offering to change it:
    // `mirror.rotate` is phone-to-Mac only and the Mac cannot turn a phone — departures M2.
    el('mirror-rotation-readout').textContent =
      decoded.rotation === null ? '—' : `${decoded.rotation}°`;
    // What the phone actually captured, beside the preset that asked for it. `maxResolution` is a
    // cap on the short edge, so the preset name is a request and this is the result — M10.
    el('mirror-actual').textContent = capture?.width
      ? `Capturing ${capture.width}×${capture.height} · cap ${capture.maxResolution} on the short edge`
      : 'Not capturing.';
    // Both sides: a phone encoding 60 and a Mac painting 30 is a link problem, and one number
    // alone cannot tell you that.
    setDiag(
      'fps',
      decoded.fps === null && link.framesPerSecond === null
        ? '—'
        : `${decoded.fps ?? '—'} painted · ${link.framesPerSecond ?? '—'} received`,
    );
    setDiag(
      'bitrate',
      link.kbps === null || link.kbps === 0 ? '—' : `${(link.kbps / 1000).toFixed(1)} Mbps`,
    );
    setDiag(
      'dropped',
      phone?.droppedFrames === undefined ? '—' : `${phone.droppedFrames} on the phone`,
    );
    // Three figures, not one. The total is what the mirror feels like; the two halves are what
    // say which machine to look at when it feels wrong — the phone's encoder and the network, or
    // this Mac's IPC, decoder and canvas. A single number cannot separate them, which is the
    // whole reason the split exists.
    setDiag(
      'latency',
      decoded.latencyMs === null
        ? '—'
        : `${decoded.latencyMs} ms (peak ${decoded.latencyPeakMs} ms)`,
    );
    setDiag('latency-link', decoded.latencyLinkMs === null ? '—' : `${decoded.latencyLinkMs} ms`);
    setDiag(
      'latency-decode',
      decoded.latencyDecodeMs === null ? '—' : `${decoded.latencyDecodeMs} ms`,
    );
    setDiag('ttff', decoded.timeToFirstFrameMs === null ? '—' : `${decoded.timeToFirstFrameMs} ms`);

    /*
     * The handoff's four summary lines, composed from the readings above rather than measured
     * separately — so a summary line can never disagree with the detail line under it.
     *
     * `session` is frames beside elapsed time and `codec` is a resolution beside a rate, both
     * because a count with no denominator reads as whichever story the reader already believes.
     * `reconnects` is the one figure nothing on this Mac counts yet, and it says so: `not counted`
     * rather than `0`, which would be a claim that the link has never dropped.
     */
    setDiag('link', `${DIAGNOSTICS.via ?? '—'} · ${DIAGNOSTICS.address ?? '—'} · ${DIAGNOSTICS.rtt ?? '—'}`);
    setDiag(
      'codec',
      capture?.width
        ? `h264 · ${capture.width}x${capture.height} · ${DIAGNOSTICS.bitrate ?? '—'}`
        : 'h264 · not capturing',
    );
    setDiag(
      'session',
      decoded.framesDecoded === 0
        ? 'no frames this session'
        : `${decoded.framesDecoded} frames · ${decoded.fps ?? '—'} fps · first frame ${DIAGNOSTICS.ttff ?? '—'}`,
    );
    setDiag('reconnects', 'not counted on this build');
    /*
     * The reading the device card and the strip have no room to explain, and the one line in the
     * app that must never be blank about the battery — Advanced is where somebody looks *because*
     * the chrome is showing nothing.
     *
     * It read `not subscribed on this build (battery.state is unhandled)` for a phase. That was
     * true of the build it was written for and false of every build after `VitalsFeature` landed,
     * which is the shape `CLAUDE.md` calls a true sentence about the wrong one of two things: the
     * claim describes a real state of the world, just not this one, so nobody reading it against
     * the code ever finds it wrong.
     */
    setDiag('battery', batteryDiagnostic(lastBattery, lastBatteryAtMs, Date.now()));
  })();
}, 1_000);

connect.onStatus(render);
connect.onPhoneError((payload) => {
  const text = payload.fixHint
    ? `${payload.code}: ${payload.message} — ${payload.fixHint}`
    : `${payload.code}: ${payload.message}`;
  setDiag('error', text);
  // The toast, not the island. A refusal is a thing that just happened — the island holds current
  // state and a refusal is over by the time it is drawn. The durable copies are the Activity row
  // and the diagnostics block; this is the part that says *go and look*, while the user is still
  // looking at whatever they did to cause it.
  shell.toast(text);
});

/*
 * **Nothing subscribes an island to `activity.record` any more, and that is the fix rather than an
 * omission.**
 *
 * S6 wired recorded events into a six-slot ring the island cycled every 5.2 s. The ring had no
 * clock — `ActivityEvent.at` was dropped by `islandLineFor`'s signature and the ring was never
 * cleared — so a copy or a refusal from the start of the session kept coming round for the rest of
 * it, painted in whatever tone the link happened to have at that instant. `Sent to phone · 57
 * bytes` in red during an outage is the island asserting a send that is not happening.
 *
 * A recorded event is history by definition: `activity.record` is the act of writing it down. Its
 * home is the Activity pane, which holds all eleven categories with their timestamps and their
 * filters. The island holds current state, and the two live facts it can add to the connection —
 * a transfer in flight — reach it through `shell.setWork`.
 */

/* ================================================================================================
 * ⌘K commands
 *
 * The four the handoff names, wired to the same functions the buttons call rather than to copies
 * of them. `shell.ts` ranks them above navigation and refuses to swallow a keystroke for a command
 * nothing is wired to — it says which one, in the island — so an unwired id is visible rather than
 * a dead Enter key.
 * ============================================================================================ */

/*
 * The Overview hero's two actions. `Start mirroring` is the same call the Mirror pane's button
 * makes — one function, not a second copy that can drift — and it routes first, so the user ends
 * up looking at the picture they just asked for rather than at a dashboard that says nothing
 * happened.
 */
el('hero-mirror').addEventListener('click', () => {
  shell.route('mirror');
  // A running session is opened, never started twice — the label says which, from the same fact.
  if (el('hero-mirror').dataset.session && el('hero-mirror').dataset.session !== 'idle') return;
  void mirror.start(selectedQuality());
});
el('hero-info').addEventListener('click', () => shell.route('settings', 'connection'));
// The pill row's third action — brief-chosen, since the handoff only draws two. Same destination
// `#recent-all` already routes to; not a second copy of that decision, just a second door to it.
el('hero-activity').addEventListener('click', () => shell.route('activity'));

/*
 * **The hero has no overflow menu — removed 2026-09-16, departure O16.**
 *
 * The handoff draws exactly one `•••` on this window, in the page toolbar
 * (`[ Search ⌘K ] [ Device settings ] [ Floating window ] [ ••• ]`), and the Overview device card
 * has none — its only controls are *Start mirroring* and *Device info*. A second overflow 100px
 * below the first put two menu triggers in one viewport with no rule telling a person which one
 * holds what.
 *
 * **Both of its items already had another home, and that was checked before the button came out
 * rather than asserted after.** Disconnect is the footer strip's own button on this very pane and
 * a row in Settings → Connection; *Forget this phone* is the `danger` button in Settings →
 * Connection, under the Trusted device row. Nothing lost a route.
 *
 * What went with it: `#hero-more`, `#hero-menu`, `.hero-more`, `.hero-menu`, `.hero-menu-item` and
 * the outside-click and Escape dismissal this file had to carry for it.
 */

shell.onCommand('mirror.start', () => {
  shell.route('mirror');
  void mirror.start(selectedQuality());
});
shell.onCommand('mirror.stop', () => void mirror.stop());
shell.onCommand('float.toggle', () => void connect.floatOpen());
shell.onCommand('mirror.capture', () => {
  void (async () => {
    await mirror.saveStill();
    // The handoff's toast, on the handoff's trigger. Said only after the save returns, so it is a
    // report rather than an intention.
    shell.toast('Screenshot saved to Desktop');
  })();
});

void (async () => {
  const status = await connect.status();
  render(status);
  // Pulls the set the main process already holds. The events are pushed, so a window that opened
  // after the phone connected would otherwise show an empty pane until something new arrived.
  await notifications.refresh();
  await remote.refresh();
  const settings = await connect.settings();
  savedManual = settings.manualAddress ?? '';
  savedTailscale = settings.tailscaleAddress ?? '';
  shell.refreshSettings();
  if (!status?.paired) await showQr();
  await refreshLogs();
  setInterval(() => void refreshLogs(), 15_000);
  setInterval(() => void keepPairingArmed(), 60_000);
  /*
   * P5's tick. One second, and only while the pairing screen is the one on show — a timer that
   * redraws a hidden pane is work nobody can see, and `status()` is an IPC round trip.
   *
   * It runs *beside* the 60 s re-arm rather than instead of it. The re-arm is what keeps a code
   * alive for a user walking to their phone; this is what tells them when the re-arm has stopped,
   * which is the case the re-arm cannot cover and the only one where the number means anything.
   */
  setInterval(() => {
    if (shell.screen === 'pairing') void drawCodeState();
  }, 1_000);
})();

/*
 * Incoming files from the phone (Feature A, version 2 — live on both sides since `cb7e982`/`cd9d95d`).
 * The tray stays hidden until an offer arrives. See shareReceive.ts
 * for what this page may and may not do — it draws, and asks for the receive window to be shown.
 */
{
  const trayEl = document.getElementById('share-tray');
  const liveEl = document.getElementById('share-live');
  if (trayEl && liveEl && connect.shareWindowShow) {
    // The card cannot decide; it can only bring the receive window back (docs/feature-a-receive-window.md).
    const show = connect.shareWindowShow.bind(connect);
    const tray = new ShareReceiveTray(trayEl, liveEl, (offerId) => show(offerId));
    connect.onShareOffers?.((offers) => tray.update(offers));
    void connect.shareOffers?.().then((offers) => tray.update(offers));
  }
}
