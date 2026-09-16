import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WheelPump } = require('./wheelPump') as { WheelPump: new () => any };

const tick = (dy: number, x = 500, y = 900) => ({ x, y, dx: 0, dy });

/*
 * The rates these tests are written against are hardware readings, not round numbers:
 * the phone consumes a scroll gesture every 117 ms (median of 181 back-to-back gestures in its own
 * log) and the old fixed window produced one every 60 ms. Defect 112.
 */

test('one gesture goes out and nothing follows it until the phone answers', () => {
  const pump = new WheelPump();
  pump.add(tick(-40));
  const first = pump.due();
  assert.deepEqual(first, { x: 500, y: 900, dx: 0, dy: -40 });

  // Everything that arrives while the phone holds the first one accumulates instead of queueing.
  pump.add(tick(-40));
  pump.add(tick(-40));
  assert.equal(pump.due(), null, 'a second gesture must not go out while one is in flight');
  assert.equal(pump.inFlight, true);
  assert.equal(pump.owing, true);

  pump.settled();
  assert.deepEqual(pump.due(), { x: 500, y: 900, dx: 0, dy: -80 }, 'the two are summed, not dropped');
});

test('a whole trackpad flick at the real rates becomes as many gestures as the phone can run', () => {
  // 40 wheel events over 600ms — a continuous two-finger scroll, the rate that produced the defect.
  // The phone answers every 117ms, so ~5 gestures fit; the old code would have emitted 10 and had
  // 14 of them thrown away after waiting 400ms.
  const pump = new WheelPump();
  let sent = 0;
  let deliveredDy = 0;
  let nextReplyAt = -1;
  for (let ms = 0; ms < 600; ms += 15) {
    if (nextReplyAt >= 0 && ms >= nextReplyAt) {
      pump.settled();
      nextReplyAt = -1;
    }
    pump.add(tick(-20));
    const due = pump.due();
    if (due) {
      sent += 1;
      deliveredDy += due.dy;
      nextReplyAt = ms + 117;
    }
  }
  assert.ok(sent <= 6, `at most one gesture per 117ms reply, got ${sent}`);
  assert.ok(sent >= 4, `and it must keep up, got ${sent}`);

  /*
   * And nothing is lost. The first version of this assertion was a garbled expression that compared
   * a value with itself — a test that could not fail, which is the failure `CLAUDE.md` names four
   * varieties of. Stated plainly instead: the pixels delivered plus the pixels still owed equal the
   * pixels the wheel asked for. There are 40 events of -20.
   */
  pump.settled();
  const owed = pump.due();
  assert.equal(deliveredDy + (owed?.dy ?? 0), -20 * 40, 'every wheel pixel is delivered or owed');
});

test('no wheel input is lost across a burst — the sum out equals the sum in', () => {
  const pump = new WheelPump();
  const deltas = [-120, -80, -40, -20, -10, -5, -2];   // a real momentum decay from the Mac's log
  let out = 0;
  for (const d of deltas) {
    pump.add(tick(d));
    const due = pump.due();
    if (due) {
      out += due.dy;
      pump.settled();          // an instant phone, so every one gets its own gesture
    }
  }
  const leftover = pump.due();
  assert.equal(out + (leftover?.dy ?? 0), deltas.reduce((a, b) => a + b, 0));
});

test('the anchor is the newest point, because that is where the user is looking', () => {
  const pump = new WheelPump();
  pump.add({ x: 100, y: 100, dx: 0, dy: -20 });
  pump.add({ x: 700, y: 1800, dx: 0, dy: -20 });
  assert.deepEqual(pump.due(), { x: 700, y: 1800, dx: 0, dy: -40 });
});

test('two opposite flicks that cancel are not sent, because the phone refuses a zero scroll', () => {
  const pump = new WheelPump();
  pump.add(tick(-40));
  pump.add(tick(40));
  assert.equal(pump.due(), null);
  assert.equal(pump.inFlight, false, 'and nothing is left in flight, or the pump would stall');
});

test('a reply arriving with nothing owed leaves the pump ready rather than stalled', () => {
  const pump = new WheelPump();
  pump.add(tick(-40));
  pump.due();
  pump.settled();
  assert.equal(pump.due(), null, 'nothing owed');
  pump.add(tick(-40));
  assert.deepEqual(pump.due(), { x: 500, y: 900, dx: 0, dy: -40 }, 'and it still goes out');
});

test('a rotation abandons what was owed rather than aiming it at the new screen', () => {
  const pump = new WheelPump();
  pump.add(tick(-40));
  pump.due();
  pump.add(tick(-40));
  pump.reset();
  assert.equal(pump.owing, false);
  assert.equal(pump.inFlight, false);
  assert.equal(pump.due(), null);
});

test('the tally carries the denominator, not just the count', () => {
  const pump = new WheelPump();
  for (let i = 0; i < 10; i += 1) pump.add(tick(-20));
  pump.due();
  pump.settled();
  for (let i = 0; i < 5; i += 1) pump.add(tick(-20));
  pump.due();
  const line = pump.tally();
  assert.match(line, /2 sent \/ 15 wheel events/);
  assert.match(line, /widest fold 10/, 'the widest fold is what a flick looks like from here');
});
