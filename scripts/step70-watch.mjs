// Step 70's watcher: wait for the inbound ring, READ the card first, then reject once.
//
// Usage: node scripts/step70-watch.mjs <expected-number-fragment> [minutes]
//   e.g. node scripts/step70-watch.mjs 8800000004 9
//
// ### Why the gate exists
//
// The first version of this script rejected whatever card appeared, immediately after reading it.
// On 2026-08-29 the card that appeared was the *user's own outgoing call* to the second person —
// it read `who="Chetan"`, `status="Dialling · +919800000001"`, six times in a row — and the script
// hung it up anyway, because nothing sat between the reading and the click. The step 70 ring then
// arrived 32 seconds later with nothing watching.
//
// That is the coordinate-clicking rule wearing a new costume: the rule is about not acting on a
// control whose target you have not confirmed, and reading the target and then ignoring what it
// says is the same failure with an extra step. **A check that does not gate the action is
// decoration.** So this script will not click unless the card says `Ringing` and carries the number
// it was told to expect, and it says out loud what it is skipping and why.
import { argv, exit } from 'node:process';
import { gateReasons, skipLine, digits, isCorrectionFor } from './step70-gate.mjs';
import {
  refusalsFor, refusalText, readLock, pidAlive, countCdpClients,
  acquireLock, releaseLock, clearStaleLock, LOCK_PATH, CDP_PORT,
} from './step70-exclusion.mjs';
import { openProbe } from './probe.mjs';

const flags = argv.slice(2).filter((a) => a.startsWith('--'));
const positional = argv.slice(2).filter((a) => !a.startsWith('--'));
const expected = positional[0];
const minutes = Number(positional[1] ?? 9);
const allowBlankNumber = flags.includes('--allow-blank-number');
/** Seconds the ring is held before the reject. See the HOLD comment below. */
const holdSeconds = Number((flags.find((f) => f.startsWith('--hold=')) ?? '--hold=18').slice(7));
/** Refuse the reject unless defect 45's option 4 is seen firing on this ring. */
const requireCorrection = flags.includes('--require-correction');
const skipCdpCheck = flags.includes('--skip-cdp-check');
if (!expected) {
  console.error('usage: node step70-watch.mjs <expected-number-fragment> [minutes] ' +
    '[--allow-blank-number] [--hold=18] [--require-correction] [--skip-cdp-check]');
  exit(2);
}
const wantDigits = digits(expected);
/** Timestamp helper usable by the exclusion block, which runs before `now` is defined below. */
const now0 = () => new Date().toLocaleTimeString('en-GB', { hour12: false }) +
  '.' + String(new Date().getMilliseconds()).padStart(3, '0');
const gateOptions = { allowBlankNumber };

/**
 * ### Exactly one watcher and one driver, enforced rather than agreed
 *
 * This script took no lock and CDP on 9222 accepts any number of clients, so nothing stopped two of
 * these from attaching to the same renderer and both pressing Reject on the same ring. "Never two
 * clicks" was a sentence in a doc and a `break` in one loop; between two processes it was not
 * enforced anywhere.
 *
 * Per CLAUDE.md — a rule that matters enough to write down needs an enforcement point, and if the
 * answer is "someone remembering", it will be broken.
 *
 * **Found by inspection on 2026-08-30, not by a second near-miss.** Two sessions were preparing the
 * same ring; counting peers before arming turned up nine alive, one of them a background agent
 * whose stated purpose was to click a call control. Nothing had gone wrong. Both sessions then
 * wrote a lock independently, at two different paths, which excludes nothing — that near-miss is
 * recorded in `scripts/step70-exclusion.mjs` beside the path it settled on.
 *
 * The predicates and their fixtures are in `scripts/step70-exclusion.mjs` /
 * `step70-exclusion.test.mjs`, out here rather than inline so they can be read and tested without a
 * phone, a lock or a second process — the same reason `gateReasons` came out. This runs **above the
 * `fetch`**, so a refusal costs nothing and touches nothing: no socket to the renderer, no adb, no
 * phone. And it says what it refused and why, because the next person debugging a silent no-op
 * removes the gate to find out.
 */
{
  const stale = clearStaleLock();
  if (stale) console.log(`${now0()}  cleared a stale lock left by pid ${stale.pid} (not running)`);
  const lock = readLock();
  const reasons = refusalsFor({
    lock,
    ownerAlive: lock ? pidAlive(lock.pid) : false,
    cdpClients: skipCdpCheck ? 0 : countCdpClients(),
    skipCdpCheck,
  });
  if (reasons.waived) console.log(`${now0()}  WAIVED: ${reasons.waived}`);
  if (reasons.length) {
    console.error(refusalText(reasons));
    exit(5);
  }
  acquireLock({ startedAt: new Date().toISOString(), expecting: wantDigits, hold: holdSeconds });
  const drop = () => releaseLock();
  process.on('exit', drop);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { drop(); exit(130); });
  }
  console.log(`${now0()}  exclusive: lock ${LOCK_PATH} held by pid ${process.pid}; ` +
    `nothing else attached to :${CDP_PORT}`);
}

