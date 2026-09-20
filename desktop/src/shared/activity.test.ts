import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  ACTIVITY_CATEGORIES,
  activityCsv,
  activityTone,
  activityBusiestHour,
  activityPage,
  activityPager,
  activityPaneView,
  activitySummary,
  activityWhen,
} = require('./activity');

let seq = 0;
function ev(category: ActivityCategory, at: number, kind = 'k', detail = 'd'): ActivityEvent {
  seq += 1;
  return { seq, at, category, kind, detail };
}

// ---- the pair this file exists for -------------------------------------------------------------

test('an empty log and an empty filter are four different things, not one', () => {
  const busy = [ev('system', 1), ev('mirroring', 2)];
  const nothing = activityPaneView({ kind: 'ready', events: [] }, 'all', 0);
  const filtered = activityPaneView({ kind: 'ready', events: busy }, 'calls', 0);

  assert.equal(nothing.id, 'A3');
  assert.equal(filtered.id, 'A4');

  // Four independent differences. Any one of them removed and the two states start converging on
  // the same picture, which is what makes "nothing happened" indistinguishable from "nothing here".
  assert.notEqual(nothing.headline, filtered.headline, 'headline verb must differ');
  assert.notDeepEqual(nothing.body, filtered.body, 'body must differ');
  assert.ok(
    filtered.body.join(' ').includes('Calls'),
    'the filtered state must name the filter; the empty one has no filter to name',
  );
  assert.ok(
    filtered.body.join(' ').includes('2'),
    'the filtered state must say how many events it is hiding — the denominator',
  );
});

test('the failed state differs from both empty states in four ways', () => {
  const failed = activityPaneView({ kind: 'failed', reason: 'EACCES' }, 'all', 0);
  const empty = activityPaneView({ kind: 'ready', events: [] }, 'all', 0);
  assert.equal(failed.id, 'A2');
  // One `kind` now decides tone, glyph and whether an action is allowed, so the four differences
  // hold by construction rather than by four fields written out per branch. `stateBlock.test.ts`
  // asserts the mapping; `activityView.test.ts` asserts what is drawn.
  assert.notEqual(failed.kind, empty.kind, 'kind must differ');
  assert.notEqual(failed.headline, empty.headline, 'headline must differ');
  assert.notEqual(failed.retry, empty.retry, 'only the failed state offers a retry');
  assert.ok(failed.body.join(' ').includes('EACCES'), 'the reason must reach the user');
});

test('only the content state draws the table', () => {
  const events = [ev('files', 1)];
  const states = [
    activityPaneView({ kind: 'idle' }, 'all', 0),
    activityPaneView({ kind: 'loading' }, 'all', 0),
    activityPaneView({ kind: 'failed', reason: 'x' }, 'all', 0),
    activityPaneView({ kind: 'ready', events: [] }, 'all', 0),
    activityPaneView({ kind: 'ready', events }, 'files', 0),
    activityPaneView({ kind: 'ready', events }, 'files', 1),
  ];
  assert.deepEqual(
    states.map((s) => `${s.id}:${s.showsTable}`),
    ['A1:false', 'A1:false', 'A2:false', 'A3:false', 'A4:false', 'A5:true'],
  );
});

// ---- paging ------------------------------------------------------------------------------------

test('pages are newest first, sum to the total, and never repeat a row', () => {
  const events = Array.from({ length: 23 }, (_, i) => ev('system', 1000 + i));
  const seen: number[] = [];
  let pages = 0;
  for (let p = 0; p < 10; p += 1) {
    const result = activityPage(events, 'all', p, 9);
    if (result.page !== p) break;
    pages += 1;
    seen.push(...result.rows.map((r) => r.seq));
  }
  assert.equal(pages, 3, '23 events at 9 per page is 3 pages');
  assert.equal(seen.length, 23, 'the pages sum to the total');
  assert.equal(new Set(seen).size, 23, 'no row appears twice');
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a), 'newest first, throughout');
});

test('two events in the same millisecond are still strictly ordered', () => {
  // The reason this store pages on `seq` and not on `at`. Same timestamp, six events: paging on the
  // timestamp alone would be free to return any of them on either page, and the sums would still
  // add up — which is exactly the run that looks green with a tiebreak deleted.
  const same = Array.from({ length: 6 }, () => ev('system', 5_000));
  const first = activityPage(same, 'all', 0, 3).rows.map((r) => r.seq);
  const second = activityPage(same, 'all', 1, 3).rows.map((r) => r.seq);
  assert.equal(new Set([...first, ...second]).size, 6);
  assert.deepEqual([...first, ...second], [6, 5, 4, 3, 2, 1].map((n) => same[n - 1].seq));
});

