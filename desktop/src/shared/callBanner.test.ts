import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CALL_BANNER_HOLD_MS,
  CallBannerDecision,
  CallBannerState,
  callBannerCopy,
  type CallBannerView,
} from './callBanner';
import type { IncomingCall } from './protocol';

/**
 * The incoming-call banner's decision, driven in production order.
 *
 * main.ts's order is the one these tests use: the status turns `connected` (→ `sessionReady`)
 * **before** the phone's replayed `call.incoming` is handled; a drop ends the session and then
 * `calls.clear()` emits `changed(null)`; the inbound number arrives as a **second** `call.incoming`
 * 16–535 ms after the first (defect 45, 7 of 7 episodes), carrying the same `callId` and
 * `startedAtMs`.
 */

const ON: CallBannerView = { enabled: true, windowFocused: false, currentScreen: 'overview' };
const OFF: CallBannerView = { ...ON, enabled: false };
const ON_CALLS: CallBannerView = { enabled: true, windowFocused: true, currentScreen: 'calls' };

const NAMED: IncomingCall = {
  callId: 'c17',
  number: '+15551234567',
  contactName: 'Ada Lovelace',
  startedAtMs: 1756300000000,
  state: 'ringing',
};
/** The first event of an inbound call: the number has not arrived yet. */
const EARLY: IncomingCall = { callId: 'c18', number: '', startedAtMs: 1756300100000, state: 'ringing' };
/** The same call, corrected, as the phone re-sends it. */
const CORRECTED: IncomingCall = { ...EARLY, number: '+15559998888', contactName: 'R. Sharma' };

function ready(): CallBannerState {
  const state = new CallBannerState();
  state.sessionReady();
  return state;
}

// ---- The gate --------------------------------------------------------------------------------

test('with the gate off nothing is posted or held', () => {
  const state = ready();
  for (const call of [NAMED, EARLY]) {
    const action = state.onCall(call, OFF);
    assert.equal(action.decision, CallBannerDecision.GATE_OFF);
    assert.equal(action.post, null);
    assert.equal(action.hold, null);
  }
});

// ---- Posting ---------------------------------------------------------------------------------

test('a ringing call with a contact posts the approved copy', () => {
  const action = ready().onCall(NAMED, ON);
  assert.equal(action.decision, CallBannerDecision.POST);
  assert.ok(action.post);
  assert.equal(action.post.title, 'Incoming call');
  assert.equal(action.post.body, 'Ada Lovelace. Answer or decline on your phone, or in Sidekick.');
});

test('a ringing call with a number and no contact says Unknown number, never the number', () => {
  const action = ready().onCall({ ...NAMED, contactName: undefined }, ON);
  assert.ok(action.post, 'control: it posts');
  assert.equal(action.post.body, 'Unknown number. Answer or decline on your phone, or in Sidekick.');
  for (const text of [action.post.title, action.post.body]) {
    assert.doesNotMatch(text.replace(/\D/g, ''), /5551234567|1234567/, `the number leaked into: ${text}`);
  }
});

test('the copy carries a title and a body, and nothing a banner could make a button of', () => {
  assert.deepEqual(Object.keys(callBannerCopy(NAMED)).sort(), ['body', 'title']);
});

test('dialling and active calls never post', () => {
  const state = ready();
  assert.equal(state.onCall({ ...NAMED, state: 'dialing' }, ON).decision, CallBannerDecision.NOT_RINGING);
  assert.equal(state.onCall({ ...NAMED, state: 'active' }, ON).post, null);
});

test('nothing posts before a session is ready', () => {
  const action = new CallBannerState().onCall(NAMED, ON);
  assert.equal(action.decision, CallBannerDecision.NO_SESSION);
  assert.equal(action.post, null);
});

// ---- Suppression -----------------------------------------------------------------------------

test('focused on Calls, the banner is suppressed — and stays suppressed for that call', () => {
  const state = ready();
  assert.equal(state.onCall(EARLY, ON_CALLS).decision, CallBannerDecision.CALLS_IN_FRONT);
  // The late number re-sends the call; the person was already looking at it.
  const resend = state.onCall(CORRECTED, ON);
  assert.equal(resend.post, null, 'a call shown in front was bannered later anyway');
});

test('focused on another screen, or on Calls but unfocused, it posts', () => {
  assert.ok(ready().onCall(NAMED, { enabled: true, windowFocused: true, currentScreen: 'messages' }).post);
  assert.ok(ready().onCall(NAMED, { enabled: true, windowFocused: false, currentScreen: 'calls' }).post);
});

test('the same call re-sent while bannered is one banner', () => {
  const state = ready();
  assert.ok(state.onCall(NAMED, ON).post, 'control: the first event posts');
  const again = state.onCall({ ...NAMED }, ON);
  assert.equal(again.decision, CallBannerDecision.ALREADY_HANDLED);
  assert.equal(again.post, null);
  assert.equal(again.close, null, 'a re-send closed the banner it was about');
});

// ---- Closing ---------------------------------------------------------------------------------

