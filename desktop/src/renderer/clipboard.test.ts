import { test } from 'node:test';
import assert from 'node:assert/strict';
// `clipLink.js` is loaded by a <script> tag before `clipboard.js` in the real page, and it hangs
// `openableUrl` on the global there. Importing it here does the same, which is what `clipRowBadge`
// needs — see the note below about how this file used to load its subject.
import '../shared/clipLink';
import './clipboard';

/**
 * The clipboard pane's pure half, through the `globalThis` seam `calls.ts` established.
 *
 * The row copy is the whole of what is tested here, and it is the right thing to test: the three
 * kinds exist so that three different facts get three different sentences, and the one that matters
 * is **`sensitive` must never read as `empty`.** A password manager's clip is *there*; a pane
 * saying the phone's clipboard is empty would be telling somebody something false about their own
 * phone, which is the failure this whole namespace is shaped around.
 *
 * ### This file used to read its subject through a regex, and that is now fixed
 *
 * It loaded `clipboard.ts` as **text**, stripped the types with six regexes, deleted
 * `class ClipboardView` outright, and evaluated the remains in a `new Function`. That is the shape
 * `check-renderer-views.mjs` was written about — two of the three renderer defects this project has
 * recorded lived inside the class this file was deleting — and it was also simply brittle: adding
 * one `declare function` line to the source broke every test here with a `SyntaxError`, in a file
 * whose subject had not changed.
 *
 * `clipboardView.test.ts` now drives the class for real, so there is nothing left for the stripping
 * to buy. A plain side-effecting import is enough: `clipboard.ts` touches no DOM at module scope.
 */
const api = (globalThis as Record<string, unknown>) as unknown as {
  clipRowText(entry: Record<string, unknown>): { body: string; muted: boolean };
  clipRowSource(entry: Record<string, unknown>): string;
  clipRowBadge(entry: Record<string, unknown>): { text: string; tone: string };
  clipTypeLabel(entry: Record<string, unknown>): string;
  clipTimeline(entry: Record<string, unknown>): { label: string; at?: number; clock?: string; tone: string }[];
  filterClips(entries: Record<string, unknown>[], tab: string): Record<string, unknown>[];
};

test('a sensitive entry never reads as an empty one', () => {
  const sensitive = api.clipRowText({ kind: 'sensitive', atMs: 1, source: 'phone' });
  const empty = api.clipRowText({ kind: 'empty', atMs: 1, source: 'phone' });

  assert.notEqual(sensitive.body, empty.body);
  assert.match(sensitive.body, /sensitive/i);
  assert.match(empty.body, /empty/i);
  assert.ok(
    !/empty/i.test(sensitive.body),
    'the sensitive sentence must not contain the word empty — that is the confusion being prevented',
  );
});

test('an unknown kind is labelled and kept, never rendered as blank text', () => {
  const rendered = api.clipRowText({ kind: 'image', atMs: 1, source: 'phone' });
  assert.match(rendered.body, /can’t show/);
  assert.ok(rendered.body.includes('image'), 'the row names the kind it cannot show');
  assert.equal(rendered.muted, true);
});

test('a text entry renders its own text and nothing else', () => {
  const rendered = api.clipRowText({ kind: 'text', text: 'hello', atMs: 1, source: 'phone' });
  assert.equal(rendered.body, 'hello');
  assert.equal(rendered.muted, false);
});

test('the source line shows the app label, never the package id', () => {
  const labelled = api.clipRowSource({
    kind: 'text',
    atMs: 1,
    source: 'phone',
    package: 'com.android.chrome',
    appName: 'Chrome',
  });
  assert.equal(labelled, 'Phone · Chrome');
  assert.ok(!labelled.includes('com.android.chrome'), 'the package id is a handle, not a sentence');

  assert.equal(api.clipRowSource({ kind: 'text', atMs: 1, source: 'phone' }), 'Phone');
  assert.equal(api.clipRowSource({ kind: 'text', atMs: 1, source: 'mac' }), 'This Mac');
});

