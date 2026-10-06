/*
 * Synthetic bridge for the UI harness. Every value here is invented: fictional 555 numbers, made-up
 * names, no file from any real device. Loaded with contextIsolation off so `window.connect` can be a
 * Proxy — an unmodelled method is answered with a recorded refusal instead of crashing the page, and
 * the harness reads `__harness.unmodelled` to see what the panes asked for.
 *
 * MODE comes from the command line: populated | empty | disconnected | failing
 */
const MODE = (process.argv.find((a) => a.startsWith('--harness-mode=')) || '--harness-mode=populated').split('=')[1];
const THEME = (process.argv.find((a) => a.startsWith('--harness-theme=')) || '--harness-theme=dark').split('=')[1];
const SCALE = Number((process.argv.find((a) => a.startsWith('--harness-scale=')) || '--harness-scale=1').split('=')[1]);
const now = Date.UTC(2026, 9, 6, 1, 0, 0);
const LONG = 'An unusually long label that keeps going past where any designer expected it to stop, to see what wraps';
const CAPS = ['mirror', 'input', 'notifications', 'sms', 'calls', 'contacts', 'files', 'photos', 'clipboard', 'remote', 'apps'];
const ok = (data) => Promise.resolve({ ok: true, data });
const refuse = (reason) => Promise.resolve({ ok: false, reason, fixHint: 'Synthetic harness refusal.' });

const n = (i) => `+1 555 01${String(i % 100).padStart(2, '0')}`;
const names = ['Test Contact A', 'Test Contact B', LONG, 'Ada Example', 'Grace Example', 'Unknown'];
const populated = MODE === 'populated';
const scaled = (k) => Math.max(1, Math.round(k * SCALE));

