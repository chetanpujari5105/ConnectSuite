/**
 * The contacts pane: a search the phone runs, and one contact opened in full.
 *
 * Module-free on purpose, like renderer.ts, mirror.ts and notifications.ts: the page is CSP-locked
 * and loads plain scripts, so a top-level `export` here would emit a CommonJS module the renderer
 * cannot require.
 *
 * ### The rule this pane enforces
 *
 * **The phone does the matching.** Typing in the box sends a `contacts.list` with a `query`; it
 * does not filter a list held here. There is no book on the Mac to filter — see contacts.ts in the
 * main process for why — and a pane that filtered locally would quietly stop finding people whose
 * number is stored in a different format from the one that was typed, which is the single most
 * common way a contact search disappoints.
 *
 * ### Why a search box and not a list
 *
 * A contact book is the one Phase 4 list nobody reads top to bottom. It opens showing the first
 * page so the pane is never blank — an empty pane and an unsearched pane look identical, which is
 * the same failure the notification card's absence rule exists to prevent — and everything after
 * that is a query.
 */

interface ContactValue {
  value: string;
  label: string;
}

/** Mirrors `PhoneContact` in shared/protocol.ts — this file cannot import it. */
interface Contact {
  id: string;
  displayName: string;
  hasPhoto: boolean;
  numbers: ContactValue[];
  emails: ContactValue[];
  photo?: string;
}

type ContactsResult<T> = { ok: true; data: T } | { ok: false; reason?: string; fixHint?: string };

interface ContactsBridge {
  contactsList(options: { query?: string; limit?: number }): Promise<
    ContactsResult<{ contacts: Contact[]; hasMore: boolean }>
  >;
  contactsGet(options: { id?: string; number?: string; withPhoto?: boolean }): Promise<
    ContactsResult<Contact>
  >;
}

/** How long the box waits after the last keystroke. One request per pause, not per letter. */
const SEARCH_DEBOUNCE_MS = 250;

class ContactsView {
  private contacts: Contact[] = [];
  private hasMore = false;

  /** Which row is expanded, and the full contact once `contacts.get` has answered for it. */
  private opened: string | null = null;
  private details = new Map<string, Contact>();

  /**
   * Whether a search has been run at all, so the empty case can say which empty it is.
   *
   * "No results" and "not asked yet" are the same blank list on screen and need opposite words —
   * the same distinction the notifications card draws by hiding itself rather than showing empty.
   */
  private searched = false;
  private lastQuery = '';

  private debounce: number | null = null;
  private noticeTimer: number | null = null;

