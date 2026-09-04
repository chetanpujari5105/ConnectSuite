#!/usr/bin/env node
/**
 * Every card on every pane, asked one question: **can a person actually see this?**
 *
 * ### Why this is a sweep and not a probe per sitting
 *
 * Defect 85 was excellent copy 828px down an 865px window — 21% on screen, in the column nobody
 * reads. Three days later O4 landed a card at 1007px in the same window, **in the pane being
 * fixed**, and the probe written to check it scrolled the wrong node and reported it unreachable.
 * Twice is a pattern: the failure is not any one card, it is that nothing in the build can see
 * where a card sits, and every sitting re-derives the geometry check from scratch and sometimes
 * re-derives it wrong.
 *
 * So the check lives in `__probe.onScreen`, which finds the scroller instead of assuming it, and
 * this walks every pane through it.
 *
 * ### Three outcomes, and the middle one is not a defect
 *
 *   visible    on screen as the pane sits
 *   reachable  off screen, and an ordinary scroll brings it fully into view
 *   stranded   off screen and scrolling does not help — the defect
 *
 * A long pane is allowed to be long. What is not allowed is a card nobody can reach, or a card
 * carrying a *state* below the fold, which is defect 85's actual shape: the copy was reachable and
 * still failed, because a person looking for "why is nothing here" does not scroll to find out
 * whether an explanation exists. Cards that carry a state are marked in the output.
 *
 * Run: node scripts/card-visibility-sweep.mjs [port]
 */
import { openProbe, PRELUDE } from './probe.mjs';

const port = Number(process.argv[2] ?? 9222);
const probe = await openProbe({ port });
// `rawEvaluate` does not install the helpers — only `read` and `presence` do. The first run of this
// file reported `__probe is not defined` for every card, which is an instrument fault reported as
// one rather than as a pane with no cards.
await probe.rawEvaluate(PRELUDE);

const size = await probe.rawEvaluate('JSON.stringify({ w: innerWidth, h: innerHeight, zoomed: innerWidth !== outerWidth })');
const { w, h, zoomed } = JSON.parse(size);
console.log(`\nwindow ${w}×${h}${zoomed ? '  ⚠ ZOOMED — every rect below is at the wrong scale' : ''}\n`);
if (zoomed) process.exit(1);

const screens = JSON.parse(
  await probe.rawEvaluate(
    `JSON.stringify(Array.from(document.querySelectorAll('section[data-screen]')).map(s => s.dataset.screen))`,
  ),
);

let stranded = 0;
let below = 0;
let total = 0;

for (const screen of screens) {
  // Route by accessible name, never a coordinate — and skip a pane the shell will not open.
  const routed = await probe.rawEvaluate(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function (x) {
      return (x.getAttribute('aria-label') || '').toLowerCase() === ${JSON.stringify(screen)}.toLowerCase();
    });
    if (!b) return 'no-nav-row';
    b.click();
    return document.querySelector('section[data-screen="' + ${JSON.stringify(screen)} + '"]').hidden ? 'refused' : 'ok';
  })()`);
  if (routed !== 'ok') {
    console.log(`${screen.padEnd(14)} — not measured (${routed})`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 120));

  // **Headings, not `.card`.** The first version of this counted `.card` elements and reported
  // "no .card elements" for nine of thirteen panes — which is not a fact about those panes, it is
  // a fact about a selector. They use five different container conventions (`.side-card`,
  // `.pane-*`, `.clip-panel`, `.files-panel`, `.calls-log-panel`), and *that* is worth its own
  // line in the audit. What every pane does have is headings, which is what a person navigates by
  // and therefore the right thing to ask about.
  /*
   * A heading with no text is **not a card**, and reporting it as one is an instrument fault.
   *
   * The Photos pane's `.pane-sub` (`#photos-note`) is empty until the first page of the album
   * lands. This sweep used to name it `(untitled)`, fail to resolve it back by heading text, and
   * print `top=0 onScreen=0 gone (scroller none)` — a **stranded card**, which is the one verdict
   * this file exists to raise the alarm on. It was a selector gap wearing the costume of the defect
   * it hunts, which is worse than the gap this file already documents: `files` reporting NOT
   * MEASURED was an honest silence, and this was a false accusation.
   *
   * The `(untitled)` fallback is what did it — it manufactured a name where there was none, so a
   * nameless node became a nameable card and then could not be found again by that name. Removing
   * the fallback is the fix; the filter below already drops anything with no name.
   */
  const cards = JSON.parse(
    await probe.rawEvaluate(`(function(){
      var pane = document.querySelector('section[data-screen="${screen}"]');
      var heads = pane.querySelectorAll('h2, h3, .card-title, .pane-sub, .clip-head, .panel-title, .files-rail-title');
      var seen = [];
      return JSON.stringify(Array.from(heads).map(function (el, i) {
        var name = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 34);
        return { index: i, name: name, id: el.id || null };
      }).filter(function (c) {
        if (!c.name || seen.indexOf(c.name) >= 0) return false;
        seen.push(c.name);
        return true;
      }));
    })()`),
  );
  if (cards.length === 0) {
    // A missing reading, said as one. `files` landed here on the first run and it was a gap in the
    // selector list above, not a pane without content — its heading is a `.files-rail-title`, a
    // seventh convention. The line says "not measured" rather than reporting a clean pane.
    console.log(`${screen.padEnd(14)} — NOT MEASURED: no heading matched the selector list`);
    continue;
  }

  console.log(`${screen}`);
  for (const card of cards) {
    let result;
    try {
      // Resolved by heading text rather than by a selector, because these headings mostly have no
      // id and `nth-of-type` over a mixed set is a guess about document order.
      result = JSON.parse(await probe.rawEvaluate(`(function(){
        var pane = document.querySelector('section[data-screen="${screen}"]');
        var heads = pane.querySelectorAll('h2, h3, .card-title, .pane-sub, .clip-head, .panel-title, .files-rail-title');
        var target = Array.from(heads).find(function (el) {
          return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 34) === ${JSON.stringify(card.name)};
        });
        if (!target) return JSON.stringify({ verdict: 'gone', atRest: { top: 0, fraction: 0 } });
        // The block the heading titles, not the heading itself: a one-line h2 is almost always in
        // view while the card under it is not.
        var block = target.closest('.card, .side-card, [class*="-panel"], [class*="pane-"]') || target.parentElement;
        var held = block.id;
        if (!held) block.id = '__sweep_target';
        var out = __probe.onScreen('#' + (held || '__sweep_target'));
        if (!held) block.removeAttribute('id');
        return JSON.stringify(out);
      })()`));
    } catch (error) {
      console.log(`   ?  ${card.name.padEnd(36)} ${String(error.message).split('\n')[0].slice(0, 70)}`);
      continue;
    }
    total += 1;
    const mark = { visible: '·', reachable: '↓', stranded: '✗' }[result.verdict];
    if (result.verdict === 'stranded') stranded += 1;
    if (result.verdict === 'reachable') below += 1;
    const at = result.atRest;
    console.log(
      `   ${mark}  ${card.name.padEnd(36)} top=${String(at.top).padStart(5)} ` +
        `onScreen=${String(at.fraction).padEnd(4)} ${result.verdict}` +
        (result.verdict !== 'visible' ? `  (scroller ${result.scroller ?? 'none'})` : ''),
    );
  }
}

console.log(
  `\n${total} cards: ${total - below - stranded} visible at rest, ${below} reachable by scrolling, ${stranded} stranded.`,
);
console.log('A long pane may be long. A stranded card cannot be reached at all — that is the defect.');
process.exit(stranded ? 1 : 0);
