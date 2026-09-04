import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, installFakeWindow, el } from './domDouble.testkit';
import './contacts';

/**
 * The contacts pane's view class, driven for real.
 *
 * It came off `check-renderer-views.mjs`'s debt list, where its reason was the single word
 * *"Phase 4"*. The rules it enforces are all about **which empty this is** — a book with nothing in
 * it, a search that matched nothing, a request that failed, and a pane nobody has asked yet all
 * render as the same blank list, and the pane has four different sentences for them. That family
 * is exactly what a view test can see and a unit test of a pure function cannot.
 */

type Contact = {
  id: string;
  displayName: string;
  hasPhoto: boolean;
  numbers: { value: string; label: string }[];
  emails: { value: string; label: string }[];
  photo?: string;
};

class FakeBridge {
  contacts: Contact[] = [];
  hasMore = false;
  fail: { reason: string; fixHint?: string } | null = null;
  readonly queries: string[] = [];
  readonly gets: string[] = [];
  detail: Contact | null = null;

  /** Set to hold the next reply, so the "still reading" state can actually be observed. */
  hold: (() => void) | null = null;

  async contactsList(options: { query?: string }) {
    this.queries.push(options.query ?? '');
    if (this.hold) await new Promise<void>((resolve) => (this.hold = resolve));
    if (this.fail) return { ok: false as const, ...this.fail };
    return { ok: true as const, data: { contacts: this.contacts, hasMore: this.hasMore } };
  }
  async contactsGet(options: { id?: string }) {
    this.gets.push(options.id ?? '');
    if (!this.detail) return { ok: false as const, reason: 'no' };
    return { ok: true as const, data: this.detail };
  }
}

installFakeDocument();
const fakeWindow = installFakeWindow();

interface Pane {
  bridge: FakeBridge;
  card: FakeElement;
  note: FakeElement;
  search: FakeElement;
  list: FakeElement;
  notice: FakeElement;
  view: { setAdvertised(on: boolean): void; refresh(): Promise<void> };
}

function mount(contacts: Contact[] = []): Pane {
  const bridge = new FakeBridge();
  bridge.contacts = contacts;
  const parts = {
    card: el('div'),
    note: el('p'),
    search: el('input'),
    list: el('div'),
    notice: el('div'),
  };
  const View = (globalThis as Record<string, unknown>).ContactsView as new (
    ...args: unknown[]
  ) => Pane['view'];
  const view = new View(parts.card, parts.note, parts.search, parts.list, parts.notice, bridge);
  return { bridge, ...parts, view };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function person(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    displayName: `Person ${id}`,
    hasPhoto: false,
    numbers: [{ value: `+9198000000${id}`, label: 'Mobile' }],
    emails: [],
    ...over,
  };
}

// ---- The four empties ---------------------------------------------------------------------------

test('not asked yet, an empty book, and a search that matched nothing are three sentences', async () => {
  // **Held open rather than sampled.** The "still reading" state lasts exactly as long as one
  // round trip, and a test that raced it would be the 263 ms sampling window from `CLAUDE.md`
  // rebuilt in a harness: no reading at all, read as a negative.
  const fresh = mount([]);
  fresh.bridge.hold = () => undefined;
  fresh.view.setAdvertised(true);
  await settle();
  // A pane that has asked and not been answered must not say the book is empty — that is a claim
  // about a book it has not read.
  assert.match(fresh.note.textContent, /Reading the phone’s contacts…/);
  fresh.bridge.hold?.();

  const emptyBook = mount([]);
  emptyBook.view.setAdvertised(true);
  await settle();
  assert.match(emptyBook.note.textContent, /contact book is empty/);

  const noMatch = mount([person('1')]);
  noMatch.view.setAdvertised(true);
  await settle();
  noMatch.bridge.contacts = [];
  noMatch.search.value = 'zzz';
  await noMatch.view.refresh();
  // Names the query, which is what makes it a different sentence rather than the same one twice.
  assert.match(noMatch.note.textContent, /No contact on the phone matches “zzz”/);
  assert.ok(!noMatch.note.textContent.includes('is empty'));
});

test('a failed request keeps the rows that are on screen', async () => {
  // A refusal is not evidence that the book is empty. Replacing readable rows with a blank pane
  // would throw away the only thing on screen that still works — and would then read as the empty
  // book, which is a different and false claim.
  const pane = mount([person('1'), person('2')]);
  pane.view.setAdvertised(true);
  await settle();
  assert.equal(pane.list.queryAll('.contact-row').length, 2, 'control: the rows are drawn');

  pane.bridge.fail = { reason: 'The phone did not answer.', fixHint: 'Check the link.' };
  await pane.view.refresh();
  assert.equal(pane.list.queryAll('.contact-row').length, 2, 'a refusal emptied the list');
  assert.match(pane.notice.textContent, /The phone did not answer/);
  assert.match(pane.notice.textContent, /Check the link/);
});

// ---- The count and its scope --------------------------------------------------------------------

