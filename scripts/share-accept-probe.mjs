/**
 * Accept one phone → Mac share on the receive window — **only after proving it is the expected file**,
 * and time what follows. A gated instrument, never an auto-accept: it acts on one named offer and
 * refuses anything else, saying what it refused and why.
 *
 * Before Accept, every one of these must hold, read from the window and the Mac's own files:
 *   1. the card is waiting for a decision (`#sw` data-state `awaiting-decision`);
 *   2. its title is exactly the expected file name;
 *   3. its meta names exactly the expected byte count;
 *   4. Accept's accessible name says the file comes **from the paired phone** and is saved **to the
 *      expected folder** (`Accept {file} from {phone} and save it to {folder}`);
 *   5. **no bytes moved yet**: the Mac log has no share pull claimed since the offer arrived, and the
 *      receive folder has no entry with that name and no `.sidekick-share` partial.
 * The predicate is evaluated again **in the same evaluation as the click** (CLAUDE.md: a check that
 * does not gate the action is decoration), so a card that changed underneath is not clicked.
 *
 * Usage: node scripts/share-accept-probe.mjs <name> <bytes> <phone> <folder> [--sha <hex>] [--deadline-ms N]
 */
import { openProbe, format } from './probe.mjs';
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [name, bytesArg, phone, folder, ...rest] = process.argv.slice(2);
const bytes = Number(bytesArg);
if (!name || !Number.isFinite(bytes) || !phone || !folder) {
  console.error('usage: share-accept-probe.mjs <name> <bytes> <phone> <folder> [--sha <hex>] [--deadline-ms N]');
  process.exit(2);
}
const opt = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
const expectSha = opt('--sha') ?? null;
const DEADLINE = Number(opt('--deadline-ms') ?? 120000);
const LOG = join(homedir(), 'Library/Application Support/sidekick-desktop/logs/sidekick.log');

const logLines = () => readFileSync(LOG, 'utf8').split('\n');
const folderNames = () => readdirSync(folder);

// The offer line for this file, and nothing claimed since it.
function offerSince() {
  const lines = logLines();
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].includes('share.offer ') && lines[i].includes(` valid: ${bytes} bytes`)) { at = i; break; }
  }
  if (at < 0) return { at, claimed: null, offerId: null };
  const offerId = /share\.offer (\S+) valid/.exec(lines[at])?.[1] ?? null;
  const claimed = lines.slice(at + 1).find((l) => / share \S+ claimed, offset /.test(l)) ?? null;
  return { at, claimed, offerId };
}

// The receive window is created when an offer arrives; wait for its target rather than failing.
let p = null;
for (const until = Date.now() + DEADLINE; !p && Date.now() < until; ) {
  try { p = await openProbe({ port: 9222, window: 'share-window' }); } catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!p) { console.log(`  REFUSED  no receive window within ${DEADLINE} ms — nothing clicked`); process.exit(1); }
// The card names the folder as the person reads it: the home directory as `~`.
const folderLabel = folder.startsWith(homedir() + '/') ? '~' + folder.slice(homedir().length) : folder;
const expected = { name, meta: `(${bytes.toLocaleString('en-US')} bytes)`, from: ` from ${phone} `, to: ` and save it to ${folderLabel}` };

const shown = await p.read({
  question: 'the receive window card, once it is waiting',
  read: `({ state: document.getElementById('sw').dataset.state, eyebrow: document.getElementById('sw-eyebrow').textContent, title: document.getElementById('sw-title').textContent, meta: document.getElementById('sw-meta').textContent, place: document.getElementById('sw-place-value').textContent, accept: document.querySelector('#sw-actions button[data-action="accept"]')?.getAttribute('aria-label') ?? null, buttons: [...document.querySelectorAll('#sw-actions button')].map(b => b.dataset.action) })`,
  control: `document.querySelectorAll('#sw, #sw-title, #sw-actions').length`,
  settle: { until: (v) => v.state === 'awaiting-decision' && v.title === name, within: DEADLINE, poll: 200 },
});
console.log('  ' + format(shown));
if (!shown.reportable) { console.log('  REFUSED  no waiting card for that file before the deadline — nothing clicked'); process.exit(1); }

const before = offerSince();
const names = folderNames();
const problems = [];
if (before.at < 0) problems.push(`no "share.offer … valid: ${bytes} bytes" line in the Mac log`);
if (before.claimed) problems.push(`a pull was already claimed: ${before.claimed.slice(0, 120)}`);
if (names.includes(name)) problems.push(`${name} already exists in ${folder} (a save would be renamed; the check wants a fresh name)`);
if (names.some((n) => n.includes('.sidekick-share'))) problems.push('a share partial is already in the folder');
if (problems.length) { console.log('  REFUSED  ' + problems.join('; ') + ' — nothing clicked'); process.exit(1); }
console.log(`  no bytes moved: offer ${before.offerId} logged, no pull claimed since, ${names.length} entries in ${folder}, none named ${name}`);

