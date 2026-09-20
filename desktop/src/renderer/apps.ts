/**
 * The Apps pane: every app on the phone, with its real name and its real icon, and one click that
 * sends it to the phone.
 *
 * ### The copy is the feature, and it says one thing
 *
 * Clicking a tile produces **"Sent to your phone"** and nothing more. Not *Opening…*, not
 * *Launched*, not a spinner that resolves into a tick. The phone posts a notification and a person
 * taps it — later, or never — and this Mac has no way to find out which. Every richer sentence
 * would be a claim neither machine can support.
 *
 * That is a measurement, not caution. `docs/phase-7-apps-proposal.md` §2.4: with ConnectSuite
 * backgrounded, `startActivity` for a third-party package **returns normally, logs nothing, and does
 * not bring the app to the front**. A pane built on the word *launch* would draw a success over
 * exactly that.
 *
 * **So the affordances this pane must never grow**, each of which is reasonable against the wrong
 * name and wrong against the behaviour: a tile that dims while "opening", a retry when a launch
 * "failed", a queue of pending opens, a "recently opened" list. The one tap is the feature working
 * as the platform allows.
 *
 * ### The pane does not gate on the capability, and the reason is specific
 *
 * `apps` is advertised only with POST_NOTIFICATIONS granted — the tap is the only route there is, so
 * without notifications one of three verbs is undeliverable. But `apps.list` and `apps.icon` answer
 * either way, so gating the pane would hide a working, useful grid because the doorbell is off. Same
 * shape as the Photos pane through slice 2: the grid draws, and a `--warning` banner says which half
 * is missing, in the same words as the thing the user is about to try.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts, so a top-level
 * `export` would emit a module the renderer cannot require. The pure half hangs on `globalThis`.
 */

interface AppRow {
  package: string;
  label: string;
  updatedMs: number;
  versionName?: string;
  labelIsFallback?: boolean;
}

interface AppsResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  fixHint?: string;
  code?: string;
}

interface AppsBridge {
  appsList(): Promise<AppsResult<{ apps: AppRow[]; count: number; total: number }>>;
  appsIcons(options: { packages: string[]; maxEdge?: number }): Promise<AppsResult<Array<[string, string]>>>;
  appsOpenAsk(options: { package: string }): Promise<{ ok: boolean; reason?: string; fixHint?: string; code?: string }>;
}

/**
 * The one sentence a click produces, and the only one.
 *
 * Pure and hung on the global so `appsView.test.ts` runs *this* function rather than a second copy
 * of the rule — which is the whole reason the copy that matters most in this pane lives in a
 * function at all. A test asserting a string it also declares would be asserting nothing.
 *
 * There is no `opened` case and no parameter that could produce one. That absence is load-bearing:
 * the wire has no field for it, so a signature with room for it would be the first place somebody
 * filled the gap in with a guess.
 */
function sentNotice(label: string): string {
  return `Sent to your phone — ${label}`;
}

/**
 * What the pane says about itself when `apps` is not advertised.
 *
 * Driven by the capability rather than by a constant, for the reason the Photos banner is: the chip
 * goes green the moment the phone has all three verbs *and* the notification permission, and this
 * notice must disappear in that same moment. A banner saying "the phone cannot show requests" over a
 * pane that is showing them is the stale-copy defect wearing a new pane.
 *
 * The phone's own `reason` is preferred when there is one — this side must not paraphrase which
 * grant is missing, which is the thing it cannot know.
 */
function appsNotice(advertised: boolean, reason: string | null): { headline: string; detail: string } | null {
  if (advertised) return null;
  return {
    headline: 'Your phone cannot show the request',
    detail:
      (reason ??
        'The phone is not offering the apps feature right now.') +
      ' The list and the icons still work — what needs notifications is the tap that actually ' +
      'opens an app, because this Mac cannot open one by itself.',
  };
}

