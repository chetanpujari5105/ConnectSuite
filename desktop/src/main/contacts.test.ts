import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContactsClient } from './contacts';
import type { LinkClient } from './link';

/**
 * A phone that records what it was asked and answers with what it is told to.
 *
 * Enough of `LinkClient` for `ask()` to run against, and no more: the point of these tests is the
 * request this client composes and the cache it keeps, neither of which needs a socket.
 */
function fakePhone(reply: Record<string, unknown> = { contacts: [], hasMore: false }) {
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

const ADA = {
  id: 'c-88',
  displayName: 'Ada Lovelace',
  hasPhoto: false,
  numbers: [{ value: '+1 555-123-4567', label: 'mobile' }],
  emails: [],
};

/**
 * `contacts.list` is the one Phase 4 list that is ordered by name, so `before` is meaningless to
 * it and the phone does not accept it — docs/protocol.md says so in as many words.
 *
 * Worth a test rather than a comment because every *other* list client in this phase takes a
 * `before`, so the wrong thing to do here is the habit everywhere else. A `before` sent to the
 * phone is ignored silently, which is the failure mode that survives review: paging would appear
 * to work and would return the same first page forever.
 */
test('contacts.list pages by name, and never sends a before', async () => {
  const { link, sent } = fakePhone({ contacts: [ADA], hasMore: true });
  const contacts = new ContactsClient(() => link);

  const result = await contacts.list({ query: 'ada', limit: 10 });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, 'contacts.list');
  assert.deepEqual(sent[0]!.payload, { query: 'ada', limit: 10 });
  assert.equal('before' in sent[0]!.payload, false, 'contacts.list is ordered by name, not by date');
});

/** An empty box means "the whole book", not `query: ""` — which would match nothing on the phone. */
test('an empty search asks for the book rather than for the empty string', async () => {
  const { link, sent } = fakePhone();
  const contacts = new ContactsClient(() => link);

  await contacts.list({ query: '' });

  assert.deepEqual(sent[0]!.payload, {});
});

/**
 * `hasMore` is read from the phone, never inferred from the page being short.
 *
 * The inference is the tempting bug: `contacts.length < limit` looks equivalent and is not, since
 * the phone caps the limit itself. A pane that inferred it would stop offering to narrow a search
 * exactly when the book is big enough to need it.
 */
test('hasMore comes from the phone, not from the size of the page', async () => {
  const { link } = fakePhone({ contacts: [ADA], hasMore: true });
  const contacts = new ContactsClient(() => link);

  const result = await contacts.list({ limit: 200 });

  assert.equal(result.ok && result.data.hasMore, true, 'one row of a possible 200, and more to come');
});

/**
 * The cache learns from every contact that crosses the link, in both directions.
 *
 * This is what lets a later pane draw a name beside a number it has already seen without a round
 * trip per row.
 */
test('a listed contact teaches the number cache', async () => {
  const { link } = fakePhone({ contacts: [ADA], hasMore: false });
  const contacts = new ContactsClient(() => link);

  assert.equal(contacts.nameFor('+15551234567'), null, 'nothing is known before the first list');
  await contacts.list({});
  assert.equal(contacts.nameFor('+15551234567'), 'Ada Lovelace', 'punctuation is not identity');
  assert.equal(contacts.nameFor('+1 (555) 123-4567'), 'Ada Lovelace');
});

/**
 * A cache miss is "ask the phone", not "no such contact".
 *
 * The Mac's key deliberately keeps the country code, so a number stored one way and quoted another
 * misses here and is resolved by the phone, whose `PhoneLookup` rule is the only matching rule in
 * the system. Pinning it stops someone "fixing" the miss by writing a second matching rule on this
 * side, which is how the two ends start disagreeing about who a number belongs to.
 */
test('a differently-formatted number misses rather than guessing', async () => {
  const { link } = fakePhone({ contacts: [ADA], hasMore: false });
  const contacts = new ContactsClient(() => link);
  await contacts.list({});

  assert.equal(
    contacts.nameFor('5551234567'),
    null,
    'no country code: the phone answers this one, this Mac does not guess',
  );
});

/**
 * Defect 25's rule, applied to names: nothing learned from a connection outlives it.
 *
 * A name cached against a phone this Mac is no longer talking to is the same class of claim as the
 * capability list that stayed lit after a disconnect — it looks like knowledge and is a memory.
 */
test('the name cache is dropped when the link goes', async () => {
  const { link } = fakePhone({ contacts: [ADA], hasMore: false });
  const contacts = new ContactsClient(() => link);
  await contacts.list({});
  assert.equal(contacts.nameFor('+15551234567'), 'Ada Lovelace');

  contacts.clear();

  assert.equal(contacts.nameFor('+15551234567'), null, 'a name outliving its link is a stale claim');
});

/** `contacts.get` carries whichever key it was given, and `withPhoto` only when asked. */
test('contacts.get sends the key it was given and nothing else', async () => {
  const { link, sent } = fakePhone(ADA);
  const contacts = new ContactsClient(() => link);

  await contacts.get({ number: '+15551234567' });
  await contacts.get({ id: 'c-88', withPhoto: true });

  assert.deepEqual(sent[0]!.payload, { number: '+15551234567' });
  assert.deepEqual(sent[1]!.payload, { id: 'c-88', withPhoto: true });
});

/**
 * A refusal is a value, never a rejection — defect 22.
 *
 * `ipcRenderer.invoke` rewraps anything thrown as `Error invoking remote method 'contacts-list'`,
 * which would put Electron internals in front of the phone's own sentence about Contacts being
 * ungranted. That sentence is the entire content of the failure.
 */
test('a phone refusal arrives as a value carrying the phone\'s sentence', async () => {
  const refusing = {
    isConnected: () => true,
    request: () =>
      Promise.reject(
        Object.assign(new Error('PERMISSION_DENIED: nope'), {
          code: 'PERMISSION_DENIED',
          phoneMessage: 'This phone is not sharing its contacts.',
          fixHint: 'On the phone: Settings > Apps > ConnectSuite > Permissions > Contacts.',
        }),
      ),
  } as unknown as LinkClient;
  const contacts = new ContactsClient(() => refusing);

  const result = await contacts.list({});

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'This phone is not sharing its contacts.');
  assert.equal(result.ok === false && result.code, 'PERMISSION_DENIED');
});

/** Not connected is answered here, without a request, and still as a sentence. */
test('with no link there is no request and still a sentence', async () => {
  const contacts = new ContactsClient(() => null);

  const result = await contacts.list({});

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : '', /not connected/i);
});
