/**
 * The Activity screen's data model: what an event is, how the pane filters, pages and summarises
 * them, and which of the pane's states a given fetch is in.
 *
 * Electron-free on purpose — this is the testable seam, and the decisions worth asserting all live
 * here rather than in the renderer that draws them.
 *
 * ### The paging cursor is a sequence number, and that is a design choice rather than an achievement
 *
 * `media.list` needed a `(date, id)` tiebreak because two photos can share a `DATE_ADDED` second,
 * and `CLAUDE.md` records what it cost to prove that the tiebreak was load-bearing. This store has
 * no such problem, and the honest reason is not that it was solved: **the store assigns its own
 * monotonic `seq` and pages on that**, so two events in the same millisecond are still strictly
 * ordered and there is no tie to break. It is worth saying because the alternative — paging on `at`
 * and calling the result correct because the pages summed — is exactly the run that would have
 * looked identical with the tiebreak deleted.
 *
 * ### Five states, not four, and the fifth is the one the design does not draw
 *
 * *No events at all* and *no events matching this filter* are different sentences. A user who
 * clicks **Files** on a busy log and sees the same card they would see on a fresh install cannot
 * tell "nothing has been transferred" from "nothing has been recorded, ever". That is defect
 * 24/26's shape inside a single pane, and the design's Activity artboard has no state for either —
 * it draws nine rows and a pager. See `docs/design-departures.md` §Activity, A2.
 */

/**
 * The categories the pane filters by.
 *
 * The design draws five chips — Mirroring, Files, Messages, Calls, System — and `clipboard` is the
 * sixth. It is not folded into `system`, because a filter that does not find the thing its user is
 * looking for is worse than one more chip; it is recorded as a departure instead.
 */
type ActivityCategory = 'mirroring' | 'files' | 'messages' | 'calls' | 'clipboard' | 'system';

/** The design's chip order, with the one addition appended rather than inserted. */
const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  'mirroring',
  'files',
  'messages',
  'calls',
  'clipboard',
  'system',
];

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  mirroring: 'Mirroring',
  files: 'Files',
  messages: 'Messages',
  calls: 'Calls',
  clipboard: 'Clipboard',
  system: 'System',
};

/**
 * The badge tone of one event — **the event's own**, not its category's (departure D23).
 *
 * The six category tints this replaces were the last per-category hue in the app (D2): violet for
 * mirroring, blue for files, pink for clipboard. They said which *kind* of thing happened, which the
 * glyph and the words already say, and they spent the four colours that mean something.
 *
 * The handoff's rule: *"Badges are neutral charcoal unless the event itself was a connection coming
 * up (lime), a real limitation (amber) or a real failure (red)."* So:
 *
 *  - **connected** — the link came up. The one lime thing in the list.
 *  - **failure** — something the user asked for did not happen: `Save failed`, `Send failed`,
 *    `Screenshot failed`, and a disconnect whose own detail says the connection failed.
 *  - **warning** — a refusal or a partial: `Send refused`, `Pairing refused`, `Phone did not apply
 *    it`. The phone answered and the answer was no, which is a limitation rather than a breakage.
 *  - **neutral** — everything else, which is most of it.
 *
 * Matched on the kinds `main/activity.ts` actually writes, and read from the *words* only where the
 * kind alone cannot tell: `Disconnected` is a fact, and whether it was a failure is in its detail.
 */
type ActivityTone = 'connected' | 'warning' | 'failure' | 'neutral';

function activityTone(event: { kind: string; detail?: string }): ActivityTone {
  if (ACTIVITY_CONNECTED_KINDS.has(event.kind)) return 'connected';
  if (/failed|failure/i.test(event.kind)) return 'failure';
  if (/refused|did not|declined|rejected/i.test(event.kind)) return 'warning';
  if (event.kind === 'Disconnected' && /fail|error|dropp/i.test(event.detail ?? '')) return 'failure';
  return 'neutral';
}

/**
 * The busiest hour of a window, as a fact rather than a chart (D9): *"most activity between 09:00
 * and 10:00 — 23 events"*. Null when there is nothing to describe, because a busiest hour over an
 * empty log is a sentence about nothing.
 */
function activityBusiestHour(
  events: ReadonlyArray<{ at: number }>,
  sinceMs: number,
): { hour: number; count: number } | null {
  const buckets = new Map<number, number>();
  for (const event of events) {
    if (event.at < sinceMs) continue;
    const hour = new Date(event.at).getHours();
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }
  let best: { hour: number; count: number } | null = null;
  for (const [hour, count] of buckets) {
    // `>` keeps the earliest hour on a tie, which is stable as the day fills rather than jumping
    // between two equal hours on every redraw.
    if (!best || count > best.count) best = { hour, count };
  }
  return best;
}

