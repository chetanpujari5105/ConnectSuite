import assert from 'node:assert/strict';
import test from 'node:test';

import { FilesClient } from './files';

/**
 * Defect 208, the main process's half: `thumbsFor` sends a long id list as consecutive 32-id batches, each
 * awaited. When the pane asks for another root while one is in flight, the remaining batches of the old
 * request belong to a folder no longer on screen — they are dropped, not sent. Driven through the real
 * `FilesClient` with a fake link that holds each batch until the test lets it go.
 */
function harness() {
  const sent: Array<{ rootId: string; n: number }> = [];
  const held: Array<() => void> = [];
  const link = {
    isConnected: () => true,
    request: (type: string, payload: Record<string, unknown>) => {
      if (type !== 'fs.thumb') return Promise.resolve({ type, payload: {} });
      const ids = payload.ids as string[];
      sent.push({ rootId: String(payload.rootId), n: ids.length });
      return new Promise((resolve) =>
        held.push(() => resolve({ type, payload: { thumbs: ids.map((id) => ({ id, error: 'NO_THUMBNAIL' })) } })));
    },
  };
  const client = new FilesClient(() => link as never, () => null, () => ({ host: null, token: null }));
  const drain = async () => { for (let i = 0; i < 20; i += 1) { held.shift()?.(); await new Promise((r) => setImmediate(r)); } };
  return { client, sent, drain };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('208: batches still queued for a root are dropped once another root is asked about', async () => {
  const h = harness();
  const old = h.client.thumbsFor('downloads:connectsuite', ids('100000', 96));
  await new Promise((r) => setImmediate(r));
  const fresh = h.client.thumbsFor('saf:primary%3ADCIM', ids('primary:DCIM/', 3));
  await h.drain();
  await Promise.all([old, fresh]);
  const oldBatches = h.sent.filter((s) => s.rootId === 'downloads:connectsuite').length;
  assert.equal(oldBatches, 1, `the old root's queued batches were still sent: ${JSON.stringify(h.sent)}`);
  assert.ok(h.sent.some((s) => s.rootId === 'saf:primary%3ADCIM'), 'control: the new root is asked');
});

test('control: with no other root asked, every batch of one request is sent', async () => {
  const h = harness();
  const one = h.client.thumbsFor('downloads:connectsuite', ids('100000', 96));
  await h.drain();
  await one;
  assert.deepEqual(h.sent.map((s) => s.n), [32, 32, 32]);
});

test('208: a per-item BAD_REQUEST is counted as refused on the summary line, never as gone', async () => {
  const lines: string[] = [];
  const real = console.log;
  console.log = (line: string) => { lines.push(String(line)); };
  try {
    const link = {
      isConnected: () => true,
      request: async (type: string, payload: Record<string, unknown>) => ({
        type,
        payload: { thumbs: (payload.ids as string[]).map((id) => ({ id, error: id === 'gone-1' ? 'NOT_FOUND' : 'BAD_REQUEST' })) },
      }),
    };
    const client = new FilesClient(() => link as never, () => null, () => ({ host: null, token: null }));
    await client.thumbsFor('saf:primary%3ADCIM', ['1000308768', '1000308769', 'gone-1']);
  } finally {
    console.log = real;
  }
  const summary = lines.find((l) => l.includes('fs.thumb saf:primary%3ADCIM →'));
  assert.ok(summary, `control: the summary line was captured — ${lines.length} lines`);
  assert.match(summary!, / 1 gone \/ 2 refused \(not in that root\)/);
});
