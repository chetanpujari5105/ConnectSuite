import { openProbe, format, formatAct } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync } from 'node:fs';
const SHOTS = process.env.SHOTS;
const id = (c) => `s-${c.repeat(22)}`;
const o = (c, seq, T) => ({ offerId: id(c), from: 'Synthetic Phone', name: `synthetic-${c.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq,
  folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null,
  receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T + seq * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null });
const out = {};
async function fresh() {
  let p = await openProbe({ port: 9333, window: 'share-window' });
  await p.rawEvaluate('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  return openProbe({ port: 9333, window: 'share-window' });
}
const STATE = `(async () => { const f = await window.__harness.facts(); const q = document.getElementById('sw-queue'); const m = document.getElementById('sw-more');
  const cards = [...q.children].map((e) => { const r = __probe.onScreen('#sw-queue > li[data-offer-id="' + e.dataset.offerId + '"]'); return e.dataset.offerId.slice(2,3) + ':' + r.verdict + ':' + r.atRest.fraction.toFixed(2); });
  const mv = m.hidden ? null : { text: m.textContent, aria: m.getAttribute('aria-label'), onScreen: __probe.onScreen('#sw-more').verdict };
  return { innerH: window.innerHeight, windowH: f.bounds.height, windowFocused: f.focused, docHasFocus: document.hasFocus(), active: document.activeElement ? (document.activeElement.dataset?.offerId?.slice(2,3) || document.activeElement.id || document.activeElement.tagName) : null, scrollTop: q.scrollTop, cards, more: mv }; })()`;
async function arrive(p, list, c, seq, T) {
  list.push(o(c, seq, T));
  const a = await p.act({ what: `arrival ${c}`, run: `window.__harness.push(${JSON.stringify({ subject: id(c), offers: list, phone: 'Synthetic Phone', thumb: null })})`,
    expect: `document.querySelectorAll('#sw-queue > li').length === ${list.length}` });
  const r = await p.read({ question: `after ${c}: the newest card, the list, the indicator`, control: `document.querySelectorAll('#sw-queue > li').length === ${list.length}`,
    settle: { until: (v) => v.innerH === v.windowH && (v.windowH === 560 || v.innerH > 0), within: 3000, poll: 150 }, read: STATE });
  return { landed: a.landed, stopped: r.stopped, ...r.value };
}
for (const mode of ['idle', 'hovered', 'wheel']) {
  const p = await fresh(); const T = Date.now(); const list = []; const rows = [];
  for (const [c, seq] of [['A', 1], ['B', 2], ['C', 3]]) rows.push([c, await arrive(p, list, c, seq, T)]);
  if (mode === 'hovered') await p.rawEvaluate(`document.getElementById('sw').dispatchEvent(new PointerEvent('pointerenter')); 'synthetic pointerenter'`);
  if (mode === 'wheel') await p.rawEvaluate(`document.getElementById('sw-queue').dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true })); 'synthetic wheel, deltaY 0'`);
  rows.push(['D', await arrive(p, list, 'D', 4, T)]);
  if (mode === 'wheel') await new Promise((r) => setTimeout(r, 1700)); // past the 1.5 s quiet period, on purpose: the next arrival must reveal
  rows.push(['E', await arrive(p, list, 'E', 5, T)]);
  // let the scroll event from a reveal prune the indicator
  const settled = await p.read({ question: `${mode}: settled after the 5th`, control: `document.querySelectorAll('#sw-queue > li').length === 5`, settle: { until: () => true, within: 1, poll: 1 }, read: STATE });
  rows.push(['settled', settled.value]);
  writeFileSync(`${SHOTS}/f4-${mode}-after-5th.png`, Buffer.from(await p.rawCapture(), 'base64'));
  if (mode === 'hovered') {
    const click = await p.act({ what: 'press the indicator', run: `document.getElementById('sw-more').click()`, expect: `document.activeElement && document.activeElement.dataset && document.activeElement.dataset.offerId === '${id('E')}'` });
    const after = await p.read({ question: 'after pressing the indicator', control: `document.querySelectorAll('#sw-queue > li').length === 5`, settle: { until: (v) => v.cards[4].includes(':visible:'), within: 2000, poll: 100 }, read: STATE });
    rows.push(['indicator-pressed', { landed: click.landed, stopped: after.stopped, ...after.value }]);
    writeFileSync(`${SHOTS}/f4-hovered-after-indicator.png`, Buffer.from(await p.rawCapture(), 'base64'));
    await p.rawEvaluate(`document.getElementById('sw').dispatchEvent(new PointerEvent('pointerleave')); 'x'`);
  }
  out[mode] = Object.fromEntries(rows);
  console.log('== ' + mode); for (const [k, v] of rows) console.log(k, JSON.stringify(v).slice(0, 520));
}
out.calls = await (await openProbe({ port: 9333, window: 'share-window' })).rawEvaluate('window.__harness.calls()');
writeFileSync(`${SHOTS}/f4-readings.json`, JSON.stringify(out, null, 1));
console.log('non-height calls:', JSON.stringify(out.calls.filter((c) => !c.startsWith('height'))));
process.exit(0);