/**
 * `Instagram`, or the package id drawn as the handle it is.
 *
 * The phone sends `labelIsFallback` when `AppLabels` could not resolve a name and fell back to the
 * package id. That fallback is correct and must not be "fixed" — but `CLAUDE.md`'s rule is that a
 * package id may never be *the only thing a user reads*, and where it is unavoidable it is at least
 * drawn as a machine handle rather than as a name somebody chose. Departure row N5 already does
 * this in the notifications pane; this is the same treatment.
 *
 * The flag is read rather than recomputed from `label === package`, because that comparison is also
 * true for an app genuinely named after its package and the phone is the only side that knows which
 * case it is in.
 */
function appTileClass(app: AppRow): string {
  return app.labelIsFallback ? 'apps-tile-name mono' : 'apps-tile-name';
}

/** `1 app` / `122 apps`, and the truncation if the phone ever hits its cap. */
function appsCountLine(count: number, total: number): string {
  const base = `${count.toLocaleString()} ${count === 1 ? 'app' : 'apps'}`;
  // Both numbers, whenever they differ. A list that quietly returned its first thousand rows would
  // otherwise read as a phone with exactly a thousand apps.
  return count < total ? `${base} of ${total.toLocaleString()} — the phone capped the list` : base;
}

/** Case-insensitive substring, the same shape the palette uses. Not a fuzzy matcher, on purpose. */
function appMatches(app: AppRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  // The package is searchable and never *displayed* as the primary label. Somebody who knows they
  // want `com.termux` should find it; that is a different thing from showing them an id they did
  // not ask for.
  return app.label.toLowerCase().includes(q) || app.package.toLowerCase().includes(q);
}

class AppsView {
  private apps: AppRow[] = [];
  private icons = new Map<string, string>();
  private count = 0;
  private total = 0;
  private query = '';
  private loading = false;
  private failure: { reason: string; fixHint?: string } | null = null;
  private advertised = false;
  private unavailableReason: string | null = null;

  /**
   * The last app this Mac asked about, and when.
   *
   * A single slot rather than a list. A history of *asks* would be a list of things that may or may
   * not have happened, presented as a record — which is the "recently opened" affordance this pane
   * is explicitly not allowed to grow, arrived at from the other direction.
   *
   * Named `lastAsk` rather than `lastSent`, and not only because `scripts/check-clip-echo.mjs`
   * refused the second name — it did, and it was right to: `lastSent` is the clipboard interlock's
   * field, and a second home for that rule is the thing the guard exists to prevent. The rename is
   * the better name regardless. Nothing was *sent* anywhere that stays sent; a question was asked.
   * The user-facing copy still says "Sent to your phone", which is true of the request and is the
   * sentence a person understands.
   */
  private lastAsk: { label: string; atMs: number } | null = null;

  /** A per-tile failure, keyed by package: the phone's own sentence for the ask that was refused. */
  private lastRefusal: { package: string; reason: string; fixHint?: string } | null = null;