const fixtures = {
  status: () => Promise.resolve(MODE === 'disconnected'
    ? { phase: 'reconnecting', capabilities: [], unavailable: [], limited: [], paired: true, lastError: 'The connection to your phone dropped. Reconnecting.', nextRetryInMs: 4000, deviceName: 'Synthetic Phone' }
    : { phase: 'connected', via: 'last-known', address: '192.0.2.10', deviceName: 'Synthetic Phone With A Rather Long Device Name', capabilities: CAPS,
        unavailable: [{ capability: 'mic', reason: 'Synthetic: the microphone is not offered by this phone build.' }], limited: [], rttMs: 12, paired: true }),
  selfIdentity: () => Promise.resolve({ name: 'Synthetic Mac', fingerprint: 'AB12CD34' }),
  settings: () => Promise.resolve({ manualAddress: null, tailscaleAddress: null }),
  logTail: () => Promise.resolve(['2026-10-06T01:00:00.000+05:30 I [link] synthetic log line']),
  appearanceGet: () => ok({ appearance: THEME, theme: THEME }),
  notifPermission: () => Promise.resolve({ refused: false, headline: null, body: null, actionable: false, message: null }),
  notifSoundGet: () => Promise.resolve(true),
  renameNotice: () => ok({ notice: null }),
  loginItemGet: () => ok({ openAtLogin: false }),
  downloadsFolder: () => ok({ path: '/Users/synthetic/Downloads/Sidekick', chosen: false, defaultPath: '/Users/synthetic/Downloads/Sidekick', legacyPath: null }),
  clipWatching: () => ok({ watching: true }),
  debugSwitches: () => Promise.resolve({}),
  floatState: () => Promise.resolve({ open: false }),
  shareOffers: () => Promise.resolve([]),
  callCurrent: () => Promise.resolve(null),
  mirrorStats: () => Promise.resolve({ frames: 0, bytes: 0, kbps: null, framesPerSecond: null, phone: null }),
  deviceVitals: () => Promise.resolve(populated
    ? { battery: { level: 64, charging: false, atMs: now }, storage: { freeBytes: 41e9, totalBytes: 256e9, atMs: now } }
    : { battery: null, storage: null }),
  pairingQr: () => Promise.resolve({ payload: { host: '192.0.2.20', name: 'Synthetic Mac' }, dataUrl: '', reachable: true }),
  pairingQrRender: () => Promise.resolve(null),
  menuSetRoutes: () => Promise.resolve(),
  routeChanged: () => {},
  cameraCurrent: () => Promise.resolve({ kind: 'idle' }),
  webcamCurrent: () => Promise.resolve({ bridge: 'absent', bridgeDetail: null, device: 'not-installed', producer: 'unknown', consumers: 0, phone: { kind: 'ready' }, blocker: 'Synthetic: no camera extension on this Mac.', session: null }),
  fsPausedPulls: () => Promise.resolve([]),
  remoteState: () => Promise.resolve(populated
    ? { active: true, package: 'com.example.player', appName: 'Example Player', playing: true, title: LONG, artist: 'Synthetic Artist', album: 'Synthetic Album', durationMs: 240000, positionMs: 60000, positionAtMs: now, canSeek: true, canSkipNext: true, canSkipPrevious: true, receivedAtMs: now }
    : { active: false, receivedAtMs: now }),
  notifList: () => Promise.resolve(!populated ? [] : Array.from({ length: scaled(40) }, (_, i) => ({
    key: `0|com.example.app${i % 7}|${i}|null|10123`, package: `com.example.app${i % 7}`, appName: i % 7 === 3 ? LONG : `Example App ${i % 7}`,
    title: names[i % names.length], text: i % 5 === 0 ? `${LONG}. ${LONG}.` : `Synthetic message ${i}`, whenMs: now - i * 60000,
    ongoing: false, clearable: true, isGroupSummary: false, canReply: i % 2 === 0, replyLabel: 'Reply',
    actions: i % 3 === 0 ? [{ index: 0, title: 'Mark as read' }, { index: 1, title: 'Archive this conversation for later' }] : [],
  }))),
  smsThreads: () => !populated ? ok({ threads: [], hasMore: false }) : ok({ hasMore: false, threads: Array.from({ length: scaled(60) }, (_, i) => ({
    threadId: String(i + 1), addresses: [n(i)], snippet: i % 4 === 0 ? LONG : `Synthetic snippet ${i}`, dateMs: now - i * 3600000,
    unread: i % 6 === 0 ? 3 : 0, messageCount: 10 + i, contactName: i % 3 === 0 ? undefined : names[i % names.length],
  })) }),
  smsMessages: (threadId) => ok({ threadId, hasMore: false, messages: Array.from({ length: scaled(30) }, (_, i) => ({
    id: `${threadId}-${i}`, threadId, address: n(1), body: i % 4 === 0 ? `${LONG} ${LONG}` : `Synthetic body ${i}`, dateMs: now - (30 - i) * 600000,
    inbound: i % 2 === 0, read: true, kind: 'sms', hasAttachments: false,
  })) }),
  callLog: () => !populated ? ok({ calls: [], hasMore: false }) : ok({ hasMore: false, calls: Array.from({ length: scaled(50) }, (_, i) => ({
    id: String(i), number: n(i), contactName: i % 2 ? names[i % names.length] : undefined, type: ['incoming', 'outgoing', 'missed', 'rejected'][i % 4],
    dateMs: now - i * 7200000, durationMs: i % 4 === 2 ? 0 : 65000 + i * 1000,
  })) }),
  contactsList: () => ok({ hasMore: false, contacts: !populated ? [] : Array.from({ length: scaled(30) }, (_, i) => ({
    id: String(i), displayName: names[i % names.length] + (i > 5 ? ` ${i}` : ''), hasPhoto: false, numbers: [{ value: n(i), label: 'mobile' }], emails: [],
  })) }),
  clipHistory: () => ok(!populated ? [] : Array.from({ length: scaled(20) }, (_, i) => ({
    kind: i === 3 ? 'sensitive' : i === 5 ? 'displaced' : 'text', text: i === 3 ? undefined : (i % 4 === 0 ? `${LONG} https://example.com/${'x'.repeat(120)}` : `Synthetic clip ${i}`),
    atMs: now - i * 120000, source: i % 2 ? 'phone' : 'mac', appName: i % 2 ? 'Example App' : undefined, package: i % 2 ? 'com.example.app' : undefined,
  }))),
  fsRoots: () => ok({ push: true, grantHint: null, roots: process.argv.includes('--harness-noshare') ? [{ rootId: 'downloads:connectsuite', label: 'Download/ConnectSuite', kind: 'downloads', writable: true, freeBytes: 41e9 }] : [
    { rootId: 'downloads:connectsuite', label: 'Download/ConnectSuite', kind: 'downloads', writable: true, freeBytes: 41e9 },
    { rootId: 'saf:a', label: 'DCIM', kind: 'tree', writable: true, freeBytes: 41e9 },
    { rootId: 'saf:b', label: LONG, kind: 'tree', writable: false, freeBytes: null },
  ] }),
  fsList: () => ok({ hasMore: false, entries: !populated ? [] : Array.from({ length: scaled(80) }, (_, i) => ({
    id: `e${i}`, name: i % 9 === 0 ? `${LONG.replace(/ /g, '_')}_${i}.pdf` : (i < 6 ? `Folder ${i}` : `synthetic-file-${i}.jpg`), dir: i < 6,
    size: i < 6 ? 0 : 1024 * (i * 37), mtimeMs: now - i * 86400000, mime: i < 6 ? 'inode/directory' : 'image/jpeg',
  })) }),
  fsThumbs: () => Promise.resolve({ ok: true, entries: [] }),
  mediaBuckets: () => ok(!populated ? [] : Array.from({ length: scaled(12) }, (_, i) => ({
    bucketId: `b${i}`, bucketName: i === 2 ? LONG : `Album ${i}`, count: 100 + i * 37, newestMs: now - i * 86400000, coverId: `m${i}`,
  }))),
  mediaList: (opts = {}) => {
    const total = Number((process.argv.find((x) => x.startsWith('--harness-photos-total=')) || '=0').split('=')[1]);
    if (populated && total > 0) {
      const all = [];
      for (let i = 0; i < total; i++) all.push({ id: `p${i}`, kind: i % 7 === 0 ? 'video' : 'image', mime: 'image/jpeg', size: 2e6 + i, width: 4000, height: 3000, dateMs: now - Math.floor(i / 9) * 3600000, durationMs: i % 7 === 0 ? 12000 : null });
      const start = opts.beforeId ? all.findIndex((x) => x.id === opts.beforeId) + 1 : 0;
      const page = all.slice(start, start + (opts.limit || 120));
      return ok({ items: page, hasMore: start + page.length < all.length });
    }
    return ok({ hasMore: false, items: !populated ? [] : Array.from({ length: scaled(120) }, (_, i) => ({
    id: `m${i}`, kind: i % 7 === 0 ? 'video' : 'image', mime: i % 7 === 0 ? 'video/mp4' : 'image/jpeg', size: 2e6 + i, width: 4000, height: 3000,
    dateMs: now - i * 3600000, durationMs: i % 7 === 0 ? 12000 : null,
  })) });
  },
  mediaThumbs: () => ok([]),
  appsList: () => ok(!populated ? { apps: [], count: 0, total: 0 } : { count: scaled(123), total: scaled(123), apps: Array.from({ length: scaled(123) }, (_, i) => ({
    package: `com.example.app${i}`, label: i % 11 === 0 ? LONG : `Example ${i}`, updatedMs: now - i * 86400000, labelIsFallback: i % 17 === 0,
  })) }),
  appsIcons: () => ok([]),
  activityEvents: () => ok({ error: null, stats: { read: populated ? scaled(400) : 0, skipped: 0, recorded: 0, dropped: 0 },
    events: !populated ? [] : Array.from({ length: scaled(400) }, (_, i) => ({ seq: i + 1, at: now - (400 - i) * 90000,
      category: ['link', 'messages', 'calls', 'files', 'photos', 'clipboard', 'notifications', 'mirror'][i % 8], kind: `Synthetic event ${i}`, detail: i % 10 === 0 ? LONG : `detail ${i}` })) }),
};

