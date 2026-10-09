/**
 * Cancel one phone → Mac share **mid-transfer**, from the receive window, and prove nothing was published.
 * A person presses Accept (the product only honours Accept on a window a person focused — see
 * share-accept-probe.mjs); this instrument waits for that same card to be **receiving**, then presses
 * its Cancel. Cancel carries no focus gate (main.ts `share-cancel`), so the probe can land it a few
 * hundred milliseconds into a transfer no hand could catch (462 Mbit/s measured 2026-10-09).
 *
 * The click is gated in the same evaluation as the click: state `receiving`, title exactly the expected
 * name, an enabled Cancel. A card that finished first is reported as **TOO LATE** — a published file is
 * not a cancel reading, and the probe says so rather than calling it one.
 *
 * Pass, all of: the window settles on `cancelled`; the Mac log says
 * `share … cancelled on this Mac while receiving (R of N bytes received)` with R < N; the receive folder
 * gained no entry with that stem and no `.sidekick-share` partial. The phone's half is read separately.
 *
 * Usage: node scripts/share-cancel-probe.mjs <name> <bytes> <folder> [--log <path>] [--deadline-ms N]
 */
import { openProbe, format } from './probe.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [name, bytesArg, folder, ...rest] = process.argv.slice(2);
const bytes = Number(bytesArg);
if (!name || !Number.isFinite(bytes) || !folder) {
  console.error('usage: share-cancel-probe.mjs <name> <bytes> <folder> [--log <path>] [--deadline-ms N]');
  process.exit(2);
}
const opt = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
const DEADLINE = Number(opt('--deadline-ms') ?? 300000);
// How far in to cancel. 0 cancels at the first `receiving` poll — measured 2026-10-09 to land before the
// bulk socket claims anything (0 bytes, no partial ever on disk), which is a different case from a
// cancel with bytes on disk. The default waits for real bytes so the partial-cleanup path runs.
const AT = Number(opt('--at-fraction') ?? 0.3);
console.log(`  cancel when: received >= ${AT} of ${bytes} bytes (from the card's progressbar aria-valuenow)`);
// The development app's profile since 2026-10-09 (defect 207 b). Printed, so a reader knows which log answered.
const LOG = opt('--log') ?? join(homedir(), 'Library/Application Support/sidekick-desktop-dev/logs/sidekick.log');
console.log(`  log read: ${LOG}`);
const logLines = () => readFileSync(LOG, 'utf8').split('\n');
const startLine = logLines().length;
// What this run added: entries present after but not before whose name carries the file's stem (a
// collision-renamed `stem (2).ext` counts) or a `.sidekick-share` partial. Older files with the same name
// are left alone and are not evidence either way.
const stem = name.replace(/\.[^.]+$/, '');
const before = new Set(readdirSync(folder));
const leftovers = () => readdirSync(folder).filter((n) => !before.has(n) && (n.includes(stem) || n.includes('.sidekick-share')));
if ([...before].some((n) => n.includes('.sidekick-share'))) { console.log('  REFUSED  a share partial is already in the folder — nothing clicked'); process.exit(1); }
console.log(`  folder before: ${before.size} entries; already holding ${[...before].filter((n) => n.includes(stem)).join(', ') || 'nothing with this stem'}`);

let p = null;
for (const until = Date.now() + DEADLINE; !p && Date.now() < until; ) {
  try { p = await openProbe({ port: 9222, window: 'share-window' }); } catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!p) { console.log(`  REFUSED  no receive window within ${DEADLINE} ms — nothing clicked`); process.exit(1); }

// The window has two layouts (shareWindow.ts): one offer draws the single card (`#sw` carries its state);
// two or more draw a queue (`#sw` reads `queue`, `#sw-one` is hidden, each `li.sw-card` carries its own
// `data-offer-id` and `data-state`). Found 2026-10-09: the first version read only the single layout and
// waited, silently, while the file it existed to cancel was saved in full under a queue card. CARDS reads
// both, and the target is the card for this name that was NOT on screen when the probe attached — two
// saved cards of the same name were already there.
const CARDS = `(() => {
  const root = document.getElementById('sw');
  if (root.dataset.state === 'queue') return [...document.querySelectorAll('#sw-queue li.sw-card')].map((el) => ({ id: el.dataset.offerId, state: el.dataset.state, title: el.querySelector('.sw-title').textContent, progress: el.querySelector('.sw-progress-label').textContent, received: Number(el.querySelector('.sw-progress').getAttribute('aria-valuenow') ?? 0), detail: el.querySelector('.sw-detail').textContent.slice(0, 200), layout: 'queue' }));
  if (root.dataset.state === 'none') return [];
  const any = document.querySelector('#sw-actions button[data-offer-id]');
  return [{ id: any ? any.dataset.offerId : null, state: root.dataset.state, title: document.getElementById('sw-title').textContent, progress: document.getElementById('sw-progress-label').textContent, received: Number(document.getElementById('sw-progress').getAttribute('aria-valuenow') ?? 0), detail: document.getElementById('sw-detail').textContent.slice(0, 200), layout: 'one' }];
})()`;
const atAttach = await p.read({ question: 'cards on screen when the probe attached', read: CARDS, control: `document.querySelectorAll('#sw, #sw-queue, #sw-one').length` });
const known = new Set(atAttach.value.map((c) => c.id));
console.log(`  at attach: ${atAttach.value.length} card(s) — ${atAttach.value.map((c) => `${c.title} ${c.state}`).join('; ') || 'none'}`);
const target = (cards) => cards.find((c) => c.title === name && c.id !== null && !known.has(c.id)) ?? null;
const TERMINAL = ['saved', 'saved-unacknowledged', 'not-saved', 'failed', 'cancelled'];

