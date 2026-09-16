import { EventEmitter } from 'node:events';
import {
  ErrorCode,
  MessageType,
  RemoteAction,
  type PhoneAck,
  type PhoneResult,
  type RemoteArtwork,
  type RemoteState,
} from '../shared/protocol';
import { ask, tell } from './feature';
import { debugSwitches } from './debugSwitches';
import type { LinkClient } from './link';
import { log } from './logger';

// `shared/appLabel.ts` is a plain script, not a module — it has to be loadable by a `<script>` tag
// in the renderer, which has no module loader. So it is reached by `require` here rather than by
// `import`, and its types come from the same file's project-global declarations. See its docblock.
const sharedLabels = require('../shared/appLabel') as {
  remoteUnsupportedReasonOf: typeof remoteUnsupportedReasonOf;
};

/**
 * The Mac's half of the media remote: one state the phone pushes, and one verb.
 *
 * ### The state is pushed, and asked for once
 *
 * `remote.state` is both a request and an event — the Mac asks on connect so the card is never
 * blank, and the phone pushes unprompted on every track, pause, and session handover. Everything
 * after the first request is an event, which is why this holds a single state rather than polling
 * one. A poll would draw a card that is up to a second wrong on every track change, and this is a
 * card people look at *because* they want to know what is playing right now.
 *
 * ### `active: false` is a state, not a failure
 *
 * Nothing playing is the normal condition of a phone. It is drawn as an empty remote, never as an
 * error — see step 66 and docs/protocol.md. The distinction matters because the alternative,
 * treating silence as a broken feature, produces a red card on a phone that is working perfectly.
 */
export class RemoteClient extends EventEmitter {
  private state: RemoteState = { active: false };

  /**
   * This Mac's clock when the state arrived, and how stale it already was.
   *
   * The progress bar is drawn by the renderer between updates, which needs an anchor. The obvious
   * anchor is the phone's own `positionAtMs`, and it is deliberately *not* used as one: it is the
   * phone's wall clock, and the only clock mapping this link measures is `clockOffset()`, which
   * maps the phone's **monotonic** clock for the mirror's frame timestamps. Reading a wall-clock
   * stamp through a monotonic offset would be a mapping between two clocks that were never
   * compared — it would look principled and be wrong by however far the two devices' wall clocks
   * have drifted apart.
   *
   * So the anchor is this Mac's own `Date.now()` at arrival, and the unmeasured error is one
   * network transit — about 8ms on this link, against a bar that ticks in seconds. `positionAtMs`
   * is still carried and still earns its place: it orders two pushes that arrive together.
   */
  private receivedAtMs = 0;

  private pushes = 0;
  private commands = 0;
  private refusals = 0;

  /**
   * Artwork by key, and the keys that came back with nothing.
   *
   * Two collections, the same shape `apps.ts` uses and for the same reason: a key the phone has no
   * art for has to be remembered as *asked*, or every push for the current track re-requests the
   * one image that will never arrive. On a paused track that is a request per position jump,
   * forever, for a definitively empty answer.
   */
  private readonly artwork = new Map<string, string>();
  private readonly artworkMissing = new Set<string>();
  private artworkMade = 0;
  private artworkEmpty = 0;
  private artworkCacheHits = 0;

  constructor(private readonly link: () => LinkClient | null) {
    super();
  }

  /**
   * Successes beside failures, per CLAUDE.md.
   *
   * A refusal count alone cannot tell a remote that is correctly declining what an app does not
   * support from one that has never once worked — which is exactly the shape of defect 18.
   */
  private tally(): string {
    return `${this.pushes} states / ${this.commands} delivered / ${this.refusals} refused since launch`;
  }

  current(): RemoteState & { receivedAtMs: number } {
    return { ...this.state, receivedAtMs: this.receivedAtMs };
  }

