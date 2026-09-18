import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MARKER_FILE,
  clearRePairPending,
  decideRePair,
  hasLegacyIdentity,
  legacyDownloadsFolder,
  legacyLogsDir,
  legacyUserDataDir,
  mergeLegacyActivity,
  migrateLegacySettings,
  pairingRenameNotice,
} from './legacyData';
import { ORDINARY_REFUSAL, RENAME_REFUSAL, classifyLinkError } from '../shared/linkHealth';

/**
 * Every test builds a real `Application Support`-shaped tree in a temporary folder and runs the
 * production functions against it. Nothing is modelled: the files are the input and the output.
 */
function tree(): { support: string; legacy: string; current: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-legacy-'));
  const support = join(root, 'Application Support');
  const legacy = join(support, 'connectsuite-desktop');
  const current = join(support, 'sidekick-desktop');
  mkdirSync(legacy, { recursive: true });
  mkdirSync(current, { recursive: true });
  return { support, legacy, current, home: join(root, 'home') };
}

const OLD_SETTINGS = {
  paired: { deviceId: 'd1', deviceName: 'Samsung SM-S938B', fingerprint: 'AA:BB', pairedAt: 1 },
  lastAddress: '10.0.0.2',
  manualAddress: '192.168.1.40',
  tailscaleAddress: null,
  lastDiscoveryVia: 'last-known',
  autoConnect: false,
  watchClipboard: false,
  notificationSound: true,
  appearance: 'light',
};

function writeJson(path: string, value: unknown): string {
  const text = JSON.stringify(value);
  writeFileSync(path, text);
  return text;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

// ---- Locating what ConnectSuite left ---------------------------------------------------------

test('the ConnectSuite folder beside userData is found, and absent means null', () => {
  const t = tree();
  assert.equal(legacyUserDataDir(t.current), t.legacy);
  const lone = mkdtempSync(join(tmpdir(), 'sidekick-lone-'));
  assert.equal(legacyUserDataDir(join(lone, 'sidekick-desktop')), null);
});

test('the packaged ConnectSuite folder name is found too', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-packaged-'));
  mkdirSync(join(root, 'ConnectSuite'));
  assert.equal(legacyUserDataDir(join(root, 'Sidekick')), join(root, 'ConnectSuite'));
});

test('a legacy identity is reported only when its certificate is there', () => {
  const t = tree();
  assert.equal(hasLegacyIdentity(t.legacy), false);
  assert.equal(hasLegacyIdentity(null), false);
  mkdirSync(join(t.legacy, 'identity'));
  writeFileSync(join(t.legacy, 'identity', 'cert.pem'), 'pem');
  assert.equal(hasLegacyIdentity(t.legacy), true);
});

test('old logs are named when present and null when not', () => {
  const t = tree();
  assert.equal(legacyLogsDir(t.legacy), null);
  mkdirSync(join(t.legacy, 'logs'));
  assert.equal(legacyLogsDir(t.legacy), join(t.legacy, 'logs'));
  assert.equal(legacyLogsDir(null), null);
});

test('the ConnectSuite downloads folder is reported when it exists, and only then', () => {
  const t = tree();
  assert.equal(legacyDownloadsFolder(t.home), null);
  mkdirSync(join(t.home, 'Downloads', 'ConnectSuite'), { recursive: true });
  assert.equal(legacyDownloadsFolder(t.home), join(t.home, 'Downloads', 'ConnectSuite'));
  // A Sidekick folder alone is not a legacy folder.
  const u = tree();
  mkdirSync(join(u.home, 'Downloads', 'Sidekick'), { recursive: true });
  assert.equal(legacyDownloadsFolder(u.home), null);
});

// ---- Settings --------------------------------------------------------------------------------

test('settings: old store, no Sidekick store — compatible values copied, pairing never', () => {
  const t = tree();
  const before = writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  const result = migrateLegacySettings(t.legacy, t.current);
  assert.equal(result.outcome, 'migrated');
  const now = readJson(join(t.current, 'sidekick.json'));
  assert.equal(now.appearance, 'light');
  assert.equal(now.autoConnect, false);
  assert.equal(now.watchClipboard, false);
  assert.equal(now.notificationSound, true);
  assert.equal(now.manualAddress, '192.168.1.40');
  assert.equal(now.tailscaleAddress, null);
  assert.equal('paired' in now, false, 'the old trust record must never be copied');
  assert.equal('lastAddress' in now, false);
  assert.equal('lastDiscoveryVia' in now, false);
  // The old file is byte-for-byte what it was.
  assert.equal(readFileSync(join(t.legacy, 'connectsuite.json'), 'utf8'), before);
});

