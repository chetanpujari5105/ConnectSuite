/**
 * The exclusion's decision table, printed and asserted.
 *
 * Run: node scripts/step70-exclusion.test.mjs
 *
 * Same reason as the gate's fixtures: this is meant to be read *before* a ring is spent, so that
 * "only one process can click" is something you can check rather than something you remember. The
 * lock half is tested against a real file in a temp path, because a lock that works on paper and
 * not on disk is the failure this replaces.
 */
import {
  refusalsFor,
  refusalText,
  lockIsStale,
  acquireLock,
  readLock,
  releaseLock,
  clearStaleLock,
  pidAlive,
  LOCK_PATH,
  cdpClientsFromLsof,
} from './step70-exclusion.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

const LIVE_LOCK = { pid: 4242, startedAt: '2026-08-30T19:45:00', expecting: '8800000004' };

const cases = [
  {
    name: 'nothing else running, nothing attached — this is the only case that arms',
    input: { lock: null, ownerAlive: false, cdpClients: 0 },
    expect: 'ARM',
  },
  {
    name: 'a second watcher, with the first one still alive — the hole this file closes',
    input: { lock: LIVE_LOCK, ownerAlive: true, cdpClients: 0 },
    expect: 'REFUSE',
  },
  {
    name: 'a lock left by a watcher that was Ctrl-C-ed — stale, and must not wedge the retry',
    input: { lock: LIVE_LOCK, ownerAlive: false, cdpClients: 0 },
    expect: 'ARM',
  },
  {
    name: 'a DevTools window or another session attached to 9222',
    input: { lock: null, ownerAlive: false, cdpClients: 1 },
    expect: 'REFUSE',
  },
  {
    name: 'both at once — both must be said, or someone fixes half and retries',
    input: { lock: LIVE_LOCK, ownerAlive: true, cdpClients: 3 },
    expect: 'REFUSE',
    reasons: 2,
  },
  {
    name: 'the client count could not be taken — unproven is not the same as zero',
    input: { lock: null, ownerAlive: false, cdpClients: null },
    expect: 'REFUSE',
  },
  {
    name: 'the count is unprovable but waived on the command line — opt-in, and it says so',
    input: { lock: null, ownerAlive: false, cdpClients: null, skipCdpCheck: true },
    expect: 'ARM',
  },
  {
    name: 'the waiver does NOT widen the lock clause — a live second watcher is still refused',
    input: { lock: LIVE_LOCK, ownerAlive: true, cdpClients: 9, skipCdpCheck: true },
    expect: 'REFUSE',
    reasons: 1,
  },
];

let bad = 0;
for (const c of cases) {
  const reasons = refusalsFor(c.input);
  const got = reasons.length === 0 ? 'ARM' : 'REFUSE';
  const mark = got === c.expect ? 'ok  ' : 'FAIL';
  if (got !== c.expect) bad += 1;
  if (c.reasons !== undefined && reasons.length !== c.reasons) {
    bad += 1;
    console.log(`FAIL expected ${c.reasons} reason(s), got ${reasons.length}`);
  }
  console.log(`${mark} ${got.padEnd(6)} ${c.name}`);
  console.log(
    `       lock=${c.input.lock ? `pid ${c.input.lock.pid} ${c.input.ownerAlive ? 'alive' : 'dead'}` : 'none'}` +
      `  cdpClients=${c.input.cdpClients}${c.input.skipCdpCheck ? '  --skip-cdp-check' : ''}`,
  );
  if (reasons.waived) console.log(`       waived: ${reasons.waived}`);
  for (const r of reasons) console.log(`       refuses: ${r.split('.')[0]}.`);
  console.log();
}

// ---- the controls, per CLAUDE.md: a check must be shown to separate signal from lookalike ----

// 1. The refusal must NAME the offending pid. A refusal that does not say which process to stop
//    sends someone hunting, and the next person removes the gate to find out — which is the exact
//    failure the "say what it refused and why" rule was written for.
assert.match(
  refusalsFor({ lock: LIVE_LOCK, ownerAlive: true, cdpClients: 0 })[0],
  /pid 4242/,
  'the refusal must name the pid holding the lock',
);

// 2. The client-count refusal must carry the count, not merely assert a problem. A number with no
//    scale is the shape this project keeps finding defects behind.
assert.match(
  refusalsFor({ lock: null, ownerAlive: false, cdpClients: 3 })[0],
  /3 other clients are attached/,
  'the refusal must carry the client count',
);

// 3. lockIsStale must be able to answer BOTH ways, or it is not discriminating. A predicate that
//    always says "stale" would pass case 3 above and silently defeat the whole file.
assert.equal(lockIsStale(LIVE_LOCK, true), false, 'a live owner must not read as stale');
assert.equal(lockIsStale(LIVE_LOCK, false), true, 'a dead owner must read as stale');
assert.equal(lockIsStale(null, false), true, 'no lock at all is takeable');

