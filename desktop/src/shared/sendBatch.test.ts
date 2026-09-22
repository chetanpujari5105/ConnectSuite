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

test('serial: nothing new starts while one is sending, and stop cancels only the queue', () => {
  let batch = two();
  assert.equal(sendBatchNext(batch).source, '/tmp/a.jpg');
  batch = sendBatchOnAgreed(batch, '/tmp/a.jpg', 't-1', 'a.jpg');
  assert.equal(sendBatchNext(batch), null);
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
