/**
 * Every Files-pane number in `docs/testing.md`, re-taken through `probe.mjs`.
 *
 * The measurements for F-4a, F-4b, F-4c, F-1 and F-3 were originally taken with throwaway scripts
 * in `/tmp`. Each one was correct in the end, but three of them were wrong first — a 2.5 s wait
 * against a 16 s page, an exact match against a nav labelled `"Notifications27"`, a section measured
 * while hidden — and none of those scripts survives to be re-run. A claim in the testing record
 * whose instrument no longer exists cannot be checked by the next person.
 *
 * So the claims that are written down have one instrument, it is in the repo, and every reading it
 * takes carries a control and says how it stopped.
 *
 * Run with the app up and a phone linked:
 *   node scripts/files-pane-probe.mjs            # everything
 *   node scripts/files-pane-probe.mjs --only=b   # one section
 *
 * Sections: `layout` (F-4b/c), `panes` (the eleven-screen control), `open` (F-4a), `paging`,
 * `select` (F-1 and F-3), `wall` (the Download wall's two homes).
 */
import { openProbe, STOPPED, format } from './probe.mjs';
import { argv } from 'node:process';

const only = (argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? null;
const wanted = (name) => !only || only === name;

const probe = await openProbe({ port: 9222 });
let failures = 0;
const results = [];

const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const show = (result) => {
  console.log('  ' + format(result));
  results.push(result);
  if (!result.reportable) failures += 1;
  return result;
};

/** Routing is a stimulus, so it reports whether it landed rather than assuming it did. */
const routeTo = async (screen) => {
  const acted = await probe.act({
    what: `route to ${screen}`,
    // Prefix, not exact: the Notifications control's text is "Notifications27" with its badge.
    run: `(() => { const b=[...document.querySelectorAll('.nav-item, nav button, nav a')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(screen)}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${screen}"]');
      return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })()`,
    within: 5000,
  });
  if (!acted.landed) {
    console.log(`  FAIL  could not route to ${screen} — nothing below is a reading`);
    failures += 1;
  }
  return acted.landed;
};

/** The pane must be on screen before it is asked anything about itself. */
const PANE_VISIBLE = `(() => { const s = __probe.one('section[data-screen="files"]'); return s ? 1 : 0; })()`;
const ROWS = `__probe.count('#files-table .files-row:not(.files-row--head)')`;

/**
 * Put the pane inside `DCIM/Camera` if it is not already there.
 *
 * Idempotent, because several sections need a large folder and re-opening one costs a 16 s
 * snapshot rebuild once the sliding TTL has lapsed.
 */
async function openCameraIfNeeded() {
  const where = await probe.read({
    question: 'which folder is the pane showing?',
    read: `(document.querySelector('#files-crumbs')?.textContent || '').trim()`,
    control: PANE_VISIBLE,
  });
  if (String(where.value).includes('Camera')) return true;

  await probe.act({
    what: 'select the DCIM root',
    run: `(() => { const r=[...document.querySelectorAll('#files-roots [role="option"], #files-roots button')]
      .find(x => (x.textContent||'').toUpperCase().includes('DCIM')); if (r) r.click(); return !!r; })()`,
    expect: `__probe.count('#files-table .files-row:not(.files-row--head)') > 0`,
    within: 15000,
  });
  const opened = await probe.act({
    what: 'open Camera',
    run: `(() => { const row=[...document.querySelectorAll('#files-table .files-row:not(.files-row--head)')]
      .find(x => (x.querySelector('.files-cell-name')?.textContent||'').replace(/[^A-Za-z0-9 ]/g,'').trim()==='Camera');
      if (row) row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return !!row; })()`,
    expect: `(document.querySelector('#files-crumbs')?.textContent||'').includes('Camera')`,
    within: 10000,
  });
  return opened.landed;
}

// --- F-4b / F-4c · the pane owns its own scrolling ---------------------------------------------

if (wanted('layout')) {
  console.log('\n=== F-4b / F-4c · scroll containment ===');
  await routeTo('files');

  // **The precondition, established rather than assumed.** F-4b is a claim about a table with more
  // content than fits; measured on a folder of 28 rows it reads `386/386 scrollable: false`, which
  // looks exactly like the bug it is meant to disprove. The first run of this probe did precisely
  // that and reported FAIL against a pane that was working — the instrument was in the wrong state,
  // not the pane. So the folder is opened first and the row count is checked before anything else
  // is believed.
  await openCameraIfNeeded();
  const enough = await probe.read({
    question: 'are there more rows than fit, so scrolling is even meaningful?',
    read: ROWS,
    control: PANE_VISIBLE,
    settle: { until: (n) => n > 40, within: 45000, poll: 1000 },
  });
  if (!enough.reportable) {
    console.log('  ' + format(enough));
    console.log('  SKIP  not enough rows to measure scroll containment; nothing below would mean anything');
    failures += 1;
  }

  show(
    await probe.read({
      question: 'is #files-table the scroller?',
      read: `(() => { const t = __probe.one('#files-table');
        return { scrollH: t.scrollHeight, clientH: t.clientHeight, scrollable: t.scrollHeight > t.clientHeight }; })()`,
      control: PANE_VISIBLE,
    }),
  ).value;
  const table = results[results.length - 1].value;
  check('the table scrolls (F-4b: it did not, 7286/7286)', table.scrollable === true, `${table.scrollH}/${table.clientH}`);

  show(
    await probe.read({
      question: 'does .page still scroll?',
      read: `(() => { const p = __probe.one('.page');
        return { scrollH: p.scrollHeight, clientH: p.clientHeight, scrollable: p.scrollHeight > p.clientHeight }; })()`,
      control: PANE_VISIBLE,
    }),
  );
  const page = results[results.length - 1].value;
  check('the page does not scroll (F-4c)', page.scrollable === false, `${page.scrollH}/${page.clientH}`);

  const tops = `(() => { const r = s => { const e = document.querySelector(s);
      return e ? Math.round(e.getBoundingClientRect().top) : null; };
    return { rail: r('.files-rail'), detail: r('#files-detail'), crumbs: r('.files-crumbs') }; })()`;
  const before = show(await probe.read({ question: 'anchors at scrollTop 0', read: tops, control: PANE_VISIBLE }));
  await probe.act({
    what: 'scroll the table to 600',
    run: `(() => { const t = document.querySelector('#files-table'); t.scrollTop = 600; return t.scrollTop; })()`,
    expect: `document.querySelector('#files-table').scrollTop > 0`,
    within: 3000,
  });
  const after = show(await probe.read({ question: 'anchors at scrollTop 600', read: tops, control: PANE_VISIBLE }));
  check(
    'rail, detail and crumbs do not move (F-4c: header went 302 → −2698)',
    JSON.stringify(before.value) === JSON.stringify(after.value),
    `${JSON.stringify(before.value)} vs ${JSON.stringify(after.value)}`,
  );
}

// --- the eleven-screen control -----------------------------------------------------------------

if (wanted('panes')) {
  console.log('\n=== control · the .page flex change is confined to Files ===');
  const screens = ['overview', 'mirror', 'files', 'photos', 'messages', 'notifications',
    'clipboard', 'calls', 'camera', 'activity', 'settings'];
  const heights = {};
  for (const s of screens) {
    if (!(await routeTo(s))) continue;
    const r = await probe.read({
      question: `${s} renders with a height`,
      read: `Math.round(__probe.one('section[data-screen="${s}"]').getBoundingClientRect().height)`,
      control: `__probe.count('section[data-screen="${s}"]')`,
    });
    heights[s] = r.value;
  }
  console.log('  ' + Object.entries(heights).map(([k, v]) => `${k}=${v}`).join('  '));
  check('all eleven screens render non-zero', Object.keys(heights).length === 11 &&
    Object.values(heights).every((h) => h > 0), `${Object.keys(heights).length} of 11 measured`);
  await routeTo('files');
}

// --- F-4a · a large folder opens at all --------------------------------------------------------

if (wanted('open') || wanted('paging')) {
  console.log('\n=== F-4a · DCIM/Camera opens (16,981 ms snapshot vs the old 10 s timeout) ===');
  await routeTo('files');
  await openCameraIfNeeded();

  // 45 s, matching FS_LIST_TIMEOUT_MS. The 2.5 s version of this wait is fault 1.
  const listed = show(
    await probe.read({
      question: 'Camera lists its first page',
      read: ROWS,
      control: PANE_VISIBLE,
      settle: { until: (n) => n > 0, within: 45000, poll: 1000 },
    }),
  );
  check('the folder opened rather than drawing the failure card', listed.value > 0, `${listed.value} rows in ${listed.waitedMs}ms`);

  const stateShown = show(
    await probe.read({
      question: 'is the failure card up?',
      read: `(() => { const s = document.querySelector('#files-state');
        return s && !s.hidden && s.getBoundingClientRect().height > 0 ? 1 : 0; })()`,
      control: PANE_VISIBLE,
    }),
  );
  check('no state card over a folder that reads fine', stateShown.value === 0);
}

if (wanted('paging')) {
  console.log('\n=== F-4b confirmed on real data · paging past 200 ===');
  const start = (await probe.read({ question: 'rows before scrolling', read: ROWS, control: PANE_VISIBLE })).value;
  await probe.act({
    what: 'scroll to the bottom to trigger loadMore',
    run: `(() => { const t=document.querySelector('#files-table'); t.scrollTop = t.scrollHeight; return t.scrollTop; })()`,
    expect: `document.querySelector('#files-table').scrollTop > 0`,
    within: 3000,
  });
  // A page costs ~16 s when the snapshot TTL has lapsed. This is the deadline fault 1 got wrong.
  const paged = show(
    await probe.read({
      question: 'did a second page arrive?',
      read: ROWS,
      control: PANE_VISIBLE,
      settle: { until: (n) => n > start, within: 45000, poll: 1000 },
    }),
  );
  check('the pager advances past the first page', paged.value > start, `${start} → ${paged.value}`);
}

// --- F-1 and F-3 · selection, prefetch and the 104 ms cap ---------------------------------------

if (wanted('select')) {
  console.log('\n=== F-1 · copy starts on selection, and F-3 · multi-select ===');
  const rows = (await probe.read({ question: 'rows available to select', read: ROWS, control: PANE_VISIBLE })).value;
  if (rows < 40) {
    console.log(`  SKIP  only ${rows} rows here; F-3's range needs 40. Open a larger folder.`);
  } else {
    await probe.act({
      what: 'click a single row',
      run: `(() => { const r=[...document.querySelectorAll('#files-table .files-row:not(.files-row--head)')]
        .find(x => !(x.querySelector('.files-cell-name')?.textContent||'').includes('▸'));
        if (r) r.dispatchEvent(new MouseEvent('click',{bubbles:true})); return !!r; })()`,
      expect: `__probe.count('#files-table .files-row.is-selected') === 1`,
      within: 3000,
    });
    const copying = show(
      await probe.read({
        question: 'does selection alone start the copy? (F-1)',
        read: `__probe.count('#files-table .files-row.is-copying') + __probe.count('#files-table .files-row.is-local')`,
        control: `__probe.count('#files-table .files-row.is-selected')`,
        settle: { until: (n) => n > 0, within: 20000, poll: 500 },
      }),
    );
    check('a click alone begins the copy', copying.value > 0);

    await probe.act({
      what: 'shift-click a range of 40',
      run: `(() => { const rows=[...document.querySelectorAll('#files-table .files-row:not(.files-row--head)')];
        rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true}));
        rows[39].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})); return true; })()`,
      expect: `__probe.count('#files-table .files-row.is-selected') === 40`,
      within: 3000,
    });
    const wide = show(
      await probe.read({
        question: 'a 40-row selection selects 40 and prefetches none (F-3, the 104 ms cap)',
        read: `({ selected: __probe.count('#files-table .files-row.is-selected'),
                 copying: __probe.count('#files-table .files-row.is-copying') })`,
        control: PANE_VISIBLE,
      }),
    );
    check('40 selected', wide.value.selected === 40, JSON.stringify(wide.value));
    check('above the cap of 8, nothing is speculatively copied', wide.value.copying === 0);
  }
}

// --- the Download wall's two homes --------------------------------------------------------------

if (wanted('wall')) {
  console.log('\n=== the Download wall is in exactly one home ===');
  await routeTo('files');
  // **Settled, not instantaneous, and that distinction is a finding.** Routing to Files re-triggers
  // `refresh()`, and while `fetch.kind === 'loading'` the pane is in neither steady home: the first
  // run of this read fired mid-load and returned `[]`, which reads exactly like "the wall vanished".
  // It had not — `#files-wall` was `hidden: false, height: 60` a moment later.
  //
  // So the invariant is *eventually exactly one, and then stably*, and the deadline is what
  // distinguishes that from a wall that is genuinely missing. A read taken during a transition is
  // the sampling fault again, one layer up: not a window missed, but a window caught mid-swing.
  const homes = show(
    await probe.read({
      question: 'how many homes carry the Download wall? (settled)',
      // Counts homes showing the sentence, never a text search over the pane: the degraded banner's
      // own copy contains the vocabulary of the thing it says is absent.
      read: `(() => { const shown = el => el && !el.hidden && el.getBoundingClientRect().height > 0;
        const wall = document.querySelector('#files-wall'), state = document.querySelector('#files-state');
        return [['rail-line', wall], ['state-card', state]]
          .filter(([, el]) => shown(el) && (el.textContent||'').includes('Download')).map(([n]) => n); })()`,
      control: PANE_VISIBLE,
      settle: { until: (homes) => homes.length === 1, within: 20000, poll: 500 },
    }),
  );
  check('exactly one home', homes.value.length === 1, JSON.stringify(homes.value));
}

const unreportable = results.filter((r) => !r.reportable).length;
console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} — ` +
  `${results.length} readings, ${unreportable} not reportable ===\n`);
probe.close();
process.exit(failures === 0 ? 0 : 1);
