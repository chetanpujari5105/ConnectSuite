import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  sendBatchCreate,
  sendBatchOnAgreed,
  sendBatchOnProgress,
  sendBatchOnWriteFinished,
  sendBatchOnDone,
  sendBatchStop,
  sendBatchSettled,
  sendBatchNext,
  sendBatchSummary,
  suffixedName,
  sendBatchOnStarted,
  sendNameKey,
  SEND_WINDOW,
} = require('./sendBatch.ts');

const two = () =>
  sendBatchCreate(
    [
      { source: '/tmp/a.jpg', name: 'a.jpg', size: 1000 },
      { source: '/tmp/b.pdf', name: 'b.pdf', size: 3000 },
    ],
    'Samsung SM-S938B',
    'Received files',
  );

test('the Mac finishing its write is not arrival — only the phone’s done is', () => {
  let batch = two();
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchOnWriteFinished(batch, '/tmp/a.jpg', { ok: true });
  assert.equal(batch.items[0].phase, 'confirming');
  assert.equal(sendBatchSummary(batch).arrived, 0);
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: true });
  assert.equal(batch.items[0].phase, 'arrived');
  assert.equal(batch.items[0].verified, true);
});

test('done arriving before the write resolves is not downgraded afterwards', () => {
  let batch = two();
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: false });
  batch = sendBatchOnWriteFinished(batch, '/tmp/a.jpg', { ok: true });
  assert.equal(batch.items[0].phase, 'arrived');
  assert.equal(batch.items[0].verified, false, 'unverified stays unverified — never upgraded');
});

test('the bar is the phone’s delivered bytes over total bytes, not a file count', () => {
  let batch = two();
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: true });
  // One of two files arrived, but it is a quarter of the bytes.
  assert.equal(sendBatchSummary(batch).fraction, 0.25);
  batch = sendBatchOnAgreed(batch, '/tmp/b.pdf', 't-2', 'b.pdf');
  batch = sendBatchOnProgress(batch, 't-2', 1500);
  assert.equal(sendBatchSummary(batch).fraction, 2500 / 4000);
});

test('progress never moves backwards and never exceeds the size', () => {
  let batch = two();
  batch = sendBatchOnAgreed(batch, '/tmp/b.pdf', 't-2', 'b.pdf');
  batch = sendBatchOnProgress(batch, 't-2', 2000);
  batch = sendBatchOnProgress(batch, 't-2', 1000);
  assert.equal(batch.items[1].delivered, 2000);
  batch = sendBatchOnProgress(batch, 't-2', 9_999_999);
  assert.equal(batch.items[1].delivered, 3000);
});

test('a refusal carries the phone’s own sentence and code', () => {
  let batch = two();
  batch = sendBatchOnWriteFinished(batch, '/tmp/a.jpg', {
    ok: false,
    reason: 'Received files has 10 MB free.',
    code: 'NO_SPACE',
  });
  assert.equal(batch.items[0].phase, 'failed');
  assert.equal(batch.items[0].code, 'NO_SPACE');
  assert.match(sendBatchSummary(batch).detail, /0 of 2 arrived · 1 failed/);
});

test('a failed done keeps the phone’s message', () => {
  let batch = two();
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchOnDone(batch, {
    transferId: 't-1',
    ok: false,
    code: 'CHECKSUM_MISMATCH',
    message: 'a.jpg arrived damaged and was deleted.',
  });
  assert.equal(batch.items[0].phase, 'failed');
  assert.equal(batch.items[0].reason, 'a.jpg arrived damaged and was deleted.');
});

test('stop cancels only the queue; a file already started reports for itself', () => {
  let batch = two();
  assert.equal(sendBatchNext(batch).source, '/tmp/a.jpg');
  batch = sendBatchOnStarted(batch, '/tmp/a.jpg');
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchStop(batch);
  assert.equal(batch.items[0].phase, 'sending', 'the in-flight item reports for itself');
  assert.equal(batch.items[1].phase, 'cancelled');
  assert.equal(sendBatchNext(batch), null);
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: false, code: 'TRANSFER_FAILED' });
  assert.equal(batch.items[0].phase, 'cancelled', 'a failure after Stop is the stop, not a fault');
  assert.equal(sendBatchSettled(batch), true);
  // Bytes did move before the Stop, and the phone keeps them to resume: "nothing arrived" is true,
  // "nothing was sent" is not.
  assert.equal(sendBatchSummary(batch).headline, 'Stopped — nothing arrived');
  assert.match(sendBatchSummary(batch).detail, /2 stopped/);
});

const many = (names: string[]) =>
  sendBatchCreate(names.map((n, i) => ({ source: `/d${i}/${n}`, name: n, size: 1000 })), 'Samsung SM-S938B', 'Received files');

