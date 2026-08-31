import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SmsClient, MISMATCH_PROBE_NUMBER } from './sms';
import { resetDebugSwitchesForTests } from './debugSwitches';
import type { LinkClient } from './link';

beforeEach(() => {
  delete process.env.CONNECTSUITE_DEBUG_SWITCHES;
  resetDebugSwitchesForTests();
});

function fakePhone(reply: Record<string, unknown> = {}) {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const link = {
    isConnected: () => true,
    request: (type: string, payload: Record<string, unknown> = {}) => {
      sent.push({ type, payload });
      return Promise.resolve({ v: 1, id: 'x', type: 'ack', ts: 0, payload: reply });
    },
  } as unknown as LinkClient;
  return { link, sent };
}

const ADA_THREAD = {
  threadId: '42',
  addresses: ['+15551234567'],
  snippet: 'see you at six',
  dateMs: 1756299000000,
  unread: 0,
  messageCount: 318,
  contactName: 'Ada Lovelace',
};

const BOB_THREAD = {
  threadId: '99',
  addresses: ['+15559876543'],
  snippet: 'ok',
  dateMs: 1756298000000,
  unread: 0,
  messageCount: 4,
};

/** Loads the client with thread rows the way the phone would, then hands it back. */
async function clientHolding(...threads: object[]) {
  const { link, sent } = fakePhone({ threads, hasMore: false });
  const sms = new SmsClient(() => link);
  await sms.listThreads({});
  sent.length = 0;
  return { sms, sent, link };
}

/**
 * The send rule, clause 2: the recipient comes from the thread being sent into.
 *
 * This is the assertion that matters most in the Phase 4 suite. Every other failure in this
 * project is recoverable by clicking again; a message delivered to the wrong person is visible to
 * somebody who was never meant to see it and cannot be taken back.
 */
test('a send carries the recipients of the thread it is sent into', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD, BOB_THREAD);

  const result = await sms.send('42', 'on my way');

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, 'sms.send');
  assert.deepEqual(sent[0]!.payload, {
    threadId: '42',
    addresses: ['+15551234567'],
    body: 'on my way',
  });
});

/**
 * Opening one thread must not leak into a send aimed at another.
 *
 * The class exposes no way to pass a recipient, so the only thing a caller can get wrong is the
 * thread id — and that resolves through the same map. Two threads held at once is the arrangement
 * where a "currently open thread" implementation would send Ada's message to Bob.
 */
test('a send into one thread cannot pick up another thread’s recipient', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD, BOB_THREAD);

  await sms.send('99', 'ok then');

  assert.deepEqual(sent[0]!.payload.addresses, ['+15559876543']);
  assert.equal(sms.recipientsFor('42')?.[0], '+15551234567', 'the other thread is untouched');
});

/**
 * A thread this Mac has not listed has no resolvable recipient, so nothing is sent.
 *
 * The phone would refuse this too (send rule clause 1, `BAD_REQUEST` for a send with no
 * addresses), but refusing here names the real problem — a pane out of step with its data.
 */
test('a send into an unknown thread is refused before it crosses the link', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  const result = await sms.send('does-not-exist', 'hello?');

  assert.equal(result.ok, false);
  assert.equal(sent.length, 0, 'nothing may cross the link without a resolved recipient');
  assert.match(result.ok === false ? result.reason : '', /could not work out who/i);
});

/**
 * Step 58b: a thread whose recipients the provider cannot read is refused, not sent.
 *
 * "We could not check" must never resolve to "send it anyway" — the failure mode where a guard
 * that cannot evaluate its condition falls open.
 */
test('a thread with no readable recipients is refused rather than broadcast', async () => {
  const { sms, sent } = await clientHolding({ ...ADA_THREAD, threadId: '7', addresses: [] });

  const result = await sms.send('7', 'anyone there');

  assert.equal(result.ok, false);
  assert.equal(sent.length, 0);
  assert.match(result.ok === false ? result.reason : '', /who is in that conversation/i);
});

/** An empty message appears in somebody's conversation and cannot be taken back. */
test('an empty body is refused without crossing the link', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  const result = await sms.send('42', '   ');

  assert.equal(result.ok, false);
  assert.equal(sent.length, 0);
});

/**
 * Defect 25's rule, applied to the one piece of state that can misdeliver a message.
 *
 * After a disconnect the thread copy is gone, so a send resolves nothing and refuses. A cached
 * recipient surviving its connection is precisely the stale copy the send rule warns about.
 */
test('after the link drops there is no recipient left to resolve', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  sms.clear();
  const result = await sms.send('42', 'still there?');

  assert.equal(result.ok, false);
  assert.equal(sent.length, 0);
});

