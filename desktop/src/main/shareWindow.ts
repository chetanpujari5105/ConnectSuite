import { BrowserWindow, screen } from 'electron';
import type { ShareCardSnapshot } from './share';
import type { WindowFacts } from './shareDecision';
import { SHARE_WINDOW_MIN_HEIGHT, clampShareWindowHeight, shareWindowBounds } from './shareWindowRules';
import { log } from './logger';

/** What the receive window's page is sent: which offer it is about, every offer, and the paired phone. */
export interface SharePagePayload {
  subject: string | null;
  offers: ShareCardSnapshot[];
  /** The paired phone's name from this Mac's own record — the name the window uses for the sender. */
  phone: string | null;
}

/**
 * The receive window — a small Sidekick-owned utility window for an incoming file.
 * docs/feature-a-receive-window.md §4.2. Every decision it makes is in `shareWindowRules.ts`.
 *
 * ### What it will not do, and where each is held
 *
 * - **It does not take focus when a file arrives.** [presentInactive] is the only arrival path and
 *   it calls `showInactive` and nothing else: no `show`, no `focus`, no `moveTop`, no
 *   `setAlwaysOnTop`, no Dock bounce, no Notification Center. Someone typing in another app keeps
 *   their keystrokes, and an Enter cannot land on Accept. `shareDecision.test.ts` reads this file
 *   and fails if any of those appear in that path.
 * - **It is not raised over a full-screen or presentation app.** Normal window level, not on all
 *   Spaces: it waits on the desktop Space, and an offer nobody sees expires honestly.
 * - **The first click on it does not act.** `acceptFirstMouse` is off, so a click on the inactive
 *   window only focuses it — the Accept gate (`acceptAllowed`) wants a focused window, and this is
 *   what makes a stray click land on nothing.
 * - **Closing is not declining.** The offer keeps waiting, and the main window's card says so.
 *
 * Only [openFromUser] — a person pressing *Show* on the main window's card — may show and focus it.
 */
export class ShareReceiveWindow {
  private window: BrowserWindow | null = null;
  private subject: string | null = null;
  private height = SHARE_WINDOW_MIN_HEIGHT;
  /** How the window should appear once its page has drawn: set by the path that created it. */
  private reveal: 'inactive' | 'active' | null = null;
  private presented = 0;

  constructor(
    private readonly preload: string,
    private readonly page: string,
    private readonly payload: (subject: string | null) => SharePagePayload,
    private readonly ground: () => string,
  ) {}

  /** An offer has come to need attention. Shown **without focus**; nothing else. */
  presentInactive(offerId: string): void {
    this.subject = offerId;
    this.presented += 1;
    const w = this.ensure('inactive');
    this.push();
    if (this.reveal === null && !w.isVisible()) w.showInactive();
    log.info('share', `receive window presented without focus for ${offerId} (${this.presented} this run)`);
  }

  /** A person pressed *Show* for [offerId] on the main window's card: show it, and let it take focus. */
  openFromUser(offerId: string): void {
    this.subject = offerId;
    const w = this.ensure('active');
    this.push();
    if (this.reveal !== null) {
      this.reveal = 'active';
    } else {
      w.show();
      w.focus();
    }
    log.info('share', `receive window opened by a person for ${offerId}`);
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }

  push(): void {
    const w = this.window;
    if (w && !w.isDestroyed()) w.webContents.send('share-window', this.payload(this.subject));
  }

  state(): SharePagePayload {
    return this.payload(this.subject);
  }

  webContents(): Electron.WebContents | null {
    const w = this.window;
    return w && !w.isDestroyed() ? w.webContents : null;
  }

  facts(): WindowFacts {
    const w = this.window;
    const exists = w !== null && !w.isDestroyed();
    return {
      exists,
      visible: exists && w.isVisible(),
      minimized: exists && w.isMinimized(),
      focused: exists && w.isFocused(),
    };
  }

  /** The page measured its content; resize, keeping the top-right corner where it is. */
  setContentHeight(raw: unknown): void {
    const h = clampShareWindowHeight(raw);
    const w = this.window;
    if (h === null || !w || w.isDestroyed()) return;
    this.height = h;
    const b = w.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const bottom = area.y + area.height;
    w.setBounds({ x: b.x, y: Math.min(b.y, Math.max(area.y, bottom - h)), width: b.width, height: Math.min(h, area.height) });
    // The page has drawn at its real height: now it may appear, the way the path that created it asked.
    const how = this.reveal;
    this.reveal = null;
    if (how === 'inactive' && !w.isVisible()) w.showInactive();
    if (how === 'active') {
      w.show();
      w.focus();
    }
  }

  private ensure(how: 'inactive' | 'active'): BrowserWindow {
    const existing = this.window;
    if (existing && !existing.isDestroyed()) return existing;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const bounds = shareWindowBounds(area, this.height);
    const w = new BrowserWindow({
      ...bounds,
      title: 'Incoming file',
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: false,
      acceptFirstMouse: false,
      hasShadow: true,
      // The chrome layer: the one translucent surface the design allows. The material follows the
      // app's appearance; the page paints `--elev-1` over it, and opaque under reduced transparency.
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: this.ground(),
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        zoomFactor: 1,
      },
    });
    this.window = w;
    this.reveal = how;
    w.webContents.on('did-finish-load', () => w.webContents.setZoomLevel(0));
    // A page that never reports its height must not leave an offer invisible: appear anyway.
    w.once('ready-to-show', () => {
      setTimeout(() => {
        if (w.isDestroyed() || this.reveal === null) return;
        log.warn('share', 'receive window page did not report its height in time; showing at the default');
        this.setContentHeight(this.height);
      }, 600);
    });
    w.on('closed', () => {
      if (this.window === w) this.window = null;
      // Not a Decline. Logged with the offer's state so a person asking "did closing it refuse the
      // file?" can read the answer.
      const s = this.subject ? this.payload(this.subject).offers.find((o) => o.offerId === this.subject)?.state : undefined;
      log.info('share', `receive window closed (offer ${this.subject ?? 'none'}: ${s ?? 'no offer'}) — closing is not declining`);
    });
    void w.loadFile(this.page);
    return w;
  }
}
