import { OFFER_NOTIFICATION } from './clipOffers';

/**
 * The native notification that announces a clipboard offer (S7) — and nothing else.
 *
 * Electron-free: `main.ts` passes a factory over `new Notification(…)`, the tests pass a recorder. The
 * copy is the fixed [OFFER_NOTIFICATION], and this class has **no parameter that could carry the offer's
 * text** — `announce` takes the offer id only. Clicking opens the Clipboard pane; it never copies.
 *
 * ### What is counted, and what each count is *not* (2026-10-07)
 *
 * Stage D (2026-10-07 01:13) posted an offer banner that nobody saw: the app had called `show()`, and
 * macOS's own log said `addRequest not allowed: com.github.Electron`. This class counted that as
 * `posted` and logged nothing, so the app's own log could not tell a refused banner from a shown one.
 * Now each stage is its own count, every line carries all of them, and none claims more than it saw:
 *
 * | count | what it is | what it is **not** |
 * |---|---|---|
 * | `considered` | an offer arrived | — |
 * | `skippedFocused` | the window was focused; the pane already says it | a failure |
 * | `requested` | `show()` was called and returned | proof anything appeared |
 * | `reportedShown` | Electron emitted `show` for it | proof a banner was drawn — Focus, a banner style of *None*, or delivery straight to Notification Center are not observable from here |
 * | `failed` | `show()` threw, or Electron emitted `failed` (macOS refused) | — |
 * | `clicked` | a click reached this process | — |
 * | `withdrawn` | taken down because its offer ended | — |
 *
 * A failure keeps the offer: it still waits in the pane, and [guidance] says so in words the pane draws.
 * The macOS error text is logged as macOS gave it; it is the platform's sentence about its own refusal and
 * holds nothing from the offer, because nothing from the offer was ever handed to it.
 */
export interface NativeNotificationLike {
  on(event: 'click', listener: () => void): void;
  on(event: 'show', listener: () => void): void;
  on(event: 'failed', listener: (event: unknown, error: string) => void): void;
  show(): void;
  close(): void;
}

export interface OfferBannerStatus {
  considered: number;
  skippedFocused: number;
  requested: number;
  reportedShown: number;
  failed: number;
  clicked: number;
  withdrawn: number;
  /** The most recent failure since launch, or null. `message` is the platform's text, never the offer's. */
  lastFailure: { atMs: number; message: string } | null;
}

/**
 * What the Clipboard pane says when a banner could not be shown, or null when there is nothing to say.
 *
 * `packaged` decides whether a Setting exists to switch on, exactly as `refusalCopy` does for the
 * notification pane: a development run is refused before macOS registers it, so there is no row to find.
 */
export function offerBannerGuidance(status: OfferBannerStatus, packaged: boolean): string | null {
  if (!status.lastFailure) return null;
  const where = packaged
    ? 'To get banners, open System Settings → Notifications, find Sidekick, and turn on Allow Notifications.'
    : 'This development build cannot show notifications, so check this pane for offers.';
  return `macOS did not show a notification for an offer from your phone. Offers wait here until you press Copy or Dismiss. ${where}`;
}

export class ClipOfferNotifier {
  private readonly live = new Map<string, NativeNotificationLike>();
  private readonly counts = { considered: 0, skippedFocused: 0, requested: 0, reportedShown: 0, failed: 0, clicked: 0, withdrawn: 0 };
  private lastFailure: { atMs: number; message: string } | null = null;

  constructor(
    private readonly create: (options: { title: string; body: string; silent: boolean }) => NativeNotificationLike,
    private readonly windowFocused: () => boolean,
    private readonly openClipboardPane: () => void,
    private readonly silent: () => boolean = () => false,
    private readonly log: (line: string, level?: 'info' | 'warn') => void = () => undefined,
    /** Called after any count changes, so the pane can redraw its guidance. */
    private readonly changed: (status: OfferBannerStatus) => void = () => undefined,
    /** Called on a refusal, with the platform's message — main records it with the other banners' refusals. */
    private readonly refused: (message: string) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** An offer arrived. Posted only when the window is not focused — the pane already says so when it is. */
  announce(offerId: string): void {
    this.counts.considered += 1;
    if (this.windowFocused()) {
      this.counts.skippedFocused += 1;
      this.log(`offer notification not requested: the window is focused and the pane shows the offer — ${this.tally()}`);
      this.changed(this.status());
      return;
    }
    let native: NativeNotificationLike;
    try {
      native = this.create({ title: OFFER_NOTIFICATION.title, body: OFFER_NOTIFICATION.body, silent: this.silent() });
      native.on('click', () => {
        this.counts.clicked += 1;
        this.withdraw(offerId);
        this.log(`offer notification clicked — opened the Clipboard pane, nothing copied — ${this.tally()}`);
        this.openClipboardPane();
        this.changed(this.status());
      });
      native.on('show', () => {
        this.counts.reportedShown += 1;
        this.log(`offer notification reported shown by Electron (what macOS drew is not observable here) — ${this.tally()}`);
        this.changed(this.status());
      });
      native.on('failed', (_event, error) => this.fail(offerId, String(error ?? 'unknown')));
      native.show();
    } catch (error) {
      this.fail(offerId, `show() threw: ${error instanceof Error ? error.name : 'non-Error'}`);
      return;
    }
    this.live.set(offerId, native);
    this.counts.requested += 1;
    this.log(`offer notification requested from macOS (show() returned; not proof it appeared) — ${this.tally()}`);
    this.changed(this.status());
  }

  private fail(offerId: string, message: string): void {
    this.counts.failed += 1;
    this.live.delete(offerId);
    this.lastFailure = { atMs: this.now(), message };
    this.log(`offer notification FAILED — ${message}; the offer still waits in the Clipboard pane — ${this.tally()}`, 'warn');
    this.refused(message);
    this.changed(this.status());
  }

  /** The offer was copied, dismissed, replaced, expired or the link dropped: take the banner down. */
  withdraw(offerId: string): void {
    const native = this.live.get(offerId);
    if (!native) return;
    this.live.delete(offerId);
    this.counts.withdrawn += 1;
    native.close();
  }

  withdrawAll(): void {
    for (const id of [...this.live.keys()]) this.withdraw(id);
  }

  get size(): number {
    return this.live.size;
  }

  status(): OfferBannerStatus {
    return { ...this.counts, lastFailure: this.lastFailure ? { ...this.lastFailure } : null };
  }

  private tally(): string {
    const c = this.counts;
    return (
      `${c.considered} considered / ${c.skippedFocused} skipped (focused) / ${c.requested} requested / ` +
      `${c.reportedShown} reported shown / ${c.failed} failed / ${c.clicked} clicked / ${c.withdrawn} withdrawn since launch`
    );
  }
}