/**
 * Paging back through older threads must not evict the newer ones.
 *
 * A replace-on-page implementation would leave a send into a thread still visible at the top of
 * the list resolving to nothing, which the class answers by refusing — so the user would be told
 * their own open conversation is unknown to this Mac. Merging is what keeps every listed thread's
 * recipient available for as long as it is on screen.
 */
test('paging older threads keeps the newer ones resolvable', async () => {
  // A phone that answers with a different page each time, which is what paging actually looks
  // like — the single-reply fake used elsewhere cannot tell merge from replace.
  const pages = [
    { threads: [ADA_THREAD], hasMore: true },
    { threads: [{ ...BOB_THREAD, threadId: '13', addresses: ['+15551112222'] }], hasMore: false },
  ];
  let call = 0;
  const link = {
    isConnected: () => true,
    request: () =>
      Promise.resolve({ v: 1, id: 'x', type: 'ack', ts: 0, payload: pages[call++] ?? {} }),
  } as unknown as LinkClient;
  const sms = new SmsClient(() => link);

  await sms.listThreads({});
  assert.deepEqual(sms.recipientsFor('42'), ['+15551234567'], 'first page landed');

  await sms.listThreads({ before: ADA_THREAD.dateMs });

  assert.deepEqual(sms.recipientsFor('13'), ['+15551112222'], 'second page landed');
  assert.deepEqual(
    sms.recipientsFor('42'),
    ['+15551234567'],
    'the first page’s thread is still resolvable after paging back',
  );
});

/** The switch is off unless named, and the guard holds while it is. */
test('without the switch, a send never carries a substituted recipient', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  await sms.send('42', 'hello');

  assert.deepEqual(sent[0]!.payload.addresses, ['+15551234567']);
  assert.notDeepEqual(sent[0]!.payload.addresses, [MISMATCH_PROBE_NUMBER]);
});

/**
 * Step 58a, made reachable: the switch substitutes a recipient that disagrees with the thread.
 *
 * The substituted number is documentation-reserved, so even a phone that wrongly accepted the pair
 * would not deliver a message to a person. A switch that weakens the guard over an unrecoverable
 * outcome must not also aim at a real number.
 */
test('the switch substitutes a reserved number so the phone can refuse the pair', async () => {
  process.env.CONNECTSUITE_DEBUG_SWITCHES = 'forceRecipientMismatch';
  resetDebugSwitchesForTests();
  const { sms, sent } = await clientHolding(ADA_THREAD);

  await sms.send('42', 'this should be refused');

  assert.deepEqual(sent[0]!.payload.addresses, [MISMATCH_PROBE_NUMBER]);
  assert.equal(sent[0]!.payload.threadId, '42', 'the mismatch is the pair, so the id must be real');
  assert.match(MISMATCH_PROBE_NUMBER, /^\+1555010/, 'must stay inside the reserved fiction range');
});

/**
 * Step 59, both states: a received message names a person or a number, and never nothing.
 *
 * The two states are what the step is for — with contacts granted the thread carries a
 * `contactName`, without it there is only the address — and the failure the step guards is a row
 * that shows neither.
 */
