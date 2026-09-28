import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
let p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate('location.reload()').catch(() => {}); await new Promise((r) => setTimeout(r, 1500));
p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate(`window.__t = []; addEventListener('resize', () => window.__t.push('resize ' + innerHeight + ' @' + Math.round(performance.now()))); 'ok'`);
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const o = (c, seq) => ({ offerId: id(c), from: 'Synthetic Phone', name: `synthetic-${c.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq, folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null, receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T + seq * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null });
const list = [];
for (const [c, s] of [['A', 1], ['B', 2], ['C', 3]]) {
  list.push(o(c, s));
  await p.rawEvaluate(`window.__t.push('push ${c} @' + Math.round(performance.now()) + ' h=' + innerHeight); window.__harness.push(${JSON.stringify({ subject: id(c), offers: list, phone: 'Synthetic Phone', thumb: null })}); 'x'`);
  if (c !== 'C') await new Promise((r) => setTimeout(r, 1200));
}
const samples = [];
for (const ms of [50, 300, 600, 900, 1500, 2200]) {
  await new Promise((r) => setTimeout(r, ms - (samples.at(-1)?.ms ?? 0)));
  const v = await p.read({ question: `C at ${ms} ms`, control: `document.querySelectorAll('#sw-queue > li').length === 3`,
    read: `(() => { const q = document.getElementById('sw-queue'); const lr = q.getBoundingClientRect(); const c = document.querySelector('#sw-queue > li:last-child').getBoundingClientRect(); return { h: innerHeight, scrollTop: q.scrollTop, sh: q.scrollHeight, ch: q.clientHeight, listBottom: Math.round(lr.bottom), cBottom: Math.round(c.bottom), more: document.getElementById('sw-more').hidden ? null : document.getElementById('sw-more').textContent, avail: screen.availHeight }; })()` });
  samples.push({ ms, ...v.value });
}
for (const s of samples) console.log(JSON.stringify(s));
console.log(JSON.stringify(await p.rawEvaluate('window.__t')));
process.exit(0);