test('settings: a value Sidekick already has is never overwritten', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  writeJson(join(t.current, 'sidekick.json'), { appearance: 'dark', paired: null });
  const result = migrateLegacySettings(t.legacy, t.current);
  assert.equal(result.outcome, 'migrated');
  const now = readJson(join(t.current, 'sidekick.json'));
  assert.equal(now.appearance, 'dark');
  assert.equal(now.paired, null);
  assert.equal(now.autoConnect, false, 'a missing key is still filled');
  if (result.outcome === 'migrated') assert.ok(result.kept.includes('appearance'));
});

test('settings: a Sidekick store that already has every key copies nothing and is not rewritten', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  const full = writeJson(join(t.current, 'sidekick.json'), {
    ...OLD_SETTINGS,
    appearance: 'system',
    autoConnect: true,
  });
  const result = migrateLegacySettings(t.legacy, t.current);
  assert.equal(result.outcome, 'migrated');
  if (result.outcome === 'migrated') assert.deepEqual(result.copied, []);
  assert.equal(readFileSync(join(t.current, 'sidekick.json'), 'utf8'), full);
  assert.ok(existsSync(join(t.current, MARKER_FILE)));
});

test('settings: no old store — nothing written, no marker', () => {
  const t = tree();
  assert.equal(migrateLegacySettings(t.legacy, t.current).outcome, 'no-legacy');
  assert.equal(migrateLegacySettings(null, t.current).outcome, 'no-legacy');
  assert.equal(existsSync(join(t.current, 'sidekick.json')), false);
  assert.equal(existsSync(join(t.current, MARKER_FILE)), false);
});

test('settings: with the marker present, a changed old store is not read again', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  migrateLegacySettings(t.legacy, t.current);
  const after = readFileSync(join(t.current, 'sidekick.json'), 'utf8');
  writeJson(join(t.legacy, 'connectsuite.json'), { ...OLD_SETTINGS, appearance: 'dark' });
  assert.equal(migrateLegacySettings(t.legacy, t.current).outcome, 'already-done');
  assert.equal(readFileSync(join(t.current, 'sidekick.json'), 'utf8'), after);
});

test('settings: malformed values are rejected one by one, and the valid ones still copy', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), {
    appearance: 'purple',
    autoConnect: 'yes',
    watchClipboard: true,
    manualAddress: '   ',
  });
  const result = migrateLegacySettings(t.legacy, t.current);
  assert.equal(result.outcome, 'migrated');
  if (result.outcome === 'migrated') {
    assert.deepEqual(result.copied, ['watchClipboard']);
    assert.deepEqual([...result.rejected].sort(), ['appearance', 'autoConnect', 'manualAddress']);
  }
  const now = readJson(join(t.current, 'sidekick.json'));
  assert.deepEqual(now, { watchClipboard: true });
});

test('settings: an unreadable old file fails, writes nothing, and is retried next launch', () => {
  const t = tree();
  writeFileSync(join(t.legacy, 'connectsuite.json'), '{ not json');
  assert.equal(migrateLegacySettings(t.legacy, t.current).outcome, 'failed');
  assert.equal(existsSync(join(t.current, MARKER_FILE)), false);
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  assert.equal(migrateLegacySettings(t.legacy, t.current).outcome, 'migrated');
});

test('settings: a malformed Sidekick store is left for electron-store, not repaired here', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  writeFileSync(join(t.current, 'sidekick.json'), '[1,2]');
  assert.equal(migrateLegacySettings(t.legacy, t.current).outcome, 'failed');
  assert.equal(readFileSync(join(t.current, 'sidekick.json'), 'utf8'), '[1,2]');
});

// ---- Activity --------------------------------------------------------------------------------

type Ev = { seq: number; at: number; category: string; kind: string; detail: string };
const ev = (seq: number, at: number, kind: string, detail = ''): Ev => ({
  seq,
  at,
  category: 'system',
  kind,
  detail,
});

function writeLines(path: string, lines: (Ev | string)[]): string {
  mkdirSync(join(path, '..'), { recursive: true });
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  writeFileSync(path, text);
  return text;
}

function readLines(path: string): Ev[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Ev);
}

