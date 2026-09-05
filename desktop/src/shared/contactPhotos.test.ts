import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// `createRequire`, not `import`, and the reason is the point of the file under test: it carries no
// `export` keyword, because a file that does compiles to CommonJS and throws on its first line in
// the browser. Same shape as `islandRota.test.ts`.
const require_ = createRequire(import.meta.url);
const { ContactPhotos, photoKey, MAX_PHOTOS } = require_('./contactPhotos.ts') as {
  ContactPhotos: new (
    fetcher: (number: string) => Promise<string | null>,
    onSettled?: (tally: string) => void,
    limit?: number,
  ) => {
    tally(): string;
    cached(number: string): string | null | undefined;
    resolve(number: string): Promise<string | null>;
    countSkipped(): void;
    clear(): void;
  };
  photoKey(number: string): string;
  MAX_PHOTOS: number;
};

/**
 * The photograph cache, driven through the real class.
 *
 * Every test here was shown to fail against the defect it is named for before it was kept — the
 * red-first rule — and the two that matter most are the ones about *not* asking again, because
 * their failure mode is invisible: the faces still appear, and the phone is asked fifty times a
 * redraw for answers it has already given.
 */

/** A fetcher that records what it was asked and answers from a table. */
function fetcherOver(table: Record<string, string | null>) {
  const asked: string[] = [];
  const fetch = async (number: string) => {
    asked.push(number);
    return table[number] ?? null;
  };
  return { asked, fetch };
}

test('a photograph is fetched once and served from the cache after that', async () => {
  const { asked, fetch } = fetcherOver({ '+15551234567': 'data:image/png;base64,AAA' });
  const photos = new ContactPhotos(fetch);

  assert.equal(photos.cached('+15551234567'), undefined, 'unasked reads as undefined, not null');
  assert.equal(await photos.resolve('+15551234567'), 'data:image/png;base64,AAA');
  assert.equal(await photos.resolve('+15551234567'), 'data:image/png;base64,AAA');
  assert.equal(photos.cached('+15551234567'), 'data:image/png;base64,AAA');

  assert.deepEqual(asked, ['+15551234567'], 'the phone is asked exactly once');
});

/**
 * The one that pays for the whole cache. Two thirds of this book has no photograph — 441 of 665 on
 * the handset — so "no photo" is the common answer and re-asking it is the common case.
 */
test('a contact with no photograph is remembered as such and is never asked about twice', async () => {
  const { asked, fetch } = fetcherOver({});
  const photos = new ContactPhotos(fetch);

  assert.equal(await photos.resolve('+15550000000'), null);
  assert.equal(photos.cached('+15550000000'), null, 'null means asked-and-absent, not unasked');
  assert.equal(await photos.resolve('+15550000000'), null);

  assert.deepEqual(asked, ['+15550000000'], 'an absence is cached exactly as hard as a hit');
});

/**
 * The race `CLAUDE.md` names: two correct triggers, one fetch. The live card and the log row for
 * the same caller are drawn in the same frame by two different code paths.
 */
test('a second caller joins the request in flight rather than starting a second', async () => {
  let release: (value: string | null) => void = () => {};
  const asked: string[] = [];
  const photos = new ContactPhotos(async (number) => {
    asked.push(number);
    return new Promise<string | null>((resolve) => {
      release = resolve;
    });
  });

  const first = photos.resolve('+15551234567');
  const second = photos.resolve('+15551234567');
  assert.deepEqual(asked, ['+15551234567'], 'one request, not two');

  release('data:image/png;base64,BBB');
  assert.equal(await first, 'data:image/png;base64,BBB');
  assert.equal(await second, 'data:image/png;base64,BBB', 'the joiner gets the same answer');
});

/**
 * A failure is counted and **not** cached, which is the opposite of an absence.
 *
 * A photograph that failed because the link dropped is a question that was never answered; caching
 * it would mean the face never comes back on a link that has. The count is what keeps that from
 * being a silent `getOrNull` — defect 57's shape.
 */
