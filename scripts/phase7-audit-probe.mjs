/**
 * What is actually left in Phase 7, measured against the running app.
 *
 * `docs/design-departures.md` is prose written as each pane landed, and prose goes stale the way
 * this repo's own phase table did. This probe re-asks the questions that document answers, from the
 * live DOM, so *"which panes are unbuilt or half-built"* is a count rather than a recollection.
 *
 * Every read carries a control, because the failure this exists to avoid is the one already in
 * `CLAUDE.md` three times: reading zero off a hidden section and reporting it as an absence.
 *
 * Run with the app up:
 *   node scripts/phase7-audit-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let unreportable = 0;
const show = (label, result) => {
  console.log(`  ${label}\n    ` + format(result));
  if (!result.reportable) unreportable += 1;
  return result;
};

const routeTo = async (screen) => {
  const acted = await probe.act({
    what: `route to ${screen}`,
    run: `(() => { const b=[...document.querySelectorAll('.nav-row, nav button, nav a')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(screen)}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${screen}"]');
      return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })()`,
    within: 5000,
  });
  if (!acted.landed) console.log(`  FAIL  could not route to ${screen} — nothing after this is a reading`);
  return acted.landed;
};

console.log('\n=== Phase 7 audit — what is left, measured ===\n');

// --- 1. The sidebar, and which rows admit to being unbuilt -----------------------------------
// Counted as elements, never searched as text: `CLAUDE.md`'s second control-table row.
console.log('1. Sidebar rows and their state');
show('rows', await probe.read({
  question: 'every nav row, its label, and whether it is marked not-built',
  read: `(() => [...document.querySelectorAll('.nav-row')].map(r => ({
    label: (r.textContent||'').trim(),
    aria: r.getAttribute('aria-label') || '',
    unbuilt: /not built yet/i.test(r.getAttribute('aria-label') || ''),
  })))()`,
  control: `document.querySelectorAll('.nav-row').length`,
}));

// --- 2. Settings: the handoff states three columns and eight panes, in prose ------------------
console.log('\n2. Settings rail — the handoff names eight panes');
if (await routeTo('settings')) {
  show('panes', await probe.read({
    question: 'settings rail tabs',
    read: `(() => [...document.querySelectorAll('.settings-tab')].map(t => (t.textContent||'').trim()))()`,
    control: `document.querySelectorAll('.settings-tab').length`,
  }));
  show('columns', await probe.read({
    question: 'the settings grid template — the handoff says 200px 1fr 320px',
    read: `getComputedStyle(__probe.one('section[data-screen="settings"] .settings-grid')).gridTemplateColumns`,
    control: `document.querySelectorAll('section[data-screen="settings"] .settings-grid').length`,
  }));
}

// --- 3. The palette is the app's search. What can it still not find? -------------------------
// Driven through the real palette UI, never through navModel: asking the model would be asking the
// thing under test to describe itself. The control is a query certain to match, re-typed each time.
console.log('\n3. What the app\'s own search cannot find');
const PALETTE_ROWS = '.palette-row, .palette li, [data-palette] li';
const type = (q) =>
  "(() => {" +
  "  const input = document.querySelector('.palette input, #palette input, [data-palette] input');" +
  "  if (!input) return null;" +
  "  input.value = " + JSON.stringify(q) + ";" +
  "  input.dispatchEvent(new Event('input', { bubbles: true }));" +
  "  return [...document.querySelectorAll(" + JSON.stringify(PALETTE_ROWS) + ")]" +
  "    .map(r => (r.textContent||'').trim().slice(0, 44));" +
  "})()";

const paletteOpen = await probe.act({
  what: 'open the ⌘K palette',
  run: `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); return true; })()`,
  expect: `(() => { const p=document.querySelector('.palette, #palette, [data-palette]'); return !!p && !p.hidden; })()`,
  within: 3000,
});
console.log(`  palette opened: ${paletteOpen.landed} (stopped=${paletteOpen.stopped})`);

if (paletteOpen.landed) {
  for (const q of ['music', 'contact', 'pair', 'battery', 'camera', 'record', 'transfer', 'keypad', 'signal']) {
    show(`"${q}"`, await probe.read({
      question: `palette results for ${JSON.stringify(q)}`,
      read: type(q),
      control:
        "(() => {" +
        "  const input = document.querySelector('.palette input, #palette input, [data-palette] input');" +
        "  if (!input) return 0;" +
        "  input.value = 'mirror';" +
        "  input.dispatchEvent(new Event('input', { bubbles: true }));" +
        "  return document.querySelectorAll(" + JSON.stringify(PALETTE_ROWS) + ").length; })()",
    }));
  }
  await probe.act({
    what: 'close the palette',
    run: `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`,
    expect: `(() => { const p=document.querySelector('.palette, #palette, [data-palette]'); return !p || p.hidden; })()`,
    within: 2000,
  });
}

// --- 4. Calls — the handoff draws three columns, a keypad, and in-call controls ---------------
console.log('\n4. Calls pane against the handoff (300px 1fr 300px, keypad, mute/speaker, waveform)');
if (await routeTo('calls')) {
  show('controls', await probe.read({
    question: 'controls the handoff names, counted as elements not words',
    read: `(() => {
      const s = __probe.one('section[data-screen="calls"]');
      const n = (sel) => s.querySelectorAll(sel).length;
      return {
        buttons: n('button'),
        dialpadKeys: n('.dialpad button, .keypad button, [data-dialpad] button'),
        muteOrSpeaker: [...s.querySelectorAll('button')]
          .filter(b => /mute|speaker/i.test(b.getAttribute('aria-label')||b.textContent||'')).length,
        waveform: n('canvas, svg.waveform, .waveform'),
        columns: getComputedStyle(s.querySelector('.pane')?.parentElement || s).gridTemplateColumns,
      };
    })()`,
    control: `document.querySelectorAll('section[data-screen="calls"] button').length`,
  }));
}

// --- 5. Clipboard — the handoff draws tabs, kind badges and a three-step sync timeline --------
console.log('\n5. Clipboard pane against the handoff (History/Favourites/Pinned, kind badges, timeline)');
if (await routeTo('clipboard')) {
  show('controls', await probe.read({
    question: 'the handoff\'s clipboard furniture, counted',
    read: `(() => {
      const s = __probe.one('section[data-screen="clipboard"]');
      const n = (sel) => s.querySelectorAll(sel).length;
      return {
        buttons: n('button'),
        tabs: n('.clip-tab, [role="tab"]'),
        kindBadges: n('.clip-kind, .kind-badge'),
        starActions: [...s.querySelectorAll('button')]
          .filter(b => /favourite|favorite|star|pin/i.test(b.getAttribute('aria-label')||b.textContent||'')).length,
        timeline: n('.clip-timeline, .sync-timeline'),
      };
    })()`,
    control: `document.querySelectorAll('section[data-screen="clipboard"] button').length`,
  }));
}

// --- 6. Overview — the handoff's right column is Quick actions / Device / Recent activity -----
console.log('\n6. Overview right column');
if (await routeTo('overview')) {
  show('cards', await probe.read({
    question: 'cards on Overview, by their heading',
    read: `(() => {
      const s = __probe.one('section[data-screen="overview"]');
      return [...s.querySelectorAll('.pane, .card')].map(c => ({
        id: c.id || '(none)',
        heading: (c.querySelector('h2,h3,.pane-title')?.textContent || '').trim().slice(0, 40),
      }));
    })()`,
    control: `document.querySelectorAll('section[data-screen="overview"] .pane, section[data-screen="overview"] .card').length`,
  }));
  show('battery slot', await probe.read({
    question: 'is any battery figure drawn anywhere in the shell (S4 says the slot is removed)',
    read: `(() => ['device-battery','strip-battery','strip-divider-battery']
      .map(id => { const e = document.getElementById(id); return { id, present: !!e, hidden: e ? e.hidden : null }; }))()`,
    control: `document.querySelectorAll('#device-battery, #strip-battery').length`,
  }));
}

console.log(`\n=== ${unreportable} unreportable reading(s) ===`);
await probe.close();
process.exit(unreportable > 0 ? 1 : 0);
