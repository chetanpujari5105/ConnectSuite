import assert from 'node:assert/strict';
import test from 'node:test';

import '../renderer/photos';

/**
 * The Photos pane's pure half — the copy and the formatting.
 *
 * Same seam as `calls.test.ts`: `photos.ts` is a plain `<script>` with no top-level side effects,
 * so importing it executes nothing and the rules come back off the global it hangs them on. The
 * point is to run the code that draws the words, not a second copy of them — which on this pane
 * matters more than usual, because the words *are* the feature: this is the first pane whose job
 * is to explain that it works and does not entirely work.
 */
const labels = (globalThis as Record<string, unknown>).__photoLabels as {
  partialNotice(advertised: boolean): { headline: string; detail: string } | null;
  albumCount(count: number): string;
  itemSummary(item: {
    kind: 'image' | 'video';
    size: number;
    width: number | null;
    height: number | null;
    dateMs: number;
    durationMs: number | null;
  }): string;
  fileSize(bytes: number): string;
  clockOf(ms: number): string;
  albumSource(bucket: { bucketName: string; packageName?: string; appName?: string }): string;
};

test('the partial notice names the missing half and what still works', () => {
  const notice = labels.partialNotice(false)!;
  // Not "limited functionality" and not "coming soon": a user who is about to double-click a photo
  // has to learn, before they do, that the full-size original is the part that is not here.
  assert.match(notice.detail, /full-size originals/i);
  assert.match(notice.detail, /file channel/i);
  assert.match(notice.headline, /thumbnails/i);

  // And it must not read as a failure. The pane works; a feature arriving in two halves is not an
  // error, and the vocabulary of failure here would say "the link is down" to someone whose link
  // is fine.
  for (const text of [notice.headline, notice.detail]) {
    assert.doesNotMatch(text, /error|failed|broken|cannot connect/i);
  }
});

test('the notice disappears the moment the capability is advertised', () => {
  // The banner and the chip are driven by one fact, so they cannot disagree. This is the stale-copy
  // defect the pane replaced on its way in — text describing the build, going stale where nothing
  // could see it — turned into an assertion instead of a habit.
  assert.equal(labels.partialNotice(true), null);
  assert.notEqual(labels.partialNotice(false), null);
});

test('an album owned by an app is labelled with the app, never the package id', () => {
  // The package-id rule at its landing point on this pane. The phone sends both; only one is drawn.
  assert.equal(
    labels.albumSource({
      bucketName: 'WhatsApp Images',
      packageName: 'com.whatsapp',
      appName: 'WhatsApp',
    }),
    'WhatsApp',
  );
  // A bucket with no package segment gets no source line at all, rather than an invented one. If
  // this returned the bucket name, every album would sprout a redundant subtitle and the rule
  // would be indistinguishable from no rule.
  assert.equal(labels.albumSource({ bucketName: 'Camera' }), '');
});

test('a package id is never what a person reads, even when resolution failed', () => {
  // AppLabels on the phone falls back to the package id, so `appName` can *be* the package id.
  // That is the phone's honest fallback and the Mac must not second-guess it — but it must also
  // never draw `packageName` itself, which is the field this pane could most easily leak.
  const drawn = labels.albumSource({
    bucketName: 'Playo',
    packageName: 'com.techmash.playo',
    appName: 'com.techmash.playo',
  });
  assert.equal(drawn, 'com.techmash.playo');
});

test('sizes are readable, and the boundary between units is not off by one', () => {
  assert.equal(labels.fileSize(512), '512 B');
  assert.equal(labels.fileSize(1024), '1.0 KB');
  assert.equal(labels.fileSize(1536), '1.5 KB');
  assert.equal(labels.fileSize(3_874_112), '3.7 MB');
  // Ten and above loses the decimal, so a column of sizes stays the same width.
  assert.equal(labels.fileSize(12 * 1024 * 1024), '12 MB');
  assert.equal(labels.fileSize(2 * 1024 * 1024 * 1024), '2.0 GB');
});