test('a displaced entry is restorable without being readable', () => {
  // The rule the undo rests on. `displaced` is what this Mac's clipboard held before an arriving
  // entry overwrote it — the one row in this list nobody chose to add — and on macOS it may be a
  // password manager's clip that the concealed-type check did not catch. `main/clipboard.ts` says
  // plainly that the check's measurement did not reach the real case (Slice 12), so this is the
  // safeguard that does not depend on it: the text is held for Restore and never drawn.
  const secret = 'correct-horse-battery-staple';
  const rendered = api.clipRowText({ kind: 'displaced', text: secret, atMs: 1, source: 'mac' });

  assert.ok(!rendered.body.includes(secret), 'a displaced row must not render the text it holds');
  assert.match(rendered.body, /before the entry above replaced it/);
  assert.equal(rendered.muted, true);

  // The control, and it is the half that makes the assertion above mean anything: the same function
  // *does* render text for the kind that is supposed to have it. Without this, deleting the whole
  // body from `clipRowText` would leave the test above green.
  assert.equal(api.clipRowText({ kind: 'text', text: secret, atMs: 1, source: 'mac' }).body, secret);
});

test('a displaced row says it was replaced rather than claiming the Mac sent it', () => {
  // It carries `source: 'mac'`, which is true and would otherwise draw "This Mac" — the same label
  // as an entry this Mac deliberately sent to the phone. Two different events reading identically
  // in the one list a person consults to undo something is how the undo gets missed.
  const displaced = api.clipRowSource({ kind: 'displaced', text: 'x', atMs: 1, source: 'mac' });
  assert.equal(displaced, 'Replaced on this Mac');
  assert.notEqual(displaced, api.clipRowSource({ kind: 'text', atMs: 1, source: 'mac' }));
});

// ---- The design's badges, over the kinds this wire actually carries --------------------------

test('a badge is drawn for every kind that can occur, and URL is a decision rather than a guess', () => {
  assert.deepEqual(api.clipRowBadge({ kind: 'text', text: 'https://example.com', atMs: 1, source: 'phone' }), {
    text: 'URL',
    tone: 'url',
  });
  // Prose containing a link is not a link — `openableUrl` is the single home of that rule and this
  // is the pane asking it rather than re-deciding with a regex of its own.
  assert.equal(api.clipRowBadge({ kind: 'text', text: 'see https://example.com', atMs: 1, source: 'phone' }).text, 'Aa');
  assert.equal(api.clipRowBadge({ kind: 'text', text: 'plain', atMs: 1, source: 'phone' }).text, 'Aa');
  assert.equal(api.clipRowBadge({ kind: 'sensitive', atMs: 1, source: 'phone' }).text, 'LOCK');
  assert.equal(api.clipRowBadge({ kind: 'displaced', text: 'x', atMs: 1, source: 'mac' }).text, 'UNDO');
  // An unknown kind gets a badge too, because the row is kept rather than discarded.
  assert.equal(api.clipRowBadge({ kind: 'image', atMs: 1, source: 'phone' }).text, '?');
});

test('no badge can ever read IMG, FILE or {} — those three cannot occur on this wire', () => {
  // `docs/protocol.md`: `clip.push` carries `kind` of text, empty or sensitive, and a text body.
  // The design draws five badges and three of them are for content this namespace has no way to
  // send. A badge that can never be drawn is a promise in a legend.
  const everyKind = ['text', 'empty', 'sensitive', 'displaced', 'too_large', 'image', 'file'];
  const drawn = everyKind.map((kind) => api.clipRowBadge({ kind, text: 'x', atMs: 1, source: 'phone' }).text);
  // Control first: the sweep produces real badges, so the absences below are readings and not an
  // empty list satisfying every assertion in the loop.
  assert.ok(drawn.includes('Aa') && drawn.includes('LOCK'), 'control: the sweep drew real badges');
  for (const forbidden of ['IMG', 'FILE', '{}']) {
    assert.ok(!drawn.includes(forbidden), `a ${forbidden} badge was drawable`);
  }
});

// ---- The sync timeline ------------------------------------------------------------------------