test('a page past the end of a newly filtered list is clamped, not rendered empty', () => {
  // Switching from All on page 3 to Calls with four calls: without the clamp this returns zero rows
  // with a fetch that succeeded and a filter that matched — an empty table produced by arithmetic,
  // which no state check above would catch.
  const events = [...Array.from({ length: 40 }, () => ev('system', 1)), ...Array.from({ length: 4 }, () => ev('calls', 2))];
  const result = activityPage(events, 'calls', 3, 9);
  assert.equal(result.page, 0, 'clamped to the last real page');
  assert.equal(result.rows.length, 4);
  assert.equal(result.matched, 4);
  assert.equal(result.total, 44, 'total is every event, not the matching ones');
  assert.equal(result.pageCount, 1);
});

// ---- summary, tone and the busiest hour ---------------------------------------------------------

test('the summary counts only the window, and drops categories with none', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);
  const events = [
    ev('files', now - 1000),
    ev('files', now - 2000),
    ev('system', now - 3000),
    ev('calls', now - 90 * 3600 * 1000), // outside the window
  ];
  const summary = activitySummary(events, now - 24 * 3600 * 1000);
  assert.equal(summary.total, 3);
  assert.deepEqual(
    summary.slices.map((s) => `${s.category}=${s.count}`),
    ['files=2', 'system=1'],
    'no zero rows, and the design chip order is preserved',
  );
});

/**
 * D23: the badge tone is the **event's**, not its category's. The six category tints this replaces
 * were the last per-category hue in the app, and they spent the four colours that mean something.
 */
test('tone is earned: a connection, a failure and a refusal, and neutral for everything else', () => {
  assert.equal(activityTone({ kind: 'Connected', detail: 'phone' }), 'connected');
  assert.equal(activityTone({ kind: 'Reconnected', detail: 'phone' }), 'connected');
  assert.equal(activityTone({ kind: 'Send failed', detail: 'a.txt' }), 'failure');
  assert.equal(activityTone({ kind: 'Send refused', detail: '' }), 'warning');
  assert.equal(activityTone({ kind: 'Phone did not apply it', detail: '' }), 'warning');
  // The control, and the common case: an ordinary event of any category is neutral.
  assert.equal(activityTone({ kind: 'Sent to phone', detail: '5.3 KB' }), 'neutral');
  assert.equal(activityTone({ kind: 'Mirroring started', detail: '' }), 'neutral');
  // A disconnect is a fact; whether it was a failure is in its own detail, not in the kind.
  assert.equal(activityTone({ kind: 'Disconnected', detail: 'You disconnected.' }), 'neutral');
  assert.equal(
    activityTone({ kind: 'Disconnected', detail: 'The connection to your phone failed.' }),
    'failure',
  );
});

test('the busiest hour is the busiest, keeps the earliest on a tie, and is null over nothing', () => {
  const at = (hour: number, minute = 0) => new Date(2026, 8, 20, hour, minute).getTime();
  const midnight = new Date(2026, 8, 20).getTime();
  const events = [
    { at: at(9, 5) },
    { at: at(9, 40) },
    { at: at(14, 0) },
    { at: at(3, 0) },
    // Before the window: counted by nothing.
    { at: midnight - 3600 * 1000 },
  ];
  assert.deepEqual(activityBusiestHour(events, midnight), { hour: 9, count: 2 });
  // A tie keeps the earlier hour, so the sentence does not flip between two equal hours on redraw.
  assert.deepEqual(
    activityBusiestHour([{ at: at(7) }, { at: at(19) }], midnight),
    { hour: 7, count: 1 },
  );
  assert.equal(activityBusiestHour([], midnight), null, 'a busiest hour over nothing is a sentence about nothing');
});

// ---- export ------------------------------------------------------------------------------------

test('CSV survives a detail containing a comma, a quote and a newline', () => {
  const nasty = ev('clipboard', 0, 'Copied from phone', 'he said "hi, there"\nand left');
  const csv = activityCsv([nasty]);
  const body = csv.split('\n').slice(1).join('\n');
  assert.ok(body.includes('""hi, there""'), 'internal quotes are doubled, not dropped');
  assert.equal(csv.split('"').length % 2, 1, 'quotes are balanced');
  // The row spans a newline, so a naive line count would report two rows for one event.
  assert.ok(body.startsWith('"'), 'every field is quoted');
});

test('CSV is oldest-first and carries the sequence, so two exports can be diffed', () => {
  const a = ev('system', 10);
  const b = ev('system', 20);
  const rows = activityCsv([b, a]).trim().split('\n');
  assert.equal(rows.length, 3);
  assert.ok(rows[1].includes(`"${a.seq}"`));
  assert.ok(rows[2].includes(`"${b.seq}"`));
});

// ---- time --------------------------------------------------------------------------------------

