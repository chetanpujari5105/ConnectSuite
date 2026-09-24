/**
 * The Mac's receive card — a file the phone wants to send, and the person's Accept or Decline.
 * docs/protocol.md → Share → Version 2.
 *
 * ### What this view may and may not do
 *
 * It **draws** snapshots the main process sends and **sends back an `offerId` and a word**. It never
 * sends a path, a name, or anything from the offer: `main/shareDecision.ts` refuses any other field,
 * refuses an Accept from a window nobody can be looking at, and `ShareReceiver.decide` re-checks the
 * destination, free space, hard-link support, the negotiated version and the session before a byte
 * moves. So nothing on this page can authorise a save; the most it can do is ask.
 *
 * ### Decisions, stated rather than implied
 *
 * - **Ask is the only mode.** There is no auto-accept here; the card waits.
 * - **Focus is not moved when a card arrives.** A person typing elsewhere would otherwise send an
 *   Enter or a Space into Accept. Arrival is announced through a polite live region instead, and the
 *   card is reached by Tab. Decline comes before Accept in the tab order.
 * - **Escape inside a waiting card declines** (the safe direction); inside a finished card it
 *   dismisses it. Nothing else on the page is affected.
 * - **Every string from the phone is set as text**, never as markup: the name is re-sanitised in the
 *   main process and the phone's device name is only ever `textContent`.
 * - **"Saved" only after the Mac published a verified file** — the words come from
 *   `shared/shareReceiveCopy.ts`, which keeps *saved on this Mac* and *confirmed by the phone* as two
 *   separate facts. Expired reads "Expired", never "Declined".
 * - **Motion**: the card arrives with a keyframed fade (`share-card-in`, `--dur-float`); the global
 *   reduced-motion block in `tokens.css` collapses every animation to an instant, and nothing here
 *   waits for the animation — the buttons work from the first frame.
 * - **Hidden window**: the main process posts a banner that only brings the window forward; this
 *   card is where the decision is made.
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
  canDecide: boolean;
  acceptAria: string;
  declineAria: string;
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
  const rows = [
    { label: 'From', value: d.from },
    { label: 'Type', value: d.mime },
    { label: 'Size', value: shareExactBytes(d.bytes) },
    published && d.savedAs !== null
      ? { label: 'Saved as', value: `${d.folder}/${d.savedAs}` }
      : { label: 'Save to', value: d.folder },
  ];
  return {
    offerId: d.offerId,
    title: d.name,
    from: d.from,
    rows,
    headline: status.headline,
    detail: status.detail,
    tone: status.tone,
    state: d.state,
    canDecide: d.state === 'awaiting-decision',
    acceptAria: `Accept ${d.name} from ${d.from} and save it to ${d.folder}`,
    declineAria: `Decline ${d.name} from ${d.from}`,
    announcement: `${d.from} wants to send ${d.name}, ${shareExactBytes(d.bytes)}. Accept or decline it in the incoming file card.`,
  };
}

type ShareDecide = (offerId: string, decision: 'accept' | 'decline') => Promise<{ ok: boolean; reason?: string }>;

interface ShareCardNodes {
  root: HTMLElement;
  title: HTMLElement;
  headline: HTMLElement;
  detail: HTMLElement;
  rows: HTMLElement;
  note: HTMLElement;
  actions: HTMLElement;
  decline: HTMLButtonElement;
  accept: HTMLButtonElement;
  dismiss: HTMLButtonElement;
}

class ShareReceiveTray {
  private readonly cards = new Map<string, { nodes: ShareCardNodes; model: ShareCardModel; pending: boolean }>();
  private readonly dismissed = new Set<string>();
  private readonly announced = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly live: HTMLElement,
    private readonly decide: ShareDecide,
  ) {}

  update(list: ShareCardData[]): void {
    const seen = new Set<string>();
    for (const d of list) {
      if (this.dismissed.has(d.offerId)) continue;
      seen.add(d.offerId);
      const model = shareCardModel(d);
      let card = this.cards.get(d.offerId);
      if (!card) {
        card = { nodes: this.build(model.offerId), model, pending: false };
        this.cards.set(d.offerId, card);
        this.root.appendChild(card.nodes.root);
      }
      card.model = model;
      if (!model.canDecide) card.pending = false;
      this.draw(card.nodes, model, card.pending);
      if (model.canDecide && !this.announced.has(d.offerId)) {
        this.announced.add(d.offerId);
        this.live.textContent = model.announcement;
      }
    }
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
    const decline = document.createElement('button') as HTMLButtonElement;
    decline.type = 'button';
    decline.className = 'button';
    decline.dataset.action = 'decline';
    decline.textContent = 'Decline';
    const accept = document.createElement('button') as HTMLButtonElement;
    accept.type = 'button';
    accept.className = 'button primary-action';
    accept.dataset.action = 'accept';
    accept.textContent = 'Accept';
    const dismiss = document.createElement('button') as HTMLButtonElement;
    dismiss.type = 'button';
    dismiss.className = 'button';
    dismiss.dataset.action = 'dismiss';
    dismiss.textContent = 'Dismiss';
    actions.append(decline, accept, dismiss);

    root.append(title, headline, detail, rows, note, actions);

    decline.addEventListener('click', () => void this.send(offerId, 'decline'));
    accept.addEventListener('click', () => void this.send(offerId, 'accept'));
    dismiss.addEventListener('click', () => this.dismiss(offerId));
    root.addEventListener('keydown', (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Escape') return;
      const card = this.cards.get(offerId);
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      if (card.model.canDecide) void this.send(offerId, 'decline');
      else this.dismiss(offerId);
    });
    return { root, title, headline, detail, rows, note, actions, decline, accept, dismiss };
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
    n.decline.hidden = !m.canDecide;
    n.accept.hidden = !m.canDecide;
    n.dismiss.hidden = m.canDecide || m.state === 'accepting' || m.state === 'receiving';
    n.decline.disabled = pending;
    n.accept.disabled = pending;
    n.accept.setAttribute('aria-label', m.acceptAria);
    n.decline.setAttribute('aria-label', m.declineAria);
    n.dismiss.setAttribute('aria-label', `Dismiss ${m.title}`);
    if (!m.canDecide) n.note.hidden = true;
  }

  private async send(offerId: string, decision: 'accept' | 'decline'): Promise<void> {
    const card = this.cards.get(offerId);
    if (!card || !card.model.canDecide || card.pending) return;
    card.pending = true;
    card.nodes.note.hidden = true;
    this.draw(card.nodes, card.model, true);
    let result: { ok: boolean; reason?: string };
    try {
      result = await this.decide(offerId, decision);
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
    if (!card || card.model.canDecide || card.model.state === 'accepting' || card.model.state === 'receiving') return;
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