/**
 * ### The hold, and why the reject is not immediate
 *
 * Defect 45's first evidence was a **197 ms** call: `begin()` published a blank card, the call
 * ended, and `EXTRA_INCOMING_NUMBER` then arrived with no episode left to attach to. A fast reject
 * reproduces exactly that window and would tell us nothing we do not already know.
 *
 * So the ring is held for `--hold` seconds (18 by default, inside the 15–20 s the step asks for)
 * while the card is read continuously and the phone's own `[calls]` log is tailed, so the moment
 * `EXTRA_INCOMING_NUMBER` lands is recorded *relative to the start of the ring* rather than
 * inferred afterwards. Only then is Reject pressed, once.
 */

/** The phone's `[calls]` log lines, newest last. Read over adb; failure is reported, never fatal. */
async function phoneCallLines() {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('adb', ['shell', 'run-as com.chetan.connectsuite.debug cat files/logs/link.log'],
      { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        resolve(stdout.split('\n').filter((l) => l.includes('[calls]')));
      });
  });
}

// The transport comes from `probe.mjs`, which is the only place in this repo that speaks CDP.
//
// **Only the transport.** The reading loop and the gate below are untouched, deliberately: this
// script hangs up a real call on a real phone, its predicate lives in `step70-gate.mjs` with its
// own fixtures so it can be read and tested without a phone ringing, and rewriting a
// safety-critical loop to adopt a new helper is not a refactor anyone should do casually.
// `rawEvaluate` is used rather than `probe.read` for the same reason — the control here is the
// gate, which is stronger than a probe control and already tested.
//
// `userGesture` is required: the reject is a real click and Chromium treats gestureless clicks
// differently.
let probe;
try {
  probe = await openProbe({ port: 9222, userGesture: true });
} catch (error) {
  console.error(`no Electron page target on :9222 — ${error.message}`);
  exit(2);
}
const evaluate = probe.rawEvaluate;

const READ = `(() => {
  const live = document.getElementById('call-live');
  return {
    hidden: live.classList.contains('hidden'),
    who:    (live.querySelector('.call-who') || {}).textContent || null,
    status: (live.querySelector('.muted.small') || {}).textContent || null,
    answerPresent: !!document.getElementById('call-answer'),
    rejectLabel: (document.getElementById('call-reject') || {}).textContent || null,
  };
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false }) +
  '.' + String(new Date().getMilliseconds()).padStart(3, '0');

// The gate lives in step70-gate.mjs so it can be read and tested without a phone ringing.

console.log(`${now()}  waiting up to ${minutes} min for an inbound ring from …${wantDigits}`);
console.log(`${now()}  will NOT click unless the card reads Ringing AND carries that number`);
if (allowBlankNumber) {
  console.log(`${now()}  --allow-blank-number IS SET: a card reading exactly ` +
    `who="Unknown number" status="Ringing" is accepted without a number, because defect 45 means ` +
    `no inbound card on this build carries one. A card with a DIFFERENT number is still refused.`);
}
console.log(`${now()}  hold before reject: ${holdSeconds}s`);

const deadline = Date.now() + minutes * 60_000;
const skipped = [];
let target = null;

const baseline = (await phoneCallLines()) ?? [];
console.log(`${now()}  phone [calls] log baseline: ${baseline.length} lines` +
  `${baseline.length ? '' : '  (WARNING: adb read failed — the PHONE_STATE timing will be missing)'}`);

while (Date.now() < deadline) {
  const card = await evaluate(READ);
  if (!card.hidden) {
    const why = gateReasons(card, wantDigits, gateOptions);
    if (why.length === 0) { target = card; break; }
    const key = JSON.stringify([card.who, card.status]);
    if (!skipped.includes(key)) {
      skipped.push(key);
      console.log(`${now()}  ${skipLine(card, why)}`);
    }
  }
  await sleep(250);
}

if (!target) {
  console.log(`${now()}  TIMED OUT with no matching inbound ring.`);
  if (skipped.length) console.log(`${now()}  ${skipped.length} other live card(s) were seen and deliberately left alone.`);
  ws.close();
  exit(3);
}

const ringStart = Date.now();
console.log(`${now()}  MATCHED — inbound ring accepted by the gate` +
  (gateReasons(target, wantDigits, gateOptions).waived
    ? `\n${now()}  clause waived: ${gateReasons(target, wantDigits, gateOptions).waived}`
    : ''));

// STEP 2 — hold, and read throughout. Two things come out of this window: the card's own readings,
// and the offset at which the phone takes EXTRA_INCOMING_NUMBER (defect 45). A fast reject would
// reproduce the 197 ms window that produced 45 and would measure nothing.
console.log(`--- holding ${holdSeconds}s, reading the card and tailing the phone's [calls] log ---`);
let lastCardKey = null;
let seenPhoneLines = baseline.length;
/** The defect 45 option 4 line for this episode, if the phone logged one. See requireCorrection. */
let correctionLine = null;
while ((Date.now() - ringStart) / 1000 < holdSeconds) {
  const elapsed = ((Date.now() - ringStart) / 1000).toFixed(1).padStart(5);
  const s = await evaluate(READ);
  const key = JSON.stringify([s.who, s.status, s.hidden, s.answerPresent, s.rejectLabel]);
  if (key !== lastCardKey) {
    lastCardKey = key;
    console.log(`  +${elapsed}s  CARD  hidden=${s.hidden} who=${JSON.stringify(s.who)} ` +
      `status=${JSON.stringify(s.status)} answer=${s.answerPresent} reject=${JSON.stringify(s.rejectLabel)}`);
  }
  if (s.hidden) {
    console.log(`  +${elapsed}s  the call ended on its own during the hold — nothing to click.`);
    break;
  }
  const lines = await phoneCallLines();
  if (lines && lines.length > seenPhoneLines) {
    for (const line of lines.slice(seenPhoneLines)) {
      console.log(`  +${elapsed}s  PHONE ${line.replace(/^\S+\s+I \[calls\] /, '')}`);
      if (isCorrectionFor(line, wantDigits)) correctionLine = line;
    }
    seenPhoneLines = lines.length;
  }
  await sleep(400);
}

