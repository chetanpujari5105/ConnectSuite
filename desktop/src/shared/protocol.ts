/**
 * The v2 wire protocol as the desktop sees it. Twin of
 * core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt — change docs/protocol.md
 * first, then both files.
 */

import type { PairingHealth } from './linkHealth';

export const PROTOCOL_MAJOR = 1;

export const PORT_CONTROL = 42501;
export const PORT_VIDEO = 42502;
export const PORT_BULK = 42503;

export const MAX_CONTROL_FRAME = 16 * 1024 * 1024;
export const MAX_FRAME = 8 * 1024 * 1024;

/**
 * The bulk channel's cap, and it is deliberately *smaller* than MAX_FRAME.
 *
 * The bulk channel moves chunks, and the largest legitimate chunk is 256 KB. A frame bigger than a
 * chunk is not a bigger transfer, it is a peer that has lost sync or is lying. MAX_FRAME's 8 MB is
 * sized for a video keyframe; inheriting it here would let a peer make us allocate 8 MB per frame
 * to move 256 KB of payload.
 *
 * Twin of Link.MAX_BULK_FRAME on the phone.
 */
export const MAX_BULK_FRAME = 1 * 1024 * 1024;

/**
 * The bulk channel's JSON header frame, capped separately and far lower — the same pattern as the
 * 128-byte session-token frame. Reading the header under MAX_BULK_FRAME would let a malformed
 * first frame claim the whole chunk budget on a connection that has proved nothing beyond its
 * token. Twin of Link.MAX_BULK_HEADER_FRAME.
 */
export const MAX_BULK_HEADER_FRAME = 64 * 1024;

export const SERVICE_TYPE = 'connectsuite';

/**
 * Why the phone refused a pairing attempt — `docs/protocol.md` → `pair.rejected`.
 *
 * Reachable only once TLS has succeeded, which means the certificate was already pinned. A Mac that
 * is not paired at all fails in the handshake with no channel to be told anything on; the phone
 * shows that case on its own screen. Do not collapse the two into one message.
 */
export type PairRejectReason = 'TOKEN_EXPIRED' | 'TOKEN_MISMATCH' | 'TOKEN_MISSING';

export interface PairRejected {
  reason: PairRejectReason;
  /** This Mac's own fingerprint as the phone computed it, so a rejection can be told from noise. */
  fingerprint?: string;
  /** The phone's fallback sentence. Prefer copy keyed on `reason`; this is for the log. */
  message?: string;
}

/**
 * The TXT attribute a phone publishes between scanning a code and the pairing resolving — F6.
 *
 * The value is the first 16 lowercase hex characters of the scanned Mac's fingerprint with colons
 * removed. **A positive is trustworthy and a negative is not**: mDNS is the least reliable of the
 * three discovery paths, so absence must never be rendered as "nobody scanned".
 */
export const TXT_PAIR_INTENT = 'pair';

/** The form of a fingerprint used in {@link TXT_PAIR_INTENT}. */
export function pairIntentKey(fingerprint: string): string {
  return fingerprint.replace(/:/g, '').toLowerCase().slice(0, 16);
}

/**
 * Whether one mDNS service's TXT record says *"I have scanned **this** Mac's code"*.
 *
 * Pulled out of the browser callback so it can be tested without a network. The comparison is
 * against **our own** fingerprint, which is the whole of what makes a sighting a statement about
 * this Mac rather than about any phone pairing with anything on the same network — and the reason
 * that matters is that the failure it would produce is silent and flattering: a Mac that matched
 * any `pair` attribute would say *"a phone has scanned this code"* over somebody else's pairing.
 *
 * Case is normalised on both sides because a TXT value is bytes and neither end owns the other's
 * formatting. Anything absent, empty or not a string is not a match — never a throw, because this
 * runs inside a browser callback over records published by devices this app has never met.
 */