  /** One `remote.state`, pushed or replied. */
  onState(payload: Record<string, unknown>): void {
    const next = payload as unknown as RemoteState;
    // Two pushes can land together when a command is acked and the phone pushes straight after.
    // The older one must not win, or the card settles on the state from before the command.
    const previous = this.state.positionAtMs;
    if (
      typeof next.positionAtMs === 'number' &&
      typeof previous === 'number' &&
      next.positionAtMs < previous &&
      next.package === this.state.package
    ) {
      log.info('remote', `Ignored an out-of-order remote.state — ${this.tally()}`);
      return;
    }
    this.state = next;
    this.receivedAtMs = Date.now();
    this.pushes += 1;
    // The raw package here is deliberate and must not be "fixed" into a marked phrase. CLAUDE.md's
    // rule is that a package id may appear as a machine handle, never as the only thing a *user*
    // reads — and a rotating log file is the machine-handle case, where the id is more use than a
    // label. `shared/appLabel.ts`'s enumeration covers user-visible strings and deliberately does
    // not cover this line.
    log.info(
      'remote',
      next.active
        ? `${next.playing ? 'playing' : 'paused'} ${next.appName ?? next.package ?? 'an app'}: ` +
          `${next.title ?? 'untitled'} — ${this.tally()}`
        : `nothing is playing on the phone — ${this.tally()}`,
    );
    this.emit('changed', this.current());
  }

  /** Asks once, so a Mac that connects mid-song is not blank until the next track. */
  async refresh(): Promise<void> {
    const result = await ask(
      this.link(),
      'remote',
      MessageType.REMOTE_STATE,
      {},
      (payload) => payload as unknown as RemoteState,
    );
    if (result.ok) this.onState(result.data as unknown as Record<string, unknown>);
  }

  /**
   * Drops the state on disconnect.
   *
   * Same rule as the notification set and the contacts cache: a card claiming a song is playing on
   * a phone this Mac is not talking to is a claim it cannot stand behind. Pressing pause on it
   * would reach nothing.
   */
  clear(): void {
    if (!this.state.active) return;
    log.info('remote', 'Cleared the media state: the link dropped');
    this.state = { active: false };
    this.receivedAtMs = Date.now();
    this.emit('changed', this.current());
  }

  /**
   * One transport command, refused here when the phone has already said it cannot.
   *
   * `PlaybackState.actions` is the session's own declaration of what it supports, and it arrives
   * on every state. Sending a `next` into a session that has said it cannot skip produces exactly
   * the silent no-op this project keeps ruling out: the phone would accept the request, the app
   * would ignore it, and nothing anywhere would say why. So it is refused here with the app's name
   * in the sentence, and the renderer disables the button for the same reason one layer up.
   *
   * The phone refuses it too (`RemoteFailure.Unsupported`). That last check is unreachable while
   * this one stands, which is what `bypassRemoteGuard` exists to open — see debugSwitches.ts.
   */
  /**
   * The current track's cover, by the key the state carried.
   *
   * Cached by key and asked for **once** per track, which is what the key/bytes split in
   * `docs/protocol.md` buys. A hit costs nothing; a miss costs one round trip and about 20 KB.
   *
   * `NO_ARTWORK` is not a failure and is not logged as one. It is the normal answer for a podcast,
   * a browser tab or a game, and a warning line per paused podcast would be this project's own
   * cry-wolf failure written into a log file instead of onto a card.
   */
  async artworkFor(key: string, maxEdge = 256): Promise<PhoneResult<string | null>> {
    const have = this.artwork.get(key);
    if (have !== undefined) {
      this.artworkCacheHits += 1;
      return { ok: true, data: have };
    }
    if (this.artworkMissing.has(key)) {
      this.artworkCacheHits += 1;
      return { ok: true, data: null };
    }

    const result = await ask(
      this.link(),
      'remote',
      MessageType.REMOTE_ARTWORK,
      { key, maxEdge },
      (payload) => payload as unknown as RemoteArtwork,
    );

    if (!result.ok) {
      // The phone says NO_ARTWORK for "this session has no cover" and for "the track moved on".
      // Both mean *there is nothing to draw for this key*, which is a fact and not a fault, so it
      // is remembered as an answer rather than retried.
      if (result.code === ErrorCode.NO_ARTWORK) {
        this.artworkMissing.add(key);
        this.artworkEmpty += 1;
        log.info('remote', `remote.artwork ${key} → none — ${this.artworkTally()}`);
        return { ok: true, data: null };
      }
      return result;
    }

    // The echoed key is checked here and not only on the phone. The phone proves the bytes match
    // the key it was *asked* for; this proves the reply is the one this Mac asked for, which is a
    // different claim — two requests can be in flight across a fast track change.
    if (result.data.key !== key || !result.data.data) {
      this.artworkMissing.add(key);
      this.artworkEmpty += 1;
      log.info('remote', `remote.artwork ${key} → no usable bytes — ${this.artworkTally()}`);
      return { ok: true, data: null };
    }

    this.artwork.set(key, result.data.data);
    this.artworkMade += 1;
    log.info(
      'remote',
      `remote.artwork ${key} → ${result.data.width}x${result.data.height} — ${this.artworkTally()}`,
    );
    return { ok: true, data: result.data.data };
  }

