/**
 * Contact photographs on the Calls pane, measured on the running app against the real phone book.
 *
 * ### What could go wrong here, and what each reading rules out
 *
 * The failure this is written against is **the one that would look like a pass**: a disc with an
 * image painted on it is a disc, and a disc with no image painted on it is also a disc. Counting
 * `.call-disc` therefore answers nothing. Every reading below counts `.has-photo`, which is only
 * ever set by `paintPhoto`, beside the total that gives it a denominator.
 *
 * The second failure is subtler and is the reason this asks the *store* as well as the DOM: a pane
 * that draws four faces because four contacts have photographs and a pane that draws four faces
 * because it stopped asking after four are the same picture. `__callPhotos()` publishes the tally
 * — found, none, failed, not asked — so the picture and the accounting are two readings of one
 * fact, which is what `CLAUDE.md` asks for when only one instrument is available.
 *
 * Run with the app up and a phone linked:
 *   node scripts/call-photos-probe.mjs
 */
import { openProbe, STOPPED, format, formatAct } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;

const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
  return result;
};

/** Routing is a stimulus, so it reports whether it landed rather than assuming it did. */
const routeTo = async (screen) => {
  const acted = await probe.act({
    what: `route to ${screen}`,
    // Prefix, not exact: a nav control's text can carry a badge — "Notifications27".
    run: `(() => { const b=[...document.querySelectorAll('.nav-item, nav button, nav a')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(screen)}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${screen}"]');
      return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })()`,
    within: 5000,
  });
  console.log('  ' + formatAct(acted));
  if (!acted.landed) failures += 1;
  return acted.landed;
};

console.log('\n== Calls pane, contact photographs ==\n');

if (!(await routeTo('calls'))) {
  console.log('\n  Could not reach the Calls pane. Nothing below would be a reading.\n');
  process.exit(1);
}

// The log has to be loaded before anything about its discs means anything. This waits for rows to
// exist rather than sleeping, and reports `deadline` rather than a zero if they never arrive.
const rows = show(
  await probe.read({
    question: 'how many call-log rows are drawn',
    read: `__probe.count('section[data-screen="calls"] .call-row')`,
    control: `__probe.count('section[data-screen="calls"] .calls-tab')`,
    settle: { until: (n) => n > 0, within: 15000 },
  }),
);
if (rows.stopped !== STOPPED.SETTLED) {
  console.log('\n  No log rows. Every count below would be about an empty list.\n');
  process.exit(1);
}

/*
 * The reading that is the feature, and its denominator in the same expression.
 *
 * `.has-photo` is set nowhere but `paintPhoto`, so this cannot be satisfied by a disc that merely
 * exists. The `settle` is on the *photo* count rather than on a timer: the fetches are one request
 * per distinct number and they land whenever they land.
 */
const discs = show(
  await probe.read({
    question: 'call-log discs carrying a photograph, of all discs drawn',
    read: `(function () {
      var scope = 'section[data-screen="calls"] ';
      var all = Array.from(document.querySelectorAll(scope + '.call-disc'));
      var painted = all.filter(function (d) { return d.classList.contains('has-photo'); });
      return {
        discs: all.length,
        withPhoto: painted.length,
        // Every painted disc must still carry its initials underneath — the fallback is the disc
        // itself, and a build that emptied it would draw a hole the moment a fetch failed.
        paintedKeepingInitials: painted.filter(function (d) {
          return (d.textContent || '').trim().length > 0;
        }).length,
        // What was actually painted, so this is not a count with nothing behind it.
        sample: painted.slice(0, 3).map(function (d) {
          return d.textContent.trim() + ' → ' + (d.style.backgroundImage || '').slice(0, 34) + '…';
        }),
      };
    })()`,
    control: `__probe.count('section[data-screen="calls"] .call-disc')`,
    settle: { until: (v) => v.withPhoto > 0, within: 20000 },
  }),
);

check(
  'at least one photograph is drawn',
  discs.value.withPhoto > 0,
  `${discs.value.withPhoto} of ${discs.value.discs} discs`,
);
check(
  'every painted disc still carries its initials underneath',
  discs.value.paintedKeepingInitials === discs.value.withPhoto,
  `${discs.value.paintedKeepingInitials} of ${discs.value.withPhoto}`,
);
console.log('  painted:', discs.value.sample.join('\n            '));

/*
 * The second reading of the same fact.
 *
 * The DOM says how many faces are on screen. The store says how many were asked for, how many came
 * back empty, how many failed, and how many rows were never asked about at all. A picture with
 * four faces is consistent with a book of four photographs *and* with a fetch that died after
 * four; only this separates them.
 */
const tally = show(
  await probe.read({
    question: 'what the photo store says it did',
    read: `globalThis.__callPhotos ? __callPhotos() : 'NO STORE EXPOSED'`,
    control: `__probe.count('section[data-screen="calls"] .call-row')`,
  }),
);
check('the store published a tally', !String(tally.value).includes('NO STORE'), String(tally.value));

/*
 * A redraw must cost nothing.
 *
 * This is the whole reason there is a cache, and it is invisible in a screenshot: without it every
 * tab click is another request per row. `hit` rising while `found` does not is the shape of a
 * cache that is working.
 */
const before = tally.value;
const redrew = await probe.act({
  what: 'switch to Missed and back to All, which redraws every disc',
  run: `(function () {
    var tabs = Array.from(document.querySelectorAll('section[data-screen="calls"] .calls-tab'));
    var missed = tabs.find(function (t) { return t.textContent.indexOf('Missed') === 0; });
    var all = tabs.find(function (t) { return t.textContent.trim() === 'All'; });
    if (!missed || !all) throw new Error('PROBE_NO_TABS');
    missed.click(); all.click();
    return true;
  })()`,
  expect: `__probe.count('section[data-screen="calls"] .call-row') > 0`,
});
console.log('  ' + formatAct(redrew));
if (!redrew.landed) failures += 1;

const after = show(
  await probe.read({
    question: 'the tally after a full redraw',
    read: `__callPhotos()`,
    control: `__probe.count('section[data-screen="calls"] .call-row')`,
  }),
);
const foundOf = (s) => Number(String(s).match(/^(\d+) found/)?.[1] ?? -1);
check(
  'a redraw fetched nothing new',
  foundOf(after.value) === foundOf(before),
  `found ${foundOf(before)} → ${foundOf(after.value)}`,
);

console.log(`\n${failures === 0 ? 'All readings reportable.' : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