const listeners = {};
const unmodelled = {};
const api = new Proxy({}, {
  get(_target, name) {
    if (typeof name !== 'string') return undefined;
    if (MODE === 'failing' && name in fixtures && !['status', 'selfIdentity', 'settings', 'appearanceGet', 'menuSetRoutes', 'routeChanged', 'notifPermission', 'notifSoundGet', 'renameNotice', 'debugSwitches', 'floatState', 'shareOffers', 'callCurrent', 'logTail', 'loginItemGet', 'downloadsFolder', 'clipWatching', 'cameraCurrent', 'webcamCurrent', 'fsPausedPulls', 'mirrorStats', 'deviceVitals', 'remoteState', 'notifList'].includes(name)) {
      return () => refuse(`Synthetic failure for ${name}: the phone did not answer.`);
    }
    if (name in fixtures) return fixtures[name];
    if (name.startsWith('on')) return (cb) => { (listeners[name] ||= []).push(cb); };
    if (name === 'pathForFile') return () => '';
    return (..._args) => {
      unmodelled[name] = (unmodelled[name] || 0) + 1;
      return refuse(`Synthetic harness: ${name} is not modelled.`);
    };
  },
});
window.connect = api;
window.__harness = {
  mode: MODE,
  listeners,
  unmodelled,
  emit(name, payload) { for (const cb of listeners[name] || []) cb(payload); },
};
