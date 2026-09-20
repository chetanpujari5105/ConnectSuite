/**
 * D67's two-layout state system, verified where it is drawn rather than where it is defined.
 *
 * `stateBlock.test.ts` proves the rule over the component; this proves it over **every state block
 * the running app actually draws**, across every route, in both themes and at both sizes. The two
 * are not substitutes: a unit test cannot see a pane that added a class of its own, a cascade that
 * overrode a tone, or an action clipped out of a narrow column.
 *
 *   node scripts/state-system-verify.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const verdict = (what, ok, note = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what}${note ? ` — ${note}` : ''}`);
  if (!ok) failures += 1;
};

/**
 * Every state block **on the visible route**, with everything the rule constrains.
 *
 * Scoped to the one visible `section.screen`, not to the document. The first version read
 * `document.querySelectorAll('.state-block')` and so counted every hidden pane's blocks on every
 * route — which is why each of the twelve routes appeared to draw an `empty` block, and why Photos
 * was recorded as drawing `error` when a direct probe showed `permission`. It is `CLAUDE.md`'s own
 * rule, broken in the file written to enforce a design rule: **narrow the selector until it can
 * only be the thing**, then check that what you narrowed to is visible.
 */
const BLOCKS = `[...(document.querySelector('section.screen:not([hidden])')?.querySelectorAll('.state-block') ?? [])]
  .filter((n) => n.offsetParent !== null)
  .map((n) => {
  const cs = getComputedStyle(n);
  const action = n.querySelectorAll('.state-action');
  const r = n.getBoundingClientRect();
  return {
    cls: n.className,
    kind: n.dataset.kind,
    tone: n.dataset.tone,
    state: n.dataset.state || null,
    actions: action.length,
    /*
     * What makes the action keyboard-operable, read rather than assumed: a real <button> is
     * focusable and fires on Enter and Space with no code; a <div> with a click handler looks
     * identical, passes a focus-ring sweep if it carries a tabindex, and does nothing on a key.
     */
    actionTag: action.length ? action[0].tagName : null,
    actionType: action.length ? action[0].getAttribute('type') : null,
    actionTabbable: action.length ? action[0].tabIndex >= 0 : null,
    actionClipped: action.length ? (() => { const a = action[0].getBoundingClientRect();
      const p = n.getBoundingClientRect();
      return a.right > p.right + 1 || a.bottom > p.bottom + 1; })() : false,
    overflows: n.scrollWidth > n.clientWidth + 1,
    offRight: r.right > document.documentElement.clientWidth + 1,
    badges: n.querySelectorAll('.state-badge').length,
    headlines: n.querySelectorAll('.state-headline').length,
  };
})`;

/** The drivers that put each migrated pane into a state, through its own public path. */
const DRIVE = {
  files: `(async () => { window.__r ??= files.bridge.fsRoots;
    files.bridge.fsRoots = async () => ({ ok:false, reason:'The phone could not open that folder.', code:'TARGET_STALE' });
    await files.refresh(); })()`,
  photos: `(async () => { window.__b ??= photos.bridge.mediaBuckets;
    photos.bridge.mediaBuckets = async () => ({ ok:false, reason:'No permission to read photos.', fixHint:'Allow it on the phone.' });
    await photos.refresh(); })()`,
  apps: `(async () => { window.__a ??= apps.bridge.appsList;
    apps.bridge.appsList = async () => ({ ok:false, reason:'The phone is not sharing its apps.', fixHint:'Open Sidekick on the phone.' });
    await apps.refresh(); })()`,
  /*
   * `fetch` back to idle first. `refresh()` will not refetch a pane that already holds a result,
   * so setting the bridge's failure flag alone left Activity showing its table and the sweep
   * reported `activity/error` as never drawn — the prep doing nothing while reporting nothing.
   */
  /*
   * The bridge's own reader is replaced, not its `failRequest` flag.
   *
   * `failRequest` exists as a key on the real bridge object and **is not honoured by it** — it
   * belongs to the test double. Setting it left `fetch` at `ready`, Activity drew its table, and
   * the sweep reported `activity/error` as never drawn: a driver doing nothing while reporting
   * nothing, which is the third time that shape has appeared in this directory.
   */
  activity: `(async () => { window.__ae ??= activity.bridge.activityEvents;
    activity.bridge.activityEvents = async () => ({ ok: false, reason: 'the log could not be read' });
    activity.fetch = { kind: 'idle' }; await activity.refresh(); })()`,
};

