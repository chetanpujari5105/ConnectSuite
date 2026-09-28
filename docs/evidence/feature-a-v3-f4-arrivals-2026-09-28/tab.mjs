import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync } from 'node:fs';
let p = await openProbe({ port: 9333, window: 'share-window' });
await p.rawEvaluate('location.reload()').catch(() => {}); await new Promise((r) => setTimeout(r, 1500));
p = await openProbe({ port: 9333, window: 'share-window' });
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const o = (c, seq) => ({ offerId: id(c), from: 'Synthetic Phone', name: `synthetic-${c.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq, folder: '~/Downloads/Sidekick', state: 'awaiting-decision', expiresAtMs: T + 600_000, savedAs: null, reason: null, priorCopy: null, receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T + seq * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null });
const TAB = `[...document.querySelectorAll('button, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.checkVisibility({ visibilityProperty: true })).map((e) => (e.closest('li')?.dataset.offerId?.slice(2,3) ?? '') + (e.dataset.action || e.id))`;
const list = []; const out = {};
for (const [c, s] of [['A', 1], ['B', 2], ['C', 3]]) {
  list.push(o(c, s));
  await p.act({ what: c, run: `window.__harness.push(${JSON.stringify({ subject: id(c), offers: list, phone: 'Synthetic Phone', thumb: null })})`, expect: `document.querySelectorAll('#sw-queue > li').length === ${list.length}` });
  await new Promise((r) => setTimeout(r, 1000));
}
await p.rawEvaluate(`document.getElementById('sw-queue').scrollTop = 0; 'x'`); // a person's scroll back to the top: A and B fully in view
const empty = await p.read({ question: 'three waiting, at the top: tab sequence and the slot', control: `document.querySelectorAll('#sw-queue > li').length === 3`,
  settle: { until: (v) => v.more.empty !== undefined, within: 1500, poll: 100 },
  read: `({ tab: ${TAB}, more: { hidden: document.getElementById('sw-more').hidden, empty: document.getElementById('sw-more').dataset.empty, aria: document.getElementById('sw-more').getAttribute('aria-label'), visibility: getComputedStyle(document.getElementById('sw-more')).visibility } })` });
out.threeAtTop = empty.value; console.log('three, at top:', JSON.stringify(empty.value));
await p.rawEvaluate(`document.getElementById('sw').dispatchEvent(new PointerEvent('pointerenter')); 'x'`);
for (const [c, s] of [['D', 4], ['E', 5]]) {
  list.push(o(c, s));
  await p.act({ what: c, run: `window.__harness.push(${JSON.stringify({ subject: id(c), offers: list, phone: 'Synthetic Phone', thumb: null })})`, expect: `document.querySelectorAll('#sw-queue > li').length === ${list.length}` });
}
const full = await p.read({ question: 'five waiting, hovered: tab sequence and the indicator', control: `document.querySelectorAll('#sw-queue > li').length === 5`,
  settle: { until: (v) => v.more.empty === 'false', within: 1500, poll: 100 },
  read: `({ tab: ${TAB}, live: document.getElementById('sw-live').textContent.trim(), more: { tag: document.getElementById('sw-more').tagName, type: document.getElementById('sw-more').type, text: document.getElementById('sw-more').textContent, aria: document.getElementById('sw-more').getAttribute('aria-label'), empty: document.getElementById('sw-more').dataset.empty, visibility: getComputedStyle(document.getElementById('sw-more')).visibility } })` });
out.fiveHovered = full.value; console.log('five, hovered:', JSON.stringify(full.value));
const pressed = await p.act({ what: 'focus the indicator, then activate it', run: `document.getElementById('sw-more').focus(); document.getElementById('sw-more').click()`, expect: `document.activeElement && document.activeElement.dataset.offerId === '${id('E')}'` });
const after = await p.rawEvaluate(`({ active: document.activeElement.getAttribute('aria-label'), tabindex: document.activeElement.getAttribute('tabindex') })`);
out.pressed = { landed: pressed.landed, ...after }; console.log('pressed:', JSON.stringify(out.pressed));
writeFileSync(`${process.env.SHOTS}/f4-tab.json`, JSON.stringify(out, null, 1));
process.exit(0);
