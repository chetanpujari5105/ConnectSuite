/**
 * Defect 208 on hardware: switch the Files pane between two roots while the first listing is in flight,
 * in grid view (where thumbnails are asked), several times. The phone's own log and logcat are read
 * separately; this drives the pane by named controls and reports what it drew. The view mode is put
 * back as it was.
 *
 *   node scripts/files-root-switch-probe.mjs "Received files" "DCIM" [rounds]
 */
import { openProbe, format } from './probe.mjs';

const [a, b, roundsArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 4);
const probe = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };
const ROOTS = `[...document.querySelectorAll('#files-roots .files-root')].map((r) => r.querySelector('.files-root-name')?.textContent.trim() ?? r.textContent.trim())`;

await probe.rawEvaluate(`shell.route('files')`);
const roots = show(await probe.read({
  question: 'the shared-folder rail', read: `(${ROOTS})`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-roots').length`,
  settle: { until: (v) => Array.isArray(v) && v.includes(a) && v.includes(b), within: 15000 },
}));
if (!roots.reportable) process.exit(2);
const viewBefore = await probe.rawEvaluate(`document.getElementById('files-view-grid')?.getAttribute('aria-pressed')`);
await probe.rawEvaluate(`document.getElementById('files-view-grid').click()`);
const click = (name) => `(() => { const r = [...document.querySelectorAll('#files-roots .files-root')].filter((x) => (x.querySelector('.files-root-name')?.textContent.trim() ?? x.textContent.trim()) === ${JSON.stringify(name)}); if (r.length !== 1) return 'not exactly one: ' + r.length; r[0].click(); return 'clicked ' + ${JSON.stringify(name)}; })()`;
const started = new Date().toISOString();
for (let i = 0; i < rounds; i += 1) {
  // The second click lands while the first root's listing is in flight — the 208 race.
  const pair = await probe.rawEvaluate(`[${click(a)}, ${click(b)}]`.replace(/^\[/, '(() => [').replace(/\]$/, '])()'));
  console.log(`  round ${i + 1}: ${JSON.stringify(pair)}`);
  await new Promise((r) => setTimeout(r, 2500));
}
show(await probe.read({
  question: `what the grid draws after the last switch to ${b}`,
  read: `(() => ({ tiles: document.querySelectorAll('#files-table .files-tile').length,
    names: [...document.querySelectorAll('#files-table .files-tile')].slice(0, 6).map((t) => t.textContent.trim().slice(0, 40)),
    selectedRoot: [...document.querySelectorAll('#files-roots .files-root')].filter((x) => x.getAttribute('aria-selected') === 'true' || x.classList.contains('selected')).map((x) => x.textContent.trim().slice(0, 30)) }))()`,
  control: `document.querySelectorAll('section[data-screen="files"] #files-table').length`,
  settle: { until: (v) => v && v.tiles > 0, within: 15000 },
}));
console.log(`  started ${started}; grid was pressed before: ${JSON.stringify(viewBefore)}`);
if (String(viewBefore?.value ?? viewBefore) !== 'true') await probe.rawEvaluate(`document.getElementById('files-view-list').click()`);
await probe.close?.();
