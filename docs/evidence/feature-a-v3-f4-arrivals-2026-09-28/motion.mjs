import { openProbe } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
const p = await openProbe({ port: 9333, window: 'share-window' });
const r = await p.read({ question: 'F4 indicator and list: motion properties', control: `document.getElementById('sw-more') !== null && document.querySelector('#sw-queue > li .sw-button') !== null`,
  read: `(() => { const m = getComputedStyle(document.getElementById('sw-more')); const b = getComputedStyle(document.querySelector('#sw-queue > li .sw-button')); const q = getComputedStyle(document.getElementById('sw-queue'));
    return { moreTransition: m.transitionProperty + ' / ' + m.transitionDuration, cardButtonTransition: b.transitionProperty + ' / ' + b.transitionDuration, same: m.transitionProperty === b.transitionProperty && m.transitionDuration === b.transitionDuration, listScrollBehavior: q.scrollBehavior, moreAnimation: m.animationName, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }; })()` });
console.log(JSON.stringify(r.value)); process.exit(0);
