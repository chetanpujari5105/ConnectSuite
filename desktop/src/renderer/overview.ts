/**
 * Overview's three additions: **Quick actions**, **Recent activity**, and the footer strip.
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
 * The handoff's eight Quick actions, in the handoff's order.
 *
 * **Ids only.** Everything else — label, icon, subtitle, whether it is built — is read from
 * `navModel.SCREENS`, the same table the sidebar, the dock and the palette read. Eight hand-written
 * tiles would be a second list, and the day a screen is renamed the second list is the wrong one.
 */
const QUICK_ACTION_IDS = [
  'mirror',
  'files',
  'photos',
  'notifications',
  'messages',
  'clipboard',
  'calls',
  'camera',
] as const;

/**
 * The tile's second line.
 *
 * A **live number** where there is one — the design's own *"3 new"* on the Notifications tile — and
 * the screen's own subtitle otherwise. The subtitle is reused rather than a second set of captions
 * being written here, for the same reason the ids are read from the table: a caption written in
 * this file is a claim about a screen, made somewhere the screen cannot correct it.
 *
 * The unread count is drawn **only above zero**. A tile reading "0 new" is a count nobody needs,
 * and it is the rule the sidebar badge already follows.
 */
function quickTileSub(
  screen: { id: string; subtitle: string; state: string },
  unread: number,
): string {
  if (screen.state !== 'built') return 'Not built yet';
  if (screen.id === 'notifications' && unread > 0) return `${unread} new`;
  return screen.subtitle;
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
 */
function overviewStripLine(connected: boolean, deviceName: string | null): string {
  return connected
    ? `Encrypted end to end with ${deviceName ?? 'your phone'}. The traffic never leaves your ` +
        'network, and only these two devices can read it.'
    : 'Not connected. Nothing is being sent anywhere.';
}

class OverviewView {
  /** Generation counter for [refresh]: a route open, a launch and a reconnect can all begin one. */
  private refreshes = 0;

  constructor(
    private readonly bridge: OverviewBridge,
    private readonly grid: HTMLElement,
    private readonly count: HTMLElement,
    private readonly recent: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly stripLine: HTMLElement,
    private readonly disconnect: HTMLButtonElement,
    private readonly route: (id: string) => void,
  ) {
    this.disconnect.addEventListener('click', () => void this.bridge.disconnect());
    this.setStatus(false, null, 0);
  }

  /** Called from `render()` with the same status everything else on the screen reads. */
  setStatus(connected: boolean, deviceName: string | null, unread: number): void {
    this.drawQuickActions(unread);
    this.stripLine.textContent = overviewStripLine(connected, deviceName);
    this.strip.classList.toggle('is-idle', !connected);
    this.disconnect.disabled = !connected;
  }

  private drawQuickActions(unread: number): void {
    this.grid.replaceChildren();
    let built = 0;
    for (const id of QUICK_ACTION_IDS) {
      const screen = SCREENS.find((s) => s.id === id);
      if (!screen) continue;
      if (screen.state === 'built') built += 1;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = screen.state === 'built' ? 'quick-tile' : 'quick-tile is-unbuilt';
      // The accessible name says which it is, exactly as the sidebar row does. A tile that reads
      // "Camera" to a screen reader and is greyed to everyone else carries the state in one
      // channel — which is defect 26, one pane over.
      tile.setAttribute(
        'aria-label',
        screen.state === 'built' ? screen.label : `${screen.label} — not built yet`,
      );
      if (screen.state !== 'built' && screen.unbuiltReason) tile.title = screen.unbuiltReason;

      const glyph = document.createElement('span');
      glyph.className = `quick-glyph tint-${screen.id}`;
      glyph.setAttribute('aria-hidden', 'true');
      glyph.replaceChildren(iconSvg(screen.icon, 18));

      const lines = document.createElement('span');
      lines.className = 'quick-lines';
      const name = document.createElement('span');
      name.className = 'quick-name';
      name.textContent = screen.label;
      const sub = document.createElement('span');
      sub.className = 'quick-sub';
      sub.textContent = quickTileSub(screen, unread);
      lines.append(name, sub);

      tile.append(glyph, lines);
      // **Marked, not removed** — state A's rule. Removing Camera leaves a seven-tile grid that
      // reflows the day it ships; a marked tile carries the same information and the composition
      // stops moving. It still routes, because the unbuilt screen draws its own reason.
      tile.addEventListener('click', () => this.route(screen.id));
      this.grid.appendChild(tile);
    }
    // The design's "8 available" is a count of *tiles*. Ours is a count of the ones that **work**,
    // with the total beside it, because the two numbers differ here and a bare 8 over a grid with a
    // dead tile in it is the denominator rule with the denominator taken out.
    this.count.textContent = `${built} of ${QUICK_ACTION_IDS.length} available`;
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

    for (const event of events) {
      const row = document.createElement('div');
      row.className = 'recent-row';

      const when = document.createElement('span');
      when.className = 'recent-when mono';
      when.textContent = activityWhen(event.at, Date.now());

      const dot = document.createElement('span');
      dot.className = 'recent-dot';
      dot.setAttribute('aria-hidden', 'true');
      // The category tints live in `shared/activity.ts` and are read from there, so this card and
      // the Activity pane's donut cannot disagree about what colour "files" is.
      dot.style.background = `rgba(${CATEGORY_TINTS[event.category] ?? '156,159,176'}, 0.4)`;

      const text = document.createElement('span');
      text.className = 'recent-text';
      text.textContent = event.kind;

      const detail = document.createElement('span');
      detail.className = 'recent-detail';
      detail.textContent = event.detail;

      row.append(when, dot, text, detail);
      this.recent.appendChild(row);
    }
  }
}

// The seam: the class and its two pure decisions, for `overviewView.test.ts`.
(globalThis as Record<string, unknown>).OverviewView = OverviewView;
(globalThis as Record<string, unknown>).quickTileSub = quickTileSub;
(globalThis as Record<string, unknown>).overviewStripLine = overviewStripLine;
(globalThis as Record<string, unknown>).QUICK_ACTION_IDS = QUICK_ACTION_IDS;
