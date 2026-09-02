/**
 * What a Mac with no phone paired actually gets today — measured, so the pairing proposal argues
 * from a reading rather than from a memory of the markup.
 *
 * It is **read-only about pairing state**: it never rotates the token, never forgets a device, and
 * never leaves the app on a screen it did not find it on. The route is restored before it exits.
 *
 * Run with the app up:
 *   node scripts/pairing-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
  return result;
};

console.log('\n=== The pairing screen, as it stands ===\n');

// Where the app is now, so it can be put back. A probe that changes the route and leaves it changed
// is a probe that edits the thing it measures.
const before = show(
  await probe.read({
    question: 'which screen is currently drawn',
    read: `(() => { const s=[...document.querySelectorAll('section.screen')].find(x => !x.hidden);
      return s ? s.dataset.screen : null; })()`,
    control: `document.querySelectorAll('section.screen').length`,
  }),
);

// P1 — the pairing screen exists as static markup, and what is in it. Counted, never text-matched.
show(
  await probe.read({
    question: 'the pairing section: cards, controls, and whether it carries a QR image',
    read: `(() => { const s=document.querySelector('section[data-screen="pairing"]');
      if (!s) return null;
      return { hidden: s.hidden,
               cards: s.querySelectorAll('.card').length,
               buttons: s.querySelectorAll('button').length,
               inputs: s.querySelectorAll('input').length,
               hasQr: !!s.querySelector('#qr'),
               headings: [...s.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()) }; })()`,
    control: `document.querySelectorAll('section.screen').length`,
  }),
);

// P2 — the four steps the proposal asks for. Counted as elements: a progress list is a set of rows,
// and the copy explaining pairing contains every one of those words, so a text scan would find them
// in a screen that has none.
show(
  await probe.presence({
    question: 'progress rows on the pairing screen (the proposal asks for four)',
    controls: `section[data-screen="pairing"] [data-step], section[data-screen="pairing"] .pair-step`,
    control: `document.querySelectorAll('section[data-screen="pairing"]').length`,
  }),
);

// P3 — the manual-address escape hatch the proposal wants *on this screen*. It exists in Settings;
// the question is whether it is reachable at the one moment it is needed, which is before there is
// a phone to open Settings about.
show(
  await probe.presence({
    question: 'a manual-address field on the pairing screen itself',
    controls: `section[data-screen="pairing"] input[type="text"], section[data-screen="pairing"] input:not([type])`,
    control: `document.querySelectorAll('section[data-screen="pairing"]').length`,
  }),
);

// P4 — what the shell looks like behind an unpaired Mac. The proposal says the sidebar should render
// dimmed rather than vanish, so the app looks like itself with nothing in it.
show(
  await probe.read({
    question: 'nav rows, dock tiles and the device card while the app is running',
    read: `(() => ({
      navRows: document.querySelectorAll('.nav-row').length,
      dockTiles: document.querySelectorAll('.dock-tile').length,
      deviceCard: !!document.querySelector('.device-card, [data-device-card]'),
    }))()`,
    control: `document.querySelectorAll('.nav-row').length`,
  }),
);

// P5 — the countdown. `armPairing` holds `expiresAt` on the Mac; the proposal's P5 says the renderer
// is simply not told. This is that claim, checked against the drawn screen rather than the source.
show(
  await probe.read({
    question: 'does the pairing screen show any countdown or expiry',
    read: `(() => { const s=document.querySelector('section[data-screen="pairing"]');
      if (!s) return null;
      const text = s.textContent || '';
      return { mentionsRefresh: /refresh|expire|valid for|:\\d\\d/i.test(text),
               noteText: (s.querySelector('#qr-note')?.textContent || '').slice(0, 80) }; })()`,
    control: `document.querySelectorAll('section[data-screen="pairing"]').length`,
  }),
);

// Put the route back exactly where it was found.
if (before.value) {
  const restored = await probe.act({
    what: `restore the route to ${before.value}`,
    run: `(() => { const b=[...document.querySelectorAll('.nav-row')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(String(before.value))}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${before.value}"]');
      return !!s && !s.hidden; })()`,
    within: 4000,
  });
  console.log(`  route restored to ${before.value}: ${restored.landed} (stopped=${restored.stopped})`);
}

console.log(
  `\n${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} — every reading above carries its control\n`,
);
process.exit(failures === 0 ? 0 : 1);
