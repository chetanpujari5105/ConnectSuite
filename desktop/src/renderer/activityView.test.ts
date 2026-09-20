import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
// The page loads this before activity.js, and the pane calls it after every draw. Without it the
// suite would be exercising a loader the renderer never uses — defect 94's shape.
// `stateBlock` builds its badge with `iconSvg`, so the page's own order applies here too.
import './icons';
import './stateBlock';
import './overflowTitle';
import './activity';

/**
 * The Activity pane's **view class**, driven for real against the DOM double.
 *
 * `shared/activity.test.ts` covers the decisions — which state, which page, which counts. None of
 * that is evidence that the pane *draws* them, and the three renderer defects this project has
 * recorded were all exactly that gap: a rule that was right and a drawing that did not follow it.
 * So the assertions below are about the tree, not about the model.
 *
 * The mount is real; the DOM is the double. `domDouble.testkit.ts` says at length which half that
 * leaves unmeasured — cascade, layout and focus are invisible here and always will be.
 */

const shared = require('../shared/activity');

type Ev = { seq: number; at: number; category: string; kind: string; detail: string };

let seq = 0;
function ev(category: string, kind = 'Did a thing', detail = 'details', at = Date.now()): Ev {
  seq += 1;
  return { seq, at, category, kind, detail };
}

class FakeBridge {
  events: Ev[] = [];
  error: string | null = null;
  failRequest = false;
  exported = 0;
  exportResult: { ok: boolean; data?: { path: string }; reason?: string } = {
    ok: true,
    data: { path: '/tmp/a.csv' },
  };

  async activityEvents() {
    if (this.failRequest) return { ok: false as const, reason: 'the bridge said no' };
    return {
      ok: true as const,
      data: {
        events: this.events,
        error: this.error,
        stats: { read: this.events.length, skipped: 2, recorded: 5, dropped: 0 },
      },
    };
  }

  async activityExportCsv() {
    this.exported += 1;
    return this.exportResult;
  }
}

interface Pane {
  bridge: FakeBridge;
  host: FakeElement;
  view: { refresh(): Promise<void> };
  restore: () => void;
}

function mount(): Pane {
  const fake = installFakeDocument();
  const bridge = new FakeBridge();
  const host = el('div');
  const { ActivityView } = globalThis as unknown as {
    ActivityView: new (bridge: FakeBridge, host: FakeElement) => { refresh(): Promise<void> };
  };
  return { bridge, host, view: new ActivityView(bridge, host), restore: fake.restore };
}

function texts(host: FakeElement, className: string): string[] {
  return host.queryAll(`.${className}`).map((node) => node.textContent);
}

// ---- the pair the pane exists to keep apart ----------------------------------------------------

test('an empty log draws A3, and no table', async () => {
  const pane = mount();
  try {
    await pane.view.refresh();
    const cards = pane.host.queryAll('.state-block');
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.dataset.state, 'A3');
    assert.equal(pane.host.queryAll('.activity-row').length, 0);
    assert.equal(pane.host.queryAll('.activity-chip').length, 0, 'nothing to filter, so no chips');
  } finally {
    pane.restore();
  }
});

test('a filter that matches nothing draws A4 — a different card, and the chips stay', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system'), ev('files')];
    await pane.view.refresh();
    assert.equal(pane.host.queryAll('.activity-row').length, 2, 'A5 first');

    const files = pane.host.queryAll('.activity-chip').find((c) => c.textContent.startsWith('Files'));
    assert.ok(files, 'a Files chip must exist — it is in the log');
    files!.click();
    assert.equal(pane.host.queryAll('.activity-row').length, 1);

    // There is no Calls chip, by design: a chip for a category with no events is a filter that can
    // only ever produce an empty table. So A4 is reached the way a user actually reaches it — the
    // log moves under a filter that was valid when it was chosen.
    pane.bridge.events = [ev('system'), ev('system')];
    await pane.view.refresh();
    const card = pane.host.queryAll('.state-block')[0];
    assert.ok(card, 'a state card must be drawn');
    assert.equal(card!.dataset.state, 'A4');
    assert.ok(
      pane.host.queryAll('.activity-chip').length > 0,
      'A4 must keep the chip row — it is the way out, and one of the four A3/A4 differences',
    );
    assert.ok(
      card!.textContent.includes('Files'),
      'A4 must name the filter; A3 has no filter to name',
    );
  } finally {
    pane.restore();
  }
});

