/**
 * Defect 46's guard: the remote may show a package id, and never on its own.
 *
 * These assert over `remoteUserVisibleStrings` — the whole enumeration — rather than over the two
 * sentences a screenshot showed. That is the shape defect 28 produced and defect 46 proved was
 * still needed: the register described 46 as three sites with two of them wrong, and enumerating
 * found **four**, because the two written as `appName ?? 'This app'` looked correct and were the
 * other wrong fix — safe sentences that throw the handle away.
 *
 * Shown to fail, per CLAUDE.md. Restoring `appName ?? package ?? 'an app'` in
 * `remoteNowPlayingNoteOf` turns "a handle is never the only thing a person reads" red; restoring
 * `appName ?? 'This app'` in `remoteSkipTitleOf` turns "a handle is never dropped for a generic"
 * red. Both were put back. `control_the assertion can tell a marked handle from a bare one` is the
 * in-suite version, so the discrimination is checked on every run rather than on the day somebody
 * remembered to break it by hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveAppLabel,
  appPhrase,
  remoteUserVisibleStrings,
} = require('./appLabel.ts');

const PKG = 'com.spotify.music';

/** A state whose label resolved: the name and the package share nothing. */
const resolved = { appName: 'Spotify', package: PKG, playing: true };
/** The defect's case: the phone had no launcher icon to resolve, so `appName` never arrived. */
const fellBack = { package: PKG, playing: false };
/** `AppLabels.of`'s honest fallback, arriving as an explicit value rather than as an absence. */
const echoed = { appName: PKG, package: PKG, playing: true };
/** Neither field. The wire allows it and nothing should say "undefined". */
const unknown = { playing: false };

const MARK = '(app name unavailable)';

test('a resolved label never puts the package in front of anyone', () => {
  for (const drawn of remoteUserVisibleStrings(resolved)) {
    assert.ok(!drawn.includes(PKG), `package id leaked into: ${drawn}`);
    assert.ok(drawn.includes('Spotify'), `the resolved name is missing from: ${drawn}`);
  }
});

test('a handle is never the only thing a person reads', () => {
  const drawn = remoteUserVisibleStrings(fellBack);
  for (const one of drawn) {
    assert.ok(one.includes(PKG), `the handle was dropped from: ${one}`);
    assert.ok(one.includes(MARK), `an unmarked package id reached a sentence: ${one}`);
  }
});

test('a handle is never dropped for a generic either', () => {
  // The other wrong fix. "This app does not allow skipping" is a safe sentence that tells the user
  // nothing and tells nobody the resolution failed.
  for (const one of remoteUserVisibleStrings(fellBack)) {
    assert.ok(!/\b(This|That|an) app\b/.test(one.replace(MARK, '')), `a generic replaced the handle: ${one}`);
  }
});

test('an appName echoing the package is a fallback, not a name', () => {
  for (const one of remoteUserVisibleStrings(echoed)) {
    assert.ok(one.includes(MARK), `an echoed package was treated as a resolved name: ${one}`);
  }
});

test('neither field: each sentence uses its own generic and none says undefined', () => {
  const drawn = remoteUserVisibleStrings(unknown);
  for (const one of drawn) {
    assert.ok(!/undefined|null/.test(one), `a missing field reached the sentence: ${one}`);
    assert.ok(!one.includes(MARK), `nothing to mark, but it was marked: ${one}`);
  }
  // The generics differ by sentence position on purpose — "Paused in an app" against "That app
  // does not allow…" — and a shared module that picked one would leave half the callers wrong.
  assert.ok(drawn.some((one: string) => one.includes('in an app')));
  assert.ok(drawn.some((one: string) => one.startsWith('This app')));
  assert.ok(drawn.some((one: string) => one.startsWith('That app')));
});

test('resolveAppLabel says which case it is, not just what to print', () => {
  assert.deepEqual(resolveAppLabel(resolved, 'x'), { label: 'Spotify', isPackageFallback: false, isUnknown: false });
  assert.deepEqual(resolveAppLabel(fellBack, 'x'), { label: PKG, isPackageFallback: true, isUnknown: false });
  assert.deepEqual(resolveAppLabel(echoed, 'x'), { label: PKG, isPackageFallback: true, isUnknown: false });
  assert.deepEqual(resolveAppLabel(unknown, 'x'), { label: 'x', isPackageFallback: false, isUnknown: true });
  // Whitespace is not a name. A sentence headed by nothing is worse than one headed by a handle.
  assert.deepEqual(resolveAppLabel({ appName: '   ', package: PKG }, 'x'),
    { label: PKG, isPackageFallback: true, isUnknown: false });
});

test('the guard covers the pane, not a line', () => {
  // The count is the thing that notices when a sentence is added to the remote and not to the
  // enumeration. A number that does not move when the pane grows has stopped measuring anything —
  // notifyLabels.ts learned this at 7 → 10.
  assert.equal(remoteUserVisibleStrings(resolved).length, 7);
  assert.equal(remoteUserVisibleStrings(fellBack).length, 7);
  assert.equal(new Set(remoteUserVisibleStrings(fellBack)).size, 7, 'two enumerated strings are identical');
});

test('control_the assertion can tell a marked handle from a bare one', () => {
  // Without this, every assertion above would pass against a checker that cannot see the defect.
  assert.ok(appPhrase(fellBack, 'an app').includes(MARK));
  assert.ok(!appPhrase(resolved, 'an app').includes(MARK));
  assert.throws(() => {
    const bare = `Paused in ${PKG}.`;
    assert.ok(bare.includes(MARK), 'a bare handle must not satisfy the mark assertion');
  });
});
