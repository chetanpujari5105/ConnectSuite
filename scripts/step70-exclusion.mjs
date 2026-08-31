// Exclusion for the step 70 watcher: one watcher, one CDP client, or it refuses to arm.
//
// ### Why this exists
//
// `CLAUDE.md` says the reject is "one click on `#call-reject`. Never two; it is not an arming
// control." Until this file, that rule was enforced by **nobody**: `step70-watch.mjs` took no lock,
// wrote no pidfile and checked for no other instance, and CDP on 9222 accepts any number of
// simultaneous clients. Two watchers would both attach, both read the same `Ringing` card, both
// pass the gate — the gate is a correctness check on *which* call, not a claim on the right to act
// — and both click. The second click lands on a call the first one already rejected, or on
// whatever replaced it.
//
// **Found by inspection on 2026-08-30, not by a second near-miss.** The session that wrote this was
// counting peer sessions before a ring and found nine alive, one of them a background agent whose
// stated purpose was to click a call control. Nothing had gone wrong yet. That is the only cheap
// moment to write this, and `CLAUDE.md`'s last section is explicit that a rule enforced by someone
// remembering is a rule that will be broken — the force-stop warning was broken four sections after
// it was written, by its own author, on the same day.
//
// The pure predicates live here so they can be tested without a phone, a lock, or a second process,
// per the testable-seam rule. `step70-exclusion.test.mjs` holds the fixtures; a matcher without
// fixtures is a rule you are guessing about (defect 41).

import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * One well-known path, so two watchers started from different cwds still collide.
 *
 * `/tmp` rather than `os.tmpdir()`, which on macOS returns a per-user private folder under
 * `/var/folders/...`. Two implementations that pick different paths exclude nothing — both watchers
 * take "their" lock and both arm — and this file briefly had that bug for real on 2026-08-30, when
 * a second session added its own lock at `/tmp` while this one used `tmpdir()`. The path is also
 * printed in the refusal, so it has to be one a person can find and delete.
 */
export const LOCK_PATH = '/tmp/connectsuite-step70-watch.lock';

/** The debugging port the watcher drives. Named once; the CDP check and the watcher share it. */
export const CDP_PORT = 9222;

// ---- pure predicates -----------------------------------------------------------------------

/**
 * Whether a lock left behind by a dead process may be taken over.
 *
 * A watcher killed with Ctrl-C between arming and the ring leaves its pidfile on disk. Refusing
 * forever on that is the shape that gets a check deleted by the first person it wedges — so a lock
 * whose owner is gone is stale and may be claimed, loudly.
 *
 * `ownerAlive` is passed in rather than probed here so the branch is testable: the whole point is
 * to be able to assert both answers without spawning and killing a process.
 */
export function lockIsStale(lock, ownerAlive) {
  if (!lock || typeof lock.pid !== 'number') return true;
  return !ownerAlive;
}

/**
 * Every reason to refuse to arm, as sentences a person can act on.
 *
 * Returns `[]` when arming is safe. One string per reason, because two problems at once must both
 * be said — a watcher that reports the lock and stays silent about the three attached CDP clients
 * sends someone to fix half of it and try again.
 *
 * @param lock the parsed lockfile, or null when there is none.
 * @param ownerAlive whether the pid in that lockfile is still running.
 * @param cdpClients how many clients are attached to the debugging port, excluding this process.
 *   `null` means the count could not be taken — see `countCdpClients`.
 * @param skipCdpCheck the opt-in waiver, never the default.
 */
export function refusalsFor({ lock, ownerAlive, cdpClients, skipCdpCheck = false }) {
  const reasons = [];

  if (lock && !lockIsStale(lock, ownerAlive)) {
    reasons.push(
      `another step 70 watcher is already armed: pid ${lock.pid}` +
        (lock.startedAt ? `, started ${lock.startedAt}` : '') +
        (lock.expecting ? `, expecting …${lock.expecting}` : '') +
        `. Only one process may be able to click a call control when the ring lands. ` +
        `Stop it, or delete ${LOCK_PATH} if you are certain it is gone.`,
    );
  }

  if (skipCdpCheck) {
    // Not a reason to refuse — but never silent, exactly like the gate's --allow-blank-number.
    reasons.waived = `CDP client check skipped by --skip-cdp-check`;
  } else if (cdpClients === null) {
    reasons.push(
      `could not count the clients attached to port ${CDP_PORT}, so "nothing else is driving the ` +
        `renderer" is unproven rather than true. Re-run with --skip-cdp-check to arm anyway, and ` +
        `say so in the record.`,
    );
  } else if (cdpClients > 0) {
    reasons.push(
      `${cdpClients} other client${cdpClients === 1 ? ' is' : 's are'} attached to port ` +
        `${CDP_PORT} — a DevTools window, another session, or a second watcher. Any of them can ` +
        `click #call-reject on the same ring. Close them, or re-run with --skip-cdp-check.`,
    );
  }

  return reasons;
}