// 4. pidAlive must return true for a process that certainly exists — this one. Without this
//    control, a pidAlive that always returned false would make every lock look stale and the
//    exclusion would pass its own tests while excluding nothing.
assert.equal(pidAlive(process.pid), true, 'this process must read as alive');
assert.equal(pidAlive(0x7ffffff0), false, 'an absurd pid must not read as alive');

// 5. The lock must actually be exclusive ON DISK, not just in the predicate.
const TEST_LOCK = join(tmpdir(), `connectsuite-step70-exclusion-test-${process.pid}.lock`);
releaseLock(TEST_LOCK);
acquireLock({ startedAt: 'now', expecting: '8800000004' }, TEST_LOCK);
assert.throws(
  () => acquireLock({ startedAt: 'now' }, TEST_LOCK),
  /EEXIST/,
  'a second acquire must fail rather than overwrite — this is the whole exclusion',
);
assert.equal(readLock(TEST_LOCK).pid, process.pid, 'the lock must record who holds it');
assert.equal(clearStaleLock(TEST_LOCK), null, 'a lock held by a LIVE process is not stale');
assert.equal(existsSync(TEST_LOCK), true, 'and must therefore still be on disk');
releaseLock(TEST_LOCK);
assert.equal(readLock(TEST_LOCK), null, 'release must remove it');

// 6. A stale lock on disk must be clearable, or a Ctrl-C wedges every future run.
acquireLock({ startedAt: 'then' }, TEST_LOCK);
// Rewrite it as though a long-dead process held it.
const { writeFileSync } = await import('node:fs');
writeFileSync(TEST_LOCK, JSON.stringify({ pid: 0x7ffffff0, startedAt: 'then' }));
assert.notEqual(clearStaleLock(TEST_LOCK), null, 'a dead owner’s lock must be clearable');
assert.equal(existsSync(TEST_LOCK), false, 'and must be gone afterwards');

// 7. refusalText must say the phone was not touched. The watcher exits on this path and the next
//    reader must not be left wondering whether a click went out first.
assert.match(
  refusalText(refusalsFor({ lock: LIVE_LOCK, ownerAlive: true, cdpClients: 0 })),
  /Nothing was armed and the phone was not touched/,
  'the refusal must state that nothing happened',
);

// 8. The lsof parser, against real captured output. Its first version counted sockets and halved
//    them, and reported "2 other clients" for ONE attached watcher — because a CDP client opens a
//    keep-alive socket for GET /json and a second for the WebSocket. Captured 2026-08-30 with
//    exactly one client (node 42340) attached to Electron 28715.
const LSOF_ONE_CLIENT = `COMMAND    PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
Electron 28715 chetan   31u  IPv4 0x3ed77e5b3b19173f      0t0  TCP 127.0.0.1:9222 (LISTEN)
Electron 28715 chetan   58u  IPv4 0x4129d21033b39df5      0t0  TCP 127.0.0.1:9222->127.0.0.1:52048 (ESTABLISHED)
Electron 28715 chetan   59u  IPv4 0x4be10272ca1fcf23      0t0  TCP 127.0.0.1:9222->127.0.0.1:52050 (ESTABLISHED)
node     42340 chetan   14u  IPv4 0x75732ce810a0d06f      0t0  TCP 127.0.0.1:52048->127.0.0.1:9222 (ESTABLISHED)
node     42340 chetan   15u  IPv4 0x7c8a6e5ee330cec6      0t0  TCP 127.0.0.1:52050->127.0.0.1:9222 (ESTABLISHED)`;
assert.equal(
  cdpClientsFromLsof(LSOF_ONE_CLIENT, 999999), 1,
  'one client process holding two sockets must count as ONE, not two',
);
// The control: the listener alone, nothing attached, must read zero rather than "some".
const LSOF_IDLE = `COMMAND    PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
Electron 28715 chetan   31u  IPv4 0x3ed77e5b3b19173f      0t0  TCP 127.0.0.1:9222 (LISTEN)`;
assert.equal(cdpClientsFromLsof(LSOF_IDLE, 999999), 0, 'a bare listener is zero clients');
// And the caller must not count itself, or the watcher would refuse to arm on its own account.
assert.equal(
  cdpClientsFromLsof(LSOF_ONE_CLIENT, 42340), 0,
  'the calling process must be excluded from its own count',
);
// Two genuinely different clients must read as two.
assert.equal(
  cdpClientsFromLsof(LSOF_ONE_CLIENT.replace('node     42340 chetan   15u', 'node     51111 chetan   15u'), 999999),
  2,
  'two distinct client pids must count as two',
);

console.log(`the real lock path in use is ${LOCK_PATH}`);
console.log(bad === 0 ? 'all exclusion cases behave as written' : `${bad} CASE(S) WRONG`);
process.exit(bad === 0 ? 0 : 1);
