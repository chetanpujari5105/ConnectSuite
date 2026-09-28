import { openProbe, format, formatAct } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync } from 'node:fs';
const SHOTS = process.env.SHOTS;
let p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate('location.reload()').catch(() => {});
await new Promise((r) => setTimeout(r, 1500)); // page reload only; every reading below settles on its own predicate
p = await openProbe({ port: 9333, window: 'share-window' });
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const names = { A: 'synthetic-a.png', B: 'synthetic-b.pdf', C: 'synthetic-c.png', D: 'synthetic-d.jpg', E: 'synthetic-e.png' };
const mimes = { A: 'image/png', B: 'application/pdf', C: 'image/png', D: 'image/jpeg', E: 'image/png' };
const o = (c, seq, over = {}) => ({ offerId: id(c), from: 'Synthetic Phone', name: names[c], mime: mimes[c], bytes: 100_718 + seq * 1000,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null,
  receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T - (6 - seq) * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null, ...over });
const steps = [
  ['1-five-waiting', [o('A', 1), o('B', 2), o('C', 3), o('D', 4), o('E', 5)], 5],
  ['2-receiving-queued-waiting', [o('A', 1, { state: 'receiving', receivedBytes: 50_000 }), o('B', 2, { state: 'queued', filesAhead: 1 }), o('C', 3), o('D', 4, { state: 'queued', filesAhead: 2 }), o('E', 5)], 5],
  ['3-saved-failed-receiving-queued-waiting', [o('A', 1, { state: 'saved', savedAs: names.A, receivedBytes: 101_718 }), o('B', 2, { state: 'failed', canRetry: true, reason: 'checksum', receivedBytes: 102_718 }), o('C', 3), o('D', 4, { state: 'receiving', receivedBytes: 30_000 }), o('E', 5, { state: 'queued', filesAhead: 1 })], 5],
  ['4-ends', [o('A', 1, { state: 'saved', savedAs: names.A, receivedBytes: 101_718 }), o('B', 2, { state: 'failed', canRetry: false, reason: 'checksum' }), o('C', 3, { state: 'declined', reason: 'user' }), o('D', 4, { state: 'cancelled', reason: 'user' }), o('E', 5, { state: 'ended' })], 5],
];
const readCards = (name) => p.read({
  question: `${name}: every card — state, visible text, visible buttons`,
  control: `document.getElementById('sw-queue').checkVisibility()`,
  read: `(() => [...document.getElementById('sw-queue').children].map((el) => ({ id: (el.dataset.offerId || '').slice(2,3), state: el.dataset.state || null,
    aria: el.getAttribute('aria-label'), text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
    buttons: [...el.querySelectorAll('button')].filter((b) => b.checkVisibility()).map((b) => ({ label: b.innerText.trim(), aria: b.getAttribute('aria-label'), action: b.dataset.action || null, disabled: b.disabled, tab: b.tabIndex })),
    progress: (() => { const pb = el.querySelector('[role=progressbar]'); return pb && pb.checkVisibility() ? { now: pb.getAttribute('aria-valuenow'), max: pb.getAttribute('aria-valuemax'), text: pb.getAttribute('aria-valuetext') } : null; })() })))()`,
});
const facts = (name) => p.read({
  question: `${name}: focus, window focus, live region`,
  control: `typeof window.__harness.facts === 'function'`,
  read: `(async () => { const f = await window.__harness.facts(); const a = document.activeElement;
    return { windowFocused: f.focused, visible: f.visible, height: f.bounds.height, docHasFocus: document.hasFocus(), active: a ? (a.id || a.tagName) : null,
      live: document.getElementById('sw-live').textContent.replace(/\\s+/g, ' ').trim(), listLabel: document.getElementById('sw-queue').getAttribute('aria-label'),
      closeLabel: document.getElementById('sw-close').getAttribute('aria-label') }; })()`,
});
const out = { steps: {} };
for (const [name, offers, want] of steps) {
  const a = await p.act({ what: `push ${name}`, run: `window.__harness.push(${JSON.stringify({ subject: null, offers, phone: 'Synthetic Phone', thumb: null })})`,
    expect: `[...document.getElementById('sw-queue').children].map((e) => e.dataset.state).join(',') === ${JSON.stringify(offers.map((x) => x.state).join(','))}` });
  console.log(formatAct(a));
  const c = await readCards(name); const f = await facts(name);
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await p.rawCapture(), 'base64'));
  out.steps[name] = { landed: a.landed, cards: c.value, facts: f.value };
  console.log(format(f).slice(0, 200));
}
// The no-action ends linger out after 8 s with the window unfocused and unhovered; saved stays.
const linger = await p.read({ question: 'after the 8 s linger, unfocused: which cards remain', control: `document.getElementById('sw-queue') !== null`,
  settle: { until: (v) => v.length < 5, within: 12_000, poll: 500 },
  read: `[...document.getElementById('sw-queue').children].map((e) => (e.dataset.offerId || '').slice(2,3) + ':' + e.dataset.state)` });
console.log(format(linger)); out.linger = { value: linger.value, stopped: linger.stopped, waitedMs: linger.waitedMs };
writeFileSync(`${SHOTS}/5-after-linger.png`, Buffer.from(await p.rawCapture(), 'base64'));
out.calls = await p.rawEvaluate('window.__harness.calls()');
writeFileSync(`${SHOTS}/readings2.json`, JSON.stringify(out, null, 1));
process.exit(0);