test('a rejected fetch answers null, is counted, and is asked again next time', async () => {
  let failNext = true;
  const asked: string[] = [];
  const photos = new ContactPhotos(async (number) => {
    asked.push(number);
    if (failNext) {
      failNext = false;
      throw new Error('the link dropped');
    }
    return 'data:image/png;base64,CCC';
  });

  assert.equal(await photos.resolve('+15551234567'), null, 'a failure degrades, it does not throw');
  assert.match(photos.tally(), /1 failed/);
  assert.equal(photos.cached('+15551234567'), undefined, 'a failure is not an answer');

  assert.equal(await photos.resolve('+15551234567'), 'data:image/png;base64,CCC');
  assert.deepEqual(asked.length, 2, 'the second attempt is made');
});

test('two spellings of one number share a cache entry', async () => {
  const { asked, fetch } = fetcherOver({ '+1 (555) 123-4567': 'data:image/png;base64,DDD' });
  const photos = new ContactPhotos(fetch);

  assert.equal(await photos.resolve('+1 (555) 123-4567'), 'data:image/png;base64,DDD');
  assert.equal(photos.cached('+1555 123 4567'), 'data:image/png;base64,DDD');
  assert.deepEqual(asked, ['+1 (555) 123-4567']);

  assert.equal(photoKey('+1 (555) 123-4567'), '+15551234567');
  assert.equal(photoKey('+1555 123 4567'), '+15551234567');
});

test('an empty number is answered null without a request', async () => {
  const { asked, fetch } = fetcherOver({});
  const photos = new ContactPhotos(fetch);
  assert.equal(await photos.resolve(''), null);
  assert.equal(photos.cached(''), null);
  assert.deepEqual(asked, [], 'nothing to look up is not a lookup');
});

test('the cache is bounded, and the oldest entry is the one that goes', async () => {
  const photos = new ContactPhotos(async (number) => `data:image/png;base64,${number}`, () => {}, 3);
  for (const number of ['1', '2', '3', '4']) await photos.resolve(number);

  assert.equal(photos.cached('1'), undefined, 'the oldest was evicted');
  assert.equal(photos.cached('4'), 'data:image/png;base64,4');
  assert.match(photos.tally(), /3 held/);
  assert.equal(MAX_PHOTOS, 300, 'the shipping bound, stated so a change to it is deliberate');
});

test('clear drops everything, because a face outliving its link is a stale claim', async () => {
  const { asked, fetch } = fetcherOver({ '+1': 'data:image/png;base64,EEE' });
  const photos = new ContactPhotos(fetch);
  await photos.resolve('+1');
  photos.clear();
  assert.equal(photos.cached('+1'), undefined);
  await photos.resolve('+1');
  assert.equal(asked.length, 2, 'a cleared cache asks again');
});

/**
 * The instrument rule, as a test.
 *
 * `onSettled` must fire when the answers are in, not when the requests go out — a tally taken at
 * the end of a render reports `0 found` however many photographs exist, which is a true number
 * about the wrong moment. This asserts on the *content* of the tally at the moment it is
 * published, which is the only thing that can tell the two apart.
 */
test('the tally is published when the batch settles, and carries the answers', async () => {
  const releases: ((value: string | null) => void)[] = [];
  const published: string[] = [];
  const photos = new ContactPhotos(
    async () => new Promise<string | null>((resolve) => releases.push(resolve)),
    (tally) => published.push(tally),
  );

  void photos.resolve('+1');
  void photos.resolve('+2');
  photos.countSkipped();
  assert.deepEqual(published, [], 'nothing is published while requests are in the air');

  releases[0]!('data:image/png;base64,FFF');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(published, [], 'one of two settled is not a settled batch');

  releases[1]!(null);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(published.length, 1, 'published once, when the last request finished');
  assert.match(published[0]!, /1 found \/ 1 none \/ 0 failed, 1 not asked/);
});
