import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installFakeDocument, installFakeWindow, FakeElement } from './domDouble.testkit';

/**
 * The chrome's three battery slots, driven through the **real** `ShellView`.
 *
 * ### The failure this exists for
 *
 * `shell.ts` carried these three lines for a phase:
 *
 * ```ts
 * $('device-battery').hidden = true;      // "…and **nothing subscribes to it**, so there is
 * $('strip-battery').hidden = true;       //  no number to show."
 * $('strip-divider-battery').hidden = true;
 * ```
 *
 * The comment was true when it was written and false from the day `VitalsFeature` landed:
 * `battery.state` is specified in `docs/protocol.md`, pushed by the phone, held and forwarded by
 * `main.ts`, and drawn on Overview's O4 ring. Three slots in the chrome stayed blank because of a
 * sentence, and **nothing in the build can compare a comment to a handler**.
 *
 * ### Why this file as well as `shared/deviceVitals.test.ts`
 *
 * That one proves the **decision** — what each battery state means. This one proves the **write**,
 * that the elements actually receive it. `CLAUDE.md`'s defect 67 is the case for needing both: a
 * rule can be correct, mutation-tested and entirely orthogonal to a feature that has never worked,
 * because the bug was in an assignment no test could reach. A `hidden = true` with no input is that
 * bug in its purest form — it is not even wrong about a value, it declines to have one.
 *
 * The decisive assertion is the last: the slots equal what `batterySlot` produces for the same
 * input. A test asserting *"the slot is not empty"* passes against a hard-coded `79%`, which is the
 * one repair nobody should be able to make.
 */

const require_ = createRequire(import.meta.url);

type Battery = { level: number | null; charging: boolean; capacityUnknown: boolean } | null;
interface Shell {
  setStatus(status: Record<string, unknown> | null): void;
  setBattery(state: Battery): void;
}

function mount(): {
  shell: Shell;
  card: FakeElement;
  strip: FakeElement;
  divider: FakeElement;
  facts: FakeElement;
  restore: () => void;
} {
  const doc = installFakeDocument({ byId: true });
  const win = installFakeWindow();
  const byId = (globalThis as unknown as { document: { getElementById(id: string): FakeElement } })
    .document.getElementById;
  byId('probe-app-window').className = 'app-window';

  const g = globalThis as Record<string, unknown>;
  g.connect = { routeChanged: () => {} };
  Object.assign(g, require_('../shared/linkTone.ts'));
  Object.assign(g, require_('../shared/islandState.ts'));
  Object.assign(g, require_('../shared/deviceVitals.ts'));
  Object.assign(g, require_('./icons.ts'));
  Object.assign(g, require_('./navModel.ts'));
  require_('./shell.ts');

  const View = (globalThis as Record<string, unknown>).ShellView as new () => Shell;
  return {
    shell: new View(),
    card: byId('device-battery'),
    strip: byId('strip-battery'),
    divider: byId('strip-divider-battery'),
    facts: byId('hero-facts'),
    restore: () => {
      win.restore();
      doc.restore();
    },
  };
}

const CONNECTED = { phase: 'connected', paired: true, deviceName: 'SM-S938B', rttMs: 9 };
const RECONNECTING = { phase: 'reconnecting', paired: true, deviceName: 'SM-S938B' };

test('a real reading reaches all three slots, and they were hidden before it', () => {
  const m = mount();
  try {
    m.shell.setStatus(CONNECTED);
    // The control, and the whole defect: with no battery in hand, every slot is correctly away.
    assert.equal(m.card.hidden, true, 'control: nothing to show before the phone reports');

    m.shell.setBattery({ level: 79, charging: false, capacityUnknown: false });
    assert.equal(m.card.hidden, false);
    assert.equal(m.card.textContent, '79%');
    assert.equal(m.strip.hidden, false);
    assert.equal(m.strip.textContent, '79%');
    assert.equal(m.divider.hidden, false, 'a divider with nothing on the far side of it');
  } finally {
    m.restore();
  }
});

/**
 * **Inverted twice, and the second inversion is the one that matters.**
 *
 * It first read: the hero draws four facts and *gains* a fifth when a battery arrives. On
 * 2026-09-16 that became "always six, and Battery carries its absence in the value", because
 * Slice 59 had added Battery and Storage rows against a reference mockup.
 *
 * **That reference is superseded** (`docs/design-departures.md`, top of file) and the handoff draws
 * a 2×2: Connected via / Latency / Encryption / Signal, with **no battery and no storage**. So it
 * is four again — departure O11 — and the reason is not layout, it is that the O4 ring and the
 * sidebar device card already carry those two facts. Three copies of a battery percentage on one
 * viewport is what the six-cell grid actually shipped.
 *
 * The battery has not left this file's subject: it still reaches the sidebar device card and the
 * connected-device strip, which is what every other test here asserts. What it no longer reaches is
 * the hero, and the assertion below is the guard on that — a fifth cell appearing is Slice 59's
 * grid coming back.
 */
test('the hero draws the handoff four, and a battery reading adds no fifth cell', () => {
  const m = mount();
  try {
    m.shell.setStatus(CONNECTED);
    assert.equal(m.facts.children.length, 4, 'control: the handoff 2x2, always');
    // Read the `dt` of each cell rather than regexing the cell's text. The first version split on
    // the first non-letter and got `ConnectionLocal` — there is no separator between a label and
    // its value in `textContent`, so the extraction invented one. The label is its own element.
    const labels = Array.from(
      m.facts.children,
      (c: { querySelector(s: string): { textContent: string } | null }) =>
        c.querySelector('.detail-label')?.textContent ?? '(no label)',
    );
    assert.deepEqual(
      labels,
      ['Connection', 'Address', 'Security', 'Latency'],
      'row-major, the Sidekick handoff 2 × 2: Connection, Address / Security, Latency',
    );
    assert.ok(
      !labels.some((t) => t === 'Battery' || t === 'Storage'),
      `neither belongs on this card — got ${labels.join(' | ')}`,
    );

    m.shell.setBattery({ level: 42, charging: true, capacityUnknown: false });
    assert.equal(m.facts.children.length, 4, 'a reading must not add a cell back');
    assert.ok(
      !m.facts.textContent.includes('42%'),
      'the hero drew a battery reading; it belongs to the sidebar card, the strip and the O4 ring',
    );
    // The control for that negative: the same reading did reach the surface that should have it.
    assert.equal(m.card.textContent, '42%');
  } finally {
    m.restore();
  }
});