export function pairIntentMatches(
  txt: Record<string, unknown> | undefined | null,
  ourFingerprint: string,
): boolean {
  if (!txt || !ourFingerprint) return false;
  const published = txt[TXT_PAIR_INTENT];
  if (typeof published !== 'string' || published.length === 0) return false;
  return published.toLowerCase() === pairIntentKey(ourFingerprint);
}

/** Heartbeat: a ping every 5s, three unanswered pings and the link is considered dead. */
export const PING_INTERVAL_MS = 5_000;
export const MISSED_PONGS_BEFORE_DEAD = 3;

/**
 * One album on the phone — a `MediaStore` bucket, with the count that makes its pager checkable.
 *
 * `count` is not decoration. It is the denominator a page-by-page fetch has to sum to, and it is
 * the only number that can tell a working pager from one that stalls after its first page.
 */
export interface MediaBucket {
  bucketId: string;
  bucketName: string;
  count: number;
  newestMs: number;
  coverId: string;
  /** Present only when the bucket's path holds an app's package id. Never sent without appName. */
  packageName?: string;
  appName?: string;
}

/** One photo or video. `id` is a string because a MediaStore id outruns a JS safe integer. */
export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  dateMs: number;
  durationMs: number | null;
  ownerPackage?: string;
  ownerAppName?: string;
}

/** What `media.original` hands back: a transfer to claim on the bulk channel. */
export interface MediaOriginalTicket {
  transferId: string;
  size: number;
  mime: string;
  name: string;
  /** Always null today — the phone digests while streaming rather than reading the file twice. */
  sha256: string | null;
  chunkMax: number;
}

/** One thumbnail, or one per-item failure. A deleted photo must not lose the other 31. */
export interface MediaThumb {
  id: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Base64 JPEG, no data: prefix. Absent when `error` is set. */
  data?: string;
  error?: string;
}

/**
 * One app in the launcher grid.
 *
 * `label` is never absent. Where the phone could not resolve one it sends the package id as the
 * label **and** sets `labelIsFallback`, so this side draws a handle as a handle rather than
 * inventing a second fallback that could disagree with the phone's.
 */
export interface AppEntry {
  package: string;
  label: string;
  updatedMs: number;
  versionName?: string;
  labelIsFallback?: boolean;
}

/** One launcher icon, or one per-package failure. A missing icon must not lose the other 31. */
export interface AppIcon {
  package: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Base64 PNG, no data: prefix. PNG because launcher icons have transparency. */
  data?: string;
  error?: string;
}