  constructor(
    private readonly bridge: AppsBridge,
    private readonly banner: HTMLElement,
    private readonly note: HTMLElement,
    private readonly search: HTMLInputElement,
    private readonly grid: HTMLElement,
    private readonly toast: HTMLElement,
  ) {
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.renderGrid();
      this.renderNote();
    });
  }

  setAdvertised(advertised: boolean, reason: string | null = null): void {
    if (this.advertised === advertised && this.unavailableReason === reason) return;
    this.advertised = advertised;
    this.unavailableReason = reason;
    this.renderBanner();
    // Re-drawn because a tile's click is refused differently when the phone cannot ask at all —
    // the pane should not wait for a click to say something it already knows.
    this.renderGrid();
  }

  /**
   * Loads the list, then the icons for what is on screen.
   *
   * Two round trips rather than one on purpose: 122 icons at 96px is roughly a megabyte and the
   * names are a few kilobytes, so the grid draws with real labels in one trip and fills in pictures
   * as the second lands. A single call would hold the whole pane blank for the slower of the two.
   */
  async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.render();
    let failed = false;
    try {
      const result = await this.bridge.appsList();
      if (!result.ok) {
        failed = true;
        this.failure = { reason: result.reason ?? 'The phone did not answer.', fixHint: result.fixHint };
        this.apps = [];
        return;
      }
      this.failure = null;
      this.apps = result.data?.apps ?? [];
      this.count = result.data?.count ?? this.apps.length;
      this.total = result.data?.total ?? this.apps.length;
    } finally {
      // In `finally`, after the state is written, never before it — the window between "no longer
      // loading" and "the data is in place" is where the Photos pane's duplicate fetch came from.
      this.loading = false;
      // **And the redraw is in `finally` too, which the first version got wrong.** The failure
      // branch above returns early, so the render at the end of this method never ran and the pane
      // kept whatever the render at the *top* had drawn — which, on a phone with the capability
      // off, is the "your phone cannot show the request" banner. A refused `apps.list` would then
      // be reported to the user as a missing notification permission: a confident, specific,
      // wrong sentence about a different problem, and the two states this pane is required to keep
      // apart, blurred by control flow rather than by the type. Caught by appsView.test.ts, which
      // is the entire argument for check-renderer-views.mjs.
      this.render();
    }
    if (failed) return;
    await this.fillIcons(this.apps.map((one) => one.package));
  }

  private async fillIcons(packages: string[]): Promise<void> {
    if (packages.length === 0) return;
    const result = await this.bridge.appsIcons({ packages, maxEdge: 96 });
    if (!result.ok) return;
    for (const [pkg, data] of result.data ?? []) this.icons.set(pkg, data);
    this.renderGrid();
  }

  /**
   * One click: ask the phone, and say only that it was asked.
   *
   * The tile is **not** disabled while this is in flight and does not change appearance afterwards.
   * A disabled tile would be modelling a pending operation, and there is no pending operation —
   * the request either reached the phone or it did not, in a few milliseconds, and everything after
   * that belongs to a person holding a phone.
   */
  private async send(app: AppRow): Promise<void> {
    const result = await this.bridge.appsOpenAsk({ package: app.package });
    if (result.ok) {
      this.lastRefusal = null;
      this.lastAsk = { label: app.label, atMs: Date.now() };
    } else {
      // The phone's own sentence. NOTIFICATIONS_BLOCKED and NOT_FOUND want opposite responses —
      // turn a switch on, versus refresh a stale list — and only the phone knows which it is.
      this.lastAsk = null;
      this.lastRefusal = {
        package: app.package,
        reason: result.reason ?? 'The phone did not answer.',
        ...(result.fixHint ? { fixHint: result.fixHint } : {}),
      };
    }
    this.renderToast();
  }

  private render(): void {
    this.renderBanner();
    this.renderNote();
    this.renderGrid();
    this.renderToast();
  }

  /**
   * The two states this pane can be in, as **compact** state blocks (D67).
   *
   * It was `apps-banner` — six rules, its own headline/detail/fix typography, the same six facts
   * component 11 already draws. The comment that used to sit on the second branch is now the
   * component's rule rather than this pane's: `partial` is amber and never destructive, because a
   * feature arriving with one switch off is not a failure and red in a connection product reads as
   * *the link is down*.
   */
  private renderBanner(): void {
    this.banner.replaceChildren();
    if (this.failure) {
      this.banner.hidden = false;
      this.banner.appendChild(
        stateBlock({
          kind: 'permission',
          headline: 'The phone is not sharing its apps',
          // The phone's own sentences, verbatim and unjoined.
          body: [this.failure.reason, ...(this.failure.fixHint ? [this.failure.fixHint] : [])],
          compact: true,
        }),
      );
      return;
    }
    const notice = appsNotice(this.advertised, this.unavailableReason);
    if (!notice) {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    this.banner.appendChild(
      stateBlock({ kind: 'partial', headline: notice.headline, body: notice.detail, compact: true }),
    );
  }

  private renderNote(): void {
    if (this.apps.length === 0) {
      this.note.textContent = '';
      return;
    }
    const shown = this.apps.filter((one) => appMatches(one, this.query)).length;
    this.note.textContent =
      this.query.trim().length > 0
        ? `${shown} of ${appsCountLine(this.count, this.total)}`
        : appsCountLine(this.count, this.total);
  }

  private renderGrid(): void {
    this.grid.textContent = '';
    if (this.failure) return;

    const visible = this.apps.filter((one) => appMatches(one, this.query));
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'apps-empty';
      // Three different nothings, and they must not read alike: still asking, nothing matched the
      // search, and the phone genuinely returned no apps. The last one is close to impossible — a
      // phone with no launcher icons is not a phone — so it says what it would mean rather than
      // pretending it is ordinary.
      if (this.loading) {
        empty.appendChild(appsLine('apps-empty-headline', 'Asking the phone…'));
      } else if (this.apps.length > 0) {
        empty.appendChild(appsLine('apps-empty-headline', 'Nothing matches that'));
        empty.appendChild(
          appsLine('apps-empty-detail', `No app name or package contains “${this.query.trim()}”.`),
        );
      } else {
        empty.appendChild(appsLine('apps-empty-headline', 'The phone listed no apps'));
        empty.appendChild(
          appsLine(
            'apps-empty-detail',
            'That should not happen on a phone with a home screen — it usually means package ' +
              'visibility is refusing the launcher query rather than that there is nothing to show.',
          ),
        );
      }
      this.grid.appendChild(empty);
      return;
    }

    for (const app of visible) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'apps-tile';
      // A stable handle so a probe can count distinct apps rather than distinct labels — two apps
      // really can share a label, which is why the phone sorts with a package tiebreak.
      tile.dataset.package = app.package;
      // The name a person reads is the label; the package rides along as the accessible detail and
      // in the tooltip, where it is a handle beside a name rather than instead of one.
      tile.setAttribute('aria-label', `Send ${app.label} to your phone`);
      tile.title = app.package;

      const art = document.createElement('div');
      art.className = 'apps-tile-art';
      const data = this.icons.get(app.package);
      if (data) {
        const img = document.createElement('img');
        img.className = 'apps-tile-icon';
        img.src = `data:image/png;base64,${data}`;
        img.alt = '';
        art.appendChild(img);
      } else {
        // Flat, not a shimmer. 122 animated placeholders is a lot of motion for a wait measured in
        // hundreds of milliseconds — the same call the Photos grid made.
        art.appendChild(appsLine('apps-tile-pending', ''));
      }
      tile.appendChild(art);
      tile.appendChild(appsLine(appTileClass(app), app.label));

      tile.addEventListener('click', () => void this.send(app));
      this.grid.appendChild(tile);
    }
  }

  /**
   * The one line a click produces.
   *
   * Note what is not here: no timer that clears it into a "did it work?" void, no state that
   * resolves. It sits until the next click, because it is a record of what this Mac did — which is
   * *ask* — and that fact does not expire or turn out to have been wrong.
   */
  private renderToast(): void {
    this.toast.textContent = '';
    const refusal = this.lastRefusal;
    if (refusal) {
      this.toast.hidden = false;
      this.toast.className = 'apps-toast refused';
      this.toast.appendChild(appsLine('apps-toast-line', refusal.reason));
      if (refusal.fixHint) this.toast.appendChild(appsLine('apps-toast-fix', refusal.fixHint));
      return;
    }
    const sent = this.lastAsk;
    if (!sent) {
      this.toast.hidden = true;
      return;
    }
    this.toast.hidden = false;
    this.toast.className = 'apps-toast sent';
    this.toast.appendChild(appsLine('apps-toast-line', sentNotice(sent.label)));
  }
}

function appsLine(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

// Hung on the global for appsView.test.ts, per the renderer's testable-seam rule: the test runs the
// code that draws the copy rather than a second copy of the rule that can drift from it.
(globalThis as Record<string, unknown>).__appLabels = {
  sentNotice,
  appsNotice,
  appsCountLine,
  appMatches,
  appTileClass,
};
(globalThis as Record<string, unknown>).AppsView = AppsView;
