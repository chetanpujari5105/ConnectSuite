/**
 * The main window's receive card — the status of a file the phone is sending, and a way back to the
 * receive window. docs/protocol.md → Share → Version 2; docs/feature-a-receive-window.md §4.2.
 *
 * ### What this view may and may not do
 *
 * It **draws** snapshots the main process sends and may ask for one thing: **Show** the receive
 * window for an `offerId`. **It cannot Accept or Decline.** The receive window is the one decision
 * surface for an offer — two surfaces for one decision is two places a person can press Accept, and
 * `share-decide` from this page is refused in the main process whatever it carries.
 *
 * ### Decisions, stated rather than implied
 *
 * - **A waiting card says where the decision is** and offers *Show*, because a person can close the
 *   receive window and closing it is not declining — the offer keeps waiting, and this is how to get
 *   back to it.
 * - **Focus is not moved when a card arrives.** Arrival is announced through a polite live region.
 * - **Escape inside a finished card dismisses it.** A waiting card has nothing to dismiss.
 * - **Every string from the phone is set as text**, never as markup: the name is re-sanitised in the
 *   main process and the phone's device name is only ever `textContent`.
 * - **"Saved" only after the Mac published a verified file** — the words come from
 *   `shared/shareReceiveCopy.ts`, which keeps *saved on this Mac* and *confirmed by the phone* as two
 *   separate facts. Expired reads "Expired", never "Declined".
 * - **Motion**: the card arrives with a keyframed fade (`share-card-in`, `--dur-float`); the global
 *   reduced-motion block in `tokens.css` collapses every animation to an instant, and nothing here
 *   waits for the animation — the buttons work from the first frame.
 * - **No macOS notification and no Dock bounce.** The receive window appears without focus; this
 *   card is its status mirror in the main window.
 *
 * Plain script: no `export`; the pure half and the class are hung on `globalThis` at the foot.
 */

interface ShareCardData {
  offerId: string;
  from: string;
  name: string;
  mime: string;
  bytes: number;
  folder: string;
  state: ShareRecvState;
  expiresAtMs: number;
  savedAs: string | null;
  reason: string | null;
  priorCopy: { savedAs: string; acknowledged: boolean } | null;
}

interface ShareCardModel {
  offerId: string;
  title: string;
  from: string;
  rows: { label: string; value: string }[];
  headline: string;
  detail: string[];
  tone: ShareRecvTone;
  state: ShareRecvState;
  /** The offer is still in play (waiting, starting, receiving) or saved: *Show* reopens the window. */
  canShow: boolean;
  showAria: string;
  /** For the live region, on a card's first appearance while it waits. */
  announcement: string;
}

/** `3874112` → `3,874,112 bytes` — exact, because the card promises exact bytes. */
function shareExactBytes(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'}`;
}

function shareCardModel(d: ShareCardData): ShareCardModel {
  const status = shareReceiveStatus({
    state: d.state,
    wantedName: d.name,
    savedAs: d.savedAs,
    reason: d.reason,
    priorCopy: d.priorCopy,
  });
  const published = d.state === 'saved' || d.state === 'saved-unacknowledged';
  // A card still in play shows everything the decision needs (the contract's list: who, type, exact
  // bytes, where). A finished one shows who and, if published, where the file is — nothing a person
  // can still act on, so it stays compact (P2: 242–370 px became 176–286 px in the synthetic harness;
  // three cards still overflow a 760 px window by about 12 px, so the tray can still scroll).
  const live = d.state === 'awaiting-decision' || d.state === 'accepting' || d.state === 'receiving';
  const rows = live
    ? [
        { label: 'From', value: d.from },
        { label: 'Type', value: d.mime },
        { label: 'Size', value: shareExactBytes(d.bytes) },
        { label: 'Save to', value: d.folder },
      ]
    : [
        { label: 'From', value: d.from },
        ...(published && d.savedAs !== null ? [{ label: 'Saved as', value: `${d.folder}/${d.savedAs}` }] : []),
      ];
  return {
    offerId: d.offerId,
    title: d.name,
    from: d.from,
    rows,
    headline: status.headline,
    detail: d.state === 'awaiting-decision' ? ['Accept or decline it in the Incoming file window.', ...status.detail] : status.detail,
    tone: status.tone,
    state: d.state,
    canShow: live || published,
    showAria: `Show ${d.name} in the Incoming file window`,
    announcement: `${d.from} wants to send ${d.name}, ${shareExactBytes(d.bytes)}. Accept or decline it in the Incoming file window.`,
  };
}

type ShareShow = (offerId: string) => Promise<{ ok: boolean; reason?: string }>;

interface ShareCardNodes {
  root: HTMLElement;
  title: HTMLElement;
  headline: HTMLElement;
  detail: HTMLElement;
  rows: HTMLElement;
  note: HTMLElement;
  actions: HTMLElement;
  show: HTMLButtonElement;
  dismiss: HTMLButtonElement;
}

