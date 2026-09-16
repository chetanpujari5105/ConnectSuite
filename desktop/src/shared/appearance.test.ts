/*
 * The appearance rule. Small, and it is the transition that matters rather than the mapping.
 *
 * Defect 67's lesson is the reason these exist at all: a state machine whose *decision* had eleven
 * passing tests over a feature that had never once worked, because the value it decided on was
 * written somewhere no test could reach. So `resolveTheme` is a pure function taking both inputs
 * explicitly — there is no ambient `nativeTheme` to mock and no field for a test to fill in by hand
 * with a well-formed value the product never produces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveTheme, asAppearance, APPEARANCES, WINDOW_GROUND, FLOAT_GROUND } =
  require('./appearance') as {
    resolveTheme: (a: 'system' | 'light' | 'dark', systemDark: boolean) => 'light' | 'dark';
    asAppearance: (v: unknown) => 'system' | 'light' | 'dark';
    APPEARANCES: readonly ('system' | 'light' | 'dark')[];
    WINDOW_GROUND: Record<'light' | 'dark', string>;
    FLOAT_GROUND: Record<'light' | 'dark', string>;
  };

test('an explicit choice ignores what macOS is doing — in both directions', () => {
  // The whole point of Light and Dark existing beside System. A resolver that consulted the OS
  // here would make "Light" mean "light unless the Mac disagrees", which is System with extra steps.
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('system follows macOS, and is the only setting that does', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('system is the default, and every unknown value lands there', () => {
  // A store read can return anything: a hand-edited JSON file, undefined on first run, or a value
  // written by a build that had a fourth option. None of those may make the app unstartable.
  assert.equal(asAppearance(undefined), 'system');
  assert.equal(asAppearance(null), 'system');
  assert.equal(asAppearance('sepia'), 'system');
  assert.equal(asAppearance(''), 'system');
  assert.equal(asAppearance(7), 'system');
  assert.equal(asAppearance({}), 'system');
});

test('control_a real value is not defaulted away', () => {
  // Without this, `asAppearance` could `return 'system'` unconditionally and every test above passes.
  assert.equal(asAppearance('light'), 'light');
  assert.equal(asAppearance('dark'), 'dark');
  assert.equal(asAppearance('system'), 'system');
});

test('the three appearances are exactly the three the Settings control offers', () => {
  assert.deepEqual([...APPEARANCES], ['system', 'light', 'dark']);
});

test('both grounds are opaque hexes, because AppKit cannot paint an alpha here', () => {
  // These are read by BrowserWindow before any stylesheet loads. A value with alpha, or an rgba()
  // string, is silently ignored by Electron and the window opens on the default white.
  for (const map of [WINDOW_GROUND, FLOAT_GROUND]) {
    for (const theme of ['light', 'dark'] as const) {
      assert.match(map[theme], /^#[0-9a-f]{6}$/, `${theme}: ${map[theme]}`);
    }
  }
});

test('the light grounds are lighter than the dark ones', () => {
  // A cheap guard against the two being transposed, which would be invisible except as a flash of
  // the wrong colour for one frame at launch — the exact defect the grounds exist to prevent.
  const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(lum(WINDOW_GROUND.light) > lum(WINDOW_GROUND.dark));
  assert.ok(lum(FLOAT_GROUND.light) > lum(FLOAT_GROUND.dark));
});