test('answering closes the banner', () => {
  const state = ready();
  const posted = state.onCall(NAMED, ON).post;
  assert.ok(posted);
  assert.equal(state.onCall({ ...NAMED, state: 'active' }, ON).close, posted.key);
});

test('the call ending closes the banner', () => {
  const state = ready();
  const posted = state.onCall(NAMED, ON).post;
  assert.ok(posted);
  assert.equal(state.onCall(null, ON).close, posted.key);
});

test('a disconnect closes the banner', () => {
  const state = ready();
  const posted = state.onCall(NAMED, ON).post;
  assert.ok(posted);
  assert.equal(state.sessionEnded().close, posted.key);
  // main.ts then clears the card; nothing is left to close twice.
  assert.equal(state.onCall(null, ON).close, null);
});

test('a different call ringing replaces the banner of the one before', () => {
  const state = ready();
  const first = state.onCall(NAMED, ON).post;
  assert.ok(first);
  const second = state.onCall({ ...CORRECTED, callId: 'c19' }, ON);
  assert.equal(second.close, first.key);
  assert.ok(second.post);
  assert.notEqual(second.post.key, first.key);
});

// ---- The late number (defect 45) ---------------------------------------------------------------

test('a ringing call with no number yet is held, not bannered as Unknown number', () => {
  const action = ready().onCall(EARLY, ON);
  assert.equal(action.decision, CallBannerDecision.HOLD);
  assert.equal(action.post, null);
  assert.ok(action.hold);
  assert.equal(action.hold.ms, CALL_BANNER_HOLD_MS);
});

test('the corrected event inside the hold posts with the name, and ends the hold', () => {
  const state = ready();
  state.onCall(EARLY, ON);
  const action = state.onCall(CORRECTED, ON);
  assert.equal(action.decision, CallBannerDecision.POST);
  assert.equal(action.cancelHold, true);
  assert.equal(action.post?.body, 'R. Sharma. Answer or decline on your phone, or in Sidekick.');
});

test('a hold that expires with no number posts Unknown number', () => {
  const state = ready();
  const held = state.onCall(EARLY, ON).hold;
  assert.ok(held);
  const action = state.holdExpired(held.key, ON);
  assert.equal(action.decision, CallBannerDecision.POST);
  assert.equal(action.post?.body, 'Unknown number. Answer or decline on your phone, or in Sidekick.');
});

test('a call that ends inside its hold is never bannered', () => {
  const state = ready();
  const held = state.onCall(EARLY, ON).hold;
  assert.ok(held);
  assert.equal(state.onCall(null, ON).cancelHold, true);
  assert.equal(state.holdExpired(held.key, ON).post, null, 'a finished call was bannered');
});

test('a hold that expires while Calls is in front does not post', () => {
  const state = ready();
  const held = state.onCall(EARLY, ON).hold;
  assert.ok(held);
  assert.equal(state.holdExpired(held.key, ON_CALLS).decision, CallBannerDecision.CALLS_IN_FRONT);
});

test('a hold from a session that has ended does not post in the next one', () => {
  const state = ready();
  const held = state.onCall(EARLY, ON).hold;
  assert.ok(held);
  assert.equal(state.sessionEnded().cancelHold, true);
  state.sessionReady();
  assert.equal(state.holdExpired(held.key, ON).post, null);
});

// ---- P2: reconnects ---------------------------------------------------------------------------

test('a call still ringing after a reconnect is bannered again, once', () => {
  // The first banner was closed by the disconnect, so the replay is the only way the person learns
  // the phone is still ringing. Keyed by session as well as call, so this is not a duplicate.
  const state = ready();
  assert.ok(state.onCall(NAMED, ON).post, 'control: the first session posts');
  state.sessionEnded();
  state.onCall(null, ON);
  state.sessionReady();
  assert.ok(state.onCall({ ...NAMED }, ON).post, 'the replayed ringing call was not bannered');
  assert.equal(state.onCall({ ...NAMED }, ON).post, null, 'the replay posted twice');
});

test('a different call reusing an id after a phone restart is bannered', () => {
  const state = ready();
  assert.ok(state.onCall({ ...NAMED, callId: 'c1' }, ON).post);
  state.sessionEnded();
  state.onCall(null, ON);
  state.sessionReady(); // the phone process restarted; its ids start again at c1
  const reused = { ...CORRECTED, callId: 'c1', startedAtMs: NAMED.startedAtMs + 3_600_000 };
  assert.ok(state.onCall(reused, ON).post, 'a new call was suppressed as a repeat of an old one');
});

// ---- What the Electron side may not do ----------------------------------------------------------

test('the notifier has no notification action and cannot answer a call', () => {
  const source = readFileSync(join(__dirname, '..', 'main', 'nativeNotifier.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(source.includes('postCallBanner'), 'control: the stripped source holds the call banner');
  assert.doesNotMatch(source, /\bactions\s*:|hasReply|closeButtonText/, 'a notification action appeared');
  assert.doesNotMatch(source, /callAnswer|CALL_ANSWER|\.answer\(|CALL_REJECT|\.reject\(/, 'the notifier can act on a call');
});
