/**
 * The receive window's page — docs/feature-a-receive-window.md.
 *
 * ### What this page may and may not do
 *
 * It **draws** the snapshot the main process sends (via [shareWindowModel], the one rule for what
 * is said) and **sends back an `offerId` and a word**. It never sends a path, a name or anything
 * from the offer. `share-decide` is honoured only from this window, only while it is visible and
 * focused, and `ShareReceiver.decide` re-checks the destination, the version and the session.
 *
 * ### Decisions, stated rather than implied
 *
 * - **Focus is never moved by an arrival.** The window appears inactive; inside it nothing is
 *   focused until the person clicks or tabs. Tab order: close, then Decline before Accept.
 * - **Escape declines a waiting offer** (the safe direction) and closes anything else — the same
 *   rule as the old card. **The close button never declines**: while an offer waits it says *Hide*
 *   and its label says the request keeps waiting.
 * - **Every string from the phone is set as text**, never as markup.
 * - **A finished offer that is not a saved file closes itself after 8 s** unless the pointer is on
 *   the window or it has focus. A saved file waits to be closed: it may carry actions.
 * - **Motion** is the tokens' (`--dur-float`, `--ease-float`); the reduced-motion block in
 *   tokens.css collapses it, and nothing waits on an animation.
 *
 * Plain script: no `export`; the class is hung on `globalThis` at the foot for the tests.
 */

interface ShareWinPayload {
  subject: string | null;
  offers: ShareWinOffer[];
  phone: string | null;
  /** A thumbnail of the **published, verified** file, rendered by the main process; else null. */
  thumb?: string | null;
}

type ShareWinReply = Promise<{ ok: boolean; reason?: string }>;

interface ShareWinBridge {
  shareWindowState?(): Promise<ShareWinPayload | null>;
  onShareWindow?(callback: (state: ShareWinPayload) => void): void;
  shareWindowClose?(): void;
  shareWindowHeight?(height: number): void;
  shareDecide?(offerId: string, decision: 'accept' | 'decline'): ShareWinReply;
  shareAct?(action: 'cancel' | 'retry' | 'open' | 'reveal', offerId: string): ShareWinReply;
  appearanceGet?(): Promise<{ ok: boolean; data: { theme: string } }>;
  onAppearance?(callback: (state: { theme: string }) => void): void;
}

interface ShareWinNodes {
  root: HTMLElement;
  close: HTMLButtonElement;
  tile: HTMLElement;
  eyebrow: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
  place: HTMLElement;
  placeLabel: HTMLElement;
  placeValue: HTMLElement;
  detail: HTMLElement;
  note: HTMLElement;
  actions: HTMLElement;
  live: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  progressLabel: HTMLElement;
}

/** How long a finished, unsaved offer stays up on its own. */
const SHARE_WIN_LINGER_MS = 8000;

class ShareWindowView {
  private model: ShareWinModel | null = null;
  private pending = false;
  private announced = new Set<string>();
  private lingerTimer: number | null = null;
  private hovered = false;
  private thumb: string | null = null;

