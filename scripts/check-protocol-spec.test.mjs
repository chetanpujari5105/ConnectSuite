/**
 * The enforcement point's own enforcement point: fixtures for `check-protocol-spec.mjs`.
 *
 * The checker exists because four `media.*` types were listed in `docs/protocol.md` and specified
 * nowhere in it for a phase. Two of those four were *mentioned* five and four times, in prose about
 * `fs.thumb` — so the fixture that matters most is the third one below: **a mention inside a
 * sentence is not a specification**, and a checker that cannot tell them apart would have reported
 * the namespace as documented on the day it was not.
 *
 * Every fixture carries its opposite. A check that only ever sees the failing case cannot show it
 * is discriminating rather than simply always failing.
 *
 * Run: `node --test scripts/check-protocol-spec.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  typesFrom,
  wireNamesIn,
  readDoc,
  UNSPECIFIED,
  SPECIFIED_UNDER,
  SPECIFIED_NOT_ON_THE_WIRE,
} from './check-protocol-spec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A Messages.kt holding exactly the types asked for. */
function kotlinWith(...types) {
  const consts = types.map((t, i) => `    const val T${i} = "${t}"`).join('\n');
  return `object MessageType {\n${consts}\n}\n\nobject ErrorCode {\n}\n`;
}

/** A protocol.md whose inventory lists everything, plus whatever body is given. */
function markdownWith(types, body) {
  return [
    '# contract',
    '',
    '### Message types',
    '',
    `All: ${types.map((t) => `\`${t}\``).join(', ')}`,
    '',
    '## Body',
    '',
    body,
    '',
  ].join('\n');
}

const only = (types, body) => ({
  kotlin: kotlinWith(...types),
  markdown: markdownWith(types, body),
  minTypes: 1,
  specifiedUnder: {},
  unspecified: {},
  notInInventory: {},
  specifiedNotOnTheWire: {},
});

// --- fixture 1: a paragraph subject is a specification ----------------------------------------

test('fixture — a type opening a paragraph counts as specified', () => {
  const r = check(only(['sms.send'], '`sms.send` — **request**. The Mac hands the phone a message.'));
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.specified, ['sms.send']);
});

test('fixture — a type as a heading counts as specified', () => {
  const r = check(only(['fs.stat'], '### `fs.stat`\n\nOne entry, by id.'));
  assert.deepEqual(r.findings, []);
});

// --- fixture 2: the control for fixture 1 — the mention that is not a specification ------------

test('fixture — a type mentioned mid-sentence is NOT specified, however often', () => {
  const body = [
    'The shape deliberately mirrors `media.thumb`, and the caps carry over from `media.thumb`',
    'unchanged. Nothing here specifies `media.thumb`; it is prose about something else that names',
    '`media.thumb` five times, which is exactly what hid it for a phase.',
  ].join('\n');
  const r = check(only(['media.thumb'], body));
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /media\.thumb is on the wire and is not the subject/);
});

test('fixture — a line starting with a backticked type mid-paragraph is NOT specified', () => {
  // The wrapping case. docs/protocol.md wraps at 100 columns, so a continuation line can begin
  // with a backticked type inside a paragraph about something else. Without the blank-line rule
  // this fixture passes and the checker is decoration.
  const body = 'A digest is agreed in advance by\n`media.original` and by `fs.transfer.begin`, which is why it acks null.';
  const r = check(only(['media.original'], body));
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /media\.original/);
});

// --- fixture 3: listed but not specified — the exact shape of the defect -----------------------

test('fixture — a type present only in the inventory list is unaccounted for', () => {
  const r = check(only(['media.buckets'], 'Nothing about it here.'));
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /not the subject of any heading or paragraph/);
});

test('fixture — a type specified but missing from the inventory is a finding of its own', () => {
  const r = check({
    kotlin: kotlinWith('call.dial'),
    // `ping` rather than another dotted name: the reverse walk would report an unrelated
    // `sms.send` in the inventory with no constant behind it, which is a second, true finding and
    // would make this fixture about two things.
    markdown: '# contract\n\n### Message types\n\nAll: `ping`\n\n## Body\n\n`call.dial` — **request**.\n',
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire: {},
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /missing from the "### Message types" inventory/);
});

// --- fixture 4: the debt list, in both directions ----------------------------------------------

test('fixture — an unspecified type on the debt list is debt, not a finding', () => {
  const base = only(['clip.push'], 'Nothing about it here.');
  const r = check({ ...base, unspecified: { 'clip.push': 'awaiting the §2 reading' } });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.debt, ['clip.push']);
});

test('fixture — a debt entry that is in fact specified FAILS, so the list gets pruned', () => {
  const base = only(['clip.push'], '`clip.push` — **event**, either side.');
  const r = check({ ...base, unspecified: { 'clip.push': 'awaiting the §2 reading' } });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /is on the UNSPECIFIED debt list and is in fact specified/);
});

// --- fixture 5: SPECIFIED_UNDER cannot outlive its heading -------------------------------------

test('fixture — a type homed under a heading passes while the heading exists', () => {
  const base = only(['ping'], 'The Mac sends one every 5 seconds.');
  const r = check({ ...base, specifiedUnder: { ping: '## Body' } });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.specified, ['ping']);
});

test('fixture — the same type FAILS once that heading is renamed away', () => {
  const base = only(['ping'], 'The Mac sends one every 5 seconds.');
  const r = check({ ...base, specifiedUnder: { ping: '## Heartbeat' } });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /that heading is gone/);
});

// --- fixture 6: the instrument reports its own bound -------------------------------------------

test('fixture — a parse yielding too few types is an INSTRUMENT FAILURE, not a clean pass', () => {
  const r = check({ kotlin: 'object MessageType {\n}\n', markdown: markdownWith([], 'x') });
  assert.ok(r.instrumentFailure, 'an empty parse must not report zero findings');
  assert.match(r.instrumentFailure, /parsed 0 message types/);
  assert.equal(r.findings, undefined);
});

test('fixture — typesFrom stops at the next object, so ErrorCode constants are not message types', () => {
  const types = typesFrom(
    'object MessageType {\n  const val A = "a.b"\n}\n\nobject ErrorCode {\n  const val NO = "NO_SPACE"\n}\n',
  );
  assert.deepEqual(types, ['a.b']);
});

// --- the live tree, and the control that says the checker can see the defect it was built for ---

test('the tree as it stands has no unaccounted-for message type', () => {
  const r = check({
    kotlin: readFileSync(join(ROOT, 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'utf8'),
    markdown: readFileSync(join(ROOT, 'docs/protocol.md'), 'utf8'),
  });
  assert.deepEqual(r.findings, []);
  assert.ok(r.specified.length > 50, `only ${r.specified.length} types specified — did the parse work?`);
});

test('control — the same checker against the pre-migration contract reports the six real gaps', () => {
  // Not a synthetic fixture: this is `docs/protocol.md` as it stood before `media.*` was written
  // into it, reconstructed by deleting the two sections this sitting added. If this passes, the
  // checker cannot see the thing it exists for and every other test here is decoration.
  const markdown = readFileSync(join(ROOT, 'docs/protocol.md'), 'utf8');
  const withoutPhotos = markdown
    .replace(/## Photos \(42501, with bytes on 42503\)[\s\S]*?(?=## Session tokens)/, '')
    .replace(/### `mirror\.stop` and `mirror\.keyframe`[\s\S]*?(?=### `mirror\.state`)/, '');
  const r = check({
    kotlin: readFileSync(join(ROOT, 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'utf8'),
    markdown: withoutPhotos,
  });
  const named = r.findings.filter((f) => /not the subject/.test(f)).map((f) => f.split(' ')[0]);
  assert.deepEqual(named.sort(), [
    'media.buckets',
    'media.list',
    'media.original',
    'media.thumb',
    'mirror.keyframe',
    'mirror.stop',
  ]);
});

// --- the desktop twin, added after it caught a real drift ---------------------------------------

test('fixture — a type on the phone and missing from the Mac is a finding', () => {
  // This is not hypothetical. All three `clip.*` names were specified in docs/protocol.md and
  // implemented on the phone while `desktop/src/shared/protocol.ts` had never heard of them; it
  // surfaced as a TypeScript compile error, which is luck. A drift that does not break a compile
  // is invisible — the Mac simply never sends the message.
  const r = check({
    kotlin: kotlinWith('clip.push'),
    markdown: markdownWith(['clip.push'], '`clip.push` — **event**, either side.'),
    typescript: "export const MessageType = {\n  PING: 'ping',\n} as const;",
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    twinExempt: {},
    specifiedNotOnTheWire: {},
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /missing from desktop\/src\/shared\/protocol\.ts/);
});

test('fixture — the same type present in the twin is no finding', () => {
  const r = check({
    kotlin: kotlinWith('clip.push'),
    markdown: markdownWith(['clip.push'], '`clip.push` — **event**, either side.'),
    typescript: "export const MessageType = {\n  CLIP_PUSH: 'clip.push',\n} as const;",
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    twinExempt: {},
    specifiedNotOnTheWire: {},
  });
  assert.deepEqual(r.findings, []);
});

test('fixture — a twin-exempt type is a counted gap, not a finding', () => {
  const r = check({
    kotlin: kotlinWith('apps.list'),
    markdown: markdownWith(['apps.list'], '`apps.list` — **request**.'),
    typescript: "export const MessageType = {\n  PING: 'ping',\n} as const;",
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    twinExempt: { 'apps.list': 'Phase 7.' },
    specifiedNotOnTheWire: {},
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.twinDebt, ['apps.list']);
});

test('the tree as it stands has no phone type the Mac has never heard of', () => {
  const r = check({
    kotlin: readFileSync(join(ROOT, 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'utf8'),
    markdown: readFileSync(join(ROOT, 'docs/protocol.md'), 'utf8'),
    typescript: readFileSync(join(ROOT, 'desktop/src/shared/protocol.ts'), 'utf8'),
  });
  assert.deepEqual(r.findings, []);
});

// --- fixture 7: the reverse walk — document → MessageType ---------------------------------------
//
// The gap these close: every loop above is over the *constants*, so a namespace the contract
// specifies with nothing behind it is not merely unreported, it is unvisited. `mic.*` sat that way
// for a phase with three `###` sections and an inventory line, while the checker printed
// `0 unaccounted for` on every run.

