import { EventEmitter } from 'node:events';
import { MessageType, type PhoneAck, type PhoneNotification } from '../shared/protocol';
import { tell } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';
import { notifKeyForLog } from '../shared/notifKeyLog';
import { debugSwitches } from './debugSwitches';

/**
 * The Mac's half of notifications: a live set, and three things you can do to one.
 *
 * ### The set is event-sourced, and that is a decision
 *
 * There is no `notif.list` in the protocol and there is deliberately not going to be one. The
 * phone replays every active notification as an ordinary `notif.posted` the moment a session
 * finishes its handshake, so this holds a set built from exactly one kind of input — events — and
 * never has to reconcile a snapshot against a stream. Reconciling those two is where duplicate
 * rows and ghost entries come from in every notification mirror that has both.
 *
 * The consequence to keep in mind: **the set is only ever as good as the connection.** It is
 * cleared on disconnect rather than kept, because a stale notification the user has already dealt
 * with on their phone is worse than an empty list — clicking it produces `NOT_FOUND`, and a list
 * you cannot trust is one people stop reading.
 */
/**
 * The title the Mac was showing, for the target rule in docs/protocol.md.
 *
 * Omitted rather than sent empty when the notification has no title: an absent field means "there
 * is nothing to disagree about" on the phone, and an empty string would be compared against a real
 * title and refuse every action on an untitled notification.
 */
function seenTitleOf(notification: PhoneNotification): Record<string, string> {
  const title = notification.title?.trim();
  return title ? { seenTitle: title } : {};
}

export class NotificationClient extends EventEmitter {
  /** Keyed by `StatusBarNotification.getKey()`, which is the only id any request accepts. */
  private live = new Map<string, PhoneNotification>();

  /**
   * How many have arrived and how many have gone, since launch.
   *
   * Both, beside each other, per CLAUDE.md. "0 showing" on a phone with a full shade and "0
   * showing" on an empty one are the same line unless the counters say which happened.
   */
  private postedCount = 0;
  private removedCount = 0;

  constructor(private readonly link: () => LinkClient | null) {
    super();
  }

  /**
   * `N showing`, with the hidden group headers spelled out when there are any.
   *
   * The renderer hides `isGroupSummary` rows, so a bare `this.live.size` here would disagree with
   * what is on screen *and* with the phone's `Replayed N active (M summaries)`. Three numbers that
   * cannot be reconciled is how a working feature gets reported as broken — which is what happened
   * before the flag existed.
   */
  private tally(): string {
    let summaries = 0;
    for (const one of this.live.values()) if (one.isGroupSummary) summaries += 1;
    const showing = this.live.size - summaries;
    const hidden = summaries > 0 ? ` (+${summaries} group ${summaries === 1 ? 'header' : 'headers'} hidden)` : '';
    return `${showing} showing${hidden}, ${this.postedCount} posted / ${this.removedCount} removed since launch`;
  }

  /**
   * Whether this key is already held.
   *
   * Read by the native notifier *before* {@link onPosted} stores it, because Android sends an update
   * as another `posted` with the same key — so without asking first, a download's ticking progress
   * bar looks like sixty new notifications.
   */
  has(key: string): boolean {
    return this.live.has(key);
  }

  /**
   * The notification currently held under this key, if any.
   *
   * Read by the native notifier *before* {@link onPosted} replaces it, so the two timestamps can be
   * compared: a re-post whose `whenMs` advanced is a new message in a thread, and one whose `whenMs`
   * stood still is a progress bar redrawing.
   */
  get(key: string): PhoneNotification | null {
    return this.live.get(key) ?? null;
  }

  /** Every live notification, newest first — which is the order a shade reads in. */
  all(): PhoneNotification[] {
    return [...this.live.values()].sort((a, b) => b.whenMs - a.whenMs);
  }

  /**
   * One `notif.posted`.
   *
   * An update to an existing notification arrives as another `posted` with the same key, so this
   * is a replace and not an append. Android has no separate "changed" event; without the replace,
   * a download with a ticking progress bar becomes sixty rows in a minute.
   */
  onPosted(payload: Record<string, unknown>): void {
    const notification = payload as unknown as PhoneNotification;
    if (typeof notification.key !== 'string' || notification.key.length === 0) {
      log.warn('notif', 'Dropped a notif.posted with no key');
      return;
    }
    const isUpdate = this.live.has(notification.key);
    this.live.set(notification.key, notification);
    this.postedCount += 1;
    log.info(
      'notif',
      `${isUpdate ? 'updated' : 'posted'} ${notification.package} — ${this.tally()}`,
    );
    this.emit('changed', this.all());
  }

