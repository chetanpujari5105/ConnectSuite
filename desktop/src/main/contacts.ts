import {
  MessageType,
  type PhoneContact,
  type PhoneResult,
} from '../shared/protocol';
import { ask, rows } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of contacts: a search the phone runs, and one contact fetched in full.
 *
 * ### Why the search is not done here
 *
 * `contacts.list` takes a `query` and the phone matches it against display names and numbers. The
 * obvious alternative — pull the whole book once, filter it on the Mac — is wrong for a reason
 * worth writing down: the phone has the indexes. A 3,000-contact book is a multi-megabyte control
 * frame and a visible pause every time it is refreshed, to reimplement matching that
 * `ContactsContract` already does correctly, including the number normalisation that makes
 * `+1 555-123-4567` and `5551234567` the same person.
 *
 * So this holds **no book**. It holds a page, the query that produced it, and a small cache of
 * number→name lookups. That cache is the one piece of state here, and it exists for the panes
 * that come after this one.
 *
 * ### The cache, and what it is not
 *
 * `sms.received` and `call.incoming` already carry `contactName` when the phone can resolve it —
 * name resolution is the phone's job on the wire, not something the Mac reconstructs. The cache is
 * for the other direction: a row the Mac is *drawing* whose name it wants without a round trip,
 * such as a thread the user has scrolled back to twice. A miss is not a failure; it means "ask".
 *
 * It is cleared on disconnect for the same reason the notification set is: a name resolved against
 * a phone that has since been unpaired, or whose book has been edited, is a claim this Mac cannot
 * still stand behind.
 */
export class ContactsClient {
  /** Normalised number → display name. A miss means "ask the phone", not "no such contact". */
  private names = new Map<string, string>();

  /**
   * How many lookups the cache answered and how many it did not, since launch.
   *
   * Both, beside each other, per CLAUDE.md. A hit count alone cannot distinguish a cache that is
   * working from one that is never consulted, and those need opposite fixes.
   */
  private cacheHits = 0;
  private cacheMisses = 0;

  private listCount = 0;
  private getCount = 0;

  constructor(private readonly link: () => LinkClient | null) {}

  private tally(): string {
    return `${this.listCount} lists / ${this.getCount} gets, cache ${this.cacheHits} hit / ` +
      `${this.cacheMisses} missed since launch`;
  }

  /**
   * A page of the book, ordered by display name.
   *
   * `before` is deliberately not a parameter. Every other Phase 4 list pages by timestamp because
   * every other Phase 4 list is ordered newest first; this one is ordered by name, because that is
   * the only order a person can navigate a contact book in. `since` is the cheap-refresh path —
   * a Mac that has synced once asks only for what changed. See docs/protocol.md.
   */
  async list(options: { query?: string; limit?: number; since?: number } = {}): Promise<
    PhoneResult<{ contacts: PhoneContact[]; hasMore: boolean }>
  > {
    const payload: Record<string, unknown> = {};
    if (options.query) payload.query = options.query;
    if (options.limit) payload.limit = options.limit;
    if (options.since) payload.since = options.since;

    const result = await ask(
      this.link(),
      'contacts',
      MessageType.CONTACTS_LIST,
      payload,
      (ack) => ({
        contacts: rows(ack, 'contacts') as unknown as PhoneContact[],
        hasMore: ack.hasMore === true,
      }),
    );

    if (result.ok) {
      this.listCount += 1;
      for (const contact of result.data.contacts) this.remember(contact);
      log.info(
        'contacts',
        `contacts.list → ${result.data.contacts.length} rows, hasMore=${result.data.hasMore} — ` +
          this.tally(),
      );
    }
    return result;
  }

  /**
   * One contact, by id or by number.
   *
   * Lookup by number is what makes the other panes legible — an SMS thread and a call log carry
   * numbers, and this is how they become people. The phone matches on normalised digits with the
   * country code optional, the same rule `PhoneLookup` uses, which is why this must not be
   * reimplemented as a string compare on either side.
   */
  async get(
    options: { id?: string; number?: string; withPhoto?: boolean },
  ): Promise<PhoneResult<PhoneContact>> {
    const payload: Record<string, unknown> = {};
    if (options.id) payload.id = options.id;
    if (options.number) payload.number = options.number;
    if (options.withPhoto) payload.withPhoto = true;

    const result = await ask(
      this.link(),
      'contacts',
      MessageType.CONTACTS_GET,
      payload,
      (ack) => ack as unknown as PhoneContact,
    );

    if (result.ok) {
      this.getCount += 1;
      this.remember(result.data);
      log.info('contacts', `contacts.get → ${result.data.displayName} — ${this.tally()}`);
    }
    return result;
  }

  /**
   * The cached name for a number, or null.
   *
   * Null means "this Mac has not been told", never "there is no such contact". The distinction
   * matters because the caller's fallback is to draw the bare number, and a pane that treated a
   * cache miss as "not in the book" would stop asking and show numbers forever.
   */
  nameFor(number: string): string | null {
    const name = this.names.get(normalizeNumber(number));
    if (name) this.cacheHits += 1;
    else this.cacheMisses += 1;
    return name ?? null;
  }

  /** Drops the cache. See the class comment: a name outliving its link is a stale claim. */
  clear(): void {
    if (this.names.size === 0) return;
    log.info('contacts', `Cleared ${this.names.size} cached names: the link dropped`);
    this.names.clear();
  }

  private remember(contact: PhoneContact): void {
    for (const number of contact.numbers ?? []) {
      if (number?.value) this.names.set(normalizeNumber(number.value), contact.displayName);
    }
  }
}

/**
 * The Mac's number key for its own cache, and nothing more.
 *
 * Deliberately *not* an implementation of the phone's matching rule. The phone compares numbers
 * the way `PhoneLookup` does — normalised digits with the country code optional — and that rule
 * lives on the phone precisely so there is one of it. This strips punctuation so two spellings of
 * a number the Mac has already been told about hit the same cache entry; anything subtler than
 * that is a second matching rule waiting to disagree with the first, so a miss here just asks.
 */
function normalizeNumber(number: string): string {
  return number.replace(/[^\d+]/g, '');
}
