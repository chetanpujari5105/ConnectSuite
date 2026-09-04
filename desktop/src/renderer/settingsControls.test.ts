import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument } from './domDouble.testkit';
import './settingsControls';

/**
 * The four controls a Settings pane is built out of.
 *
 * One of them has behaviour and the other three are shapes. {@link settingToggle} is the one:
 * every switch in this app controls something **the system owns** — a login item, a preference in
 * the main process — and a switch that draws its own intention is a check that does not gate. When
 * it is wrong it is silent: the box says on, the login item is off, and nothing on screen disagrees.
 */

installFakeDocument();

const controls = globalThis as unknown as {
  settingRow(label: string, sub: string, control: FakeElement): FakeElement;
  settingToggle(
    label: string,
    sub: string,
    read: () => Promise<boolean>,
    write: (on: boolean) => Promise<boolean>,
    onDisagree?: (asked: boolean, actual: boolean) => void,
  ): FakeElement;
  settingLimit(name: string, kind: 'wall' | 'unbuilt', why: string): FakeElement;
  settingValue(label: string, sub: string, value: string): FakeElement;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const switchOf = (row: FakeElement) => row.queryAll('.switch')[0];

test('the switch draws the system’s answer, not the markup’s default', async () => {
  const on = controls.settingToggle('Start on login', 'sub', async () => true, async () => true);
  const off = controls.settingToggle('Start on login', 'sub', async () => false, async () => false);
  await settle();

  assert.equal(switchOf(on).getAttribute('aria-checked'), 'true');
  // The control: the same code path with the other answer, so "always false" cannot pass.
  assert.equal(switchOf(off).getAttribute('aria-checked'), 'false');
  assert.ok(switchOf(on).classList.contains('is-on'));
  assert.ok(!switchOf(off).classList.contains('is-on'));
});

test('a write the system refuses flips the switch back and says so', async () => {
  // `setLoginItemSettings` returns void and there are real conditions in which it does not take —
  // a login item disabled in System Settings, a translocated bundle. This is the whole reason the
  // write returns what macOS reports *afterwards* rather than what it was asked for.
  const disagreements: [boolean, boolean][] = [];
  const row = controls.settingToggle(
    'Start on login',
    'sub',
    async () => false,
    async () => false, // asked for true, the system still says false
    (asked, actual) => disagreements.push([asked, actual]),
  );
  await settle();
  const box = switchOf(row);

  box.click();
  // Painted optimistically first, because the round trip is a few milliseconds and a switch that
  // waits for it feels broken. What it must not do is *stay* painted on an answer nobody gave.
  assert.equal(box.getAttribute('aria-checked'), 'true');

  await settle();
  assert.equal(box.getAttribute('aria-checked'), 'false', 'the switch kept an answer the system did not give');
  assert.deepEqual(disagreements, [[true, false]]);
});

test('a write the system honours leaves the switch on and says nothing', async () => {
  const disagreements: unknown[] = [];
  const row = controls.settingToggle(
    'Play a sound',
    'sub',
    async () => false,
    async () => true,
    () => disagreements.push(1),
  );
  await settle();
  const box = switchOf(row);

  box.click();
  await settle();
  assert.equal(box.getAttribute('aria-checked'), 'true');
  // The control on the assertion above: `onDisagree` fires in the refusal test, so its silence here
  // is the code discriminating rather than a callback that never runs.
  assert.deepEqual(disagreements, []);
});

test('the switch carries its state where a screen reader can read it', async () => {
  // Defect 26, one pane over: a capability chip whose state was a background colour and nothing
  // else announced twelve names and no indication which were on.
  const row = controls.settingToggle('Start on login', 'sub', async () => true, async () => true);
  await settle();
  const box = switchOf(row);
  assert.equal(box.getAttribute('role'), 'switch');
  assert.equal(box.getAttribute('aria-label'), 'Start on login');
  assert.equal(box.getAttribute('aria-checked'), 'true');
});

test('a limit row says WHICH kind it is, in two words', () => {
  // "Android forbids this" and "nobody has built it" are different facts, and somebody deciding
  // whether to go looking in Settings needs to know which one they are reading. A greyed control
  // would say neither.
  const wall = controls.settingLimit('Show touches', 'wall', 'a signature-level permission');
  const unbuilt = controls.settingLimit('Automatic updates', 'unbuilt', 'there is no update server');

  assert.equal(wall.queryAll('.limit-tag')[0].textContent, 'Not possible');
  assert.equal(unbuilt.queryAll('.limit-tag')[0].textContent, 'Not yet');
  assert.notEqual(
    wall.queryAll('.limit-tag')[0].className,
    unbuilt.queryAll('.limit-tag')[0].className,
    'the two kinds must not be one style with two words',
  );
  // And neither is pressable: a limit row is a statement, and a disabled-looking control is a
  // promise that it might one day light up.
  assert.equal(wall.queryAll('button').length, 0);
  assert.equal(unbuilt.queryAll('button').length, 0);
});

test('a value row is a fact and offers nothing to press', () => {
  const row = controls.settingValue('Duplicate handling', 'a numbered suffix', 'Keep both');
  assert.match(row.textContent, /Keep both/);
  assert.match(row.textContent, /Duplicate handling/);
  assert.equal(row.queryAll('button').length, 0);
  assert.equal(row.queryAll('.switch').length, 0);
});

test('every row carries its label and its explanation, not just its control', () => {
  // The design's row is label + sub + control, and the sub is where every one of this pane's
  // arguments lives — "Always on", "Follows the grant", "Not possible" all mean nothing without it.
  const row = controls.settingRow('Label', 'The explanation', new FakeElement('span'));
  assert.equal(row.queryAll('.setting-label')[0].textContent, 'Label');
  assert.equal(row.queryAll('.setting-sub')[0].textContent, 'The explanation');
});