/** A contract that specifies `mic.*` fully and a Messages.kt that has never heard of it. */
const MIC_MD = [
  '# contract',
  '',
  '### Message types',
  '',
  'Microphone: `mic.start`, `mic.stop`, `mic.state`',
  'System: `ping`',
  '',
  '## Microphone',
  '',
  '### `mic.start`',
  '',
  '**Request, Mac → phone.** `{"sampleRate":16000}` — optional.',
  '',
  '### `mic.stop`',
  '',
  '**Request, Mac → phone.** No payload.',
  '',
  '### `mic.state`',
  '',
  '**Event, phone → Mac.** Sent on every transition.',
  '',
].join('\n');

const micCheck = (specifiedNotOnTheWire) =>
  check({
    kotlin: kotlinWith('ping'),
    markdown: MIC_MD,
    minTypes: 1,
    specifiedUnder: { ping: '## Microphone' },
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire,
  });

test('fixture — a namespace specified with no MessageType behind it is three findings', () => {
  const r = micCheck({});
  assert.equal(r.findings.length, 3);
  for (const name of ['mic.start', 'mic.stop', 'mic.state']) {
    assert.ok(
      r.findings.some((f) => f.startsWith(`${name} is specified at`)),
      `expected a finding for ${name}, got:\n${r.findings.join('\n')}`,
    );
  }
  // It names the line, so the finding is actionable without a second search.
  assert.match(r.findings[0], /docs\/protocol\.md:\d+/);
  assert.match(r.findings[0], /no MessageType constant on either side/);
});