/** The refusal, printed as the watcher exits. Says what it refused and why — never a silent no-op. */
export function refusalText(reasons) {
  return [
    'REFUSING TO ARM. The step 70 watcher will not start:',
    ...reasons.map((r) => `  - ${r}`),
    'Nothing was armed and the phone was not touched.',
  ].join('\n');
}

// ---- the impure half -----------------------------------------------------------------------

/** Whether a pid is running. Signal 0 tests for existence without delivering anything. */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else — alive for our purposes.
    return err?.code === 'EPERM';
  }
}

/** The lockfile on disk, or null. A corrupt file is treated as absent and reported by the caller. */
export function readLock(path = LOCK_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse `lsof -nP -iTCP:<port>` into the number of *other processes* holding a connection.
 *
 * Pure, and separated from the `lsof` call so it can be tested against captured output — which it
 * needed. The first version counted rows and halved them, on the assumption that each loopback
 * connection appears twice. It does, but **one client process can hold several connections**: a
 * CDP client opens a keep-alive socket for `GET /json` and then a second one for the WebSocket, so
 * a single attached watcher printed as "2 other clients are attached". A refusal that overstates
 * its own evidence is the failure this project keeps filing defects about — the fix is to count
 * the thing a person can act on, which is processes, not sockets.
 *
 * The listener's own pid is excluded because Electron appears on the accepting side of every
 * connection, and `selfPid` because the caller is about to become a client itself.
 */
export function cdpClientsFromLsof(text, selfPid = process.pid) {
  const rows = String(text).split('\n').slice(1).filter((l) => l.trim());
  const listeners = new Set();
  for (const row of rows) {
    if (row.includes('(LISTEN)')) {
      const pid = Number(row.trim().split(/\s+/)[1]);
      if (Number.isFinite(pid)) listeners.add(pid);
    }
  }
  const others = new Set();
  for (const row of rows) {
    if (!row.includes('(ESTABLISHED)')) continue;
    const pid = Number(row.trim().split(/\s+/)[1]);
    if (!Number.isFinite(pid)) continue;
    if (listeners.has(pid) || pid === selfPid) continue;
    others.add(pid);
  }
  return others.size;
}

/**
 * Clients attached to the debugging port, not counting the listener or this process.
 *
 * Returns `null` when the count could not be taken, which `refusalsFor` treats as a refusal rather
 * than a pass: an unproven "nothing else is attached" is the false-negative shape this project
 * keeps writing rules about — a query that cannot tell its target from something resembling it
 * returns a confident wrong answer.
 */
export function countCdpClients(port = CDP_PORT) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`], { encoding: 'utf8' });
    return cdpClientsFromLsof(out);
  } catch (err) {
    // lsof exits 1 with no output when nothing matches at all — that is a real zero, not a failure.
    if (err?.status === 1 && !String(err.stdout ?? '').trim()) return 0;
    return null;
  }
}

/**
 * Take the lock, or throw. `wx` fails if the file exists, so the check and the claim are one
 * operation rather than a read followed by a write two watchers can interleave inside.
 */
export function acquireLock(details, path = LOCK_PATH) {
  const fd = openSync(path, 'wx');
  closeSync(fd);
  writeFileSync(path, JSON.stringify({ pid: process.pid, ...details }, null, 2));
}

export function releaseLock(path = LOCK_PATH) {
  try {
    unlinkSync(path);
  } catch {
    /* already gone; nothing to do and nothing worth saying */
  }
}

/** Delete a lock whose owner is gone, saying so. Returns true when one was cleared. */
export function clearStaleLock(path = LOCK_PATH) {
  const lock = readLock(path);
  if (lock && lockIsStale(lock, pidAlive(lock.pid))) {
    releaseLock(path);
    return lock;
  }
  return null;
}