test('a received message is attributed, with a name or with a number', async () => {
  const named = await clientHolding(ADA_THREAD);
  const seen: Array<{ threadId: string; message: { address: string } }> = [];
  named.sms.on('message', (event) => seen.push(event));

  named.sms.onReceived({
    threadId: '42',
    messages: [{ id: '1', address: '+15551234567', body: 'hi', dateMs: 1, inbound: true, read: false, kind: 'sms', hasAttachments: false }],
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.message.address, '+15551234567', 'the address is always present');
  assert.equal(named.sms.recipientsFor('42')?.length, 1);
});

/** A malformed event is dropped with a line, not turned into a row with no sender. */
test('a received event with no message is dropped rather than drawn', async () => {
  const { sms } = await clientHolding(ADA_THREAD);
  const seen: unknown[] = [];
  sms.on('message', (event) => seen.push(event));

  sms.onReceived({ threadId: '42', messages: [] });
  sms.onReceived({ messages: [{ id: '1', address: '+1', body: 'x', dateMs: 1, inbound: true, read: false, kind: 'sms', hasAttachments: false }] });

  assert.equal(seen.length, 0, 'a row with no sender is worse than no row');
});

/**
 * Defects 39 and 44: an outgoing message reaches the pane by the same path as an inbound one.
 *
 * 39 is the message this Mac just sent going missing from the thread it was sent into — the
 * composer re-read the provider 30 ms after the send, before the row existed, and nothing appended
 * it afterwards. 44 is a message typed on the *handset* never arriving at all, because nothing
 * observed outgoing provider rows. One event closes both, which is why it is an event and not a
 * richer ack: an ack only answers the client that asked.
 *
 * Shown to fail: deleting the `SMS_SENT` dispatch in `main.ts` leaves the phone pushing and the Mac
 * silent, which is defect 44 exactly; making `onSent` its own validator and dropping the
 * `messages[]` check turns the malformed case below green, which is defect 34.
 */
test('a sent message reaches the pane the same way a received one does', async () => {
  const { sms } = await clientHolding(ADA_THREAD);
  const seen: Array<{ threadId: string; message: { address: string; inbound: boolean } }> = [];
  sms.on('message', (event) => seen.push(event));

  sms.onSent({
    threadId: '42',
    messages: [{ id: '9912', address: '+15551234567', body: 'on my way', dateMs: 2, inbound: false, read: true, kind: 'sms', hasAttachments: false }],
  });

  assert.equal(seen.length, 1, 'an outgoing message must reach the pane, whoever typed it');
  assert.equal(seen[0]!.message.address, '+15551234567');
  assert.equal(seen[0]!.message.inbound, false, 'the direction rides on the row, not on the channel');
});

/** The strictness defect 34 produced applies to the new event too, not only to its twin. */
test('a malformed sms.sent is dropped exactly as a malformed sms.received is', async () => {
  const { sms } = await clientHolding(ADA_THREAD);
  const seen: unknown[] = [];
  sms.on('message', (event) => seen.push(event));

  sms.onSent({ threadId: '42', messages: [] });
  sms.onSent({ messages: [{ id: '1', address: '+1', body: 'x', dateMs: 1, inbound: false, read: true, kind: 'sms', hasAttachments: false }] });
  sms.onSent({ threadId: '42', id: '1', address: '+1', body: 'flat', dateMs: 1, inbound: false });

  assert.equal(seen.length, 0, 'being lenient here is how the two sides disagreed for two sessions');
});

/**
 * Defect 30: the one call that may name a recipient, and the shape it must put on the wire.
 *
 * `sms.send` shape two — `addresses` and **no** `threadId` — has been in `docs/protocol.md` and
 * implemented on the phone the whole time. What was missing was a Mac that could express it.
 *
 * Shown to fail: putting `threadId: null` into the payload turns the deepEqual red, which matters
 * because rule 5 says the field may be *omitted*, and a phone reading a present-but-null threadId
 * takes the verification branch and refuses a conversation that does not exist yet.
 */
test('a new conversation names its recipient and no thread', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  const result = await sms.sendNew(['+15559876543'], 'first message');

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, 'sms.send');
  assert.deepEqual(
    sent[0]!.payload,
    { addresses: ['+15559876543'], body: 'first message' },
    'threadId must be absent, not null — rule 5 says omitted',
  );
});

/**
 * The recipient field is the one place in this pane where a typo becomes an SMS to a stranger, so
 * a value with no digits in it fails in front of the person who typed it.
 *
 * This is a sanity check on shape and deliberately not a verification: there is nothing to verify
 * against for a conversation that does not exist, and the phone remains the authority.
 */
test('a new conversation refuses a recipient with no digits, and sends nothing', async () => {
  const { sms, sent } = await clientHolding(ADA_THREAD);

  const nonsense = await sms.sendNew(['who?'], 'hello');
  const blank = await sms.sendNew(['   '], 'hello');
  const empty = await sms.sendNew(['+15559876543'], '   ');

  assert.equal(nonsense.ok, false);
  assert.match(String(nonsense.reason), /no digits/);
  assert.equal(blank.ok, false);
  assert.equal(empty.ok, false);
  assert.equal(sent.length, 0, 'nothing may reach the wire from a refusal');
});

/**
 * The pane must open the thread the **phone** names.
 *
 * A first message to a number that already has a thread is merged into that thread by the provider,
 * so a Mac that assumed it had created a new one would open something empty. The ack is
 * authoritative and is returned for exactly this.
 */
test('the phone\'s threadId comes back from a new conversation', async () => {
  const merged = fakePhone({ threadId: '42', recipients: 1 });
  const result = await new SmsClient(() => merged.link).sendNew(['+15551234567'], 'hello');
  assert.equal(result.ok, true);
  assert.equal(result.threadId, '42', 'the pane must open the thread the phone names, not one it invented');

  // And when the phone cannot name one yet — the provider write is asynchronous, so a first
  // message to a genuinely new number legitimately acks without a thread — nothing is fabricated.
  // A made-up id is a token the Mac would hand back and get NOT_FOUND for.
  const unassigned = fakePhone({ recipients: 1 });
  const pending = await new SmsClient(() => unassigned.link).sendNew(['+15559876543'], 'hello');
  assert.equal(pending.ok, true);
  assert.equal(pending.threadId, undefined);
});
