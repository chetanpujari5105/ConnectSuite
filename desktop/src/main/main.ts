import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, Tray, Menu,
  dialog,
} from 'electron';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { ErrorCode, MessageType, type ConnectionStatus } from '../shared/protocol';
import { loadIdentity } from './identity';
import { InputClient } from './input';
import { ClipboardClient } from './clipboard';
import { ClipboardWatcher } from './clipboardWatcher';
import { ContactsClient } from './contacts';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fsp } from 'node:fs';
import { BulkClient } from './bulk';
import { partPathFor } from '../shared/transferFiles';
import { activity } from './activity';
// `shared/activity.ts` is a plain script, not a module — it has to be loadable by a `<script>` tag
// in the CSP-locked renderer, so it has no top-level `export`. Its declarations are global to this
// TypeScript project; only the runtime value needs fetching.
const sharedActivity = require('../shared/activity') as {
  activityCsv: (events: ActivityEvent[]) => string;
};
import { FilesClient } from './files';
import { AppsClient } from './apps';
import { PhotosClient } from './photos';
import { NotificationClient } from './notifications';
import { RemoteClient } from './remote';
import { CallClient } from './calls';
import { SmsClient } from './sms';
import { LinkClient } from './link';
import { initLogger, log, tailLog } from './logger';
import { debugSwitches } from './debugSwitches';
import { store } from './store';
import { VideoClient, type VideoFrame } from './video';
import { FloatMirrorWindow } from './float';

let window: BrowserWindow | null = null;
/**
 * The detached mirror window — the second of the *two views of one session*.
 *
 * Constructed lazily in `whenReady` because it needs `app.getAppPath()`-relative paths and a
 * `screen` module that does not exist before then.
 */
let float: FloatMirrorWindow | null = null;
let tray: Tray | null = null;
let link: LinkClient | null = null;
let video: VideoClient | null = null;
/** Serialises input so two gestures never overlap on the phone. See input.ts. */
const input = new InputClient(() => link);

/** The live notification set, built from events. See notifications.ts. */
const notifications = new NotificationClient(() => link);

/**
 * Contacts: the phone's search, and a number→name cache for the panes that draw numbers.
 *
 * Holds no contact book — see contacts.ts. The cache is cleared on disconnect alongside the
 * notification set, for the same reason: a name resolved against a phone this Mac is no longer
 * talking to is a claim it cannot still stand behind.
 */
const contacts = new ContactsClient(() => link);

/**
 * The clipboard, which is asymmetric because Android is — see clipboard.ts.
 *
 * **An arriving entry is applied to this Mac's clipboard immediately**, so ⌘V works with nothing
 * clicked. That is a reversal, and the thing that made it defensible is that the clipboard it
 * overwrites is captured into the history first — `docs/protocol.md` allowed removing the
 * confirmation only in exchange for an undo, and Restore is that undo. The phone does not get the
 * same default, because it may not read its own clipboard in the background and therefore cannot
 * see what it would be destroying.
 *
 * The renderer is told whether the entry was applied, because "it is on your clipboard" and "it is
 * in your history" are two different sentences and the pane says the right one.
 */
const clip = new ClipboardClient(
  () => link,
  (entry) => sendAll('clip-arrived', entry),
  () => sendAll('clip-changed'),
);

/**
 * The Mac's clipboard watcher, which is what makes this direction automatic.
 *
 * macOS gates nothing, so the button was never the platform's idea — it was ours, and it made the
 * feature something to operate. The watcher polls because `NSPasteboard` offers no change
 * notification and Electron exposes no `changeCount`; `clipboardWatcher.ts` carries the readings
 * that make the interval affordable and the marker check that keeps password-manager clips off the
 * wire.
 *
 * **It reads nothing while the link is down**, which is both the cheap thing and the right thing:
 * a watcher with no phone attached would be reading somebody's passwords for no purpose.
 */
const clipWatcher = new ClipboardWatcher(
  () => link?.isConnected() === true,
  // `automatic`, and that word is the whole difference between a watcher and a button held down:
  // it is what makes the unchanged rule apply, so an unaltered clipboard is sent once rather than
  // twice a second forever.
  async () => {
    const result = await clip.send('automatic');
    // The watcher has no other voice. A silent automatic send that the phone refused to apply is
    // exactly the state this whole fix exists to end, so it reaches the Activity pane too — once
    // per refused entry, not once per poll, because `send` only gets here past the echo interlock.
    if (result.ok && result.data.applied === false) {
      activity.record('clipboard', 'Phone did not apply it', result.data.note ?? 'the phone did not say why');
    }
    return result;
  },
);

/**
 * The photo browser's three working verbs.
 *
 * Not gated on the `photos` capability, and that is deliberate: the capability is not advertised
 * because `media.original` needs the bulk channel, while `media.buckets`, `media.list` and
 * `media.thumb` all answer today. A client that refused to ask because the chip is grey would turn
 * a partly-working feature into a dead one.
 */
/**
 * The bulk channel client, built with the identity once it exists.
 *
 * Lazy for the same reason `link` and `video` are: the identity is loaded inside `whenReady`, and
 * every socket client has to be constructed after it.
 */
let bulk: BulkClient | null = null;

const photos = new PhotosClient(
  () => link,
  () => bulk,
  () => ({ host: link?.status().address ?? null, token: link?.token() ?? null }),
);

/**
 * The app grid, and the verb that asks rather than launches.
 *
 * Not gated on the `apps` capability, for the same reason the photo browser is not: `apps.list` and
 * `apps.icon` answer whether or not the chip is green — the chip is gated on POST_NOTIFICATIONS,
 * which only `apps.open.ask` needs — and a client that refused to ask because the chip was grey
 * would turn a partly-working feature into a dead one. The pane says which half is missing.
 */
const apps = new AppsClient(() => link);

/**
 * Files — the read verbs only. There is no upload method here, deliberately: `push` answers
 * `FEATURE_UNAVAILABLE` and `docs/protocol.md` forbids the affordance, so the decision lives in the
 * client rather than in the renderer where the canvas's drop tile would find it.
 */
const files = new FilesClient(
  () => link,
  () => bulk,
  () => ({ host: link?.status().address ?? null, token: link?.token() ?? null }),
);

/**
 * What is playing on the phone. Pushed by the phone, asked for once on connect.
 *
 * Cleared on disconnect with the rest: a card claiming a song is playing on a phone this Mac is
 * not talking to is a claim it cannot stand behind, and its Pause button would reach nothing.
 */
const remote = new RemoteClient(() => link);

/**
 * The previous status, reduced to the two facts that decide whether to ask the phone for state.
 *
 * `status` is emitted on every heartbeat, so anything that acts on "is connected" acts five times
 * a minute. These two make the difference between an edge and a level.
 */
/**
 * SMS. Holds the thread rows a send resolves its recipients from — see sms.ts, and the send rule
 * in docs/protocol.md. Cleared on disconnect, because a cached recipient is the stale copy that
 * rule exists to guard against.
 */
const sms = new SmsClient(() => link);

/**
 * Calls. Holds the one call that can be acted on, and sends its id explicitly on every action —
 * see calls.ts and step 61. Cleared on disconnect: a call this Mac cannot act on must not look
 * actionable.
 */
const calls = new CallClient(() => link);

/** This Mac's own name and fingerprint, filled in once the identity is loaded. */
let selfName: string | null = null;
let selfFingerprint: string | null = null;
let wasConnected = false;
/** Last phase written to the activity log. See R1 — transitions, not ticks. */
let lastRecordedPhase: ConnectionStatus['phase'] | null = null;

/**
 * The sentence an activity row carries for a refusal, from whatever shape the caller answered with.
 *
 * One function because there are four call sites and the alternative is four slightly different
 * guesses at where the reason lives. It never returns an empty string: a `Send failed` row with a
 * blank details column is a row that tells you something went wrong and refuses to say what, which
 * is worse than not recording it.
 */
function describeFailure(result: unknown): string {
  const r = result as { reason?: unknown; error?: unknown; code?: unknown } | null | undefined;
  const reason = typeof r?.reason === 'string' && r.reason ? r.reason : undefined;
  const error = typeof r?.error === 'string' && r.error ? r.error : undefined;
  const code = typeof r?.code === 'string' && r.code ? ` (${r.code})` : '';
  return `${reason ?? error ?? 'no reason given'}${code}`;
}
let couldRemote = false;

/**
 * The phone's last `mirror.stats`, kept because two of its numbers cannot be observed from here.
 *
 * Frames dropped on the phone were never sent to this Mac, and `ptsUs`/`monoUs` are the anchor
 * that turns a frame's PTS into a latency. See docs/protocol.md.
 */
let lastPhoneMirrorStats: Record<string, number> | null = null;

/**
 * When the phone was last asked to mirror, so time-to-first-frame is measured from the request
 * rather than from whichever event happened to arrive first.
 */
let mirrorRequestedAt: number | null = null;

/**
 * How long `mirror.start` gets to be *acknowledged*.
 *
 * Not how long consent gets — that is the phone's 30 second deadline, reported as
 * CONSENT_TIMEOUT. This covers only the round trip to a phone that is already connected, which
 * the phone budgets at 2 seconds; the rest is slack for a busy Wi-Fi link.
 */
const MIRROR_ACK_TIMEOUT_MS = 5_000;