test('the TIME column says when, at the resolution that is honest', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0).getTime();
  assert.equal(activityWhen(now - 5_000, now), 'Just now');
  assert.equal(activityWhen(now - 5 * 60_000, now), '5m ago');
  assert.equal(activityWhen(now - 5 * 3600_000, now), '07:00');
  assert.equal(activityWhen(now - 20 * 3600_000, now), 'Yesterday 16:00');
  assert.equal(activityWhen(now - 5 * 24 * 3600_000, now), '28/8 12:00');
});

// ---- the enumeration ---------------------------------------------------------------------------

test('every category has a label, and the design chips come first', () => {
  assert.deepEqual(ACTIVITY_CATEGORIES.slice(0, 4), ['mirroring', 'files', 'messages', 'calls']);
  assert.ok(ACTIVITY_CATEGORIES.includes('clipboard'));
  assert.ok(ACTIVITY_CATEGORIES.includes('system'));
});

// ---- The compact pager ----------------------------------------------------------------------

type PagerItem = { kind: 'page'; index: number; current: boolean } | { kind: 'gap' };
const pagesOf = (items: PagerItem[]) =>
  items.flatMap((i) => (i.kind === 'page' ? [i.index] : []));
const shape = (items: PagerItem[]) =>
  items.map((i) => (i.kind === 'gap' ? '…' : i.current ? `[${i.index + 1}]` : String(i.index + 1))).join(' ');

test('pager: one page is one control, with nowhere to step', () => {
  const p = activityPager(1, 0);
  assert.equal(shape(p.items), '[1]');
  assert.equal(p.prev, null);
  assert.equal(p.next, null);
});

test('pager: a small count draws every page and no gap', () => {
  assert.equal(shape(activityPager(5, 2).items), '1 2 [3] 4 5');
  assert.equal(shape(activityPager(4, 0).items), '[1] 2 3 4', 'a one-page run is drawn, not skipped');
  assert.equal(shape(activityPager(2, 1).items), '1 [2]');
});

test('pager: 223 pages — first, middle and last — stays compact and keeps the ends reachable', () => {
  assert.equal(shape(activityPager(223, 0).items), '[1] 2 … 223');
  assert.equal(shape(activityPager(223, 111).items), '1 … 111 [112] 113 … 223');
  assert.equal(shape(activityPager(223, 222).items), '1 … 222 [223]');
});

test('pager: never more than 2·neighbours + 5 slots, whatever the count', () => {
  for (const count of [1, 2, 3, 7, 9, 50, 223, 5000]) {
    for (const at of [0, 1, Math.floor(count / 2), count - 2, count - 1]) {
      if (at < 0 || at >= count) continue;
      assert.ok(activityPager(count, at).items.length <= 7, `${count} pages at ${at}`);
    }
  }
});

test('pager: no page appears twice, pages ascend, and first/current/last are always there', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 12, 223]) {
    for (let at = 0; at < count; at += 1) {
      const p = activityPager(count, at);
      const pages = pagesOf(p.items);
      assert.equal(new Set(pages).size, pages.length, `duplicate at ${count}/${at}: ${shape(p.items)}`);
      assert.deepEqual(pages, [...pages].sort((a, b) => a - b));
      assert.ok(pages.includes(0) && pages.includes(count - 1) && pages.includes(at));
      assert.equal(p.items.filter((i) => i.kind === 'page' && i.current).length, 1);
      // Every omitted page is marked: two page controls side by side are consecutive pages, so a
      // page can never silently vanish between them.
      p.items.forEach((item, k) => {
        const next = p.items[k + 1];
        if (item.kind === 'page' && next?.kind === 'page') {
          assert.equal(next.index, item.index + 1, `a page vanished unmarked: ${shape(p.items)}`);
        }
      });
      // No two gaps side by side, and a gap never stands for a single page.
      p.items.forEach((item, k) => {
        if (item.kind !== 'gap') return;
        const before = p.items[k - 1] as { index: number };
        const after = p.items[k + 1] as { index: number };
        assert.ok(after.index - before.index > 2, `a gap hides one page: ${shape(p.items)}`);
      });
    }
  }
});

test('pager: Previous and Next step by one and stop at the ends', () => {
  assert.deepEqual([activityPager(223, 0).prev, activityPager(223, 0).next], [null, 1]);
  assert.deepEqual([activityPager(223, 111).prev, activityPager(223, 111).next], [110, 112]);
  assert.deepEqual([activityPager(223, 222).prev, activityPager(223, 222).next], [221, null]);
});

test('pager: an out-of-range page is clamped rather than drawn as a phantom', () => {
  assert.equal(shape(activityPager(10, 99).items), '1 … 9 [10]');
  assert.equal(shape(activityPager(10, -3).items), '[1] 2 … 10');
});