test('a video length reads as a clock, with a padded seconds field', () => {
  assert.equal(labels.clockOf(64_000), '1:04');
  assert.equal(labels.clockOf(3_000), '0:03');
  assert.equal(labels.clockOf(600_000), '10:00');
});

test('the summary skips what the phone did not send rather than drawing a gap', () => {
  const withoutDimensions = labels.itemSummary({
    kind: 'image',
    size: 1024,
    width: null,
    height: null,
    dateMs: Date.UTC(2024, 4, 15, 12, 8),
    durationMs: null,
  });
  // No leading separator, no "null × null" — a missing field is absent, not empty.
  assert.doesNotMatch(withoutDimensions, /null|undefined|NaN/);
  assert.ok(!withoutDimensions.startsWith(' · '));
  assert.match(withoutDimensions, /^1\.0 KB · /);

  const video = labels.itemSummary({
    kind: 'video',
    size: 10 * 1024 * 1024,
    width: 1920,
    height: 1080,
    dateMs: Date.UTC(2024, 4, 15, 12, 8),
    durationMs: 64_000,
  });
  assert.match(video, /1920 × 1080/);
  assert.match(video, /1:04/);
});

test('a count is grouped, because six figures of photos is otherwise unreadable', () => {
  // This phone's Camera bucket really does hold 16,369 items.
  assert.equal(labels.albumCount(16369), (16369).toLocaleString());
  assert.notEqual(labels.albumCount(16369), '16369');
});

// ---- Day headings, and the boundary a test has to sit either side of ------------------------------

/**
 * `dayHeading` takes `nowMs` as a parameter, which is what makes these tests possible at all.
 *
 * `CLAUDE.md`'s defect 67 is the case where a suite proves a decision and is silent about the state,
 * because the field under test is written somewhere a test cannot reach. Midnight is the same shape
 * of problem — it cannot be reached by waiting — so the transition is a parameter and every test
 * below crosses it on purpose.
 */
const headings = (globalThis as Record<string, unknown>).__photoLabels as {
  dayHeading(dateMs: number, nowMs: number): string;
  groupByDay(items: ReadonlyArray<{ id: string; dateMs: number }>, nowMs: number): Array<{
    heading: string;
    items: Array<{ id: string }>;
  }>;
  albumSubtitle(
    album: { bucketName: string; count: number; appName?: string },
    counts: ReadonlyMap<string, number>,
  ): string | null;
  albumNameCounts(albums: ReadonlyArray<{ bucketName: string }>): Map<string, number>;
};

/** 15 May 2024, 14:30 local — the design's own week. */
const NOW = new Date(2024, 4, 15, 14, 30).getTime();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

test('a photo from this morning is Today, and one from 00:00 today still is', () => {
  assert.equal(headings.dayHeading(at(2024, 4, 15, 9), NOW), 'Today');
  assert.equal(headings.dayHeading(new Date(2024, 4, 15, 0, 0, 0, 0).getTime(), NOW), 'Today');
});

test('one millisecond before midnight is Yesterday, not Today', () => {
  // The boundary in the direction that matters: a photo taken at 23:59:59.999 is emphatically not
  // "today" to the person who took it, and an off-by-one here is invisible except at that minute.
  const lastMoment = new Date(2024, 4, 15, 0, 0, 0, 0).getTime() - 1;
  assert.equal(headings.dayHeading(lastMoment, NOW), 'Yesterday');
});

test('inside the last week a weekday name, beyond it a date', () => {
  // 12 May 2024 was a Sunday; three days back is inside the window.
  assert.equal(headings.dayHeading(at(2024, 4, 12), NOW), 'Sunday');
  // Eight days back is outside it, and a weekday name would be ambiguous rather than helpful.
  assert.match(headings.dayHeading(at(2024, 4, 7), NOW), /^7 May$|^May 7$/);
});

