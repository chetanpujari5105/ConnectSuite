// One gated press of a named Camera-pane control. Usage: node press.mjs request|switch|stop|waitlive
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
const which = process.argv[2];
const t = () => new Date().toTimeString().slice(0, 8);
const probe = await openProbe({ port: 9222 });
const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const visible = `(!${S}.hidden)`;
const q = (sel) => `Array.prototype.filter.call(${S}.querySelectorAll(${JSON.stringify(sel)}), function(b){ return !b.disabled; })`;
const label = `(function(){ var b = ${S}.querySelector('button.camera-switch'); return b ? b.textContent.trim() : null; })()`;

async function read(expr, question) { return (await probe.read({ question, control: NAV, read: expr })).value; }
function done(code, msg) { console.log(`${t()} [${which}] ${msg}`); probe.close(); process.exit(code); }

if (!(await read(visible, 'pane visible'))) done(4, 'REFUSED: the Camera pane is not the visible pane');

if (which === 'waitlive') {
  const r = await probe.read({ question: 'live?', control: NAV,
    read: `${S}.querySelectorAll('button.camera-stop').length`,
    settle: { until: (v) => v === 1, within: 40000, poll: 500 } });
  done(r.value === 1 ? 0 : 3, `live controls present=${r.value} stopped=${r.stopped}`);
}
if (which === 'request') {
  const ok = await read(`${q('button.camera-request')}.filter(function(b){ return /^(Ask phone for camera|Ask again)$/.test(b.textContent.trim()); }).length === 1 && ${S}.querySelectorAll('button.camera-cancel, button.camera-stop').length === 0`, 'request gate');
  if (!ok) done(4, 'REFUSED: not exactly one enabled request button, or a request/stream is open');
  const a = await probe.act({ what: 'press the request button once', run: `${q('button.camera-request')}[0].click()`,
    expect: `${S}.querySelectorAll('button.camera-request').length === 0`, within: 5000 });
  done(a.landed ? 0 : 3, `PRESSED request — landed=${a.landed}`);
}
if (which === 'switch') {
  const before = await read(label, 'switch label');
  const ok = await read(`${q('button.camera-switch')}.length === 1 && ${S}.querySelectorAll('button.camera-stop').length === 1`, 'switch gate');
  if (!ok || !before) done(4, `REFUSED: no single enabled switch button on a live stream (label=${before})`);
  const a = await probe.act({ what: `press "${before}" once`, run: `${q('button.camera-switch')}[0].click()`,
    expect: `(function(){ var b = ${S}.querySelector('button.camera-switch'); return !!b && b.textContent.trim() !== ${JSON.stringify(before)} && !b.disabled; })()`, within: 8000 });
  done(a.landed ? 0 : 3, `PRESSED "${before}" — landed=${a.landed}, now "${await read(label, 'switch label')}"`);
}
if (which === 'stop') {
  const ok = await read(`${q('button.camera-stop')}.filter(function(b){ return b.textContent.trim() === 'Stop camera'; }).length === 1`, 'stop gate');
  if (!ok) done(4, 'REFUSED: not exactly one enabled Stop camera button');
  const a = await probe.act({ what: 'press Stop camera once', run: `${q('button.camera-stop')}[0].click()`,
    expect: `${S}.querySelectorAll('button.camera-stop').length === 0`, within: 5000 });
  done(a.landed ? 0 : 3, `PRESSED Stop camera — landed=${a.landed}`);
}
done(2, `unknown action ${which}`);