interface ActivityEvent {
  /** Monotonic within one store. The paging cursor and the tiebreak-that-is-not-needed. */
  seq: number;
  /** Epoch milliseconds, local clock. Displayed; never used for ordering. */
  at: number;
  category: ActivityCategory;
  /** The ACTIVITY column: a short verb phrase. Never a package id on its own. */
  kind: string;
  /** The DETAILS column. May be empty — some events are entirely described by their kind. */
  detail: string;
}

/** What the last read of the event log did. */
type ActivityFetch =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: ActivityEvent[] }
  | { kind: 'failed'; reason: string };

/** The five states, as ids, so the tests and `docs/design-departures.md` use the same names. */
type ActivityStateId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

interface ActivityPaneView {
  id: ActivityStateId;
  /** True only for A5 — the one state where the table, pager and summary are drawn. */
  showsTable: boolean;
  headline: string;
  body: string[];
  tone: 'neutral' | 'warning';
  icon: 'activity' | 'alert' | 'spinner';
  /** Only the failed state offers one. One of the four A3/A4 differences. */
  retry: boolean;
}

/**
 * Which state the pane is in, given the fetch and the active filter.
 *
 * A3 (nothing recorded) and A4 (nothing matching) are the pair this exists to keep apart, and they
 * differ in **four independent ways** — headline verb, body, whether a filter name appears, and
 * whether the chip row still offers a way out — so removing any one of them fails a test rather
 * than quietly merging two states into one picture. The same discipline as `filesRoots.ts`, for the
 * same reason.
 */
function activityPaneView(
  fetch: ActivityFetch,
  filter: ActivityCategory | 'all',
  matched: number,
): ActivityPaneView {
  if (fetch.kind === 'idle' || fetch.kind === 'loading') {
    return {
      id: 'A1',
      showsTable: false,
      headline: 'Reading the activity log',
      body: [],
      tone: 'neutral',
      icon: 'spinner',
      retry: false,
    };
  }
  if (fetch.kind === 'failed') {
    return {
      id: 'A2',
      showsTable: false,
      headline: 'The activity log could not be read',
      body: [
        fetch.reason,
        'Nothing has been lost on the phone — this is the Mac’s own record of what it did.',
      ],
      tone: 'warning',
      icon: 'alert',
      retry: true,
    };
  }
  if (fetch.events.length === 0) {
    return {
      id: 'A3',
      showsTable: false,
      headline: 'Nothing has happened yet',
      body: [
        'This Mac records what it does with your phone — connections, mirroring sessions, ' +
          'transfers, messages and clipboard entries — and it has not done any of them yet.',
      ],
      tone: 'neutral',
      icon: 'activity',
      retry: false,
    };
  }
  if (matched === 0) {
    const label = filter === 'all' ? 'this filter' : CATEGORY_LABELS[filter];
    return {
      id: 'A4',
      showsTable: false,
      headline: `No ${label} activity in this log`,
      body: [
        `There are ${fetch.events.length} recorded events, and none of them are ${label} ones. ` +
          'Choose All to see the rest.',
      ],
      tone: 'neutral',
      icon: 'activity',
      retry: false,
    };
  }
  return {
    id: 'A5',
    showsTable: true,
    headline: '',
    body: [],
    tone: 'neutral',
    icon: 'activity',
    retry: false,
  };
}

interface ActivityPage {
  rows: ActivityEvent[];
  /** How many events match the filter. The denominator in "Showing 9 of 48". */
  matched: number;
  /** How many events exist at all, regardless of filter. */
  total: number;
  pageCount: number;
  /** Clamped: a filter change that shortens the list must not strand the pager past the end. */
  page: number;
}

/**
 * One page of the table, newest first.
 *
 * [page] is clamped rather than trusted. Switching from **All** on page 3 to **Calls** with four
 * calls in the log would otherwise render an empty table with a pager insisting there are three
 * pages — an empty state produced by arithmetic, which is the one kind nothing above would catch
 * because the fetch succeeded and the filter matched.
 */
