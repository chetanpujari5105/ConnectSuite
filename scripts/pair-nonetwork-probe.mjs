/**
 * Pairing's *No network* shape (`34:12152`), read in the browser rather than in the DOM double.
 *
 * ### Why this probe exists at all, when `pairCard.test.ts` covers the same transition
 *
 * Because the double cannot see a cascade, and `qr.hidden = true` is a claim about one.
 * `styles.css` carries `.pair-card #qr { display: block }`; an author `display` on an id would
 * beat the user agent's `[hidden] { display: none }`, and the unit test — which records the
 * attribute and has no cascade in it — would be green over a QR code still on screen. That is
 * `domDouble.testkit.ts`' own caveat: *"a bug in browser semantics — cascade order, layout,
 * focus — is invisible here and always will be."*
 *
 * **It turned out not to be wrong, and the run that says so is the point.** A `[hidden]` companion
 * was added to `styles.css` on that reasoning, then removed and this probe re-run: `qrDisplay`
 * read `"none"` either way, because `shell.css` line 41 already declares
 * `[hidden] { display: none !important }` globally. The hypothesis was refuted by its own control,
 * and the line came back out. The probe stays, because what it asserts is not the hypothesis — it
 * is that the code is *actually off the screen*, by computed style, whatever makes that true.
 *
 * ### The stimulus is synthetic, and labelled
 *
 * This Mac is on a network, so the state cannot be produced by unplugging anything without ending
 * the session that is reading it. The card is driven by calling the **production** `applyPairCard`
 * with `pairCardView(false)` — the real function, the real nodes, the real stylesheet — and put
 * back to whatever shape the live reachability says it should be before exiting.
 *
 * Run with the app up:
 *   node scripts/pair-nonetwork-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
  return result;
};

/** The card's five measurable facts, computed rather than asserted from attributes. */
const CARD = `(() => {
  const d = (id) => { const n = document.getElementById(id); return n ? getComputedStyle(n).display : 'MISSING'; };
  const offline = document.getElementById('pair-offline');
  return {
    title: document.getElementById('pair-title').textContent.trim(),
    qrDisplay: d('qr'),
    noteDisplay: d('qr-note'),
    subDisplay: d('pair-sub'),
    offlineDisplay: d('pair-offline'),
    freshButtonDisplay: d('new-qr'),
    stateBlocks: offline ? offline.querySelectorAll('.state-block').length : 0,
    stateTone: offline?.querySelector('.state-block')?.dataset.tone ?? null,
    offlineActions: offline ? offline.querySelectorAll('button').length : 0,
    firstStep: document.querySelector('.pair-step .pair-step-label')?.textContent.trim() ?? null,
    firstStepState: document.querySelector('.pair-step')?.dataset.state ?? null,
  };
})()`;

/** The control: the pairing section is the one being read, and it has the nodes this asks about. */
const CONTROL = `document.querySelectorAll('section[data-screen="pairing"] .pair-card #qr').length`;

console.log('\n=== Pairing · No network (34:12152) — computed style, not attributes ===\n');

const before = show(
  await probe.read({
    question: 'which screen is drawn now, so the probe can put it back',
    read: `(() => { const s=[...document.querySelectorAll('section.screen')].find(x => !x.hidden);
      return s ? s.dataset.screen : null; })()`,
    control: `document.querySelectorAll('section.screen').length`,
  }),
);

await probe.rawEvaluate(`window.__shell?.route?.('pairing') ?? (globalThis.shell && shell.route('pairing'))`);

console.log('\n-- the code shape, as the live network gives it --\n');
show(
  await probe.read({
    question: 'the card with an address: the QR is displayed and nothing explains an absence',
    read: CARD,
    control: CONTROL,
    settle: { until: (v) => v && v.qrDisplay !== 'MISSING', within: 4000 },
  }),
);

console.log('\n-- SYNTHETIC: the same nodes driven into the no-network shape --\n');
await probe.rawEvaluate(`applyPairShape(false)`);
const off = show(
  await probe.read({
    question: 'with no address: is the code actually off the screen, by computed display',
    read: CARD,
    control: CONTROL,
  }),
);

console.log('\n-- back to the code shape, on the same nodes --\n');
await probe.rawEvaluate(`applyPairShape(true)`);
const back = show(
  await probe.read({
    question: 'the transition runs both ways: the plate is displayed again and the explanation is gone',
    read: CARD,
    control: CONTROL,
  }),
);

// The verdicts, stated against the readings rather than inferred from them.
const v = [
  ['the QR is not displayed with no address', off.value.qrDisplay === 'none'],
  ['nor is its note', off.value.noteDisplay === 'none'],
  ['nor the standing instructions', off.value.subDisplay === 'none'],
  ['the explanation is displayed', off.value.offlineDisplay !== 'none' && off.value.offlineDisplay !== 'MISSING'],
  ['it is one state block, amber', off.value.stateBlocks === 1 && off.value.stateTone === 'warning'],
  ['one control, not two', off.value.offlineActions === 1 && off.value.freshButtonDisplay === 'none'],
  ['the title no longer says scan', !/scan/i.test(off.value.title)],
  /*
   * The steps column, and this one is a **conditional reading** rather than a verdict.
   *
   * `pairSteps`' standing rule is that a later fact advances the earlier steps and an earlier
   * absence never retracts a later one. On a Mac that is already paired — which is every Mac this
   * probe can run on, because it needs the app up and a session to read — step 1 is `done` before
   * reachability is consulted, and it is *correct* for the label to stay put. Asserting the
   * blocked label here would be asserting that the rule is broken.
   *
   * So: the claim is made only where the column is still waiting, and where it is not, the run
   * says it holds no reading rather than folding a state it could not produce into a pass or a
   * fail. The unit test covers the combination this machine cannot reach.
   */
  ...(off.value.firstStepState === 'done'
    ? (console.log(
        `  --   the steps column: NO READING — step 1 is already "done" (this Mac is paired), ` +
          `so a later fact correctly outranks reachability. pairSteps.test.ts covers the unpaired case`,
      ),
      [])
    : [['the steps column agrees with the card', off.value.firstStep === 'Waiting for a network']]),
  ['and the code comes back', back.value.qrDisplay === 'block' && back.value.offlineDisplay === 'none'],
  ['with its own title and button', /scan/i.test(back.value.title) && back.value.freshButtonDisplay !== 'none'],
];
console.log('');
for (const [what, ok] of v) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
}

// Put the screen back where it was found, and the card back to what the live network says.
await probe.rawEvaluate(
  `void connect.pairingQr(false).then(({ reachable }) => applyPairShape(reachable))`,
);
if (before.value && before.value !== 'pairing') {
  await probe.rawEvaluate(`globalThis.shell && shell.route(${JSON.stringify(before.value)})`);
}

console.log(`\n${failures === 0 ? 'ALL READINGS OK' : `${failures} FAILED`}\n`);
await probe.close();
process.exit(failures === 0 ? 0 : 1);
