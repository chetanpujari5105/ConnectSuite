/**
 * Overview's two additions: **Recent activity** and the footer strip, plus O4's status rings.
 *
 * **Quick actions was deleted on 2026-09-16, not hidden.** Its eight tiles were a third route to
 * screens the sidebar and the ⌘K palette already reach, and five of the eight are in the dock as
 * well — so it cost a column of the top row to duplicate navigation that was never missing. The
 * freed slot is the media card's. Nothing was lost: every one of the eight is in `SCREENS`, which
 * is what the sidebar and the palette both read.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts, so a top-level
 * `export` here would emit a CommonJS module the renderer cannot require.
 *
 * ### Why this is a class and not three functions in `renderer.ts`
 *
 * It was three functions in `renderer.ts` for about an hour, and in that hour it shipped a bug
 * nothing in the suite could have caught: `drawRecentActivity` took `events.slice(0, 5)`, the store
 * returns events **oldest first**, and the card drew the five oldest things that had ever happened
 * under a heading reading *Recent activity*. It was found by looking at a screenshot.
 *
 * `renderer.ts` is reachable by no test — it needs `connect`, `shell` and a live DOM at module
 * scope — so every line of drawing in it sits outside the project's entire test surface.
 * `check-renderer-views.mjs` exists because three renderer-only defects have already shipped green
 * from exactly that position. `CLAUDE.md`: *when a bug recurs in one line, the question is not is
 * the new expression right but what would have caught either version, and if the answer is
 * "nothing", the line is in the wrong file.* This is that move, made before the fifth one.
 *
 * ### What it deliberately does not own
 *
 * The hero card, the capability chips and the media remote stay with `renderer.ts` and `RemoteView`.
 * This class is the three things the handoff draws that were missing, and nothing else — a class
 * that grew to own the whole screen would be `renderer.ts` again with a constructor.
 */

interface OverviewBridge {
  activityEvents(): Promise<
    | { ok: true; data?: { events: ActivityEvent[]; error: string | null } }
    | { ok: false; reason?: string }
  >;
  disconnect(): Promise<unknown>;
}


/**
 * The strip's sentence.
 *
 * It is about **our link**, which is TLS 1.3 with a pinned certificate on both ends — deliberately
 * not the badge X1 and C4 cut, which were claims about an SMS and about a cellular call, neither of
 * which this Mac carries a byte of. This one is about the only thing that *is* ours.
 *
 * Disconnected says so instead. A strip claiming an encrypted connection over a link that is down
 * would be this screen's one security sentence being wrong in the state where somebody is most
 * likely to be reading it.
 *
 * **The connected sentence is the handoff's, word for word, and it names no device — departure
 * O12.** Ours read *"Encrypted end to end with Samsung SM-S938B…"*, which put the device name on
 * this screen a **third** time beside the sidebar card and the hero. The name adds nothing here: it
 * is the only phone this Mac is paired with, it is 80px above in 21px type, and *"only your
 * devices"* already says who the two parties are. `deviceName` is gone as a parameter rather than
 * left unused, so nothing can quietly put it back.
 */
function overviewStripLine(connected: boolean): string {
  return connected
    ? 'Connection is encrypted end-to-end. Only your devices can read this traffic.'
    : 'Not connected. Nothing is being sent anywhere.';
}

/**
 * Run `fn` two frames from now: one frame to commit a start value, one to change it, which is what a
 * CSS transition needs to have something to travel from. Where there is no frame clock (a DOM double)
 * it runs now — the end state is the truth, and a test should see it rather than a start value.
 */
function afterNextPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    fn();
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

class OverviewView {
  /** Generation counter for [refresh]: a route open, a launch and a reconnect can all begin one. */
  private refreshes = 0;

  /**
   * The fraction each vital last drew, by ring id. What makes a reading *travel*: the row is rebuilt
   * on every vitals update, and until 2026-09-17 every arc was born at its final offset, so its
   * `stroke-dashoffset` transition had nothing to transition from — the rings never once animated.
   * The new bar now starts where the old one was and moves. An id with no entry starts from empty,
   * which is the one fill a session shows; route changes do not replay it.
   */
  private readonly ringFractions = new Map<string, number>();

  /** Event `seq`s on screen after the last draw. `null` before the first, so first paint is still. */
  private recentSeqs: Set<number> | null = null;

