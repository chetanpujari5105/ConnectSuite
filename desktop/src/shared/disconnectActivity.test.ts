import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disconnectActivityDetail, USER_DISCONNECTED, APP_QUIT } from './disconnectActivity';

// What the link's classifier gives a stop reason it does not recognise — the sentence the Activity
// row carried for a deliberate quit (seen on the Overview card, 2026-10-11 14:53).
const UNKNOWN = 'The connection to your phone failed. See the log for details.';

test('a deliberate quit or relaunch is not recorded as a failure', () => {
  const detail = disconnectActivityDetail('quit', { lastError: UNKNOWN, phase: 'idle' });
  assert.equal(detail, APP_QUIT);
  assert.doesNotMatch(detail, /fail/i);
});

test('a Disconnect the person pressed keeps its sentence', () => {
  assert.equal(disconnectActivityDetail('user', { lastError: UNKNOWN, phase: 'idle' }), USER_DISCONNECTED);
});

test('a real failure keeps the link\'s own sentence, including the generic one', () => {
  assert.equal(disconnectActivityDetail(null, { lastError: UNKNOWN, phase: 'waiting' }), UNKNOWN);
  const dropped = 'The connection to your phone dropped. Reconnecting.';
  assert.equal(disconnectActivityDetail(null, { lastError: dropped, phase: 'waiting' }), dropped);
  assert.equal(disconnectActivityDetail(null, { phase: 'waiting' }), 'now waiting');
});

// The write is in main.ts, which node --test cannot run, so this proves it is written the right way
// round: the quit path names its cause BEFORE it stops the link (the status callback that records
// the row runs inside stop()), and the row is drawn from this function, not a second copy of it.
test('main.ts: the quit teardown sets the cause before stopping the link, and the row uses this rule', () => {
  const main = readFileSync(join(__dirname, '..', 'main', 'main.ts'), 'utf8');
  const teardown = main.slice(main.indexOf('teardown: () => {'));
  const body = teardown.slice(0, teardown.indexOf('},'));
  const setAt = body.indexOf("stopCause = 'quit'");
  const stopAt = body.indexOf("link?.stop('app quit')");
  assert.ok(setAt >= 0, 'teardown sets the quit cause');
  assert.ok(stopAt > setAt, 'and does so before link.stop');
  assert.match(main, /disconnectActivityDetail\(stopCause, status\)/);
  assert.doesNotMatch(main, /'You disconnected the phone from this Mac'/, 'no second copy of the sentence');
});
