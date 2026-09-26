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

test('a collision rename is stated, and says nothing was replaced — the name itself is the card row’s job', () => {
  const s = shareReceiveStatus(facts('saved-unacknowledged', { savedAs: 'IMG_2041 (2).jpg' }));
  assert.ok(s.detail.some((d) => d.includes('given a new name') && d.includes('Nothing was replaced')));
  const plain = shareReceiveStatus(facts('saved-unacknowledged', { savedAs: 'IMG_2041.jpg' }));
  assert.ok(!plain.detail.some((d) => d.includes('new name')), 'control: no rename sentence when the name was kept');
});

test('the status lines of a published file name no file — the title and the Saved-as row carry the names (P1)', () => {
  for (const state of ['saved', 'saved-unacknowledged'] as const) {
    for (const savedAs of ['IMG_2041.jpg', 'IMG_2041 (2).jpg']) {
      const s = shareReceiveStatus(facts(state, { savedAs }));
      assert.ok(s.detail.length > 0, `control: ${state} has detail lines to read`);
      for (const d of s.detail) assert.ok(!d.includes('IMG_2041'), `${state}/${savedAs}: ${d}`);
    }
  }
});

test('an offer carrying bytes already saved this run is shown as a possible second copy, before Accept', () => {
  const s = shareReceiveStatus(facts('awaiting-decision', { priorCopy: { savedAs: 'IMG_2041.jpg', acknowledged: false } }));
  assert.ok(s.detail.some((d) => d.includes('IMG_2041.jpg') && /never confirmed/.test(d) && /second copy/.test(d)));
});

test('every receive state has a status (the two lists cannot drift)', () => {
  for (const state of RECEIVE_STATES) assert.ok(shareReceiveStatus(facts(state)).headline.length > 0, state);
});

test('unexpected-file: not saved, never confirmed, and it names the exact file and folder (two different cases)', () => {
  for (const [name, folder] of [['Budget (2).xlsx', '~/Downloads/Sidekick'], ['IMG_9 (3).heic', '/Volumes/Archive/Inbox']] as const) {
    const s = shareReceiveStatus(facts('unexpected-file', { reason: 'write-failed', unexpectedName: name, folder }));
    assert.equal(s.savedOnMac, false);
    assert.equal(s.confirmedByPhone, false);
    assert.equal(s.tone, 'danger');
    assert.equal(s.headline, 'Not saved — a different file appeared');
    assert.ok(s.detail[0]!.includes(`“${name}” in ${folder}.`), s.detail[0]);
    assert.ok(s.detail.some((d) => d.includes('did not open it')), s.detail.join(' | '));
  }
});

test('v3: before Accept, the owner’s exact sentence — and only at version 3', () => {
  const sentence = 'Accept this file now. If another transfer is running, this one starts when it finishes.';
  assert.equal(shareReceiveStatus(facts('awaiting-decision', { queueMode: true })).detail[0], sentence);
  assert.ok(!shareReceiveStatus(facts('awaiting-decision', { queueMode: false })).detail.includes(sentence), 'version 2 unchanged');
  assert.ok(!shareReceiveStatus(facts('awaiting-decision')).detail.includes(sentence));
});

test('v3: queued says accepted and waiting, how many are ahead, and never that anything is saved', () => {
  for (const [ahead, line] of [[1, '1 transfer is ahead of it.'], [3, '3 transfers are ahead of it.']] as const) {
    const s = shareReceiveStatus(facts('queued', { filesAhead: ahead }));
    assert.equal(s.headline, 'Accepted — waiting its turn');
    assert.equal(s.detail[0], line);
    assert.equal(s.savedOnMac, false);
    assert.equal(s.confirmedByPhone, false);
  }
});

test('staging-lost is the phone losing its copy — named as that, never as a cancel and never as the person’s act', () => {
  const s = shareReceiveStatus(facts('cancelled', { reason: 'staging-lost' }));
  assert.equal(s.headline, 'The phone’s copy was lost');
  assert.deepEqual(s.detail, [
    'The copy the phone prepared for this file is no longer on the phone, so nothing was sent.',
    'Nothing was saved. Share it again from the phone.',
  ]);
  assert.equal(s.tone, 'warning');
  assert.equal(s.savedOnMac, false);
  assert.equal(s.confirmedByPhone, false);
  // The same end without that reason stays the plain cancel (a person, on either side).
  assert.equal(shareReceiveStatus(facts('cancelled')).headline, 'Cancelled');
});