test('activity: old history lands before new, in time order, renumbered with no repeated seq', () => {
  const t = tree();
  const oldPath = join(t.legacy, 'logs', 'activity.jsonl');
  const oldText = writeLines(oldPath, [ev(1, 100, 'ConnectSuite started'), ev(2, 200, 'Connected')]);
  const newPath = join(t.current, 'logs', 'activity.jsonl');
  writeLines(newPath, [ev(1, 300, 'Sidekick started'), ev(2, 400, 'Connected')]);

  const result = mergeLegacyActivity(t.legacy, t.current);
  assert.equal(result.outcome, 'merged');
  const merged = readLines(newPath);
  assert.deepEqual(
    merged.map((e) => e.kind),
    ['ConnectSuite started', 'Connected', 'Sidekick started', 'Connected'],
  );
  assert.deepEqual(merged.map((e) => e.seq), [1, 2, 3, 4]);
  assert.deepEqual(merged.map((e) => e.at), [100, 200, 300, 400]);
  assert.equal(readFileSync(oldPath, 'utf8'), oldText, 'the ConnectSuite file is only read');
  assert.ok(existsSync(`${newPath}.pre-migration`), 'the Sidekick file as it stood is kept');
});

test('activity: an event in both files is kept once', () => {
  const t = tree();
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(1, 100, 'A'), ev(2, 200, 'B', 'x')]);
  writeLines(join(t.current, 'logs', 'activity.jsonl'), [ev(1, 200, 'B', 'x'), ev(2, 300, 'C')]);
  const result = mergeLegacyActivity(t.legacy, t.current);
  assert.equal(result.outcome, 'merged');
  if (result.outcome === 'merged') assert.equal(result.duplicates, 1);
  assert.deepEqual(readLines(join(t.current, 'logs', 'activity.jsonl')).map((e) => e.kind), ['A', 'B', 'C']);
});

test('activity: interleaved timestamps come out in time order, legacy first on a tie', () => {
  const t = tree();
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(1, 100, 'old-a'), ev(2, 300, 'old-b')]);
  writeLines(join(t.current, 'logs', 'activity.jsonl'), [ev(1, 200, 'new-a'), ev(2, 300, 'new-b')]);
  mergeLegacyActivity(t.legacy, t.current);
  assert.deepEqual(
    readLines(join(t.current, 'logs', 'activity.jsonl')).map((e) => e.kind),
    ['old-a', 'new-a', 'old-b', 'new-b'],
  );
});

test('activity: no Sidekick history yet — the old history becomes it, and the folder is made', () => {
  const t = tree();
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(7, 100, 'A'), ev(9, 200, 'B')]);
  const result = mergeLegacyActivity(t.legacy, t.current);
  assert.equal(result.outcome, 'merged');
  assert.deepEqual(readLines(join(t.current, 'logs', 'activity.jsonl')).map((e) => e.seq), [1, 2]);
  assert.equal(existsSync(join(t.current, 'logs', 'activity.jsonl.pre-migration')), false);
});

test('activity: no old history — nothing written, no marker', () => {
  const t = tree();
  const newPath = join(t.current, 'logs', 'activity.jsonl');
  const text = writeLines(newPath, [ev(1, 300, 'Sidekick started')]);
  assert.equal(mergeLegacyActivity(t.legacy, t.current).outcome, 'no-legacy');
  assert.equal(mergeLegacyActivity(null, t.current).outcome, 'no-legacy');
  assert.equal(readFileSync(newPath, 'utf8'), text);
  assert.equal(existsSync(join(t.current, MARKER_FILE)), false);
});

test('activity: unreadable lines are skipped and counted on both sides', () => {
  const t = tree();
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(1, 100, 'A'), '{"seq":2,"at":', 'not json']);
  writeLines(join(t.current, 'logs', 'activity.jsonl'), [ev(1, 200, 'B'), '{"seq":"x"}']);
  const result = mergeLegacyActivity(t.legacy, t.current);
  assert.equal(result.outcome, 'merged');
  if (result.outcome === 'merged') {
    assert.equal(result.legacyUnreadable, 2);
    assert.equal(result.currentUnreadable, 1);
    assert.equal(result.written, 2);
  }
});

test('activity: idempotent — the marker stops a second merge, even with new events since', () => {
  const t = tree();
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(1, 100, 'A')]);
  const newPath = join(t.current, 'logs', 'activity.jsonl');
  writeLines(newPath, [ev(1, 200, 'B')]);
  assert.equal(mergeLegacyActivity(t.legacy, t.current).outcome, 'merged');
  // Sidekick records something after the merge; a second run must not re-add A.
  const afterFirst = readFileSync(newPath, 'utf8') + JSON.stringify(ev(3, 300, 'C')) + '\n';
  writeFileSync(newPath, afterFirst);
  assert.equal(mergeLegacyActivity(t.legacy, t.current).outcome, 'already-done');
  assert.equal(readFileSync(newPath, 'utf8'), afterFirst);
});