export const MessageType = {
  HELLO: 'hello',
  HELLO_ACK: 'hello.ack',
  /**
   * Sent by the phone immediately before it closes a connection whose `hello` carried a pairing
   * token it would not accept. Without it this Mac — sitting with a QR on screen that the user is
   * looking at — learns only that a socket closed, which is what a dropped network looks like too.
   */
  PAIR_REJECTED: 'pair.rejected',
  ACK: 'ack',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  CAPABILITIES_CHANGED: 'capabilities.changed',

  MIRROR_START: 'mirror.start',
  MIRROR_STOP: 'mirror.stop',
  MIRROR_CONFIG: 'mirror.config',
  MIRROR_KEYFRAME: 'mirror.keyframe',
  MIRROR_STATS: 'mirror.stats',
  MIRROR_STATE: 'mirror.state',
  /** Phone -> Mac only. The phone turned; the new geometry follows on the video channel. */
  MIRROR_ROTATE: 'mirror.rotate',

  INPUT_TAP: 'input.tap',
  INPUT_SWIPE: 'input.swipe',
  INPUT_SCROLL: 'input.scroll',
  INPUT_KEY: 'input.key',
  INPUT_TEXT: 'input.text',
  INPUT_GLOBAL: 'input.global',

  NOTIF_POSTED: 'notif.posted',
  NOTIF_REMOVED: 'notif.removed',
  NOTIF_REPLY: 'notif.reply',
  NOTIF_ACTION: 'notif.action',
  NOTIF_DISMISS: 'notif.dismiss',

  SMS_THREADS: 'sms.threads',
  SMS_MESSAGES: 'sms.messages',
  SMS_SEND: 'sms.send',
  SMS_RECEIVED: 'sms.received',
  /**
   * An outgoing message entered the provider — sent from this Mac, from another client, or
   * typed on the handset. Payload is identical to `sms.received` with `inbound: false`.
   * Defects 39 and 44.
   */
  SMS_SENT: 'sms.sent',

  CALL_INCOMING: 'call.incoming',
  CALL_ENDED: 'call.ended',
  CALL_LOG: 'call.log',
  CALL_DIAL: 'call.dial',
  CALL_ANSWER: 'call.answer',
  CALL_REJECT: 'call.reject',

  CONTACTS_LIST: 'contacts.list',
  CONTACTS_GET: 'contacts.get',

  /**
   * Phase 5 slice 2. Three of the photo browser's four verbs; `media.original` is slice 3 and
   * needs the bulk channel, which is why the `photos` capability is not advertised even though
   * these three answer. See renderer/photos.ts for what the pane does about that.
   */
  /**
   * Phase 5 slice 11. Asymmetric by platform: Mac to phone works whenever the link is up, phone to
   * Mac only while ConnectSuite is focused on the phone. See docs/protocol.md → Clipboard.
   */
  CLIP_PUSH: 'clip.push',
  CLIP_REQUEST: 'clip.request',
  CLIP_HISTORY: 'clip.history',

  MEDIA_BUCKETS: 'media.buckets',
  MEDIA_LIST: 'media.list',
  MEDIA_THUMB: 'media.thumb',
  /**
   * Slice 3. Resolves a MediaStore id to a transfer that then runs on the bulk channel, reported by
   * the `fs.transfer.*` events — not a fifth transfer mechanism, just the one addressing mode
   * `fs.transfer.begin` cannot express.
   */
  MEDIA_ORIGINAL: 'media.original',

  /**
   * The file browser. `fs.list` with no `rootId` enumerates the roots — there is no `fs.roots`,
   * because the inventory is fixed at twelve names and adding a thirteenth to answer a question the
   * existing one already answers is how a namespace bloats.
   */
  FS_LIST: 'fs.list',
  FS_STAT: 'fs.stat',
  /** Batched thumbnails for `fs.*` ids. Separate from MEDIA_THUMB: the id spaces are disjoint. */
  FS_THUMB: 'fs.thumb',
  FS_MKDIR: 'fs.mkdir',
  /**
   * Compare-and-delete. `expectSize` and `expectMtimeMs` are **required**, and a mismatch refuses
   * with `TARGET_STALE` — the phone holds the truth and re-checks it at the moment of acting.
   */
  FS_DELETE: 'fs.delete',
  FS_TRANSFER_BEGIN: 'fs.transfer.begin',
  FS_TRANSFER_CANCEL: 'fs.transfer.cancel',
  FS_TRANSFER_PROGRESS: 'fs.transfer.progress',
  FS_TRANSFER_DONE: 'fs.transfer.done',

  /**
   * The launcher set, one entry per package. No cursor: the phone answers from an in-memory
   * `PackageManager` query, and the response carries `count` **and** `total` so the cap is visible
   * if it ever bites. See docs/protocol.md for why this list alone does not page.
   */
  APPS_LIST: 'apps.list',
  /** Batched launcher icons, at most 32 packages per request. Per-item errors, like MEDIA_THUMB. */
  APPS_ICON: 'apps.icon',
  /**
   * *Ask* the phone to open an app. There is no `apps.launch` and there will not be one.
   *
   * Measured 2026-09-03: a backgrounded `startActivity` on this platform returns normally, logs
   * nothing, and does not bring the app to the front — the one refusal shape that looks like a
   * success to every automated check. So the phone posts a notification and a person taps it, and
   * the ack means **asked**, never *opened*. There is no field for *opened* because the phone does
   * not know and will not learn.
   *
   * `scripts/check-apps-verb.mjs` is what keeps the other name from reappearing here.
   */
  APPS_OPEN_ASK: 'apps.open.ask',

  REMOTE_STATE: 'remote.state',
  REMOTE_COMMAND: 'remote.command',

  BATTERY_STATE: 'battery.state',
  NET_STATE: 'net.state',
  /** Phone to Mac, unsolicited: shared-volume free and total bytes. See docs/protocol.md. */
  STORAGE_STATE: 'storage.state',
} as const;

