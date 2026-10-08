/**
 * The clipboard's electron-free half: the history, the echo rule, and the size cap.
 *
 * `src/shared/` is where a testable seam belongs in this codebase — the rule that produced
 * `session.ts` and `transferDigest.ts` — and these are exactly the rules worth testing without a
 * window: what is remembered, what is refused, and what must never be sent back.
 *
 * The phone has the same rules in `ClipboardPayloads.kt`. They are deliberately duplicated
 * rather than shared, because there is no shared runtime — and where two expressions of one rule
 * exist, `docs/protocol.md` is the one they are both answerable to. The caps are stated there.
 */

/** 64 KB of UTF-8. An entry over it is refused, never truncated — a truncated paste is corrupt. */
export const MAX_TEXT_BYTES = 64 * 1024;

/** 20 entries per side, in memory, cleared on disconnect. */
export const HISTORY_MAX = 20;

export interface ClipItem {
  /**
   * `displaced` is **local to the Mac and never on the wire** — see [ClipboardClient.onPush].
   *
   * It is what this Mac's clipboard held immediately before an arriving entry overwrote it, kept so
   * that Restore is an undo. `docs/protocol.md` permits removing the confirmation only if it is
   * replaced by an undo, and this is that undo. Its text is **never rendered**: the pane draws the
   * row and the button and not the content, because this is the one entry in the history nobody
   * chose to put there and it may be a password.
   */
  kind: 'text' | 'empty' | 'sensitive' | 'displaced';
  text?: string;
  /**
   * The **sender's** clock. `docs/protocol.md`: it orders that side's history and is trusted for
   * nothing else.
   *
   * On a phone entry this is *not when somebody copied* — Android forbids a background read, so the
   * phone reads its clipboard when ConnectSuite comes to the front, which may be an hour later. Any
   * label drawn from this field has to say "the phone read it", never "copied on the phone", or it
   * is a true sentence about the wrong moment.
   */
  atMs: number;
  source: 'phone' | 'mac';
  package?: string;
  appName?: string;
  /**
   * This Mac's clock when the entry entered this history. **Local; never on the wire.**
   *
   * The only timestamp in an entry that this machine can vouch for, and therefore the only one the
   * sync timeline may draw as a fact about this Mac. Absent on entries this side originated, where
   * it would be a second reading of the same instant.
   */
  receivedAtMs?: number;
  /**
   * Whether this entry reached this Mac's pasteboard. **Local; never on the wire.**
   *
   * Present only on entries that arrived. `undefined` means *nobody asked this question of this
   * entry*, which is a different fact from `false`, and the pane draws the two differently.
   */
  applied?: boolean;
  /** A `displaced` entry's local handle, for Restore. **Local; never on the wire.** */
  id?: string;
  /** Set when the arrival was **offered** rather than applied (S7). **Local; never on the wire.** */
  offerId?: string;
  /** Set when the person pressed **Copy** on an offer and it was applied. **Local; never on the wire.** */
  copiedByPerson?: boolean;
  /** Whether that offer still waits for Copy — computed when the history is read. **Local.** */
  offerPending?: boolean;
}

/** UTF-8 bytes, not `String.length` — an emoji is 2 units and 4 bytes, and the wire carries bytes. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function tooLarge(text: string): boolean {
  return byteLength(text) > MAX_TEXT_BYTES;
}

/*
 * The echo rule used to live here, as `shouldSend`. It moved to `clipEcho.ts` when auto-apply
 * landed on the Mac, and it was *deleted* from here rather than left as a convenience wrapper.
 *
 * A rule with two homes has one home that is tested and one that is real, and nothing says which is
 * which until they disagree. `clipboardHistory.test.ts` covered this function perfectly and would
 * have kept covering it after the shipping path stopped calling it — a passing test over dead code
 * that reads exactly like a passing test over live code. `scripts/check-clip-echo.mjs` is what stops
 * a third one appearing.
 */

/**
 * A bounded, in-memory clipboard history.
 *
 * **In memory and nowhere else.** Not a file, not `electron-store`, not `localStorage`. A clipboard
 * history that survives a restart is a file full of other people's passwords, and the key to
 * encrypt it would live beside it. Cleared on disconnect, gone on quit.
 */
export class ClipHistory {
  private items: ClipItem[] = [];

  constructor(private readonly max = HISTORY_MAX) {}

  get size(): number {
    return this.items.length;
  }

  /** Remembers an item, newest first. A sensitive item is never stored; returns what happened. */
  add(item: ClipItem): boolean {
    if (item.kind === 'sensitive') return false;
    if (item.text !== undefined) {
      this.items = this.items.filter((held) => held.text !== item.text);
    }
    this.items.unshift(item);
    if (this.items.length > this.max) this.items.length = this.max;
    return true;
  }

  newestFirst(limit = this.max): ClipItem[] {
    return this.items.slice(0, Math.max(1, Math.min(limit, this.max)));
  }

  /** Returns how many were removed: an empty clear and a clear of twenty are different events. */
  clear(): number {
    const had = this.items.length;
    this.items = [];
    return had;
  }
}