  constructor(
    private readonly bridge: OverviewBridge,
    private readonly recent: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly stripLine: HTMLElement,
    private readonly disconnect: HTMLButtonElement,
    /**
     * `shell.route`. One destination now: every row opens the Activity pane, which is the full
     * history this card shows five of.
     *
     * It took a `settingsPane` second argument while the failure row carried a `View log →` link
     * into Settings → Advanced. That affordance is gone (departure O18) and the parameter went with
     * it rather than being left for a caller that no longer exists — an unused parameter with a
     * plausible name is one autocomplete from a second route nobody decided on.
     */
    private readonly route: (id: string) => void,
    /** O4's Device status rings. Optional so the view test can mount without them. */
    private readonly ringRow: HTMLElement | null = null,
  ) {
    this.disconnect.addEventListener('click', () => void this.bridge.disconnect());
    this.setStatus(false);
  }

  /**
   * Called from `render()` with the same status everything else on the screen reads.
   *
   * `unread` went with Quick actions on 2026-09-16 — it existed only to put "27 new" on the
   * Notifications tile, and the sidebar badge that shows the same number reads it from its own
   * source. `deviceName` went the same way with departure O12. A parameter kept "in case" is a
   * second path to a fact that already has one.
   */
  setStatus(connected: boolean): void {
    this.stripLine.textContent = overviewStripLine(connected);
    this.strip.classList.toggle('is-idle', !connected);
    this.disconnect.disabled = !connected;
  }

  /**
   * O4 — the Device status rings.
   *
   * Drawn as SVG rather than a conic-gradient because **a gradient always paints something**, and
   * the state this card most has to express is *no arc at all*: a phone that has not reported, and
   * a phone that reported it cannot tell us, are both rings with no value — and neither may be
   * drawn as an empty circle that reads as zero.
   */
  setVitals(battery: unknown, storage: unknown): void {
    if (!this.ringRow) return;
    // `deviceVitals.ts` carries no `export`, so its declarations are in the same global scope this
    // file is in — no import, and no `declare` either. A `declare` here was a second signature for
    // one function, which is the two-expressions-of-one-rule trap in its smallest form.
    const rings = deviceStatusRings(
      battery as BatteryState | null,
      storage as StorageState | null,
    );
    this.ringRow.replaceChildren();
    for (const ring of rings) {
      /*
       * **A readout and a bar, not a ring — departure N-P2, 2026-09-17.**
       *
       * Two 72px rings sat in a card nearly 800px wide, with the rest of the card empty, and — until
       * this date — never moved, because the arc was rebuilt at its final value on every update (see
       * `ringFractions`). A ring is a lot of chrome for one number. What is left is the number, set
       * large in the mono face, a label, a 4px bar, and the caption. The row's name (`ring-row`) and
       * the `RingView` rule it reads are kept: the data decision is `deviceVitals.ts`'s and unchanged.
       */
      const cell = document.createElement('div');
      cell.className = 'vital';
      cell.dataset.ring = ring.id;
      // The tone is on the element rather than only in a colour, so a check can read the state
      // without sampling a pixel — and so the CSS has one thing to switch on.
      cell.dataset.tone = ring.tone;

      const head = document.createElement('div');
      head.className = 'vital-head';
      const label = document.createElement('div');
      label.className = 'vital-label';
      label.textContent = ring.label;
      const value = document.createElement('div');
      // Mono: a percentage and a byte size that update in place. The handoff's reason for the face.
      value.className = 'vital-value mono';
      value.textContent = ring.value;
      head.append(label, value);

      const track = document.createElement('div');
      track.className = 'vital-track';
      track.setAttribute('aria-hidden', 'true');
      if (ring.fraction !== null) {
        // No fill element at all for an unknown value: an empty bar reads as zero, and "never
        // reported" is not "flat". The absence of the element IS the state, as it was for the arc.
        const fill = document.createElement('div');
        fill.className = 'vital-fill';
        const to = ring.fraction;
        const from = this.ringFractions.get(ring.id) ?? 0;
        // The inline transform is the animation's start; it is released to the reading two frames
        // later — one to commit the start, one to change it — which is what lets the transition run.
        fill.style.transform = `scaleX(${from})`;
        if (from !== to) {
          afterNextPaint(() => {
            fill.style.transform = `scaleX(${to})`;
          });
        }
        fill.dataset.fraction = String(to);
        this.ringFractions.set(ring.id, to);
        track.appendChild(fill);
      }

      const caption = document.createElement('div');
      caption.className = 'vital-caption';
      caption.textContent = ring.caption;

      cell.append(head, track, caption);
      this.ringRow.appendChild(cell);
    }
  }

