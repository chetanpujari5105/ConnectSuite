/**
 * The renderer draws and nothing else. Every socket, certificate, and file handle lives in the
 * main process; this file only reads status and sends intents through the preload bridge.
 *
 * Deliberately module-free so tsc emits a plain script the CSP-locked page can load.
 */

declare function chipLabel(capability: string, available: boolean, reason?: string): string;

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
  status(): Promise<RendererStatus | null>;
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

  // Phase 4: the media remote. `RemoteStateView` comes from remote.ts, a plain script in the same
  // global scope rather than a module.
  remoteState(): Promise<RemoteStateView>;
  remoteCommand(action: string, extra?: Record<string, unknown>): Promise<InputResult>;
  onRemoteChanged(callback: (state: RemoteStateView) => void): void;

  // Phase 4: SMS. Note `smsSend` takes no recipient — the send rule, as a signature.
  smsThreads(options: { limit?: number; before?: number }): Promise<
    { ok: true; data: { threads: SmsThreadRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  smsMessages(threadId: string, options: { limit?: number; before?: number }): Promise<
    { ok: true; data: { threadId: string; messages: SmsMessageRow[]; hasMore: boolean } } | { ok: false; reason?: string; fixHint?: string }
  >;
  smsSend(threadId: string, body: string): Promise<InputResult>;
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

function render(status: RendererStatus | null): void {
  const state = el<HTMLDivElement>('state');
  const connected = status?.phase === 'connected';
  state.textContent = status ? describe(status) : 'Starting…';
  state.className = `pill${connected ? ' connected' : status?.lastError ? ' error' : ''}`;

  el('hud-phase').textContent = status?.phase ?? '—';
  el('hud-via').textContent = status?.via ?? '—';
  el('hud-address').textContent = status?.address ?? '—';
  el('hud-rtt').textContent = status?.rttMs === undefined ? '—' : `${status.rttMs} ms`;
  el('hud-device').textContent = status?.deviceName ?? '—';
  el('hud-error').textContent = status?.lastError ?? '—';

  // The pairing panel is only useful before there is a paired phone; hiding it afterwards keeps
  // a stale QR from being scanned into a second, conflicting pairing.
  el('pairing').classList.toggle('hidden', Boolean(status?.paired));

  // The button is enabled only while the phone advertises `mirror`. Anything else would offer
  // the user an action the phone has already said it cannot perform.
  const canMirror = status?.capabilities?.includes('mirror') ?? false;
  el<HTMLButtonElement>('mirror-start').disabled = !canMirror;
  el<HTMLButtonElement>('mirror-stop').disabled = !canMirror;
  el('mirror-card').classList.toggle('hidden', !status?.paired);

  // The same rule for input: no button for a promise the phone has not made. Unlike the mirror
  // buttons, the canvas cannot be "disabled" — so the view is told, and it answers a click with
  // the reason and the way to fix it rather than doing nothing.
  notifications.setAdvertised(status?.capabilities?.includes('notifications') ?? false);
  // Same rule for contacts, and the pane loads its first page the moment it is advertised — which
  // is what makes granting READ_CONTACTS mid-session visible without a reconnect.
  contacts.setAdvertised(status?.capabilities?.includes('contacts') ?? false);
  // The media remote rides the notification-listener grant, so this chip lights together with
  // `notifications` — one grant, two features. See docs/protocol.md.
  remote.setAdvertised(status?.capabilities?.includes('remote') ?? false);
  sms.setAdvertised(status?.capabilities?.includes('sms') ?? false);
  calls.setAdvertised(status?.capabilities?.includes('calls') ?? false);

  const canInput = status?.capabilities?.includes('input') ?? false;
  mirror.setInputAdvertised(canInput);
  for (const button of INPUT_BUTTONS) {
    el<HTMLButtonElement>(`input-${button.id}`).disabled = !canInput;
  }
  el('input-note').textContent = canInput
    ? 'Click the picture to tap, drag to swipe, scroll to scroll, and type to enter text into ' +
      'whichever field is selected on the phone.'
    : 'Controlling the phone needs ConnectSuite Input turned on under Accessibility on the ' +
      'phone. Mirroring works without it; clicking does not.';

  const caps = el('caps');
  caps.replaceChildren();
  const reasons = new Map((status?.unavailable ?? []).map((u) => [u.name, u.reason]));
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

async function refreshLogs(): Promise<void> {
  el('logs').textContent = (await connect.logTail(120)).join('\n');
}

el('new-qr').addEventListener('click', () => void showQr(true));
el('connect').addEventListener('click', () => void connect.connect());
el('disconnect').addEventListener('click', () => void connect.disconnect());
el('retry').addEventListener('click', () => void connect.retryNow());
el('forget').addEventListener('click', async () => {
  await connect.forgetDevice();
  render(await connect.status());
  await showQr();
});
el('save-manual').addEventListener('click', async () => {
  await connect.setManualAddress(el<HTMLInputElement>('manual').value);
});
el('save-tailscale').addEventListener('click', async () => {
  await connect.setTailscaleAddress(el<HTMLInputElement>('tailscale').value);
});
el('refresh-logs').addEventListener('click', () => void refreshLogs());

// Mirroring is only offered when the phone actually advertises it, which is the capability
// contract doing its job at the UI layer: no button for a promise the phone has not made.
const mirror = new MirrorView(
  el<HTMLCanvasElement>('mirror-canvas'),
  el('mirror-overlay'),
  el('mirror-notice'),
  connect,
);

// Notifications. Same rule as the mirror one line up: the pane exists only where the phone has
// promised the feature. Unlike the mirror it is hidden outright rather than greyed, because an
// empty list and an ungranted permission look identical and the capability chip already explains
// the second one.
const notifications = new NotificationsView(
  el('notif-card'),
  el('notif-note'),
  el('notif-list'),
  el('notif-notice'),
  connect,
);

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
  connect,
);

/**
 * The six global actions, and their wire names.
 *
 * `power` is deliberately absent and must stay absent: `performGlobalAction` cannot press the
 * power button, and the power *menu* it can open is one stray click away from switching off the
 * phone this Mac is talking to. See docs/protocol.md.
 */
const INPUT_BUTTONS = [
  { id: 'back', action: 'back' },
  { id: 'home', action: 'home' },
  { id: 'recents', action: 'recents' },
  { id: 'notifications', action: 'notifications' },
  { id: 'quick-settings', action: 'quick_settings' },
  { id: 'lock', action: 'lock_screen' },
] as const;

for (const button of INPUT_BUTTONS) {
  el(`input-${button.id}`).addEventListener('click', () => void mirror.global(button.action));
}

el('mirror-start').addEventListener('click', () =>
  void mirror.start({ maxResolution: selectedResolution() }),
);
el('mirror-stop').addEventListener('click', () => void mirror.stop());

/**
 * Changing the cap mid-session goes over `mirror.config`, which rebuilds the phone's encoder
 * without asking for consent again. Before a session it is just the value the next start sends.
 */
el('mirror-resolution').addEventListener('change', () => {
  void mirror.setMaxResolution(selectedResolution()).catch(() => {
    /* Not mirroring yet: the value is picked up by the next start. */
  });
});

function selectedResolution(): number {
  return Number(el<HTMLSelectElement>('mirror-resolution').value);
}

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
    el('hud-capture').textContent = capture?.width
      ? `${capture.width}x${capture.height} (cap ${capture.maxResolution}p)`
      : '—';
    // Blank until the phone has actually turned once: "0°" would claim a measurement that has not
    // been made, and the phone only sends `mirror.rotate` when its rotation changes.
    el('hud-rotation').textContent = decoded.rotation === null ? '—' : `${decoded.rotation}°`;
    // Both sides: a phone encoding 60 and a Mac painting 30 is a link problem, and one number
    // alone cannot tell you that.
    el('hud-fps').textContent =
      decoded.fps === null && link.framesPerSecond === null
        ? '—'
        : `${decoded.fps ?? '—'} painted · ${link.framesPerSecond ?? '—'} received`;
    el('hud-bitrate').textContent =
      link.kbps === null || link.kbps === 0 ? '—' : `${(link.kbps / 1000).toFixed(1)} Mbps`;
    el('hud-dropped').textContent =
      phone?.droppedFrames === undefined ? '—' : `${phone.droppedFrames} on the phone`;
    // Three figures, not one. The total is what the mirror feels like; the two halves are what
    // say which machine to look at when it feels wrong — the phone's encoder and the network, or
    // this Mac's IPC, decoder and canvas. A single number cannot separate them, which is the
    // whole reason the split exists.
    el('hud-latency').textContent =
      decoded.latencyMs === null
        ? '—'
        : `${decoded.latencyMs} ms (peak ${decoded.latencyPeakMs} ms)`;
    el('hud-latency-link').textContent =
      decoded.latencyLinkMs === null ? '—' : `${decoded.latencyLinkMs} ms`;
    el('hud-latency-decode').textContent =
      decoded.latencyDecodeMs === null ? '—' : `${decoded.latencyDecodeMs} ms`;
    el('hud-ttff').textContent =
      decoded.timeToFirstFrameMs === null ? '—' : `${decoded.timeToFirstFrameMs} ms`;
  })();
}, 1_000);

connect.onStatus(render);
connect.onPhoneError((payload) => {
  el('hud-error').textContent = payload.fixHint
    ? `${payload.code}: ${payload.message} — ${payload.fixHint}`
    : `${payload.code}: ${payload.message}`;
});

void (async () => {
  const status = await connect.status();
  render(status);
  // Pulls the set the main process already holds. The events are pushed, so a window that opened
  // after the phone connected would otherwise show an empty pane until something new arrived.
  await notifications.refresh();
  await remote.refresh();
  const settings = await connect.settings();
  el<HTMLInputElement>('manual').value = settings.manualAddress ?? '';
  el<HTMLInputElement>('tailscale').value = settings.tailscaleAddress ?? '';
  if (!status?.paired) await showQr();
  await refreshLogs();
  setInterval(() => void refreshLogs(), 15_000);
  setInterval(() => void keepPairingArmed(), 60_000);
})();
