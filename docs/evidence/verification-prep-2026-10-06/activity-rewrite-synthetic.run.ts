// Synthetic-only dry run of the CURRENT Activity rewrite (activity.ts at HEAD). Temp dirs; never the profile.
import Module from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ml = Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown };
const real = ml._load;
ml._load = function (r: string, ...a: unknown[]) { return r === 'electron' ? { app: { getPath: () => tmpdir() } } : real.call(this, r, ...a); };
const logs: string[] = []; const rl = console.log; console.log = (...a: unknown[]) => logs.push(a.join(' '));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ActivityStore } = require(process.argv[2]) as typeof import('../../../../../../Users/chetan/Desktop/ConnectSuite/desktop/src/main/activity');
const L = (o: object) => JSON.stringify(o);
const fixture = [
  L({ seq: 1, at: 1000, category: 'system', kind: 'Sidekick started', detail: 'version 2.0.0' }),
  L({ seq: 2, at: 1001, category: 'calls', kind: 'Missed call', detail: '+91 98000 00001' }),            // synthetic reserved-style number
  L({ seq: 3, at: 1002, category: 'calls', kind: 'Call ended', detail: 'Test Contact A' }),              // a name: unchanged
  L({ seq: 4, at: 1003, category: 'calls', kind: 'Call ended', detail: 'Test Contact B', extra: 'x' }), // unknown field on a call row
  '{"at":1004,"seq":4.5,"category":"calls","kind":"Call ringing","detail":"Test Contact C"}',          // different key order
  L({ seq: 5, at: 1005, category: 'files', kind: 'Sent to phone', detail: 'synthetic.bin', note: 'kept' }), // unknown field, non-call
  '{"seq":6,"at":1006,"category":"files","kind":"Sent', // broken non-call line
  '{"seq":7,"at":1007,"category":"calls","detail":"+9198', // broken call line
  L({ seq: 8, at: 1008, category: 'sms', kind: 'Received', detail: 'order 12345678 shipped' }),       // digits in a non-call row
];
const report = (label: string, dir: string, before: string) => {
  const after = existsSync(join(dir, 'activity.jsonl')) ? readFileSync(join(dir, 'activity.jsonl'), 'utf8') : '';
  const bl = before.split('\n').filter(Boolean), al = after.split('\n').filter(Boolean);
  rl(`\n== ${label}`);
  rl(`lines before ${bl.length} / after ${al.length}; files in dir: ${readdirSync(dir).join(', ')}`);
  for (const l of bl) rl(`  ${al.includes(l) ? 'KEPT VERBATIM ' : 'CHANGED/GONE  '} ${l}`);
  for (const l of al) if (!bl.includes(l)) rl(`  NEW           ${l}`);
  rl('  log: ' + logs.filter((x) => x.includes('[activity]')).map((x) => x.replace(/^\S+ /, '')).join('\n  log: '));
  logs.length = 0;
};
// Run 1: writable directory, file ending without a newline (a hard quit).
const d1 = mkdtempSync(join(tmpdir(), 'activity-fixture-'));
const before1 = fixture.join('\n'); writeFileSync(join(d1, 'activity.jsonl'), before1);
new ActivityStore().initAt(d1);
report('writable folder', d1, before1);
// Run 2: the rename is refused (read-only directory): the file must be untouched.
const d2 = mkdtempSync(join(tmpdir(), 'activity-fixture-ro-'));
const before2 = fixture.join('\n') + '\n'; writeFileSync(join(d2, 'activity.jsonl'), before2); chmodSync(d2, 0o555);
const s2 = new ActivityStore(); s2.initAt(d2);
report('read-only folder (write refused)', d2, before2);
rl(`  events still returned to the pane: ${s2.all().length}; error: ${s2.error()}`);
chmodSync(d2, 0o755);
// Run 3: a second launch over run 1's output is a no-op.
const before3 = readFileSync(join(d1, 'activity.jsonl'), 'utf8');
new ActivityStore().initAt(d1);
report('second launch (idempotence)', d1, before3);