  /**
   * Recent activity: the five newest events, and a way to all of them.
   *
   * The departure row for this said it *"needs a session store nothing writes yet"*.
   * `main/activity.ts` became that store on 2026-09-02, so this is that row being discharged rather
   * than a feature being invented.
   *
   * **Its concurrency is stated rather than only its type.** A route open, the launch and a
   * reconnect can each begin one of these, and two correct triggers a frame apart is exactly how
   * the Files pane assembled a wrong picture out of legal states. A run that is no longer the
   * newest discards its own result.
   */
  async refresh(): Promise<void> {
    const mine = ++this.refreshes;
    const result = await this.bridge.activityEvents();
    if (mine !== this.refreshes) return;

    // Where each row was, before the redraw — so rows that stay can slide to where they now are
    // instead of teleporting (FLIP). Keyed by `seq`, never by index: an index would call every row
    // moved and every row new, and the card would animate all five on every event.
    const before = new Map<number, number>();
    for (const node of Array.from(this.recent.children) as HTMLElement[]) {
      const seq = Number(node.dataset?.seq);
      if (Number.isFinite(seq) && typeof node.getBoundingClientRect === 'function') {
        before.set(seq, node.getBoundingClientRect().top);
      }
    }

    this.recent.replaceChildren();
    if (!result.ok || !result.data) {
      const failed = document.createElement('div');
      failed.className = 'recent-empty is-problem';
      // Failed is not empty, and the two are one bug apart everywhere else in this app.
      failed.textContent = 'The activity log could not be read.';
      this.recent.appendChild(failed);
      return;
    }

    // **`activityPage`, not `.slice(0, 5)`** — and the first version was the slice, which took the
    // *oldest* five: the store returns events in insertion order and the Activity pane sorts by
    // `seq` descending before paging. Calling the pager is also the fix that stays fixed, because
    // the card and the pane's first page are now the same expression and cannot come to disagree
    // about what "recent" means.
    const events = activityPage(result.data.events, 'all', 0, 5).rows;
    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent =
        'Nothing yet. Transfers, calls and clipboard syncs appear here as they happen.';
      this.recent.appendChild(empty);
      return;
    }