  onRemoved(payload: Record<string, unknown>): void {
    const key = typeof payload.key === 'string' ? payload.key : null;
    if (!key) return;
    // Step 51's window, held open on purpose. The row stays in the set after the phone has dropped
    // the notification, so a Dismiss click reaches a key the phone no longer has and the
    // `NOT_FOUND` path runs. Off unless asked for on the command line.
    if (debugSwitches().stallRemoved) {
      log.warn('notif', `stallRemoved: swallowing notif.removed for ${notifKeyForLog(key)} — the row is now stale on purpose`);
      return;
    }
    if (!this.live.delete(key)) return;
    this.removedCount += 1;
    log.info(
      'notif',
      `removed — ${this.tally()}`,
    );
    this.emit('changed', this.all());
  }

  /**
   * Drops everything, on disconnect.
   *
   * See the class comment: a set that outlives its connection is a set of things that may already
   * have been dealt with on the phone. An empty list that says "not connected" is honest; a full
   * list of maybes is not.
   */
  clear(): void {
    if (this.live.size === 0) return;
    log.info('notif', `Cleared ${this.live.size} notifications: the link dropped`);
    this.live.clear();
    this.emit('changed', this.all());
  }

  // ---- the three verbs ----------------------------------------------------------------------

  /**
   * Sends a reply through the notification's own inline reply action.
   *
   * The `canReply` check is here as well as in the renderer on purpose. The renderer hides the box
   * — that is what a user experiences — and this refuses the request, which is what stops a stale
   * pane, a keyboard shortcut, or a future caller from sending a reply into a notification that
   * has no reply action. The phone refuses it too. Three checks for one rule is not excessive
   * here: replying is the one notification verb whose failure is visible to somebody else.
   */
  async reply(key: string, text: string): Promise<PhoneAck> {
    const notification = this.live.get(key);
    if (!notification) {
      return {
        ok: false,
        reason: 'That notification is no longer showing, so the reply was not sent.',
        fixHint: 'It was dismissed or replaced on the phone.',
      };
    }
    if (!notification.canReply && !debugSwitches().bypassReplyGuard) {
      return {
        ok: false,
        reason: `${notification.appName} does not offer a reply on that notification, so there ` +
          'is nothing for the phone to type into.',
        fixHint: 'Open the app on the phone to answer this one.',
      };
    }
    if (!notification.canReply) {
      log.warn(
        'notif',
        `bypassReplyGuard: sending a reply to ${notification.appName} which advertises no reply ` +
          'action — expecting NO_REPLY_ACTION from the phone',
      );
    }
    if (text.trim().length === 0) {
      return {
        ok: false,
        reason: 'An empty reply was not sent.',
        fixHint: 'An empty message would appear in the conversation and cannot be taken back.',
      };
    }
    // The target rule. `seenTitle` is what *this* row was drawn from, taken from the set rather
    // than from anything the pane passed in — the pane can be stale in ways the set is not, and
    // the whole point of the check is that the two sides name the same thing independently.
    return tell(this.link(), 'notif', MessageType.NOTIF_REPLY, {
      key,
      text,
      ...seenTitleOf(notification),
    });
  }

  async action(key: string, index: number): Promise<PhoneAck> {
    const notification = this.live.get(key);
    if (!notification) {
      return {
        ok: false,
        reason: 'That notification is no longer showing, so nothing was pressed.',
        fixHint: 'It was dismissed or replaced on the phone.',
      };
    }
    return tell(this.link(), 'notif', MessageType.NOTIF_ACTION, {
      key,
      index,
      ...seenTitleOf(notification),
    });
  }

  /**
   * Dismisses on the phone, and locally straight away.
   *
   * The optimistic removal is safe because the phone sends `notif.removed` for a successful
   * dismiss anyway — this only removes the wait. If the dismiss is refused the row comes back,
   * because the refusal path re-emits the set it still holds.
   */
  async dismiss(key: string): Promise<PhoneAck> {
    const result = await tell(this.link(), 'notif', MessageType.NOTIF_DISMISS, { key });
    if (result.ok) {
      if (this.live.delete(key)) this.emit('changed', this.all());
    } else {
      this.emit('changed', this.all());
    }
    return result;
  }
}