function activityPage(
  events: ActivityEvent[],
  filter: ActivityCategory | 'all',
  page: number,
  pageSize: number,
): ActivityPage {
  const matching =
    filter === 'all' ? events : events.filter((event) => event.category === filter);
  const ordered = [...matching].sort((a, b) => b.seq - a.seq);
  const pageCount = Math.max(1, Math.ceil(ordered.length / Math.max(1, pageSize)));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  return {
    rows: ordered.slice(clamped * pageSize, clamped * pageSize + pageSize),
    matched: ordered.length,
    total: events.length,
    pageCount,
    page: clamped,
  };
}

/** One slot in the compact pager: a page to jump to, or a gap standing for pages not drawn. */
type ActivityPagerItem = { kind: 'page'; index: number; current: boolean } | { kind: 'gap' };

interface ActivityPager {
  /** The page Previous goes to, or `null` on the first page. */
  prev: number | null;
  /** The page Next goes to, or `null` on the last page. */
  next: number | null;
  items: ActivityPagerItem[];
}

/**
 * Which page controls to draw, so the pager has a fixed ceiling however long the history is.
 *
 * It drew one button per page, and that was fine at 18 pages. The ConnectSuite history merge took
 * this Mac to ~223, and the row ran out of the card and under *Export log as CSV*. So: the first
 * and last page always, the current page with `neighbours` either side, and a gap for each run
 * that is left out. A gap that would hide exactly one page shows that page instead — an ellipsis
 * standing for one number costs the same room and hides it. That caps the slots at
 * `2 * neighbours + 5` for any page count. Pages are 0-based here, as everywhere in this file.
 */
function activityPager(pageCount: number, current: number, neighbours = 1): ActivityPager {
  const count = Math.max(1, Math.floor(pageCount));
  const at = Math.min(Math.max(0, Math.floor(current)), count - 1);
  const shown = new Set<number>([0, count - 1]);
  for (let i = at - neighbours; i <= at + neighbours; i += 1) {
    if (i >= 0 && i < count) shown.add(i);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  const items: ActivityPagerItem[] = [];
  for (let k = 0; k < sorted.length; k += 1) {
    const index = sorted[k]!;
    if (k > 0) {
      const previous = sorted[k - 1]!;
      if (index - previous === 2) items.push({ kind: 'page', index: previous + 1, current: previous + 1 === at });
      else if (index - previous > 2) items.push({ kind: 'gap' });
    }
    items.push({ kind: 'page', index, current: index === at });
  }
  return {
    prev: at > 0 ? at - 1 : null,
    next: at < count - 1 ? at + 1 : null,
    items,
  };
}

interface ActivitySummarySlice {
  category: ActivityCategory;
  label: string;
  count: number;
}

interface ActivitySummary {
  total: number;
  slices: ActivitySummarySlice[];
}

/**
 * The donut's numbers, over events at or after [sinceMs].
 *
 * Every category with a non-zero count appears; a category with none does **not**, because a legend
 * row reading `Calls 0` next to a donut with no calls arc in it is a row that says nothing and
 * takes the eye. The design draws four legend rows for four non-zero categories, which is this rule
 * with the data it happened to have.
 */
function activitySummary(events: ActivityEvent[], sinceMs: number): ActivitySummary {
  const within = events.filter((event) => event.at >= sinceMs);
  const slices = ACTIVITY_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    count: within.filter((event) => event.category === category).length,
  })).filter((slice) => slice.count > 0);
  return { total: within.length, slices };
}

interface ActivityDay {
  /** Local day-of-month, the design's axis labels. */
  day: number;
  count: number;
}


/**
 * The whole log as CSV, for the design's **Export log as CSV** button.
 *
 * Quoting is not optional here and is the reason this is a function rather than a `join`: a
 * clipboard entry's detail, an SMS body or a file name can contain a comma, a quote or a newline,
 * and a CSV that breaks on the first one is a export that silently loses rows. Every field is
 * quoted and internal quotes are doubled, which is RFC 4180 and what Numbers and Excel both read.
 */
