/**
 * Pause a block pull from the Mac's Files pane, then cancel the paused copy — B10 of
 * docs/beta-hardware-plan-2026-10-09.md (the phone must log the stop at I as "stopped", not E). Every
 * press is by id, re-read immediately before it; nothing is pressed if the screen is not as expected.
 *
 *   node scripts/pull-pause-probe.mjs <root label> <file name>
 */
import { openProbe, format } from './probe.mjs';

const [rootLabel, fileName] = process.argv.slice(2);
const probe = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };
const byLabel = (label) => `(() => { const L = ${JSON.stringify(label)}; const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === L && x.offsetParent !== null); if (b.length !== 1) return 'not exactly one visible ' + L + ': ' + b.length; b[0].click(); return 'pressed ' + L; })()`;
const press = async (id) => probe.rawEvaluate(`(() => { const b = document.querySelectorAll('#${id}'); if (b.length !== 1) return 'not exactly one #${id}: ' + b.length; if (b[0].disabled) return '#${id} disabled'; b[0].click(); return 'pressed #${id}'; })()`);

await probe.rawEvaluate(`shell.route('files')`);
const ROOT = `[...document.querySelectorAll('#files-roots .files-root')].filter((x) => (x.querySelector('.files-root-name')?.textContent.trim() ?? x.textContent.trim()) === ${JSON.stringify(rootLabel)})`;
show(await probe.read({ question: `the ${rootLabel} root is in the rail`, read: `${ROOT}.length`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-roots').length`, settle: { until: (v) => v === 1, within: 15000 } }));
await new Promise((r) => setTimeout(r, 1000)); // the route's own refresh() settles before the click
console.log('  root click: ' + await probe.rawEvaluate(`(() => { const r = ${ROOT}; if (r.length !== 1) return 'not exactly one: ' + r.length; r[0].click(); return 'clicked'; })()`));
const ITEM = `[...document.querySelectorAll('#files-table .files-row, #files-table .files-tile')].filter((x) => (x.querySelector('.files-name, .files-tile-name')?.textContent.trim() ?? '') === ${JSON.stringify(fileName)} || x.getAttribute('aria-label')?.startsWith(${JSON.stringify(fileName)}))`;
const listed = show(await probe.read({
  question: `${fileName} is listed under ${rootLabel}`, read: `${ITEM}.length`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-table').length`,
  settle: { until: (v) => v === 1, within: 15000 },
}));
if (!listed.reportable) { console.log('  REFUSED: the file is not exactly once on screen'); process.exit(2); }
console.log('  ' + await probe.rawEvaluate(`(() => { const x = ${ITEM}; x[0].click(); return 'clicked ' + ${JSON.stringify(fileName)}; })()`));
const pauseOffered = (within) => probe.read({
  question: 'Pause is offered for the running pull', read: `document.querySelectorAll('#files-pull-pause').length`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-detail').length`,
  settle: { until: (v) => v === 1, within },
});
let running = await pauseOffered(4000);
if (!running.reportable) {
  // A copy is already on this Mac, so a click selects it; Copy again keeps that copy unless the new one
  // arrives whole (defect 163), so a stopped attempt leaves no new file.
  console.log('  no pull from the click; ' + await probe.rawEvaluate(byLabel('Copy again')));
  running = await pauseOffered(20000);
}
show(running);
if (!running.reportable) process.exit(3);
await new Promise((r) => setTimeout(r, 1500)); // let bytes flow so the stop lands mid-stream
if (process.argv.includes('--disconnect')) {
  // The 2026-10-08 stop: the person presses Disconnect mid-pull (Settings → Connection).
  await probe.rawEvaluate(`shell.route('settings', 'connection')`);
  await new Promise((r) => setTimeout(r, 300));
  console.log('  ' + await probe.rawEvaluate(byLabel('Disconnect')) + ' at ' + new Date().toISOString());
  await new Promise((r) => setTimeout(r, 2000));
  await probe.rawEvaluate(`shell.route('files')`);
  await probe.rawEvaluate(`(() => { const x = ${ITEM}; if (x.length === 1) x[0].click(); return x.length; })()`);
}
else console.log('  ' + await press('files-pull-pause') + ' at ' + new Date().toISOString());
show(await probe.read({
  question: 'the pane says the copy is paused', read: `document.getElementById('files-pull-paused')?.textContent.trim().slice(0, 160) ?? null`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-detail').length`,
  settle: { until: (v) => typeof v === 'string' && v.length > 0, within: 15000 },
}));
console.log('  ' + await press('files-pull-cancel-paused'));
show(await probe.read({
  question: 'the paused copy is gone', read: `document.querySelectorAll('#files-pull-paused, #files-pull-cancel-paused').length`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-detail').length`,
  settle: { until: (v) => v === 0, within: 15000 },
}));
if (process.argv.includes('--disconnect')) {
  await probe.rawEvaluate(`shell.route('settings', 'connection')`);
  await new Promise((r) => setTimeout(r, 300));
  console.log('  ' + await probe.rawEvaluate(byLabel('Connect')));
  await probe.rawEvaluate(`shell.route('files')`);
}
await probe.close?.();