/**
 * The second pass: the `partial` states, which are the other half of what was migrated.
 *
 * Kept separate from the refusals above because a pane cannot be in both at once — a failure
 * outranks a partial notice in every one of them — so driving both in one pass would measure only
 * the first. Two passes, and the kinds actually drawn are reported, so coverage is visible rather
 * than implied by a total.
 */
const DRIVE_EMPTY = {
  activity: `(async () => { window.__ae ??= activity.bridge.activityEvents;
    activity.bridge.activityEvents = async () => ({ ok: true, data: { events: [] } });
    activity.fetch = { kind: 'idle' }; await activity.refresh(); })()`,
};

const DRIVE_PARTIAL = {
  photos: `(() => { photos.setAdvertised(true); photos.setAdvertised(false); })()`,
  apps: `(() => { apps.setAdvertised(true, null); apps.setAdvertised(false, 'The phone is not offering app launching.'); })()`,
};
const UNDRIVE_PARTIAL = `(() => {
  photos.setAdvertised(true);
  apps.setAdvertised(true, null);
})()`;
const UNDRIVE = `(async () => {
  if (window.__r) { files.bridge.fsRoots = window.__r; delete window.__r; await files.refresh(); }
  if (window.__b) { photos.bridge.mediaBuckets = window.__b; delete window.__b; await photos.refresh(); }
  if (window.__a) { apps.bridge.appsList = window.__a; delete window.__a; await apps.refresh(); }
  if (window.__ae) { activity.bridge.activityEvents = window.__ae; delete window.__ae;
    activity.fetch = { kind: 'idle' }; await activity.refresh(); }
})()`;

const routes = await probe.rawEvaluate(`SCREENS.map((s) => s.id)`);
const seen = [];

for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 920], [1100, 700]]) {
    await probe.rawEmulate({ width: w, height: h });
    await probe.rawEvaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    for (const id of routes) {
      await probe.rawEvaluate(`shell.route(${JSON.stringify(id)})`);
      /*
       * Long enough for the route's **own** refresh to finish before a driver replaces the bridge.
       *
       * `shell.onRoute` starts a real `refresh()` on Photos, Files and Apps. At 220ms the driver's
       * fake refusal was installed and rendered, and then the route's own in-flight fetch resolved
       * over the top of it with `failure = null` — so Photos read as having drawn no `permission`
       * state while a direct probe showed one. Two callers of one fetch, resolved by order; this
       * waits for the first rather than racing it.
       */
      await new Promise((r) => setTimeout(r, 1100));
      for (const driver of [DRIVE[id], DRIVE_EMPTY[id], DRIVE_PARTIAL[id]]) {
        if (driver) {
          await probe.rawEvaluate(driver);
          // 260ms was not enough for a pane that refetches over the wire: Photos read as `error`
          // on one pass and `permission` on a direct probe, which is the settle being short rather
          // than the pane disagreeing with itself.
          await new Promise((r) => setTimeout(r, 700));
        }
        const blocks = await probe.rawEvaluate(BLOCKS);
        for (const b of blocks) seen.push({ ...b, route: id, theme, size: `${w}x${h}` });
        if (driver && driver !== DRIVE_PARTIAL[id]) await probe.rawEvaluate(UNDRIVE);
      }
      if (DRIVE_PARTIAL[id]) await probe.rawEvaluate(UNDRIVE_PARTIAL);
      if (DRIVE_EMPTY[id]) await probe.rawEvaluate(UNDRIVE);
    }
    await probe.rawEvaluate(UNDRIVE);
  }
}
/*
 * Put the window back, and **check that it went back**.
 *
 * `Emulation.setDeviceMetricsOverride` is per-target like `DOM` and `CSS`, so an override can
 * outlive the session that set it — and a clear issued from a *later* session does not always
 * undo it. This sweep left the window at `innerWidth 1100 / outerWidth 1440`, and every
 * `shot.mjs` afterwards refused with *"the window is zoomed"*: an instrument that quietly breaks
 * the next instrument. Restarting the app is the only reliable clear, so the failure is reported
 * with that instruction rather than left for somebody to rediscover.
 */
await probe.rawEmulate(null);
await new Promise((r) => setTimeout(r, 300));
const geometry = await probe.rawEvaluate(`({ inner: innerWidth, outer: outerWidth })`);
if (geometry.inner !== geometry.outer) {
  console.log(
    `\n  WARNING: the viewport override did not clear (inner ${geometry.inner} !== outer ` +
      `${geometry.outer}). Every shot.mjs run will refuse until the app is restarted.`,
  );
  failures += 1;
}
await probe.rawEvaluate(`document.documentElement.dataset.theme = 'dark'`);
await probe.rawEvaluate(`shell.route('overview')`);