test('a failed read draws A2 with a retry, and the retry actually refetches', async () => {
  const pane = mount();
  try {
    pane.bridge.failRequest = true;
    await pane.view.refresh();
    const card = pane.host.queryAll('.state-block')[0]!;
    assert.equal(card.dataset.state, 'A2');
    /*
     * **A2 is red now, not amber** — the D67 tone map puts an actual operation failure there, and
     * *the log could not be read* is an operation that ran and failed. The reassurance amber was
     * carrying is in the body, in words: nothing has been lost on the phone.
     *
     * Asserted on `data-tone`, which the component writes from the kind, rather than on a class
     * name a caller could set to anything.
     */
    assert.equal(card.dataset.tone, 'danger', 'A2 is the pane\'s only failure state');
    assert.equal(card.dataset.kind, 'error');
    assert.ok(card.textContent.includes('the bridge said no'), 'the reason reaches the user');

    const retry = pane.host.queryAll('button').find((b) => b.textContent === 'Try again');
    assert.ok(retry, 'only the failed state offers a retry');
    pane.bridge.failRequest = false;
    pane.bridge.events = [ev('system')];
    retry!.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pane.host.queryAll('.activity-row').length, 1, 'the retry refetched and redrew');
  } finally {
    pane.restore();
  }
});

test("the store's own read error becomes A2, not an empty table", async () => {
  // The branch that keeps A2 apart from A3 across the IPC boundary: `ok: true` with an `error`
  // beside the events. Returning `[]` on a failed read is the shape that would collapse them.
  const pane = mount();
  try {
    pane.bridge.error = 'EACCES: activity.jsonl';
    await pane.view.refresh();
    const card = pane.host.queryAll('.state-block')[0]!;
    assert.equal(card.dataset.state, 'A2');
    assert.ok(card.textContent.includes('EACCES'));
  } finally {
    pane.restore();
  }
});

// ---- the table, the pager, the rail ------------------------------------------------------------

test('the table draws a row per event, newest first, each dot toned by the EVENT', async () => {
  const pane = mount();
  try {
    const base = Date.now();
    pane.bridge.events = [
      ev('files', 'Sent to phone', 'a.txt', base - 3000),
      ev('calls', 'Call ringing', '+91…', base - 2000),
      ev('system', 'Connected', 'phone', base - 1000),
    ];
    await pane.view.refresh();
    assert.deepEqual(texts(pane.host, 'activity-kind'), [
      'Connected',
      'Call ringing',
      'Sent to phone',
    ]);
    assert.deepEqual(texts(pane.host, 'activity-detail'), ['phone', '+91…', 'a.txt']);
    // Scoped to the rows: counting every dot on the pane would pass with the table's dots deleted.
    const rowDots = pane.host
      .queryAll('.activity-row')
      .flatMap((row) => row.queryAll('.activity-dot'));
    assert.equal(rowDots.length, 3, 'one dot per row');
    /*
     * **Tone is the event's, not the category's** (D23). This used to assert *three categories,
     * three tints* — which passed on any six-colour table, and was the per-category hue D2 removed.
     * A connection coming up is the one lime row here; a file transfer and a ringing call are
     * ordinary events and are neutral, whatever category they belong to.
     */
    assert.deepEqual(
      rowDots.map((d) => d.dataset.tone),
      ['connected', 'neutral', 'neutral'],
    );
  } finally {
    pane.restore();
  }
});