  constructor(
    private readonly card: HTMLElement,
    private readonly note: HTMLElement,
    private readonly search: HTMLInputElement,
    private readonly container: HTMLElement,
    private readonly notice: HTMLElement,
    private readonly bridge: ContactsBridge,
  ) {
    this.search.addEventListener('input', () => {
      if (this.debounce !== null) window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => {
        this.debounce = null;
        void this.run(this.search.value.trim());
      }, SEARCH_DEBOUNCE_MS);
    });
    // Enter searches now rather than waiting out the debounce, which is what someone who has
    // finished typing expects.
    this.search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (this.debounce !== null) window.clearTimeout(this.debounce);
      this.debounce = null;
      void this.run(this.search.value.trim());
    });

    /*
     * **Drawn once here, and the reason is a state that was unreachable.**
     *
     * `render()` carries a sentence for `!searched` — *"Reading the phone's contacts…"* — and until
     * this line it was only ever reached by `setAdvertised(false)`, which is the *un*-advertised
     * path. On the path it was written for, a first advertise, the pane asked the phone and drew
     * nothing at all until the reply came back: a **blank** note, which is a fourth empty nobody
     * wrote, on the pane whose whole care is telling four empties apart.
     *
     * Found by `contactsView.test.ts` holding the reply open instead of racing it — the state lasts
     * exactly one round trip, and a test that sampled it would have held no reading at all.
     */
    this.render();
  }

  /**
   * Called from every status update.
   *
   * Hidden outright rather than greyed, for the reason the notifications card is: an empty book
   * and an ungranted Contacts permission look identical on screen, and the capability chip already
   * carries the phone's own sentence about the second one.
   */
  setAdvertised(advertised: boolean): void {
    this.card.classList.toggle('hidden', !advertised);
    if (!advertised) {
      this.contacts = [];
      this.details.clear();
      this.opened = null;
      this.searched = false;
      this.hasMore = false;
      this.render();
      return;
    }
    // Newly advertised — the permission was just granted, or the phone just connected. Load the
    // first page so the pane is never an empty box with no explanation.
    if (!this.searched) void this.run('');
  }

  /** Re-runs whatever is in the box. Used when the link comes back. */
  async refresh(): Promise<void> {
    if (this.card.classList.contains('hidden')) return;
    await this.run(this.search.value.trim());
  }

  private async run(query: string): Promise<void> {
    this.lastQuery = query;
    const result = await this.bridge
      .contactsList(query ? { query } : {})
      .catch((error): ContactsResult<{ contacts: Contact[]; hasMore: boolean }> => ({
        ok: false,
        reason: `The Mac could not reach its own contacts channel (${String(error)}).`,
      }));

    if (!result.ok) {
      // The list is left as it was rather than emptied. A refusal is not evidence the book is
      // empty, and replacing readable rows with a blank pane on a dropped request would throw
      // away the only thing on screen that still works.
      this.showNotice(result.reason ?? 'The contacts could not be read.', result.fixHint);
      return;
    }
    this.searched = true;
    this.contacts = result.data.contacts;
    this.hasMore = result.data.hasMore;
    // A row that is no longer in the list cannot stay open behind it.
    if (this.opened && !this.contacts.some((one) => one.id === this.opened)) this.opened = null;
    this.render();
  }

  private render(): void {
    this.container.textContent = '';

    if (!this.searched) {
      this.note.textContent = 'Reading the phone’s contacts…';
      return;
    }
    if (this.contacts.length === 0) {
      this.note.textContent = this.lastQuery
        ? `No contact on the phone matches “${this.lastQuery}”.`
        : 'The phone’s contact book is empty.';
      return;
    }

    // The count with what it is a count *of*, per CLAUDE.md. "24 contacts" against a book of
    // thousands reads as the whole book unless the line says it is a page and that there is more.
    const scope = this.lastQuery ? ` matching “${this.lastQuery}”` : '';
    const more = this.hasMore ? ', and more the phone did not send — narrow the search' : '';
    this.note.textContent = `${this.contacts.length} contact${
      this.contacts.length === 1 ? '' : 's'
    }${scope}${more}. Sorted by name, which is the only order a book can be read in.`;

    for (const contact of this.contacts) this.container.appendChild(this.row(contact));
  }

  private row(contact: Contact): HTMLElement {
    const row = document.createElement('div');
    row.className = 'contact-row';
    row.dataset.id = contact.id;

    const head = document.createElement('button');
    head.className = 'contact-head';
    head.setAttribute('aria-expanded', String(this.opened === contact.id));

    const name = document.createElement('span');
    name.className = 'contact-name';
    name.textContent = contact.displayName;

    // The first number is on the row because it is what a phone book is for. The rest are behind
    // the expander, along with the emails.
    const first = contact.numbers[0];
    const sub = document.createElement('span');
    sub.className = 'contact-sub muted small';
    const extra = contact.numbers.length - 1;
    sub.textContent = first
      ? `${first.value}${extra > 0 ? ` and ${extra} more` : ''}`
      : contact.emails[0]?.value ?? 'no number';

    head.append(name, sub);
    head.addEventListener('click', () => void this.toggle(contact));
    row.appendChild(head);

    if (this.opened === contact.id) row.appendChild(this.detail(contact));
    return row;
  }

  /**
   * Opens a row, fetching the full contact the first time.
   *
   * `contacts.list` already carries every number and email, so the fetch is only for the photo —
   * which is why it is done on open rather than for every row in the list. A book of 200 contacts
   * would otherwise be 200 photo fetches to draw a list nobody has clicked into yet, and the
   * protocol caps a photo at 64 KiB precisely because they are not free.
   */
  private async toggle(contact: Contact): Promise<void> {
    if (this.opened === contact.id) {
      this.opened = null;
      this.render();
      return;
    }
    this.opened = contact.id;
    this.render();
    if (this.details.has(contact.id) || !contact.hasPhoto) return;

    const result = await this.bridge
      .contactsGet({ id: contact.id, withPhoto: true })
      .catch((error): ContactsResult<Contact> => ({
        ok: false,
        reason: `The Mac could not reach its own contacts channel (${String(error)}).`,
      }));
    if (!result.ok) {
      // Not a notice. The row is open and readable without the photo, and a refusal banner over a
      // working row would report a failure the user cannot act on and did not ask about.
      return;
    }
    this.details.set(contact.id, result.data);
    if (this.opened === contact.id) this.render();
  }

  private detail(contact: Contact): HTMLElement {
    const full = this.details.get(contact.id) ?? contact;
    const wrap = document.createElement('div');
    wrap.className = 'contact-detail';

    if (full.photo) {
      const photo = document.createElement('img');
      photo.className = 'contact-photo';
      // Base64 PNG from the phone, capped at 64 KiB there. `data:` is allowed by the page CSP.
      photo.src = `data:image/png;base64,${full.photo}`;
      photo.alt = `Photo of ${full.displayName}`;
      wrap.appendChild(photo);
    }

    const fields = document.createElement('dl');
    fields.className = 'contact-fields';
    for (const number of full.numbers ?? []) fields.append(...labelled(number.label, number.value));
    for (const email of full.emails ?? []) fields.append(...labelled(email.label, email.value));
    if ((full.numbers?.length ?? 0) === 0 && (full.emails?.length ?? 0) === 0) {
      fields.append(...labelled('', 'This contact has no number and no email address.'));
    }
    wrap.appendChild(fields);
    return wrap;
  }

  /** Same shape as the notification pane's notice, and the same reason: no silent refusal. */
  private showNotice(text: string, hint?: string): void {
    this.notice.hidden = false;
    this.notice.textContent = text;
    if (hint) {
      const line = document.createElement('div');
      line.className = 'hint';
      // Leading space so a read of `textContent` is two sentences rather than one run-together
      // string — the block layout swallows it. Same fix as defect 22's, same reason.
      line.textContent = ` ${hint}`;
      this.notice.appendChild(line);
    }
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.notice.hidden = true;
      this.notice.textContent = '';
    }, 6_000);
  }
}

/** One `<dt>`/`<dd>` pair. Returned as a pair so the caller can spread it into a `<dl>`. */
function labelled(label: string, value: string): [HTMLElement, HTMLElement] {
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = value;
  return [term, detail];
}

// The seam. `contacts.ts` touches no DOM at module scope, so a test can import it and construct the
// class against `domDouble.testkit.ts` — which is what takes this off `check-renderer-views.mjs`'s
// debt list, where its reason was the single word "Phase 4".
(globalThis as Record<string, unknown>).ContactsView = ContactsView;
