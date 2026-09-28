import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
const p = await openProbe({ port: 9333, window: 'share-window' });
const id = (c) => `s-${c.repeat(22)}`; const T = Date.now();
const o = (c, seq, state) => ({ offerId: id(c), from: 'Synthetic Phone', name: `synthetic-${c.toLowerCase()}.png`, mime: 'image/png', bytes: 100_000 + seq, folder: '~/Downloads/Sidekick', state, expiresAtMs: T + 600_000, savedAs: null, reason: state === 'declined' ? 'user' : null, priorCopy: null, receivedBytes: null, canRetry: false, unexpectedName: null, arrivedAtMs: T + seq * 1000, arrivalSeq: seq, queueMode: true, filesAhead: null });
const offers = [o('A', 1, 'declined'), o('B', 2, 'declined'), o('C', 3, 'declined'), o('D', 4, 'awaiting-decision'), o('E', 5, 'awaiting-decision')];
const a = await p.act({ what: 'A, B, C declined; D, E still waiting', run: `window.__harness.push(${JSON.stringify({ subject: null, offers, phone: 'Synthetic Phone', thumb: null })})`, expect: `[...document.querySelectorAll('#sw-queue > li')].filter((e) => e.dataset.state === 'declined').length === 3` });
const r = await p.read({ question: 'capped, no waiting file out of view: the slot', control: `document.querySelectorAll('#sw-queue > li').length === 5`,
  settle: { until: (v) => v.empty === 'true', within: 2000, poll: 100 },
  read: `(() => { const m = document.getElementById('sw-more'); const onS = (c) => __probe.onScreen('#sw-queue > li[data-offer-id="${id('X')}"]'.replace('${id('X')}', 's-' + c.repeat(22))).verdict;
    return { landed: true, hidden: m.hidden, empty: m.dataset.empty, visibility: getComputedStyle(m).visibility, height: Math.round(m.getBoundingClientRect().height), aria: m.getAttribute('aria-label'), text: m.textContent, D: onS('D'), E: onS('E'),
      tab: [...document.querySelectorAll('button, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.checkVisibility({ visibilityProperty: true })).map((e) => (e.closest('li')?.dataset.offerId?.slice(2,3) ?? '') + (e.dataset.action || e.id)) }; })()` });
console.log(a.landed, r.stopped, JSON.stringify(r.value));
const prev = JSON.parse(readFileSync(`${process.env.SHOTS}/f4-tab.json`, 'utf8')); prev.cappedEmpty = { stopped: r.stopped, ...r.value };
writeFileSync(`${process.env.SHOTS}/f4-tab.json`, JSON.stringify(prev, null, 1));
writeFileSync(`${process.env.SHOTS}/f4-slot-empty.png`, Buffer.from(await p.rawCapture(), 'base64'));
process.exit(0);