export const ErrorCode = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /**
   * `apps.open.ask` had nowhere to put the question: notifications from ConnectSuite are off.
   *
   * Not PERMISSION_DENIED, which greys a whole pane. The grid and its icons still work; exactly one
   * verb of three cannot be delivered, and the pane says so above a list that is still useful.
   */
  NOTIFICATIONS_BLOCKED: 'NOTIFICATIONS_BLOCKED',
  FEATURE_UNAVAILABLE: 'FEATURE_UNAVAILABLE',
  SECURE_SURFACE: 'SECURE_SURFACE',
  ENCODER_FAILED: 'ENCODER_FAILED',
  DEVICE_LOCKED: 'DEVICE_LOCKED',
  CONSENT_TIMEOUT: 'CONSENT_TIMEOUT',
  /** A coordinate was stamped with a screen shape the phone has left. Retry after recomputing. */
  GEOMETRY_STALE: 'GEOMETRY_STALE',
  GESTURE_FAILED: 'GESTURE_FAILED',
  NO_EDITABLE_FOCUS: 'NO_EDITABLE_FOCUS',
  /** A key that cannot exist for an AccessibilityService. Never worth retrying. */
  UNSUPPORTED_KEY: 'UNSUPPORTED_KEY',
  TRANSFER_FAILED: 'TRANSFER_FAILED',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // ---- Phase 4 ----
  /** The Mac sent a malformed request. A Mac-side fault; retrying it unchanged cannot help. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** The item named is gone — dismissed, deleted, ended. The feature works; refresh the list. */
  NOT_FOUND: 'NOT_FOUND',
  /** The notification carries no inline reply action. Most do not. */
  NO_REPLY_ACTION: 'NO_REPLY_ACTION',
  /** No telephony radio or no SIM. A tablet is not a broken phone. */
  NO_TELEPHONY: 'NO_TELEPHONY',
  /** The radio refused the message. Not a permission problem. */
  SEND_FAILED: 'SEND_FAILED',
  /** `call.answer`/`call.reject` with nothing ringing. */
  NO_ACTIVE_CALL: 'NO_ACTIVE_CALL',
  /** `remote.command` with no app holding a media session. */
  NO_MEDIA_SESSION: 'NO_MEDIA_SESSION',
  /**
   * An `sms.send` whose `addresses` disagree with its `threadId`, refused before anything was
   * sent. The only error here that reports a prevented harm rather than a refused convenience —
   * see "The send rule" in docs/protocol.md. Any occurrence is a Mac-side bug worth chasing.
   */
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  /**
   * The notification aimed at is not the one showing now — the app replaced it at the same key.
   * `GEOMETRY_STALE` one layer up: refuse rather than fire at whatever is there. Retry after a
   * refresh.
   */
  TARGET_STALE: 'TARGET_STALE',

  /**
   * The root the Mac named is not one the phone has been granted.
   *
   * **Not PERMISSION_DENIED**, and the difference is what the pane draws: the feature works and
   * other folders are readable, so this is an "add this folder on the phone" affordance rather than
   * a dead pane.
   */
  ROOT_NOT_GRANTED: 'ROOT_NOT_GRANTED',
  NO_SPACE: 'NO_SPACE',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',

  /**
   * The phone will not read its own clipboard because it is not the focused app.
   *
   * **Not PERMISSION_DENIED**, and here that distinction is at its sharpest: *there is no
   * permission to grant.* Measured on hardware — reads are refused from the background with the
   * AccessibilityService bound and with it disabled alike, and a foreground service does not help.
   * So a fixHint pointing at Settings would send somebody looking for a switch that does not
   * exist. The pane stays alive, says "open ConnectSuite on the phone", and offers a retry that
   * becomes meaningful the moment they do.
   */
  PHONE_NOT_FOREGROUND: 'PHONE_NOT_FOREGROUND',
} as const;