test('a detail is written as text, never as markup', async () => {
  // The details column carries a file name somebody else chose. `textContent` is the whole defence
  // and the double records which setter was used.
  const pane = mount();
  try {
    const nasty = '<img src=x onerror=alert(1)>';
    pane.bridge.events = [ev('files', 'Saved to Mac', nasty)];
    await pane.view.refresh();
    const detail = pane.host.queryAll('.activity-detail')[0]!;
    assert.equal(detail.textContent, nasty, 'stored verbatim as text');
    assert.equal(detail.children.length, 0, 'and produced no child elements');
  } finally {
    pane.restore();
  }
});

test('the pager appears past one page, and clicking page 2 shows different rows', async () => {
  const pane = mount();
  try {
    const base = Date.now();
    pane.bridge.events = Array.from({ length: 14 }, (_, i) =>
      ev('system', `Event ${i}`, `d${i}`, base - i * 1000),
    );
    await pane.view.refresh();
    const pages = pane.host.queryAll('.activity-page');
    assert.equal(pages.length, 2, '14 events at 9 a page');
    const firstPage = texts(pane.host, 'activity-kind');
    assert.equal(firstPage.length, 9);

    pages[1]!.click();
    const secondPage = texts(pane.host, 'activity-kind');
    assert.equal(secondPage.length, 5);
    assert.equal(
      new Set([...firstPage, ...secondPage]).size,
      14,
      'the two pages sum to the total and share no row',
    );
  } finally {
    pane.restore();
  }
});

test('2000 events draw a bounded pager whose ends and neighbours all work', async () => {
  const pane = mount();
  try {
    const base = Date.now();
    pane.bridge.events = Array.from({ length: 2000 }, (_, i) =>
      ev('system', `Event ${i}`, `d${i}`, base - i * 1000),
    );
    await pane.view.refresh();
    const labels = () => pane.host.queryAll('.activity-page').map((b) => b.textContent);
    assert.deepEqual(labels(), ['1', '2', '223'], '223 pages, three numbered controls');
    assert.equal(pane.host.queryAll('.activity-step').length, 2, 'Previous and Next');

    // The last page is one click away, and it holds the oldest events.
    pane.host.queryAll('.activity-page').find((b) => b.textContent === '223')!.click();
    assert.deepEqual(labels(), ['1', '222', '223']);
    assert.equal(texts(pane.host, 'activity-kind').length, 2000 - 222 * 9);

    // Next is off at the end; Previous steps back one page.
    const [prev, next] = pane.host.queryAll('.activity-step');
    assert.equal(next!.disabled, true);
    prev!.click();
    assert.deepEqual(labels(), ['1', '221', '222', '223']);
  } finally {
    pane.restore();
  }
});

test('one page draws no pager, and the count line still says how many', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system'), ev('system')];
    await pane.view.refresh();
    assert.equal(pane.host.queryAll('.activity-page').length, 0);
    assert.ok(texts(pane.host, 'activity-count')[0]!.includes('2 events'));
  } finally {
    pane.restore();
  }
});

test('the count line names the filter, so the denominator is not misread', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system'), ev('system'), ev('files')];
    await pane.view.refresh();
    pane.host.queryAll('.activity-chip').find((c) => c.textContent.startsWith('Files'))!.click();
    const line = texts(pane.host, 'activity-count')[0]!;
    assert.ok(line.includes('Files'), 'the filter is named');
    assert.ok(line.includes('3 in all'), 'and the unfiltered total is beside it');
  } finally {
    pane.restore();
  }
});

/**
 * D9 removed the donut and the sparkline. What replaces them is the same counts as a list and the
 * busiest hour as a sentence — so the assertion is that **no chart is drawn and the numbers
 * survive**, which is the half that mattered.
 */
