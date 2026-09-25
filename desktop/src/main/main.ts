import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, powerMonitor, Tray, Menu,
  dialog, shell, screen,
} from 'electron';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { ErrorCode, MessageType, type ConnectionStatus, type PhoneNotification, type PairRejected } from '../shared/protocol';
import { loadIdentity } from './identity';
import { InputClient } from './input';
import { ClipboardClient } from './clipboard';
import { ClipboardWatcher } from './clipboardWatcher';
import {
  checkWritableFolder,
  chosenDownloadsFolder,
  defaultDownloadsFolder,
  downloadsFolder,
  ensureReceiveFolder,
} from './downloads';
/*
 * `shared/appearance.ts` is a plain script for the same reason `shared/activity.ts` is — the
 * CSP-locked renderer loads it with a `<script>` tag, so it carries no top-level `export` and has
 * to be `require`d rather than imported. The rule it holds is called from both processes.
 */
const appearanceRules = require('../shared/appearance') as {
  resolveTheme: (a: 'system' | 'light' | 'dark', systemDark: boolean) => 'light' | 'dark';
  asAppearance: (v: unknown) => 'system' | 'light' | 'dark';
  WINDOW_GROUND: Record<'light' | 'dark', string>;
  FLOAT_GROUND: Record<'light' | 'dark', string>;
};
// F6 / P3: the mDNS watch that tells "nobody has scanned" from "scanned, and now searching".
import { watchForPairIntent } from './discovery';
// The one home for "is this clipboard entry something we may hand to the operating system".
// The pane requires the same module to decide whether to draw the button; see clipLink.ts.
const { openableUrl } = require('../shared/clipLink') as {
  openableUrl: (text: string | undefined | null) => string | null;
};
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
/**
 * `humanBytes`, from the file that already owns it for the O4 ring.
 *
 * **Required rather than reimplemented**, and the reason is the one this repo keeps paying for: a
 * second byte formatter is a second answer to "what is a gigabyte", and the two disagree the first
 * time somebody fixes one of them. It is the same function the Device status ring renders with, so
 * a size in the Activity log and a size under a ring cannot come out in different units.
 */
// The send batch's naming rule, shared with the renderer that draws the batch — `name (2).ext` has
// one home, so the name the phone is offered and the name the pane reports cannot disagree.
const sharedSendBatch = require('../shared/sendBatch') as {
  suffixedName: (name: string, n: number) => string;
};
const sharedVitals = require('../shared/deviceVitals') as {
  humanBytes: (bytes: number) => string;
};
import { FilesClient } from './files';
import {
  cachedPreview,
  clearPreviews,
  previewFolder,
  registerPreviewScheme,
  rememberPreview,
  servePreviews,
} from './mediaPreview';
import { ask } from './feature';
import { AppsClient } from './apps';
import { PhotosClient } from './photos';
import { NotificationClient } from './notifications';
import { NativeNotifier } from './nativeNotifier';
import { pairRejectionCopy } from '../shared/pairRejection';
import { buildAppMenu, type MenuRoute } from './appMenu';
import { localPairAddress } from '../shared/pairReach';
import { RemoteClient } from './remote';
import { CallClient } from './calls';
import { SmsClient } from './sms';
import { LinkClient } from './link';
import { globalShortcut } from 'electron';
import { initLogger, log, tailLog } from './logger';
// The main process imports this normally; `float.html` loads the same file as a classic script and
// gets the globals it declares. Both are the same source, which is the point — the counting rule
// has one home and the two windows cannot drift.
import { KeyframeTrace } from '../shared/keyframeTrace';
import { debugSwitches } from './debugSwitches';
import { ShareReceiver } from './share';
import { checkDestination, publishExclusive, realFs } from './shareDestination';
import { FileShareLedger, ledgerFile, sweepLedger } from './shareLedger';
import {
  advertisedExt,
  receiverMode,
  resolveScratchFolder,
  scratchFolderPath,
  SHARE_PRODUCTION_READINESS,
  shareAskActivation,
  shareV2Activation,
} from './shareActivation';
import { acceptAllowed, forRenderer, handleShareDecision } from './shareDecision';
import { ShareReceiveWindow } from './shareWindow';
import { newlyNeedingAttention, parseOfferRequest } from './shareWindowRules';
import { settingsMigration, store } from './store';
import {
  clearRePairPending,
  decideRePair,
  hasLegacyIdentity,
  legacyDownloadsFolder,
  legacyLogsDir,
  legacyUserDataDir,
  mergeLegacyActivity,
  pairingRenameNotice,
} from './legacyData';
import { VideoClient, type VideoFrame } from './video';
import { FloatMirrorWindow } from './float';
import { armPairingCode } from './pairingArm';
import { fitWindow, DESIGN } from '../shared/windowGeometry';

let window: BrowserWindow | null = null;
/**
 * The detached mirror window — the second of the *two views of one session*.
 *
 * Constructed lazily in `whenReady` because it needs `app.getAppPath()`-relative paths and a
 * `screen` module that does not exist before then.
 */
let float: FloatMirrorWindow | null = null;
/** The receive window (docs/feature-a-receive-window.md). Built beside the receiver, in `whenReady`. */
let shareWindow: ShareReceiveWindow | null = null;
let tray: Tray | null = null;
/**
 * Edge detector for the native notifier's replay cutoff.
 *
 * Deliberately **not** the existing `wasConnected`, which the remote-capability check further down
 * reads as *the previous value* and updates itself. Sharing it would have made this handler write
 * the flag before that check read it — a silent behaviour change in unrelated code, caught only
 * because the two declarations collided.
 */
let notifierWasConnected = false;
let link: LinkClient | null = null;
/** Set by the Disconnect command, read once by the next Activity "Disconnected" row. */
let userStoppedLink = false;
/**
 * The rename re-pair is still owed: ConnectSuite left an identity and Sidekick has not yet connected
 * on its own. Decided once and persisted (`legacyData.ts` `decideRePair`); cleared by the first
 * `connected`. It chooses the refusal sentence and the pairing screen's rename notice.
 */
let rePairPending = false;
let video: VideoClient | null = null;
/** Serialises input so two gestures never overlap on the phone. See input.ts. */
const input = new InputClient(() => link);

/** The live notification set, built from events. See notifications.ts. */
const notifications = new NotificationClient(() => link);
/**
 * Native macOS notifications. The reveal callback routes *and* flashes the row, because routing and
 * stopping is indistinguishable from a link that failed — docs/phase-7-native-notifications.md §2.
 */
