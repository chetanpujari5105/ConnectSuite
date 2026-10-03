import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
const probe = await openProbe({ port: 9222 });
const r = await probe.read({
  question: 'nav entries and the camera pane',
  control: `document.querySelectorAll('[data-nav]').length`,
  read: `(function(){
    var navs = Array.prototype.slice.call(document.querySelectorAll('[data-nav]')).map(function(n){return n.tagName+':'+n.getAttribute('data-nav')+':'+(n.getAttribute('aria-disabled')||'')+':'+n.className;});
    var cam = document.querySelector('section[data-screen="camera"]');
    return { navs: navs, cameraSection: cam ? { hidden: cam.hidden, text: cam.innerText.slice(0,600), buttons: Array.prototype.map.call(cam.querySelectorAll('button'), function(b){return b.textContent+'|'+b.className+'|disabled='+b.disabled;}) } : null, route: location.hash };
  })()`,
});
console.log(JSON.stringify(r.value, null, 1)); console.log('control', r.control, 'reportable', r.reportable);
probe.close(); process.exit(0);
