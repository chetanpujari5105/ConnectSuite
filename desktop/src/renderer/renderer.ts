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
  rttMs?: number;
  lastError?: string;
  nextRetryInMs?: number;
  paired: boolean;
}

interface ConnectBridge {
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
  pairingQr(rotate?: boolean): Promise<{ payload: { host: string; name: string }; dataUrl: string }>;
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
  mirrorKeyframe(): Promise<void>;
  mirrorConfig(options: Record<string, unknown>): Promise<{ ok: boolean }>;
  mirrorCapture(dataUrl: string): Promise<{ ok: boolean; path?: string; reason?: string }>;

  /**
   * The detached mirror window. Lifecycle only — this pane opens it and is told when it changes,
   * and never reads or writes its coordinates. See main/float.ts.
   */
  floatOpen(): Promise<{ open: boolean } | null>;
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
  onClipChanged(callback: () => void): void;
  onClipArrived(callback: (entry: ClipEntryRow) => void): void;

  // Files, both directions. `fsPush` arrived with the phone's receiver in slice 8, `fsPull` and
  // `fsDrag` with drag to Finder in slice 9. The upload affordance is still gated — on the phone's
  // own `push` field in the roots ack, never on these methods existing.
  fsRoots(): Promise<
    | { ok: true; data: { roots: FsRootRow[]; grantHint: string | null; push: boolean } }
    | { ok: false; reason?: string; fixHint?: string; code?: string }
  >;
  fsPush(options: {
    rootId: string;
    path: string;
    source: string;
    overwrite?: boolean;
  }): Promise<{ ok: boolean; bytes?: number; reason?: string; code?: string; fixHint?: string }>;
  fsPull(options: {
    rootId: string;
    id: string;
    name: string;
    size: number;
  }): Promise<{ ok: boolean; path?: string; bytes?: number; verified?: boolean; reason?: string }>;
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
  onPhoneError(callback: (payload: { code: string; message: string; fixHint?: string }) => void): void;
}

declare const connect: ConnectBridge;

const ALL_CAPABILITIES = [
  'mirror', 'input', 'notifications', 'sms', 'calls', 'contacts',
  'files', 'photos', 'clipboard', 'remote', 'apps', 'mic',
];

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * One pass over everything the link's state changes.
 *
 * The shell owns the chrome — device card, connected-device strip, Overview hero, status island —
 * and is handed the status once. It is deliberately *one* call: those four are four views of one
 * fact, and the last time two views of one fact were fed separately in this codebase it was
 * defect 27, a reason going stale in one place and not the other.
 */
function render(status: RendererStatus | null): void {
  shell.setStatus(status);

  setDiag('state', status?.phase ?? '—');
  setDiag('via', status?.via ?? '—');
  setDiag('address', status?.address ?? '—');
  setDiag('rtt', status?.rttMs === undefined ? '—' : `${status.rttMs} ms`);
  setDiag('device', status?.deviceName ?? '—');
  setDiag('error', status?.lastError ?? 'none');

  // The button is enabled only while the phone advertises `mirror`. Anything else would offer
  // the user an action the phone has already said it cannot perform.
  const canMirror = status?.capabilities?.includes('mirror') ?? false;
  el<HTMLButtonElement>('mirror-start').disabled = !canMirror;
  el<HTMLButtonElement>('mirror-stop').disabled = !canMirror;

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
  photos.setAdvertised(status?.capabilities?.includes('photos') ?? false);
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
  remote.setAdvertised(status?.capabilities?.includes('remote') ?? false);
  sms.setAdvertised(status?.capabilities?.includes('sms') ?? false);
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
    : 'Controlling the phone needs ConnectSuite Input turned on under Accessibility on the ' +
      'phone. Mirroring works without it; clicking does not.';

  const caps = el('caps');
  caps.replaceChildren();
  for (const capability of ALL_CAPABILITIES) {
    const chip = document.createElement('span');
    const on = status?.capabilities?.includes(capability) ?? false;
    chip.className = `cap${on ? ' on' : ''}`;

    // The name is the visible text. The *state* used to be the background colour and nothing
    // else, which made this pane unreadable to anyone not seeing green-on-grey — a screen reader
    // announced twelve capability names and no indication which were on (defect 26). The state,
    // and the phone's reason for it (defect 24), go in a visually hidden span so they are part of
    // the accessible name rather than a parallel channel that can drift from it.
    chip.append(document.createTextNode(capability));
    const spoken = document.createElement('span');
    spoken.className = 'visually-hidden';
    const reason = reasons.get(capability);
    // chipLabel is the whole sentence; the visible text is already the name, so only the tail
    // goes in the hidden span. One function so the test and the page cannot disagree.
    spoken.textContent = chipLabel(capability, on, reason).slice(capability.length);
    chip.append(spoken);

    // Sighted users get the same sentence on hover. Not a replacement for the above: a title is
    // not reliably reachable by keyboard or touch, which is why the hidden text is the primary.
    if (!on && reason) chip.title = `${capability}: ${reason}`;

    caps.append(chip);
  }
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

async function showQr(rotate = false): Promise<void> {
  const { payload, dataUrl } = await connect.pairingQr(rotate);
  el<HTMLImageElement>('qr').src = dataUrl;
  el('qr-note').textContent = `${payload.name} at ${payload.host} — valid while this code is on screen.`;
}

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

/**
 * F7 — the phone refused this pairing.
 *
 * The main process has already armed a fresh code and sends it in the payload, so this draws the
 * explanation and the new QR **together**. Drawing the sentence over the old code would say "here
 * is a fresh one" beside the one that was just refused.
 */
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
  headline.className = 'pair-rejection-headline';
  headline.textContent = info.headline;
  const body = document.createElement('p');
  body.className = 'pair-rejection-body';
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
})();