test('the battery survives a status update that knows nothing about it', () => {
  // The reason `battery` is a field and not a parameter. A heartbeat is seconds and a stationary
  // battery can be an hour, so a status-shaped write would blank the slot between readings — the
  // feature working only in the instant after a battery tick, which is a shape nobody would notice.
  const m = mount();
  try {
    m.shell.setBattery({ level: 61, charging: false, capacityUnknown: false });
    m.shell.setStatus(CONNECTED);
    assert.equal(m.card.textContent, '61%');
    m.shell.setStatus({ ...CONNECTED, rttMs: 14 });
    assert.equal(m.card.textContent, '61%', 'a second status erased it');
    assert.equal(m.card.hidden, false);
  } finally {
    m.restore();
  }
});

test('a link that is not live takes the slots away, and the reading is untouched', () => {
  // Defect 96 on a new surface: a percentage in the chrome is a claim about now. The reading here
  // is a perfectly good 79% throughout — what changes is whether this Mac can vouch for it.
  const m = mount();
  try {
    m.shell.setBattery({ level: 79, charging: false, capacityUnknown: false });
    m.shell.setStatus(CONNECTED);
    assert.equal(m.card.hidden, false, 'control: it shows while the link is live');

    m.shell.setStatus(RECONNECTING);
    assert.equal(m.card.hidden, true);
    assert.equal(m.strip.hidden, true);
    assert.equal(m.divider.hidden, true);
    // The hero has no battery cell to blank — departure O11 — so the guard is that the *whole*
    // card is free of the reading in both directions. A count could not see the difference
    // between a removed cell and one still showing a stale 79%; this can.
    assert.equal(m.facts.children.length, 4, 'the grid keeps its shape');
    assert.ok(
      !m.facts.textContent.includes('79%'),
      `a link that is not live must not vouch for a reading: ${m.facts.textContent}`,
    );

    m.shell.setStatus(CONNECTED);
    assert.equal(m.card.hidden, false, 'and comes back without a second battery message');
    assert.equal(m.card.textContent, '79%');
  } finally {
    m.restore();
  }
});

test('an unpaired shell shows no battery at all', () => {
  const m = mount();
  try {
    m.shell.setBattery({ level: 79, charging: false, capacityUnknown: false });
    m.shell.setStatus(null);
    assert.equal(m.card.hidden, true);
    m.shell.setStatus({ phase: 'idle', paired: false });
    assert.equal(m.card.hidden, true);
  } finally {
    m.restore();
  }
});

test('the slots equal what batterySlot produces — not a value of their own', () => {
  /*
   * The decisive assertion, and the reason the others are not enough.
   *
   * `CLAUDE.md`'s fourth test variety: an assertion whose subject is a likeness rather than a fact
   * holds while the thing it is not constraining moves. "The slot is not empty" is satisfied by a
   * hard-coded string; "the slot shows a percentage" is satisfied by a second copy of the rule in
   * `shell.ts` that drifts from the ring on Overview. This asserts the slot equals the production
   * rule's output for the same input, so any second writer fails on its first tick.
   */
  const { batterySlot } = require_('../shared/deviceVitals.ts') as {
    batterySlot: (s: Battery, live: boolean) => { show: boolean; text: string; detail: string };
  };
  const m = mount();
  try {
    for (const state of [
      null,
      { level: 0, charging: false, capacityUnknown: false },
      { level: 5, charging: true, capacityUnknown: false },
      { level: 79, charging: false, capacityUnknown: false },
      { level: 100, charging: true, capacityUnknown: false },
      { level: null, charging: false, capacityUnknown: true },
      { level: null, charging: false, capacityUnknown: false },
    ] as Battery[]) {
      for (const [status, live] of [
        [CONNECTED, true],
        [RECONNECTING, false],
        [null, false],
      ] as [Record<string, unknown> | null, boolean][]) {
        m.shell.setBattery(state);
        m.shell.setStatus(status);
        const want = batterySlot(state, live);
        const where = `${JSON.stringify(state)} @ ${status?.phase ?? 'null'}`;
        assert.equal(m.card.hidden, !want.show, where);
        assert.equal(m.strip.hidden, !want.show, where);
        assert.equal(m.divider.hidden, !want.show, where);
        assert.equal(m.card.textContent, want.text, where);
        assert.equal(m.strip.textContent, want.text, where);
        // The hero, against the same production rule — and since O11 the rule for this card is
        // that the reading never reaches it. Asserting the absence of the *rule's own output*
        // rather than a cell count: a count is a proxy for "is the reading shown", and a proxy
        // stops tracking the moment the shape it borrowed moves. `want.text` is the exact string
        // the sidebar is asserted to hold two lines above, so this cannot pass by looking for
        // something nothing ever draws.
        assert.equal(m.facts.children.length, 4, where);
        if (want.show) {
          assert.ok(!m.facts.textContent.includes(want.text), `${where}: hero drew ${want.text}`);
        }
      }
    }
  } finally {
    m.restore();
  }
});
