/**
 * Defect 207 (d) on hardware: with a phone stored, the pairing screen must draw **no** code and offer
 * one action, *Forget <phone>*. Reads computed style (the cascade decides what is on screen), with the
 * pairing section's own nodes as the control. Optional `--press-forget` presses that one button by its
 * label and reads the card again (the owner-approved re-pair of 2026-10-09).
 *
 *   node scripts/pair-remembered-probe.mjs [--press-forget]
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };
const CARD = `(() => {
  const d = (id) => { const n = document.getElementById(id); return n ? getComputedStyle(n).display : 'MISSING'; };
  const offline = document.getElementById('pair-offline');
  const actions = offline ? [...offline.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
  const img = document.getElementById('qr');
  return { title: document.getElementById('pair-title').textContent.trim(), qrDisplay: d('qr'),
    qrHasImage: Boolean(img && img.getAttribute('src')),
    freshButtonDisplay: d('new-qr'), offlineDisplay: d('pair-offline'), actions,
    blockText: offline ? offline.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : null };
})()`;
const CONTROL = `document.querySelectorAll('section[data-screen="pairing"] .pair-card #qr').length`;

const routed = await probe.rawEvaluate(`(() => { shell.route('pairing'); const s = [...document.querySelectorAll('section.screen')].find((x) => !x.hidden); return s ? s.dataset.screen : null; })()`);
console.log('  visible screen after routing: ' + JSON.stringify(routed));
if (routed !== 'pairing' && !(routed && routed.value === 'pairing')) { console.log('  REFUSED: the pairing screen is not the one on screen'); }
const first = show(await probe.read({
  question: 'the pairing card while a phone is stored',
  read: CARD, control: CONTROL,
  // Two clocks: the default markup is the code shape with an empty image, so a settled state is
  // either the remembered card (no code drawn) or a code whose image has arrived.
  settle: { until: (v) => v && ((v.qrDisplay === 'none' && v.actions.length > 0) || (v.qrDisplay === 'block' && v.qrHasImage)), within: 8000 },
}));

if (process.argv.includes('--press-forget')) {
  const label = first.value?.actions?.find((a) => a.startsWith('Forget '));
  if (!first.value || first.value.qrDisplay !== 'none' || !label) {
    console.log(`  REFUSED to press: the card is not in the remembered shape (${JSON.stringify(first.value)})`);
    process.exit(2);
  }
  // Re-read immediately before the click, and click only the button whose label was read.
  const clicked = await probe.rawEvaluate(`(() => {
    const b = [...document.querySelectorAll('#pair-offline button')].filter((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (b.length !== 1) return 'not exactly one: ' + b.length;
    b[0].click(); return 'clicked ' + ${JSON.stringify(label)};
  })()`);
  console.log('  ' + clicked);
  show(await probe.read({
    question: 'the card after Forget',
    read: CARD, control: CONTROL,
    settle: { until: (v) => v && v.qrDisplay === 'block' && v.qrHasImage, within: 10000 },
  }));
}
await probe.close?.();
