import assert from 'node:assert/strict';
import test from 'node:test';

import { reservationOf, reservedBytes } from './shareReservations';
import { RECEIVE_STATES } from '../main/share';

/** The reservation rule, state by state, with its release points (docs/protocol.md → Version 3 §4). */

const o = (state: string, size = 1000, receivedBytes: number | null = null, offerId = 's-X') => ({ offerId, state, size, receivedBytes });

test('accepting and queued reserve the whole size: authorised, nothing written yet', () => {
  assert.equal(reservationOf(o('accepting')), 1000);
  assert.equal(reservationOf(o('queued')), 1000);
});

test('receiving reserves only what is still to come — the written part is already out of free space', () => {
  assert.equal(reservationOf(o('receiving', 1000, 0)), 1000);
  assert.equal(reservationOf(o('receiving', 1000, 400)), 600);
  assert.equal(reservationOf(o('receiving', 1000, 1000)), 0);
  assert.equal(reservationOf(o('receiving', 1000, null)), 1000, 'no count yet is nothing written');
});

test('every other state holds nothing back — each is a release point, the saved states included', () => {
  const holding = new Set(['accepting', 'queued', 'receiving']);
  let released = 0;
  for (const state of RECEIVE_STATES) {
    if (holding.has(state)) continue;
    assert.equal(reservationOf(o(state, 1000, 500)), 0, state);
    released += 1;
  }
  assert.ok(released >= 10, `control: ${released} release states were checked`);
});

test('the sum leaves out the offer being judged, so its own claim is never counted against it', () => {
  const all = [o('receiving', 5000, 2000, 's-A'), o('queued', 300, null, 's-B'), o('saved', 9999, 9999, 's-C'), o('awaiting-decision', 700, null, 's-D')];
  assert.equal(reservedBytes(all), 3000 + 300);
  assert.equal(reservedBytes(all, 's-B'), 3000);
  assert.equal(reservedBytes(all, 's-D'), 3300, 'a waiting offer reserves nothing, so leaving it out changes nothing');
});
