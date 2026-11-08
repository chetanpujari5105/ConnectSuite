import type { ChannelPolicy, WindowRole } from './ipcAuth';
import {
  NONE,
  arr,
  bool,
  epochMs,
  id,
  limit,
  localPath,
  messageText,
  num,
  obj,
  oneOf,
  opt,
  point,
  str,
  type ArgsSpec,
  type Check,
} from '../shared/ipcSchema';

/**
 * Which window may call which channel, with what — audit S4, defect 183. `docs/ipc-authorization.md`
 * is this table written out with the reasons.
 *
 * Roles are derived from which page's scripts call each bridge method (`index.html` → main,
 * `float.html` → float, `share-window.html` → share) and checked by `ipcPolicy.test.ts` against the
 * three preloads, so a method cannot be exposed to a window this table does not allow.
 */

const M: readonly WindowRole[] = ['main'];
const F: readonly WindowRole[] = ['float'];
const MF: readonly WindowRole[] = ['main', 'float'];
const S: readonly WindowRole[] = ['share'];
const ALL: readonly WindowRole[] = ['main', 'float', 'share'];

const p = (roles: readonly WindowRole[], effect: ChannelPolicy['effect'], args: ArgsSpec = NONE): ChannelPolicy => ({ roles, effect, args });

const facing = oneOf('front', 'back');
const geom = obj({ id: num({ min: 0, max: Number.MAX_SAFE_INTEGER, int: true }), width: num({ min: 1, max: 20_000 }), height: num({ min: 1, max: 20_000 }) });
const duration = opt(num({ min: 0, max: 60_000 }));
const offer = obj({ offerId: id });
const quality = obj({ maxResolution: opt(num({ min: 144, max: 4_320, int: true })), frameRate: opt(num({ min: 1, max: 240 })) });
const route = obj({ id: str({ min: 1, max: 64 }), label: str({ max: 200 }), shortcut: opt(str({ max: 64 })) });
/** Development probes only: flat objects of primitives. Their handlers exist only unpackaged. */
const flat: Check = (v, at) => {
  if (v === undefined) return null;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${at} must be an object`;
  const entries = Object.entries(v);
  if (entries.length > 16) return `${at} has too many fields`;
  for (const [, value] of entries) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) return `${at} has a non-primitive field`;
    if (typeof value === 'string' && value.length > 4_096) return `${at} has an over-long field`;
  }
  return null;
};
const phoneNumber = str({ min: 1, max: 64, pattern: /^[0-9+*#() \-.,;pPwW]+$/ });

export const IPC_POLICY: Readonly<Record<string, ChannelPolicy>> = {
  // ---- shell, appearance, status --------------------------------------------------------------
  'appearance-get': p(ALL, 'read'),
  'appearance-set': p(M, 'action', [oneOf('system', 'light', 'dark')]),
  'menu-routes': p(M, 'action', [arr(route, { max: 64 }), opt(arr(route, { max: 64 }))]),
  'route-changed': p(M, 'window', [str({ min: 1, max: 64 })]),
  status: p(M, 'read'),
  'self-identity': p(M, 'read'),
  settings: p(M, 'sensitive-read'),
  'log-tail': p(M, 'sensitive-read', [opt(num({ min: 1, max: 5_000, int: true }))]),
  'renderer-log': p(MF, 'action', [str({ max: 32 }), str({ max: 2_000 })]),
  'debug-switches': p(F, 'read'),
  'mark-moment': p(M, 'debug', [flat]),
  'rename-notice': p(M, 'read'),

  // ---- link and pairing — main window only ----------------------------------------------------
  connect: p(M, 'action'),
  disconnect: p(M, 'action'),
  'retry-now': p(M, 'action'),
  'set-manual-address': p(M, 'action', [str({ max: 255 })]),
  'set-tailscale-address': p(M, 'action', [str({ max: 255 })]),
  'forget-device': p(M, 'action'),
  'pairing-qr': p(M, 'pairing', [opt(bool)]),

  // ---- mirror and input -----------------------------------------------------------------------
  'mirror-start': p(M, 'action', [opt(quality)]),
  'mirror-stop': p(M, 'action'),
  'mirror-config': p(M, 'action', [quality]),
  'mirror-stats': p(M, 'read'),
  'mirror-keyframe': p(MF, 'action', [opt(str({ max: 200 }))]),
  'mirror-capture': p(MF, 'action', [str({ min: 23, max: 64 * 1024 * 1024, pattern: /^data:image\/png;base64,/ })]),
  'stream-start': p(F, 'read'),
  'input-tap': p(MF, 'action', [obj({ x: num({ min: -1e6, max: 1e6 }), y: num({ min: -1e6, max: 1e6 }), durationMs: duration, geom })]),
  'input-swipe': p(MF, 'action', [obj({ points: arr(point, { min: 1, max: 500 }), durationMs: duration, geom })]),
  'input-scroll': p(MF, 'action', [obj({ x: num({ min: -1e6, max: 1e6 }), y: num({ min: -1e6, max: 1e6 }), dx: num({ min: -1e6, max: 1e6 }), dy: num({ min: -1e6, max: 1e6 }), durationMs: duration, geom })]),
  'input-key': p(M, 'action', [str({ min: 1, max: 32 })]),
  'input-text': p(M, 'action', [obj({ text: str({ max: 10_000 }), mode: opt(oneOf('replace', 'append')) })]),
  'input-global': p(MF, 'action', [str({ min: 1, max: 32 })]),

  // ---- floating window --------------------------------------------------------------------------
  'float-open': p(M, 'window'),
  'float-close': p(MF, 'window'),
  'float-minimize': p(F, 'window'),
  'float-smart-fit': p(F, 'window'),
  'float-set-width': p(M, 'window', [num({ min: 100, max: 4_000 })]),
  'float-set-pinned': p(F, 'window', [bool]),
  'float-move': p(F, 'window', [obj({ pointer: point, grab: point })]),
  'float-resize': p(F, 'window', [obj({ x: num({ min: -1e6, max: 1e6 }) })]),
  'float-state': p(MF, 'read'),
  'main-window-show': p(F, 'window'),

  // ---- camera ---------------------------------------------------------------------------------
  'camera-request': p(M, 'action', [facing]),
  'camera-stop': p(M, 'action'),
  'camera-switch': p(M, 'action', [facing]),
  'camera-current': p(M, 'read'),
  'camera-frame-ack': p(M, 'action', [str({ max: 64 }), str({ max: 32 })]),
  'webcam-current': p(M, 'read'),
  'webcam-ask': p(M, 'action', [opt(facing)]),
  'webcam-stop': p(M, 'action'),
  'webcam-switch': p(M, 'action', [facing]),
  'webcam-spike-current': p(M, 'debug'),
  'webcam-spike-run': p(M, 'debug'),

  // ---- notifications, calls, SMS, contacts — personal data, main window only --------------------
  'notif-permission': p(M, 'read'),
  'notif-sound-get': p(M, 'read'),
  'notif-sound-set': p(M, 'action', [bool]),
  'notif-list': p(M, 'sensitive-read'),
  'notif-reply': p(M, 'action', [obj({ key: str({ min: 1, max: 1_024 }), text: messageText })]),
  'notif-action': p(M, 'action', [obj({ key: str({ min: 1, max: 1_024 }), index: num({ min: 0, max: 32, int: true }) })]),
  'notif-dismiss': p(M, 'action', [str({ min: 1, max: 1_024 })]),
  'call-current': p(M, 'sensitive-read'),
  'call-log': p(M, 'sensitive-read', [opt(obj({ limit, before: epochMs }))]),
  'call-answer': p(M, 'action'),
  'call-reject': p(M, 'action'),
  'call-dial': p(M, 'action', [phoneNumber]),
  'sms-threads': p(M, 'sensitive-read', [opt(obj({ limit, before: epochMs }))]),
  'sms-messages': p(M, 'sensitive-read', [obj({ threadId: id, options: opt(obj({ limit, before: epochMs })) })]),
  'sms-send': p(M, 'action', [obj({ threadId: id, body: messageText })]),
  'sms-send-new': p(M, 'action', [obj({ addresses: arr(phoneNumber, { min: 1, max: 20 }), body: messageText })]),
  'contacts-list': p(M, 'sensitive-read', [opt(obj({ query: opt(str({ max: 200 })), limit }))]),
  'contacts-get': p(M, 'sensitive-read', [obj({ id: opt(id), number: opt(phoneNumber), withPhoto: opt(bool) })]),

  // ---- clipboard --------------------------------------------------------------------------------
  'clip-send': p(M, 'action'),
  'clip-watching': p(M, 'read'),
  'clip-set-watching': p(M, 'action', [bool]),
  'clip-request': p(M, 'action'),
  'clip-history': p(M, 'sensitive-read'),
  'clip-phone-history': p(M, 'sensitive-read', [opt(num({ min: 1, max: 100, int: true }))]),
  'clip-clear': p(M, 'action'),
  'clip-open': p(M, 'action', [messageText]),
  'clip-use': p(M, 'action', [messageText]),
  'clip-offer-copy': p(M, 'action', [obj({ offerId: id })]),
  'clip-offer-dismiss': p(M, 'action', [obj({ offerId: id })]),
  'clip-offer-banner': p(M, 'read'),
  'clip-restore': p(M, 'action', [obj({ id })]),

  // ---- media remote, apps, device -------------------------------------------------------------
  'remote-state': p(M, 'read'),
  'device-vitals': p(M, 'read'),
  'remote-command': p(M, 'action', [obj({ action: str({ min: 1, max: 64 }), extra: opt(obj({ positionMs: opt(num({ min: 0, max: 1e12 })), volume: opt(num({ min: 0, max: 1_000 })) })) })]),
  'remote-artwork': p(M, 'read', [obj({ key: str({ min: 1, max: 1_024 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]),
  'apps-list': p(M, 'read'),
  'apps-icons': p(M, 'read', [obj({ packages: arr(str({ min: 1, max: 256 }), { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 512 })) })]),
  'apps-open-ask': p(M, 'action', [obj({ package: str({ min: 1, max: 256 }) })]),
  'login-item-get': p(M, 'read'),
  'login-item-set': p(M, 'action', [bool]),

  // ---- files and photos -------------------------------------------------------------------------
  'fs-roots': p(M, 'read'),
  'fs-list': p(M, 'sensitive-read', [obj({ rootId: id, path: opt(str({ max: 4_096 })), limit, afterName: opt(str({ max: 1_024 })), afterId: opt(id) })]),
  'fs-thumb': p(M, 'sensitive-read', [obj({ rootId: id, ids: arr(id, { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]),
  'fs-pick-send': p(M, 'action'),
  'fs-confirm-drop': p(M, 'action', [arr(localPath, { min: 1, max: 500 })]),
  'fs-send': p(M, 'action', [obj({ rootId: id, path: str({ max: 4_096 }), source: localPath })]),
  'fs-send-abort': p(M, 'action', [obj({ source: localPath })]),
  'fs-pull': p(M, 'action', [obj({ rootId: id, id, name: str({ min: 1, max: 1_024 }), size: num({ min: 0, max: 1e15, int: true }) })]),
  'fs-pull-stop': p(M, 'action', [obj({ transferId: id, how: oneOf('pause', 'cancel') })]),
  'fs-paused-pulls': p(M, 'read'),
  'fs-cancel-paused': p(M, 'action', [obj({ rootId: id, id })]),
  'fs-cancel': p(M, 'action', [obj({ transferId: id })]),
  'fs-drag': p(M, 'action', [arr(localPath, { min: 1, max: 500 })]),
  'media-buckets': p(M, 'sensitive-read'),
  'media-list': p(M, 'sensitive-read', [opt(obj({ bucketId: opt(id), limit, before: epochMs, beforeId: opt(id) }))]),
  'media-thumbs': p(M, 'sensitive-read', [obj({ ids: arr(id, { max: 5_000 }), maxEdge: opt(num({ min: 16, max: 1_024 })) })]),
  'media-original': p(M, 'action', [obj({ id })]),
  'media-preview-thumb': p(M, 'sensitive-read', [obj({ id })]),
  'media-preview-original': p(M, 'sensitive-read', [obj({ id })]),
  'reveal-saved': p(M, 'action', [obj({ path: localPath })]),
  'downloads-folder': p(M, 'read'),
  'downloads-choose': p(M, 'action'),
  'downloads-use-default': p(M, 'action'),
  'downloads-reveal': p(M, 'action'),
  'downloads-reveal-legacy': p(M, 'action'),
  'activity-events': p(M, 'sensitive-read'),
  'activity-csv': p(M, 'action'),

  // ---- phone → Mac sharing ----------------------------------------------------------------------
  'share-offers': p(M, 'sensitive-read'),
  'share-window-show': p(M, 'window', [offer]),
  'share-window-state': p(S, 'sensitive-read'),
  'share-decide': p(S, 'action', [obj({ offerId: id, decision: oneOf('accept', 'decline') })]),
  'share-cancel': p(S, 'action', [offer]),
  'share-retry': p(S, 'action', [offer]),
  'share-open': p(S, 'action', [offer]),
  'share-reveal': p(S, 'action', [offer]),
  'share-window-close': p(S, 'window'),
  'share-window-height': p(S, 'window', [num({ min: 0, max: 10_000 })]),

  // ---- development probes (registered only when unpackaged) ---------------------------------------
  'debug-push-resume-probe': p(M, 'debug', [flat]),
  'debug-resume-probe': p(M, 'debug', [flat]),
  'debug-fs-stat': p(M, 'debug', [flat]),
  'debug-fs-probe': p(M, 'debug', [flat]),
  'debug-fs-pull-probe': p(M, 'debug', [flat]),
  'debug-fs-cancel-probe': p(M, 'debug', [flat]),
  'debug-fs-delete-probe': p(M, 'debug', [flat]),
};

/**
 * Which windows may **receive** each main → renderer event. A narrow preload hides an event from a page;
 * this keeps it out of that window's process at all. Unlisted channels go to the main window only.
 */
export const EVENT_ROLES: Readonly<Record<string, readonly WindowRole[]>> = {
  status: MF,
  appearance: ALL,
  'float-changed': MF,
  'mirror-rotate': MF,
  'mirror-state': MF,
  'mirror-stopped': MF,
  'video-frame': MF,
};

