/**
 * The Activity screen.
 *
 * The design's artboard is a filtered, paged table with a summary rail — a donut, a seven-day
 * sparkline, and an export button. What it does not draw is any state other than *nine rows and a
 * pager*, and this pane is in one of five (`shared/activity.ts`). The two that matter most are
 * A3 and A4: **nothing has ever happened** and **nothing matches this filter** are different
 * sentences, and the design's artboard would render them as the same blank table.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts. Every decision
 * worth asserting lives in `shared/activity.ts` and is tested there; this file is the drawing, and
 * it is deliberately thin so that "what the pane decided" and "what the pane painted" cannot drift.
 */

interface ActivityBridgeResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
}

interface ActivityBridge {
  activityEvents(): Promise<
    ActivityBridgeResult<{
      events: ActivityEvent[];
      error: string | null;
      stats: { read: number; skipped: number; recorded: number; dropped: number };
    }>
  >;
  activityExportCsv(): Promise<ActivityBridgeResult<{ path: string }>>;
}

const ACTIVITY_PAGE_SIZE = 9;

class ActivityView {
  private fetch: ActivityFetch = { kind: 'idle' };
  private filter: ActivityCategory | 'all' = 'all';
  private page = 0;
  private stats = { read: 0, skipped: 0, recorded: 0, dropped: 0 };
  /**
   * Set while a fetch is in flight so a second caller **joins the run** rather than starting one.
   *
   * The Files pane reached the one state its tagged union existed to make impossible by having a
   * route open and a capability arrive within a frame of each other, both calling `refresh()`.
   * This pane has the same two triggers. `CLAUDE.md`: *anything that can be triggered by more than
   * one event needs its concurrency stated, not just its type.*
   */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly bridge: ActivityBridge,
    private readonly host: HTMLElement,
  ) {}

  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async run(): Promise<void> {
    // Only the first load shows a spinner. A refresh over a drawn table that blanks it and redraws
    // it is a flicker that reads as a bug, and the table it replaces is not stale enough to matter.
    if (this.fetch.kind === 'idle') {
      this.fetch = { kind: 'loading' };
      this.draw();
    }
    const result = await this.bridge.activityEvents();
    if (!result.ok || !result.data) {
      this.fetch = { kind: 'failed', reason: result.reason ?? 'The activity log could not be read.' };
    } else if (result.data.error) {
      // The store's own read error, carried beside the events rather than instead of them. This is
      // the branch that keeps A2 apart from A3 at the IPC boundary.
      this.fetch = { kind: 'failed', reason: result.data.error };
    } else {
      this.fetch = { kind: 'ready', events: result.data.events };
      this.stats = result.data.stats;
    }
    this.draw();
  }

  private setFilter(next: ActivityCategory | 'all'): void {
    this.filter = next;
    this.page = 0;
    this.draw();
  }

  private draw(): void {
    const events = this.fetch.kind === 'ready' ? this.fetch.events : [];
    const paged = activityPage(events, this.filter, this.page, ACTIVITY_PAGE_SIZE);
    this.page = paged.page;
    const view = activityPaneView(this.fetch, this.filter, paged.matched);

    const layout = document.createElement('div');
    layout.className = 'activity-layout';

    const main = document.createElement('section');
    main.className = 'card activity-main';

    // The chip row is drawn in every state except the two that have nothing to filter. In A4 it is
    // the way out — a card that says "no Calls activity" above a row with no All chip would be a
    // dead end, which is one of the four differences A3 and A4 are asserted to have.
    if (this.fetch.kind === 'ready' && events.length > 0) main.appendChild(this.chips(events));

    if (view.showsTable) {
      main.appendChild(this.table(paged.rows));
      main.appendChild(this.pager(paged));
    } else {
      main.appendChild(this.stateCard(view));
    }

    layout.appendChild(main);
    if (view.showsTable) layout.appendChild(this.rail(events));
    this.host.replaceChildren(layout);
  }

  /**
   * The filter chips, with counts.
   *
   * A chip is drawn for a category **only when the log contains one**, plus `All` always. A chip
   * that is permanently empty is a filter offering a state the user cannot reach anything through,
   * and the count is what stops the chip itself becoming another empty/absent ambiguity: `Calls 0`
   * would be indistinguishable from a Calls chip over a log this Mac has never recorded a call in.
   */
  private chips(events: ActivityEvent[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'activity-chips';

    const present = ACTIVITY_CATEGORIES.filter((c) => events.some((e) => e.category === c));
    const options: { id: ActivityCategory | 'all'; label: string; count: number }[] = [
      { id: 'all', label: 'All', count: events.length },
      ...present.map((c) => ({
        id: c,
        label: CATEGORY_LABELS[c],
        count: events.filter((e) => e.category === c).length,
      })),
    ];

    for (const option of options) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `activity-chip${option.id === this.filter ? ' is-active' : ''}`;
      chip.setAttribute('aria-pressed', String(option.id === this.filter));
      const label = document.createElement('span');
      label.textContent = option.label;
      const count = document.createElement('span');
      count.className = 'activity-chip-count mono';
      count.textContent = String(option.count);
      chip.append(label, count);
      chip.addEventListener('click', () => this.setFilter(option.id));
      row.appendChild(chip);
    }
    return row;
  }

  private table(rows: ActivityEvent[]): HTMLElement {
    const table = document.createElement('div');
    table.className = 'activity-table';

    const head = document.createElement('div');
    head.className = 'activity-head';
    for (const column of ['ACTIVITY', 'DETAILS', 'TIME']) {
      const cell = document.createElement('span');
      cell.textContent = column;
      head.appendChild(cell);
    }
    table.appendChild(head);

    const now = Date.now();
    for (const event of rows) {
      const line = document.createElement('div');
      line.className = 'activity-row';

      const kind = document.createElement('span');
      kind.className = 'activity-kind';
      const dot = document.createElement('span');
      dot.className = 'activity-dot';
      dot.style.setProperty('--tint', CATEGORY_TINTS[event.category] ?? 'var(--tint-grey-rgb)');
      const kindText = document.createElement('span');
      kindText.textContent = event.kind;
      kind.append(dot, kindText);

      const detail = document.createElement('span');
      detail.className = 'activity-detail';
      // textContent, never innerHTML: a detail can carry a file name somebody else chose.
      detail.textContent = event.detail;
      detail.title = event.detail;

      const when = document.createElement('span');
      when.className = 'activity-time mono';
      when.textContent = activityWhen(event.at, now);
      // The relative label is what the design draws; the absolute one is what somebody comparing
      // this against the phone's log needs, and it costs a tooltip rather than a column.
      when.title = new Date(event.at).toString();

      line.append(kind, detail, when);
      table.appendChild(line);
    }
    return table;
  }

  private pager(paged: ActivityPage): HTMLElement {
    const foot = document.createElement('div');
    foot.className = 'activity-foot';

    const count = document.createElement('span');
    count.className = 'activity-count';
    const filtered = this.filter === 'all' ? '' : ` ${CATEGORY_LABELS[this.filter]}`;
    // "Showing 9 of 48" with a filter on is a claim about the wrong denominator — this says which.
    count.textContent =
      `Showing ${paged.rows.length} of ${paged.matched}${filtered} event${paged.matched === 1 ? '' : 's'}` +
      (paged.matched === paged.total ? '' : ` · ${paged.total} in all`);
    foot.appendChild(count);

    if (paged.pageCount > 1) {
      // A fixed number of controls whatever the history's length — `activityPager` decides which.
      const pager = activityPager(paged.pageCount, paged.page);
      const pages = document.createElement('div');
      pages.className = 'activity-pages';
      pages.setAttribute('role', 'navigation');
      pages.setAttribute('aria-label', 'Activity pages');
      const go = (index: number) => () => {
        this.page = index;
        this.draw();
      };
      const step = (label: string, glyph: string, target: number | null): HTMLButtonElement => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'activity-step';
        button.textContent = glyph;
        button.setAttribute('aria-label', label);
        button.disabled = target === null;
        if (target !== null) button.addEventListener('click', go(target));
        return button;
      };
      pages.appendChild(step('Previous page', '‹', pager.prev));
      for (const item of pager.items) {
        if (item.kind === 'gap') {
          const gap = document.createElement('span');
          gap.className = 'activity-gap';
          gap.textContent = '…';
          gap.setAttribute('aria-hidden', 'true');
          pages.appendChild(gap);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `activity-page${item.current ? ' is-active' : ''}`;
        button.textContent = String(item.index + 1);
        button.setAttribute('aria-current', item.current ? 'page' : 'false');
        button.addEventListener('click', go(item.index));
        pages.appendChild(button);
      }
      pages.appendChild(step('Next page', '›', pager.next));
      foot.appendChild(pages);
    }
    return foot;
  }

  /** The summary rail: the donut, the sparkline, and export. */
  private rail(events: ActivityEvent[]): HTMLElement {
    const rail = document.createElement('aside');
    rail.className = 'activity-rail';

    const now = Date.now();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const summary = activitySummary(events, midnight.getTime());

    const today = document.createElement('section');
    today.className = 'card activity-summary';
    const title = document.createElement('h3');
    title.textContent = 'Today';
    today.appendChild(title);

    if (summary.total === 0) {
      // The one honest thing to draw over a zero total. A donut with no arcs and a `0` in the
      // middle is a chart of nothing that still looks like a chart.
      const none = document.createElement('p');
      none.className = 'activity-empty-note';
      none.textContent = 'Nothing yet today. The table below covers everything on record.';
      today.appendChild(none);
    } else {
      today.appendChild(this.donut(summary));
      const legend = document.createElement('div');
      legend.className = 'activity-legend';
      for (const slice of summary.slices) {
        const row = document.createElement('div');
        const swatch = document.createElement('span');
        swatch.className = 'activity-dot';
        swatch.style.setProperty('--tint', slice.tint);
        const name = document.createElement('span');
        name.textContent = slice.label;
        const value = document.createElement('span');
        value.className = 'mono';
        value.textContent = String(slice.count);
        row.append(swatch, name, value);
        legend.appendChild(row);
      }
      today.appendChild(legend);
    }
    rail.appendChild(today);

    rail.appendChild(this.sparkline(activityDaily(events, 7, now)));

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'btn activity-export';
    exportButton.textContent = 'Export log as CSV';
    exportButton.addEventListener('click', () => {
      void this.bridge.activityExportCsv().then((result) => {
        // A cancelled save dialog is not a failure and must not report one.
        if (result.ok && result.data) exportButton.textContent = 'Exported';
        else if (result.reason && result.reason !== 'cancelled') exportButton.textContent = 'Export failed';
        setTimeout(() => {
          exportButton.textContent = 'Export log as CSV';
        }, 2400);
      });
    });
    rail.appendChild(exportButton);

    const foot = document.createElement('p');
    foot.className = 'activity-stats mono';
    // The skipped count with its denominator, per the code rules — on its own it reads as a broken
    // file, and beside the number read it reads as what it usually is: a half-written last line.
    foot.textContent =
      `${this.stats.read} read / ${this.stats.skipped} unreadable · ` +
      `${this.stats.recorded} recorded / ${this.stats.dropped} dropped this session`;
    rail.appendChild(foot);

    return rail;
  }

  private donut(summary: ActivitySummary): SVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'activity-donut');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `${summary.total} events today: ${summary.slices.map((s) => `${s.label} ${s.count}`).join(', ')}`,
    );

    const radius = 48;
    const circumference = 2 * Math.PI * radius;

    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('cx', '60');
    track.setAttribute('cy', '60');
    track.setAttribute('r', String(radius));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--hairline)');
    track.setAttribute('stroke-width', '12');
    svg.appendChild(track);

    let offset = 0;
    for (const slice of summary.slices) {
      const fraction = slice.count / summary.total;
      const arc = document.createElementNS(ns, 'circle');
      arc.setAttribute('cx', '60');
      arc.setAttribute('cy', '60');
      arc.setAttribute('r', String(radius));
      arc.setAttribute('fill', 'none');
      arc.style.setProperty('--tint', slice.tint);
      arc.setAttribute('class', 'activity-arc');
      arc.setAttribute('stroke-width', '12');
      arc.setAttribute('stroke-linecap', 'butt');
      arc.setAttribute('stroke-dasharray', `${fraction * circumference} ${circumference}`);
      arc.setAttribute('transform', `rotate(${-90 + offset * 360} 60 60)`);
      svg.appendChild(arc);
      offset += fraction;
    }

    const total = document.createElementNS(ns, 'text');
    total.setAttribute('x', '60');
    total.setAttribute('y', '58');
    total.setAttribute('text-anchor', 'middle');
    total.setAttribute('class', 'activity-donut-total');
    total.textContent = String(summary.total);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '60');
    label.setAttribute('y', '73');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'activity-donut-label');
    label.textContent = 'EVENTS';
    svg.append(total, label);
    return svg;
  }

  private sparkline(days: ActivityDay[]): HTMLElement {
    const ns = 'http://www.w3.org/2000/svg';
    const card = document.createElement('section');
    card.className = 'card activity-summary';
    const title = document.createElement('h3');
    title.textContent = 'Last 7 days';
    card.appendChild(title);

    const peak = Math.max(1, ...days.map((d) => d.count));
    const width = 280;
    const height = 120;
    const points = days.map((day, index) => {
      const x = 8 + (index * (width - 16)) / Math.max(1, days.length - 1);
      const y = 104 - (day.count / peak) * 84;
      return { x, y, day };
    });

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'activity-spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `Events per day: ${days.map((d) => `${d.day}: ${d.count}`).join(', ')}`,
    );
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('stroke-width', '2.2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
    card.appendChild(svg);

    const axis = document.createElement('div');
    axis.className = 'activity-axis mono';
    for (const day of days) {
      const tick = document.createElement('span');
      tick.textContent = String(day.day);
      axis.appendChild(tick);
    }
    card.appendChild(axis);

    // The peak is printed because a sparkline with no scale is a shape, not a measurement — the
    // same rule as a count with no denominator. Without it, one event a day and a hundred a day
    // draw the identical line.
    const scale = document.createElement('p');
    scale.className = 'activity-stats mono';
    scale.textContent = `peak ${peak} event${peak === 1 ? '' : 's'} in a day`;
    card.appendChild(scale);
    return card;
  }

  private stateCard(view: ActivityPaneView): HTMLElement {
    const card = document.createElement('div');
    card.className = `activity-state activity-state--${view.tone}`;
    card.dataset.state = view.id;

    const headline = document.createElement('h2');
    headline.className = 'activity-state-headline';
    headline.textContent = view.headline;
    card.appendChild(headline);

    for (const paragraph of view.body) {
      const p = document.createElement('p');
      p.className = 'activity-state-body';
      p.textContent = paragraph;
      card.appendChild(p);
    }

    if (view.retry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => {
        this.fetch = { kind: 'idle' };
        void this.refresh();
      });
      card.appendChild(retry);
    }
    return card;
  }
}

// The pure half is in shared/activity.ts and is tested there. The view class is hung on
// `globalThis` the way `ClipboardView` is, so `activityView.test.ts` drives the real class against
// the DOM double rather than a paraphrase of it — the seam rule, applied to the half that draws.
(globalThis as Record<string, unknown>).ActivityView = ActivityView;
(globalThis as Record<string, unknown>).ACTIVITY_PAGE_SIZE = ACTIVITY_PAGE_SIZE;