  constructor(
    private readonly n: ShareWinNodes,
    private readonly bridge: ShareWinBridge,
  ) {
    n.close.addEventListener('click', () => this.close());
    n.root.addEventListener('keydown', (event: Event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || this.model === null) return;
      event.preventDefault();
      if (this.model?.state === 'awaiting-decision') void this.send('decline');
      else this.close();
    });
    n.root.addEventListener('pointerenter', () => {
      this.hovered = true;
    });
    n.root.addEventListener('pointerleave', () => {
      this.hovered = false;
    });
  }

  /** The list view has taken the window (version 3): hold no offer, so Escape here acts on nothing. */
  reset(): void {
    this.model = null;
    if (this.lingerTimer !== null) window.clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
  }

  update(p: ShareWinPayload): void {
    const offer = p.offers.find((o) => o.offerId === p.subject) ?? null;
    if (!offer) {
      // The offer is gone from this run (it cannot be, today — offers are kept for the run), or no
      // subject was set: there is nothing true to draw, so the window says nothing and goes.
      this.model = null;
      this.n.root.dataset.state = 'none';
      return;
    }
    const before = this.model;
    const m = shareWindowModel(offer, p.phone);
    this.model = m;
    // A picture only of a file this Mac published and verified; before that, a type glyph.
    this.thumb = (m.state === 'saved' || m.state === 'saved-unacknowledged') && typeof p.thumb === 'string' ? p.thumb : null;
    if (before?.offerId !== m.offerId || before.state !== m.state) {
      this.pending = false;
      this.n.note.hidden = true;
      this.scheduleLinger(m);
    }
    this.draw(m);
    if ((m.state === 'awaiting-decision' || m.state === 'refused') && !this.announced.has(m.offerId)) {
      this.announced.add(m.offerId);
      this.n.live.textContent = m.announcement;
    }
  }

  private draw(m: ShareWinModel): void {
    const n = this.n;
    n.root.dataset.state = m.state;
    n.root.dataset.tone = m.tone;
    const tileKey = this.thumb ? `thumb:${m.offerId}` : m.glyph;
    if (n.tile.dataset.glyph !== tileKey) {
      n.tile.dataset.glyph = tileKey;
      if (this.thumb) {
        const img = document.createElement('img') as HTMLImageElement;
        img.className = 'sw-thumb';
        img.alt = '';
        img.src = this.thumb;
        n.tile.replaceChildren(img);
      } else {
        n.tile.replaceChildren(iconSvg(m.glyph, 26));
      }
    }
    n.eyebrow.textContent = m.eyebrow;
    n.title.textContent = m.title;
    n.title.setAttribute('title', m.title);
    n.meta.textContent = m.meta;
    const pr = m.progress;
    n.progress.hidden = pr === null;
    if (pr) {
      n.progress.dataset.checking = String(pr.checking);
      n.progress.dataset.indeterminate = String(pr.fraction === null);
      n.fill.style.transform = `scaleX(${pr.fraction ?? 0})`;
      n.progressLabel.textContent = pr.label;
      n.progress.setAttribute('aria-valuemax', String(pr.total));
      if (pr.fraction === null) n.progress.removeAttribute('aria-valuenow');
      else n.progress.setAttribute('aria-valuenow', String(pr.received));
      n.progress.setAttribute('aria-valuetext', pr.label);
    }
    n.place.hidden = m.place === null;
    n.placeLabel.textContent = m.place?.label ?? '';
    n.placeValue.textContent = m.place?.value ?? '';
    n.placeValue.setAttribute('title', m.place?.value ?? '');
    n.detail.replaceChildren(
      ...[...m.detail, ...(m.senderNote ? [m.senderNote] : [])].map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
    const waiting = m.state === 'awaiting-decision';
    n.close.setAttribute('aria-label', waiting ? 'Hide this window. The request keeps waiting until it expires.' : 'Close');
    n.close.setAttribute('title', waiting ? 'Hide — the request keeps waiting' : 'Close');
    if (n.close.dataset.icon !== 'close') {
      n.close.dataset.icon = 'close';
      n.close.append(iconSvg('close', 14));
    }

    // Rebuilt only when the set of actions changes, so a button somebody is tabbing through keeps
    // its focus across a snapshot that only changed a byte count.
    const key = m.actions.map((a) => a.id).join(',');
    if (n.actions.dataset.key !== key) {
      n.actions.dataset.key = key;
      n.actions.replaceChildren(
        ...m.actions.map((a) => {
          const b = document.createElement('button') as HTMLButtonElement;
          b.type = 'button';
          b.className = a.primary ? 'sw-button sw-primary' : 'sw-button';
          b.dataset.action = a.id;
          b.textContent = a.label;
          b.addEventListener('click', () => this.act(a.id));
          return b;
        }),
      );
    }
    for (const b of n.actions.querySelectorAll('button') as unknown as HTMLButtonElement[]) {
      const a = m.actions.find((x) => x.id === b.dataset.action);
      if (a) b.setAttribute('aria-label', a.aria);
      b.disabled = this.pending;
    }
    n.actions.hidden = m.actions.length === 0;
  }

  private act(id: ShareWinActionId): void {
    if (id === 'close') this.close();
    else if (id === 'accept' || id === 'decline') void this.send(id);
    else void this.run(id);
  }

  /** Cancel, Try again, Open, Show in Finder: an `offerId` and a word; the main process does the rest. */
  private async run(action: 'cancel' | 'retry' | 'open' | 'reveal'): Promise<void> {
    const m = this.model;
    if (!m || this.pending || !this.bridge.shareAct) return;
    this.pending = true;
    this.n.note.hidden = true;
    this.draw(m);
    let result: { ok: boolean; reason?: string };
    try {
      result = await this.bridge.shareAct(action, m.offerId);
    } catch (error) {
      result = { ok: false, reason: (error as Error).message };
    }
    this.pending = false;
    if (!result.ok) {
      this.n.note.textContent = result.reason ?? 'That did not go through.';
      this.n.note.hidden = false;
    }
    if (this.model) this.draw(this.model);
  }

  private async send(decision: 'accept' | 'decline'): Promise<void> {
    const m = this.model;
    if (!m || m.state !== 'awaiting-decision' || this.pending || !this.bridge.shareDecide) return;
    this.pending = true;
    this.n.note.hidden = true;
    this.draw(m);
    let result: { ok: boolean; reason?: string };
    try {
      result = await this.bridge.shareDecide(m.offerId, decision);
    } catch (error) {
      result = { ok: false, reason: (error as Error).message };
    }
    this.pending = false;
    if (!result.ok) {
      this.n.note.textContent = result.reason ?? 'That did not go through.';
      this.n.note.hidden = false;
    }
    if (this.model) this.draw(this.model);
  }

  private close(): void {
    this.bridge.shareWindowClose?.();
  }

  private scheduleLinger(m: ShareWinModel): void {
    if (this.lingerTimer !== null) window.clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    if (!m.closesItself) return;
    const offerId = m.offerId;
    this.lingerTimer = window.setTimeout(() => {
      this.lingerTimer = null;
      if (this.model?.offerId !== offerId || !this.model.closesItself) return;
      // Somebody is reading it or has it focused: leave it for them to close.
      if (this.hovered || document.hasFocus?.()) return;
      this.close();
    }, SHARE_WIN_LINGER_MS);
  }
}

