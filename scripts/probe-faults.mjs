/**
 * The red-first for `probe.mjs` itself, run against a live app.
 *
 * `probe.test.mjs` proves the helper's logic with a fake page. This proves it against **the three
 * readings that produced it**, on the real DOM, because a helper built from three specific faults
 * is only worth having if it catches those three.
 *
 * Each fault is run twice: once as it was originally taken, which must now fail loudly, and once
 * corrected, which must return a reportable number. The pair is the point — a probe that refuses
 * everything is not a probe.
 *
 * Run with the app up:
 *   npx electron . --force-renderer-accessibility --remote-debugging-port=9222
 *   node scripts/probe-faults.mjs
 */
import { openProbe, ProbeControlFailure, STOPPED, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;

const ok = (label, condition, detail) => {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

/** Route by prefix, which is the corrected form of fault 2. */
const routeTo = async (label) => {
  await probe.act({
    what: `route to ${label}`,
    run: `(() => { const b=[...document.querySelectorAll('.nav-item, nav button, nav a')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(label)}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${label}"]');
      return !!s && !s.hidden; })()`,
    within: 4000,
  });
};

console.log('\n=== FAULT 1 · a 2.5 s wait against a 16 s page ===');
console.log('Originally: five scrolls, 2.5 s apart, read 200 rows each time and nearly became');
console.log('"paging does not work". The page takes ~16 s. Every sample was taken too early.\n');

await routeTo('files');
await probe.act({
  what: 'open DCIM root',
  run: `(() => { const r=[...document.querySelectorAll('#files-roots [role="option"], #files-roots button')]
    .find(x => (x.textContent||'').toUpperCase().includes('DCIM')); if (r) r.click(); return !!r; })()`,
  expect: `__probe.count('#files-roots [role="option"], #files-roots button') > 0`,
  within: 4000,
});
await probe.act({
  what: 'open DCIM/Camera',
  run: `(() => { const row=[...document.querySelectorAll('#files-table .files-row:not(.files-row--head)')]
    .find(x => (x.querySelector('.files-cell-name')?.textContent||'').replace(/[^A-Za-z0-9 ]/g,'').trim()==='Camera');
    if (row) row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return !!row; })()`,
  expect: `(document.querySelector('#files-crumbs')?.textContent||'').includes('Camera')`,
  within: 8000,
});

const ROWS = `__probe.count('#files-table .files-row:not(.files-row--head)')`;
const TABLE_EXISTS = `__probe.count('#files-table')`;

const impatient = await probe.read({
  question: 'did Camera list its rows? (2.5 s deadline, as originally taken)',
  read: ROWS,
  control: TABLE_EXISTS,
  settle: { until: (n) => n > 0, within: 2500, poll: 400 },
});
console.log('  ' + format(impatient));
ok('the impatient read is NOT reportable', impatient.reportable === false, `stopped=${impatient.stopped}`);
ok('and it is marked deadline, not a value', impatient.stopped === STOPPED.DEADLINE);

const patient = await probe.read({
  question: 'did Camera list its rows? (45 s deadline)',
  read: ROWS,
  control: TABLE_EXISTS,
  settle: { until: (n) => n > 0, within: 45000, poll: 1000 },
});
console.log('  ' + format(patient));
ok('the patient read IS reportable', patient.reportable === true, `value=${patient.value}`);

console.log('\n=== FAULT 2 · an exact match against a nav labelled "Notifications27" ===');
console.log('Originally: notifications=hidden, one sentence from "the pane broke". The badge count');
console.log('sits inside the button, so the exact match found nothing and it was never routed to.\n');

const EXACT = `__probe.count('.nav-item, nav button, nav a') && [...document.querySelectorAll('.nav-item, nav button, nav a')]
  .filter(x => (x.textContent||'').trim().toLowerCase() === 'notifications').length`;
const PREFIX = `[...document.querySelectorAll('.nav-item, nav button, nav a')]
  .filter(x => (x.textContent||'').trim().toLowerCase().startsWith('notifications')).length`;

try {
  const bad = await probe.read({
    question: 'is there a Notifications nav control? (exact match, as originally taken)',
    read: `__probe.count('section[data-screen="notifications"]')`,
    control: EXACT,
  });
  ok('the exact-match control should have failed', false, `it returned ${JSON.stringify(bad.value)}`);
} catch (error) {
  ok('the exact-match control FAILS loudly', error instanceof ProbeControlFailure, error.constructor.name);
  console.log('  ' + String(error.message).split('\n')[0]);
}

const good = await probe.read({
  question: 'is there a Notifications nav control? (prefix, corrected)',
  read: `__probe.count('section[data-screen="notifications"]')`,
  control: PREFIX,
});
console.log('  ' + format(good));
ok('the corrected control passes and yields a reading', good.reportable && good.control > 0);

console.log('\n=== FAULT 3 · a section measured while hidden, reporting clientHeight 0 ===');
console.log('Originally: a photo grid read scrollHeight 0 / clientHeight 0 and was one sentence from');
console.log('"paging does not work". The pane had routed away; a hidden element cannot scroll.\n');

await routeTo('files'); // so photos is definitely hidden
try {
  const v = await probe.read({
    question: 'how tall is the photos grid? (while photos is hidden)',
    read: `(() => { const el = __probe.one('section[data-screen="photos"]');
      return { scrollH: el.scrollHeight, clientH: el.clientHeight }; })()`,
    control: `__probe.count('section[data-screen="photos"]')`,
  });
  ok('reading a hidden section should have thrown', false, JSON.stringify(v.value));
} catch (error) {
  ok('a hidden section throws PROBE_NOT_VISIBLE', /PROBE_NOT_VISIBLE/.test(error.message));
  console.log('  ' + String(error.message).split('\n')[0].slice(0, 150));
}

// The ambiguity half of the same assertion: report what is actually on the page rather than
// asserting a claim about the app window that may not hold in this build.
const ambiguity = await probe.read({
  question: 'how many nodes carry [data-screen="files"]?',
  read: `__probe.count('[data-screen="files"]')`,
  control: `__probe.count('section[data-screen="files"]')`,
});
console.log('  ' + format(ambiguity));
if (ambiguity.value > 1) {
  try {
    await probe.read({
      question: 'the bare attribute selector, as originally taken',
      read: `(() => { const el = __probe.one('[data-screen="files"]'); return el.tagName; })()`,
      control: `__probe.count('section[data-screen="files"]')`,
    });
    ok('the ambiguous selector should have thrown', false);
  } catch (error) {
    ok('the ambiguous selector throws PROBE_AMBIGUOUS', /PROBE_AMBIGUOUS/.test(error.message));
    console.log('  ' + String(error.message).split('\n')[0].slice(0, 150));
  }
} else {
  console.log(`  NOTE: only ${ambiguity.value} node carries [data-screen="files"] in this build, so the`);
  console.log('        ambiguity half is not reproducible here. Stated rather than claimed —');
  console.log('        `probe.test.mjs` covers PROBE_AMBIGUOUS with a stub of two matching nodes.');
}

const narrowed = await probe.read({
  question: 'the narrowed selector, corrected',
  read: `(() => { const el = __probe.one('section[data-screen="files"]'); return el.tagName; })()`,
  control: `__probe.count('section[data-screen="files"]')`,
});
console.log('  ' + format(narrowed));
ok('the narrowed selector resolves', narrowed.value === 'SECTION');

console.log(`\n=== ${failures === 0 ? 'ALL THREE FAULTS CAUGHT' : `${failures} CHECK(S) FAILED`} ===\n`);
probe.close();
process.exit(failures === 0 ? 0 : 1);