// **The product's own gate decides whether the click counts: Accept is honoured only on a visible,
// focused receive window** (shareDecision.ts, acceptAllowed) — the window a person has clicked into.
// Measured 2026-09-29: neither CDP Page.bringToFront (document.hasFocus() read true in the page while the
// main process's isFocused() stayed false) nor a script can produce that focus, and it is not worked
// around here. So this instrument verifies the card and presses Accept; when nobody has focused the
// window, the product refuses, the offer keeps waiting, and the refusal is reported as such.
const clicked = await p.act({
  what: `Accept ${name} — gated in the same evaluation as the click`,
  run: `(() => {
    const e = ${JSON.stringify(expected)};
    const root = document.getElementById('sw');
    const accept = document.querySelector('#sw-actions button[data-action="accept"]');
    const aria = accept?.getAttribute('aria-label') ?? '';
    const why = [];
    if (root.dataset.state !== 'awaiting-decision') why.push('state ' + root.dataset.state);
    if (document.getElementById('sw-title').textContent !== e.name) why.push('title ' + document.getElementById('sw-title').textContent);
    if (!document.getElementById('sw-meta').textContent.includes(e.meta)) why.push('meta ' + document.getElementById('sw-meta').textContent);
    if (!aria.startsWith('Accept ' + e.name) || !aria.includes(e.from) || !aria.endsWith(e.to)) why.push('accept label ' + aria);
    if (!accept || accept.disabled) why.push('no enabled Accept');
    window.__acceptGate = why;
    if (why.length === 0) { window.__acceptT0 = performance.now(); accept.click(); }
    return why.length === 0;
  })()`,
  expect: `(() => (window.__acceptGate?.length ?? 1) > 0 || ['saved','saved-unacknowledged','not-saved','failed','cancelled'].includes(document.getElementById('sw').dataset.state) && (window.__acceptT1 ??= performance.now()) > 0)()`,
  within: DEADLINE,
});
const after = await p.read({
  question: 'what the window says after Accept',
  read: `({ gate: window.__acceptGate, state: document.getElementById('sw').dataset.state, title: document.getElementById('sw-title').textContent, detail: document.getElementById('sw-detail').textContent.slice(0, 200), ms: window.__acceptT1 && window.__acceptT0 ? Math.round(window.__acceptT1 - window.__acceptT0) : null })`,
  control: `document.querySelectorAll('#sw').length`,
});
if (after.value.gate?.length) { console.log('  REFUSED at the click: ' + after.value.gate.join('; ') + ' — nothing clicked'); process.exit(1); }
const decision = logLines().slice(before.at).reverse().find((l) => l.includes('receive window decision') && l.includes(before.offerId ?? '\u0000'));
if (decision && decision.includes('"ok":false')) {
  console.log(`  the Mac refused the Accept: ${/"reason":"([^"]+)"/.exec(decision)?.[1]} — left for a person; nothing moved`);
  process.exit(1);
}
console.log(`  after Accept: state=${after.value.state} in ${after.value.ms} ms (click → window settled) — ${after.value.detail}`);

// The Mac's own record of the pull, from its log: claimed → received/verified/published.
const lines = logLines().slice(before.at);
const pulled = lines.find((l) => / share \S+ received \d+ bytes, flushed, verified, published exclusively as /.test(l));
const claimedLine = lines.find((l) => / share \S+ claimed, offset 0/.test(l));
const t = (l) => (l ? Date.parse(l.slice(0, 29)) : NaN);
if (pulled) {
  const savedAs = / published exclusively as (.+?), and the published name/.exec(pulled)?.[1];
  const ms = t(pulled) - t(claimedLine);
  console.log(`  Mac log: claimed → published ${ms} ms for ${bytes} B = ${(bytes / 1e6 / (ms / 1000)).toFixed(2)} MB/s (claim to verified publish, receiver side)`);
  if (savedAs) {
    const sha = await new Promise((r) => { const h = createHash('sha256'); createReadStream(join(folder, savedAs)).on('data', (c) => h.update(c)).on('end', () => r(h.digest('hex'))); });
    console.log(`  saved as ${savedAs}: sha256 ${sha.slice(0, 16)}…${expectSha ? (sha === expectSha ? ' = the phone’s digest' : ` ≠ the phone’s ${expectSha.slice(0, 16)}… — MISMATCH`) : ''}`);
    if (expectSha && sha !== expectSha) process.exit(1);
  }
} else {
  console.log('  no published line in the Mac log — not saved');
  process.exit(1);
}
process.exit(after.value.state === 'saved' ? 0 : 1);
