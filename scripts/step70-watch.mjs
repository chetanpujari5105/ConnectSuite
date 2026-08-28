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

const expected = argv[2];
const minutes = Number(argv[3] ?? 9);
if (!expected) {
  console.error('usage: node step70-watch.mjs <expected-number-fragment> [minutes]');
  exit(2);
}
const digits = (s) => (s ?? '').replace(/\D/g, '');
const wantDigits = digits(expected);

const targets = await (await fetch('http://localhost:9222/json')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('no Electron page target on :9222'); exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e9);
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (m.result?.exceptionDetails) reject(new Error(String(m.result.exceptionDetails.exception?.description)));
    else resolve(m.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } }));
});

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

/** The gate. Both halves, and each is a separate reason so the log says which one failed. */
const isTheCallUnderTest = (card) => {
  const reasons = [];
  const text = `${card.who ?? ''} ${card.status ?? ''}`;
  if (!/ringing/i.test(card.status ?? '')) reasons.push(`state is ${JSON.stringify(card.status)}, not Ringing`);
  if (!digits(text).includes(wantDigits)) reasons.push(`number does not contain ${wantDigits}`);
  return reasons;
};

console.log(`${now()}  waiting up to ${minutes} min for an inbound ring from …${wantDigits}`);
console.log(`${now()}  will NOT click unless the card reads Ringing AND carries that number`);

const deadline = Date.now() + minutes * 60_000;
const skipped = [];
let target = null;

while (Date.now() < deadline) {
  const card = await evaluate(READ);
  if (!card.hidden) {
    const why = isTheCallUnderTest(card);
    if (why.length === 0) { target = card; break; }
    const key = JSON.stringify([card.who, card.status]);
    if (!skipped.includes(key)) {
      skipped.push(key);
      console.log(`${now()}  SKIPPING a live card, not touching it — ${why.join('; ')}`);
      console.log(`${now()}    who=${JSON.stringify(card.who)} status=${JSON.stringify(card.status)}`);
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

console.log(`${now()}  MATCHED — inbound ring from the expected number`);

// STEP 2 — read before pressing anything. 35c is only readable while the call is live.
console.log('--- 35c readings, taken live, before any click ---');
for (let i = 0; i < 6; i++) {
  const s = await evaluate(READ);
  console.log(`  ${now()}  who=${JSON.stringify(s.who)}  status=${JSON.stringify(s.status)}  answer=${s.answerPresent}  reject=${JSON.stringify(s.rejectLabel)}`);
  await sleep(300);
}

// STEP 3 — one click, by id, and only after the gate passed.
const before = await evaluate(READ);
if (isTheCallUnderTest(before).length > 0) {
  console.log(`${now()}  ABORT — the card changed under us; not clicking.`);
  ws.close();
  exit(4);
}
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
ws.close();