const nativeNotifier = new NativeNotifier(
  (key: string) => {
    if (!window) createWindow();
    window?.show();
    window?.focus();
    send('reveal-notification', { key });
  },
  () => store.get('notificationSound'),
);

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
    } else if (result.ok) {
      // **The success case, at the same volume as the failure.** This branch did not exist: only
      // the refusal was recorded, so the Activity pane held "Phone did not apply it" rows with no
      // successes beside them — a failure count with its denominator removed, in the one pane whose
      // job is to say what happened. It is once per *real copy*, not once per poll: `send` only
      // reaches here past the echo interlock and the unchanged rule.
      // `3.9 kB`, not `3852 bytes` — the handoff's activity rows read `4.2 MB` and `67 MB`, and a
      // raw byte count is a number a person has to convert before it means anything.
      activity.record(
        'clipboard',
        'Sent to phone',
        `${sharedVitals.humanBytes(result.data.bytes)}, automatically`,
      );
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
/**
 * The phone's last reported vitals — O4.
 *
 * `null` means **never reported**, which the card draws differently from *reported as unknown*.
 * Cleared on disconnect for the same reason `NotifyCooldown` resets: these are facts about the
 * phone that is connected now, and showing the previous phone's battery would be a confident wrong
 * answer of exactly the kind this project keeps writing rules about.
 */
let lastBatteryState: Record<string, unknown> | null = null;
let lastStorageState: Record<string, unknown> | null = null;

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
/**
 * The capture geometry the phone last announced, retained here. Defect 116.
 *
 * Every coordinate-bearing input message has to quote it, and the **float window had no way to get
 * it**: it was written only from `mirror-rotate`, which the phone sends when it turns and at no other
 * time. So a float opened into a running session held `null` until the user physically rotated the
 * phone, and every press answered *"The phone has not said what shape its screen is yet"* — about a
 * shape the main window had known since `mirror.state`.
 *
 * It is retained in the main process rather than asked for again because the phone has already said
 * it and nothing has retracted it. That is the same argument `video.configFrame()` makes for the
 * parameter sets, and the same door: `stream-start` answers with both.
 */
let lastCaptureGeometry: {
  width: number;
  height: number;
  dpi?: number;
  rotation?: number;
  geometryId: number;
} | null = null;

/**
 * Remember what the phone is capturing, and tell the float window's frame about it.
 *
 * One function, called from the two places a geometry arrives — `mirror.state` and `mirror.rotate` —
 * so the retained value and the window's aspect cannot be updated by one caller and not the other.
 * Two fields that must move together will otherwise move apart; that is defect 97's lesson and this
 * is the shape that avoids it.
 */
function rememberCaptureGeometry(g: {
  width?: number;
  height?: number;
  dpi?: number;
  rotation?: number;
  geometryId?: number;
}): void {
  if (!g.width || !g.height || g.geometryId === undefined) return;
  const changed =
    lastCaptureGeometry?.width !== g.width || lastCaptureGeometry?.height !== g.height;
  lastCaptureGeometry = {
    width: g.width,
    height: g.height,
    dpi: g.dpi ?? lastCaptureGeometry?.dpi,
    rotation: g.rotation ?? lastCaptureGeometry?.rotation,
    geometryId: g.geometryId,
  };
  // Defect 114. The float's OUTER bounds, not just its canvas: a landscape picture refitted inside a
  // portrait frame is the reported bug rather than the fix for it.
  const before = float?.captureRatio();
  float?.setCaptureGeometry(lastCaptureGeometry);
  const after = float?.captureRatio();
  if (changed && before !== undefined && after !== undefined && Math.abs(after - before) > 0.001) {
    log.info(
      'float',
      `capture turned to ${g.width}x${g.height} (screen #${g.geometryId}) — float aspect ` +
        `${before.toFixed(3)} → ${after.toFixed(3)}, window ${float?.state().bounds?.width ?? '?'}` +
        `x${float?.state().bounds?.height ?? '?'}`,
    );
  }
}

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
 * **Both are now ceilings and preferences rather than fixed values**, because neither is available
 * on every display. This Mac's built-in panel offers a 1512 x 865 work area — 55px short of the
 * canvas — and the window that appeared was 865 tall only because AppKit silently shrank it. A
 * rescue that belongs to the platform, is applied only when AppKit sets the frame, and does not
 * fire when the work area changes under a window that is already open, is not a guarantee this app
 * can rely on. `src/shared/windowGeometry.ts` derives both from the work area instead, and carries
 * the readings.
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
  /*
   * The display the window is about to open on — the one under the pointer, which is where macOS
   * puts a new window and where the user is looking. `getPrimaryDisplay` would be wrong on exactly
   * the setup that found this: two displays, the app launched from the second one.
   *
   * `fitWindow` then caps the design against that display's **work area** — the screen less the
   * menu bar and the Dock — rather than its bounds. See src/shared/windowGeometry.ts for why the
   * minimums have to be capped too, and why AppKit's own rescue is not a substitute.
   */
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { bounds, minimum } = fitWindow(area);
  if (bounds.width < DESIGN.width || bounds.height < DESIGN.height) {
    // Logged because it is a real, invisible degradation: every pane below is laid out against the
    // handoff's canvas and is now drawing into less than it. The success case is logged beside it
    // rather than only the shortfall — a count with no denominator is not evidence.
    log.info('window', `opened ${bounds.width}x${bounds.height} — capped from the design's ${DESIGN.width}x${DESIGN.height} ` +
      `by a ${area.width}x${area.height} work area on this display`);
  } else {
    log.info('window', `opened ${bounds.width}x${bounds.height} — the design's full size fits this ${area.width}x${area.height} work area`);
  }
  window = new BrowserWindow({
    ...bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    title: 'Sidekick',
    backgroundColor: appearanceRules.WINDOW_GROUND[currentTheme()],
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
  /*
   * The window as it actually is, not as it was asked to be.
   *
   * These are two different numbers and only the second one is on the user's screen. The request
   * above is a hope: AppKit constrains it, a work-area change can shrink it, and macOS may place
   * the window on a different display than the one it was centred for. Logging the request alone is
   * the same fault as a probe reporting bytes it queued rather than bytes that arrived — it reads
   * as a measurement and is not one.
   *
   * `ready-to-show` is after AppKit has had its say, so a disagreement here is real and worth the
   * line. The denominator is on it: the request beside the result, and the display it landed on.
   */
  window.once('ready-to-show', () => {
    const got = window?.getBounds();
    if (!got) return;
    const landedOn = screen.getDisplayMatching(got);
    const asked = `${bounds.width}x${bounds.height} at (${bounds.x},${bounds.y})`;
    const actual = `${got.width}x${got.height} at (${got.x},${got.y})`;
    const fits = got.width <= landedOn.workArea.width && got.height <= landedOn.workArea.height;
    log.info(
      'window',
      `asked ${asked}; got ${actual} on display ${landedOn.id} ` +
        `(work area ${landedOn.workArea.width}x${landedOn.workArea.height}) — ` +
        (asked === actual ? 'granted as requested' : 'CHANGED by the window server') +
        `; fits work area: ${fits}`,
    );
  });
  window.webContents.on('did-finish-load', () => window?.webContents.setZoomLevel(0));
  void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  window.on('focus', () => nativeNotifier.setWindowFocused(true));
  window.on('blur', () => nativeNotifier.setWindowFocused(false));
  window.on('closed', () => {
    // A closed window is not a focused one. Without this the app keeps suppressing banners for a
    // pane that is not on any screen — the app survives `window-all-closed` by design.
    nativeNotifier.setWindowFocused(false);
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

/**
 * Bring the main window to the front, whatever state it is in. Defect 117.
 *
 * Three states and one answer. Destroyed or never created → create it. Hidden → `show`. Minimised →
 * `restore`, which `show` alone does not do on macOS. Then `focus`, because a window raised without
 * focus leaves the keyboard pointed at whatever the user was in before.
 *
 * **It does not touch the float window and must not.** The float is a second view of one session and
 * the session lives on the link, not in either window: the reported requirement is *"reveal the main
 * window while floating stays active"*, and closing the float to satisfy it would be the workaround
 * the user already has. Nothing here reaches the video socket, so there is nothing to restart.
 *
 * `why` is logged because this has four callers now — the Dock, the tray, the float's rail, and the
 * window menu — and "the main window came forward" with no reason attached is the single-`UNKNOWN`
 * failure defect 80 is about, one product surface over.
 */
function revealMainWindow(why: string): void {
  const existed = Boolean(window && !window.isDestroyed());
  if (!existed) createWindow();
  const target = window;
  if (!target || target.isDestroyed()) {
    log.warn('window', `reveal (${why}) could not produce a main window`);
    return;
  }
  const wasMinimised = target.isMinimized();
  const wasVisible = target.isVisible();
  if (wasMinimised) target.restore();
  target.show();
  target.focus();
  // The success path gets a line at the same volume as the failure above, and it carries what the
  // window was — otherwise "revealed" cannot be told from "was already in front and nothing happened".
  log.info(
    'window',
    `main window revealed (${why}): ${existed ? 'existed' : 'created'}, ` +
      `${wasVisible ? 'visible' : 'hidden'}${wasMinimised ? ', minimised' : ''}` +
      `${float?.state().open ? ' — float stays open' : ''}`,
  );
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
        // Through `revealMainWindow` rather than its own `show()`: this item did not restore a
        // minimised window and did not focus the one it showed, so it was a third half-answer to the
        // question defect 117 is about. One function, four callers.
        label: 'Open Sidekick',
        click: () => revealMainWindow('tray'),
      },
      {
        label: 'Reconnect now',
        enabled: !connected,
        click: () => link?.retryNow('tray'),
      },
      {
        label: connected ? 'Disconnect' : 'Connect',
        click: () => {
          if (!connected) return link?.start();
          userStoppedLink = true;
          return link?.stop('tray');
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

/** The address the phone would see us on, for the QR payload. */
function localAddress(): string {
  return localPairAddress(networkInterfaces()).address;
}

/**
 * Whether a code built now could be scanned and acted on — i.e. whether this Mac has an address at
 * all. Read here, beside the interfaces, rather than inferred in the renderer from the shape of a
 * string: the process that enumerated them is the one that knows.
 */
function pairingReachable(): boolean {
  return localPairAddress(networkInterfaces()).reachable;
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

/*
 * ---- Appearance ------------------------------------------------------------------------------
 *
 * One owner, one writer. `nativeTheme.themeSource` is the single place the preference lives at
 * runtime; everything else — the stamped `data-theme`, both window grounds, the segmented control
 * in Settings — is a *reader* of `currentTheme()`.
 *
 * **`System` genuinely follows macOS**, which is the part that is easy to get wrong by wiring the
 * preference straight to a class and calling it done. Two things make it real:
 *
 *  - `themeSource = 'system'` hands the decision back to the OS, and
 *  - `nativeTheme.on('updated')` fires when the Mac flips at sunset, or when the user changes
 *    System Settings with this app in the background, and re-stamps every open window.
 *
 * Without the second one, System resolves correctly once at launch and is then wrong until
 * restart — which looks exactly like a working feature to anybody testing it in one sitting.
 */
function currentTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function storedAppearance(): 'system' | 'light' | 'dark' {
  return appearanceRules.asAppearance(store.get('appearance'));
}

/** Push the resolved theme at every window, and repaint the grounds CSS cannot reach. */
function broadcastTheme(): void {
  const theme = currentTheme();
  const appearance = storedAppearance();
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(appearanceRules.WINDOW_GROUND[theme]);
  }
  const floatWindow = float?.webContents();
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.setBackgroundColor(appearanceRules.FLOAT_GROUND[theme]);
  }
  sendAll('appearance', { appearance, theme });
}

function applyAppearance(appearance: 'system' | 'light' | 'dark'): void {
  store.set('appearance', appearance);
  nativeTheme.themeSource = appearance;
  // Logged with the resolved theme beside the preference, not the preference alone: "system" on
  // its own says nothing about what is on screen, and this is the line somebody will read when
  // asking why the app is dark on a light Mac.
  log.info('appearance', `${appearance} -> ${currentTheme()} (macOS reports ${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'})`);
  broadcastTheme();
}

nativeTheme.on('updated', () => {
  // Fires for a real OS change AND for our own themeSource writes. Re-stamping on both is correct
  // and idempotent; the alternative is a guard that has to know which caused it.
  log.info('appearance', `macOS changed — ${storedAppearance()} now resolves to ${currentTheme()}`);
  broadcastTheme();
});

ipcMain.handle('appearance-get', () => ({
  ok: true,
  data: { appearance: storedAppearance(), theme: currentTheme() },
}));

ipcMain.handle('appearance-set', (_event, value: unknown) => {
  applyAppearance(appearanceRules.asAppearance(value));
  return { ok: true, data: { appearance: storedAppearance(), theme: currentTheme() } };
});

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
  // The receive window listens only for `appearance`; any other channel is ignored by its page.
  const receive = shareWindow?.webContents();
  if (receive && !receive.isDestroyed()) receive.send(channel, payload);
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
  rememberCaptureGeometry(state);
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
    // Cleared, not kept. A geometry from a session that has ended would let the float stamp a gesture
    // with a screen the phone is no longer capturing — and the phone refuses that by design, so the
    // user would read a staleness refusal for a mirror that is simply off. Two different sentences.
    lastCaptureGeometry = null;
    video?.close('the phone stopped mirroring');
    sendAll('mirror-stopped', { reason: state.message, fixHint: state.fixHint });
  }
}

/**
 * The product's name, in the one place macOS always shows one.
 *
 * Set before `whenReady`, because the app menu's title and its About / Hide / Quit items are built
 * from it at that moment. Without this the menu bar read **Electron** and those three items read
 * **sidekick-desktop**, the npm package name — measured, not assumed; see `appMenu.ts`.
 */
app.setName('Sidekick');

/**
 * The menu is built when the renderer hands over its nav list, and a minimal one stands until then.
 *
 * The minimal menu is not a placeholder to be tidied away: it carries **Edit**, and without an Edit
 * menu macOS has nowhere to send ⌘C / ⌘V / ⌘X / ⌘A, so copy and paste are dead in every text field
 * in the app. A window that is up for 200 ms before its routes arrive is 200 ms in which somebody
 * can press ⌘V in the manual-address field.
 */
function installAppMenu(routes: MenuRoute[]): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenu(routes, {
        appName: app.getName(),
        showDeveloperItems: !app.isPackaged,
        route: (id) => {
          revealMainWindow('menu');
          sendAll('menu-route', { id });
        },
        palette: () => {
          revealMainWindow('menu');
          sendAll('menu-route', { id: '__palette__' });
        },
      }),
    ),
  );
}

ipcMain.handle('menu-routes', (_event, routes: unknown) => {
  if (!Array.isArray(routes)) return;
  installAppMenu(routes as MenuRoute[]);
});

// Chromium fixes its scheme table at startup, so this runs at module load, before ready.
registerPreviewScheme();

app.whenReady().then(() => {
  servePreviews();
  initLogger();
  installAppMenu([]);
  /*
   * The ConnectSuite → Sidekick compatibility, before anything reads the files it touches.
   * Copy-only: nothing in the ConnectSuite folder is moved, renamed or deleted (`legacyData.ts`).
   * Every outcome is logged, including "nothing to do", so a migration that never ran is
   * distinguishable from one that ran and copied nothing.
   */
  const legacyDir = legacyUserDataDir(app.getPath('userData'));
  log.info('migration', `ConnectSuite folder: ${legacyDir ?? 'none'}`);
  const settingsLine = `Settings: ${JSON.stringify(settingsMigration)}`;
  if (settingsMigration.outcome === 'failed') log.warn('migration', settingsLine);
  else log.info('migration', settingsLine);
  const activityMigration = mergeLegacyActivity(legacyDir, app.getPath('userData'));
  if (activityMigration.outcome === 'failed') {
    log.warn('migration', `Activity: ${JSON.stringify(activityMigration)}`);
  } else {
    log.info('migration', `Activity: ${JSON.stringify(activityMigration)}`);
  }
  const oldLogs = legacyLogsDir(legacyDir);
  if (oldLogs) log.info('migration', `Earlier ConnectSuite logs are in ${oldLogs} (left untouched)`);
  const rePair = decideRePair(legacyDir, app.getPath('userData'), store.get('paired') !== null);
  rePairPending = rePair.pending;
  log.info(
    'migration',
    `Rename re-pair: ${rePair.pending ? 'pending' : 'not pending'} (${rePair.decided === 'stored' ? 'as recorded' : 'decided now'}; ` +
      `ConnectSuite identity ${hasLegacyIdentity(legacyDir) ? 'present' : 'absent'}, ` +
      `Sidekick pairing ${store.get('paired') !== null ? 'present' : 'absent'})`,
  );
  activity.init();
  activity.record('system', 'Sidekick started', `version ${app.getVersion()}`);
  log.info('app', `Sidekick ${app.getVersion()} starting`);
  // Read here, and only here, so a weakened guard announces itself in the first lines of the log
  // rather than when it first bites — by which time a confusing result has already happened and
  // would be blamed on the feature. Packaged builds never reach this.
  if (!app.isPackaged) debugSwitches();

  /*
   * Before `createWindow`, deliberately. `backgroundColor` is read once at construction and is the
   * ground painted for the frame or two before the renderer's first paint — set it after the window
   * exists and a light-mode launch opens with a black flash. This is also what makes `System`
   * correct on the *first* frame rather than after the renderer's first round trip.
   */
  nativeTheme.themeSource = storedAppearance();
  log.info('appearance', `${storedAppearance()} -> ${currentTheme()} at launch`);

  /*
   * The window comes first, and the order is load-bearing rather than tidy — D15.
   *
   * `loadIdentity` decrypts through `safeStorage`, and on an ad-hoc-signed build the Keychain ACL is
   * pinned to a cdhash that changes with every rebuild, so macOS puts up a password dialog and
   * **blocks the main process inside the call**. With the window created after it, a rebuilt app
   * wrote its first log line and then nothing for 4m40s: the process was alive and bound to :9222,
   * and there was no window, which reads as a crash rather than as a prompt.
   *
   * Creating it here does not remove the prompt — only a Developer ID does that, since a stable
   * designated requirement is what makes the ACL match across rebuilds. It removes the symptom: the
   * window is on screen, painted by its own renderer process, with the dialog over an app that
   * visibly exists. Everything below still registers inside this same synchronous callback, so no
   * `ipcMain` handler is late — the renderer's first `invoke` cannot be serviced until this callback
   * returns either way.
   */
  createWindow();

  const identity = loadIdentity();
  selfName = identity.deviceName;
  selfFingerprint = identity.fingerprint;
  // Feature A (docs/protocol.md → Share). Version 1 — every live pairing, because both ends advertise
  // share.file 1 — validates each offer and declines it `not-available`. Version 2 (slice 3d) is wired
  // but unreachable live: it holds an offer for a person's decision (Ask).
  // The development switches are forced OFF in a packaged build, here, whatever the environment says.
  const devSwitches = app.isPackaged
    ? { silent: false, acceptProbe: false, devReceive: false, v2: false }
    : {
        silent: debugSwitches().shareSilent,
        acceptProbe: debugSwitches().shareAcceptProbe,
        devReceive: debugSwitches().shareDevReceive,
        v2: debugSwitches().shareV2,
      };
  // The digests the development accept switch may accept: 64-hex SHA-256s of synthetic probe bytes,
  // supplied by the tester. Read only when the switch is on in a development build; otherwise empty,
  // and an empty list accepts nothing.
  const acceptProbeDigests = new Set<string>(
    devSwitches.acceptProbe
      ? (process.env.CONNECTSUITE_SHARE_ACCEPT_SHA256 ?? '').split(',').map((d) => d.trim()).filter((d) => /^[0-9a-f]{64}$/.test(d))
      : [],
  );
  if (devSwitches.acceptProbe) {
    log.warn('share', `shareAcceptProbe: ${acceptProbeDigests.size} synthetic probe digest(s) may be accepted; nothing else can be`);
  }
  // Whether this Mac may advertise share.file 2 at all: every development condition at once, or no.
  const shareV2 = shareV2Activation({
    packaged: app.isPackaged,
    shareV2: devSwitches.v2,
    shareAcceptProbe: devSwitches.acceptProbe,
    acceptProbeDigests: acceptProbeDigests.size,
    shareDevReceive: devSwitches.devReceive,
  });
  if (shareV2.active) {
    log.warn('share', 'share.file 2 ADVERTISED (development, synthetic-only, scratch folder only) — this is not a normal run');
  } else if (devSwitches.v2) {
    log.warn('share', `share.file 2 NOT advertised: ${shareV2.why}`);
  }
  // Whether this Mac may promise `share.ask` — hold every ordinary offer for a person's Accept. It
  // cannot open in this build: both readiness facts are recorded false, and it is closed whenever the
  // development gate is open. Logged once either way, with every blocker (the denominator rule).
  const shareAsk = shareAskActivation({ development: shareV2, readiness: SHARE_PRODUCTION_READINESS });
  if (shareAsk.active) {
    log.warn('share', 'share.ask ADVERTISED with share.file 2: ordinary offers are held for a person on the card');
  } else {
    log.info('share', `share.ask not advertised — the phone's ordinary Send stays disabled: ${shareAsk.blockers.join('; ')}`);
  }
  const userData = app.getPath('userData');

  link = new LinkClient(identity, () => rePairPending, () => advertisedExt(shareV2, shareAsk));
  video = new VideoClient(identity);
  bulk = new BulkClient(identity);

  // The private ownership record for share temporary files, in this app's own data folder.
  const shareLedger = new FileShareLedger(ledgerFile(userData));
  const liveLink = link;
  const liveBulk = bulk;
  const shareMode = receiverMode(shareV2, shareAsk, acceptProbeDigests);
  if (!shareV2.active && acceptProbeDigests.size > 0) {
    log.warn('share', `shareAcceptProbe digests IGNORED: the synthetic-only development gate is not open, so nothing is auto-accepted`);
  }
  const shareReceiver = new ShareReceiver({
    link: liveLink,
    receiveFolder: async () => {
      if (devSwitches.devReceive) {
        // Development only: the scratch folder, never the configured receive folder or Downloads —
        // and never a fallback to either. Created here, at the first version-2 offer, and nowhere else.
        if (!shareV2.active) return { ok: false as const, reason: 'the scratch receive is on but version 2 is not activated' };
        const scratch = await resolveScratchFolder(userData, true);
        return scratch.ok ? { ok: true as const, folder: scratch.folder } : { ok: false as const, reason: scratch.reason };
      }
      const ready = await ensureReceiveFolder();
      return ready.ok ? { ok: true as const, folder: ready.folder } : { ok: false as const, reason: ready.reason };
    },
    checkDestination: (folder, size) => checkDestination(folder, size, realFs, shareLedger),
    pull: (options) => {
      const host = liveLink.status().address;
      if (!host) return Promise.resolve({ ok: false as const, reason: 'interrupted' as const, detail: 'no phone address', bytes: 0 });
      return liveBulk.pullShare({ ...options, host });
    },
    publish: (part, folder, name) => publishExclusive(part, folder, name),
    ledger: shareLedger,
    // `receiverMode` is the one place the two gates become the receiver's behaviour, and the only route
    // by which the development allowlist reaches it: with `share.ask` open it is empty, whatever the
    // environment says, so nothing is accepted without a person's click.
    switches: { silent: devSwitches.silent, acceptProbeDigests: shareMode.acceptProbeDigests },
    version2: shareMode.version2,
  });
  let shareSessionKey: string | null = null;

  /*
   * The receive window and the card (docs/feature-a-receive-window.md §4.2). **The receive window is
   * the one decision surface**: it appears without focus when an offer needs attention, and Accept /
   * Decline exist only there. The main window's card draws status and a *Show* button. A page sends
   * back an `offerId` and a word; `shareDecision.ts` refuses anything else and refuses an Accept from
   * a window that is not visible and focused, and `decide` re-checks destination, version and session.
   *
   * **No macOS notification and no Dock bounce** — the owner's decision, restated in the brief.
   * `presentInactive` is the only thing an arriving offer can do to a window; `shareDecision.test.ts`
   * reads this handler and that method and fails on anything that raises, focuses or notifies.
   */
  const receiveWindow = new ShareReceiveWindow(
    join(__dirname, '..', 'preload.js'),
    join(__dirname, '..', 'renderer', 'share-window.html'),
    (subject) => ({
      subject,
      offers: forRenderer(shareReceiver.snapshots(), homedir()),
      phone: store.get('paired')?.deviceName ?? null,
      thumb: subject ? (shareThumbs.get(subject) ?? null) : null,
    }),
    // Transparent: the window's material is AppKit's vibrancy, and the page paints the chrome token.
    () => '#00000000',
  );
  shareWindow = receiveWindow;
  const attentionSeen = new Set<string>();
  /*
   * Thumbnails, **only of a file this Mac published and verified**, and only images and video: made by
   * QuickLook (`createThumbnailFromPath`) from the local file — bounded by the OS and by a timeout
   * here — and never from anything the phone sent about it. One attempt per offer; a failure leaves
   * the type glyph. Memory only, like the offers.
   */
  const shareThumbs = new Map<string, string | null>();
  const makeThumb = async (offerId: string, mime: string): Promise<void> => {
    if (shareThumbs.has(offerId)) return;
    shareThumbs.set(offerId, null);
    const top = mime.split('/')[0];
    if (top !== 'image' && top !== 'video') return;
    const file = await shareReceiver.publishedFile(offerId);
    if (!file.ok) return;
    const started = Date.now();
    try {
      const image = await Promise.race([
        nativeImage.createThumbnailFromPath(file.path, { width: 224, height: 224 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 4000 ms')), 4000)),
      ]);
      if (image.isEmpty()) throw new Error('QuickLook returned an empty image');
      shareThumbs.set(offerId, image.toDataURL());
      log.info('share', `thumbnail for ${offerId} (${top}) in ${Date.now() - started} ms`);
      receiveWindow.push();
    } catch (error) {
      log.info('share', `no thumbnail for ${offerId} (${top}): ${(error as Error).message} — the type glyph stays`);
    }
  };
  shareReceiver.onChange(() => {
    const snaps = shareReceiver.snapshots();
    send('share-offers', forRenderer(snaps, homedir()));
    receiveWindow.push();
    for (const offerId of newlyNeedingAttention(attentionSeen, snaps)) receiveWindow.presentInactive(offerId);
    for (const s of snaps) {
      if ((s.state === 'saved' || s.state === 'saved-unacknowledged') && !shareThumbs.has(s.offerId)) void makeThumb(s.offerId, s.mime);
    }
  });
  ipcMain.handle('share-offers', () => forRenderer(shareReceiver.snapshots(), homedir()));
  ipcMain.handle('share-window-state', (event) => {
    if (event.sender !== receiveWindow.webContents()) return null;
    return receiveWindow.state();
  });
  ipcMain.handle('share-decide', async (event, raw: unknown) => {
    // Only the receive window decides. The main window's card has no Accept to send, and a page
    // that sends one anyway is refused here rather than trusted to have drawn the right thing.
    if (event.sender !== receiveWindow.webContents()) return { ok: false, reason: 'refused: only the receive window decides' };
    const result = await handleShareDecision(raw, receiveWindow.facts(), shareReceiver);
    log.info('share', `receive window decision ${JSON.stringify(raw)?.slice(0, 120)} → ${JSON.stringify(result)}`);
    return result;
  });
  ipcMain.handle('share-window-show', (event, raw: unknown) => {
    // A person pressed Show on the main window's card — the one path that may focus the window.
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return { ok: false, reason: 'refused: not the main window' };
    const parsed = parseOfferRequest(raw);
    if (!parsed.ok) return { ok: false, reason: `refused: ${parsed.why}` };
    if (shareReceiver.state(parsed.offerId) === undefined) return { ok: false, reason: 'no such offer' };
    receiveWindow.openFromUser(parsed.offerId);
    return { ok: true };
  });
  /*
   * The receive window's four actions. Each takes `{offerId}` and nothing else, only from the receive
   * window. Open and Reveal act on `publishedFile`, which re-proves the saved file is still the very
   * file this Mac published — no path ever crosses IPC. Try again starts a pull, so it is gated like
   * Accept: a visible, focused window.
   */
  const fromReceiveWindow = (event: Electron.IpcMainInvokeEvent, raw: unknown): { ok: true; offerId: string } | { ok: false; reason: string } => {
    if (event.sender !== receiveWindow.webContents()) return { ok: false, reason: 'refused: not the receive window' };
    const parsed = parseOfferRequest(raw);
    return parsed.ok ? parsed : { ok: false, reason: `refused: ${parsed.why}` };
  };
  ipcMain.handle('share-cancel', async (event, raw: unknown) => {
    const r = fromReceiveWindow(event, raw);
    if (!r.ok) return r;
    return (await shareReceiver.cancel(r.offerId)) ? { ok: true } : { ok: false, reason: 'There is nothing running to cancel.' };
  });
  ipcMain.handle('share-retry', async (event, raw: unknown) => {
    const r = fromReceiveWindow(event, raw);
    if (!r.ok) return r;
    const gate = acceptAllowed(receiveWindow.facts());
    if (!gate.ok) return { ok: false, reason: `not retried: ${gate.why}` };
    const snap = shareReceiver.snapshots().find((s) => s.offerId === r.offerId);
    if (!snap?.canRetry) return { ok: false, reason: 'It can no longer be tried again.' };
    void shareReceiver.retry(r.offerId);
    return { ok: true };
  });
  ipcMain.handle('share-open', async (event, raw: unknown) => {
    const r = fromReceiveWindow(event, raw);
    if (!r.ok) return r;
    const file = await shareReceiver.publishedFile(r.offerId);
    if (!file.ok) {
      log.warn('share', `Open refused for ${r.offerId}: ${file.why}`);
      return { ok: false, reason: `Not opened: ${file.why}.` };
    }
    const error = await shell.openPath(file.path);
    log.info('share', `Open ${r.offerId} → ${error === '' ? 'opened' : `failed: ${error}`}`);
    return error === '' ? { ok: true } : { ok: false, reason: `macOS could not open it: ${error}` };
  });
  ipcMain.handle('share-reveal', async (event, raw: unknown) => {
    const r = fromReceiveWindow(event, raw);
    if (!r.ok) return r;
    const file = await shareReceiver.publishedFile(r.offerId);
    if (!file.ok) {
      log.warn('share', `Show in Finder refused for ${r.offerId}: ${file.why}`);
      return { ok: false, reason: `Not shown: ${file.why}.` };
    }
    shell.showItemInFolder(file.path);
    log.info('share', `Show in Finder ${r.offerId}`);
    return { ok: true };
  });
  ipcMain.on('share-window-close', (event) => {
    if (event.sender === receiveWindow.webContents()) receiveWindow.close();
  });
  ipcMain.on('share-window-height', (event, height: unknown) => {
    if (event.sender === receiveWindow.webContents()) receiveWindow.setContentHeight(height);
  });

  // Startup sweep of share temporary files: ONLY what the private ledger recorded this app creating,
  // only inside the scratch folder, and only where every identity check passes. Outside a version-2
  // development run its scope is empty and it deletes nothing. It lists no folder, so it can never
  // find — or delete — anything by its name; what it cannot prove, it leaves and reports.
  // A production (`share.ask`) run creates partials in the person's receive folder. Those are swept
  // only by the folder each entry *proves* it was made in (runbook §11, `byRecordedParent`) — never by
  // the receive-folder setting. The development gate never turns this on, and `share.ask` itself stays
  // closed until `receiveFolderCleanupScoped` is recorded after review.
  void sweepLedger(shareLedger, {
    allowedParents: shareV2.active ? [scratchFolderPath(userData)] : [],
    byRecordedParent: shareAsk.active,
  }).then((r) => {
    if (r.deleted > 0 || r.gone > 0 || r.left.length > 0) {
      log.info('share', `startup ledger sweep: deleted ${r.deleted}, ${r.gone} already gone, left ${r.left.length} untouched (${r.kept} kept for a later run)`);
    }
    for (const f of r.left) log.warn('share', `startup ledger sweep LEFT ${f.path}: ${f.why} — not proven ours, not deleted`);
  });

  /*
   * The detached mirror window.
   *
   * `onReady` is the answer to the one problem a second view has and the first does not: it opens
   * into a stream that is already running. Nothing will arrive marked `config` again on its own, so
   * the retained SPS/PPS are replayed to the new window and the phone is asked for an IDR. Without
   * both, the window shows a black rectangle for however long the encoder takes to keyframe on its
   * own — which on a still screen can be a very long time.
   */
  /*
   * **The start contract: the float asks, main answers.** Defect 105.
   *
   * This replaces a push on `onReady` — a webContents event that fires when the page is loaded, not
   * when the page has registered the handler that would catch what is pushed. Both orderings were
   * legal and the loser got nothing, forever, in silence. There is no window event in this path: the
   * float emits `stream-start` when its own listeners exist, which is a fact only it can know.
   *
   * `null` config is an **answer**. A link that has never carried a config frame has nothing to
   * replay, and saying so lets the float distinguish "nothing is mirroring" from "something is
   * mirroring and we have no parameter sets" — see `actionFor` in renderer/streamStart.ts.
   */
  /*
   * **The mark: a key a person can press when the mirror feels wrong.**
   *
   * Slices 46 and 47 measured this pipeline at idle, 60 fps and 120 fps and found it clean at every
   * rate — nothing dropped, ~25 ms capture-to-paint, three named suspects all failed. So the only
   * instrument left is the person watching, and a description after the fact carries no timestamp
   * and cannot be matched against anything.
   *
   * **A global shortcut, deliberately.** The mirror canvas forwards keystrokes to the phone as text
   * input; a shortcut registered with the OS is taken before the page sees it, so marking a bad
   * moment cannot type into whatever app is open on the phone. That is not a detail — a diagnostic
   * that types into somebody's messages while they use it would be worse than no diagnostic.
   */
  /*
   * **Moved off `CommandOrControl+Shift+M` on 2026-09-16 — defect 123.**
   *
   * That combination is what the handoff prints for *"Mirror phone"*, what the ⌘K palette's first
   * row prints, and what the Overview hero's primary action prints. It was registered here, as a
   * **global** shortcut, so it was taken before either of those could see it — the app's most
   * advertised accelerator wrote a log line and never started a mirror, on every build since the
   * mark landed. Nothing reported it, because a `globalShortcut` that registers successfully is
   * indistinguishable from one that does the right thing.
   *
   * `Control+Option+Command+M` is deliberately **unadvertised** and deliberately awkward: the mark
   * is a diagnostic pressed by somebody who has been told about it, and the one thing it must not
   * be is a key a person could hit while meaning something else. The global registration stays —
   * that part of the original argument is untouched and still right: the mirror canvas forwards
   * keystrokes to the phone, so a mark taken by the page would type into whatever app is open over
   * there. Mirroring itself is bound in `shell.ts`, in the page, for the opposite reason.
   */
  const MARK_ACCELERATOR = 'Control+Alt+Command+M';
  if (globalShortcut.register(MARK_ACCELERATOR, () => {
    const at = new Date().toISOString();
    log.warn('mark', `MARK at ${at} — asking the mirror window for the stages around it`);
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('mark-requested', at));
  })) {
    log.info('mark', `Press ${MARK_ACCELERATOR} when the mirror feels wrong; the stages around it go in this log`);
  } else {
    // Another app holds it. Said out loud rather than left as a key that silently does nothing.
    log.warn('mark', `Could not register ${MARK_ACCELERATOR} — another app holds it. Use scripts/mirror-mark.mjs instead`);
  }

  ipcMain.handle('mark-moment', (_event, summary: unknown) => {
    // One line, so a run of marks reads as a table in the log rather than as prose to reassemble.
    const s = summary as Record<string, unknown> | null;
    if (!s) return;
    log.warn(
      'mark',
      `MARKED ${s.label} — ${s.clean ? 'CLEAN' : 'NOT CLEAN'}: ${s.why}. ` +
        `samples=${s.samples} fps=${typeof s.fps === 'number' ? s.fps.toFixed(1) : 'n/a'} ` +
        `median=${s.medianTotalMs}ms worst=${s.worstTotalMs}ms longestGap=${s.longestGapMs}ms ` +
        `encode=${s.medianEncodeMs}ms wire=${s.medianWireMs}ms mac=${s.medianMacMs}ms` +
          (Number(s.unreliableSplits) > 0
            ? `  [split unreliable on ${s.unreliableSplits}/${s.samples} frames — read the total, not the halves]`
            : ''),
    );
  });

  /** What a renderer is allowed to know about the debug switches. Never on in a packaged build. */
  ipcMain.handle('debug-switches', () =>
    app.isPackaged ? { delayFloatListeners: false } : { delayFloatListeners: debugSwitches().delayFloatListeners },
  );

  // The shape is declared here and interpreted in renderer/streamStart.ts. Nothing type-checks
  // across IPC, so a shared type would imply a guarantee it cannot give; both sides name the other.
  ipcMain.handle('stream-start', (event): {
    config: { ptsUs: number; bytes: number } | null;
    sessionRunning: boolean;
    capture: typeof lastCaptureGeometry;
  } => {
    const config = video?.configFrame() ?? null;
    const answer = {
      config: config ? { ptsUs: config.ptsUs, bytes: config.data.length } : null,
      /*
       * Defect 116. The shape of the phone's screen, answered at the same door the parameter sets
       * come through, because a second view needs both for the same reason: the session started
       * before the window existed and neither will be announced again.
       *
       * `null` is an answer here too — nothing is mirroring, so there is no shape — and it is
       * distinguishable from `sessionRunning: true` with a null capture, which would be a phone
       * mirroring without having said what it is mirroring.
       */
      capture: lastCaptureGeometry,
      // `isOpen()` — the video socket, which is what a running session actually is. NOT derived
      // from `config !== null`: that would make `sessionRunning` a restatement of the field beside
      // it, and `actionFor`'s `ask-again` branch structurally unreachable — a state drawn beside
      // states that can happen, which is the thing the Folders screen exists as a lesson about.
      sessionRunning: Boolean(video?.isOpen()),
    };
    log.info(
      'float',
      `stream-start asked: ${answer.config ? `replaying ${answer.config.bytes}B of parameter sets` : 'no retained config'}` +
        `, sessionRunning=${answer.sessionRunning}` +
        `, capture=${answer.capture ? `${answer.capture.width}x${answer.capture.height} #${answer.capture.geometryId}` : 'not announced yet'}`,
    );
    if (config) {
      // Sent to **the asker**, not broadcast: `event.sender` is by construction the window that just
      // said its listeners are up, which is the whole content of the contract. Nothing here needs to
      // know which window that is, and nothing can deliver it to a window that is not ready.
      event.sender.send('video-frame', {
        keyframe: config.keyframe,
        config: config.config,
        ptsUs: config.ptsUs,
        data: new Uint8Array(config.data),
        arrivedAt: config.arrivedAt,
      });
    }
    return answer;
  });

  /*
   * **One traced path for `mirror.keyframe`, used by all three callers.**
   *
   * There were three, and all three ended in `.catch(() => undefined)`: the IPC handler, the
   * float's onReady, and the float renderer. Nothing counted a request, nothing saw an ack, and
   * nothing anywhere connected a request to the IDR that answered it — which is why **no evidence
   * exists in this repo that a single `mirror.keyframe` has ever produced one**.
   */
  const requestKeyframe = async (reason: string): Promise<void> => {
    if (!link?.isConnected()) {
      log.warn('mirror', `keyframe requested (${reason}) with no link — not sent; ${keyframeTrace.tally()}`);
      return;
    }
    log.info('mirror', keyframeTrace.onRequest(reason));
    try {
      await link.request('mirror.keyframe', {}, 5_000);
      log.info('mirror', keyframeTrace.onAck());
    } catch (error) {
      // The reason reaches the log with its text intact. A swallowed failure here is
      // indistinguishable from a request that was answered and produced nothing, and those two
      // need different fixes.
      log.warn('mirror', keyframeTrace.onRequestFailed(String(error)));
    }
  };
  keyframeRequester = requestKeyframe;

  float = new FloatMirrorWindow(
    join(__dirname, '..', 'preload.js'),
    join(__dirname, '..', 'renderer', 'float.html'),
    (state) => sendAll('float-changed', state),
    (target) => {
      /*
       * **The config is no longer pushed from here.** It used to be, and that was defect 105: this
       * callback fires on `did-finish-load`, which says nothing about whether the page's
       * `onVideoFrame` handler exists yet. The float now asks (`stream-start`) once its listeners
       * are up, and this callback's only remaining job is the status replay below — a message the
       * float re-requests nothing for because a missed one costs a device name, not a picture.
       */
      void target;
      // The window missed every `status` sent before it existed, so it starts with no device name
      // and no idea whether input is advertised. Replay the last one rather than leaving it blank.
      if (lastStatus) target.webContents.send('status', lastStatus);
    },
  );

  // Access units go straight to the renderer, which owns the WebCodecs decoder and the canvas.
  // Buffer -> Uint8Array because a Node Buffer does not survive structured cloning as one.
  video.on('frame', (frame: VideoFrame) => {
    /*
     * The half that makes "answered" mean anything. Without this the tally reads
     * `N requested / N acked / 0 answered by an IDR` forever — a counter that cannot move, which is
     * worse than no counter because it reads as a finding.
     *
     * `onKeyframe` returns null unless a request was outstanding: the periodic IDRs of an idle
     * stream are not evidence that a request worked. The first run of this instrumentation showed
     * exactly why that matters — a keyframe reached the float's decoder **8 ms after the request and
     * one millisecond BEFORE the ack**, so it was already in flight and the request had nothing to
     * do with it.
     */
    if (frame.keyframe && !frame.config) {
      const line = keyframeTrace.onKeyframe();
      if (line) log.info('mirror', line);
    }
    sendAll('video-frame', {
      keyframe: frame.keyframe,
      config: frame.config,
      ptsUs: frame.ptsUs,
      data: new Uint8Array(frame.data),
      arrivedAt: frame.arrivedAt,
    });
  });
  video.on('closed', (reason: string) => sendAll('mirror-stopped', { reason }));
  /**
   * F7 — the phone refused the pair token.
   *
   * Three things happen, and the order is the point: the rejection is turned into *this Mac's* copy
   * keyed on the reason, a fresh code is armed so the user's next action works, and only then is the
   * screen told. Telling the screen first would put "here is a fresh one" in front of a QR that is
   * still the refused one.
   *
   * Nothing here stops the retry loop. docs/protocol.md is explicit that the user's next action is
   * to scan the new code and discovery has to be running when they do.
   */
  link.on('pair-rejected', (rejection: PairRejected) => {
    const copy = pairRejectionCopy(rejection, selfFingerprint);
    if (!copy) {
      // Another Mac's rejection, observed. Logged with the reason it was ignored, because a
      // rejection that produces no screen change and no line is indistinguishable from one that
      // was dropped.
      log.info(
        'pairing',
        `Ignored a pair.rejected meant for ${rejection.fingerprint?.slice(0, 23)}… — not this Mac`,
      );
      return;
    }
    activity.record('system', 'Pairing refused', copy.headline);
    let qr: string | null = null;
    if (copy.refreshCode && link) {
      try {
        const payload = link.armPairing(localAddress(), true);
        qr = JSON.stringify(payload);
        log.info('pairing', `Fresh QR armed after ${rejection.reason}`);
      } catch (error) {
        // The screen still gets the explanation; it simply keeps the code it has. Saying nothing
        // because the refresh failed would leave the user staring at a refused code with no reason.
        log.warn('pairing', `Could not arm a fresh QR after ${rejection.reason}: ${String(error)}`);
      }
    }
    send('pair-rejected', { ...copy, reason: rejection.reason, qr });
  });

  link.on('status', (status: ConnectionStatus) => {
    // R1 (system). Phase transitions only: `status` fires on every retry tick, and a row per tick
    // would bury every other category under a reconnect loop — the thing the pane exists to make
    // visible would become the thing hiding it.
    if (status.phase !== lastRecordedPhase) {
      const before = lastRecordedPhase;
      lastRecordedPhase = status.phase;
      if (status.phase === 'connected') {
        shareSessionKey = link?.token() ?? null;
        activity.record('system', 'Connected', status.deviceName ?? status.address ?? 'phone');
        // The phone completed a handshake on the Sidekick identity, so the rename is paid for.
        if (rePairPending) {
          rePairPending = false;
          try {
            if (clearRePairPending(app.getPath('userData'))) {
              log.info('migration', 'Rename re-pair: cleared — the phone accepted the Sidekick identity');
            }
          } catch (error) {
            log.warn('migration', `Rename re-pair cleared in memory but not on disk :: ${String(error)}`);
          }
          sendAll('rename-notice', { notice: null });
        }
      } else if (before === 'connected') {
        // An offer does not survive its session (docs/protocol.md → Share → What is left behind).
        shareReceiver.onSessionEnded(shareSessionKey);
        shareSessionKey = null;
        activity.record(
          'system',
          'Disconnected',
          userStoppedLink
            ? 'You disconnected the phone from this Mac'
            : (status.lastError ?? `now ${status.phase}`),
        );
        userStoppedLink = false;
      }
    }
    // The replay cutoff is armed on the transition INTO connected, never on every status tick —
    // re-arming it mid-session would make the rest of the session's notifications look replayed.
    if (status.phase === 'connected' && !notifierWasConnected) {
      nativeNotifier.onSessionReady();
    } else if (status.phase !== 'connected' && notifierWasConnected) {
      nativeNotifier.onSessionEnded();
      // O4. These are facts about the phone that WAS connected; keeping them would draw the last
      // phone's battery over the next one's card.
      lastBatteryState = null;
      lastStorageState = null;
      send('device-vitals', { battery: null, storage: null });
    }
    notifierWasConnected = status.phase === 'connected';
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
      // The badge counts rows the pane holds; a badge outliving them counts nothing real.
      nativeNotifier.onCleared();
      contacts.clear();
      clip.clear();
      photos.clear();
      // Originals fetched for viewing are private photos on disk; they go when the phone does.
      clearPreviews('link dropped');
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
    // The pair-intent watch holds a socket and is only worth anything while a code is on screen.
    // Pairing resolving is the end of that window — the phone stops publishing the attribute too,
    // but a Mac that waited to notice would keep a browser open on every paired session.
    if (status.paired && nowConnected) stopPairIntentWatch();
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
    // Feature A, slice 2. Handled first and by type only: the receiver validates the payload itself.
    if (message?.type === MessageType.SHARE_OFFER) void shareReceiver.onOffer(message.payload);
    if (message?.type === MessageType.SHARE_CANCEL) shareReceiver.onCancel(message.payload);
    // Phase 4 events. The phone pushes these; nothing here ever requests them, which is why they
    // are handled beside the mirror's events rather than inside a client that owns a request.
    if (message?.type === MessageType.NOTIF_POSTED && message.payload) {
      // The held copy has to be read BEFORE onPosted replaces it, or every notification looks new.
      const key = (message.payload as { key?: unknown }).key;
      const previous = typeof key === 'string' ? notifications.get(key) : null;
      notifications.onPosted(message.payload);
      const decision = nativeNotifier.consider(
        message.payload as unknown as PhoneNotification,
        previous,
      );
      log.info('native-notif', `${(message.payload as { package?: string }).package} → ${decision}`);
    }
    if (message?.type === MessageType.NOTIF_REMOVED && message.payload) {
      const key = (message.payload as { key?: unknown }).key;
      notifications.onRemoved(message.payload);
      if (typeof key === 'string') nativeNotifier.onRemoved(key);
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
    // O4's Device status card. Held rather than forwarded blind: the renderer may not be listening
    // yet when the phone replays these on session-ready, and a value that arrived before anyone was
    // watching would otherwise be lost until the next battery tick — which for storage is a minute
    // and for a stationary battery can be an hour.
    if (message?.type === MessageType.BATTERY_STATE && message.payload) {
      lastBatteryState = message.payload as Record<string, unknown>;
      send('device-vitals', { battery: lastBatteryState, storage: lastStorageState });
    }
    if (message?.type === MessageType.STORAGE_STATE && message.payload) {
      lastStorageState = message.payload as Record<string, unknown>;
      send('device-vitals', { battery: lastBatteryState, storage: lastStorageState });
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
      /*
       * **`sendAll`, not `send`.** This was main-window-only, so the float never learned the phone
       * had turned — and a float that takes pointer input would then send the **pre-rotation**
       * `geometryId` with every tap and would not cancel a drag that was in flight across the turn.
       * Those are defects 20 and 19 exactly, reintroduced in the second window, and they are the
       * reason this line goes in before any pointer handler does rather than beside it.
       */
      rememberCaptureGeometry(rotate);
      sendAll('mirror-rotate', message.payload);
    }
    send('message', envelope);
  });

  // One subscription, not one per window: the client is the source of truth. **`send` does not fan
  // out** — it is main-window-only, and `sendAll` is the one that reaches the float. This comment
  // said the opposite, which is how `mirror-rotate` stayed on `send` while reading as correct.
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
  // The window is created at the top of this callback now, ahead of `loadIdentity` — see D15 there.

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

  /**
   * Clicking the Dock icon. Defect 117.
   *
   * This was `if (getAllWindows().length === 0) createWindow()`, which is the Electron sample and is
   * wrong the moment the app has a second window: with the float open the count is 1, so the branch
   * never ran and **a Dock click did nothing at all**. The main window was not hidden or destroyed —
   * it was simply behind whatever the user had been doing, with no route forward from anywhere in the
   * product except closing floating mode, which is exactly what was reported.
   *
   * The count is the wrong question. What a Dock click means is *bring this app's main window to me*,
   * and that is one call whether the window exists, is hidden, or is minimised.
   */
  app.on('activate', () => revealMainWindow('dock icon'));
});

// Closing the window keeps the tray alive: notifications and clipboard sync are the reason the
// app exists, and both need the link up.
app.on('window-all-closed', () => {
  /* stay running */
});

app.on('will-quit', () => clearPreviews('app quit'));
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

/**
 * A renderer's log line, written into the Mac's own file beside everything else.
 *
 * The float window is the reason this exists: it could fail through an entire demo with nothing
 * durable to read afterwards.
 */
ipcMain.on('renderer-log', (_event, where: unknown, line: unknown) => {
  if (typeof where !== 'string' || typeof line !== 'string') return;
  // The tag is bounded rather than passed through, so a renderer cannot invent log namespaces.
  const tag = where === 'float' || where === 'mirror' ? where : 'renderer';
  log.info(tag, line.slice(0, 500));
});

/**
 * `mirror.keyframe`, counted at all three points.
 *
 * It used to be one line ending in `.catch(() => undefined)` — the `getOrNull` shape `CLAUDE.md`
 * forbids on a platform call, here applied to the *only* request whose whole purpose is to produce
 * a frame. Nothing counted the request, nothing saw the ack, and **no evidence exists in this repo
 * that a single `mirror.keyframe` has ever produced an IDR.** That silence is why the float could
 * fail unnoticed.
 *
 * The IDR half is counted where the frames are — `onKeyframe` is called from the video path — so
 * this records the request and the ack, and the answer arrives from the other side.
 */
const keyframeTrace = new KeyframeTrace();

/**
 * Set once the link and video are wired. Null before that, and a request arriving early is dropped
 * with a line rather than silently — an unset handler that swallows is the silence this whole change
 * is about.
 */
let keyframeRequester: ((reason: string) => Promise<void>) | null = null;

ipcMain.handle('mirror-keyframe', async (_event, reason?: unknown) => {
  await keyframeRequester?.(typeof reason === 'string' ? reason : 'renderer, unspecified');
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
  const path = join(app.getPath('desktop'), `Sidekick ${stamp}.png`);
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

/**
 * The float window asking for the main window. Defect 117.
 *
 * It returns whether the float is still open, and the float shows that in a toast, because the one
 * thing a user pressing this needs to know is that it did **not** cost them the floating window. The
 * value is read after the reveal rather than assumed, so a future change that did close the float
 * would be reported rather than denied.
 */
ipcMain.handle('main-window-show', () => {
  revealMainWindow('float rail');
  return { floatStillOpen: float?.state().open ?? false };
});

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
ipcMain.on('route-changed', (_event, screen: unknown) => {
  if (typeof screen === 'string') nativeNotifier.setCurrentScreen(screen);
});

ipcMain.handle('notif-permission', () => nativeNotifier.permissionState());
ipcMain.handle('notif-sound-get', () => store.get('notificationSound'));
ipcMain.handle('notif-sound-set', (_event, on: unknown) => {
  const value = on === true;
  store.set('notificationSound', value);
  log.info('native-notif', `Notification sound ${value ? 'on' : 'off'}`);
  return value;
});

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
/**
 * Settings → General: **Start on login**.
 *
 * Both handlers read the answer back out of macOS rather than reporting what was asked for.
 * `setLoginItemSettings` cannot fail loudly — it returns `void` — and there are real conditions in
 * which it does not take: a translocated bundle, a login item the user has disabled in System
 * Settings → General → Login Items, a sandboxed build. A toggle that draws its own intention is a
 * check that does not gate, so this one flips back if the system disagrees and the pane says so.
 *
 * `openAtLogin` is the only field read. `wasOpenedAtLogin` and friends describe *this* launch and
 * would be a different question.
 */
ipcMain.handle('login-item-get', () => ({
  ok: true,
  data: { openAtLogin: app.getLoginItemSettings().openAtLogin },
}));
ipcMain.handle('login-item-set', (_event, on: boolean) => {
  app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== on) {
    log.warn('app', `Start on login was set to ${on} and macOS reports ${actual}`);
  } else {
    log.info('app', `Start on login: ${actual}`);
  }
  return { ok: true, data: { openAtLogin: actual, honoured: actual === on } };
});

/** Settings → File transfer: the real destination, from the one place that owns it. */
ipcMain.handle('downloads-folder', () => ({
  ok: true,
  data: {
    path: downloadsFolder(),
    chosen: chosenDownloadsFolder() !== null,
    defaultPath: defaultDownloadsFolder(),
    legacyPath: legacyDownloadsFolder(homedir()),
  },
}));

/**
 * Settings → File transfer → **Choose…**, departure T1 made real.
 *
 * The folder is checked for writability **before** it is stored, so the setting can never hold a
 * destination the next pull would refuse. A cancelled picker changes nothing and says so.
 */
ipcMain.handle('downloads-choose', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose where files from your phone are saved',
    buttonLabel: 'Use this folder',
    defaultPath: downloadsFolder(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  const chosen = picked.filePaths[0]!;
  const problem = await checkWritableFolder(chosen);
  if (problem) {
    log.warn('files', `receive folder not changed: ${problem}`);
    return { ok: false, reason: problem };
  }
  store.set('receiveFolder', chosen);
  log.info('files', `receive folder set to ${chosen}`);
  return { ok: true, data: { path: chosen } };
});

/** Back to `~/Downloads/Sidekick`. Nothing already saved is moved. */
ipcMain.handle('downloads-use-default', () => {
  store.set('receiveFolder', null);
  log.info('files', `receive folder reset to the default ${defaultDownloadsFolder()}`);
  return { ok: true, data: { path: defaultDownloadsFolder() } };
});
/**
 * Reveal that folder in Finder, creating it first.
 *
 * `showItemInFolder` on a path that does not exist is a **silent no-op** on macOS — no error, no
 * window, nothing to report — and this folder does not exist until the first transfer. A button
 * that does nothing on a fresh install, with no way to tell that from a broken button, is the
 * silent-no-op shape this project rules out everywhere else.
 */
ipcMain.handle('downloads-reveal', async () => {
  // The default is created on demand; a chosen folder that has gone is refused with its name,
  // never recreated — see `ensureReceiveFolder`.
  const ready = await ensureReceiveFolder();
  if (!ready.ok) return { ok: false, reason: ready.reason };
  shell.showItemInFolder(ready.folder);
  return { ok: true, data: { path: ready.folder } };
});

/**
 * Reveal `~/Downloads/ConnectSuite` — the folder ConnectSuite saved into before the rename.
 *
 * Read-only by construction, and deliberately **not** `downloads-reveal`: that one creates its
 * folder first, and this one must never create, move or touch anything. A folder that has gone
 * since the pane was drawn is refused with a sentence rather than recreated.
 */
/** The pairing screen's rename notice: the approved sentence while the re-pair is owed, else null. */
ipcMain.handle('rename-notice', () => ({ ok: true, data: { notice: pairingRenameNotice(rePairPending) } }));

ipcMain.handle('downloads-reveal-legacy', () => {
  const folder = legacyDownloadsFolder(homedir());
  if (!folder) return { ok: false, reason: 'The ConnectSuite downloads folder is no longer there.' };
  shell.showItemInFolder(folder);
  return { ok: true, data: { path: folder } };
});

ipcMain.handle('clip-clear', () => {
  const had = clip.clearHistory();
  activity.record('clipboard', 'History cleared', `${had} entr${had === 1 ? 'y' : 'ies'} removed from this Mac`);
  return { ok: true, data: { cleared: had } };
});
/**
 * Open a clipboard entry that is a link.
 *
 * **The scheme is re-decided here and not trusted from the renderer.** The string originated on a
 * phone, `openExternal` opens whatever a scheme is registered to on this Mac — `file://` opens
 * Finder, `x-apple.systempreferences://` opens a Settings pane, and every installed app may claim
 * its own — and the renderer is where a future change would most easily widen it by accident. Same
 * rule as everywhere else in this repo: the check runs where the action is, and it is the same
 * function the pane used to decide whether to draw the button, so the two cannot disagree.
 */
ipcMain.handle('clip-open', async (_event, text: string) => {
  const url = openableUrl(text);
  if (!url) {
    return {
      ok: false,
      reason: 'That entry is not a web link, so there is nothing to open.',
      fixHint: 'Only http and https links can be opened from here.',
    };
  }
  await shell.openExternal(url);
  activity.record('clipboard', 'Opened a link', new URL(url).host);
  return { ok: true, data: null };
});
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
/**
 * S6: the status island narrates real clipboard and transfer events.
 *
 * Wired to the store rather than to each feature, because `activity.record` is already the one
 * place every one of those events passes through — eleven named sites — and a second set of
 * announce-calls sprinkled through `files.ts` and `clipboard.ts` is the second expression of the
 * rule that stops matching. Which categories reach the island is decided in `shared/islandRota.ts`,
 * where a test can reach it.
 */
activity.onRecorded = (event) => sendAll('activity-recorded', event);

ipcMain.handle('activity-events', () => ({
  ok: true,
  data: { events: activity.all(), error: activity.error(), stats: activity.stats() },
}));
ipcMain.handle('activity-csv', async () => {
  const target = await dialog.showSaveDialog({
    title: 'Export activity log',
    defaultPath: join(app.getPath('downloads'), `Sidekick activity ${new Date().toISOString().slice(0, 10)}.csv`),
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
/**
 * **Send to phone…** — the multi-file picker. Files only; a folder is a loop of pushes nobody asked
 * for, and `fs.transfer` moves one file. Sizes are read here so the confirmation can state a total.
 */
ipcMain.handle('fs-pick-send', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Choose files to send to your phone',
    buttonLabel: 'Choose',
    properties: ['openFile', 'multiSelections'],
  });
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  const chosen: Array<{ source: string; name: string; size: number }> = [];
  for (const source of picked.filePaths) {
    try {
      const info = await fsp.stat(source);
      if (info.isFile()) chosen.push({ source, name: basename(source), size: info.size });
    } catch {
      // Unreadable between the picker and here: left out, and the count the user sees says so.
    }
  }
  return { ok: true, data: { files: chosen, skipped: picked.filePaths.length - chosen.length } };
});

/**
 * One file of a send batch, **collision-safe**.
 *
 * The phone refuses a push over an existing name with `TARGET_STALE` and never overwrites. That
 * refusal used to end the send. Here it is answered the way a pull into a Mac folder is: the same
 * file, offered again as `name (2).ext`, `name (3).ext` — so nothing is replaced and the original
 * name is kept whenever it is free. The `name` field is already in `fs.transfer.begin push`; no
 * protocol change.
 *
 * The `transferId` is announced as soon as the phone acks (`fs-push-agreed`), so the renderer can
 * match the phone's own `fs.transfer.progress` and `fs.transfer.done` to this file.
 */
const SEND_COLLISION_LIMIT = 50;
ipcMain.handle(
  'fs-send',
  async (_event, options: { rootId: string; path: string; source: string }) => {
    const original = basename(options.source ?? '');
    let last: Awaited<ReturnType<typeof files.push>> | null = null;
    for (let n = 1; n <= SEND_COLLISION_LIMIT; n += 1) {
      const name = sharedSendBatch.suffixedName(original, n);
      last = await files.push({
        rootId: options.rootId,
        path: options.path,
        source: options.source,
        name,
        onAgreed: (transferId, agreedName) =>
          sendAll('fs-push-agreed', { source: options.source, transferId, name: agreedName }),
      });
      if (last.ok || last.code !== ErrorCode.TARGET_STALE) {
        if (last.ok) {
          activity.record(
            'files',
            'Sent to phone',
            `${name}${n > 1 ? ` (renamed from ${original})` : ''} → ${options.rootId}`,
          );
        } else {
          activity.record('files', 'Send failed', `${original}: ${describeFailure(last)}`);
        }
        return { ...last, sentAs: name };
      }
      log.info('files', `${name} already exists on the phone; offering it as the next free name`);
    }
    activity.record('files', 'Send failed', `${original}: ${SEND_COLLISION_LIMIT} names taken`);
    return {
      ok: false,
      reason: `${original} was not sent — ${SEND_COLLISION_LIMIT} files with that name are already there.`,
      code: last?.code,
    };
  },
);

/** Stop a send in flight. The phone keeps the partial as `.part`, resumable by sending it again. */
ipcMain.handle('fs-cancel', async (_event, options: { transferId: string }) => {
  const result = await ask(
    link,
    'files',
    MessageType.FS_TRANSFER_CANCEL,
    { transferId: options.transferId, reason: 'user' },
    (payload) => ({ stopped: payload.stopped === true }),
  );
  log.info('files', `fs.transfer.cancel ${options.transferId} → ${result.ok ? 'acked' : result.reason}`);
  return result;
});

// R6 and R7 (files). Recorded here rather than inside `FilesClient` so every recording site is in
// one file — see the note on `ActivityStore`. Both outcomes are written: a transfer that failed is
// exactly the row somebody comes to the Activity screen looking for.
ipcMain.handle(
  'fs-pull',
  async (_event, options: { rootId: string; id: string; name: string; size: number }) => {
    const result = await files.pull(options);
    if (result?.ok) {
      activity.record('files', 'Saved to Mac', `${options.name} (${sharedVitals.humanBytes(options.size)})`);
    }
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

/**
 * Feature C: the detail preview's two sources, neither of which is a save.
 *
 * `media-preview-thumb` is the protocol's largest thumbnail (512 px), in its own cache so a grid
 * tile's 256 is never returned for it. `media-preview-original` fetches the real bytes into the
 * private preview cache (`main/mediaPreview.ts`) and answers with a `sidekick-media://` URL carrying
 * an opaque token. The `transferId` is announced at the ack so the pane can draw the phone's own
 * `fs.transfer.progress` while a video is on its way.
 */
ipcMain.handle('media-preview-thumb', (_event, options: { id: string }) => photos.previewThumb(options.id));
ipcMain.handle('media-preview-original', async (_event, options: { id: string }) => {
  const hit = cachedPreview(options.id);
  if (hit) return { ok: true, data: hit };
  const folder = await previewFolder();
  const result = await photos.original(options.id, folder, (ticket) =>
    sendAll('media-preview-agreed', { id: options.id, ...ticket }),
  );
  if (!result.ok) return result;
  const url = rememberPreview(options.id, {
    path: result.data.path,
    name: result.data.name,
    mime: result.data.mime,
    bytes: result.data.bytes,
  });
  log.info('photos', `original fetched for viewing: ${result.data.bytes} bytes in ${result.data.elapsedMs} ms`);
  return { ok: true, data: { url, name: result.data.name, bytes: result.data.bytes, mime: result.data.mime } };
});

/**
 * Reveal a file the person saved — and only one inside the receive folder. The renderer names a
 * path it was handed by a pull; refusing anything outside that folder keeps this from being a way
 * to open Finder on an arbitrary path.
 */
ipcMain.handle('reveal-saved', (_event, options: { path: string }) => {
  const folder = downloadsFolder();
  const target = String(options?.path ?? '');
  if (!target.startsWith(folder + '/') || target.includes('/../') || !existsSync(target)) {
    return { ok: false, reason: 'That file is not in the receive folder any more.' };
  }
  shell.showItemInFolder(target);
  return { ok: true, data: { path: target } };
});

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
    const destination = join(tmpdir(), `sidekick-resume-${Date.now()}-${name}`);

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
  /**
   * One `fs.stat` for an id the caller names — defect 137's instrument, **debug builds only**.
   *
   * `fs.stat` reads a single document through the same tree grant and the same `ContentResolver` as
   * a listing, but **not** through the children query. So stat succeeding where a listing returns 0
   * puts the loss in the children query, not in the grant or the document id. Read-only.
   */
  ipcMain.handle('debug-fs-stat', async (_event, options: { rootId: string; id: string }) => {
    if (!link?.isConnected()) return { ok: false, reason: 'not connected' };
    try {
      const reply = await link.request(MessageType.FS_STAT, { rootId: options.rootId, id: options.id }, 15_000);
      return { ok: true, payload: reply.payload ?? {} };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

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
    const destination = join(tmpdir(), `sidekick-fs-${Date.now()}-${options.name}`);

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
    const destination = join(tmpdir(), `sidekick-cancelled-${Date.now()}.bin`);
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
// O4. The renderer asks once when Overview opens, because a pane that routes in after the phone
// reported would otherwise sit at "waiting" until the next tick.
ipcMain.handle('device-vitals', () => ({ battery: lastBatteryState, storage: lastStorageState }));
ipcMain.handle(
  'remote-command',
  (_event, payload: { action: string; extra?: Record<string, unknown> }) =>
    remote.command(payload.action, payload.extra ?? {}),
);
// The cover, by the key the state carried. Cached in the main process rather than the renderer so
// it survives a route change and a window reload — the renderer redraws far more often than the
// track changes, and re-fetching an image on every repaint of the Overview pane is the shape this
// key/bytes split exists to avoid in the first place.
ipcMain.handle('remote-artwork', (_event, payload: { key: string; maxEdge?: number }) =>
  remote.artworkFor(payload.key, payload.maxEdge),
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

/**
 * How every pairing QR in this app is drawn.
 *
 * One home, because there are now two places that render one — arming a code and redrawing it after
 * a rejection. The first version of the second renderer used a different width and no correction
 * level, which is the two-expressions-of-one-rule shape the code rules warn about: they would have
 * drifted, and the visible symptom would have been a code that scans on one path and not the other.
 */
const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 1, width: 320 } as const;

/**
 * Renders a QR for a payload that is **already armed**.
 *
 * Distinct from `pairing-qr` on purpose: that one arms a token as it goes, so calling it to redraw
 * after a rejection would rotate the code a second time and invalidate the one the main process
 * just told the user to scan.
 */
ipcMain.handle('pairing-qr-render', async (_event, payload: unknown) => {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  return QRCode.toDataURL(payload, QR_OPTIONS);
});

/**
 * The mDNS watch for a phone that has scanned this Mac's code — F6 / P3.
 *
 * Armed with the code and torn down when pairing resolves or the code is rotated, because it holds
 * a socket. It is deliberately **not** started at launch: the only time this question has an answer
 * worth anything is while a code is on screen.
 */
let pairIntentWatch: { stop: () => void } | null = null;
function stopPairIntentWatch(): void {
  pairIntentWatch?.stop();
  pairIntentWatch = null;
}

ipcMain.handle('pairing-qr', async (_event, rotate?: boolean) => {
  if (!link) throw new Error('Link not ready');
  const reachable = pairingReachable();
  const payload = armPairingCode(link, localAddress(), rotate === true);
  const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), QR_OPTIONS);
  // Both halves on one line, because a count of armed codes with no reachability beside it reads
  // as whichever story the reader already believes — and for a whole phase it read as the good one.
  log.info('pairing', `QR armed for ${payload.host} — scannable=${reachable}`);
  // A new code invalidates any sighting of the old one, so the watch is replaced rather than added
  // to: a phone that scanned the previous code is not a phone that has scanned this one.
  stopPairIntentWatch();
  if (selfFingerprint) {
    pairIntentWatch = watchForPairIntent(selfFingerprint, (deviceName) => {
      sendAll('pair-scanned', { deviceName: deviceName as string | null });
    });
  }
  return { payload, dataUrl, reachable };
});

ipcMain.handle('connect', () => link?.start());
ipcMain.handle('disconnect', () => {
  // Noted so the Activity row can say who ended the session. Without it a Disconnect the user
  // pressed is recorded with the link classifier's generic "The connection to your phone failed",
  // which is a failure sentence about something nobody failed at.
  userStoppedLink = true;
  link?.stop('user disconnected');
});
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
