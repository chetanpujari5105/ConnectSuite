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
