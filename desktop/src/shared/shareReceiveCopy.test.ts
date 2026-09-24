import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECEIVE_STATES } from '../main/share';
const { shareReceiveStatus } = require('./shareReceiveCopy') as {
  shareReceiveStatus: (f: Record<string, unknown>) => {
    headline: string; detail: string[]; tone: string; savedOnMac: boolean; confirmedByPhone: boolean;
  };
};

/**
 * The claim is about **facts on the status**, not about how alike two sentences are: `savedOnMac`
 * and `confirmedByPhone` are fields, and each state is asserted on its own (CLAUDE.md, the fourth
 * test variety).
 */

const facts = (state: string, over: Record<string, unknown> = {}) =>
  ({ state, wantedName: 'IMG_2041.jpg', savedAs: null, reason: null, priorCopy: null, ...over });

test('saved but unacknowledged says exactly that, and does not claim the phone confirmed it', () => {
  const s = shareReceiveStatus(facts('saved-unacknowledged', { savedAs: 'IMG_2041.jpg' }));
  assert.equal(s.headline, 'Saved on this Mac; confirmation to phone unknown');
  assert.equal(s.savedOnMac, true);
  assert.equal(s.confirmedByPhone, false);
  assert.notEqual(s.tone, 'success', 'not drawn as an unqualified success');
  assert.ok(s.detail.some((d) => /second copy/.test(d)), 'says a resend would duplicate');
});

test('only the acknowledged save says the phone confirmed it', () => {
  for (const state of RECEIVE_STATES) {
    const s = shareReceiveStatus(facts(state, { savedAs: 'IMG_2041.jpg' }));
    assert.equal(s.confirmedByPhone, state === 'saved', state);
  }
});

test('nothing says Saved before the Mac has published — every pre-publication and failed state', () => {
  for (const state of RECEIVE_STATES) {
    const s = shareReceiveStatus(facts(state));
    const published = state === 'saved' || state === 'saved-unacknowledged';
    assert.equal(s.savedOnMac, published, state);
    if (!published) assert.doesNotMatch(s.headline, /^Saved/, state);
  }
});

test('expired is expired — never worded as declined', () => {
  const s = shareReceiveStatus(facts('expired'));
  assert.equal(s.headline, 'Expired');
  assert.doesNotMatch([s.headline, ...s.detail].join(' '), /declin/i);
});

test('a collision rename is stated, and says nothing was replaced', () => {
  const s = shareReceiveStatus(facts('saved-unacknowledged', { savedAs: 'IMG_2041 (2).jpg' }));
  assert.ok(s.detail.some((d) => d.includes('saved as IMG_2041 (2).jpg') && d.includes('Nothing was replaced')));
});

test('an offer carrying bytes already saved this run is shown as a possible second copy, before Accept', () => {
  const s = shareReceiveStatus(facts('awaiting-decision', { priorCopy: { savedAs: 'IMG_2041.jpg', acknowledged: false } }));
  assert.ok(s.detail.some((d) => d.includes('IMG_2041.jpg') && /never confirmed/.test(d) && /second copy/.test(d)));
});

test('every receive state has a status (the two lists cannot drift)', () => {
  for (const state of RECEIVE_STATES) assert.ok(shareReceiveStatus(facts(state)).headline.length > 0, state);
});