    const previous = this.recentSeqs;
    this.recentSeqs = new Set(events.map((e) => e.seq));
    for (const event of events) {
      const row = this.recentRow(event);
      row.dataset.seq = String(event.seq);
      // New only if there *was* a previous draw and this row was not in it. First paint stays still.
      if (previous && !previous.has(event.seq)) row.classList.add('is-arriving');
      this.recent.appendChild(row);
    }
    this.settleRecent(before);
  }

  /**
   * Releases the arrival state, and slides surviving rows from their old position to their new one.
   * Everything is `transform` and `opacity`; nothing here changes layout. A no-op without layout
   * (a DOM double), which is why `recentSeqs` and the class — not this — are what a test reads.
   */
  private settleRecent(before: Map<number, number>): void {
    const rows = Array.from(this.recent.children) as HTMLElement[];
    for (const row of rows) {
      const old = before.get(Number(row.dataset?.seq));
      if (old === undefined || typeof row.getBoundingClientRect !== 'function') continue;
      const dy = old - row.getBoundingClientRect().top;
      if (dy !== 0) {
        row.style.transition = 'none';
        row.style.transform = `translateY(${dy}px)`;
      }
    }
    afterNextPaint(() => {
      for (const row of rows) {
        row.classList.remove('is-arriving');
        row.style.transition = '';
        row.style.transform = '';
      }
    });
  }

  /**
   * One activity row: time, tonal icon, two lines, right-hand metadata, chevron.
   *
   * **A `button`, not a `div`, because it genuinely opens something.** Every row routes to the
   * Activity pane, which is the full history this card shows five of — so the chevron is a promise
   * the row keeps, the hover is earned, and the keyboard gets it for free. A row that led nowhere
   * would get neither, whatever the reference drew.
   *
   * The shape of the row is decided in `shared/activity.ts` and read here. That split is the point:
   * which part of an event is a subtitle and which part is metadata is a *rule*, it is the same
   * rule the Activity pane would need, and a copy of it in this file is the second expression that
   * eventually disagrees with the first.
   */
  private recentRow(event: ActivityEvent): HTMLElement {
    const view = activityRowView(event);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recent-row';

    /*
     * **Both clocks, and which one goes where — departure O17, 2026-09-16.**
     *
     * The column is the **absolute** time, which is what the handoff draws in both places it shows
     * activity (`09:42` here, a mono TIME column in the Activity pane). The reported defect was
     * four rows all reading `3m ago`: a relative time is unreadable exactly when several events
     * arrive together, which on this product is most of the time — a call ringing, a call active
     * and a call ended are three rows inside a minute.
     *
     * The **relative** age is not discarded, because it is the more useful of the two at a glance
     * and it is what the previous build showed. It is on the row's accessible name and on its
     * `title`. That ordering is deliberate: the aria-label is the half a keyboard and a screen
     * reader reach, so the age is never behind hover alone — which is the same objection this pass
     * answers for the capability chips.
     */
    const now = Date.now();
    const clock = activityClock(event.at, now);
    const ago = activityWhen(event.at, now);
    // The accessible name is the whole row, in reading order, because a screen reader meets this as
    // one control rather than as five columns. Both clocks, because "09:42" alone makes a reader
    // do the subtraction and "3m ago" alone is the defect.
    const spoken = [`${clock}, ${ago}`, view.title, view.subtitle, view.device]
      .filter(Boolean)
      .join(', ');
    row.setAttribute('aria-label', `${spoken}. Open Activity`);

    const when = document.createElement('span');
    when.className = 'recent-when mono';
    when.textContent = clock;
    when.title = ago;

    const tile = document.createElement('span');
    tile.className = 'recent-tile';
    tile.setAttribute('aria-hidden', 'true');
    // The tint comes from the same table the Activity pane's donut reads, so the two cannot
    // disagree about what colour "files" is.
    tile.style.setProperty('--tint', view.tint);
    // 14px in a 26px tile — the handoff's own `width="14"` inside its 26px square.
    tile.appendChild(iconSvg(view.icon, 14));

    const main = document.createElement('span');
    main.className = 'recent-main';
    const title = document.createElement('span');
    title.className = 'recent-text';
    title.textContent = view.title;
    main.appendChild(title);
    if (view.subtitle) {
      const sub = document.createElement('span');
      sub.className = 'recent-detail';
      sub.textContent = view.subtitle;
      main.appendChild(sub);
    }

    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    if (view.device) {
      const device = document.createElement('span');
      device.className = 'recent-device';
      device.appendChild(iconSvg('phone', 14));
      const name = document.createElement('span');
      name.textContent = view.device;
      device.appendChild(name);
      meta.appendChild(device);
    }
    if (view.badge) {
      const badge = document.createElement('span');
      badge.className = 'recent-badge mono';
      badge.textContent = view.badge;
      meta.appendChild(badge);
    }
    /*
     * **There is no `View log →` here any more — departure O18, 2026-09-16.**
     *
     * One row in five carried a text link *beside* the chevron every row already has, so the list
     * had two affordance vocabularies and the failure row was the odd one. The handoff's rows carry
     * neither: a mono time, a tinted icon, a description and a right-aligned detail, and nothing to
     * click at the row's end at all.
     *
     * **Nothing became unreachable.** The link went to Settings → Advanced, which is where
     * `logTail` is drawn, and it is reachable from the sidebar, from ⌘K, and from the Activity pane
     * this row's chevron opens. That was checked before the affordance was removed, on the same
     * rule that had it drawn in the first place — an affordance is added when it has a destination
     * and removed when the destination has another route, never removed on tidiness.
     */

    const chevron = iconSvg('chevron', 16);
    chevron.setAttribute('class', 'recent-chevron');

    row.append(when, tile, main, meta, chevron);
    row.addEventListener('click', () => this.route('activity'));
    return row;
  }
}

// The seam: the class and its one remaining pure decision, for `overviewView.test.ts`.
(globalThis as Record<string, unknown>).OverviewView = OverviewView;
(globalThis as Record<string, unknown>).overviewStripLine = overviewStripLine;