/** One clipboard entry, in either direction. `text` is absent for every kind but `text`. */
export interface ClipEntry {
  kind: 'text' | 'empty' | 'sensitive';
  text?: string;
  atMs: number;
  source: 'phone' | 'mac';
  /** Never sent without appName beside it — the package-id rule. */
  package?: string;
  appName?: string;
}

/**
 * What the Mac's **local** clipboard history holds, which is the wire entry plus one kind that is
 * not on the wire.
 *
 * `displaced` is what this Mac's clipboard held before an arriving entry overwrote it, kept so that
 * Restore is an undo. It is never sent and never received — it is deliberately absent from
 * [ClipEntry] so that the wire type stays exactly what `docs/protocol.md` specifies, and so that
 * anything building a payload out of a history row fails to compile rather than inventing a kind
 * the phone has never heard of.
 */
export type LocalClipEntry = Omit<ClipEntry, 'kind'> & { kind: ClipEntry['kind'] | 'displaced' };

export const Capability = {
  MIRROR: 'mirror',
  INPUT: 'input',
  NOTIFICATIONS: 'notifications',
  SMS: 'sms',
  CALLS: 'calls',
  CONTACTS: 'contacts',
  FILES: 'files',
  PHOTOS: 'photos',
  CLIPBOARD: 'clipboard',
  REMOTE: 'remote',
  APPS: 'apps',
  MIC: 'mic',
} as const;

export interface Envelope<T = Record<string, unknown>> {
  v: number;
  id: string;
  type: string;
  ts: number;
  payload: T;
}

/**
 * One capability the phone is not offering, and its own sentence explaining why.
 *
 * `reason` is written for a person to read — "missing Notification access", "granted in Settings,
 * but Android has not started the service…". It is not a stable API: switch on `name`, render
 * `reason`, never parse it. See docs/protocol.md, "`unavailable` — the other half of the list".
 */
export interface UnavailableCapability {
  name: string;
  reason: string;
}

export interface HelloAckPayload {
  protocolVersion: number;
  appVersion: string;
  deviceName: string;
  deviceId: string;
  fingerprint: string;
  sessionToken: string;
  capabilities: string[];
  /** Optional on the wire: an older phone sends nothing and the Mac shows a name with no reason. */
  unavailable?: UnavailableCapability[];
}

/**
 * The screen shape a coordinate was computed against, sent with every coordinate-bearing input
 * message and checked by the phone.
 *
 * The phone refuses a mismatch rather than scaling against whatever is current — see
 * docs/protocol.md, "The coordinate contract". Without it a click sent in the few milliseconds
 * around a rotation lands somewhere the user did not click, with nothing on either side saying so.
 */
export interface GeometryStamp {
  id: number;
  width: number;
  height: number;
}

/** A point in capture-frame pixels: the space `mirror.state: running` announced. */
export interface FramePoint {
  x: number;
  y: number;
}

/** The global actions the phone accepts. `power` is not one of them and never will be. */
export const GlobalAction = {
  BACK: 'back',
  HOME: 'home',
  RECENTS: 'recents',
  NOTIFICATIONS: 'notifications',
  QUICK_SETTINGS: 'quick_settings',
  LOCK_SCREEN: 'lock_screen',
} as const;

export type GlobalActionName = (typeof GlobalAction)[keyof typeof GlobalAction];

export interface ErrorPayload {
  code: string;
  feature?: string;
  message: string;
  fixHint?: string;
}

/**
 * A rejection carrying what the phone actually said.
 *
 * `Error.message` keeps its `CODE: sentence` form, which is what the logs want. The phone's own
 * sentence is kept separately because that is what goes in front of a user — nobody reading a
 * canvas needs to be shown `NO_EDITABLE_FOCUS:` before being told to click a text field first.
 */
export interface PhoneRequestError extends Error {
  code?: string;
  phoneMessage?: string;
  fixHint?: string;
}