  /** Successes beside the empties beside the cache, per CLAUDE.md. */
  private artworkTally(): string {
    return (
      `${this.artworkMade} covers / ${this.artworkEmpty} without art / ` +
      `${this.artworkCacheHits} served from cache`
    );
  }

  async command(action: string, extra: Record<string, unknown> = {}): Promise<PhoneAck> {
    const bypass = debugSwitches().bypassRemoteGuard;

    if (!this.state.active && !bypass) {
      this.refusals += 1;
      log.warn('remote', `${action} refused here: nothing is playing — ${this.tally()}`);
      return {
        ok: false,
        reason: 'Nothing is playing on the phone, so there is no player to control.',
        fixHint: 'Start something playing on the phone and this card will fill in by itself.',
      };
    }

    const unsupported = this.unsupportedReason(action);
    if (unsupported && !bypass) {
      this.refusals += 1;
      log.warn('remote', `${action} refused here: ${unsupported.log} — ${this.tally()}`);
      return { ok: false, reason: unsupported.reason };
    }

    if ((!this.state.active || unsupported) && bypass) {
      log.warn(
        'remote',
        `bypassRemoteGuard: sending ${action} the phone has already said it cannot do — ` +
          'expecting NO_MEDIA_SESSION or FEATURE_UNAVAILABLE from the phone',
      );
    }

    const result = await tell(this.link(), 'remote', MessageType.REMOTE_COMMAND, {
      action,
      ...extra,
    });
    if (result.ok) this.commands += 1;
    else this.refusals += 1;
    log.info('remote', `remote.command ${action} — ${this.tally()}`);
    return result;
  }

  /**
   * Why this session cannot do that, or null.
   *
   * Only the three capability flags the protocol carries are checked. Play, pause and stop have no
   * flag of their own and are never refused here: a session that is holding audio can always be
   * asked to stop making it.
   */
  private unsupportedReason(action: string): { reason: string; log: string } | null {
    // The sentence is composed in shared/appLabel.ts, which is also where the renderer's three get
    // composed — one implementation, and one enumeration a test can assert over. Defect 46.
    const no = (what: string, log: string) => ({
      reason: sharedLabels.remoteUnsupportedReasonOf(this.state, what),
      log,
    });
    if (action === RemoteAction.NEXT && this.state.canSkipNext === false) {
      return no('skipping to the next track', 'canSkipNext is false');
    }
    if (action === RemoteAction.PREVIOUS && this.state.canSkipPrevious === false) {
      return no('skipping to the previous track', 'canSkipPrevious is false');
    }
    if (action === RemoteAction.SEEK && this.state.canSeek === false) {
      return no('seeking', 'canSeek is false');
    }
    return null;
  }
}
