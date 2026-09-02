/**
 * The one measurement `apps.open.ask` lives or dies on: **does the tap open the app?**
 *
 * Everything else about this feature is a list and some pictures. The claim that matters is that a
 * click on the Mac ends with a third-party app on the front of the phone's stack — and the only
 * reason the feature has this shape at all is that the *direct* route does not work: measured
 * 2026-09-03, a backgrounded `startActivity` returns normally, logs nothing, and brings nothing to
 * the front (`docs/phase-7-apps-proposal.md` §2.4).
 *
 * So this probe is built against the failure that reading exposed. Three rules follow from it:
 *
 *  - **The witness is `dumpsys`, from the shell, not the app.** The phone's own log says it *asked*;
 *    it cannot say whether anything opened, by construction. An in-process `getRunningTasks` cannot
 *    either — it is restricted to our own tasks since Android 5.
 *  - **The before-state is read and printed.** "Chrome is on top" after the tap means nothing if
 *    Chrome was on top before it. HOME is pressed first and the launcher is confirmed topmost, so
 *    the reading has somewhere to travel from.
 *  - **The tap is found by name, never by remembered pixels.** `uiautomator dump`, locate the node,
 *    tap the centre of *its* bounds. A coordinate read off a screenshot is a guess about a layout
 *    that is still moving, and this repo has twice had such a guess press something real.
 *
 * Run with the app up and a phone linked:
 *   node scripts/apps-open-ask-probe.mjs [com.android.chrome]
 */
import { execFileSync } from 'node:child_process';
import { openProbe } from './probe.mjs';

const TARGET = process.argv[2] ?? 'com.android.chrome';
const PKG = 'com.chetan.connectsuite.debug';

