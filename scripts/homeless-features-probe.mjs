/**
 * Where the features with no designed home actually are, measured rather than remembered.
 *
 * `docs/phase-7-homeless-features.md` proposes homes for them. A proposal that starts from "the
 * media remote is buried" is an impression, and this project's own rule is that a negative
 * impression is no more evidence than a negative reading. So the impressions are turned into
 * numbers first: where the card is, whether it is on screen without scrolling, and whether anything
 * in the app's search can find it.
 *
 * Run with the app up:
 *   node scripts/homeless-features-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
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
  if (!acted.landed) {
    console.log(`  FAIL  could not route to ${screen} — nothing below is a reading`);
    failures += 1;
  }
  return acted.landed;
};

console.log('\n=== Features with no designed home ===\n');

// H1 — the sidebar and the dock are the two standing ways to reach a feature. Neither names the
// media remote or contacts. Counted, not searched: a row is an element.
show(
  await probe.read({
    question: 'sidebar rows and dock tiles, by label',
    read: `(() => ({
      nav: [...document.querySelectorAll('.nav-row')].map(r => (r.textContent||'').trim()),
      dock: [...document.querySelectorAll('.dock-tile')].map(t => t.getAttribute('aria-label')),
    }))()`,
    control: `document.querySelectorAll('.nav-row').length`,
  }),
);

if (!(await routeTo('overview'))) process.exit(1);

// H2 — where the media remote card actually is on the Overview screen, and whether a person sees it
// without scrolling. "Buried" is an impression; a top offset against the viewport height is not.
show(
  await probe.read({
    question: 'the media remote card: is it drawn, where, and is it above the fold',
    read: `(() => {
      const card = document.getElementById('remote-card');
      if (!card) return { drawn: false };
      const r = card.getBoundingClientRect();
      const page = document.querySelector('#page') || document.scrollingElement;
      return {
        drawn: true,
        hidden: card.hidden,
        top: Math.round(r.top),
        height: Math.round(r.height),
        viewportHeight: window.innerHeight,
        aboveTheFold: r.top < window.innerHeight && r.height > 0,
        pageScrollHeight: page ? page.scrollHeight : null,
        pageClientHeight: page ? page.clientHeight : null,
      }; })()`,
    control: `document.querySelectorAll('section[data-screen="overview"]').length`,
  }),
);

// H3 — the same for contacts, which lives inside the Messages screen.
if (await routeTo('messages')) {
  show(
    await probe.read({
      question: 'the contacts card: drawn, where, and above the fold',
      read: `(() => {
        const card = document.getElementById('contacts-card');
        if (!card) return { drawn: false };
        const r = card.getBoundingClientRect();
        return { drawn: true, hidden: card.hidden, top: Math.round(r.top),
                 height: Math.round(r.height), viewportHeight: window.innerHeight,
                 aboveTheFold: r.top < window.innerHeight && r.height > 0 }; })()`,
      control: `document.querySelectorAll('section[data-screen="messages"]').length`,
    }),
  );
}

// H4 — the palette is the app's search. A working feature that search cannot find is hidden from
// anyone who does not already know where it is. Asked by *opening the palette and typing*, because
// asking navModel would be asking the thing under test to describe itself.
const palette = await probe.act({
  what: 'open the ⌘K palette',
  run: `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    return true; })()`,
  expect: `(() => { const p=document.querySelector('.palette, #palette, [data-palette]');
    return !!p && !p.hidden; })()`,
  within: 3000,
});
console.log(`  palette opened: ${palette.landed} (stopped=${palette.stopped})`);

if (palette.landed) {
  for (const query of ['music', 'playing', 'remote', 'contact', 'pair']) {
    show(
      await probe.read({
        question: `palette results for ${JSON.stringify(query)}`,
        read: `(() => {
          const input = document.querySelector('.palette input, #palette input, [data-palette] input');
          if (!input) return null;
          input.value = ${JSON.stringify(query)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return [...document.querySelectorAll('.palette-row, .palette li, [data-palette] li')]
            .map(r => (r.textContent||'').trim().slice(0, 40)); })()`,
        // The control is that the palette can return something for a query that certainly matches.
        control: `(() => {
          const input = document.querySelector('.palette input, #palette input, [data-palette] input');
          if (!input) return 0;
          input.value = 'mirror';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return document.querySelectorAll('.palette-row, .palette li, [data-palette] li').length; })()`,
      }),
    );
  }
  await probe.act({
    what: 'close the palette',
    run: `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`,
    expect: `(() => { const p=document.querySelector('.palette, #palette, [data-palette]');
      return !p || p.hidden; })()`,
    within: 2000,
  });
}

console.log(
  `\n${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} — every reading above carries its control\n`,
);
process.exit(failures === 0 ? 0 : 1);