test('a phone entry is never described as "copied on the phone"', () => {
  // The sharpest rule in this pane. Android forbids a background clipboard read, so `atMs` is when
  // the phone *read* its clipboard — which is when somebody opened ConnectSuite on it, possibly an
  // hour after they copied. "Copied on phone" is a true-sounding sentence about the wrong moment,
  // which is exactly the shape defect 63 was.
  const steps = api.clipTimeline({ kind: 'text', text: 'x', atMs: 1000, receivedAtMs: 1200, source: 'phone', applied: true });
  assert.deepEqual(steps.map((s) => s.label), [
    'The phone read its clipboard',
    'Arrived on this Mac',
    'Put on this Mac’s clipboard',
  ]);
  for (const step of steps) {
    assert.ok(!/copied/i.test(step.label), `a step said "${step.label}"`);
  }
});

test('every dated step says whose clock it came from', () => {
  // The phone's `atMs` and this Mac's `receivedAtMs` are two machines' readings with no correction
  // between them. A timeline that stacked them unlabelled invites somebody to subtract one from the
  // other and call the difference latency.
  const steps = api.clipTimeline({ kind: 'text', text: 'x', atMs: 1000, receivedAtMs: 1200, source: 'phone', applied: true });
  const dated = steps.filter((s) => s.at !== undefined);
  assert.equal(dated.length, 2, 'control: there are dated steps to check');
  assert.deepEqual(dated.map((s) => s.clock), ['phone', 'mac']);
});

test('"not applied" and "not recorded" are two different final steps', () => {
  const refused = api.clipTimeline({ kind: 'sensitive', atMs: 1, receivedAtMs: 2, source: 'phone', applied: false });
  const unknown = api.clipTimeline({ kind: 'text', text: 'x', atMs: 1, receivedAtMs: 2, source: 'phone' });

  assert.equal(refused.at(-1)?.tone, 'refused');
  assert.equal(unknown.at(-1)?.tone, 'unknown');
  assert.notEqual(refused.at(-1)?.label, unknown.at(-1)?.label);
  // `undefined` is *nobody asked this question of this entry*, which is a different fact from
  // `false`. Collapsing them is the absence-read-as-a-negative failure inside a timeline.
  assert.match(unknown.at(-1)?.label ?? '', /not recorded/);
});

test('a Mac entry gets one recorded step and a pointer, rather than an invented second one', () => {
  const steps = api.clipTimeline({ kind: 'text', text: 'x', atMs: 1, source: 'mac' });
  assert.equal(steps[0].label, 'Copied on this Mac');
  assert.equal(steps[0].clock, 'mac');
  // What the phone did with it is in the `clip.push` ack and is not kept in this history. The
  // Activity log records all three outcomes, so the step points there instead of guessing.
  assert.equal(steps[1].tone, 'unknown');
  assert.match(steps[1].label, /Activity/);
  assert.equal(steps[1].at, undefined);
});

// ---- The filter strip ---------------------------------------------------------------------------

test('the filters split the list and a displaced entry stays on the Mac side', () => {
  const entries = [
    { kind: 'text', text: 'a', atMs: 3, source: 'phone' },
    { kind: 'displaced', text: 'b', atMs: 2, source: 'mac' },
    { kind: 'text', text: 'c', atMs: 1, source: 'mac' },
  ];
  assert.equal(api.filterClips(entries, 'all').length, 3);
  assert.deepEqual(api.filterClips(entries, 'phone').map((e) => e.text), ['a']);
  // The displaced row is this Mac's own clipboard, whatever caused it to be kept.
  assert.deepEqual(api.filterClips(entries, 'mac').map((e) => e.text), ['b', 'c']);
});

test('the Type row names what the badge means, in words', () => {
  assert.equal(api.clipTypeLabel({ kind: 'text', text: 'https://a.example', atMs: 1, source: 'phone' }), 'Link / URL');
  assert.equal(api.clipTypeLabel({ kind: 'text', text: 'hello', atMs: 1, source: 'phone' }), 'Text');
  assert.match(api.clipTypeLabel({ kind: 'sensitive', atMs: 1, source: 'phone' }), /sensitive/i);
  assert.match(api.clipTypeLabel({ kind: 'displaced', atMs: 1, source: 'mac' }), /put it back/i);
});