interface ShareQueueNodes {
  root: HTMLElement;
  /** The one-file layout's container: hidden while the list is drawn. */
  one: HTMLElement;
  /** The list of cards. */
  queue: HTMLElement;
  close: HTMLButtonElement;
  live: HTMLElement;
}

/** One card's own elements, found once when the card is built. */
interface ShareQueueCard {
  el: HTMLElement;
  tile: HTMLElement;
  eyebrow: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  progressLabel: HTMLElement;
  place: HTMLElement;
  placeLabel: HTMLElement;
  placeValue: HTMLElement;
  detail: HTMLElement;
  note: HTMLElement;
  actions: HTMLElement;
  model: ShareWinModel;
  pending: boolean;
  lingerTimer: number | null;
}

/**
 * **Version 3 only — PROPOSED, reachable only at a negotiated `share.file` 3, which nothing
 * advertises.** The same window drawing one card per offer, in arrival order
 * (docs/feature-a-multi-offer-proposal.md rev 3 §2, §5). [ShareWindowView] stays the whole window at
 * version 2; the page hands a snapshot to this view only when an offer arrived at version 3.
 *
 * - **Every action names its own card's `offerId`**, taken from the model action — never a position,
 *   never "the subject". Pending is per card, so a slow Accept on one card leaves the others usable.
 * - **Escape declines only the focused card's waiting offer.** With no card focused it hides the
 *   window, which declines nothing.
 * - **The header's close hides the window; a card's Close dismisses that card.** Neither declines.
 * - A finished card that is not a saved file lingers 8 s, then leaves the list unless the pointer is
 *   on the window or it has focus; a saved one stays until closed. When the last card has gone, the
 *   window closes itself.
 * - Nothing here moves focus. Arrivals are announced once each in the polite live region.
 */
class ShareQueueView {
  private readonly cards = new Map<string, ShareQueueCard>();
  private readonly shown = new Set<string>();
  private readonly dismissed = new Set<string>();
  private readonly announced = new Set<string>();
  private subject: string | null = null;
  private hovered = false;
  private active = false;
  private last: ShareWinPayload | null = null;

