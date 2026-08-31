import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, Tray, Menu } from 'electron';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { ErrorCode, MessageType, type ConnectionStatus } from '../shared/protocol';
import { loadIdentity } from './identity';
import { InputClient } from './input';
import { ContactsClient } from './contacts';
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
 * The photo browser's three working verbs.
 *
 * Not gated on the `photos` capability, and that is deliberate: the capability is not advertised
 * because `media.original` needs the bulk channel, while `media.buckets`, `media.list` and
 * `media.thumb` all answer today. A client that refused to ask because the chip is grey would turn
 * a partly-working feature into a dead one.
 */
const photos = new PhotosClient(() => link);

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

let wasConnected = false;
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
function sendAll(channel: string, payload: unknown): void {
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
  log.info('app', `ConnectSuite ${app.getVersion()} starting`);
  // Read here, and only here, so a weakened guard announces itself in the first lines of the log
  // rather than when it first bites — by which time a confusing result has already happened and
  // would be blamed on the feature. Packaged builds never reach this.
  if (!app.isPackaged) debugSwitches();

  const identity = loadIdentity();
  link = new LinkClient(identity);
  video = new VideoClient(identity);

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
      photos.clear();
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
  sms.on('message', (event) => send('sms-received', event));
  calls.on('changed', (call) => send('call-changed', call));

  tray = new Tray(nativeImage.createEmpty());
  refreshTray();
  createWindow();

  if (store.get('autoConnect')) link.start();

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
    return { ok: true, path };
  } catch (error) {
    captures.failed += 1;
    log.warn('video', `Capture failed: ${String(error)} — ${captureTally()}`);
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

ipcMain.handle(
  'contacts-list',
  (_event, options: { query?: string; limit?: number } = {}) => contacts.list(options),
);
ipcMain.handle(
  'contacts-get',
  (_event, options: { id?: string; number?: string; withPhoto?: boolean }) => contacts.get(options),
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