const receiving = await p.read({
  question: 'the new card for this file, once a person has accepted it and bytes are moving',
  read: CARDS,
  control: `document.querySelectorAll('#sw, #sw-queue, #sw-one').length`,
  settle: { until: (v) => { const t = target(v); return t !== null && ((t.state === 'receiving' && t.received >= AT * bytes) || TERMINAL.includes(t.state)); }, within: DEADLINE, poll: 50 },
});
const seen = target(receiving.value);
console.log(`  first seen: ${JSON.stringify(seen)}  [${receiving.stopped ?? ''} polls=${receiving.polls ?? '?'}]`);
if (!receiving.reportable || !seen) { console.log('  REFUSED  no new card for this file reached receiving before the deadline — nothing clicked'); process.exit(1); }
if (seen.state !== 'receiving') { console.log(`  TOO LATE  the new card was already ${seen.state} when first seen — not a cancel reading; nothing clicked`); process.exit(1); }

await p.act({
  what: `Cancel ${name} (${seen.id}) mid-transfer — gated in the same evaluation as the click`,
  run: `(() => {
    const id = ${JSON.stringify(seen.id)};
    const cancel = [...document.querySelectorAll('button[data-action="cancel"]')].find((b) => b.dataset.offerId === id) ?? null;
    const card = ${CARDS}.find((c) => c.id === id);
    const why = [];
    if (!card) why.push('card gone');
    else {
      if (card.state !== 'receiving') why.push('state ' + card.state);
      if (card.title !== ${JSON.stringify(name)}) why.push('title ' + card.title);
      if (card.received < ${AT * bytes}) why.push('only ' + card.received + ' bytes in');
    }
    if (!cancel || cancel.disabled) why.push('no enabled Cancel for this offer');
    window.__cancelGate = why;
    window.__cancelAt = card ? card.progress : null;
    if (why.length === 0) cancel.click();
    return why.length === 0;
  })()`,
  expect: `(() => (window.__cancelGate?.length ?? 1) > 0 || ${JSON.stringify(TERMINAL)}.includes((${CARDS}.find((c) => c.id === ${JSON.stringify(seen.id)}) ?? {}).state))()`,
  within: 30000,
});
const after = await p.read({
  question: 'what this card says after Cancel',
  read: `({ gate: window.__cancelGate, progressAtClick: window.__cancelAt, card: ${CARDS}.find((c) => c.id === ${JSON.stringify(seen.id)}) ?? null })`,
  control: `document.querySelectorAll('#sw').length`,
});
console.log('  ' + format(after));
if (after.value.gate?.length) { console.log('  REFUSED at the click: ' + after.value.gate.join('; ') + ' (TOO LATE if the state is saved) — nothing clicked'); process.exit(1); }
after.value.state = after.value.card?.state;

await new Promise((r) => setTimeout(r, 1500)); // let the Mac's log flush; the reading below names what it found
const lines = logLines().slice(startLine);
const cancelled = lines.find((l) => / share \S+ cancelled on this Mac while receiving \(\d+ of \d+ bytes received\)/.test(l)) ?? null;
const m = cancelled ? /\((\d+) of (\d+) bytes received\)/.exec(cancelled) : null;
const published = lines.find((l) => l.includes('published exclusively as') && l.includes(stem)) ?? null;
const left = leftovers();
console.log(`  Mac log since start (${lines.length} lines): ${cancelled ? cancelled.slice(0, 200) : 'NO cancel line'}`);
console.log(`  published line: ${published ? published.slice(0, 160) : 'none'}`);
console.log(`  ${folder}: ${left.length ? 'NEW ' + left.join(', ') : `nothing new with this stem, no partial`} (${readdirSync(folder).length} entries listed — control: the folder was read)`);
const pass = after.value.state === 'cancelled' && m && Number(m[1]) < Number(m[2]) && (AT === 0 || Number(m[1]) > 0) && Number(m[2]) === bytes && !published && left.length === 0;
console.log(pass ? `  PASS  cancelled at ${m[1]} of ${m[2]} bytes (${Number(m[1]) > 0 ? 'mid-transfer, bytes were on disk' : 'before the first byte'}); nothing published, no partial left` : '  FAIL  see the lines above');
process.exit(pass ? 0 : 1);