/** The `mirror.state` payload from docs/protocol.md. */
type MirrorStatePayload = {
  state?: string;
  message?: string;
  fixHint?: string;
  requestId?: string;
  width?: number;
  height?: number;
  dpi?: number;
  bitrate?: number;
  frameRate?: number;
  maxResolution?: number;
  rotation?: number;
  /** The stamp every coordinate-bearing input message must echo. See docs/protocol.md. */
  geometryId?: number;
};
let lastStatus: ConnectionStatus | null = null;

/**
 * The app window.
 *
 * 1440 x 920 is the handoff's canvas, and the shell's grid is laid out against it — a 232px
 * sidebar, a 60px title-bar band, `1fr 380px` on Notifications and `1.04fr 1fr` on Overview. The
 * minimums are what those grids stop being honest below rather than round numbers: under 1100 the
 * Notifications detail column and the Mirror side column start fighting, and under 700 the dock
 * and the page header collide.
 *
 * `titleBarStyle: 'hidden'` with `trafficLightPosition` puts the **real** macOS traffic lights
 * into the 52px row the sidebar reserves for them, at the handoff's 20px inset. Three coloured
 * divs would have matched the mockup more literally and would have needed their own close,
 * minimise and zoom, would not have drawn the system's hover glyphs, and would not have gone
 * translucent when the window loses focus — so the design's pixels are met with the system's
 * buttons. See docs/design-departures.md, row S1.
 *
 * `backgroundColor` is `--canvas`, the token every translucent surface in the app composites over.
 * It was `#101014` — the legacy `--bg` — which is nine steps lighter and lifted every elevation in
 * the design at once, including the flash of window ground before the first paint.
 */
function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'ConnectSuite',
    backgroundColor: '#07070a',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * Pinned to 1, and it had drifted. Chromium persists a per-origin zoom level into the user
       * data directory, so a stray ⌘- at some point had left this window rendering `file://` at
       * **0.72** — every size in a design specified to the half-pixel (31px titles, 13.5px body,
       * a 232px sidebar) drawn at 72%, silently, across launches. Nothing in this app offers a
       * zoom control, so a factor other than 1 can only have arrived by accident.
       */
      zoomFactor: 1,
    },
  });
  /*
   * `zoomFactor` in webPreferences is only the *initial* value, and Chromium's persisted per-origin
   * zoom level is applied over the top of it once the page commits — which is why the pin above was
   * not enough on its own and this Mac kept rendering at 0.72 after it was added. Setting the level
   * after the load is what actually holds. Level 0 is factor 1.
   */
  window.webContents.on('did-finish-load', () => window?.webContents.setZoomLevel(0));
  void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  window.on('closed', () => {
    window = null;
  });
}

function statusLabel(status: ConnectionStatus | null): string {
  if (!status) return 'Starting…';
  switch (status.phase) {
    case 'connected':
      return `Connected to ${status.deviceName ?? 'phone'}`;
    case 'connecting':
    case 'handshaking':
      return `Connecting to ${status.address ?? 'phone'}…`;
    case 'searching':
      return 'Looking for the phone…';
    case 'reconnecting':
      return `Reconnecting${status.lastError ? ` — ${status.lastError}` : '…'}`;
    case 'failed':
      return status.lastError ?? 'Disconnected';
    default:
      return status.paired ? 'Disconnected' : 'Not paired';
  }
}

