import { OFFER_NOTIFICATION } from './clipOffers';

/**
 * The native notification that announces a clipboard offer (S7) — and nothing else.
 *
 * Electron-free: `main.ts` passes a factory over `new Notification(…)`, the tests pass a recorder. The
 * copy is the fixed [OFFER_NOTIFICATION], and this class has **no parameter that could carry the offer's
 * text** — `announce` takes the offer id only. Clicking opens the Clipboard pane; it never copies.
 */
export interface NativeNotificationLike {
  on(event: 'click', listener: () => void): void;
  show(): void;
  close(): void;
}

export class ClipOfferNotifier {
  private readonly live = new Map<string, NativeNotificationLike>();
  private posted = 0;
  private clicked = 0;

  constructor(
    private readonly create: (options: { title: string; body: string; silent: boolean }) => NativeNotificationLike,
    private readonly windowFocused: () => boolean,
    private readonly openClipboardPane: () => void,
    private readonly silent: () => boolean = () => false,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** An offer arrived. Posted only when the window is not focused — the pane already says so when it is. */
  announce(offerId: string): void {
    if (this.windowFocused()) return;
    const native = this.create({ title: OFFER_NOTIFICATION.title, body: OFFER_NOTIFICATION.body, silent: this.silent() });
    native.on('click', () => {
      this.clicked += 1;
      this.withdraw(offerId);
      this.log(`offer notification clicked — opened the Clipboard pane, nothing copied (${this.clicked} clicked / ${this.posted} posted)`);
      this.openClipboardPane();
    });
    native.show();
    this.live.set(offerId, native);
    this.posted += 1;
  }

  /** The offer was copied, dismissed, replaced, expired or the link dropped: take the banner down. */
  withdraw(offerId: string): void {
    const native = this.live.get(offerId);
    if (!native) return;
    this.live.delete(offerId);
    native.close();
  }

  withdrawAll(): void {
    for (const id of [...this.live.keys()]) this.withdraw(id);
  }

  get size(): number {
    return this.live.size;
  }
}