test('the rail counts today rather than charting it, and says so when there is nothing', async () => {
  const pane = mount();
  try {
    // Yesterday only: the table has rows, today has nothing to count.
    pane.bridge.events = [ev('system', 'Connected', 'phone', Date.now() - 30 * 3600 * 1000)];
    await pane.view.refresh();
    assert.equal(pane.host.queryAll('.activity-donut').length, 0, 'the donut came back');
    assert.equal(pane.host.queryAll('.activity-spark').length, 0, 'the sparkline came back');
    assert.equal(pane.host.queryAll('.activity-empty-note').length, 1);
    assert.equal(pane.host.queryAll('.activity-cat-count').length, 0, 'counted a day with nothing in it');

    pane.bridge.events.push(ev('files', 'Sent to phone', 'a.txt', Date.now()));
    await pane.view.refresh();
    assert.equal(pane.host.queryAll('.activity-empty-note').length, 0);
    // One count row for the one category with events today, and the total beside it.
    assert.equal(pane.host.queryAll('.activity-cat-count').length, 1);
    assert.ok(texts(pane.host, 'activity-total').some((line) => line.includes('1 event')));
  } finally {
    pane.restore();
  }
});

test('the busiest hour is printed as a sentence, with the count that makes it one', async () => {
  const pane = mount();
  try {
    const at = (hour: number) => new Date(new Date().setHours(hour, 5, 0, 0)).getTime();
    pane.bridge.events = [
      ev('system', 'Connected', 'phone', at(9)),
      ev('files', 'Sent to phone', 'a.txt', at(9)),
      ev('files', 'Sent to phone', 'b.txt', at(14)),
    ];
    await pane.view.refresh();
    const busiest = texts(pane.host, 'activity-busiest');
    assert.equal(busiest.length, 1, 'control: the sentence is drawn');
    assert.match(busiest[0]!, /Busiest between 09:00 and 10:00 — 2 events\./);
  } finally {
    pane.restore();
  }
});

test('the skipped-line count is published with its denominator', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system')];
    await pane.view.refresh();
    const stats = texts(pane.host, 'activity-stats').join(' ');
    assert.ok(stats.includes('1 read / 2 unreadable'), 'never a bare skipped count');
    assert.ok(stats.includes('5 recorded / 0 dropped'));
  } finally {
    pane.restore();
  }
});

test('a cancelled export is not reported as a failure', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system')];
    pane.bridge.exportResult = { ok: false, reason: 'cancelled' };
    await pane.view.refresh();
    const button = pane.host
      .queryAll('button')
      .find((b) => b.textContent === 'Export log as CSV')!;
    button.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pane.bridge.exported, 1);
    assert.notEqual(button.textContent, 'Export failed', 'cancelling is not failing');
  } finally {
    pane.restore();
  }
});

// ---- the race the Files pane lost ---------------------------------------------------------------

test('two refreshes in flight at once join rather than racing', async () => {
  // The Files pane reached the one state its tagged union existed to forbid because a route open
  // and a capability arrival both called refresh() within a frame. Same two triggers here.
  const pane = mount();
  try {
    pane.bridge.events = [ev('system')];
    let calls = 0;
    const original = pane.bridge.activityEvents.bind(pane.bridge);
    pane.bridge.activityEvents = async () => {
      calls += 1;
      return original();
    };
    await Promise.all([pane.view.refresh(), pane.view.refresh(), pane.view.refresh()]);
    assert.equal(calls, 1, 'the second and third callers joined the run in flight');
    assert.equal(pane.host.queryAll('.activity-row').length, 1);
  } finally {
    pane.restore();
  }
});

// ---- the control -------------------------------------------------------------------------------

test('control — the harness can see a row, so an absence above means something', async () => {
  const pane = mount();
  try {
    pane.bridge.events = [ev('system', 'Connected', 'phone')];
    await pane.view.refresh();
    assert.equal(pane.host.queryAll('.activity-row').length, 1);
    assert.equal(pane.host.queryAll('.state-block').length, 0);
    assert.ok(
      shared.activityPaneView({ kind: 'ready', events: pane.bridge.events }, 'all', 1).showsTable,
    );
  } finally {
    pane.restore();
  }
});
