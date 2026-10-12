// Opens the Camera pane by its nav row, then validates the driver's page instrument on the IDLE pane:
// install → install again (must replace, never stack) → dispose → dispose again. Reads through probe.mjs.
import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
import { INSTALL_INSTRUMENT, DISPOSE_INSTRUMENT } from '/Users/chetan/Desktop/ConnectSuite/scripts/camera-driver-core.mjs';

const NAV = `document.querySelectorAll('[data-nav]').length`;
const S = `document.querySelector('section[data-screen="camera"]')`;
const probe = await openProbe({ port: 9222 });
const read = async (question, expr) => (await probe.read({ question, control: NAV, read: expr })).value;
const WRAP = `(function(){ var p = camera.painter, proto = Object.getPrototypeOf(p);
  return { ownPaint: Object.prototype.hasOwnProperty.call(p,'paint'), ownDraw: Object.prototype.hasOwnProperty.call(p,'draw'),
    paintIsProto: p.paint === proto.paint, drawIsProto: p.draw === proto.draw,
    tagged: !!(p.paint && p.paint.__camWrapper), instr: typeof window.__camInstr,
    protoMethods: Object.getOwnPropertyNames(proto) }; })()`;
const out = {};
try {
  out.navRows = await read('nav rows', NAV);
  out.nav = await probe.act({
    what: 'open the Camera pane by its nav row',
    run: `(function(){ var b = document.querySelectorAll('[data-nav="camera"]'); if (b.length !== 1) return 'refused ' + b.length; b[0].click(); return 'clicked'; })()`,
    expect: `!!${S} && !${S}.hidden`,
    within: 3000,
  });
  out.paneVisible = await read('camera pane visible', `!${S}.hidden`);
  out.paneState = await read('camera state', `(function(){ var cs = camera.state; return { kind: cs.kind, streamId: cs.streamId || null }; })()`);
  out.requestButtons = await read('request buttons', `Array.prototype.map.call(${S}.querySelectorAll('button.camera-request'), function(b){ return [b.textContent.trim(), b.disabled]; })`);
  out.before = await read('wrapper state before', WRAP);
  out.install1 = await read('install', INSTALL_INSTRUMENT);
  out.afterInstall1 = await read('wrapper after install', WRAP);
  out.install2 = await read('install again', INSTALL_INSTRUMENT);
  out.afterInstall2 = await read('wrapper after second install', WRAP);
  out.dispose1 = await read('dispose', DISPOSE_INSTRUMENT);
  out.afterDispose = await read('wrapper after dispose', WRAP);
  out.dispose2 = await read('dispose again', DISPOSE_INSTRUMENT);
  out.afterDispose2 = await read('wrapper after second dispose', WRAP);
} finally {
  try { probe.close(); } catch {}
}
console.log(JSON.stringify(out, null, 1));
