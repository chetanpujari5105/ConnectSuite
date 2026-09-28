import { openProbe, format, formatAct } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync } from 'node:fs';
const SHOTS = process.env.SHOTS;
let p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate('location.reload()').catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
p = await openProbe({ port: 9333, window: 'share-window' });
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const names = { A: 'synthetic-a.png', B: 'synthetic-b.pdf', C: 'synthetic-c.png' };
const o = (c, seq, over = {}) => ({ offerId: id(c), from: 'Synthetic Phone', name: names[c], mime: 'image/png', bytes: 100_000 + seq,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null,
  receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T - (4 - seq) * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null, ...over });
const push = (offers) => p.act({ what: `push ${offers.map((x) => x.offerId.slice(2, 3) + ':' + x.state).join(' ')}`,
  run: `window.__harness.push(${JSON.stringify({ subject: null, offers, phone: 'Synthetic Phone', thumb: null })})`,
  expect: `[...document.getElementById('sw-queue').children].map((e) => e.dataset.state).join(',') === ${JSON.stringify(offers.map((x) => x.state).join(','))}` });
const calls = () => p.rawEvaluate('window.__harness.calls()');
const since = async (n) => (await calls()).slice(n).filter((c) => !c.startsWith('height:'));
const btn = (c, action) => `document.querySelector('#sw-queue > li[data-offer-id="${id(c)}"] button[data-action="${action}"]')`;
const R = {};
const log = (k, v) => { R[k] = v; console.log(k, '→', JSON.stringify(v).slice(0, 230)); };

console.log(formatAct(await push([o('A', 1), o('B', 2), o('C', 3)])));
const order = await p.read({ question: 'tab sequence: focusable elements in DOM order with tabindex ≥ 0 (NOT a real Tab press)',
  control: `document.querySelectorAll('#sw-queue > li').length === 3`,
  read: `[...document.querySelectorAll('button, [tabindex], a[href], input')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.checkVisibility()).map((e) => (e.closest('li')?.dataset.offerId?.slice(2,3) ?? 'hdr') + ':' + (e.dataset.action || e.id))` });
log('tabOrder', order.value);
const ring = await p.rawForcePseudo({ selector: '#sw-queue button[data-action="accept"]', pseudo: 'focus-visible',
  read: `[...document.querySelectorAll('#sw-queue button[data-action="accept"]')].map((b) => { const s = getComputedStyle(b); return s.outlineStyle + ' ' + s.outlineWidth + ' | ' + s.boxShadow.slice(0, 60); })` });
log('focusVisibleAccept', ring);

let n = (await calls()).length;
let a = await p.act({ what: 'focus and click Accept on C', run: `(${btn('C', 'accept')}).focus(); (${btn('C', 'accept')}).click()`, expect: `true` });
await new Promise((r) => setTimeout(r, 300)); log('acceptC', { landed: a.landed, calls: await since(n) });

n = (await calls()).length;
a = await p.act({ what: 'Escape with nothing focused', run: `document.activeElement && document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  expect: `window.__harness.calls().then((c) => c.slice(${n}).includes('close-window'))` });
log('escapeNoFocus', { landed: a.landed, calls: await since(n), facts: await p.rawEvaluate('window.__harness.facts()') });

console.log(formatAct(await push([o('A', 1), o('B', 2, { state: 'queued', filesAhead: 1 }), o('C', 3, { state: 'receiving', receivedBytes: 1 })])));
n = (await calls()).length;
a = await p.act({ what: 'Escape on a focused queued card', run: `(${btn('B', 'cancel')}).focus(); (${btn('B', 'cancel')}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  expect: `window.__harness.calls().then((c) => c.slice(${n}).includes('close-window'))` });
log('escapeQueued', { landed: a.landed, calls: await since(n) });

console.log(formatAct(await push([o('A', 1), o('B', 2, { state: 'queued', filesAhead: 1 }), o('C', 3, { state: 'receiving', receivedBytes: 1 })])));
n = (await calls()).length;
a = await p.act({ what: 'Escape on a focused waiting card (documented: declines that card only)', run: `(${btn('A', 'decline')}).focus(); (${btn('A', 'decline')}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  expect: `window.__harness.calls().then((c) => c.slice(${n}).some((x) => x.startsWith('decide:')))` });
await new Promise((r) => setTimeout(r, 300)); log('escapeWaiting', { landed: a.landed, calls: await since(n) });

n = (await calls()).length;
const hdr = await p.read({ question: 'header close label while a file waits', control: `document.getElementById('sw-close') !== null`, read: `document.getElementById('sw-close').getAttribute('aria-label')` });
a = await p.act({ what: 'click the header close/Hide', run: `document.getElementById('sw-close').click()`, expect: `window.__harness.calls().then((c) => c.slice(${n}).includes('close-window'))` });
await new Promise((r) => setTimeout(r, 300)); log('headerClose', { label: hdr.value, landed: a.landed, calls: await since(n), facts: await p.rawEvaluate('window.__harness.facts()') });

console.log(formatAct(await push([o('A', 1, { state: 'saved', savedAs: names.A }), o('B', 2, { state: 'declined', reason: 'user' }), o('C', 3, { state: 'expired' })])));
const closes = await p.read({ question: 'finished cards: Close accessible names', control: `document.querySelectorAll('#sw-queue > li').length === 3`,
  read: `[...document.querySelectorAll('#sw-queue button[data-action="close"]')].map((b) => b.getAttribute('aria-label'))` });
log('closeNames', closes.value);
writeFileSync(`${SHOTS}/6-finished-close-names.png`, Buffer.from(await p.rawCapture(), 'base64'));
n = (await calls()).length;
a = await p.act({ what: 'Close on the declined card', run: `(${btn('B', 'close')}).click()`, expect: `!document.querySelector('#sw-queue > li[data-offer-id="${id('B')}"]')` });
log('cardClose', { landed: a.landed, calls: await since(n), left: await p.rawEvaluate(`[...document.querySelectorAll('#sw-queue > li')].map((e) => e.dataset.offerId.slice(2,3) + ':' + e.dataset.state)`) });
writeFileSync(`${SHOTS}/actions.json`, JSON.stringify(R, null, 1));
process.exit(0);
