/**
 * What the Mac says about one capability, in the words the phone sent.
 *
 * Defect 102's second half. The phone withholding `mirror` is measurable on the phone; whether the
 * *reason* survives the wire and reaches a person looking at the Mac is a different fact, and the
 * only end that can answer it is this one.
 *
 * It reads the **accessible sentence**, not the colour. `renderer.ts` puts the state and the phone's
 * reason in a visually-hidden span precisely because the chip used to be a name and a background
 * colour and nothing else (defect 26) — so the hidden span is the primary channel and is what this
 * measures. The `title` is read too, as the second of two routes to one fact: if they disagree, the
 * page is telling a sighted user and a screen-reader user different things, which is a finding.
 *
 * Usage:  node scripts/caps-reason-probe.mjs <capability>
 */
import { openProbe, format } from './probe.mjs';

const capability = process.argv[2] ?? 'mirror';
const probe = await openProbe({ port: 9222 });

/*
 * The control is the number of chips on the page. A zero here means the pane never rendered, and
 * every sentence below would then be a reading about nothing — which is the fault `probe.mjs`
 * exists to refuse. `one()` additionally throws on a hidden node or a selector matching twice.
 */
const CONTROL = `__probe.one('#caps').querySelectorAll('span.cap').length`;

/*
 * `#caps` lives on the Overview screen, and a pane that is not routed reports height 0 — which
 * `one()` refuses, correctly. So the route is a *stimulus* with an `expect`, not an assumption:
 * a probe that navigated and then read without checking it arrived is the 263 ms window again.
 */
const routed = await probe.act({
  what: 'route the Mac to Overview, where the capability chips live',
  run: `document.querySelector('[data-nav="overview"]').click()`,
  expect: `__probe.one('#caps').getBoundingClientRect().height > 0`,
  within: 5000,
});
if (!routed.landed) {
  console.error(JSON.stringify(routed, null, 2));
  console.error('\nNOT A READING: could not reach the Overview screen, so nothing was measured.');
  probe.close();
  process.exit(3);
}

const reading = await probe.read({
  question: `What does the Mac say about \`${capability}\`?`,
  control: CONTROL,
  // A string rather than a function: `probe.read` serialises what it is given, so a closure over
  // `capability` would not survive the trip into the page.
  read: `(function () {
    var caps = __probe.one('#caps');
    var chips = Array.prototype.slice.call(caps.querySelectorAll('span.cap'));
    var want = ${JSON.stringify(capability)};
    var chip = chips.filter(function (c) { return c.firstChild && c.firstChild.textContent === want; })[0];
    if (!chip) throw new Error('PROBE_NO_MATCH: no chip named ' + want + ' among ' + chips.length);
    var hidden = chip.querySelector('.visually-hidden');
    return {
      chipsOnPage: chips.length,
      on: chip.classList.contains('on'),
      spoken: hidden ? hidden.textContent : null,
      title: chip.getAttribute('title'),
      allChips: chips.map(function (c) { return c.firstChild && c.firstChild.textContent; }).join(',')
    };
  })()`,
});

const v = reading.value;
console.log(format(reading));
console.log(JSON.stringify({
  capability,
  advertised: v.on,
  spokenSentence: v.spoken,
  titleSentence: v.title,
  // Two routes to one fact. Disagreement is a finding, not noise.
  routesAgree: v.on ? v.title === null : (v.title ?? '').endsWith((v.spoken ?? '').replace(/^: unavailable, /, '')),
  control: { chipsOnPage: v.chipsOnPage, allChips: v.allChips },
  reportable: reading.reportable,
}, null, 2));

// The socket keeps the process alive; every probe in this repo closes it explicitly.
probe.close();
process.exit(reading.reportable ? 0 : 3);