/** Start whatever sendBatchNext hands out until it says wait; returns the sources started, in order. */
function startAll(batch: ReturnType<typeof many>): { batch: ReturnType<typeof many>; started: string[] } {
  const started: string[] = [];
  for (let next = sendBatchNext(batch); next; next = sendBatchNext(batch)) {
    started.push(next.source);
    batch = sendBatchOnStarted(batch, next.source);
  }
  return { batch, started };
}

test('up to SEND_WINDOW files are in flight at once, and a verdict frees a slot', () => {
  assert.equal(SEND_WINDOW, 3);
  let { batch, started } = startAll(many(['1.bin', '2.bin', '3.bin', '4.bin', '5.bin']));
  assert.deepEqual(started, ['/d0/1.bin', '/d1/2.bin', '/d2/3.bin']);
  // The Mac finishing its write does not free a slot: the phone has not said anything yet.
  batch = sendBatchOnAgreed(batch, '/d0/1.bin', 't-1', '1.bin');
  batch = sendBatchOnWriteFinished(batch, '/d0/1.bin', { ok: true });
  assert.equal(sendBatchNext(batch), null);
  // The phone's verdict does.
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: true });
  assert.equal(sendBatchNext(batch).source, '/d3/4.bin');
});

test('a file started but not yet agreed is never handed out twice', () => {
  let batch = many(['1.bin', '2.bin']);
  const first = sendBatchNext(batch);
  batch = sendBatchOnStarted(batch, first.source);
  assert.equal(batch.items[0].phase, 'sending');
  assert.equal(batch.items[0].transferId, null);
  assert.notEqual(sendBatchNext(batch)?.source, first.source);
  // The phone's agreement lands on the started item.
  batch = sendBatchOnAgreed(batch, first.source, 't-1', '1.bin');
  assert.equal(batch.items[0].transferId, 't-1');
  assert.equal(batch.items[0].sentAs, '1.bin');
});

test('a file whose name could collide on the phone waits for the earlier one’s verdict', () => {
  // The phone's Received files reuses a pending item with the same display name (its resume path),
  // and its names are case-insensitive, and a TARGET_STALE retry renames to "stem (n).ext". So two
  // files that could reach the same name must never be in flight together — not even while the
  // first is only waiting for its verdict, which is when the phone is still writing it.
  let { batch, started } = startAll(many(['a.jpg', 'A.JPG', 'a (2).jpg', 'b.jpg']));
  assert.deepEqual(started, ['/d0/a.jpg', '/d3/b.jpg']);
  batch = sendBatchOnAgreed(batch, '/d0/a.jpg', 't-1', 'a.jpg');
  batch = sendBatchOnWriteFinished(batch, '/d0/a.jpg', { ok: true });
  assert.equal(sendBatchNext(batch), null, 'still unconfirmed by the phone: the next a.jpg waits');
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: true });
  assert.equal(sendBatchNext(batch).source, '/d1/A.JPG', 'then the next one, in order');
});

test('sendNameKey folds case and the retry suffix, and nothing else', () => {
  assert.equal(sendNameKey('IMG_1 (2).jpg'), sendNameKey('img_1.JPG'));
  assert.equal(sendNameKey('README (3)'), sendNameKey('readme'));
  assert.notEqual(sendNameKey('IMG_1.jpg'), sendNameKey('IMG_12.jpg'));
  assert.notEqual(sendNameKey('a.jpg'), sendNameKey('a.jpeg'));
  // Every name suffixedName can produce keys back to the original.
  for (const n of ['IMG_1.jpg', 'archive.tar.gz', 'README', '.env']) {
    for (let k = 1; k <= 12; k += 1) assert.equal(sendNameKey(suffixedName(n, k)), sendNameKey(n), `${n} #${k}`);
  }
});

test('the headline says arrived only when every item has', () => {
  let batch = two();
  for (const [src, id] of [['/tmp/a.jpg', 't-1'], ['/tmp/b.pdf', 't-2']]) {
    batch = sendBatchOnAgreed(batch, src, id, src.slice(5));
    batch = sendBatchOnWriteFinished(batch, src, { ok: true });
  }
  assert.match(sendBatchSummary(batch).headline, /^Sending 2 files/);
  batch = sendBatchOnDone(batch, { transferId: 't-1', ok: true, bytes: 1000, verified: true });
  batch = sendBatchOnDone(batch, { transferId: 't-2', ok: true, bytes: 3000, verified: true });
  assert.equal(sendBatchSummary(batch).headline, '2 files arrived on Samsung SM-S938B');
});

test('suffixedName is the pull rule: stem (n).ext, dotfiles and extensionless kept whole', () => {
  assert.equal(suffixedName('IMG_1.jpg', 1), 'IMG_1.jpg');
  assert.equal(suffixedName('IMG_1.jpg', 2), 'IMG_1 (2).jpg');
  assert.equal(suffixedName('archive.tar.gz', 3), 'archive.tar (3).gz');
  assert.equal(suffixedName('README', 2), 'README (2)');
  assert.equal(suffixedName('.env', 2), '.env (2)');
});