/**
 * A phone-side refusal, as it crosses the IPC bridge.
 *
 * Every feature client in the main process resolves with one of these rather than throwing, for
 * the reason defect 22 established: `ipcRenderer.invoke` rewraps anything thrown as
 * `Error invoking remote method '<channel>': Error: <message>`, so a rejection delivers nine words
 * of Electron internals in front of a sentence the phone composed for a person to read. The parts
 * travel separately and the renderer composes what is shown.
 *
 * `code` is carried for the log and for branching; it is never shown. Nobody reading a pane needs
 * `NO_REPLY_ACTION:` in front of being told that app does not offer a reply.
 */
export interface PhoneFailure {
  ok: false;
  reason: string;
  fixHint?: string;
  code?: string;
}

/** A request that returns data. */
export type PhoneResult<T> = { ok: true; data: T } | PhoneFailure;

/** A request that only needs to have worked, or to explain why it did not. */
export type PhoneAck = { ok: true } | PhoneFailure;

/**
 * The result of one input intent, as it crosses the IPC bridge.
 *
 * A value, never a rejection. `ipcRenderer.invoke` rewraps anything the main process throws as
 * `Error invoking remote method '<channel>': Error: <message>`, so throwing put nine words of
 * Electron internals in front of every sentence the phone composed — defect 22. The main process
 * therefore resolves with this, and the renderer composes what the user reads from the parts.
 *
 * `code` is carried for the log and for anything that wants to branch on the failure; it is never
 * shown. Nobody reading a canvas needs `NO_EDITABLE_FOCUS:` in front of being told to click a
 * text field first.
 */
export type InputResult = PhoneAck;

// ---- Phase 4 payloads -----------------------------------------------------------------------
// Twins of what the phone builds in sync-module/.../v2/. docs/protocol.md, "Phase 4 features", is
// the contract these two sides both answer to — change it there first.

/**
 * Every list request in Phase 4 takes this shape.
 *
 * Paging is not optional politeness. A phone with 40,000 messages in one thread would otherwise
 * put all of them into one control frame and fail the 16 MiB length check rather than the query,
 * which reads as "the link broke" and is the least debuggable failure available.
 */
export interface PageRequest {
  /** Default 50, maximum 200. */
  limit?: number;
  /** Epoch ms. Items strictly older than this. Not accepted by `contacts.list`. */
  before?: number;
}

/** Every list reply says whether there is more, so the Mac never infers it from a short page. */
export interface PageReply {
  hasMore: boolean;
}

export interface NotificationAction {
  index: number;
  title: string;
  isReply?: boolean;
}

/**
 * One live notification, as `notif.posted` carries it.
 *
 * `key` is Android's `StatusBarNotification.getKey()`: opaque, not stable across a reboot, and the
 * only identifier `notif.reply`/`action`/`dismiss` accept. Treat it as a token to hand back.
 */
export interface PhoneNotification {
  key: string;
  package: string;
  appName: string;
  title?: string;
  text?: string;
  subText?: string;
  whenMs: number;
  category?: string;
  ongoing: boolean;
  clearable: boolean;
  groupKey?: string;
  /**
   * The platform's collapse header for a group, `FLAG_GROUP_SUMMARY`.
   *
   * It has no title and no text, so drawing it produces a row with an app name, a time and a
   * Dismiss button and nothing else. The pane hides these; see docs/protocol.md.
   */
  isGroupSummary: boolean;
  /** False on most notifications. The Mac must not offer a reply box when it is false. */
  canReply: boolean;
  replyLabel?: string;
  actions: NotificationAction[];
}

export interface SmsThread {
  threadId: string;
  addresses: string[];
  snippet: string;
  dateMs: number;
  unread: number;
  messageCount: number;
  /** Present only when the `contacts` capability is also granted. */
  contactName?: string;
}

