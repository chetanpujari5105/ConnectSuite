import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/**
 * The Connection & security card's decision. Every link phase the shell can hand it, and the one
 * fact per state the card exists to get right.
 *
 * **Shown to fail**: returning the connected view for `reconnecting` (a link-is-up check that reads
 * "not idle") turns the present-tense test red; giving Connecting a `disconnect` action turns the
 * no-cancel test red; dropping `endedAt` from the disconnected body turns the past-tense test red.
 */

const require_ = createRequire(import.meta.url);
const { securityCard } = require_('./securityCard.ts') as {
  securityCard(input: { phase?: string; paired: boolean; endedAt: string | null }): {
    state: string;
    title: string;
    body: string;
    actions: string[];
    layout: string;
  };
};

const PHASES = [undefined, 'idle', 'searching', 'connecting', 'handshaking', 'connected', 'reconnecting', 'disconnected'];

test('encryption is claimed in the present tense only while connected — the single fact per phase', () => {
  let connected = 0;
  for (const phase of PHASES) {
    for (const paired of [true, false]) {
      const view = securityCard({ phase, paired, endedAt: '09:42' });
      const claims = /^Encrypted|Only your devices can read/.test(`${view.title} ${view.body}`);
      if (phase === 'connected') {
        connected += 1;
        assert.ok(claims, `connected must claim encryption (${paired})`);
      } else {
        assert.ok(!claims, `${phase} / paired=${paired} claims a live encrypted link: "${view.body}"`);
      }
    }
  }
  assert.equal(connected, 2, 'control: the connected phase was visited in both pairing states');
});

test('only a connected link offers Disconnect, beside its one line', () => {
  const view = securityCard({ phase: 'connected', paired: true, endedAt: null });
  assert.deepEqual(view.actions, ['disconnect']);
  assert.equal(view.layout, 'inline');
  for (const phase of PHASES.filter((p) => p !== 'connected')) {
    assert.ok(!securityCard({ phase, paired: true, endedAt: null }).actions.includes('disconnect'), `${phase}`);
  }
});

test('connecting offers nothing, because nothing can cancel a handshake in flight', () => {
  for (const phase of ['searching', 'connecting', 'handshaking', 'reconnecting']) {
    const view = securityCard({ phase, paired: true, endedAt: '09:42' });
    assert.equal(view.state, 'connecting', phase);
    assert.deepEqual(view.actions, []);
    assert.match(view.body, /nothing has been sent/);
  }
});

test('disconnected is past tense with its time, and offers Reconnect and Troubleshoot in their own row', () => {
  const view = securityCard({ phase: 'idle', paired: true, endedAt: '09:42' });
  assert.equal(view.state, 'disconnected');
  assert.match(view.body, /was encrypted .* ended at 09:42/);
  assert.deepEqual(view.actions, ['reconnect', 'troubleshoot']);
  assert.equal(view.layout, 'stacked');
});

test('a disconnect this Mac never saw end says no time rather than inventing one', () => {
  const view = securityCard({ phase: 'disconnected', paired: true, endedAt: null });
  assert.ok(!/ended at/.test(view.body));
  assert.deepEqual(view.actions, ['reconnect', 'troubleshoot']);
});

test('an unpaired Mac claims no session and offers no action', () => {
  for (const phase of [undefined, 'idle', 'searching']) {
    const view = securityCard({ phase, paired: false, endedAt: '09:42' });
    assert.equal(view.state, 'unpaired', String(phase));
    assert.deepEqual(view.actions, []);
    assert.ok(!/ended at/.test(view.body));
  }
});