test('a photo from another year carries the year; one from this year does not', () => {
  assert.match(headings.dayHeading(at(2023, 4, 14), NOW), /2023/);
  assert.doesNotMatch(headings.dayHeading(at(2024, 3, 14), NOW), /2024/);
});

test('midnight is a real day boundary, not now minus 86,400,000', () => {
  // The two days a year a day is not 24 hours are exactly when subtraction puts yesterday's photos
  // under Today. Asserted through the local-midnight path rather than by picking a DST date, which
  // would make the test depend on the runner's timezone.
  const justAfterMidnight = new Date(2024, 4, 15, 0, 0, 1).getTime();
  const nowJustAfterMidnight = new Date(2024, 4, 15, 0, 0, 30).getTime();
  assert.equal(headings.dayHeading(justAfterMidnight, nowJustAfterMidnight), 'Today');
  const twentyThreeHoursEarlier = justAfterMidnight - 23 * 3600 * 1000;
  assert.equal(headings.dayHeading(twentyThreeHoursEarlier, nowJustAfterMidnight), 'Yesterday');
});

test('groupByDay cuts on the heading changing and preserves arrival order', () => {
  const items = [
    { id: 'a', dateMs: at(2024, 4, 15, 11) },
    { id: 'b', dateMs: at(2024, 4, 15, 9) },
    { id: 'c', dateMs: at(2024, 4, 14, 20) },
    { id: 'd', dateMs: at(2024, 3, 2) },
  ];
  const groups = headings.groupByDay(items, NOW);
  assert.deepEqual(
    groups.map((g) => [g.heading, g.items.map((i) => i.id)]),
    [
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      [groups[2].heading, ['d']],
    ],
  );
});

test('groupByDay does not sort — a day arriving twice draws twice', () => {
  // Deliberate. `media.list` owns the ordering and its whole paging argument rests on that; a
  // second expression of the same rule here is the shape that makes a test assert a copy. So an
  // out-of-order stream produces a visible repeat rather than a silently repaired one.
  const groups = headings.groupByDay(
    [
      { id: 'a', dateMs: at(2024, 4, 15, 11) },
      { id: 'b', dateMs: at(2024, 4, 14, 11) },
      { id: 'c', dateMs: at(2024, 4, 15, 8) },
    ],
    NOW,
  );
  assert.deepEqual(groups.map((g) => g.heading), ['Today', 'Yesterday', 'Today']);
});

// ---- The album rail's duplicate names -------------------------------------------------------------

test('a unique album name keeps the app label alone as its subtitle', () => {
  const albums = [{ bucketName: 'Camera', count: 16420 }, { bucketName: 'Screenshots', count: 3760 }];
  const counts = headings.albumNameCounts(albums);
  assert.equal(headings.albumSubtitle({ bucketName: 'Camera', count: 16420 }, counts), null);
  assert.equal(
    headings.albumSubtitle({ bucketName: 'Camera', count: 16420, appName: 'Camera app' }, counts),
    'Camera app',
  );
});

test('two albums with one name are told apart by the only thing on the wire', () => {
  // This phone draws two rows both reading "WhatsApp Images" — 500 items and 5,781 — because
  // bucket_display_name is the leaf directory name and two different directories collide.
  const albums = [
    { bucketName: 'WhatsApp Images', count: 500 },
    { bucketName: 'WhatsApp Images', count: 5781 },
    { bucketName: 'Camera', count: 16420 },
  ];
  const counts = headings.albumNameCounts(albums);
  assert.equal(
    headings.albumSubtitle({ bucketName: 'WhatsApp Images', count: 500, appName: 'WhatsApp' }, counts),
    'WhatsApp · 500 items',
  );
  assert.equal(
    headings.albumSubtitle({ bucketName: 'WhatsApp Images', count: 5781, appName: 'WhatsApp' }, counts),
    'WhatsApp · 5,781 items',
  );
  // The control: the row that does not collide is untouched by the disambiguation.
  assert.equal(headings.albumSubtitle({ bucketName: 'Camera', count: 16420 }, counts), null);
});
