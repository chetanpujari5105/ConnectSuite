import { openProbe, format, formatAct } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync } from 'node:fs';
let p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate('location.reload()').catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
p = await openProbe({ port: 9333, window: 'share-window' });
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const o = (c, seq, over = {}) => ({ offerId: id(c), from: 'Synthetic Phone', name: `synthetic-${c.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null,
  receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T - (9 - seq) * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null, ...over });
const out = {};
let list = [];
for (const [c, seq] of [['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]) {
  list = [...list, o(c, seq)];
  const a = await p.act({ what: `arrival ${c}`, run: `window.__harness.push(${JSON.stringify({ subject: id(c), offers: list, phone: 'Synthetic Phone', thumb: null })})`,
    expect: `document.querySelectorAll('#sw-queue > li').length === ${list.length}` });
  const r = await p.read({ question: `after ${c} arrives: is the newest card on screen, and where is each`,
    control: `document.querySelectorAll('#sw-queue > li').length === ${list.length}`,
    settle: { until: (v) => v.height > 0, within: 2000, poll: 100 },
    read: `(() => ({ height: window.innerHeight, scrollTop: document.getElementById('sw-queue').scrollTop,
      cards: [...document.querySelectorAll('#sw-queue > li')].map((e) => e.dataset.offerId.slice(2,3) + ':' + JSON.stringify(__probe.onScreen('#sw-queue > li[data-offer-id="' + e.dataset.offerId + '"]'))) }))()` });
  out[c] = { landed: a.landed, ...r.value };
  console.log(c, a.landed, r.stopped, JSON.stringify(r.value).slice(0, 400));
}
writeFileSync(`${process.env.SHOTS}/7-fifth-arrival.png`, Buffer.from(await p.rawCapture(), 'base64'));
writeFileSync(`${process.env.SHOTS}/arrivals.json`, JSON.stringify(out, null, 1));
process.exit(0);