function refreshTray(): void {
  if (!tray) return;
  // A text-only tray item: the connection state is the whole point of the icon, and a glyph
  // reads at a glance without shipping a bitmap that has to be redrawn per theme.
  const connected = lastStatus?.phase === 'connected';
  tray.setTitle(connected ? '● CS' : '○ CS');
  tray.setToolTip(statusLabel(lastStatus));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(lastStatus), enabled: false },
      { type: 'separator' },
      {
        label: 'Open ConnectSuite',
        click: () => {
          if (!window) createWindow();
          window?.show();
        },
      },
      {
        label: 'Reconnect now',
        enabled: !connected,
        click: () => link?.retryNow('tray'),
      },
      {
        label: connected ? 'Disconnect' : 'Connect',
        click: () => (connected ? link?.stop('tray') : link?.start()),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

/** The address the phone would see us on, for the QR payload. */
function localAddress(): string {
  for (const [, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '0.0.0.0';
}

/** Signature of every non-internal interface, so a Wi-Fi change can trigger an immediate retry. */
function interfaceSignature(): string {
  return Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === 'IPv4' && !address.internal)
        .map((address) => `${name}:${address.address}`),
    )
    .sort()
    .join(',');
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

/**
 * The same payload to every window that is open.
 *
 * Two views of one session means two decoders over one stream, not two sessions: the access units
 * are broadcast and each window decodes what it needs. It is deliberately *not* the default —
 * `send` stays main-window-only — because most channels describe a pane the float window does not
 * have, and a second window quietly receiving `sms-received` is how a "second view" becomes a
 * second app.
 *
 * The float window opens mid-stream with no parameter sets of its own, which is why opening it
 * replays the retained config frame and asks for an IDR. See [openFloatWindow].
 */
function sendAll(channel: string, payload: unknown = null): void {
  send(channel, payload);
  const detached = float?.webContents();
  if (detached && !detached.isDestroyed()) detached.webContents.send(channel, payload);
}

/**
 * Every phase the phone reports, forwarded to the canvas — and the one place the video socket is
 * opened.
 *
 * Opening on `running` rather than on the `mirror.start` ack is the point: the ack now comes back
 * before consent has even been asked for, so a socket opened there would be a socket opened for a
 * session the user has not permitted and may never permit.
 *
 * `awaiting-foreground` is not a failure and is deliberately not treated as one: the phone is
 * telling us to send the user to their phone, and the message and hint say exactly that.
 */
async function onMirrorState(state: MirrorStatePayload): Promise<void> {
  log.info('video', `Phone mirror state: ${state.state ?? 'unknown'} — ${state.message ?? ''}`);
  sendAll('mirror-state', state);

  if (state.state === 'running') {
    const token = link?.token();
    const address = link?.status().address;
    if (!token || !address) {
      log.warn('video', 'Phone reports mirroring but there is no live session to open video on');
      sendAll('mirror-stopped', {
        reason: 'The phone started mirroring but the link had already dropped.',
        fixHint: 'Reconnect the phone and start mirroring again.',
      });
      return;
    }
    if (!video!.isOpen()) {
      try {
        await video!.open(address, token);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log.warn('video', `Could not open the video socket: ${reason}`);
        sendAll('mirror-stopped', {
          reason: `The phone is mirroring but the Mac could not open the video connection (${reason}).`,
          fixHint: 'Check that the Mac and phone are on the same network, then try again.',
        });
        return;
      }
    }
    const waited = mirrorRequestedAt ? `${Date.now() - mirrorRequestedAt}ms after asking` : 'unprompted';
    log.info(
      'video',
      `Mirroring started: ${state.width ?? '?'}x${state.height ?? '?'} ` +
        `cap ${state.maxResolution ?? '?'} @${state.frameRate ?? '?'}fps ` +
        `${Math.round((state.bitrate ?? 0) / 1000)}kbps; ${waited}`,
    );
    return;
  }

  if (state.state === 'stopped') {
    video?.close('the phone stopped mirroring');
    sendAll('mirror-stopped', { reason: state.message, fixHint: state.fixHint });
  }
}

app.whenReady().then(() => {
  initLogger();
  activity.init();
  activity.record('system', 'ConnectSuite started', `version ${app.getVersion()}`);
  log.info('app', `ConnectSuite ${app.getVersion()} starting`);
  // Read here, and only here, so a weakened guard announces itself in the first lines of the log
  // rather than when it first bites — by which time a confusing result has already happened and
  // would be blamed on the feature. Packaged builds never reach this.
  if (!app.isPackaged) debugSwitches();

  const identity = loadIdentity();
  selfName = identity.deviceName;
  selfFingerprint = identity.fingerprint;
  link = new LinkClient(identity);
  video = new VideoClient(identity);
  bulk = new BulkClient(identity);

  /*
   * The detached mirror window.
   *
   * `onReady` is the answer to the one problem a second view has and the first does not: it opens
   * into a stream that is already running. Nothing will arrive marked `config` again on its own, so
   * the retained SPS/PPS are replayed to the new window and the phone is asked for an IDR. Without
   * both, the window shows a black rectangle for however long the encoder takes to keyframe on its
   * own — which on a still screen can be a very long time.
   */
  float = new FloatMirrorWindow(
    join(__dirname, '..', 'preload.js'),
    join(__dirname, '..', 'renderer', 'float.html'),
    (state) => sendAll('float-changed', state),
    (target) => {
      const config = video?.configFrame();
      if (config) {
        target.webContents.send('video-frame', {
          keyframe: config.keyframe,
          config: config.config,
          ptsUs: config.ptsUs,
          data: new Uint8Array(config.data),
          arrivedAt: config.arrivedAt,
        });
      }
      // Asked for even when there was no retained config: a window with a decoder and no reference
      // frame is the same black rectangle either way, and `mirror.keyframe` costs one small message.
      if (link?.isConnected()) {
        void link.request('mirror.keyframe', {}, 5_000).catch(() => undefined);
      }
      // The window missed every `status` sent before it existed, so it starts with no device name
      // and no idea whether input is advertised. Replay the last one rather than leaving it blank.
      if (lastStatus) target.webContents.send('status', lastStatus);
    },
  );

  // Access units go straight to the renderer, which owns the WebCodecs decoder and the canvas.
  // Buffer -> Uint8Array because a Node Buffer does not survive structured cloning as one.
  video.on('frame', (frame: VideoFrame) => {
    sendAll('video-frame', {
      keyframe: frame.keyframe,
      config: frame.config,
      ptsUs: frame.ptsUs,
      data: new Uint8Array(frame.data),
      arrivedAt: frame.arrivedAt,
    });
  });
  video.on('closed', (reason: string) => sendAll('mirror-stopped', { reason }));
  link.on('status', (status: ConnectionStatus) => {
    // R1 (system). Phase transitions only: `status` fires on every retry tick, and a row per tick
    // would bury every other category under a reconnect loop — the thing the pane exists to make
    // visible would become the thing hiding it.
    if (status.phase !== lastRecordedPhase) {
      const before = lastRecordedPhase;
      lastRecordedPhase = status.phase;
      if (status.phase === 'connected') {
        activity.record('system', 'Connected', status.deviceName ?? status.address ?? 'phone');
      } else if (before === 'connected') {
        activity.record('system', 'Disconnected', status.lastError ?? `now ${status.phase}`);
      }
    }
    lastStatus = status;
    refreshTray();
    // The session token dies with the control connection, so a video socket outliving it would
    // just be refused on its next frame.
    if (status.phase !== 'connected' && video?.isOpen()) {
      video.close('the control link dropped');
      sendAll('mirror-stopped', { reason: 'The link to the phone dropped, so mirroring stopped.' });
    }
    // A notification set that outlives its connection is a set of things that may already have
    // been dealt with on the phone — see notifications.ts. Cleared rather than kept.
    if (status.phase !== 'connected') {
      notifications.clear();
      contacts.clear();
      clip.clear();
      photos.clear();
      apps.clear();
      remote.clear();
      sms.clear();
      calls.clear();
    }
    // One `remote.state` request, on exactly one edge: `remote` becoming advertised while the link
    // is already up.
    //
    // Not on connect — the phone replays `remote.state` to every session as it becomes ready
    // (`RemoteFeature.addSessionReadyListener`), so asking there is a second request for something
    // already on its way. And not on every status: `status` is re-emitted on each heartbeat
    // because `rttMs` changes, so a plain `phase === 'connected'` test made this a request every
    // five seconds — a poll, in the one client whose design note says it does not poll.
    //
    // The remaining edge is the one the phone does *not* cover. `RemoteFeature.attachSessionListener`
    // runs inside `install()` and returns early unless the notification listener is already bound,
    // so a grant made mid-session lights the capability without necessarily attaching the media
    // listener behind it. A request is answered from `stateOf()` directly and works either way,
    // which makes this the one place the card can be made right without a reconnect.
    const canRemote = status.capabilities?.includes('remote') ?? false;
    const nowConnected = status.phase === 'connected';
    if (nowConnected && canRemote && wasConnected && !couldRemote) void remote.refresh();
    wasConnected = nowConnected;
    couldRemote = canRemote;
    sendAll('status', status);
  });
  link.on('phone-error', (payload: unknown) => {
    // R2 (system). Every phone-side refusal, with the feature it belongs to — the rows a user
    // needs when a pane has been grey all afternoon.
    {
      const e = payload as { code?: string; feature?: string; message?: string };
      activity.record(
        'system',
        `${e?.feature ?? 'phone'} refused`,
        `${e?.message ?? 'no reason given'}${e?.code ? ` (${e.code})` : ''}`,
      );
    }
    // A mirror failure arrives here as an ordinary error with feature "mirror". It is the only
    // thing standing between the user and an idle canvas, so it is forwarded verbatim.
    const error = payload as { code?: string; feature?: string; message?: string; fixHint?: string };
    if (error?.feature === 'mirror') {
      // SECURE_SURFACE is the one failure that does not end the session — docs/protocol.md says so
      // in as many words, and the phone keeps capturing throughout: the user walks out of the
      // banking app and frames resume. Closing the socket here made that impossible to observe.
      // The session survived on the phone and there was no longer anything on the Mac to receive
      // it, so "frames resume" became "mirroring is over" and only a restart brought it back.
      const transient = error.code === ErrorCode.SECURE_SURFACE;
      log.warn(
        'video',
        `Mirror ${transient ? 'interrupted' : 'failed'} on the phone: ` +
          `${error.message ?? 'no reason given'}`,
      );
      if (!transient) video?.close('the phone reported a mirror failure');
      // Either way the sentence goes on the canvas — and `transient` goes with it, because this is
      // the only place that knows the difference. The renderer used to infer it from frames still
      // arriving, which for a secure surface is precisely backwards: the frames still arriving are
      // the black ones the sentence is about, and they wiped it 16ms after it appeared (defect 23).
      // A transient failure ends when there is real content again; everything else ends the session.
      sendAll('mirror-stopped', { reason: error.message, fixHint: error.fixHint, transient });
    }
    send('phone-error', payload);
  });
  link.on('message', (envelope: unknown) => {
    const message = envelope as { type?: string; payload?: Record<string, unknown> };
    // Phase 4 events. The phone pushes these; nothing here ever requests them, which is why they
    // are handled beside the mirror's events rather than inside a client that owns a request.
    if (message?.type === MessageType.NOTIF_POSTED && message.payload) {
      notifications.onPosted(message.payload);
    }
    if (message?.type === MessageType.NOTIF_REMOVED && message.payload) {
      notifications.onRemoved(message.payload);
    }
    if (message?.type === MessageType.CALL_INCOMING && message.payload) {
      calls.onIncoming(message.payload);
    }
    if (message?.type === MessageType.CALL_ENDED && message.payload) {
      calls.onEnded(message.payload);
    }
    if (message?.type === MessageType.SMS_RECEIVED && message.payload) {
      sms.onReceived(message.payload);
    }
    // Defect 44: a message typed on the handset, or sent by another client, reaches the Mac here
    // and nowhere else. Before this there was no outgoing equivalent of the inbound broadcast, so
    // the phone's own keyboard diverged from the Mac until a thread was reopened.
    if (message?.type === MessageType.SMS_SENT && message.payload) {
      sms.onSent(message.payload);
    }
    if (message?.type === MessageType.CLIP_PUSH && message.payload) {
      clip.onPush(message.payload);
      // R9 (clipboard). The *size*, never the text — docs/phase-5-clipboard-proposal.md §6 is
      // explicit that no clipboard text reaches any file, and this store writes a file.
      const bytes = Number((message.payload as { bytes?: unknown }).bytes ?? 0);
      activity.record(
        'clipboard',
        'Received from phone',
        bytes > 0 ? `${bytes} bytes` : 'an entry arrived',
      );
    }
    if (message?.type === MessageType.REMOTE_STATE && message.payload) {
      remote.onState(message.payload);
    }
    if (message?.type === MessageType.MIRROR_STATS && message.payload) {
      lastPhoneMirrorStats = message.payload as Record<string, number>;
      // Pushed rather than polled: the renderer needs the clock anchor to time *every* frame it
      // paints, and a once-a-second poll would leave frames measured against a stale mapping.
      send('mirror-telemetry', {
        clockOffsetMs: link?.clockOffset(),
        phone: message.payload,
      });
    }
    if (message?.type === MessageType.MIRROR_STATE && message.payload) {
      void onMirrorState(message.payload as MirrorStatePayload);
    }
    if (message?.type === MessageType.MIRROR_ROTATE && message.payload) {
      // Phone-to-Mac only: the phone turned. It arrives on the control channel just ahead of the
      // new SPS/PPS on the video channel, so the canvas knows the shape it is about to be handed
      // rather than inferring it from the first frame that happens to decode.
      const rotate = message.payload as {
        width?: number;
        height?: number;
        rotation?: number;
        geometryId?: number;
      };
      log.info(
        'video',
        `Phone rotated to ${rotate.rotation ?? '?'}°: capture ` +
          `${rotate.width ?? '?'}x${rotate.height ?? '?'} (screen #${rotate.geometryId ?? '?'})`,
      );
      send('mirror-rotate', message.payload);
    }
    send('message', envelope);
  });

  // One subscription, not one per window: the client is the source of truth and `send` already
  // fans out to whatever window exists.
  notifications.on('changed', (list) => send('notif-changed', list));
  remote.on('changed', (state) => send('remote-changed', state));
  // The channel keeps its name because the renderer's contract is unchanged: to the pane, an
  // inbound and an outbound message are the same event — a message entered a thread — and the
  // row's `inbound` field says which. Defects 39 and 44.
  sms.on('message', (event) => {
    // R10 (messages). Direction and thread, never the body — the same rule R9 obeys, for the same
    // reason: this store writes a file and an SMS body is somebody's private text.
    const e = event as { threadId?: string; message?: { inbound?: boolean } };
    activity.record(
      'messages',
      e?.message?.inbound === false ? 'Message sent' : 'Message received',
      `thread ${e?.threadId ?? 'unknown'}`,
    );
    send('sms-received', event);
  });
  calls.on('changed', (call) => {
    // R11 (calls). One row per state change of the live card, with the number as a handle.
    const c = call as { state?: string; number?: string; name?: string } | null;
    if (c?.state) activity.record('calls', `Call ${c.state}`, c.name ?? c.number ?? 'unknown');
    send('call-changed', call);
  });

  tray = new Tray(nativeImage.createEmpty());
  refreshTray();
  createWindow();

  if (store.get('autoConnect')) link.start();

  // Started unconditionally when the preference is on: the watcher polls nothing until the link is
  // up, so there is no separate "start it when we connect" edge to get wrong — and no window in
  // which a copy made during a reconnect is missed because nobody re-armed anything.
  if (store.get('watchClipboard')) clipWatcher.start();

  // The lid-open case: the sockets are already dead but nothing has told us yet, so waiting out
  // the backoff would add half a minute of "connected but not".
  powerMonitor.on('resume', () => link?.retryNow('system resumed'));
  powerMonitor.on('unlock-screen', () => link?.retryNow('screen unlocked'));

  let signature = interfaceSignature();
  setInterval(() => {
    const current = interfaceSignature();
    if (current !== signature) {
      signature = current;
      link?.retryNow('network interfaces changed');
    }
  }, 3_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window keeps the tray alive: notifications and clipboard sync are the reason the
// app exists, and both need the link up.
app.on('window-all-closed', () => {
  /* stay running */
});

app.on('before-quit', () => {
  video?.close('app quit');
  link?.stop('app quit');
});

/**
 * Asks the phone to start mirroring, and returns as soon as it has answered *that it heard*.
 *
 * It does not wait for a picture. The phone acks `mirror.start` with the phase the request
 * entered — see docs/protocol.md — and everything after that arrives as `mirror.state` events,
 * because consent is a person picking up a phone and no request timeout can tell "still reaching
 * for it" from "the prompt was never shown". Holding the request open across that is what left
 * this canvas blank for a full minute with nothing said.
 *
 * The video socket is therefore opened by {@link onMirrorState} on `running`, not here.
 */
ipcMain.handle('mirror-start', async (_event, options: Record<string, unknown> = {}) => {
  if (!link || !link.isConnected()) throw new Error('Not connected to the phone');
  if (!link.token() || !link.status().address) throw new Error('No live session with the phone');

  lastPhoneMirrorStats = null;

  // `requestedAt` is taken here, on the wire, and handed back so the renderer can report time to
  // first frame against the moment the phone was actually asked — not the moment a button was
  // clicked, which includes however long the user took to reach for the phone.
  const requestedAt = Date.now();
  mirrorRequestedAt = requestedAt;

  let ack: unknown;
  try {
    ack = await link.request('mirror.start', options, MIRROR_ACK_TIMEOUT_MS);
  } catch (error) {
    // The old code logged nothing on this path, so a failed start left no trace on either side.
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('video', `mirror.start was not acknowledged: ${reason}`);
    throw error;
  }

  const state = ((ack as { payload?: MirrorStatePayload })?.payload ?? {}) as MirrorStatePayload;
  log.info(
    'video',
    `mirror.start acknowledged in ${Date.now() - requestedAt}ms as "${state.state ?? 'unknown'}"`,
  );
  sendAll('mirror-state', state);
  // R3 (mirroring). After the ack, not before it: a row for a start the phone never acknowledged
  // would be the registration-line-as-execution-line fault written into the user's own timeline.
  activity.record('mirroring', 'Mirroring started', `acknowledged in ${Date.now() - requestedAt}ms`);
  return { ok: true, requestedAt, state };
});

/*
 * Stopping the session closes the detached window — the README's own row: *"Stop mirroring
 * (inspector or ⌘⇧.) → isMirroring = false, isOpen = false."*
 *
 * The asymmetry with `float-close` is the point and is worth stating, because it looks like an
 * inconsistency until you read it the right way round: closing the *window* never stops the
 * session, and stopping the *session* always closes the window. A detached window over a stopped
 * mirror would be a frame with nothing in it and no way to explain itself.
 */
ipcMain.handle('mirror-stop', async () => {
  float?.closeFloat();
  video?.close('stopped by the user');
  if (link?.isConnected()) {
    await link.request('mirror.stop', {}, 10_000).catch(() => undefined);
  }
  // R4 (mirroring).
  activity.record('mirroring', 'Mirroring stopped', 'stopped from this Mac');
  return { ok: true };
});

/**
 * `mirror.config`. Bitrate changes on the live encoder; a resolution cap change rebuilds it.
 *
 * Either way the phone keeps its MediaProjection, so raising the cap mid-session costs the user
 * nothing — no second consent tap. The new SPS/PPS that follows makes the renderer's decoder
 * reconfigure itself.
 */
ipcMain.handle('mirror-config', async (_event, options: Record<string, unknown> = {}) => {
  if (!link?.isConnected()) throw new Error('Not connected to the phone');
  await link.request('mirror.config', options, 10_000);
  log.info('video', `Mirror reconfigured: ${JSON.stringify(options)}`);
  return { ok: true };
});

ipcMain.handle('mirror-keyframe', async () => {
  if (link?.isConnected()) await link.request('mirror.keyframe', {}, 5_000).catch(() => undefined);
});

/**
 * Writes a still of the mirror to the Desktop.
 *
 * File IO lives in the main process — the renderer draws and sends intents — so the renderer hands
 * over a PNG data URL and gets back the path it landed at. The path is returned rather than
 * assumed, because "Screenshot saved to Desktop" is a claim, and a toast that says it without
 * knowing is the kind of confident wrong sentence this project keeps finding.
 *
 * The name carries a second-resolution timestamp so two captures a second apart cannot collide and
 * silently overwrite each other.
 */
ipcMain.handle('mirror-capture', async (_event, dataUrl: string) => {
  // A data URL is the only shape accepted. Anything else is a bug or a hostile renderer, and
  // either way it must not reach `writeFile` with a path in it.
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
    log.warn('video', 'Capture refused: not a PNG data URL');
    return { ok: false, reason: 'That capture was not a PNG and was not saved.' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(app.getPath('desktop'), `ConnectSuite ${stamp}.png`);
  try {
    await writeFile(path, Buffer.from(dataUrl.slice(prefix.length), 'base64'));
    // Logged at the same volume as the failure below, with the same tally, because a count of
    // failures with no successes beside it is not evidence — see CLAUDE.md.
    captures.saved += 1;
    log.info('video', `Capture saved to ${path} — ${captureTally()}`);
    // R5 (mirroring). Both branches record, for the reason the tally beside them exists: a
    // timeline showing only the captures that worked answers "did it save?" with silence.
    activity.record('mirroring', 'Screenshot saved', path);
    return { ok: true, path };
  } catch (error) {
    captures.failed += 1;
    log.warn('video', `Capture failed: ${String(error)} — ${captureTally()}`);
    activity.record('mirroring', 'Screenshot failed', String(error));
    return { ok: false, reason: `The capture could not be written (${String(error)}).` };
  }
});

const captures = { saved: 0, failed: 0 };
const captureTally = (): string =>
  `${captures.saved} saved / ${captures.failed} failed since start`;

/*
 * The detached mirror window's IPC.
 *
 * Every handler is a lifecycle call or a *pointer position* — never a window rectangle. The
 * geometry is resolved in `float.ts` through `shared/floatGeometry.ts`, so there is no channel a
 * renderer could use to set a width without re-clamping Y. That is the isolation the README asks
 * for, expressed as the shape of the wire rather than as a rule someone has to remember.
 */
ipcMain.handle('float-open', () => {
  float?.openFloat();
  return float?.state() ?? null;
});
ipcMain.handle('float-close', () => float?.closeFloat());
ipcMain.handle('float-minimize', () => float?.minimize());
ipcMain.handle('float-smart-fit', () => float?.smartFit());
ipcMain.handle('float-set-width', (_event, width: number) => float?.setWidth(width));
ipcMain.handle('float-set-pinned', (_event, pinned: boolean) => float?.setPinned(pinned === true));
ipcMain.handle(
  'float-move',
  (_event, drag: { pointer: { x: number; y: number }; grab: { x: number; y: number } }) =>
    float?.moveTo(drag.pointer, drag.grab),
);
ipcMain.handle('float-resize', (_event, pointer: { x: number }) => float?.resizeCorner(pointer));
ipcMain.handle('float-state', () => float?.state() ?? null);

ipcMain.handle('mirror-stats', () => ({
  ...(video?.stats() ?? { frames: 0, bytes: 0, kbps: 0, framesPerSecond: 0 }),
  clockOffsetMs: link?.clockOffset(),
  phone: lastPhoneMirrorStats,
}));

/**
 * Input. Six thin handlers: the renderer has already worked out where on the picture it clicked,
 * and everything else — ordering, the queue bound, the timeout — belongs to {@link InputClient}.
 *
 * The payloads are passed through unaltered on purpose. The Mac does not clamp a coordinate,
 * substitute a geometry stamp, or retry a refusal: the phone is the only side that knows what it
 * is capturing right now, and second-guessing it here is how a tap ends up somewhere the user did
 * not click. A rejection carries the phone's own sentence, which the canvas shows verbatim.
 */
ipcMain.handle('input-tap', (_event, payload: Record<string, unknown>) => input.tap(payload));
ipcMain.handle('input-swipe', (_event, payload: Record<string, unknown>) => input.swipe(payload));
ipcMain.handle('input-scroll', (_event, payload: Record<string, unknown>) => input.scroll(payload));
ipcMain.handle('input-key', (_event, key: string) => input.key(key));
ipcMain.handle('input-text', (_event, payload: { text: string; mode?: 'replace' | 'append' }) =>
  input.text(payload.text, payload.mode ?? 'replace'),
);
ipcMain.handle('input-global', (_event, action: string) => input.global(action));

// ---- Phase 4: notifications ------------------------------------------------------------------
ipcMain.handle('notif-list', () => notifications.all());
ipcMain.handle('notif-reply', (_event, payload: { key: string; text: string }) =>
  notifications.reply(payload.key, payload.text),
);
ipcMain.handle('notif-action', (_event, payload: { key: string; index: number }) =>
  notifications.action(payload.key, payload.index),
);
ipcMain.handle('notif-dismiss', (_event, key: string) => notifications.dismiss(key));

// The manual override, kept: a click is a `user` trigger and is never argued with by the
// unchanged rule, so pressing it after copying the same thing twice still sends.
ipcMain.handle('clip-send', async () => {
  // R8 (clipboard).
  const result = await clip.send('user');
  if (result?.ok && result.data.applied === false) {
    // Reached the phone and was NOT put on its clipboard. Distinct from both other outcomes on
    // purpose: "Sent to phone" would be a true sentence about delivery and a false one about the
    // thing the person actually wanted, which is the ack meaning *asked* while the caller reads
    // *done*.
    activity.record('clipboard', 'Phone did not apply it', result.data.note ?? 'the phone did not say why');
  } else if (result?.ok) activity.record('clipboard', 'Sent to phone', 'from this Mac');
  else activity.record('clipboard', 'Send refused', describeFailure(result));
  return result;
});
ipcMain.handle('clip-watching', () => ({ ok: true, data: { watching: clipWatcher.isRunning } }));
ipcMain.handle('clip-set-watching', (_event, on: boolean) => {
  if (on) clipWatcher.start();
  else clipWatcher.stop();
  store.set('watchClipboard', clipWatcher.isRunning);
  return { ok: true, data: { watching: clipWatcher.isRunning } };
});
ipcMain.handle('clip-request', () => clip.request());
ipcMain.handle('clip-history', () => ({ ok: true, data: clip.entries() }));
ipcMain.handle('clip-phone-history', (_event, limit?: number) => clip.phoneHistory(limit));
// A click on an older row, or Restore on a displaced entry. Arriving entries are applied by
// `ClipboardClient.receive` without coming through here.
ipcMain.handle('clip-use', (_event, text: string) => {
  clip.use(text);
  return { ok: true, data: null };
});

ipcMain.handle(
  'contacts-list',
  (_event, options: { query?: string; limit?: number } = {}) => contacts.list(options),
);
ipcMain.handle(
  'contacts-get',
  (_event, options: { id?: string; number?: string; withPhoto?: boolean }) => contacts.get(options),
);

/**
 * Drag counters, published together.
 *
 * A refusal count with no started count beside it reads as whichever story the reader already
 * believes — `CLAUDE.md`'s opening rule, and defect 18's 187 refusals over a denominator of zero.
 */
let dragsStarted = 0;
let dragsRefused = 0;

/**
 * A 1×1 transparent PNG, for when `getFileIcon` gives nothing.
 *
 * Electron throws on an empty `icon`, so the alternative to this is a drag that fails with an
 * exception instead of a drag that works with a plain cursor.
 */
const FALLBACK_DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

ipcMain.handle('fs-roots', () => files.roots());

/*
 * The Activity screen's three reads.
 *
 * `activity-events` returns the store's error *beside* the events rather than an empty list on
 * failure, which is the whole reason the pane can tell A2 (unreadable) from A3 (nothing yet). An
 * empty array with no error field would have collapsed those two into one picture at the IPC
 * boundary, before the tagged union in `shared/activity.ts` ever got a chance to keep them apart.
 */
ipcMain.handle('activity-events', () => ({
  ok: true,
  data: { events: activity.all(), error: activity.error(), stats: activity.stats() },
}));
ipcMain.handle('activity-csv', async () => {
  const target = await dialog.showSaveDialog({
    title: 'Export activity log',
    defaultPath: join(app.getPath('downloads'), `ConnectSuite activity ${new Date().toISOString().slice(0, 10)}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (target.canceled || !target.filePath) return { ok: false, reason: 'cancelled' };
  try {
    await writeFile(target.filePath, sharedActivity.activityCsv(activity.all()), 'utf8');
    log.info('activity', `Exported ${activity.all().length} event(s) to ${target.filePath}`);
    return { ok: true, data: { path: target.filePath } };
  } catch (error) {
    log.warn('activity', `Export failed: ${String(error)}`);
    return { ok: false, reason: String(error) };
  }
});
/*
 * R6 and R7 (files). Recorded here rather than inside `FilesClient` so that every recording site in
 * this app is in one file — see the note on `ActivityStore`. Both outcomes are written: a transfer
 * that failed is exactly the row somebody comes to this screen looking for.
 */
ipcMain.handle(
  'fs-push',
  async (_event, options: { rootId: string; path: string; source: string; overwrite?: boolean }) => {
    const result = await files.push(options);
    const name = basename(options.source ?? '');
    if (result?.ok) activity.record('files', 'Sent to phone', `${name} → ${options.rootId}`);
    else activity.record('files', 'Send failed', `${name}: ${describeFailure(result)}`);
    return result;
  },
);
ipcMain.handle(
  'fs-pull',
  async (_event, options: { rootId: string; id: string; name: string; size: number }) => {
    const result = await files.pull(options);
    if (result?.ok) activity.record('files', 'Saved to Mac', `${options.name} (${options.size} bytes)`);
    else activity.record('files', 'Save failed', `${options.name}: ${describeFailure(result)}`);
    return result;
  },
);
/**
 * The drag itself, which can only start here.
 *
 * `webContents.startDrag` is a main-process call and it is **synchronous with the renderer's
 * `dragstart`** — this is `ipcMain.on`, not `handle`, because the renderer must not await anything
 * before the drag begins or macOS ends the gesture first.
 *
 * The icon is the file's own, via `app.getFileIcon`. Electron **throws** on an empty icon, so this
 * has a fallback: a 1×1 transparent image rather than a refusal, because a drag with a plain cursor
 * is a working drag and a thrown exception is not. The file's existence is checked first for the
 * same reason `bulk.pull` writes to `.part` — handing Finder a path to nothing is a failure with no
 * error attached to it.
 */
ipcMain.on('fs-drag', (event, paths: string[]) => {
  if (!Array.isArray(paths) || paths.length === 0) return;
  if (!paths.every((p) => typeof p === 'string' && p.length > 0)) return;

  // Every path is checked before any of them is dragged. A partial multi-file drag would hand
  // Finder some of what the user selected with nothing saying which — the same shape as reporting
  // a truncated push as complete, and the reason `bulk.pull` writes to `.part`.
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    dragsRefused += 1;
    log.warn(
      'files',
      `refused a drag of ${paths.length} file(s): ${missing.length} not on this Mac ` +
        `(${missing.map((p) => basename(p)).join(', ')}) — ` +
        `${dragsStarted} started / ${dragsRefused} refused`,
    );
    return;
  }

  const start = (icon: Electron.NativeImage): void => {
    try {
      // `file` is the anchor Electron requires; `files` carries the whole set and is what Finder
      // actually receives when there is more than one. Sending `files` for a single path too would
      // be harmless, but the one-file case is the overwhelmingly common one and this keeps the
      // payload identical to what shipped before it.
      event.sender.startDrag(
        paths.length === 1 ? { file: paths[0]!, icon } : { file: paths[0]!, files: paths, icon },
      );
      dragsStarted += 1;
      log.info(
        'files',
        `dragged ${paths.length} file(s) to Finder — ${paths.map((p) => basename(p)).join(', ')} — ` +
          `${dragsStarted} started / ${dragsRefused} refused`,
      );
    } catch (error) {
      dragsRefused += 1;
      log.warn(
        'files',
        `startDrag refused ${paths.length} file(s): ${(error as Error).message} — ` +
          `${dragsStarted} started / ${dragsRefused} refused`,
      );
    }
  };
  app
    .getFileIcon(paths[0]!, { size: 'normal' })
    .then((icon) => start(icon.isEmpty() ? FALLBACK_DRAG_ICON : icon))
    .catch(() => start(FALLBACK_DRAG_ICON));
});
ipcMain.handle(
  'fs-thumb',
  (_event, options: { rootId: string; ids: string[]; maxEdge?: number }) =>
    files
      .thumbsFor(options.rootId, options.ids, options.maxEdge)
      // A Map does not survive structured cloning to the renderer in a useful shape, so it crosses
      // as entries and is rebuilt there — the same shape `media-thumbs` already uses.
      .then((result) =>
        result.ok
          ? { ok: true as const, entries: [...result.data.entries()] }
          : { ok: false as const, reason: result.reason, code: result.code },
      ),
);
ipcMain.handle(
  'fs-list',
  (
    _event,
    options: { rootId: string; path?: string; limit?: number; afterName?: string; afterId?: string },
  ) => files.list(options),
);

ipcMain.handle('media-buckets', () => photos.buckets());
ipcMain.handle(
  'media-list',
  (_event, options: { bucketId?: string; limit?: number; before?: number; beforeId?: string } = {}) =>
    photos.list(options),
);
ipcMain.handle(
  'media-thumbs',
  async (_event, options: { ids: string[]; maxEdge?: number }) => {
    const result = await photos.thumbsFor(options.ids, options.maxEdge);
    // A Map does not survive the structured clone across the bridge as anything the renderer can
    // read back by key, so it crosses as entries and is rebuilt there. Defect 22's family: the
    // renderer must receive a shape it asked for, not Electron's idea of one.
    return result.ok ? { ok: true as const, data: [...result.data.entries()] } : result;
  },
);

ipcMain.handle('media-original', (_event, options: { id: string }) => photos.original(options.id));

ipcMain.handle('apps-list', () => apps.list());
ipcMain.handle(
  'apps-icons',
  async (_event, options: { packages: string[]; maxEdge?: number }) => {
    const result = await apps.iconsFor(options.packages, options.maxEdge);
    // Entries rather than a Map, exactly as `media-thumbs` does it: a Map does not survive the
    // structured clone across the bridge as anything the renderer can read back by key.
    return result.ok ? { ok: true as const, data: [...result.data.entries()] } : result;
  },
);
/**
 * `apps.open.ask`, and the handler name is part of the contract.
 *
 * Not `apps-launch`, not `apps-open`. The channel a renderer types is the last place the wrong verb
 * can creep back in, and it would creep back in here first — this is the one name in the feature
 * that no protocol checker reads.
 */
ipcMain.handle('apps-open-ask', (_event, options: { package: string }) => apps.openAsk(options.package));

/**
 * The resume probe — **debug builds only**, registered beside `debugSwitches` for the same reason.
 *
 * It exists to exercise resume rather than specify it. Everything it drives is the product's own
 * path: `photos.original` for the ticket, `BulkClient.pull` for both halves, and the same
 * `TransferDigest` the receiver uses. What it injects is an interruption, which is a stimulus and
 * not a mechanism — a standalone script speaking the protocol itself would have been a second
 * client, which is the thing defect 50's rule forbids.
 *
 * The reading it produces: the `.part` exists and its length is exactly what the resumed pull is
 * offered as `offset`, and the resumed transfer's digest equals a whole-file digest of the source.
 */
if (!app.isPackaged) {
  /**
   * The push half of the resume probe: interrupt a send, then send it again and read the offset.
   *
   * The phone is the receiver here, so **the phone decides the resume point** — the number comes
   * back in the `fs.transfer.begin` ack rather than being chosen by this side. That is the whole
   * point of the reading: `offset` was `0` for two slices because nothing had ever been the
   * receiver, and this is what makes it a real number.
   */
  /**
   * The push-resume probe, in one call or in two halves.
   *
   * `stopAfterCut` and `resumeOnly` exist for one reading and it is a specific one: **whether a
   * pending `MediaStore` item can be resumed across process death.** That claim has been carried as
   * unproven since the payload spec was written, and it cannot be measured in a single call —
   * something has to kill the phone's process between the interruption and the resume, and both
   * halves have to be the product's own client rather than a second one built for the test.
   *
   * So the probe splits at exactly the point the process dies, and neither half changes what the
   * shipping code does; only where the run stops.
   */
  ipcMain.handle('debug-push-resume-probe', async (_event, options: {
    rootId: string;
    path: string;
    source: string;
    /** Stop after the interruption and report it. The process may then be killed. */
    stopAfterCut?: boolean;
    /** Skip the interruption; agree and finish. What runs after the process came back. */
    resumeOnly?: boolean;
  }) => {
    if (!link?.isConnected() || !bulk) return { ok: false, reason: 'not connected' };
    const host = link.status().address;
    const token = link.token();
    if (!host || !token) return { ok: false, reason: 'no live session' };

    const size = (await fsp.stat(options.source)).size;
    const name = options.source.split('/').pop() ?? 'probe.bin';

    // The digest is agreed in advance, exactly as `FilesClient.push` does it. Without it the run
    // would prove resume and say nothing about whether the resumed bytes were right — and the
    // resumed digest starting in the wrong place is the failure the whole design is arranged
    // around.
    const sha256 = await new Promise<string>((resolve) => {
      const hash = createHash('sha256');
      const stream = createReadStream(options.source);
      stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });

    const begin = async () =>
      link!.request(
        MessageType.FS_TRANSFER_BEGIN,
        {
          direction: 'push',
          rootId: options.rootId,
          path: options.path,
          name,
          size,
          sha256,
          overwrite: true,
        },
        10_000,
      );

    let firstOffset = 0;
    let cutBytes = 0;
    if (options.resumeOnly !== true) {
      const first = await begin();
      const p1 = (first.payload ?? {}) as Record<string, unknown>;
      firstOffset = Number(p1.offset ?? 0);
      const cut = await bulk.push({
        host,
        token,
        transferId: String(p1.transferId ?? ''),
        source: options.source,
        offset: firstOffset,
        totalBytes: size,
        chunkMax: Number(p1.chunkMax ?? 262144),
        interruptAfterBytes: Math.floor(size / 2),
      });
      cutBytes = cut.bytes;
      if (options.stopAfterCut === true) {
        return {
          ok: true,
          size,
          firstOffset,
          // **Bytes delivered, and it says so.** `socket.destroy()` reported bytes *queued* and
          // 12 MB of them never left the machine — the instrument reporting its intention as a
          // measurement. `bulk.push` half-closes now and resolves from the socket's `close`.
          sentBeforeCut: cutBytes,
          sha256,
          cutAt: Math.floor(size / 2),
          stopped: 'after the cut, by request — nothing was resumed in this call',
        };
      }
    }

    // A second agreement: one transferId, one bulk connection, and the first was consumed.
    const second = await begin();
    const p2 = (second.payload ?? {}) as Record<string, unknown>;
    const resumedOffset = Number(p2.offset ?? 0);
    const finish = await bulk.push({
      host,
      token,
      transferId: String(p2.transferId ?? ''),
      source: options.source,
      offset: resumedOffset,
      totalBytes: size,
      chunkMax: Number(p2.chunkMax ?? 262144),
    });

    return {
      ok: true,
      size,
      firstOffset,
      sentBeforeCut: cutBytes,
      // The reading. A non-zero number here is the phone saying what it already holds.
      resumedOffset,
      resumedSent: finish.bytes,
      sha256,
      // What the instrument itself imposed, reported so a result shaped by it cannot be read as a
      // result about the mechanism.
      cutAt: Math.floor(size / 2),
    };
  });

  ipcMain.handle('debug-resume-probe', async (_event, options: { id: string }) => {
    if (!link?.isConnected() || !bulk) return { ok: false, reason: 'not connected' };
    const host = link.status().address;
    const token = link.token();
    if (!host || !token) return { ok: false, reason: 'no live session' };

    const ticket = await link.request(MessageType.MEDIA_ORIGINAL, { id: options.id }, 10_000);
    const payload = (ticket.payload ?? {}) as Record<string, unknown>;
    const transferId = String(payload.transferId ?? '');
    const size = Number(payload.size ?? 0);
    const name = String(payload.name ?? 'probe.bin');
    const destination = join(tmpdir(), `connectsuite-resume-${Date.now()}-${name}`);

    // Half of it, then the socket dies. The receiver takes its ordinary interruption path.
    const first = await bulk.pull({
      host,
      token,
      transferId,
      destination,
      expectedBytes: size,
      interruptAfterBytes: Math.floor(size / 2),
    });

    const part = partPathFor(destination);
    const partBytes = await fsp.stat(part).then((s) => s.size).catch(() => null);

    // The second half needs its own ticket: one transferId, one bulk connection, and the first was
    // consumed when the socket claimed it.
    const ticket2 = await link.request(MessageType.MEDIA_ORIGINAL, { id: options.id }, 10_000);
    const payload2 = (ticket2.payload ?? {}) as Record<string, unknown>;
    const second = await bulk.pull({
      host,
      token,
      transferId: String(payload2.transferId ?? ''),
      destination,
      expectedBytes: size,
      recordedBytes: partBytes,
    });

    // The control this whole probe turns on: the digest of what landed, computed independently of
    // the transfer, against the digest the resumed receiver reported.
    const onDisk = await fsp
      .readFile(destination)
      .then((buffer) => createHash('sha256').update(buffer).digest('hex'))
      .catch(() => null);

    return {
      ok: true,
      size,
      firstHalf: { ok: first.ok, bytes: first.bytes, reason: first.reason },
      partBytes,
      offsetOffered: second.resumedFrom ?? 0,
      offsetMatchesPart: partBytes !== null && second.resumedFrom === partBytes,
      second: { ok: second.ok, bytes: second.bytes, verified: second.verified, sha256: second.sha256 },
      wholeFileDigest: onDisk,
      digestsAgree: onDisk !== null && onDisk === second.sha256,
      destination,
    };
  });

  /**
   * The `fs.*` probe — **debug builds only**, and it drives the product's own client throughout.
   *
   * Every request below goes through `link.request`, which is the same call `photos.ts` and every
   * other feature client makes. Nothing here opens its own socket or speaks the protocol itself:
   * that would be a second client, differing from the shipping one somewhere, verifying a mechanism
   * the product does not use — defect 50's rule, and the reason `SafProbeActivity` had to exist on
   * the phone side rather than an `adb shell am start`.
   *
   * ### It reports every bound it imposes
   *
   * `pageCap` and `stopped` are in the result because a run that hit a cap has proven the pager
   * advances and has proven **nothing** about the total. A probe that ended its own run and then
   * reported the ending as the finding is the seventh row of the control table in `CLAUDE.md`, and
   * it cost a wrong conclusion about `media.list` on 2026-08-31.
   *
   * `tieBoundaries` is the other half of the same honesty: pages that sum and never repeat do not
   * prove the *tiebreaker* ran. Without that count, a green pager is not evidence for the clause
   * most likely to be deleted as redundant later.
   */
  ipcMain.handle('debug-fs-probe', async (_event, options: {
    rootId?: string;
    path?: string;
    limit?: number;
    pageCap?: number;
  } = {}) => {
    if (!link?.isConnected()) return { ok: false, reason: 'not connected' };
    const client = link;
    const ask = async (type: string, payload: Record<string, unknown>) => {
      try {
        const reply = await client.request(type, payload, 30_000);
        return { ok: true as const, payload: (reply.payload ?? {}) as Record<string, unknown> };
      } catch (error) {
        return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
      }
    };

    // 1. The discovery call. No rootId at all.
    const roots = await ask(MessageType.FS_LIST, {});
    if (!roots.ok) return { ok: false, stage: 'roots', reason: roots.reason };

    const rootId = options.rootId
      ?? (roots.payload.roots as Array<Record<string, unknown>> | undefined)
        ?.find((r) => r.kind === 'tree')?.rootId as string | undefined;
    if (!rootId) return { ok: true, roots: roots.payload, note: 'no tree root to page' };

    // 2. Page the directory to exhaustion, counting everything that makes the count mean something.
    const limit = options.limit ?? 200;
    const pageCap = options.pageCap ?? 500;
    const seen: string[] = [];
    const names = new Map<string, number>();
    let pages = 0;
    let tieBoundaries = 0;
    let hasMore = true;
    let afterName: string | undefined;
    let afterId: string | undefined;
    let stopped = 'exhausted';
    let firstPageMs = 0;
    const startedAt = Date.now();

    while (hasMore) {
      const at = Date.now();
      const page = await ask(MessageType.FS_LIST, {
        rootId,
        path: options.path ?? '',
        limit,
        ...(afterName !== undefined ? { afterName, afterId } : {}),
      });
      if (!page.ok) return { ok: false, stage: `page ${pages + 1}`, reason: page.reason, seen: seen.length };
      if (pages === 0) firstPageMs = Date.now() - at;
      pages += 1;
      const entries = (page.payload.entries ?? []) as Array<Record<string, unknown>>;
      entries.forEach((e) => {
        seen.push(String(e.id));
        names.set(String(e.name), (names.get(String(e.name)) ?? 0) + 1);
      });
      hasMore = page.payload.hasMore === true;
      if (entries.length > 0) {
        const last = entries[entries.length - 1]!;
        // A boundary lands inside a tie group when the entry it cuts after shares a display name
        // with another entry — exactly when a name-only cursor could not advance.
        if (hasMore && (names.get(String(last.name)) ?? 0) > 1) tieBoundaries += 1;
        afterName = String(last.name);
        afterId = String(last.id);
      }
      if (pages >= pageCap && hasMore) {
        stopped = 'page cap';
        break;
      }
    }

    const distinct = new Set(seen).size;
    const duplicateNameGroups = [...names.values()].filter((n) => n > 1).length;

    // 3. Stat the first thing the listing gave us, by the id it gave us.
    const firstId = seen[0];
    const stat = firstId ? await ask(MessageType.FS_STAT, { rootId, id: firstId }) : null;

    // 4. A path that tries to escape the root. It must be refused, not normalised.
    const traversal = await ask(MessageType.FS_LIST, { rootId, path: 'Camera/../../..' });

    // 5. A root the phone has not been granted.
    const ungranted = await ask(MessageType.FS_LIST, { rootId: 'saf:primary%3ANotGranted' });

    return {
      ok: true,
      roots: roots.payload,
      rootId,
      pager: {
        pages,
        // Every bound this instrument imposes, in what it reports.
        limit,
        pageCap,
        stopped,
        seen: seen.length,
        distinct,
        allDistinct: distinct === seen.length,
        // A run that hit the cap has proven the pager advances and nothing about the sum.
        sums: stopped === 'exhausted' ? 'tested' : 'not tested — capped',
        duplicateNameGroups,
        tieBoundaries,
        tiebreakExercised: tieBoundaries > 0,
        elapsedMs: Date.now() - startedAt,
        firstPageMs,
      },
      stat: stat?.ok ? stat.payload : stat,
      traversalRefused: !traversal.ok ? traversal.reason : 'ACCEPTED — this is a defect',
      ungrantedRefused: !ungranted.ok ? ungranted.reason : 'ACCEPTED — this is a defect',
    };
  });

  /**
   * The compare-and-delete guard, exercised on hardware with both halves.
   *
   * **A refusal on its own is not evidence.** A guard that refuses everything looks identical to a
   * guard that works, so this run takes the matching pair too and confirms the file is then gone —
   * a known positive beside the negative, which is the control rule in its smallest form.
   */
  /**
   * One `fs.*` pull, end to end, with a digest agreed in advance. **Debug builds only.**
   *
   * This is the first transfer in the project where `expectedSha256` is not null, so it is the first
   * one where `verified: true` means anything and the first where `CHECKSUM_MISMATCH` can be reached
   * at all. Run it once clean and once with `FsProbeActivity` armed; the second run must leave a
   * `.failed` sidecar and **no** `.part`.
   *
   * Everything it drives is the product's: `link.request` for the ticket, `BulkClient.pull` for the
   * bytes, and the same `TransferDigest` the receiver uses. The corruption is injected on the phone,
   * inside the shipping sender, for the reason defect 50 left behind — a tool that speaks the
   * protocol itself is a second client, and the difference between it and the product is where this
   * class of bug lives.
   */
  ipcMain.handle('debug-fs-pull-probe', async (_event, options: {
    rootId: string;
    path?: string;
    name: string;
  }) => {
    if (!link?.isConnected() || !bulk) return { ok: false, reason: 'not connected' };
    const host = link.status().address;
    const token = link.token();
    if (!host || !token) return { ok: false, reason: 'no live session' };

    const listing = await link.request(
      MessageType.FS_LIST,
      { rootId: options.rootId, path: options.path ?? '', limit: 500 },
      30_000,
    );
    const entries = ((listing.payload ?? {}).entries ?? []) as Array<Record<string, unknown>>;
    const target = entries.find((e) => e.name === options.name);
    if (!target) return { ok: false, reason: `no entry named ${options.name}` };

    let ticket;
    try {
      ticket = await link.request(
        MessageType.FS_TRANSFER_BEGIN,
        { direction: 'pull', rootId: options.rootId, id: target.id },
        60_000,
      );
    } catch (error) {
      return { ok: false, stage: 'begin', reason: error instanceof Error ? error.message : String(error) };
    }
    const agreed = (ticket.payload ?? {}) as Record<string, unknown>;
    const destination = join(tmpdir(), `connectsuite-fs-${Date.now()}-${options.name}`);

    const result = await bulk.pull({
      host,
      token,
      transferId: String(agreed.transferId ?? ''),
      destination,
      expectedBytes: Number(agreed.size ?? 0),
      // The whole point of this probe: a digest agreed **before** a byte moved.
      expectedSha256: (agreed.sha256 as string | null) ?? null,
    });

    // Computed independently of the transfer, so "the digests agree" is not the receiver agreeing
    // with itself.
    const onDisk = await fsp
      .readFile(destination)
      .then((buffer) => createHash('sha256').update(buffer).digest('hex'))
      .catch(() => null);
    const partBytes = await fsp.stat(partPathFor(destination)).then((s) => s.size).catch(() => null);
    const failed = await fsp.readFile(`${destination}.failed`, 'utf8').catch(() => null);

    return {
      ok: true,
      agreed: {
        transferId: agreed.transferId,
        size: agreed.size,
        sha256: agreed.sha256,
        offset: agreed.offset,
        chunkMax: agreed.chunkMax,
        preHashed: agreed.sha256 !== null && agreed.sha256 !== undefined,
      },
      transfer: {
        ok: result.ok,
        bytes: result.bytes,
        verified: result.verified,
        sha256: result.sha256,
        reason: result.reason,
      },
      onDisk: { wholeFileDigest: onDisk, matchesAgreed: onDisk !== null && onDisk === agreed.sha256 },
      leftBehind: {
        partBytes,
        partDeleted: partBytes === null,
        failedSidecar: failed,
        sidecarWritten: failed !== null,
      },
      destination,
    };
  });

  /**
   * `fs.transfer.cancel` on a transfer that was agreed and never claimed. **Debug builds only.**
   *
   * The interesting half is what happens *after*: a bulk socket presenting the cancelled id must be
   * refused. A cancel that answers `stopped: true` and leaves the transfer claimable is a cancel
   * that reported success for something it did not do — and nothing in the ack could tell the
   * difference, which is why the refusal is the assertion rather than the ack.
   */
  ipcMain.handle('debug-fs-cancel-probe', async (_event, options: {
    rootId: string;
    path?: string;
    name: string;
  }) => {
    if (!link?.isConnected() || !bulk) return { ok: false, reason: 'not connected' };
    const host = link.status().address;
    const token = link.token();
    if (!host || !token) return { ok: false, reason: 'no live session' };

    const listing = await link.request(
      MessageType.FS_LIST, { rootId: options.rootId, path: options.path ?? '', limit: 500 }, 30_000,
    );
    const entries = ((listing.payload ?? {}).entries ?? []) as Array<Record<string, unknown>>;
    const target = entries.find((e) => e.name === options.name);
    if (!target) return { ok: false, reason: `no entry named ${options.name}` };

    const ticket = await link.request(
      MessageType.FS_TRANSFER_BEGIN,
      { direction: 'pull', rootId: options.rootId, id: target.id },
      60_000,
    );
    const agreed = (ticket.payload ?? {}) as Record<string, unknown>;
    const transferId = String(agreed.transferId ?? '');

    const cancel = await link.request(
      MessageType.FS_TRANSFER_CANCEL, { transferId, reason: 'user' }, 20_000,
    );

    // The assertion. The id was agreed and then withdrawn; a socket claiming it must get nothing.
    const destination = join(tmpdir(), `connectsuite-cancelled-${Date.now()}.bin`);
    const afterwards = await bulk.pull({
      host, token, transferId, destination,
      expectedBytes: Number(agreed.size ?? 0),
      expectedSha256: (agreed.sha256 as string | null) ?? null,
    });
    const landed = await fsp.stat(destination).then((s) => s.size).catch(() => null);

    return {
      ok: true,
      transferId,
      cancelAck: cancel.payload,
      claimAfterCancel: { ok: afterwards.ok, bytes: afterwards.bytes, reason: afterwards.reason },
      refusedAfterCancel: afterwards.ok !== true,
      nothingLanded: landed === null || landed === 0,
    };
  });

  ipcMain.handle('debug-fs-delete-probe', async (_event, options: {
    rootId: string;
    path?: string;
    name: string;
  }) => {
    if (!link?.isConnected()) return { ok: false, reason: 'not connected' };
    const client = link;
    const ask = async (type: string, payload: Record<string, unknown>) => {
      try {
        const reply = await client.request(type, payload, 20_000);
        return { ok: true as const, payload: (reply.payload ?? {}) as Record<string, unknown> };
      } catch (error) {
        return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
      }
    };
    const findTarget = async () => {
      const page = await ask(MessageType.FS_LIST, { rootId: options.rootId, path: options.path ?? '', limit: 500 });
      if (!page.ok) return null;
      const entries = (page.payload.entries ?? []) as Array<Record<string, unknown>>;
      return entries.find((e) => e.name === options.name) ?? null;
    };

    const before = await findTarget();
    if (!before) return { ok: false, reason: `no entry named ${options.name} to delete` };

    const size = Number(before.size);
    const mtimeMs = Number(before.mtimeMs);

    // The negative: one fact deliberately wrong. Nothing may be deleted.
    const wrongSize = await ask(MessageType.FS_DELETE, {
      rootId: options.rootId, id: before.id, expectSize: size + 1, expectMtimeMs: mtimeMs,
    });
    // And the other fact wrong on its own, because a guard checking only the size cannot see a file
    // rewritten to the same length — which is the case worth having two facts for.
    const wrongMtime = await ask(MessageType.FS_DELETE, {
      rootId: options.rootId, id: before.id, expectSize: size, expectMtimeMs: mtimeMs - 1000,
    });
    // Missing entirely: there is no unconditional delete to fall back to.
    const noExpectation = await ask(MessageType.FS_DELETE, { rootId: options.rootId, id: before.id });

    const stillThere = await findTarget();

    // The known positive. Both facts as the listing gave them.
    const matched = await ask(MessageType.FS_DELETE, {
      rootId: options.rootId, id: before.id, expectSize: size, expectMtimeMs: mtimeMs,
    });
    const afterwards = await findTarget();

    return {
      ok: true,
      target: { name: before.name, id: before.id, size, mtimeMs },
      refusedWrongSize: wrongSize.ok ? 'DELETED — this is a defect' : wrongSize.reason,
      refusedWrongMtime: wrongMtime.ok ? 'DELETED — this is a defect' : wrongMtime.reason,
      refusedNoExpectation: noExpectation.ok ? 'DELETED — this is a defect' : noExpectation.reason,
      survivedAllThreeRefusals: stillThere !== null,
      matchedPair: matched.ok ? matched.payload : matched,
      goneAfterwards: afterwards === null,
    };
  });
}

ipcMain.handle('call-current', () => calls.currentCall());
ipcMain.handle('call-log', (_event, options: { limit?: number; before?: number } = {}) =>
  calls.log(options),
);
// No arguments, deliberately: the call acted on is the one the main process holds, and its id is
// sent explicitly. See calls.ts and step 61.
ipcMain.handle('call-answer', () => calls.answer());
ipcMain.handle('call-reject', () => calls.reject());
ipcMain.handle('call-dial', (_event, number: string) => calls.dial(number));

ipcMain.handle(
  'sms-threads',
  (_event, options: { limit?: number; before?: number } = {}) => sms.listThreads(options),
);
ipcMain.handle(
  'sms-messages',
  (_event, payload: { threadId: string; options?: { limit?: number; before?: number } }) =>
    sms.listMessages(payload.threadId, payload.options ?? {}),
);
// No recipient parameter, deliberately. See sms.ts and the send rule in docs/protocol.md.
ipcMain.handle('sms-send', (_event, payload: { threadId: string; body: string }) =>
  sms.send(payload.threadId, payload.body),
);
// The one channel that carries a recipient, and it carries no thread id — defect 30. Two channels
// rather than one optional field, so a send into an existing thread cannot supply its own
// recipient and skip the check that stops a message reaching the wrong person.
ipcMain.handle('sms-send-new', (_event, payload: { addresses: string[]; body: string }) =>
  sms.sendNew(payload.addresses, payload.body),
);

ipcMain.handle('remote-state', () => remote.current());
ipcMain.handle(
  'remote-command',
  (_event, payload: { action: string; extra?: Record<string, unknown> }) =>
    remote.command(payload.action, payload.extra ?? {}),
);

ipcMain.handle('status', () => link?.status() ?? null);

/**
 * This Mac's own name and key, for the sidebar's account block.
 *
 * D1/D2 in `docs/phase-9-distribution-audit.md`: that block was `Chetan Pujari` and `CP` in the
 * markup, so every user of this build saw the author's name in their own sidebar. There is no
 * account to read a person's name from — `CLAUDE.md`'s first line is *no cloud, no account, no
 * relay server* — so the block describes **this Mac**, which is what its second line already says
 * it does, and the name is the one the machine calls itself.
 *
 * Read-only and side-effect-free, unlike `pairing-qr`, which is the other place the device name is
 * reachable and which *arms a pairing token* as it goes.
 */
ipcMain.handle('self-identity', () => ({
  name: selfName,
  // The first 16 hex characters, matching how the phone's Paired Macs list abbreviates it, so the
  // two can be compared by eye when somebody is working out which Mac is which.
  fingerprint: selfFingerprint ? selfFingerprint.replace(/:/g, '').slice(0, 16) : null,
}));

ipcMain.handle('pairing-qr', async (_event, rotate?: boolean) => {
  if (!link) throw new Error('Link not ready');
  const payload = link.armPairing(localAddress(), rotate === true);
  const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
  });
  log.info('pairing', `QR armed for ${payload.host}`);
  // Arming a code is the user saying "pair now", and the Mac is the only side that dials out.
  // forget-device leaves the client stopped, so without this the phone scans a code that nothing
  // is dialling for: it trusts us, we never call, and pairing can never complete. start() is a
  // no-op when already running; retryNow cuts a backoff that could be 30s long.
  link.start();
  link.retryNow('pairing QR armed');
  return { payload, dataUrl };
});

ipcMain.handle('connect', () => link?.start());
ipcMain.handle('disconnect', () => link?.stop('user disconnected'));
ipcMain.handle('retry-now', () => link?.retryNow('user'));

ipcMain.handle('set-manual-address', (_event, address: string) => {
  const trimmed = address.trim();
  store.set('manualAddress', trimmed.length > 0 ? trimmed : null);
  link?.retryNow('manual address changed');
});

ipcMain.handle('set-tailscale-address', (_event, address: string) => {
  const trimmed = address.trim();
  store.set('tailscaleAddress', trimmed.length > 0 ? trimmed : null);
});

ipcMain.handle('forget-device', () => {
  store.set('paired', null);
  store.set('lastAddress', null);
  link?.stop('device forgotten');
  log.info('pairing', 'Forgot the paired phone');
});

ipcMain.handle('settings', () => ({
  paired: store.get('paired'),
  lastAddress: store.get('lastAddress'),
  manualAddress: store.get('manualAddress'),
  tailscaleAddress: store.get('tailscaleAddress'),
  lastDiscoveryVia: store.get('lastDiscoveryVia'),
}));

ipcMain.handle('log-tail', (_event, lines: number) => tailLog(lines ?? 200));