export interface SmsMessage {
  id: string;
  threadId?: string;
  address: string;
  body: string;
  dateMs: number;
  inbound: boolean;
  read: boolean;
  kind: 'sms' | 'mms';
  /**
   * True when an MMS carries parts this protocol does not deliver. The Mac must show that
   * something is there rather than presenting the text as the whole message — see docs/protocol.md.
   */
  hasAttachments: boolean;
}

export type CallState = 'ringing' | 'active' | 'dialing';
export type CallDisposition = 'answered' | 'missed' | 'rejected' | 'declined';
export type CallLogType =
  | 'incoming'
  | 'outgoing'
  | 'missed'
  | 'rejected'
  | 'blocked'
  | 'voicemail'
  /** A type this build does not recognise. Shown plainly rather than guessed at. */
  | 'unknown';

export interface IncomingCall {
  callId: string;
  number: string;
  contactName?: string;
  startedAtMs: number;
  state: CallState;
}

export interface CallEnded {
  callId: string;
  number: string;
  durationMs: number;
  disposition: CallDisposition;
}

export interface CallLogEntry {
  id: string;
  number: string;
  contactName?: string;
  type: CallLogType;
  dateMs: number;
  durationMs: number;
}

export interface LabelledValue {
  value: string;
  label: string;
}

export interface PhoneContact {
  id: string;
  displayName: string;
  hasPhoto: boolean;
  numbers: LabelledValue[];
  emails: LabelledValue[];
  /** Base64 PNG, only from `contacts.get` with `withPhoto`, capped at 64 KiB by the phone. */
  photo?: string;
}

/**
 * `remote.state`, which is both a reply and an unsolicited event.
 *
 * `positionMs` is meaningless without `positionAtMs`, for the same reason a frame PTS is
 * meaningless without a clock reading: a position is stale the instant it is sent. The pair lets
 * the Mac run a progress bar itself between updates instead of guessing how old the number is.
 */
export interface RemoteState {
  active: boolean;
  package?: string;
  appName?: string;
  playing?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
  /** The phone's `Date.now()` when `positionMs` was read. */
  positionAtMs?: number;
  canSeek?: boolean;
  canSkipNext?: boolean;
  canSkipPrevious?: boolean;
  volume?: number;
  volumeMax?: number;
}

export const RemoteAction = {
  PLAY: 'play',
  PAUSE: 'pause',
  PLAY_PAUSE: 'play_pause',
  STOP: 'stop',
  NEXT: 'next',
  PREVIOUS: 'previous',
  SEEK: 'seek',
  VOLUME_UP: 'volume_up',
  VOLUME_DOWN: 'volume_down',
  VOLUME_SET: 'volume_set',
} as const;

export type RemoteActionName = (typeof RemoteAction)[keyof typeof RemoteAction];

/** What the Mac shows in its QR code. The phone scans exactly this. */
export interface PairingQrPayload {
  host: string;
  fp: string;
  token: string;
  name: string;
}

export type ConnectionPhase =
  | 'idle'
  | 'searching'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  /** How the current (or last) address was found, for the debug HUD. */
  via?: 'last-known' | 'gateway' | 'mdns' | 'manual' | 'tailscale';
  address?: string;
  deviceName?: string;
  capabilities: string[];
  /** Why each absent capability is absent, as the phone explained it. Empty when disconnected. */
  unavailable: UnavailableCapability[];
  rttMs?: number;
  /** A sentence for a person. Classified by `classifyLinkError`; never a raw transport error. */
  lastError?: string;
  /** The original text, for the debug HUD and the log only. Never rendered as prose. */
  lastErrorRaw?: string;
  nextRetryInMs?: number;
  /**
   * @deprecated Two states where there are three. Read `pairing` instead — a stored pairing the
   * phone has repudiated is not `paired`, and drawing it as such is what produced "Reconnecting…"
   * forever against a phone that would never accept us.
   */
  paired: boolean;
  /** Pairing as three states. The one fact the sidebar and the pairing screen both read. */
  pairing?: PairingHealth;
}

/** Colon-separated uppercase hex is what both ends display; comparisons use this normal form. */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/[:\s]/g, '').toLowerCase();
}