// Mirroring is only offered when the phone actually advertises it, which is the capability
// contract doing its job at the UI layer: no button for a promise the phone has not made.
const mirror = new MirrorView(
  el<HTMLCanvasElement>('mirror-canvas'),
  el('mirror-overlay'),
  el('mirror-notice'),
  connect,
);

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
  },
  el('photos-card'),
  el('photos-banner'),
  el('photos-note'),
  el('photos-albums'),
  el('photos-tiles'),
  el('photos-detail'),
);
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
const files = createFilesView({
  fsRoots: () => connect.fsRoots(),
  fsList: (options) => connect.fsList(options),
  fsPush: (options) => connect.fsPush(options),
  fsPull: (options) => connect.fsPull(options),
  fsDrag: (paths) => connect.fsDrag(paths),
  fsThumbs: (options) => connect.fsThumbs(options),
});
shell.onRoute((id) => {
  if (id === 'files') void files?.refresh();
});


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
  el<HTMLButtonElement>('clip-send'),
  el<HTMLButtonElement>('clip-request'),
  el<HTMLInputElement>('clip-watch'),
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
  el('contacts-card'),
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
const sms = new SmsView(
  el('sms-card'),
  el('sms-note'),
  el('sms-body'),
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
el('mirror-refresh').addEventListener('click', () => void connect.mirrorKeyframe());

/*
 * The "Floating window" button.
 *
 * One call in both states. `floatOpen` is `isOpen ? focus() : open()` in the main process, so this
 * button does not decide which of the two it is doing — it cannot create a second instance even if
 * it is pressed twice before the window has finished loading, which a check up here would not
 * survive. See main/float.ts:openFloat.
 */
el('mirror-float').addEventListener('click', () => void connect.floatOpen());

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

function settingRow(label: string, sub: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const text = document.createElement('span');
  text.className = 'setting-row-text';
  const name = document.createElement('span');
  name.className = 'setting-label';
  name.textContent = label;
  const note = document.createElement('span');
  note.className = 'setting-sub';
  note.textContent = sub;
  text.append(name, note);
  const slot = document.createElement('span');
  slot.className = 'setting-control';
  slot.appendChild(control);
  row.append(text, slot);
  return row;
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
  'ConnectSuite for macOS. No cloud, no account, no relay server.',
  () => {
    const body = document.createElement('div');
    const version = document.createElement('span');
    version.className = 'setting-value';
    version.textContent = '2.0.0';
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
    // The reading the device card and the strip have no room to explain. `battery.state` is in
    // docs/protocol.md and nothing on this Mac subscribes to it, so the honest value is the
    // sentence rather than a number.
    setDiag('battery', 'not subscribed on this build (battery.state is unhandled)');
  })();
}, 1_000);

connect.onStatus(render);
connect.onPhoneError((payload) => {
  const text = payload.fixHint
    ? `${payload.code}: ${payload.message} — ${payload.fixHint}`
    : `${payload.code}: ${payload.message}`;
  setDiag('error', text);
  // A phone-side refusal is a session event and belongs in the island's rota: the diagnostics
  // block is where you go to *look* for it, and the island is what tells you to go and look.
  shell.note(text);
});

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
  void mirror.start(selectedQuality());
});
el('hero-info').addEventListener('click', () => shell.route('settings', 'connection'));

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
})();