  constructor(
    private readonly n: ShareQueueNodes,
    private readonly bridge: ShareWinBridge,
  ) {
    n.root.addEventListener('keydown', (event: Event) => {
      if (!this.active || (event as KeyboardEvent).key !== 'Escape') return;
      event.preventDefault();
      const card = this.focusedCard();
      if (card?.model.state === 'awaiting-decision') void this.decide(card, 'decline');
      else this.bridge.shareWindowClose?.();
    });
    n.root.addEventListener('pointerenter', () => {
      this.hovered = true;
    });
    n.root.addEventListener('pointerleave', () => {
      this.hovered = false;
    });
  }

  /** Whether this view owns the window now (the page routes every snapshot through [update]). */
  isActive(): boolean {
    return this.active;
  }

  update(p: ShareWinPayload): void {
    this.last = p;
    this.active = shareQueueMode(p.offers);
    this.n.queue.hidden = !this.active;
    this.n.one.hidden = this.active;
    if (!this.active) return;
    if (p.subject !== null && p.subject !== this.subject) {
      // Presented or shown by a person for this offer: it is on the list even if it has finished.
      this.subject = p.subject;
      this.shown.add(p.subject);
      this.dismissed.delete(p.subject);
    }
    for (const o of p.offers) if (shareWinPending(o)) this.shown.add(o.offerId);
    const models = shareQueueCards(p.offers, p.phone, this.shown, this.dismissed);
    this.n.root.dataset.state = models.length === 0 ? 'none' : 'queue';
    this.n.root.dataset.tone = 'neutral';
    const keep = new Set(models.map((m) => m.offerId));
    for (const [id, card] of this.cards) {
      if (keep.has(id)) continue;
      if (card.lingerTimer !== null) window.clearTimeout(card.lingerTimer);
      card.el.remove();
      this.cards.delete(id);
    }
    // In arrival order: append moves an existing node to the end, so the list ends up in order.
    for (const m of models) {
      let card = this.cards.get(m.offerId);
      const before = card?.model ?? null;
      if (!card) {
        card = this.build(m);
        this.cards.set(m.offerId, card);
      }
      card.model = m;
      if (before === null || before.state !== m.state) {
        card.pending = false;
        card.note.hidden = true;
        this.scheduleLinger(card);
      }
      this.n.queue.append(card.el);
      this.draw(card, m.offerId === this.subject && typeof p.thumb === 'string' ? p.thumb : null);
      if ((m.state === 'awaiting-decision' || m.state === 'refused') && !this.announced.has(m.offerId)) {
        this.announced.add(m.offerId);
        this.n.live.textContent = m.announcement;
      }
    }
    const waiting = models.filter((m) => m.state === 'awaiting-decision').length;
    const hide = waiting > 0 ? 'Hide this window. Waiting files keep waiting until they expire.' : 'Close';
    this.n.close.setAttribute('aria-label', hide);
    this.n.close.setAttribute('title', waiting > 0 ? 'Hide — waiting files keep waiting' : 'Close');
  }