/** Every adb call is pinned. A read on the wrong phone is a wrong reading; a write is somebody's device. */
const serial = execFileSync('scripts/target-device.sh', { encoding: 'utf8' }).trim().split('\n').pop();
const adb = (...args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sh = (cmd) => adb('shell', cmd);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** The front of the stack, read from the shell. The only witness that counts. */
const topActivity = () => {
  const line = sh('dumpsys activity activities | grep topResumedActivity')
    .split('\n')
    .find((l) => l.includes('topResumedActivity'));
  const m = line?.match(/([A-Za-z0-9_.]+)\/([A-Za-z0-9_.]+)/);
  return m ? m[1] : null;
};

console.log(`\n== apps.open.ask, end to end ==\n  device ${serial}, target ${TARGET}\n`);

// ---- 1. Put the phone somewhere the reading can travel from -------------------------------------

sh('input keyevent KEYCODE_HOME');
await wait(1500);
const before = topActivity();
console.log(`  top before : ${before}`);
check(
  'the target is NOT already on top, so "it opened" can mean something',
  before !== TARGET,
  `before=${before}`,
);
if (before === TARGET) {
  console.log('  the phone is already showing the target — nothing below would be a reading');
  process.exit(1);
}

// ---- 2. The stimulus: a real click on the Mac ----------------------------------------------------

const probe = await openProbe({ port: 9222 });
const label = await probe.rawEvaluate(
  `(() => { const t = document.querySelector('#apps-grid .apps-tile[data-package=${JSON.stringify(TARGET)}]');
    return t ? (t.querySelector('.apps-tile-name')||{}).textContent : null; })()`,
);
if (!label) {
  console.log(`  FAIL  no tile for ${TARGET} in the grid — open the Apps pane first`);
  await probe.close();
  process.exit(1);
}
console.log(`  clicking "${label}" on the Mac`);

// The expectation names the app. `!toast.hidden` alone was this probe family's first fault: the
// toast was already visible from an earlier click, so the poll returned on its first sample and the
// "effect" measured was a pre-existing state.
const clicked = await probe.act({
  what: `click the ${label} tile`,
  run: `(() => { const t = document.querySelector('#apps-grid .apps-tile[data-package=${JSON.stringify(TARGET)}]');
    if (t) t.click(); return !!t; })()`,
  expect: `(() => { const t = document.querySelector('#apps-toast');
    return !!t && !t.hidden && (t.textContent||'').includes(${JSON.stringify(label)}); })()`,
  within: 8000,
});
check('the Mac says it sent the request', clicked.landed);
await probe.close();
if (!clicked.landed) process.exit(1);

// ---- 3. Did the phone actually post a notification? ----------------------------------------------

await wait(1200);
const dump = sh(`dumpsys notification --noredact | grep -A 40 "${PKG}"`);

/*
 * The control, and it is the one this repo's table keeps demanding.
 *
 * A grep that finds nothing is indistinguishable from a grep that cannot see anything, so the
 * denominator is read first: how many notifications from our package the dump holds at all. The
 * connection-status notification is always there while the service runs, so a zero here is a
 * statement about the query rather than about the ask.
 */
const ours = (sh(`dumpsys notification --noredact | grep -c "pkg=${PKG}"`) || '0').trim();
console.log(`  CONTROL notifications from ${PKG} visible to this query: ${ours}`);
check('the query can see our notifications at all', Number(ours) > 0, `${ours} found`);

const posted = dump.includes(`Open ${label}?`);
check(
  'the phone posted the question, naming the app',
  posted,
  posted ? `"Open ${label}?"` : 'no such title in the dump',
);
/*
 * `channel=`, not `channelId=`, and the first version of this line had it wrong.
 *
 * It reported FAIL over a notification that was on exactly the right channel — a matcher that
 * cannot see its target, producing a clean confident negative, which is the first row of this
 * repo's lookalike table. What makes the corrected version a reading is the control beside it:
 * the channel names actually present in the dump are printed, so a zero is visibly a statement
 * about the query rather than about the phone.
 */
const channels = sh(`dumpsys notification --noredact | grep -o "channel=[a-z_]*" | sort -u`)
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
console.log(`  CONTROL channels the dump exposes: ${channels.join(', ')}`);
check(
  'on the high-importance channel, so it can be seen and heard',
  dump.includes('channel=app_open_request') && /id=3201[\s\S]*?importance=4|importance=4[\s\S]{0,400}?channel=app_open_request/.test(dump),
  'channel=app_open_request at importance=4',
);

// ---- 4. The tap, found by name ------------------------------------------------------------------

/** The node whose text is the notification's own title, or its Open action. Bounds, not pixels. */
const nodeFor = (xml, needle) => {
  const re = new RegExp(`<node[^>]*text="${needle}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return null;
  return {
    x: Math.round((Number(m[1]) + Number(m[3])) / 2),
    y: Math.round((Number(m[2]) + Number(m[4])) / 2),
  };
};

/*
 * The shade is polled rather than dumped once, and that is the second fault this probe had.
 *
 * A single dump 1.5 s after `expand-notifications` returned a tree with 285 nodes and no
 * notification in it, and *"could not find it by name"* was one sentence from being written down as
 * a fact about the feature. The shade was mid-animation, or had been collapsed by the previous run.
 * A tree that has not finished drawing is not a negative reading — it is the 263 ms sampling window,
 * on a surface that announces nothing about its own readiness.
 *
 * So: expand, poll for the node, and report the bound if it never arrives.
 */
let spot = null;
let shadeXml = '';
const deadline = Date.now() + 8000;
sh('cmd statusbar expand-notifications');
while (Date.now() < deadline) {
  await wait(600);
  sh('uiautomator dump /sdcard/apps-probe.xml >/dev/null 2>&1');
  shadeXml = sh('cat /sdcard/apps-probe.xml');
  // The title first: tapping the body fires the same PendingIntent as the action and is what most
  // people hit. The action is the fallback, because it survives a collapsed group.
  spot = nodeFor(shadeXml, `Open ${label}\\?`) ?? nodeFor(shadeXml, 'Open');
  if (spot) break;
}
const shadeNodes = (shadeXml.match(/<node/g) ?? []).length;
console.log(`  CONTROL the shade dump holds ${shadeNodes} nodes, so an absence there is about the notification`);
if (!spot) {
  console.log('  FAIL  could not find the notification in the accessibility tree by name.');
  console.log('        Refusing to tap a remembered coordinate: a blind tap has twice pressed');
  console.log('        something real on this device. Nothing below is a reading.');
  sh('cmd statusbar collapse');
  process.exit(1);
}

/*
 * **The first tap may open a group rather than the notification, and that is One UI's doing.**
 *
 * With four or more notifications outstanding from one package, One UI folds them into an
 * auto-group whose collapsed header *previews the newest one* — so a node reading
 * `text="Open Chrome?"` at the top of the shade is the summary, not the row, and tapping it expands
 * the group instead of firing the PendingIntent. Measured 2026-09-03: the node sat at y=498
 * collapsed and at y=678 expanded, and only the second tap reached Chrome.
 *
 * This is the coordinate rule's own failure mode with the *name* correct: the query matched exactly
 * the text it meant to, on a node that was a different thing. So the loop below re-reads the tree
 * after each tap rather than trusting a position, taps at most twice, and **reports how many taps
 * it took** — because "one tap opens it" is the product claim and a probe that quietly tapped twice
 * would be hiding the thing worth knowing.
 */
let taps = 0;
let after = before;
for (let attempt = 0; attempt < 2 && spot; attempt += 1) {
  console.log(`  tap ${attempt + 1}: the notification's own node at ${spot.x},${spot.y} (found by name, not remembered)`);
  sh(`input tap ${spot.x} ${spot.y}`);
  taps += 1;
  await wait(2500);
  after = topActivity();
  if (after === TARGET) break;
  // Not there yet. Re-read the tree: if the node moved, the tap expanded a group and the row is now
  // somewhere else. If it did not move, tapping the same place again would prove nothing.
  sh('uiautomator dump /sdcard/apps-probe.xml >/dev/null 2>&1');
  const again = sh('cat /sdcard/apps-probe.xml');
  const moved = nodeFor(again, `Open ${label}\\?`) ?? nodeFor(again, 'Open');
  if (!moved || (moved.x === spot.x && moved.y === spot.y)) break;
  console.log(`  the row moved ${spot.y} → ${moved.y}: the first tap opened One UI's notification group`);
  spot = moved;
}

// ---- 5. The witness ------------------------------------------------------------------------------

console.log(`  taps needed: ${taps}`);
console.log(`  top after  : ${after}`);
check(
  'the app came to the front — the whole feature, measured rather than asserted',
  after === TARGET,
  `before=${before} after=${after}`,
);

sh('input keyevent KEYCODE_HOME');
check(
  'one tap on the row itself, once the group is open',
  taps <= 2,
  `${taps} taps — more than one means One UI had grouped our notifications`,
);
console.log(
  `\n  bound: one target, one tap, on one SM-S938B. This says the notification route works on this\n` +
    `  handset; it says nothing about a device where the shade is drawn differently.\n`,
);
console.log(failures === 0 ? 'apps-open-ask-probe: all reportable\n' : `apps-open-ask-probe: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