class ShareReceiveTray {
  private readonly cards = new Map<string, { nodes: ShareCardNodes; model: ShareCardModel; pending: boolean }>();
  private readonly dismissed = new Set<string>();
  private readonly announced = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly live: HTMLElement,
    private readonly show: ShareShow,
  ) {}

  update(list: ShareCardData[]): void {
    const seen = new Set<string>();
    const fresh: HTMLElement[] = [];
    for (const d of list) {
      if (this.dismissed.has(d.offerId)) continue;
      seen.add(d.offerId);
      const model = shareCardModel(d);
      let card = this.cards.get(d.offerId);
      if (!card) {
        card = { nodes: this.build(model.offerId), model, pending: false };
        this.cards.set(d.offerId, card);
        fresh.push(card.nodes.root);
      }
      card.model = model;
      this.draw(card.nodes, model, card.pending);
      if (model.state === 'awaiting-decision' && !this.announced.has(d.offerId)) {
        this.announced.add(d.offerId);
        this.live.textContent = model.announcement;
      }
    }
    // Newest on top, and the tray scrolled to it: a new card is an offer waiting for a person, and
    // appended below earlier finished cards it was the one pushed out of view. The list is newest
    // first, so new cards go in from the oldest up — one update carrying several (a reload) keeps
    // the newest on top. Existing cards are never moved: moving a node takes focus from someone
    // tabbing through it.
    for (let i = fresh.length - 1; i >= 0; i -= 1) this.root.prepend(fresh[i]!);
    if (fresh.length > 0) this.root.scrollTop = 0;
    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.nodes.root.remove();
        this.cards.delete(id);
      }
    }
    this.root.hidden = this.cards.size === 0;
  }

  private build(offerId: string): ShareCardNodes {
    const root = document.createElement('section');
    root.className = 'share-card';
    root.dataset.offerId = offerId;
    root.setAttribute('role', 'group');
    const titleId = `share-card-title-${offerId}`;
    root.setAttribute('aria-labelledby', titleId);

    const title = document.createElement('h3');
    title.className = 'share-card-title';
    title.id = titleId;
    const headline = document.createElement('p');
    headline.className = 'share-card-headline';
    const detail = document.createElement('div');
    detail.className = 'share-card-detail';
    const rows = document.createElement('dl');
    rows.className = 'share-card-rows';
    const note = document.createElement('p');
    note.className = 'share-card-note';
    note.setAttribute('role', 'alert');
    note.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'share-card-actions';
    const show = document.createElement('button') as HTMLButtonElement;
    show.type = 'button';
    show.className = 'button';
    show.dataset.action = 'show';
    show.textContent = 'Show';
    const dismiss = document.createElement('button') as HTMLButtonElement;
    dismiss.type = 'button';
    dismiss.className = 'button';
    dismiss.dataset.action = 'dismiss';
    dismiss.textContent = 'Dismiss';
    actions.append(show, dismiss);

    root.append(title, headline, detail, rows, note, actions);

    show.addEventListener('click', () => void this.send(offerId));
    dismiss.addEventListener('click', () => this.dismiss(offerId));
    root.addEventListener('keydown', (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Escape') return;
      const card = this.cards.get(offerId);
      if (!card) return;
      if (!this.dismissable(card.model)) return;
      event.preventDefault();
      event.stopPropagation();
      this.dismiss(offerId);
    });
    return { root, title, headline, detail, rows, note, actions, show, dismiss };
  }

  private draw(n: ShareCardNodes, m: ShareCardModel, pending: boolean): void {
    n.root.dataset.state = m.state;
    n.root.dataset.tone = m.tone;
    n.title.textContent = m.title;
    n.headline.textContent = m.headline;
    n.detail.replaceChildren(
      ...m.detail.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
    n.rows.replaceChildren(
      ...m.rows.flatMap((r) => {
        const dt = document.createElement('dt');
        dt.textContent = r.label;
        const dd = document.createElement('dd');
        dd.textContent = r.value;
        return [dt, dd];
      }),
    );
    n.show.hidden = !m.canShow;
    n.show.disabled = pending;
    n.show.setAttribute('aria-label', m.showAria);
    n.dismiss.hidden = !this.dismissable(m);
    n.dismiss.setAttribute('aria-label', `Dismiss ${m.title}`);
  }

  /** Only an offer nobody can act on any more may leave the tray. */
  private dismissable(m: ShareCardModel): boolean {
    return m.state !== 'awaiting-decision' && m.state !== 'accepting' && m.state !== 'receiving';
  }

  private async send(offerId: string): Promise<void> {
    const card = this.cards.get(offerId);
    if (!card || !card.model.canShow || card.pending) return;
    card.pending = true;
    card.nodes.note.hidden = true;
    this.draw(card.nodes, card.model, true);
    let result: { ok: boolean; reason?: string };
    try {
      result = await this.show(offerId);
    } catch (error) {
      result = { ok: false, reason: (error as Error).message };
    }
    const now = this.cards.get(offerId);
    if (!now) return;
    now.pending = false;
    if (!result.ok) {
      now.nodes.note.textContent = result.reason ?? 'That did not go through.';
      now.nodes.note.hidden = false;
    }
    this.draw(now.nodes, now.model, false);
  }

  private dismiss(offerId: string): void {
    const card = this.cards.get(offerId);
    if (!card || !this.dismissable(card.model)) return;
    this.dismissed.add(offerId);
    card.nodes.root.remove();
    this.cards.delete(offerId);
    this.root.hidden = this.cards.size === 0;
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.shareCardModel = shareCardModel;
  g.shareExactBytes = shareExactBytes;
  g.ShareReceiveTray = ShareReceiveTray;
}