const kinds = [...new Set(seen.map((b) => b.kind))].sort();
console.log(`\n=== D67: ${seen.length} state blocks drawn, across ${routes.length} routes x 2 themes x 2 sizes ===\n`);
console.log(`  kinds seen: ${kinds.join(', ')}`);
for (const route of [...new Set(seen.map((b) => b.route))]) {
  const here = seen.filter((b) => b.route === route);
  const byKind = [...new Set(here.map((b) => `${b.kind}${here.some((x) => x.kind === b.kind && x.cls.includes('compact')) ? ' (compact)' : ' (full)'}`))];
  console.log(`  ${route.padEnd(14)} ${byKind.join(', ')}`);
}
console.log('');

// The control: a run that drew nothing would pass every rule below vacuously.
verdict('control: state blocks were actually drawn', seen.length > 0, `${seen.length}`);

const thirdMode = seen.filter((b) => b.cls !== 'state-block' && b.cls !== 'state-block compact');
verdict('exactly two layouts, nothing else', thirdMode.length === 0,
  thirdMode.length ? [...new Set(thirdMode.map((b) => b.cls))].join(' | ') : '');

const TONE = { empty:'neutral', loading:'neutral', unavailable:'neutral', permission:'warning',
  blocked:'warning', partial:'warning', wall:'warning', error:'danger' };
const wrongTone = seen.filter((b) => TONE[b.kind] !== b.tone);
verdict('every drawn block matches the approved tone map', wrongTone.length === 0,
  wrongTone.length ? wrongTone.map((b) => `${b.route}/${b.kind}=${b.tone}`).join(', ') : '');

const lime = seen.filter((b) => b.tone === 'live' || b.tone === 'accent');
verdict('no lime on any state', lime.length === 0);

const twoActions = seen.filter((b) => b.actions > 1);
verdict('at most one action', twoActions.length === 0,
  twoActions.length ? twoActions.map((b) => `${b.route}/${b.kind}=${b.actions}`).join(', ') : '');

const wallAction = seen.filter((b) => b.kind === 'wall' && b.actions > 0);
verdict('a wall has no action', wallAction.length === 0);

const notButtons = seen.filter((b) => b.actions > 0 && (b.actionTag !== 'BUTTON' || !b.actionTabbable));
verdict('every action is a real, tabbable <button> — so Enter and Space work', notButtons.length === 0,
  notButtons.length ? notButtons.map((b) => `${b.route}/${b.kind}=${b.actionTag}`).join(', ') : '');

const untyped = seen.filter((b) => b.actions > 0 && b.actionType !== 'button');
verdict('and typed, so it cannot submit a form it happens to sit in', untyped.length === 0);

const clipped = seen.filter((b) => b.actionClipped);
verdict('no action is clipped by its block', clipped.length === 0,
  clipped.length ? clipped.map((b) => `${b.route} @${b.size}`).join(', ') : '');

const over = seen.filter((b) => b.overflows || b.offRight);
verdict('no block overflows or runs off the window', over.length === 0,
  over.length ? over.map((b) => `${b.route} ${b.theme} @${b.size}`).join(', ') : '');

const shape = seen.filter((b) => b.badges !== 1 || b.headlines !== 1);
verdict('one badge and one headline each', shape.length === 0,
  shape.length ? shape.map((b) => `${b.route}/${b.kind} badges=${b.badges} headlines=${b.headlines}`).join(', ') : '');

const themes = new Set(seen.map((b) => b.theme));
verdict('control: both themes were measured', themes.size === 2, [...themes].join(', '));

/*
 * Coverage, stated rather than implied. A run that never drew a `partial` cannot vouch for one,
 * and the five migrated panes are the reason this sweep exists — so their kinds are named and a
 * missing one is a failure, not a silence.
 */
const MIGRATED = { files: ['error', 'empty'], photos: ['permission', 'partial'],
  apps: ['permission', 'partial'], activity: ['error', 'empty'] };
const missing = [];
for (const [route, want] of Object.entries(MIGRATED)) {
  for (const kind of want) {
    if (!seen.some((b) => b.route === route && b.kind === kind)) missing.push(`${route}/${kind}`);
  }
}
verdict('every migrated pane drew the states it was migrated for', missing.length === 0,
  missing.length ? `never drawn: ${missing.join(', ')}` : `${Object.keys(MIGRATED).length} panes`);

console.log(`\n${failures === 0 ? 'ALL READINGS OK' : `${failures} FAILED`}\n`);
await probe.close();
process.exit(failures === 0 ? 0 : 1);
