import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import type { Candidate } from './discovery';
import { PAIR_DECOY_HOST, PAIR_DECOY_PORT, withPairDecoy } from './pairDecoy';

/**
 * H7 (docs/pairing-v2-hardware-test-proposal.md): on hardware, an impostor must be able to answer the
 * Mac's pairing attempt **before** the real phone. A development switch puts a loopback decoy first —
 * only while pairing is armed, never in a packaged build, and never at any address but this Mac.
 */
const rest: Candidate[] = [{ host: '10.0.0.5', port: 42501, via: 'last-known' }, { host: '10.0.0.1', port: 42501, via: 'gateway' }];
const from = (list: Candidate[]) => async function* () { yield* list; };
async function all(it: AsyncIterable<Candidate>): Promise<Candidate[]> { const out: Candidate[] = []; for await (const c of it) out.push(c); return out; }

test('while pairing is armed, the loopback decoy is tried first, then every ordinary candidate in order', async () => {
  const got = await all(withPairDecoy(() => true, from(rest)));
  assert.deepEqual(got[0], { host: '127.0.0.1', port: PAIR_DECOY_PORT, via: 'manual' });
  assert.deepEqual(got.slice(1), rest);
});

test('with pairing not armed the decoy is never tried — a pinned reconnect sees only real candidates', async () => {
  assert.deepEqual(await all(withPairDecoy(() => false, from(rest))), rest);
});

test('the decoy is this Mac only, and its port is not a Sidekick port', () => {
  assert.equal(PAIR_DECOY_HOST, '127.0.0.1');
  assert.ok(![42501, 42502, 42503].includes(PAIR_DECOY_PORT));
});

test('main.ts reads the switch only behind app.isPackaged, so a packaged build can never use the decoy', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  const uses = main.split('\n').filter((l) => l.includes('.pairDecoyFirst'));
  assert.ok(uses.length >= 1, 'control: main.ts reads the switch');
  for (const line of uses) assert.match(line, /!app\.isPackaged &&/, line.trim());
  assert.match(main, /withPairDecoy\(/, 'and wires the decoy through withPairDecoy');
});