function activityCsv(events: ActivityEvent[]): string {
  const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const iso = (at: number): string => new Date(at).toISOString();
  const lines = [['seq', 'time', 'category', 'activity', 'details'].map(cell).join(',')];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    lines.push(
      [
        String(event.seq),
        iso(event.at),
        event.category,
        event.kind,
        event.detail,
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Relative time for the TIME column: the design shows "2m ago", "Yesterday 18:04". */
/**
 * One Recent-activity row, as the card needs to draw it.
 *
 * ### Why this is a rule and not four `if`s in the renderer
 *
 * `ActivityEvent` carries **one** `detail` field, and the card needs two different things out of
 * it: a *subtitle* (a sentence about what happened) and *metadata* (the device it happened to, the
 * version it happened in). Which one a given `detail` is depends entirely on the event —
 * `Connected`'s detail is a device name, `Disconnected`'s is a sentence, `Sidekick started`'s
 * is a version string.
 *
 * **The discriminator is `kind`, never the shape of the text.** Sniffing `detail` for something
 * that looks like a device name or a version number is the lookalike failure this repo has a table
 * about: `Samsung SM-S938B` and `2735 bytes, automatically` are both "a short string with digits
 * in it", and the rule would be wrong on the first transfer event. `kind` is written by
 * `main/activity.ts` at eleven named recording sites and is the only field that says what happened.
 *
 * ### What it will not do
 *
 * It does not invent a device name for an event that has none. The reference for this card shows
 * one on the Disconnected row; the event does not carry it, and the *current* device name is a fact
 * about now rather than about a disconnection five minutes ago. A historical row asserting today's
 * device is the stale-reading failure, drawn. So that row gets its sentence and no device.
 *
 * It also does not draw a **failure colour on a past event** — departure O7, 2026-09-16. See the
 * `Disconnected` branch below for the argument.
 */
interface ActivityRowView {
  /** An `icons.ts` name. */
  icon: string;
  /** The event's own tone — see `activityTone`. Lime, amber and red are earned; most rows are not. */
  tone: ActivityTone;
  /** Line one. Always `event.kind` — the store's own verb phrase. */
  title: string;
  /** Line two. A sentence; empty when the event is entirely described by its kind. */
  subtitle: string;
  /** Right-hand metadata: the device this happened to, when the event names one. */
  device: string;
  /** Right-hand metadata: a small badge, e.g. `v2.0.0`. */
  badge: string;
}

/** The kinds `main/activity.ts` writes for link transitions, matched exactly rather than by prefix. */
const ACTIVITY_CONNECTED_KINDS = new Set(['Connected', 'Reconnected']);

function activityRowView(event: ActivityEvent): ActivityRowView {
  const base: ActivityRowView = {
    icon: ACTIVITY_ICONS[event.category] ?? 'activity',
    tone: activityTone(event),
    title: event.kind,
    subtitle: event.detail,
    device: '',
    badge: '',
  };

  if (ACTIVITY_CONNECTED_KINDS.has(event.kind)) {
    // The detail IS the device name here, so it moves right and the subtitle says what happened.
    return {
      ...base,
      icon: 'link',
      subtitle: 'Successfully connected to your phone',
      device: event.detail,
    };
  }

  if (event.kind === 'Sidekick started') {
    // "version 2.0.0" → "v2.0.0". A badge is a label, and the word is the column header's job.
    const version = event.detail.replace(/^version\s+/i, '');
    return {
      ...base,
      // `overview`, not `apps`: the 2×2 tile grid, which is what the reference draws and what
      // reads as an application at 26px. `apps` is a 3×3 of dots and turns to noise at this size.
      icon: 'overview',
      subtitle: 'Application launched',
      badge: version ? `v${version}` : '',
    };
  }

  if (event.kind === 'Disconnected' || event.kind === 'Connection failed') {
    /*
     * **Grey, not red — departure O7, 2026-09-16.**
     *
     * The handoff's Recent activity draws five tinted tiles in teal, violet, green, blue and
     * **grey**, and its grey one is the system row (*"Session reconnected automatically"*). There
     * is no red anywhere in that list, and the README says why in one sentence: *"Red is reserved.
     * `#FF5D5D` means destructive or failed. Never use red as an accent … in a connection product
     * red reads as 'link is down.'"*
     *
     * That sentence is the whole defect. A red tile here was **not wrong about the event** — the
     * disconnection really was a failure — it was wrong about *when*. It sat in a list of past
     * events two inches under a header reading `Connected · 9 ms`, so the one colour in the app
     * that means *the link is down right now* was being used for something that stopped being true
     * minutes ago. Red belongs to the live surfaces: the island, the strip, the hero chip.
     *
     * **The state is still drawn, and not by colour.** `alert-circle` is the shape half, which is
     * the rule defect 26 established for the capability chips and which survives for a reader who
     * cannot separate red from grey. What changes is only which hue the tile carries.
     *
     * The `View log` link went in the same pass (departure O18): it was the one row in five with a
     * second affordance beside the chevron every row already has.
     */
    return {
      ...base,
      icon: 'alert-circle',
      // Neutral, not `failure` — O7's argument, unchanged by D23: the disconnection really was a
      // failure, and red here would put the one colour meaning *the link is down right now* on a
      // row about five minutes ago. `alert-circle` is the shape half and it survives.
      tone: 'neutral',
      // The sentence stays where it is: it is the explanation, not metadata.
      subtitle: event.detail,
    };
  }

  return base;
}

/** One icon per category, for every event the four rules above do not name explicitly. */
const ACTIVITY_ICONS: Record<ActivityCategory, string> = {
  mirroring: 'mirror',
  files: 'files',
  messages: 'messages',
  calls: 'calls',
  clipboard: 'clipboard',
  system: 'activity',
};

/**
 * The wall-clock form: `09:42` today, `Yesterday 09:42`, `28/8 09:42` before that.
 *
 * **Extracted 2026-09-16 so that two surfaces can share it rather than restate it.** The handoff
 * puts an absolute mono time in Overview's Recent activity column *and* in the Activity pane's
 * TIME column; `activityWhen` below is the relative form, and it already contained this one as its
 * tail. Pulling it out is the no-second-expression rule: a copy in `overview.ts` would be a second
 * answer to "what day was that", and the day boundary is exactly the arithmetic that goes wrong.
 *
 * `now` is a parameter rather than `Date.now()` for the same reason it is everywhere else here —
 * a function that reads the clock cannot be tested across a midnight.
 */
function activityClock(at: number, now: number): string {
  const then = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const hhmm = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;
  if (at >= today.getTime()) return hhmm;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (at >= yesterday.getTime()) return `Yesterday ${hhmm}`;
  return `${then.getDate()}/${then.getMonth() + 1} ${hhmm}`;
}

/**
 * The absolute time, for the row's tooltip — what somebody comparing this pane against the phone's
 * own log needs, which the relative label deliberately does not give them.
 *
 * It replaces `new Date(at).toString()`, which put
 * `Sun Sep 20 2026 17:10:22 GMT+0530 (India Standard Time)` under the pointer: a runtime's debug
 * representation, with a timezone spelled out twice, shown to a person. Nine of them were on
 * screen. Same rule as a package id — a machine string may be a handle and may not be the thing
 * somebody reads.
 */
function activityExactWhen(at: number): string {
  const d = new Date(at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ss = String(d.getSeconds()).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${d.getDate()} ${month} ${d.getFullYear()}, ${hhmm}:${ss}`;
}

function activityWhen(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return activityClock(at, now);
}

/**
 * The plain-script shape `filesRoots.ts` and `appLabel.ts` document: no top-level `export`, a
 * `module.exports` shim at the foot. That makes this one file loadable by a `<script>` tag in the
 * CSP-locked renderer, `require`-able from the main process, and `require`-able from `node --test`
 * — one implementation, three consumers, and its types are global to the TypeScript project so
 * `main/activity.ts` and `preload.ts` get them from the same file the pane calls at runtime.
 *
 * A second copy of `activityPaneView` in the renderer is the copy that would not get the next fix,
 * and the A3/A4 distinction is exactly the rule that must not have two homes.
 */
/*
 * And the same names on `globalThis`.
 *
 * In the renderer these functions are already global — a `<script>` tag's top-level declarations
 * are — and this assignment is a no-op there. It matters under `node --test`, where the same file
 * is a CommonJS module and its declarations are module-scoped: without this, `ActivityView.draw`
 * would throw `activityPage is not defined` the moment a view test mounted it.
 *
 * The alternative was to have the view take its helpers as constructor arguments, which would make
 * the test able to pass in a second implementation of the very rules it is checking — the
 * model-instead-of-call fault `MediaPayloadsTest` was fixed for. The view calls the one
 * implementation, in both environments.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES;
  g.CATEGORY_LABELS = CATEGORY_LABELS;
  g.activityTone = activityTone;
  g.activityBusiestHour = activityBusiestHour;
  g.activityCsv = activityCsv;
  g.activityPage = activityPage;
  g.activityPager = activityPager;
  g.activityPaneView = activityPaneView;
  g.activitySummary = activitySummary;
  g.activityWhen = activityWhen;
  g.activityExactWhen = activityExactWhen;
  g.activityClock = activityClock;
  g.activityRowView = activityRowView;
  g.ACTIVITY_ICONS = ACTIVITY_ICONS;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ACTIVITY_CATEGORIES,
    CATEGORY_LABELS,
    activityCsv,
    activityPage,
    activityPager,
    activityPaneView,
    activitySummary,
    activityWhen,
    activityExactWhen,
    activityTone,
    activityBusiestHour,
    activityClock,
    activityRowView,
    ACTIVITY_ICONS,
  };
}