// STEP 3 — one click, by id, and only after the gate passes again on a fresh read. The card can
// change under a slow hold, which is exactly why this is re-evaluated here rather than trusted.
// Defect 45 option 4 must be observed working on this ring before the ring is spent on the reject.
// Asked for explicitly: if the correction does not fire, say so instead of proceeding. The reject
// is the destructive half and it is not worth spending on a build whose visible change did not
// happen — and "the line was missing" is a finding, where a reject that went ahead anyway would
// leave nobody able to tell whether option 4 shipped.
if (requireCorrection && !correctionLine) {
  console.log(`${now()}  NOT CLICKING — no 'card corrected in place' line for …${wantDigits} appeared during the hold.`);
  console.log(`${now()}  Option 4 did not fire on this ring. The reject is withheld deliberately;`);
  console.log(`${now()}  the call is still live and untouched. Investigate before spending another.`);
  ws.close();
  exit(6);
}
if (correctionLine) {
  console.log(`${now()}  option 4 confirmed live on this ring:`);
  console.log(`    ${correctionLine.trim()}`);
}

const before = await evaluate(READ);
const stillWhy = gateReasons(before, wantDigits, gateOptions);
if (stillWhy.length > 0) {
  console.log(`${now()}  ABORT — the card changed under us; not clicking.`);
  console.log(`${now()}  ${skipLine(before, stillWhy)}`);
  ws.close();
  exit(4);
}
console.log(`${now()}  gate re-checked immediately before the click: ${JSON.stringify(before.who)} / ` +
  `${JSON.stringify(before.status)}${stillWhy.waived ? ` [${stillWhy.waived}]` : ''}`);
const label = await evaluate(`(() => {
  const b = document.getElementById('call-reject');
  if (!b) return null;
  b.click();
  return b.textContent;
})()`);
console.log(`${now()}  clicked #call-reject once (label was ${JSON.stringify(label)})`);

for (let i = 0; i < 24; i++) {
  await sleep(500);
  if ((await evaluate(READ)).hidden) { console.log(`${now()}  live card cleared`); break; }
}

// STEP 4 — defect 36's answer and its control, gathered here so they land in one transcript.
// `call.reject delivered (…)` is NOT the disposition — it says so itself since defect 40. The
// disposition is `call.ended cN rejected`, and the control is the platform's own call-log row.
await sleep(2000);
const after = await phoneCallLines();
if (after) {
  const fresh = after.slice(seenPhoneLines);
  console.log('--- phone [calls] lines after the click ---');
  for (const line of fresh) console.log(`  ${line}`);
  const ended = fresh.filter((l) => /Call c\d+ ended/.test(l));
  console.log(`--- defect 36: ${ended.length} 'ended' line(s) ---`);
  for (const line of ended) console.log(`  ${line}`);
} else {
  console.log('--- phone log unreadable over adb; read it by hand ---');
}

const { execFile } = await import('node:child_process');
await new Promise((resolve) => {
  execFile('adb', ['shell',
    'content query --uri content://call_log/calls --projection _id:number:type:date:duration:name --sort "date DESC"'],
    { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      console.log('--- defect 36 control: newest call-log rows (type=5 is REJECTED) ---');
      if (err) console.log('  call log unreadable over adb; read it by hand');
      else for (const line of stdout.split('\n').slice(0, 3)) console.log(`  ${line}`);
      resolve();
    });
});
ws.close();