test('the count says what it is a count of, and admits when there is more', async () => {
  const pane = mount([person('1'), person('2')]);
  pane.bridge.hasMore = true;
  pane.view.setAdvertised(true);
  await settle();

  // "24 contacts" over a book of thousands reads as the whole book unless the line says it is a
  // page and that there is more.
  assert.match(pane.note.textContent, /2 contacts/);
  assert.match(pane.note.textContent, /more the phone did not send/);

  pane.bridge.hasMore = false;
  await pane.view.refresh();
  // The control on the assertion above: the same code path with the other answer, so an
  // unconditional "and more" cannot pass.
  assert.ok(!pane.note.textContent.includes('more the phone did not send'));
});

// ---- The search ---------------------------------------------------------------------------------

test('the phone does the matching — typing sends a query rather than filtering here', async () => {
  const pane = mount([person('1')]);
  pane.view.setAdvertised(true);
  await settle();
  assert.deepEqual(pane.bridge.queries, ['']);

  pane.search.value = 'sharma';
  pane.search.dispatch('input');
  // Debounced: one request per pause, not per letter. Nothing has been sent yet.
  assert.deepEqual(pane.bridge.queries, ['']);

  const timer = fakeWindow.timers.find((t) => t.kind === 'timeout' && t.delay === 250);
  assert.ok(timer, 'control: a 250ms debounce was scheduled');
  fakeWindow.fireTimer(timer.id);
  await settle();
  // There is no book on the Mac to filter, and a local filter would stop finding people whose
  // number is stored in a format nobody typed.
  assert.deepEqual(pane.bridge.queries, ['', 'sharma']);
});

test('Enter searches now rather than waiting out the debounce', async () => {
  const pane = mount([person('1')]);
  pane.view.setAdvertised(true);
  await settle();

  pane.search.value = 'mehta';
  // The double dispatches with a bare event object, so the view's `event.key` read is what is being
  // exercised here — a listener that ignored the key would fire on every keystroke.
  for (const fn of pane.search.listeners.get('keydown') ?? []) fn({ key: 'Enter' });
  await settle();
  assert.deepEqual(pane.bridge.queries, ['', 'mehta']);

  for (const fn of pane.search.listeners.get('keydown') ?? []) fn({ key: 'a' });
  await settle();
  assert.deepEqual(pane.bridge.queries, ['', 'mehta'], 'any key but Enter must not search');
});

// ---- Rows ---------------------------------------------------------------------------------------

test('a row shows the first number and how many more, and says so when there is none', async () => {
  const pane = mount([
    person('1', { numbers: [{ value: '+911', label: 'Mobile' }, { value: '+912', label: 'Work' }] }),
    person('2', { numbers: [], emails: [{ value: 'a@b.example', label: 'Home' }] }),
    person('3', { numbers: [], emails: [] }),
  ]);
  pane.view.setAdvertised(true);
  await settle();

  const subs = pane.list.queryAll('.contact-sub').map((s) => s.textContent);
  assert.deepEqual(subs, ['+911 and 1 more', 'a@b.example', 'no number']);
});

test('opening a row fetches the photo only for a contact that has one', async () => {
  const withPhoto = person('1', { hasPhoto: true });
  const without = person('2', { hasPhoto: false });
  const pane = mount([withPhoto, without]);
  pane.bridge.detail = { ...withPhoto, photo: 'data:image/png;base64,x' };
  pane.view.setAdvertised(true);
  await settle();

  pane.list.queryAll('.contact-head')[1].click();
  await settle();
  // `contacts.list` already carries every number and email. The fetch is only for the photo, and a
  // book of 200 contacts would otherwise be 200 photo fetches to draw a list nobody clicked into.
  assert.deepEqual(pane.bridge.gets, [], 'a contact with no photo must not be fetched');

  pane.list.queryAll('.contact-head')[0].click();
  await settle();
  assert.deepEqual(pane.bridge.gets, ['1']);
});

test('a row that leaves the list cannot stay open behind it', async () => {
  const pane = mount([person('1'), person('2')]);
  pane.view.setAdvertised(true);
  await settle();
  pane.list.queryAll('.contact-head')[0].click();
  await settle();
  assert.equal(pane.list.queryAll('.contact-head')[0].getAttribute('aria-expanded'), 'true');

  pane.bridge.contacts = [person('2')];
  await pane.view.refresh();
  const expanded = pane.list.queryAll('.contact-head').map((h) => h.getAttribute('aria-expanded'));
  assert.deepEqual(expanded, ['false'], 'the open row survived a search that removed it');
});

test('un-advertised hides the card and forgets what it had read', () => {
  // An empty book and an ungranted permission look identical on screen, and the capability chip
  // already carries the phone's own sentence about the second one — so the card goes rather than
  // greying.
  const pane = mount([person('1')]);
  pane.view.setAdvertised(true);
  pane.view.setAdvertised(false);
  assert.ok(pane.card.classList.contains('hidden'));
  assert.equal(pane.list.queryAll('.contact-row').length, 0);
  // And it is back to "not asked yet", not to "the book is empty" — the pane has stopped knowing,
  // which is a third thing again.
  assert.match(pane.note.textContent, /Reading the phone’s contacts…/);
});