  private build(m: ShareWinModel): ShareQueueCard {
    const el = document.createElement('li') as HTMLElement;
    el.className = 'sw-card';
    el.dataset.offerId = m.offerId;
    const part = (tag: string, cls: string): HTMLElement => {
      const x = document.createElement(tag) as HTMLElement;
      x.className = cls;
      return x;
    };
    const file = part('div', 'sw-file');
    const tile = part('div', 'sw-tile');
    tile.setAttribute('aria-hidden', 'true');
    const text = part('div', 'sw-text');
    const eyebrow = part('p', 'sw-eyebrow');
    const title = part('h2', 'sw-title');
    const meta = part('p', 'sw-meta');
    text.append(eyebrow, title, meta);
    file.append(tile, text);
    const progress = part('div', 'sw-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    const track = part('div', 'sw-track');
    const fill = part('div', 'sw-fill');
    track.append(fill);
    const progressLabel = part('p', 'sw-progress-label');
    progress.append(track, progressLabel);
    progress.hidden = true;
    const place = part('dl', 'sw-place');
    const placeLabel = part('dt', '');
    const placeValue = part('dd', '');
    place.append(placeLabel, placeValue);
    const detail = part('div', 'sw-detail');
    const note = part('p', 'sw-note');
    note.setAttribute('role', 'alert');
    note.hidden = true;
    const actions = part('div', 'sw-actions');
    el.append(file, progress, place, detail, note, actions);
    return { el, tile, eyebrow, title, meta, progress, fill, progressLabel, place, placeLabel, placeValue, detail, note, actions, model: m, pending: false, lingerTimer: null };
  }

  private draw(card: ShareQueueCard, thumb: string | null): void {
    const m = card.model;
    card.el.dataset.state = m.state;
    card.el.dataset.tone = m.tone;
    card.el.setAttribute('aria-label', m.title);
    const picture = (m.state === 'saved' || m.state === 'saved-unacknowledged') && thumb !== null ? thumb : null;
    const tileKey = picture ? `thumb:${m.offerId}` : m.glyph;
    if (card.tile.dataset.glyph !== tileKey) {
      card.tile.dataset.glyph = tileKey;
      if (picture) {
        const img = document.createElement('img') as HTMLImageElement;
        img.className = 'sw-thumb';
        img.alt = '';
        img.src = picture;
        card.tile.replaceChildren(img);
      } else {
        card.tile.replaceChildren(iconSvg(m.glyph, 22));
      }
    }
    card.eyebrow.textContent = m.eyebrow;
    card.title.textContent = m.title;
    card.title.setAttribute('title', m.title);
    card.meta.textContent = m.meta;
    const pr = m.progress;
    card.progress.hidden = pr === null;
    if (pr) {
      card.progress.dataset.checking = String(pr.checking);
      card.progress.dataset.indeterminate = String(pr.fraction === null);
      card.fill.style.transform = `scaleX(${pr.fraction ?? 0})`;
      card.progressLabel.textContent = pr.label;
      card.progress.setAttribute('aria-valuemax', String(pr.total));
      if (pr.fraction === null) card.progress.removeAttribute('aria-valuenow');
      else card.progress.setAttribute('aria-valuenow', String(pr.received));
      card.progress.setAttribute('aria-valuetext', pr.label);
    }
    card.place.hidden = m.place === null;
    card.placeLabel.textContent = m.place?.label ?? '';
    card.placeValue.textContent = m.place?.value ?? '';
    card.detail.replaceChildren(
      ...[...m.detail, ...(m.senderNote ? [m.senderNote] : [])].map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
    const key = m.actions.map((a) => a.id).join(',');
    if (card.actions.dataset.key !== key) {
      card.actions.dataset.key = key;
      card.actions.replaceChildren(
        ...m.actions.map((a) => {
          const b = document.createElement('button') as HTMLButtonElement;
          b.type = 'button';
          b.className = a.primary ? 'sw-button sw-primary' : 'sw-button';
          b.dataset.action = a.id;
          b.dataset.offerId = a.offerId;
          b.textContent = a.label;
          b.addEventListener('click', () => this.act(a.offerId, a.id));
          return b;
        }),
      );
    }
    for (const b of card.actions.querySelectorAll('button') as unknown as HTMLButtonElement[]) {
      const a = m.actions.find((x) => x.id === b.dataset.action);
      if (a) b.setAttribute('aria-label', a.aria);
      b.disabled = card.pending;
    }
    card.actions.hidden = m.actions.length === 0;
  }

  /** The action names its card's `offerId`; the card is looked up by it, never by position. */
  private act(offerId: string, id: ShareWinActionId): void {
    const card = this.cards.get(offerId);
    if (!card) return;
    if (id === 'close') this.dismiss(offerId);
    else if (id === 'accept' || id === 'decline') void this.decide(card, id);
    else void this.run(card, id);
  }

  private async decide(card: ShareQueueCard, decision: 'accept' | 'decline'): Promise<void> {
    if (card.model.state !== 'awaiting-decision' || card.pending || !this.bridge.shareDecide) return;
    await this.send(card, () => this.bridge.shareDecide!(card.model.offerId, decision));
  }

  private async run(card: ShareQueueCard, action: 'cancel' | 'retry' | 'open' | 'reveal'): Promise<void> {
    if (card.pending || !this.bridge.shareAct) return;
    await this.send(card, () => this.bridge.shareAct!(action, card.model.offerId));
  }

  private async send(card: ShareQueueCard, call: () => ShareWinReply): Promise<void> {
    card.pending = true;
    card.note.hidden = true;
    this.draw(card, null);
    let result: { ok: boolean; reason?: string };
    try {
      result = await call();
    } catch (error) {
      result = { ok: false, reason: (error as Error).message };
    }
    card.pending = false;
    if (!result.ok) {
      card.note.textContent = result.reason ?? 'That did not go through.';
      card.note.hidden = false;
    }
    if (this.cards.get(card.model.offerId) === card) this.draw(card, null);
  }

  /** A card's Close: this card leaves the list. The window closes when nothing is left on it. */
  private dismiss(offerId: string): void {
    this.dismissed.add(offerId);
    if (this.last) this.update(this.last);
    if (this.cards.size === 0) this.bridge.shareWindowClose?.();
  }

  private focusedCard(): ShareQueueCard | null {
    const active = (document as unknown as { activeElement: HTMLElement | null }).activeElement;
    const el = (active?.closest?.('.sw-card') ?? null) as HTMLElement | null;
    const id = el?.dataset.offerId;
    return id ? (this.cards.get(id) ?? null) : null;
  }

  private scheduleLinger(card: ShareQueueCard): void {
    if (card.lingerTimer !== null) window.clearTimeout(card.lingerTimer);
    card.lingerTimer = null;
    if (!card.model.closesItself) return;
    const offerId = card.model.offerId;
    card.lingerTimer = window.setTimeout(() => {
      card.lingerTimer = null;
      if (this.cards.get(offerId) !== card || !card.model.closesItself) return;
      if (this.hovered || document.hasFocus?.()) return;
      this.dismiss(offerId);
    }, SHARE_WIN_LINGER_MS);
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.ShareWindowView = ShareWindowView;
  g.ShareQueueView = ShareQueueView;
}

// The real page only: the tests construct the view over the DOM double and never reach this.
if (typeof document !== 'undefined' && typeof document.getElementById === 'function' && document.getElementById('sw')) {
  const bridge = (globalThis as unknown as { connect: ShareWinBridge }).connect;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const view = new ShareWindowView(
    {
      root: byId('sw'),
      close: byId('sw-close') as HTMLButtonElement,
      tile: byId('sw-tile'),
      eyebrow: byId('sw-eyebrow'),
      title: byId('sw-title'),
      meta: byId('sw-meta'),
      place: byId('sw-place'),
      placeLabel: byId('sw-place-label'),
      placeValue: byId('sw-place-value'),
      detail: byId('sw-detail'),
      note: byId('sw-note'),
      actions: byId('sw-actions'),
      live: byId('sw-live'),
      progress: byId('sw-progress'),
      fill: byId('sw-fill'),
      progressLabel: byId('sw-progress-label'),
    },
    bridge,
  );
  bridge.onAppearance?.((state) => document.documentElement.setAttribute('data-theme', state.theme));
  void bridge.appearanceGet?.().then((r) => {
    if (r?.ok) document.documentElement.setAttribute('data-theme', r.data.theme);
  });
  // The window is sized to what it draws: the main process clamps and anchors it top-right.
  const root = byId('sw');
  new ResizeObserver(() => bridge.shareWindowHeight?.(Math.ceil(root.getBoundingClientRect().height))).observe(root);
  // Version 3 only: the list of cards. At version 2 it never becomes active and the view above is the
  // whole window, exactly as before.
  const queue = new ShareQueueView(
    { root, one: byId('sw-one'), queue: byId('sw-queue'), close: byId('sw-close') as HTMLButtonElement, live: byId('sw-live') },
    bridge,
  );
  const route = (state: ShareWinPayload): void => {
    queue.update(state);
    if (queue.isActive()) view.reset();
    else view.update(state);
  };
  bridge.onShareWindow?.((state) => route(state));
  void bridge.shareWindowState?.().then((state) => {
    if (state) route(state);
  });
}