test('the two migrations share one marker without erasing each other', () => {
  const t = tree();
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  writeLines(join(t.legacy, 'logs', 'activity.jsonl'), [ev(1, 100, 'A')]);
  migrateLegacySettings(t.legacy, t.current);
  mergeLegacyActivity(t.legacy, t.current);
  const marker = readJson(join(t.current, MARKER_FILE));
  assert.ok(marker.settings);
  assert.ok(marker.activity);
});

// ---- The rename re-pair: a persisted state, not the old folder's existence ------------------

const REFUSAL =
  '1288490715584:error:10000416:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN:' +
  '../../third_party/boringssl/src/ssl/tls_record.cc:489:SSL alert number 46';

function withLegacyIdentity(t: ReturnType<typeof tree>): void {
  mkdirSync(join(t.legacy, 'identity'), { recursive: true });
  writeFileSync(join(t.legacy, 'identity', 'cert.pem'), 'pem');
}

/** One launch, as `main.ts` does it: decide, then read what the pairing screen and a refusal say. */
function launch(t: ReturnType<typeof tree>, sidekickHasPairing: boolean) {
  const { pending } = decideRePair(legacyUserDataDir(t.current), t.current, sidekickHasPairing);
  return {
    pending,
    notice: pairingRenameNotice(pending),
    refusal: classifyLinkError(REFUSAL, { rePairPending: pending })!.message,
  };
}

test('re-pair: ConnectSuite identity and no Sidekick pairing — the pairing screen explains the rename', () => {
  const t = tree();
  withLegacyIdentity(t);
  const first = launch(t, false);
  assert.equal(first.pending, true);
  assert.equal(first.notice, RENAME_REFUSAL);
});

test('re-pair: a fresh install with no ConnectSuite folder says nothing about a rename', () => {
  const lone = mkdtempSync(join(tmpdir(), 'sidekick-fresh-'));
  const current = join(lone, 'sidekick-desktop');
  const { pending } = decideRePair(legacyUserDataDir(current), current, false);
  assert.equal(pending, false);
  assert.equal(pairingRenameNotice(pending), null);
  assert.equal(classifyLinkError(REFUSAL, { rePairPending: pending })!.message, ORDINARY_REFUSAL);
});

test('re-pair: a ConnectSuite folder with no identity in it is not a rename re-pair', () => {
  const t = tree();
  assert.equal(launch(t, false).pending, false);
});

test('re-pair: while pending, a certificate refusal uses the rename wording', () => {
  const t = tree();
  withLegacyIdentity(t);
  assert.equal(launch(t, false).refusal, RENAME_REFUSAL);
});

test('re-pair: a Mac whose Sidekick pairing already exists is not pending (the development Mac)', () => {
  const t = tree();
  withLegacyIdentity(t);
  const l = launch(t, true);
  assert.equal(l.pending, false);
  assert.equal(l.notice, null);
  assert.equal(l.refusal, ORDINARY_REFUSAL);
});

test('re-pair: a successful Sidekick connection clears the pending state, once', () => {
  const t = tree();
  withLegacyIdentity(t);
  assert.equal(launch(t, false).pending, true);
  assert.equal(clearRePairPending(t.current), true);
  assert.equal(clearRePairPending(t.current), false, 'a second connection has nothing to clear');
  const marker = readJson(join(t.current, MARKER_FILE)) as { rePair: { pending: boolean; clearedAt?: string } };
  assert.equal(marker.rePair.pending, false);
  assert.ok(marker.rePair.clearedAt);
});

test('re-pair: after that success, a later certificate refusal is ordinary', () => {
  const t = tree();
  withLegacyIdentity(t);
  launch(t, false);
  clearRePairPending(t.current);
  // The phone later forgets the Mac: Sidekick has no pairing again and the old identity is still
  // on disk — exactly the two facts that must NOT bring the rename back.
  const later = launch(t, false);
  assert.equal(later.refusal, ORDINARY_REFUSAL);
});

test('re-pair: a second startup after success shows no rename explanation', () => {
  const t = tree();
  withLegacyIdentity(t);
  launch(t, false);
  clearRePairPending(t.current);
  const second = launch(t, true);
  const third = launch(t, false);
  assert.equal(second.notice, null);
  assert.equal(third.notice, null);
  assert.equal(existsSync(join(t.legacy, 'identity', 'cert.pem')), true, 'the old identity is untouched');
});

test('re-pair: the decision is persisted beside the other migrations without erasing them', () => {
  const t = tree();
  withLegacyIdentity(t);
  writeJson(join(t.legacy, 'connectsuite.json'), OLD_SETTINGS);
  migrateLegacySettings(t.legacy, t.current);
  launch(t, false);
  const marker = readJson(join(t.current, MARKER_FILE));
  assert.ok(marker.settings);
  assert.ok(marker.rePair);
});
