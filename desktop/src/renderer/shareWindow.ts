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
}

interface ShareWinBridge {
  shareWindowState?(): Promise<ShareWinPayload | null>;
  onShareWindow?(callback: (state: ShareWinPayload) => void): void;
  shareWindowClose?(): void;
  shareWindowHeight?(height: number): void;
  shareDecide?(offerId: string, decision: 'accept' | 'decline'): Promise<{ ok: boolean; reason?: string }>;
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
}

/** How long a finished, unsaved offer stays up on its own. */
const SHARE_WIN_LINGER_MS = 8000;

class ShareWindowView {
  private model: ShareWinModel | null = null;
  private pending = false;
  private announced = new Set<string>();
  private lingerTimer: number | null = null;
  private hovered = false;

  constructor(
    private readonly n: ShareWinNodes,
    private readonly bridge: ShareWinBridge,
  ) {
    n.close.addEventListener('click', () => this.close());
    n.root.addEventListener('keydown', (event: Event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
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
    if (n.tile.dataset.glyph !== m.glyph) {
      n.tile.dataset.glyph = m.glyph;
      n.tile.replaceChildren(iconSvg(m.glyph, 26));
    }
    n.eyebrow.textContent = m.eyebrow;
    n.title.textContent = m.title;
    n.title.setAttribute('title', m.title);
    n.meta.textContent = m.meta;
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
    else void this.send(id);
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

{
  const g = globalThis as Record<string, unknown>;
  g.ShareWindowView = ShareWindowView;
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
  bridge.onShareWindow?.((state) => view.update(state));
  void bridge.shareWindowState?.().then((state) => {
    if (state) view.update(state);
  });
}