test('control — the same contract with the constants present is no finding at all', () => {
  const r = check({
    kotlin: kotlinWith('ping', 'mic.start', 'mic.stop', 'mic.state'),
    markdown: MIC_MD,
    minTypes: 1,
    specifiedUnder: { ping: '## Microphone' },
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire: {},
  });
  assert.deepEqual(r.findings, []);
});

test('fixture — recorded on SPECIFIED_NOT_ON_THE_WIRE it is counted debt, not a finding', () => {
  const r = micCheck({
    'mic.start': 'Gated on Phase 8 signing.',
    'mic.stop': 'Same feature, same gate.',
    'mic.state': 'Same feature, same gate.',
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.specNotWire, ['mic.start', 'mic.state', 'mic.stop']);
});

test('fixture — an inventory entry with no spec and no constant is still caught', () => {
  // The other half: the contract never specifies it, so `subjects` cannot see it and only the
  // inventory can. Distinguished in the message, because they are different mistakes.
  const r = check({
    kotlin: kotlinWith('ping'),
    markdown: '# contract\n\n### Message types\n\nAll: `ping`, `mic.start`\n\n## Body\n\n`ping` — **heartbeat**.\n',
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire: {},
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /mic\.start is listed in the "### Message types" inventory/);
});

// --- fixture 8: the allowlist gets pruned, in both of its failure directions --------------------

test('fixture — an allowlisted name that acquires a constant FAILS', () => {
  const r = check({
    kotlin: kotlinWith('ping', 'mic.start', 'mic.stop', 'mic.state'),
    markdown: MIC_MD,
    minTypes: 1,
    specifiedUnder: { ping: '## Microphone' },
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire: { 'mic.start': 'Gated on Phase 8 signing.' },
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /is in fact in MessageType — remove it from the list/);
});

test('fixture — an allowlisted name the contract no longer mentions FAILS as stale', () => {
  const r = check({
    kotlin: kotlinWith('ping'),
    markdown: '# contract\n\n### Message types\n\nAll: `ping`\n\n## Body\n\n`ping` — **heartbeat**.\n',
    minTypes: 1,
    specifiedUnder: {},
    unspecified: {},
    notInInventory: {},
    specifiedNotOnTheWire: { 'mic.start': 'Gated on Phase 8 signing.' },
  });
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /neither specifies nor lists it — the entry is stale/);
});

// --- fixture 9: the discriminator. A dot, and why a weaker one is worse than none ---------------

test('the dot is the discriminator — field names opening paragraphs are not message types', () => {
  // `docs/protocol.md` opens paragraphs with field names constantly. A reverse walk over every
  // backticked subject would report `limit`, `path`, `kind` and two dozen others as missing types,
  // which is a guard nobody can leave switched on.
  const doc = readDoc(
    '# contract\n\n### Message types\n\nAll: `ping`\n\n## Body\n\n' +
      '`limit` — how many rows a page may carry.\n\n' +
      '`path` — the entry, as the provider names it.\n\n' +
      '`mic.start` — **request**, Mac → phone.\n',
  );
  const { subjects } = wireNamesIn(doc);
  assert.deepEqual([...subjects.keys()], ['mic.start']);
});

test('the tree as it stands: every spec-only name is allowlisted, and mic.* is why', () => {
  const r = check({
    kotlin: readFileSync(join(ROOT, 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'utf8'),
    markdown: readFileSync(join(ROOT, 'docs/protocol.md'), 'utf8'),
    typescript: readFileSync(join(ROOT, 'desktop/src/shared/protocol.ts'), 'utf8'),
  });
  assert.deepEqual(r.findings, []);
  // share.saved was here for slice 3a; slice 3c put it in MessageType, so it moved to TWIN_EXEMPT.
  // webcam.* was here from W0 (2026-10-03) until W2 (2026-10-04) put it in both MessageTypes.
  assert.deepEqual(r.specNotWire, ['apps.launch', 'mic.start', 'mic.state', 'mic.stop']);
});

test('red-first — the real tree with the allowlist emptied reports mic.* and apps.launch and nothing else new', () => {
  // The verbatim case this guard is named for, against the real contract rather than a fixture.
  const r = check({
    kotlin: readFileSync(join(ROOT, 'core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt'), 'utf8'),
    markdown: readFileSync(join(ROOT, 'docs/protocol.md'), 'utf8'),
    typescript: readFileSync(join(ROOT, 'desktop/src/shared/protocol.ts'), 'utf8'),
    specifiedNotOnTheWire: {},
  });
  assert.equal(r.findings.length, 4);
  const named = r.findings.map((f) => f.split(' ')[0]).sort();
  assert.deepEqual(named, ['apps.launch', 'mic.start', 'mic.state', 'mic.stop']);
});

test('the allowlist carries a reason per entry, not a bare name', () => {
  for (const [name, why] of Object.entries(SPECIFIED_NOT_ON_THE_WIRE)) {
    assert.ok(typeof why === 'string' && why.length > 30, `${name} needs a reason and a gate, got: ${why}`);
  }
});
