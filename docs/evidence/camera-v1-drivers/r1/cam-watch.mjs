// Camera v1 supervised sitting: watch both ends once a second, and optionally press the Mac's
// "Ask phone for camera" exactly once. Reads only, apart from that one named press and the route.
// Usage: node cam-watch.mjs <label> <seconds> [request|none] [stopWhen=<regex over Mac text>]
import { execFileSync } from 'node:child_process';
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';

const [label = 'watch', secondsArg = '40', action = 'none', stopArg = ''] = process.argv.slice(2);
const seconds = Number(secondsArg);
const stopWhen = stopArg.startsWith('stopWhen=') ? new RegExp(stopArg.slice(9)) : null;
const REPO = '/Users/chetan/Desktop/ConnectSuite';
const PKG = 'com.chetan.connectsuite.debug';
const t = () => new Date().toTimeString().slice(0, 8);

function phone() {
  const out = execFileSync(`${REPO}/scripts/adb-pinned.sh`, ['samsung', 'shell',
    `dumpsys media.camera | sed -n '/Active Camera Clients/,/^$/p' | tr -s ' \\n' ' '; echo; ` +
    `dumpsys media.camera | grep -c 'package ${PKG}'; ` +
    `dumpsys activity activities | grep topResumedActivity | sed 's/.*u0 //;s/ t[0-9]*}//'`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  const clients = (out[0] || '').match(/Active Camera Clients: (\[[^\]]*\])/);
  return { clients: clients ? clients[1] : `UNREAD(${(out[0] || '').slice(0, 60)})`, ourCameraEvents: Number(out[1]), top: (out[2] || '').trim() };
}

const probe = await openProbe({ port: 9222 });
const NAV = `document.querySelectorAll('[data-nav]').length`;
const MAC = `(function(){
  var s = __probe.one('section[data-screen="camera"]');
  var c = s.querySelector('canvas');
  var r = c ? c.getBoundingClientRect() : null;
  return {
    text: s.innerText.replace(/\\s+/g,' ').trim().slice(0, 260),
    buttons: Array.prototype.map.call(s.querySelectorAll('button'), function(b){ return b.textContent.trim() + (b.disabled ? '(disabled)' : ''); }).join(' | '),
    canvas: c ? { hidden: c.hidden || getComputedStyle(c).display === 'none' || getComputedStyle(c).visibility === 'hidden', w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) } : null
  };
})()`;

const routed = await probe.act({
  what: 'route the Mac to the Camera pane by its nav button',
  run: `document.querySelector('[data-nav="camera"]').click()`,
  expect: `!document.querySelector('section[data-screen="camera"]').hidden`,
  within: 5000,
});
if (!routed.landed) { console.log('NOT A READING: the Camera pane did not open'); probe.close(); process.exit(3); }

async function mac() {
  const r = await probe.read({ question: 'camera pane', control: NAV, read: MAC });
  return r.value;
}

const before = { phone: phone(), mac: await mac() };
console.log(`${t()} [${label}] BEFORE phone=${JSON.stringify(before.phone)}`);
console.log(`${t()} [${label}] BEFORE mac=${JSON.stringify(before.mac)}`);

if (action === 'request') {
  // Gate: exactly one enabled request button, and the pane is not already waiting or live.
  const gate = `(function(){
    var s = document.querySelector('section[data-screen="camera"]');
    var b = Array.prototype.filter.call(s.querySelectorAll('button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()) && !x.disabled; });
    var busy = s.querySelectorAll('button.camera-cancel, button.camera-stop').length;
    return b.length === 1 && busy === 0;
  })()`;
  const ok = await probe.read({ question: 'request gate', control: NAV, read: gate });
  if (!ok.value) { console.log(`${t()} [${label}] REFUSED to press: request button not exactly one enabled, or a request/stream is already open`); probe.close(); process.exit(4); }
  const pressed = await probe.act({
    what: 'press Ask phone for camera, once',
    run: `Array.prototype.filter.call(document.querySelectorAll('section[data-screen="camera"] button.camera-request'), function(x){ return /^(Ask phone for camera|Ask again)$/.test(x.textContent.trim()); })[0].click()`,
    expect: `document.querySelectorAll('section[data-screen="camera"] button.camera-request').length === 0`,
    within: 5000,
  });
  console.log(`${t()} [${label}] PRESSED Ask phone for camera — landed=${pressed.landed}`);
}

let last = '';
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  const p = phone();
  const m = await mac();
  const line = JSON.stringify({ p, m });
  if (line !== last) {
    console.log(`${t()} [${label}] phone clients=${p.clients} ourCameraEvents=${p.ourCameraEvents} top=${p.top}`);
    console.log(`${t()} [${label}]   mac buttons=[${m.buttons}] canvas=${JSON.stringify(m.canvas)}`);
    console.log(`${t()} [${label}]   mac text="${m.text}"`);
    last = line;
  }
  if (stopWhen && stopWhen.test(m.text)) { console.log(`${t()} [${label}] stop condition met: ${stopWhen}`); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`${t()} [${label}] END (watched up to ${seconds}s; this bound is the instrument's, not the product's)`);
probe.close();
process.exit(0);
